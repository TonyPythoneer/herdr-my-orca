// Fast, dependency-free validation of the files copied into Herdr's app home.
// This is not a replacement for herdr-app check or native UI testing.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const at = (path) => new URL(path, root);
const tracked = new Set(
  execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean),
);
const errors = [];
const parsed = new Map();
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const matching = (pattern) => [...tracked].filter((path) => pattern.test(path));

function parseJson() {
  for (const path of matching(/\.json$/)) {
    try {
      parsed.set(path, JSON.parse(readFileSync(at(path), "utf8")));
    } catch (error) {
      errors.push(path + ": " + error.message);
    }
  }
}

function validateManifests() {
  const manifests = new Set();
  for (const path of matching(/^mods\/[^/]+\/mod\.json$/)) {
    const name = path.split("/")[1];
    manifests.add(name);
    if (!object(parsed.get(path))) errors.push(path + ": manifest must be a JSON object");
    if (!tracked.has("mods/" + name + "/main.js")) errors.push(path + ": missing tracked main.js");
  }
  if (!manifests.size) errors.push("No mod manifests found");
  return manifests;
}

function validateObjects() {
  for (const path of ["keys.json", "programs.json", "settings.json"]) {
    if (!object(parsed.get(path))) errors.push(path + ": missing or not a JSON object");
  }
  for (const path of matching(/^themes\/[^/]+\.json$/)) {
    if (!object(parsed.get(path))) errors.push(path + ": theme must be a JSON object");
  }
}

function validateLayout(path, manifests) {
  const layout = parsed.get(path);
  if (!object(layout)) {
    errors.push(path + ": layout must be a JSON object");
    return;
  }
  const requireMod = (name) => {
    if (typeof name !== "string" || !manifests.has(name))
      errors.push(path + ": unknown mod " + JSON.stringify(name));
  };
  function walk(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "mod" && typeof child === "string") requireMod(child);
      else walk(child);
    }
  }
  walk(layout);
  if (layout.terminal_menu) requireMod(layout.terminal_menu);
  if (typeof layout.theme === "string" && !parsed.has("themes/" + layout.theme + ".json"))
    errors.push(path + ": missing theme " + layout.theme);
  if (typeof layout.preview === "string" && !tracked.has(layout.preview))
    errors.push(path + ": missing preview " + layout.preview);
}

parseJson();
const modNames = validateManifests();
validateObjects();
const layouts = matching(/^layouts\/[^/]+\.json$/);
if (!layouts.length) errors.push("No layouts found");
for (const path of layouts) validateLayout(path, modNames);

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(
    "Validated " +
      parsed.size +
      " JSON files, " +
      modNames.size +
      " mod manifests and " +
      layouts.length +
      " layouts.",
  );
}
