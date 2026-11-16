// F8: red test only. waitForResult backs off on HcError, but the startup scan / dispatch / reconcile hc.list
// calls do not, so one transient hc failure crashes the Runner. Waiting for the owner to decide the backoff
// policy; remove `todo` when it is fixed.
import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runLoop, makeRunnerContext, writeState, resolveConfig, HcError } from "./my-orca.mjs";

test("F8: a failing hc.list does not crash the Runner", { todo: "owner decides the backoff policy" }, async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "f8-"));
  await fsp.mkdir(path.join(dir, "results"), { recursive: true });
  const g = path.join(dir, ".git");
  const st = {
    run_id: "r1", status: "working", stage: "development", planning: { closed: null },
    profile: { cli: "claude", model: "m", effort: "low" },
    tasks: [{ id: "T-01", kind: "dev", title: "t", test: "true", deps: [], cycle: 0, state: "pending", attempts: [] }],
    acceptance: [{ id: "AC-1", text: "a", verify: "true" }], reviews: [], rework: { cycles: 0 }, dispatch: null,
    repo: { toplevel: dir, branch: "feat", head: "a", stage_head: "a", base_head: "a", dirty_at_start: [], first_commit_seen: false, git_dir: g, common_dir: g },
  };
  await writeState(dir, st);
  const hc = { coreId: () => "core", reads: () => ({ code: 0, stdout: "" }), list: () => { throw new HcError("hc list failed"); }, get: () => null, run: () => { throw new HcError("hc run failed"); }, kill: () => {}, rm: () => {} };
  const git = { info: () => ({ ok: true, toplevel: dir, git_dir: g, common_dir: g, branch: "feat", head: "a", dirty: [], upstream: "origin/feat", ahead: 0 }), isAncestor: () => true, commitsSince: () => 0, run: () => ({ code: 0, stdout: "", stderr: "" }) };
  const cfg = resolveConfig({ poll_s: 2, ack_timeout_s: 10, dev_timeout_min: 1, tuning_timeout_min: 1, test_timeout_min: 1, stopped_grace_s: 10 }).config;
  const ctx = makeRunnerContext({ stateDir: dir, state: st, hc, git, config: cfg, event: async () => {}, sleep: async () => {}, clock: () => Date.now() });
  await assert.doesNotReject(runLoop(ctx));
});
