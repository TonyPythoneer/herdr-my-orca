import test from "node:test";
import assert from "node:assert/strict";
import { RAIL, railGeometry, railViewport, railRows, railControl } from "./agent-rail.js";

test("global and every agent indicator are centered on the circular avatar", () => {
  for (const offset of [0, 60, 120, 330, -180]) {
    for (const [selected, hovered] of [[true,false],[false,true],[true,true]]) {
      const g = railGeometry(selected, hovered);
      assert.equal(offset + g.avatarTop + RAIL.avatar / 2, offset + g.indicatorTop + g.indicatorHeight / 2);
      assert.equal(g.indicatorLeft, 0);
      assert.equal(g.avatarLeft + RAIL.avatar / 2, RAIL.width / 2);
    }
  }
  assert.equal(railGeometry().indicatorHeight, 0);
  assert.equal(railGeometry(true).indicatorTop, 10);
});
test("each group caps independently at five and a half rows", () => {
  for (const count of [0,1,5,6,22]) assert.deepEqual(railViewport(count), {
    height: count <= 5 ? count * 60 : 330, scroll: count > 5,
  });
});
test("installed first, stable when toggling, no switch for missing CLI", () => {
  const rows = [{key:"a",installed:false},{key:"b",installed:true,enabled:false},{key:"c",installed:true,enabled:true}];
  assert.deepEqual(railRows(rows).map(r=>r.key), ["b","c","a"]);
  rows[1].enabled=true;
  assert.deepEqual(railRows(rows).map(r=>r.key), ["b","c","a"]);
  assert.deepEqual(railControl(rows[0]), {kind:"install"});
  assert.deepEqual(railControl(rows[1]), {kind:"switch",checked:true});
  rows[1].enabled=false;
  assert.deepEqual(railControl(rows[1]), {kind:"switch",checked:false});
});
