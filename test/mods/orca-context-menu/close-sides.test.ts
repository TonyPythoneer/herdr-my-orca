import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import { closeSideTabs } from "../../../src/mods/orca-context-menu/close-sides.js";

const owner = { tabs: [{ id: "a" }, { id: "b" }, { id: "c", settled: true }, { id: "d" }] };

it("right closes the tabs after the target, left the ones before it", () => {
  assert.deepEqual(closeSideTabs(owner, "b", "right"), ["d"]);
  assert.deepEqual(closeSideTabs(owner, "b", "left"), ["a"]);
});

it("pinned tabs are left open on either side", () => {
  assert.deepEqual(closeSideTabs(owner, "d", "left"), ["a", "b"]);
  assert.deepEqual(closeSideTabs(owner, "a", "right"), ["b", "d"]);
});

it("the first and last tab have no row on the empty side", () => {
  assert.deepEqual(closeSideTabs(owner, "a", "left"), []);
  assert.deepEqual(closeSideTabs(owner, "d", "right"), []);

  assert.deepEqual(
    closeSideTabs({ tabs: [{ id: "a" }, { id: "b", settled: true }] }, "a", "right"),
    [],
  );
});

it("a tab that is not in the list closes nothing", () => {
  assert.deepEqual(closeSideTabs(owner, "gone", "right"), []);
  assert.deepEqual(closeSideTabs(undefined, "a", "right"), []);
});
