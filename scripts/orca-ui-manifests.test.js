import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ROOT, ManifestError, loadManifests } from "./orca-ui-manifests.mjs";
import { features } from "../orca-ui/app.mjs";
import { FEATURE, edit, fixture, temp, write } from "./orca-ui-fixture.mjs";

const MANIFEST = `${FEATURE}/manifest.json`;
const load = root => loadManifests({ root });
const SHARED_MANIFEST = "orca-ui/shared/manifest.json";
const rejects = (root, pattern, path = MANIFEST) =>
  assert.throws(() => load(root), error => error instanceof ManifestError && error.path === path && pattern.test(error.message));

// The registry in app.mjs must list every manifest on disk once, with working `next` links.
function registryProblems(entries, discovered, root) {
  const problems = [];
  for (const [path, manifest] of discovered) {
    const hits = entries.filter(e => e.manifest === manifest).length;
    if (hits === 0) problems.push(`${path}: not registered in app.mjs`);
    if (hits > 1) problems.push(`${path}: registered ${hits} times`);
  }
  const known = new Set(discovered.map(([, m]) => m));
  for (const e of entries) {
    if (!known.has(e.manifest)) problems.push(`${e.manifest?.feature}: registered but not on disk`);
    for (const next of e.next) if (!existsSync(join(root, next))) problems.push(`${e.manifest?.feature}: next ${next} does not exist`);
  }
  return problems;
}

async function diskManifests() {
  const dir = join(ROOT, "orca-ui/features");
  const found = readdirSync(dir, { recursive: true }).filter(f => f.endsWith("manifest.json")).sort();
  const json = async path => (await import(pathToFileURL(join(ROOT, path)).href, { with: { type: "json" } })).default;
  return Promise.all([...found.map(f => `orca-ui/features/${f}`), SHARED_MANIFEST].map(async path => [path, await json(path)]));
}

test("app.mjs registers every manifest on disk exactly once and its next links exist", async () => {
  const discovered = await diskManifests();
  assert.ok(discovered.length > 0);
  assert.deepEqual(registryProblems(features, discovered, ROOT), []);
  for (const e of features) assert.ok(e.area && e.description, e.manifest.feature);
});

test("registry problems: a missing, duplicate, extra entry and a dead next link each fail", async () => {
  const discovered = await diskManifests();
  const [entry] = features;
  assert.match(registryProblems([], discovered, ROOT)[0], /not registered/);
  assert.deepEqual(registryProblems(features.filter(e => e.area !== "shared"), discovered, ROOT), [`${SHARED_MANIFEST}: not registered in app.mjs`]);
  assert.deepEqual(registryProblems([...features, entry], discovered, ROOT), ["orca-ui/features/panel/head/manifest.json: registered 2 times"]);
  assert.deepEqual(registryProblems([...features, { ...entry, manifest: { feature: "ghost" } }], discovered, ROOT), ["ghost: registered but not on disk"]);
  assert.match(registryProblems([{ ...entry, next: ["nope.js"] }, ...features.slice(1)], discovered, ROOT)[0], /does not exist/);
});

test("the real repo loads and every managed destination is under its mod", () => {
  const { table, features: loaded, shared } = loadManifests();
  assert.deepEqual([...loaded.keys()], ["orca-ui/features/panel/head/manifest.json"]);
  assert.equal(shared.files.length, 8);
  assert.equal(table.size, 32);
  const feature = [...table].filter(([, row]) => row.kind === "feature").map(([dest]) => dest);
  assert.equal(feature.length, 12);
  for (const dest of feature) assert.match(dest, /^mods\/orca-panel-head\/[^/]+$/);
  assert.equal([...table.values()].filter(r => r.kind === "shared").length, 20);
});

test("the table maps each destination to its source, mode, tests and slots", t => {
  const root = fixture(t);
  write(root, `${FEATURE}/.DS_Store`, "junk");
  const { table, features: loaded } = load(root);
  assert.deepEqual([...loaded.keys()], [MANIFEST]);
  assert.deepEqual([...table.keys()].sort(), [
    "mods/orca-changes/clip.js", "mods/orca-files/clip.js", "mods/orca-files/icons/a.svg", "mods/orca-files/main.js", "mods/orca-files/mod.json",
    "mods/orca-files/tool.sh", "mods/orca-files/view.js", "mods/orca-handoff/clip.js", "mods/orca-handoff/transcript.js",
    "mods/orca-menu/clip.js", "mods/orca-menu/transcript.js"]);
  assert.deepEqual(table.get("mods/orca-files/icons/a.svg"), { kind: "feature", id: "files/main", source: `${FEATURE}/icons/a.svg`,
    mode: 0o644, consumers: ["orca-files"], tests: [`${FEATURE}/view.test.js`, `${FEATURE}/fixture/data.json`], layoutSlots: { orca: ["list"] } });
  assert.equal(table.get("mods/orca-files/tool.sh").mode, 0o755);
  // A shared row carries the consumer feature's tests and slots; a consumer without one gets none.
  assert.deepEqual(table.get("mods/orca-files/clip.js"), { kind: "shared", id: "clip.js", source: "orca-ui/shared/clip.js", mode: 0o644,
    consumers: ["orca-changes", "orca-files", "orca-handoff", "orca-menu"], tests: [`${FEATURE}/view.test.js`, `${FEATURE}/fixture/data.json`], layoutSlots: { orca: ["list"] } });
  assert.deepEqual(table.get("mods/orca-handoff/clip.js").tests, []);
  assert.deepEqual(table.get("mods/orca-handoff/clip.js").layoutSlots, {});
});

const BAD = {
  "a declared file is missing": [r => rmSync(join(r, FEATURE, "view.js")), /missing source/],
  "a source file is not listed": [r => write(r, `${FEATURE}/notes.md`, "x"), /notes\.md is not listed/],
  "a file is declared twice": [r => edit(r, MANIFEST, m => m.files.push("main.js")), /declared twice/],
  "a path leaves the source folder": [r => edit(r, MANIFEST, m => m.files.push("../x.js")), /not a path inside/],
  "a declared source is a symlink": [r => { rmSync(join(r, FEATURE, "view.js")); symlinkSync(join(r, FEATURE, "main.js"), join(r, FEATURE, "view.js")); }, /not a regular file/],
  "an unknown field is present": [r => edit(r, MANIFEST, m => { m.commands = []; }), /unknown field "commands"/],
  "handwritten claims a shared copy": [r => edit(r, MANIFEST, m => m.handwritten.push("clip.js")), /claimed by both/],
  "a slot id is missing from the layout": [r => edit(r, MANIFEST, m => { m.layoutSlots.orca = ["nope"]; }), /has 0 nodes with id "nope"/],
  "a slot mounts another mod": [r => write(r, "layouts/orca.json", JSON.stringify({ id: "list", content: { mod: "other" } })), /does not mount mod orca-files/],
  "a key section is missing": [r => edit(r, MANIFEST, m => m.keys.push("layout:ghost")), /no section "layout:ghost"/],
};
for (const [name, [mutate, pattern]] of Object.entries(BAD)) {
  test(`loader rejects: ${name}`, t => {
    const root = fixture(t);
    mutate(root);
    rejects(root, pattern);
  });
}

test("a nested slot inside an array passes", t => {
  const root = fixture(t);
  write(root, "layouts/orca.json", JSON.stringify({ id: "root", children: [[{ id: "list", content: { mod: "orca-files" } }]] }));
  assert.doesNotThrow(() => load(root));
});

test("loader rejects a second feature that repeats an id or a destination", t => {
  const root = fixture(t);
  const twin = "orca-ui/features/files/twin";
  const base = JSON.parse(JSON.stringify({ feature: "files/twin", mod: "orca-files", source: twin, output: "mods/orca-files",
    files: ["main.js"], tests: [], layoutSlots: {}, keys: [] }));
  write(root, `${twin}/manifest.json`, JSON.stringify(base));
  write(root, `${twin}/main.js`, "x");
  rejects(root, /claimed by both/, `${twin}/manifest.json`);
  write(root, `${twin}/manifest.json`, JSON.stringify({ ...base, feature: "files/main", files: ["other.js"] }));
  write(root, `${twin}/other.js`, "x");
  rmSync(join(root, twin, "main.js"));
  rejects(root, /already defined/, `${twin}/manifest.json`);
});

const BAD_SHARED = {
  "a shared source is missing": [r => rmSync(join(r, "orca-ui/shared/transcript.js")), /missing source orca-ui\/shared\/transcript\.js/],
  "a shared file is not listed": [r => write(r, "orca-ui/shared/extra.js", "x"), /extra\.js is not listed/],
  "outputs is empty": [r => edit(r, SHARED_MANIFEST, m => { m.files[0].outputs = []; }), /non-empty array/],
  "an output has another name": [r => edit(r, SHARED_MANIFEST, m => { m.files[0].outputs[0] = "mods/orca-changes/other.js"; }), /must be mods\/<mod>\/clip\.js/],
  "a shared output is a feature output": [r => {
    write(r, `${FEATURE}/clip.js`, "x");
    edit(r, MANIFEST, m => m.files.push("clip.js"));
  }, /claimed by both/],
};
for (const [name, [mutate, pattern, path = SHARED_MANIFEST]] of Object.entries(BAD_SHARED)) {
  test(`loader rejects: ${name}`, t => {
    const root = fixture(t);
    mutate(root);
    rejects(root, pattern, path);
  });
}

test("an empty shared manifest is fine; a missing or symlinked orca-ui/shared is an error", t => {
  const root = fixture(t);
  write(root, SHARED_MANIFEST, '{ "files": [] }');
  for (const name of ["clip.js", "transcript.js"]) rmSync(join(root, "orca-ui/shared", name));
  assert.deepEqual(load(root).shared, { files: [] });
  const elsewhere = temp(t);
  write(elsewhere, "manifest.json", '{ "files": [] }');
  rmSync(join(root, "orca-ui/shared"), { recursive: true });
  rejects(root, /does not exist/, SHARED_MANIFEST);
  symlinkSync(elsewhere, join(root, "orca-ui/shared"));
  rejects(root, /symlink or leaves the repo/, SHARED_MANIFEST);
});

test("loader rejects a keys.json that is not an object and a null handwritten list", t => {
  const root = fixture(t);
  write(root, "keys.json", "null");
  rejects(root, /keys\.json must be an object/);
  write(root, "keys.json", "{}");
  edit(root, MANIFEST, m => { m.keys = []; m.handwritten = null; });
  rejects(root, /"handwritten" must be an array/);
});
