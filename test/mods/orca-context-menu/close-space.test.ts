import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import { closeRows } from "../../../src/mods/orca-context-menu/close-space.js";

it("one space closes with confirmed, which the host requires", () => {
  assert.deepEqual(closeRows(["w1"]), [
    ["Close workspace", "space.close", { id: "w1", confirmed: true }],
  ]);
});

it("the card menu label is Close", () => {
  assert.deepEqual(closeRows(["w1"], "Close"), [
    ["Close", "space.close", { id: "w1", confirmed: true }],
  ]);
});

it("several spaces close as a group in one command", () => {
  const rows = closeRows(["w1", "w2"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1], "orca-context-menu.close-group");
  assert.deepEqual(rows[0][2], { ids: ["w1", "w2"] });
});

it("no space draws no row", () => {
  assert.deepEqual(closeRows([]), []);
  assert.deepEqual(closeRows(undefined), []);
  assert.deepEqual(closeRows([null]), []);
});

it("a repeated id closes once", () => {
  assert.deepEqual(closeRows(["w1", "w1"]), [
    ["Close workspace", "space.close", { id: "w1", confirmed: true }],
  ]);
});
