import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTreeKey, parentIndex } from "./tree-nav.js";

// Visible projection: a folder (open) with one file, a closed folder, then a file.
const rows = [
  { path: "a", dir: true, depth: 0, open: true },
  { path: "a/x", dir: false, depth: 1, open: false },
  { path: "b", dir: true, depth: 0, open: false },
  { path: "c", dir: false, depth: 0, open: false },
];

test("no current row: down starts at the top, up ends at the bottom", () => {
  assert.deepEqual(resolveTreeKey("arrowdown", null, rows), { type: "move", index: 0 });
  assert.deepEqual(resolveTreeKey("arrowup", null, rows), { type: "move", index: 3 });
  assert.deepEqual(resolveTreeKey("end", null, rows), { type: "move", index: 0 });
  assert.deepEqual(resolveTreeKey("a", null, rows), { type: "unhandled" });
});

test("vertical moves clamp at both ends", () => {
  assert.deepEqual(resolveTreeKey("arrowdown", 3, rows), { type: "move", index: 3 });
  assert.deepEqual(resolveTreeKey("arrowup", 0, rows), { type: "move", index: 0 });
  assert.deepEqual(resolveTreeKey("home", 2, rows), { type: "move", index: 0 });
  assert.deepEqual(resolveTreeKey("end", 1, rows), { type: "move", index: 3 });
  assert.deepEqual(resolveTreeKey("pagedown", 0, rows), { type: "move", index: 1 });
  assert.deepEqual(resolveTreeKey("pageup", 0, rows), { type: "move", index: 0 });
});

test("right expands a closed folder, enters an open one, and stays on a file", () => {
  assert.deepEqual(resolveTreeKey("arrowright", 2, rows), { type: "expand", index: 2, path: "b" });
  assert.deepEqual(resolveTreeKey("arrowright", 0, rows), { type: "move", index: 1 });
  assert.deepEqual(resolveTreeKey("arrowright", 3, rows), { type: "move", index: 3 });
  const lastOpen = [{ path: "a", dir: true, depth: 0, open: true }];
  assert.deepEqual(resolveTreeKey("arrowright", 0, lastOpen), { type: "move", index: 0 });
});

test("left collapses an open folder, else jumps to the parent", () => {
  assert.deepEqual(resolveTreeKey("arrowleft", 0, rows), { type: "collapse", index: 0, path: "a" });
  assert.deepEqual(resolveTreeKey("arrowleft", 1, rows), { type: "move", index: 0 });
  assert.deepEqual(resolveTreeKey("arrowleft", 3, rows), { type: "move", index: 3 });
  assert.equal(parentIndex(rows, 1), 0);
  assert.equal(parentIndex(rows, 0), null);
});

test("an empty tree and unknown keys do nothing", () => {
  assert.deepEqual(resolveTreeKey("arrowdown", 0, []), { type: "none" });
  assert.deepEqual(resolveTreeKey("enter", 0, rows), { type: "unhandled" });
});
