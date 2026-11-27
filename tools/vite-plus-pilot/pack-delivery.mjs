// Build an isolated full installation candidate. Never write to repository mods or live Herdr.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifests } from "../../scripts/orca-ui-manifests.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = fileURLToPath(new URL("./dist/", import.meta.url));
const input = join(dist, "delivery-input");
const compiled = join(dist, "delivery-compiled");
const output = join(dist, "delivery");
const paths = ["layouts", "mods", "themes", "keys.json", "programs.json", "settings.json"];
const vp = join(root, "node_modules", ".bin", "vp");

function command(bin, args, options = {}) {
  const result = spawnSync(bin, args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${bin} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function copy(from, to, mode) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  chmodSync(to, mode & 0o777);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const path = join(dir, item.name);
    return item.isDirectory() ? walk(path) : [path];
  });
}

for (const path of [input, compiled, output]) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}
const manifest = loadManifests({ root }).table;
const tracked = command("git", ["ls-files", "-z", "--", ...paths]).split("\0").filter(Boolean);
assert.ok(tracked.length > 0 && manifest.size > 0);
const entries = [];
const expected = [];
for (const path of tracked) {
  const original = join(root, path);
  assert.ok(statSync(original).isFile(), `not a regular file: ${path}`);
  const source = manifest.get(path)?.source ?? path;
  const isRuntimeJs = path.startsWith("mods/") && path.endsWith(".js") && !path.endsWith(".test.js");
  if (!isRuntimeJs) {
    copy(original, join(output, path), statSync(original).mode);
    continue;
  }
  const typed = source === "orca-ui/shared/list-viewport.js";
  const stagedPath = join(input, typed ? path.replace(/\.js$/, ".ts") : path);
  copy(typed ? join(root, "tools/vite-plus-pilot/src/list-viewport.ts") : join(root, source), stagedPath, statSync(original).mode);
  entries.push(relative(root, stagedPath));
  expected.push(path);
}
writeFileSync(join(dist, "delivery-entries.json"), JSON.stringify(entries));
console.log(command(vp, ["pack"], { env: { ...process.env, HERDR_PACK_CANDIDATE: "1" } }));
const actual = walk(compiled).map(path => relative(compiled, path)).sort();
assert.deepEqual(actual, expected.sort(), "pack must preserve every runtime JS path and emit no unexpected files");
for (const path of expected) {
  const original = join(root, path);
  const generated = join(compiled, path);
  copy(generated, join(output, path), statSync(original).mode);
  command(process.execPath, ["--check", join(output, path)]);
}
assert.deepEqual(walk(output).map(path => relative(output, path)).sort(), [...tracked].sort(), "delivery must contain exactly the existing installation file set");
for (const path of tracked) {
  const a = statSync(join(root, path)).mode & 0o777;
  const b = statSync(join(output, path)).mode & 0o777;
  assert.equal(b, a, `mode changed: ${path}`);
  if (!expected.includes(path)) assert.deepEqual(readFileSync(join(output, path)), readFileSync(join(root, path)), `static file changed: ${path}`);
}
assert.ok(existsSync(join(output, "mods", "orca-agent-settings", "mod.json")));
console.log(JSON.stringify({ installationFiles: tracked.length, compiledRuntimeModules: expected.length, manifestOutputs: manifest.size, result: "paths, modes, static files and JS syntax verified" }));
