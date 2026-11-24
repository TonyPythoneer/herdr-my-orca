// Specification of the manifest shape checks in orca-ui-manifests.mjs: each message the loader
// gives for a malformed feature manifest or shared-helper entry, and the order checks run in.
import test from "node:test";
import assert from "node:assert/strict";
import { ManifestError, loadManifests } from "./orca-ui-manifests.mjs";
import { FEATURE, edit, fixture, write } from "./orca-ui-fixture.mjs";

const MANIFEST = `${FEATURE}/manifest.json`;
const SHARED_MANIFEST = "orca-ui/shared/manifest.json";
const rejects = (root, message, path) =>
  assert.throws(() => loadManifests({ root }), error => error instanceof ManifestError && error.path === path && error.message === message);

const FEATURE_CASES = {
  "a manifest that is not an object": [r => write(r, MANIFEST, "[]"), "manifest must be an object"],
  "a null manifest": [r => write(r, MANIFEST, "null"), "manifest must be an object"],
  "an unknown field": [r => edit(r, MANIFEST, m => { m.extra = 1; }), 'unknown field "extra"'],
  "a missing tests list": [r => edit(r, MANIFEST, m => { delete m.tests; }), 'missing "tests"'],
  "a missing layoutSlots": [r => edit(r, MANIFEST, m => { delete m.layoutSlots; }), 'missing "layoutSlots"'],
  "an empty feature name": [r => edit(r, MANIFEST, m => { m.feature = ""; }), '"feature" must be a non-empty string'],
  "a numeric feature name": [r => edit(r, MANIFEST, m => { m.feature = 5; }), '"feature" must be a non-empty string'],
  "a mod name with a slash": [r => edit(r, MANIFEST, m => { m.mod = "a/b"; }), '"mod" must be one folder name'],
  "a mod name that starts with a dot": [r => edit(r, MANIFEST, m => { m.mod = ".x"; }), '"mod" must be one folder name'],
  "a numeric mod name": [r => edit(r, MANIFEST, m => { m.mod = 5; }), '"mod" must be one folder name'],
  "a source that is not the manifest's folder": [r => edit(r, MANIFEST, m => { m.source = "elsewhere"; }), `"source" must be ${FEATURE}`],
  "an output that is not mods/<mod>": [r => edit(r, MANIFEST, m => { m.output = "mods/other"; }), '"output" must be mods/orca-files'],
  "files that are not a list": [r => edit(r, MANIFEST, m => { m.files = "main.js"; }), '"files" must be an array of strings'],
  "a non-string in files": [r => edit(r, MANIFEST, m => { m.files.push(7); }), '"files" must be an array of strings'],
  "handwritten that is not a list": [r => edit(r, MANIFEST, m => { m.handwritten = null; }), '"handwritten" must be an array of strings'],
  "tests that are not a list": [r => edit(r, MANIFEST, m => { m.tests = {}; }), '"tests" must be an array of strings'],
  "keys that are not a list": [r => edit(r, MANIFEST, m => { m.keys = "layout:orca"; }), '"keys" must be an array of strings'],
  "layoutSlots that is a list": [r => edit(r, MANIFEST, m => { m.layoutSlots = []; }), '"layoutSlots" must map layout names to arrays of ids'],
  "layoutSlots that is null": [r => edit(r, MANIFEST, m => { m.layoutSlots = null; }), '"layoutSlots" must map layout names to arrays of ids'],
  "a layoutSlots value that is not a list of strings": [r => edit(r, MANIFEST, m => { m.layoutSlots.orca = [3]; }), '"layoutSlots" must map layout names to arrays of ids'],
  "a handwritten path that leaves the mod": [r => edit(r, MANIFEST, m => { m.handwritten = ["../x.js"]; }), 'handwritten entry "../x.js" is not a path inside the mod'],
  "an absolute handwritten path": [r => edit(r, MANIFEST, m => { m.handwritten = ["/x.js"]; }), 'handwritten entry "/x.js" is not a path inside the mod'],
  "a handwritten path with a backslash": [r => edit(r, MANIFEST, m => { m.handwritten = ["a\\b.js"]; }), 'handwritten entry "a\\b.js" is not a path inside the mod'],
  "an empty handwritten path": [r => edit(r, MANIFEST, m => { m.handwritten = [""]; }), 'handwritten entry "" is not a path inside the mod'],
  "a handwritten path that is a folder": [r => edit(r, MANIFEST, m => { m.handwritten = ["sub/"]; }), 'handwritten entry "sub/" is not a path inside the mod'],
  "a handwritten path of dots": [r => edit(r, MANIFEST, m => { m.handwritten = ["."]; }), 'handwritten entry "." is not a path inside the mod'],
};
for (const [name, [mutate, message]] of Object.entries(FEATURE_CASES)) {
  test(`feature shape rejects ${name}`, t => {
    const root = fixture(t);
    mutate(root);
    rejects(root, message, MANIFEST);
  });
}

test("feature shape: fields are checked before values, and a missing handwritten list means none", t => {
  const root = fixture(t);
  edit(root, MANIFEST, m => { m.extra = 1; m.feature = ""; });
  rejects(root, 'unknown field "extra"', MANIFEST);
  const second = fixture(t);
  edit(second, MANIFEST, m => { delete m.handwritten; delete m.tests; });
  rejects(second, 'missing "tests"', MANIFEST);
  const third = fixture(t);
  edit(third, MANIFEST, m => { delete m.handwritten; });
  assert.deepEqual(loadManifests({ root: third }).features.get(MANIFEST).handwritten, []);
});

const SHARED_CASES = {
  "a shared manifest that is not { files }": [r => edit(r, SHARED_MANIFEST, m => { m.extra = 1; }), 'manifest must be { "files": [...] }'],
  "a files value that is not a list": [r => write(r, SHARED_MANIFEST, '{"files":{}}'), 'manifest must be { "files": [...] }'],
  "an item that is not an object": [r => edit(r, SHARED_MANIFEST, m => { m.files.push(null); }), "each file needs only source and outputs"],
  "an item with an extra key": [r => edit(r, SHARED_MANIFEST, m => { m.files[0].note = "x"; }), "each file needs only source and outputs"],
  "a source outside orca-ui/shared": [r => edit(r, SHARED_MANIFEST, m => { m.files[0].source = "elsewhere/clip.js"; }), 'source "elsewhere/clip.js" must be orca-ui/shared/<name>.js'],
  "a source that is not a string": [r => edit(r, SHARED_MANIFEST, m => { m.files[0].source = 5; }), 'source "5" must be orca-ui/shared/<name>.js'],
  "a source that is not a .js file": [r => edit(r, SHARED_MANIFEST, m => { m.files[0].source = "orca-ui/shared/clip.txt"; }), 'source "orca-ui/shared/clip.txt" must be orca-ui/shared/<name>.js'],
  "a source in a subfolder": [r => edit(r, SHARED_MANIFEST, m => { m.files[0].source = "orca-ui/shared/sub/clip.js"; }), 'source "orca-ui/shared/sub/clip.js" must be orca-ui/shared/<name>.js'],
  "a source declared twice": [r => edit(r, SHARED_MANIFEST, m => { m.files.push({ source: m.files[0].source, outputs: ["mods/orca-files/other.js"] }); }), "source orca-ui/shared/clip.js is declared twice"],
  "outputs that are not a list": [r => edit(r, SHARED_MANIFEST, m => { m.files[0].outputs = "mods/orca-files/clip.js"; }), 'orca-ui/shared/clip.js: "outputs" must be a non-empty array of strings'],
  "an output that is not a string": [r => edit(r, SHARED_MANIFEST, m => { m.files[0].outputs.push(4); }), 'orca-ui/shared/clip.js: "outputs" must be a non-empty array of strings'],
  "an output in a subfolder": [r => edit(r, SHARED_MANIFEST, m => { m.files[0].outputs[0] = "mods/orca-files/sub/clip.js"; }), 'output "mods/orca-files/sub/clip.js" must be mods/<mod>/clip.js'],
  "an output outside mods": [r => edit(r, SHARED_MANIFEST, m => { m.files[0].outputs[0] = "other/orca-files/clip.js"; }), 'output "other/orca-files/clip.js" must be mods/<mod>/clip.js'],
  "an output listed twice": [r => edit(r, SHARED_MANIFEST, m => { m.files[0].outputs.push(m.files[0].outputs[0]); }), "output mods/orca-changes/clip.js is declared twice"],
  "an output in a mod without mod.json": [r => edit(r, SHARED_MANIFEST, m => { m.files[0].outputs.push("mods/nothing/clip.js"); }), "output mods/nothing/clip.js: mods/nothing has no mod.json, check the mod name"],
};
for (const [name, [mutate, message]] of Object.entries(SHARED_CASES)) {
  test(`shared shape rejects ${name}`, t => {
    const root = fixture(t);
    mutate(root);
    rejects(root, message, SHARED_MANIFEST);
  });
}

test("shared shape: a source name may use dots, dashes and underscores", t => {
  const root = fixture(t);
  write(root, "orca-ui/shared/a_b-c.d.js", "x\n");
  write(root, "mods/orca-context-menu/mod.json", "{}\n");
  edit(root, SHARED_MANIFEST, m => { m.files.push({ source: "orca-ui/shared/a_b-c.d.js", outputs: ["mods/orca-context-menu/a_b-c.d.js"] }); });
  assert.ok(loadManifests({ root }).table.has("mods/orca-context-menu/a_b-c.d.js"));
});
