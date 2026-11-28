import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { removeWorktree, REMOVE_UNAVAILABLE } from "../../../src/mods/orca-worktree/remove.js";

test("worktree removal remains unavailable and never invokes Git", async () => {
  let called = false;
  const legacyRemove: (...args: unknown[]) => Promise<never> = removeWorktree;
  await assert.rejects(
    legacyRemove(
      {},
      {},
      async () => {
        called = true;
      },
      () => true,
    ),
    { message: REMOVE_UNAVAILABLE },
  );
  assert.equal(called, false);
});
