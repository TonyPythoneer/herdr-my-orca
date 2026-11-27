// Only TypeScript needs compilation. Existing JavaScript is already a valid Herdr
// deliverable; reprinting it changes VM fixtures, source diagnostics and generated provenance.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifests } from "../../scripts/orca-ui-manifests.mjs";
import { compiledViewportBytes } from "./packed-contract.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = fileURLToPath(new URL("./dist/", import.meta.url));
const output = join(dist, "delivery");
const paths = ["layouts", "mods", "themes", "keys.json", "programs.json", "settings.json"];

function command(bin, args) {
  const result = spawnSync(bin, args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${bin} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const path = join(dir, item.name);
    return item.isDirectory() ? walk(path) : [path];
  });
}
const manifest = loadManifests({ root });
const typed = manifest.shared.files.find(row => row.source === "orca-ui/shared/list-viewport.js");
assert.ok(typed?.outputs.length, "missing typed pilot manifest row");
const typedPaths = new Set(typed.outputs);
// Check legacy generated files at their canonical source before using them as passthrough.
console.log(command(process.execPath, ["scripts/build-orca-ui.mjs", "--check", "--out", "."]));
console.log(command(join(root, "node_modules", ".bin", "vp"), ["pack"]));
const expectedTyped = compiledViewportBytes(dist);
const tracked = command("git", ["ls-files", "-z", "--", ...paths]).split("\0").filter(Boolean);
assert.ok(tracked.length > 0 && manifest.table.size > 0);
for (const name of typedPaths) assert.ok(tracked.includes(name), `missing delivery target: ${name}`);

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const path of tracked) {
  const original = join(root, path);
  const mode = lstatSync(original);
  assert.ok(mode.isFile() && !mode.isSymbolicLink(), `not a regular file: ${path}`);
  const target = join(output, path);
  mkdirSync(dirname(target), { recursive: true });
  if (typedPaths.has(path)) writeFileSync(target, expectedTyped);
  else copyFileSync(original, target);
  chmodSync(target, mode.mode & 0o777);
}
assert.deepEqual(walk(output).map(path => relative(output, path)).sort(), [...tracked].sort(), "installation path inventory");
for (const path of tracked) {
  const original = join(root, path);
  const target = join(output, path);
  assert.equal(lstatSync(target).mode & 0o777, lstatSync(original).mode & 0o777, `mode: ${path}`);
  assert.deepEqual(readFileSync(target), typedPaths.has(path) ? expectedTyped : readFileSync(original), `bytes: ${path}`);
  if (path.startsWith("mods/") && /\.[cm]?js$/.test(path)) command(process.execPath, ["--check", target]);
}
assert.ok(existsSync(join(output, "mods/orca-agent-settings/mod.json")));
console.log(JSON.stringify({ installationFiles: tracked.length, typedRuntimeCopies: typedPaths.size, compiledSources: 1, bytePreservedFiles: tracked.length - typedPaths.size, manifestOutputs: manifest.table.size }));
