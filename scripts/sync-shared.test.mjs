import test from "node:test";
import assert from "node:assert/strict";
import { stale, USES } from "./sync-shared.mjs";

test("every copy of a shared helper matches shared/", async () => {
  assert.deepEqual(await stale(), []);
});

test("shared helpers are listed once per mod", () => {
  for (const mods of Object.values(USES)) assert.equal(new Set(mods).size, mods.length);
});
