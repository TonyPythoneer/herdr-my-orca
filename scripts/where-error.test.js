import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { locate } from "./where-error.mjs";

// Frames copied from real `herdr-app check` output (herdr-app 0.1.17).
const RENDER = `ORCA_PROBE_R
    at panelFrame (/tmp/x/mods/orca-panel-gap/panel-motion.js?v=1:22:13)
    at render (/tmp/x/mods/orca-panel-gap/main.js?v=1:40:37)`;

test("a shared helper copy points at the same line in shared/, an unmigrated mod stays in place", () => {
  const [helper, entry] = locate(RENDER);
  assert.equal(helper.edit, "shared/panel-motion.js:22:13");
  assert.match(helper.note, /orca-agents/);
  assert.equal(entry.edit, "mods/orca-panel-gap/main.js:40:37");
  assert.match(entry.note, /not in app\.mjs/);
});

test("a migrated feature points at its orca-ui source and its app.mjs entry", () => {
  const [hit] = locate("at <anonymous> (/Users/u/.config/herdr-app/mods/orca-panel-head/panel-views.js?v=1:12:3)");
  assert.equal(hit.edit, "orca-ui/features/panel/head/panel-views.js:12:3");
  assert.match(hit.note, /feature "panel\/head"/);
  assert.match(hit.note, /panel-views\.test\.js/);
});

test("the CLI reads stdin and fails when there is no frame", () => {
  const script = fileURLToPath(new URL("./where-error.mjs", import.meta.url));
  const ok = spawnSync(process.execPath, [script], { input: RENDER, encoding: "utf8" });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /^shared\/panel-motion\.js:22:13$/m);
  assert.equal(spawnSync(process.execPath, [script, "no frame here"], { encoding: "utf8" }).status, 1);
});
