import test from "node:test";
import assert from "node:assert/strict";
import { openSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadManifests } from "./orca-ui-manifests.mjs";
import { locate } from "./where-error.mjs";
import { FEATURE, edit, fixture, write, withScripts } from "./orca-ui-fixture.mjs";

const table = loadManifests().table;

// Frames copied from real `herdr-app check` output (herdr-app 0.1.17).
const RENDER = `ORCA_PROBE_R
    at panelFrame (/tmp/x/mods/orca-panel-gap/panel-motion.js?v=1:22:13)
    at render (/tmp/x/mods/orca-panel-gap/main.js?v=1:40:37)`;

test("a shared helper copy points at the same line in orca-ui/shared/, an unmigrated mod stays in place", () => {
  const [helper, entry] = locate(RENDER, table);
  assert.equal(helper.edit, "orca-ui/shared/panel-motion.js:22:13");
  assert.equal(helper.kind, "shared");
  assert.match(helper.note, /orca-agents/);
  assert.equal(helper.note, "shared helper, copied into orca-files, orca-changes, orca-agents, orca-panel-gap");
  assert.equal(entry.edit, "mods/orca-panel-gap/main.js:40:37");
  assert.equal(entry.kind, "in-place");
  assert.match(entry.note, /not in app\.mjs/);
});

test("a migrated feature points at its orca-ui source and its app.mjs entry", async () => {
  const { features } = await import("../orca-ui/app.mjs");
  const [hit] = locate("at <anonymous> (/Users/u/.config/herdr-app/mods/orca-panel-head/panel-views.js?v=1:12:3)", table, { features });
  assert.equal(hit.edit, "orca-ui/features/panel/head/panel-views.js:12:3");
  assert.equal(hit.kind, "feature");
  assert.match(hit.note, /feature "panel\/head"/);
  assert.match(hit.note, /panel-views\.test\.js/);
  assert.match(hit.note, /layouts orca#panel-head;/);
  assert.match(hit.note, /next mods\/orca-files\/main\.js$/);
});

test("the CLI reads stdin and fails when there is no frame", () => {
  const script = fileURLToPath(new URL("./where-error.mjs", import.meta.url));
  const ok = spawnSync(process.execPath, [script], { input: RENDER, encoding: "utf8" });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /^orca-ui\/shared\/panel-motion\.js:22:13$/m);
  assert.equal(spawnSync(process.execPath, [script, "no frame here"], { encoding: "utf8" }).status, 1);
});

// The CLI runs from a copy inside a fixture repo, so its ROOT is the fixture.
function cli(t, { app = false } = {}) {
  const root = fixture(t);
  const script = withScripts(root);
  if (app) {
    write(root, "orca-ui/app.mjs", `import m from "./features/files/main/manifest.json" with { type: "json" };
export const features = [{ manifest: m, area: "files", description: "d", next: ["mods/orca-panel-gap/main.js"] },
  { manifest: {}, area: "shared", description: "s", next: ["mods/orca-panel-gap/mod.json"] }];`);
  }
  return { root, run: (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" }) };
}

const MIXED = [
  "at a (/abs/mods/orca-files/view.js?v=3:7:5)",
  "at b (/abs/mods/orca-files/icons/a.svg:2)",
  "at c (/abs/mods/orca-files/clip.js?v=1:9:2)",
  "at d (/abs/mods/orca-handoff/transcript.js:4)",
  "at e (/abs/mods/orca-panel-gap/main.js:11:3)",
  "at f (/abs/mods/nowhere/main.js:1:1)",
  "at g (/abs/mods/orca-panel-gap/gone.js:1)",
  "at h (/abs/mods/orca-files/view.js?v=3:7:5)",
  "at i (/abs/mods/orca-files/view.js:0:4)",
  "at j (/abs/mods/orca-files/../../etc/passwd:5)",
].join("\n");

test("CLI prints the four two-line shapes, with next, in input order, via argv and stdin", t => {
  const { run } = cli(t, { app: true });
  const slots = "layouts orca#list";
  const tests = `tests ${FEATURE}/view.test.js, ${FEATURE}/fixture/data.json`;
  const expected = [
    `${FEATURE}/view.js:7:5`, `  from mods/orca-files/view.js:7:5; feature "files/main"; ${tests}; ${slots}; next mods/orca-panel-gap/main.js`,
    `${FEATURE}/icons/a.svg:2`, `  from mods/orca-files/icons/a.svg:2; feature "files/main"; ${tests}; ${slots}; next mods/orca-panel-gap/main.js`,
    "orca-ui/shared/clip.js:9:2", `  from mods/orca-files/clip.js:9:2; shared helper, copied into orca-changes, orca-files, orca-handoff, orca-menu; ${tests}; ${slots}; next mods/orca-panel-gap/mod.json`,
    "orca-ui/shared/transcript.js:4", "  from mods/orca-handoff/transcript.js:4; shared helper, copied into orca-handoff, orca-menu; next mods/orca-panel-gap/mod.json",
    "mods/orca-panel-gap/main.js:11:3", "  from mods/orca-panel-gap/main.js:11:3; not in app.mjs yet: edit this file in place",
    "mods/nowhere/main.js:1:1", "  from mods/nowhere/main.js:1:1; unknown path: no such mod in this repo",
    "mods/orca-panel-gap/gone.js:1", "  from mods/orca-panel-gap/gone.js:1; unknown path: no such mod in this repo",
    `${FEATURE}/view.js:7:5`, `  from mods/orca-files/view.js:7:5; feature "files/main"; ${tests}; ${slots}; next mods/orca-panel-gap/main.js`,
    "mods/orca-files/../../etc/passwd:5", "  from mods/orca-files/../../etc/passwd:5; unknown path: no such mod in this repo",
  ].join("\n") + "\n";
  const viaArgv = run(MIXED);
  assert.equal(viaArgv.status, 0);
  assert.equal(viaArgv.stdout, expected);
});

test("CLI gives the same answer from stdin, and leaves out next without app.mjs or with a broken one", t => {
  const { root, run } = cli(t, { app: true });
  const script = join(root, "scripts/where-error.mjs");
  const stdin = spawnSync(process.execPath, [script], { input: MIXED, encoding: "utf8" });
  assert.equal(stdin.stdout, run(MIXED).stdout);
  assert.match(stdin.stdout, /next /);

  write(root, "orca-ui/app.mjs", "export const features = ;");
  assert.doesNotMatch(run(MIXED).stdout, /next /);
  assert.equal(run(MIXED).status, 0);
  rmSync(join(root, "orca-ui/app.mjs"));
  const bare = run(MIXED);
  assert.equal(bare.status, 0);
  assert.doesNotMatch(bare.stdout, /next /);
  assert.match(bare.stdout, /^orca-ui\/features\/files\/main\/view\.js:7:5$/m);
});

test("CLI exit codes and stderr: no frame, broken manifests, unreadable input", t => {
  const { root, run } = cli(t);
  const none = run("nothing mods/ here", "or line 0 mods/orca-files/view.js:0");
  assert.equal(none.status, 1);
  assert.equal(none.stderr, "no mods/<mod>/<file>:<line> frame found in the input\n");

  const dir = openSync(root, "r");
  const unreadable = spawnSync(process.execPath, [join(root, "scripts/where-error.mjs")], { stdio: [dir, "pipe", "pipe"], encoding: "utf8" });
  assert.equal(unreadable.status, 2);
  assert.match(unreadable.stderr, /^cannot read input: /);

  edit(root, `${FEATURE}/manifest.json`, m => m.files.push("clip.js"));
  write(root, `${FEATURE}/clip.js`, "x");
  const broken = run("mods/orca-files/view.js:1");
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /^orca-ui\/shared\/manifest\.json: .*claimed by both/);
});

test("the last mods/ in a path is the frame, so a prefix containing mods/ still resolves", () => {
  const [hit] = locate("at x (/data/mods/u/.config/herdr-app/mods/orca-panel-head/main.js?v=1:3:1)", table);
  assert.equal(hit.edit, "orca-ui/features/panel/head/main.js:3:1");
  assert.equal(hit.frame, "mods/orca-panel-head/main.js:3:1");
  assert.equal(locate("mods/orca-panel-head/main.js:1 /p/mods/orca-panel-gap/main.js:2", table).length, 2);
});

test("an in-place mod with an app.mjs entry gets its tests, layouts and next in the hint", async () => {
  const { features, inPlace } = await import("../orca-ui/app.mjs");
  const [hit] = locate("at r (/p/mods/orca-panel-gap/main.js:40:37)", table, { features, inPlace });
  assert.equal(hit.kind, "in-place");
  assert.equal(hit.edit, "mods/orca-panel-gap/main.js:40:37");
  assert.match(hit.note, /^edit this file in place; mod "orca-panel-gap" is in app\.mjs; tests mods\/orca-panel-gap\/panel-motion\.test\.js; layouts orca#workspaces,/);
  const [chrome] = locate("at r (/p/mods/orca-chrome/runner.js:9)", table, { features, inPlace });
  assert.match(chrome.note, /next mods\/orca-chrome\/runner\.js, mods\/orca-tasks\/main\.js$/);
});

test("an in-place file that is a symlink out of its mod is reported as unknown, not as an edit target", t => {
  const { root, run } = cli(t);
  write(root, "outside.js", "x");
  symlinkSync(join(root, "outside.js"), join(root, "mods/orca-panel-gap/link.js"));
  const r = run("mods/orca-panel-gap/link.js:1");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /unknown path/);
});

test("a symlinked folder inside a mod is not an in-place edit target", t => {
  const { root, run } = cli(t);
  write(root, "elsewhere/x.js", "x");
  symlinkSync(join(root, "elsewhere"), join(root, "mods/orca-panel-gap/lib"));
  assert.match(run("mods/orca-panel-gap/lib/x.js:1").stdout, /unknown path/);
});
