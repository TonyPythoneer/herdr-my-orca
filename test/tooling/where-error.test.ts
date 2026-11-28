import { afterEach, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { openSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadManifests } from "../../src/tooling/orca-ui-manifests.ts";
import { locate } from "../../src/tooling/where-error.ts";
import { FEATURE, edit, fixture, write } from "../helpers/orca-ui-fixture.ts";

const table = loadManifests().table;
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(ROOT, "src/tooling/where-error.ts");
const VPX = process.env.VPX_BIN ?? join(ROOT, "node_modules/.bin/vpx");
const envFor = (root: string) => ({ ...process.env, ORCA_UI_ROOT: root });
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const context = {
  after: (cleanup: () => void): void => {
    cleanups.push(cleanup);
  },
};

const RENDER = `ORCA_PROBE_R
    at panelFrame (/tmp/x/mods/orca-right-sidebar-placeholders/panel-motion.js?v=1:22:13)
    at render (/tmp/x/mods/orca-right-sidebar-placeholders/main.js?v=1:40:37)`;

it("TypeScript generated entries and shared copies omit unmapped runtime coordinates", () => {
  const [helper, entry] = locate(RENDER, table);
  assert.equal(helper.edit, "src/components/right-sidebar/panel-motion.ts");
  assert.equal(helper.kind, "shared");
  assert.match(helper.note, /orca-right-sidebar-agents/);
  assert.equal(
    helper.note,
    "shared helper, copied into orca-files, orca-changes, orca-right-sidebar-agents, orca-right-sidebar-placeholders; runtime frame coordinates are not mapped to the source",
  );
  assert.equal(helper.frame, "mods/orca-right-sidebar-placeholders/panel-motion.js:22:13");
  assert.equal(entry.edit, "src/mods/orca-right-sidebar-placeholders/main.ts");
  assert.equal(entry.kind, "entry");
  assert.equal(
    entry.note,
    "generated entry from src/mods/orca-right-sidebar-placeholders/main.ts; runtime frame coordinates are not mapped to the source",
  );
  assert.equal(entry.frame, "mods/orca-right-sidebar-placeholders/main.js:40:37");
});

it("a migrated header entry points at its TypeScript source", () => {
  const [hit] = locate(
    "at <anonymous> (/Users/u/.config/herdr-app/mods/orca-right-sidebar-header/panel-views.js?v=1:12:3)",
    table,
  );
  assert.equal(hit.edit, "src/mods/orca-right-sidebar-header/panel-views.ts");
  assert.equal(hit.kind, "entry");
  assert.match(
    hit.note,
    /generated entry from src\/mods\/orca-right-sidebar-header\/panel-views\.ts/,
  );
});

it("the CLI reads stdin and fails when there is no frame", () => {
  const frame = "at render (/tmp/mods/orca-right-sidebar-placeholders/gone.js:22:13)";
  const ok = spawnSync(VPX, [SCRIPT], { cwd: ROOT, input: frame, encoding: "utf8" });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /^mods\/orca-right-sidebar-placeholders\/gone\.js:22:13$/m);
  assert.equal(
    spawnSync(VPX, [SCRIPT, "no frame here"], { cwd: ROOT, encoding: "utf8" }).status,
    1,
  );
});

function cli({ app = false } = {}) {
  const root = fixture(context);
  if (app) {
    write(
      root,
      "orca-ui/app.mjs",
      `import m from "./features/files/main/manifest.json" with { type: "json" };
export const features = [{ manifest: m, area: "files", description: "d", next: ["mods/orca-right-sidebar-placeholders/main.js"] },
  { manifest: {}, area: "shared", description: "s", next: ["mods/orca-right-sidebar-placeholders/mod.json"] }];`,
    );
  }
  return {
    root,
    run: (...args: string[]) =>
      spawnSync(VPX, [SCRIPT, ...args], { cwd: root, encoding: "utf8", env: envFor(root) }),
  };
}

const MIXED = [
  "at a (/abs/mods/orca-files/view.js?v=3:7:5)",
  "at b (/abs/mods/orca-files/icons/a.svg:2)",
  "at e (/abs/mods/orca-right-sidebar-placeholders/main.js:11:3)",
  "at f (/abs/mods/nowhere/main.js:1:1)",
  "at g (/abs/mods/orca-right-sidebar-placeholders/gone.js:1)",
  "at h (/abs/mods/orca-files/view.js?v=3:7:5)",
  "at i (/abs/mods/orca-files/view.js:0:4)",
  "at j (/abs/mods/orca-files/../../etc/passwd:5)",
].join("\n");

it("CLI prints the four two-line shapes, with next, in input order, via argv and stdin", () => {
  const { run } = cli({ app: true });
  const slots = "layouts orca#list";
  const tests = `tests ${FEATURE}/view.test.js, ${FEATURE}/fixture/data.json`;
  const expected =
    [
      `${FEATURE}/view.js:7:5`,
      `  from mods/orca-files/view.js:7:5; feature "files/main"; ${tests}; ${slots}; next mods/orca-right-sidebar-placeholders/main.js`,
      `${FEATURE}/icons/a.svg:2`,
      `  from mods/orca-files/icons/a.svg:2; feature "files/main"; ${tests}; ${slots}; next mods/orca-right-sidebar-placeholders/main.js`,
      "mods/orca-right-sidebar-placeholders/main.js:11:3",
      "  from mods/orca-right-sidebar-placeholders/main.js:11:3; not in app.mjs yet: edit this file in place",
      "mods/nowhere/main.js:1:1",
      "  from mods/nowhere/main.js:1:1; unknown path: no such mod in this repo",
      "mods/orca-right-sidebar-placeholders/gone.js:1",
      "  from mods/orca-right-sidebar-placeholders/gone.js:1; unknown path: no such mod in this repo",
      `${FEATURE}/view.js:7:5`,
      `  from mods/orca-files/view.js:7:5; feature "files/main"; ${tests}; ${slots}; next mods/orca-right-sidebar-placeholders/main.js`,
      "mods/orca-files/../../etc/passwd:5",
      "  from mods/orca-files/../../etc/passwd:5; unknown path: no such mod in this repo",
    ].join("\n") + "\n";
  const viaArgv = run(MIXED);
  assert.equal(viaArgv.status, 0);
  assert.equal(viaArgv.stdout, expected);
});

it("CLI gives the same answer from stdin, and leaves out next without app.mjs or with a broken one", () => {
  const { root, run } = cli({ app: true });
  const stdin = spawnSync(VPX, [SCRIPT], {
    cwd: root,
    input: MIXED,
    encoding: "utf8",
    env: envFor(root),
  });
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

it("CLI exit codes and stderr: no frame, broken manifests, unreadable input", () => {
  const { root, run } = cli();
  const none = run("nothing mods/ here", "or line 0 mods/orca-files/view.js:0");
  assert.equal(none.status, 1);
  assert.equal(none.stderr, "no mods/<mod>/<file>:<line> frame found in the input\n");

  const dir = openSync(root, "r");
  const unreadable = spawnSync(VPX, [SCRIPT], {
    cwd: root,
    stdio: [dir, "pipe", "pipe"],
    encoding: "utf8",
    env: envFor(root),
  });
  assert.equal(unreadable.status, 2);
  assert.match(unreadable.stderr, /^cannot read input: /);

  edit(root, `${FEATURE}/manifest.json`, (m) => m.files.push("clip.js"));
  write(root, `${FEATURE}/clip.js`, "x");
  const broken = run("mods/orca-files/view.js:1");
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /^orca-ui\/shared\/manifest\.json: .*claimed by both/);
});

it("the last mods/ in a path is the frame, so a prefix containing mods/ still resolves", () => {
  const [hit] = locate(
    "at x (/data/mods/u/.config/herdr-app/mods/orca-right-sidebar-header/main.js?v=1:3:1)",
    table,
  );
  assert.equal(hit.edit, "src/mods/orca-right-sidebar-header/main.ts");
  assert.equal(hit.frame, "mods/orca-right-sidebar-header/main.js:3:1");
  assert.equal(
    locate(
      "mods/orca-right-sidebar-header/main.js:1 /p/mods/orca-right-sidebar-placeholders/main.js:2",
      table,
    ).length,
    2,
  );
});

it("an in-place mod with an app.mjs entry gets its tests, layouts and next in the hint", async () => {
  const { features, inPlace } = await import("../../orca-ui/app.mjs");
  const [hit] = locate("at r (/p/mods/orca-agent-flyout/main.js:40:37)", table, {
    features,
    inPlace,
  });
  assert.equal(hit.kind, "in-place");
  assert.equal(hit.edit, "mods/orca-agent-flyout/main.js:40:37");
  assert.match(
    hit.note,
    /^edit this file in place; mod "orca-agent-flyout" is in app\.mjs; tests -; layouts -;/,
  );
  const [chrome] = locate("at r (/p/mods/orca-status-bar/main.js:9)", table, {
    features,
    inPlace,
  });
  assert.match(chrome.note, /next mods\/orca-float-workspace\/main\.js$/);
});

it("an in-place file that is a symlink out of its mod is reported as unknown, not as an edit target", () => {
  const { root, run } = cli();
  write(root, "outside.js", "x");
  symlinkSync(join(root, "outside.js"), join(root, "mods/orca-right-sidebar-placeholders/link.js"));
  const r = run("mods/orca-right-sidebar-placeholders/link.js:1");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /unknown path/);
});

it("a symlinked folder inside a mod is not an in-place edit target", () => {
  const { root, run } = cli();
  write(root, "elsewhere/x.js", "x");
  symlinkSync(join(root, "elsewhere"), join(root, "mods/orca-right-sidebar-placeholders/lib"));
  assert.match(run("mods/orca-right-sidebar-placeholders/lib/x.js:1").stdout, /unknown path/);
});
