import test from "node:test";
import assert from "node:assert/strict";
import { railRows } from "./agent-rail.js";

test("installed first, stable when toggling", () => {
  const rows = [{key:"a",installed:false},{key:"b",installed:true,enabled:false},{key:"c",installed:true,enabled:true}];
  assert.deepEqual(railRows(rows).map(r=>r.key), ["b","c","a"]);
  rows[1].enabled=true;
  assert.deepEqual(railRows(rows).map(r=>r.key), ["b","c","a"]);
});
