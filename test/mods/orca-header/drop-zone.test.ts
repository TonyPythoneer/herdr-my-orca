import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { edgeZone } from "../../../src/mods/orca-header/drop-zone.js";

const panel = { left: 100, top: 0, width: 1000, height: 600 };

test("the strip is left to reordering", () => {
  assert.equal(edgeZone(panel, { x: 500, y: 10 }, 32), null);
});
test("outer bands pick their edge", () => {
  assert.equal(edgeZone(panel, { x: 110, y: 300 }, 32), "left");
  assert.equal(edgeZone(panel, { x: 1090, y: 300 }, 32), "right");
  assert.equal(edgeZone(panel, { x: 600, y: 40 }, 32), "up");
  assert.equal(edgeZone(panel, { x: 600, y: 590 }, 32), "down");
});
test("the centre goes to the nearest edge, horizontal on a tie", () => {
  assert.equal(edgeZone(panel, { x: 600, y: 316 }, 32), "up");
  assert.equal(edgeZone(panel, { x: 330, y: 316 }, 32), "left");
  assert.equal(edgeZone({ ...panel, height: 32 }, { x: 600, y: 40 }, 32), null);
});
