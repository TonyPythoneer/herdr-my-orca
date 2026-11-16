// E12: after a Herdr restart the core id changes; the run is rebound only when no dispatch is in flight.
import test from "node:test";
import assert from "node:assert/strict";
import { rebindCore } from "./my-orca.mjs";

test("E12: no dispatch -> adopt the new core id", () => {
  const s = { core_id: "old", dispatch: null };
  assert.equal(rebindCore(s, "new"), true);
  assert.equal(s.core_id, "new");
});

test("E12: dispatch in flight -> keep the old core id", () => {
  const s = { core_id: "old", dispatch: { id: "d1" } };
  assert.equal(rebindCore(s, "new"), false);
  assert.equal(s.core_id, "old");
});

test("E12: same core id -> nothing to write", () => {
  assert.equal(rebindCore({ core_id: "c", dispatch: null }, "c"), false);
});
