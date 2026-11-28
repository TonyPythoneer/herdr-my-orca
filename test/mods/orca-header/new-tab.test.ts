import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { newTabArgs } from "../../../src/mods/orca-header/new-tab.js";

test("a space with a folder pins the tab to it", () => {
  assert.deepEqual(newTabArgs({ id: "s1", folder: "/repo/wt" }), {
    space: "s1",
    folder: "/repo/wt",
  });
});

test("a space with no folder keeps the host default", () => {
  assert.deepEqual(newTabArgs({ id: "s1", folder: "" }), { space: "s1" });
  assert.deepEqual(newTabArgs({ id: "s1" }), { space: "s1" });
});

test("no shown space gives no arguments", () => {
  assert.deepEqual(newTabArgs(undefined), {});
  assert.deepEqual(newTabArgs(null), {});
  assert.deepEqual(newTabArgs({ folder: "/repo/wt" }), {});
});
