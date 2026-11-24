import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ROOT, ManifestError, loadManifests } from "./orca-ui-manifests.mjs";
import { features } from "../orca-ui/app.mjs";
import { FEATURE, edit, fixture, write } from "./orca-ui-fixture.mjs";

const MANIFEST = `${FEATURE}/manifest.json`;
const USES = { "clip.js": ["orca-files", "orca-handoff"], "transcript.js": ["orca-handoff"] };
const load = root => loadManifests({ root, uses: USES });
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
  return Promise.all(found.map(async f => [`orca-ui/features/${f}`,
    (await import(pathToFileURL(join(dir, f)).href, { with: { type: "json" } })).default]));
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
  assert.match(registryProblems([entry, entry], discovered, ROOT)[0], /registered 2 times/);
  assert.match(registryProblems([entry, { ...entry, manifest: { feature: "ghost" } }], discovered, ROOT)[0], /not on disk/);
  assert.match(registryProblems([{ ...entry, next: ["nope.js"] }], discovered, ROOT)[0], /does not exist/);
});

test("the real repo loads and every managed destination is under its mod", () => {
  const { table, features: loaded, shared } = loadManifests({ uses: {} });
  assert.equal(shared, null);
  assert.deepEqual([...loaded.keys()], ["orca-ui/features/panel/head/manifest.json"]);
  assert.equal(table.size, 12);
  for (const dest of table.keys()) assert.match(dest, /^mods\/orca-panel-head\/[^/]+$/);
});

test("the table maps each destination to its source, mode, tests and slots", t => {
  const root = fixture(t);
  write(root, `${FEATURE}/.DS_Store`, "junk");
  const { table, features: loaded } = load(root);
  assert.deepEqual([...loaded.keys()], [MANIFEST]);
  assert.deepEqual([...table.keys()].sort(), [
    "mods/orca-files/clip.js", "mods/orca-files/icons/a.svg", "mods/orca-files/main.js", "mods/orca-files/mod.json",
    "mods/orca-files/tool.sh", "mods/orca-files/view.js", "mods/orca-handoff/clip.js", "mods/orca-handoff/transcript.js"]);
  assert.deepEqual(table.get("mods/orca-files/icons/a.svg"), { kind: "feature", id: "files/main", source: `${FEATURE}/icons/a.svg`,
    mode: 0o644, consumers: ["orca-files"], tests: [`${FEATURE}/view.test.js`, `${FEATURE}/fixture/data.json`], layoutSlots: { orca: ["list"] } });
  assert.equal(table.get("mods/orca-files/tool.sh").mode, 0o755);
  // A shared row carries the consumer feature's tests and slots; a consumer without one gets none.
  assert.deepEqual(table.get("mods/orca-files/clip.js"), { kind: "shared", id: "clip.js", source: "shared/clip.js", mode: 0o644,
    consumers: ["orca-files", "orca-handoff"], tests: [`${FEATURE}/view.test.js`, `${FEATURE}/fixture/data.json`], layoutSlots: { orca: ["list"] } });
  assert.deepEqual(table.get("mods/orca-handoff/clip.js").tests, []);
  assert.deepEqual(table.get("mods/orca-handoff/clip.js").layoutSlots, {});
});

const BAD = {
  "a declared file is missing": [r => rmSync(join(r, FEATURE, "view.js")), /missing source/],
  "a source file is not listed": [r => write(r, `${FEATURE}/notes.md`, "x"), /notes\.md is not listed/],
  "a nested file is not listed": [r => write(r, `${FEATURE}/icons/b.svg`, "x"), /icons\/b\.svg is not listed/],
  "a file is declared twice": [r => edit(r, MANIFEST, m => m.files.push("main.js")), /declared twice/],
  "a test repeats a file": [r => edit(r, MANIFEST, m => m.tests.push("main.js")), /declared twice/],
  "files has the wrong type": [r => edit(r, MANIFEST, m => { m.files = "main.js"; }), /"files" must be an array/],
  "layoutSlots has the wrong type": [r => edit(r, MANIFEST, m => { m.layoutSlots.orca = "list"; }), /"layoutSlots"/],
  "a path leaves the source folder": [r => edit(r, MANIFEST, m => m.files.push("../x.js")), /not a path inside/],
  "a declared source is a directory": [r => edit(r, MANIFEST, m => m.files.push("icons")), /not a regular file/],
  "a declared source is a symlink": [r => { rmSync(join(r, FEATURE, "view.js")); symlinkSync(join(r, FEATURE, "main.js"), join(r, FEATURE, "view.js")); }, /not a regular file/],
  "a symlinked folder points at another source": [r => {
    mkdirSync(join(r, "orca-ui/features/other"), { recursive: true });
    write(r, "orca-ui/features/other/leak.js", "x");
    rmSync(join(r, FEATURE, "icons"), { recursive: true });
    symlinkSync(join(r, "orca-ui/features/other"), join(r, FEATURE, "icons"));
    edit(r, MANIFEST, m => { m.files = m.files.map(f => (f === "icons/a.svg" ? "icons/leak.js" : f)); });
  }, /outside the source folder/],
  "an unknown field is present": [r => edit(r, MANIFEST, m => { m.commands = []; }), /unknown field "commands"/],
  "output is not the mod folder": [r => edit(r, MANIFEST, m => { m.output = "mods/elsewhere"; }), /"output" must be mods\/orca-files/],
  "the mod is a path": [r => edit(r, MANIFEST, m => { m.mod = "a/b"; }), /one folder name/],
  "the output is a Herdr reserved file": [r => {
    write(r, `${FEATURE}/jsconfig.json`, "{}");
    edit(r, MANIFEST, m => m.files.push("jsconfig.json"));
  }, /reserved/],
  "handwritten claims a feature output": [r => edit(r, MANIFEST, m => m.handwritten.push("main.js")), /claimed by both/],
  "handwritten claims a shared copy": [r => edit(r, MANIFEST, m => m.handwritten.push("clip.js")), /claimed by both/],
  "handwritten leaves the mod": [r => edit(r, MANIFEST, m => m.handwritten.push("../x.js")), /not a path inside the mod/],
  "a slot id is missing from the layout": [r => edit(r, MANIFEST, m => { m.layoutSlots.orca = ["nope"]; }), /has 0 nodes with id "nope"/],
  "a slot id repeats in the layout": [r => write(r, "layouts/orca.json", JSON.stringify({ id: "root", children: [{ id: "list", content: { mod: "orca-files" } }, [{ id: "list", content: { mod: "orca-files" } }]] })), /2 nodes with id "list"/],
  "a slot mounts another mod": [r => write(r, "layouts/orca.json", JSON.stringify({ id: "list", content: { mod: "other" } })), /does not mount mod orca-files/],
  "a layout file is missing": [r => edit(r, MANIFEST, m => { m.layoutSlots.ghost = ["list"]; }), /cannot read layouts\/ghost\.json/],
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

test("loader rejects a feature output that collides with a shared copy", t => {
  const root = fixture(t);
  write(root, `${FEATURE}/clip.js`, "x");
  edit(root, MANIFEST, m => m.files.push("clip.js"));
  rejects(root, /claimed by both/);
});

test("loader rejects a shared source that is missing", t => {
  const root = fixture(t);
  rmSync(join(root, "shared/transcript.js"));
  rejects(root, /missing shared source/, "shared/transcript.js");
});
