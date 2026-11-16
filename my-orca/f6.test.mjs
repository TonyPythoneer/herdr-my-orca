// F6: red test only. The stage base used by reconcile is state.repo.stage_head, which init sets and nothing
// updates, so "descendant of the stage base" degrades to "descendant of the init HEAD". Waiting for the owner
// to decide the refactor (one stage_head); remove `todo` when it is fixed.
import test from "node:test";
import assert from "node:assert/strict";
import { pushCheck } from "./my-orca.mjs";

test("F6: pushCheck rejects a HEAD that is not a descendant of the last accepted HEAD", { todo: "owner decides the stage_head refactor" }, () => {
  const state = { repo: { head: "h2", stage_head: "h0" } }; // h2 accepted later; stage_head still the init HEAD
  const git = { isAncestor: (base) => base === "h0" }; // the new HEAD (a force-push back to h1) descends from h0 only
  const info = { ok: true, head: "h1", dirty: [], upstream: "origin/feat", ahead: 0, toplevel: "/x" };
  assert.equal(pushCheck(state, info, git, state.repo.stage_head).ok, false);
});
