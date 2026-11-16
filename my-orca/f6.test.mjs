// F6: the stage base is the last accepted head (state.repo.head), not the HEAD recorded at init. Without an explicit
// base, pushCheck must reject a HEAD that descends from the init HEAD but not from the last accepted one
// (rolled back to an intermediate commit, then force-pushed).
import test from "node:test";
import assert from "node:assert/strict";
import { pushCheck } from "./my-orca.mjs";

test("F6: pushCheck rejects a HEAD that is not a descendant of the last accepted HEAD", () => {
  const state = { repo: { head: "h2", stage_head: "h0" } }; // h2 accepted later; stage_head is the stale init HEAD
  const git = { isAncestor: (base) => base === "h0" }; // the new HEAD (a force-push back to h1) descends from h0 only
  const info = { ok: true, head: "h1", dirty: [], upstream: "origin/feat", ahead: 0, toplevel: "/x" };
  assert.equal(pushCheck(state, info, git).ok, false);
  assert.equal(pushCheck({ repo: { head: "h0" } }, info, git).ok, true);
});
