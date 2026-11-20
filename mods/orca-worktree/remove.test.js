import { test } from "node:test";
import assert from "node:assert/strict";
import { removeWorktree, REMOVE_UNAVAILABLE } from "./remove.js";

test("worktree removal remains unavailable and never invokes Git", async () => {
  let called = false;
  await assert.rejects(removeWorktree({}, {}, async () => { called = true; }, () => true), { message: REMOVE_UNAVAILABLE });
  assert.equal(called, false);
});
