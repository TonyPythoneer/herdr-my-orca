// F8: a failing hc.list (startup scan, dispatch, reconcile) is retried like waitForResult does, and only after
// hc_retry_min does the Runner stop, leaving state untouched, instead of crashing.
import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runLoop, makeRunnerContext, writeState, resolveConfig, HcError } from "./my-orca.mjs";

async function run(failures) {
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
  let lists = 0, runs = 0, now = 0;
  const hc = {
    coreId: () => "core", reads: () => ({ code: 0, stdout: "" }), get: () => null, kill: () => {}, rm: () => {},
    list: () => { if (++lists <= failures) throw new HcError("hc list failed"); return []; },
    run: () => { runs++; throw new Error("STOP"); }, // reached the launch: the lists recovered
  };
  const git = { info: () => ({ ok: true, toplevel: dir, git_dir: g, common_dir: g, branch: "feat", head: "a", dirty: [], upstream: "origin/feat", ahead: 0 }), isAncestor: () => true, commitsSince: () => 0, run: () => ({ code: 0, stdout: "", stderr: "" }) };
  const cfg = resolveConfig({ poll_s: 2, ack_timeout_s: 10, dev_timeout_min: 1, tuning_timeout_min: 1, test_timeout_min: 1, stopped_grace_s: 10 }).config;
  const ctx = makeRunnerContext({ stateDir: dir, state: st, hc, git, config: cfg, event: async () => {}, sleep: async (ms) => { now += ms; }, clock: () => now });
  await assert.doesNotReject(runLoop(ctx).catch((e) => { if (e.message !== "STOP") throw e; }));
  return { lists, runs, st };
}

test("F8: a hc.list that keeps failing does not crash the Runner; it stops with state untouched", async () => {
  const { runs, st } = await run(Infinity);
  assert.equal(runs, 0);
  assert.equal(st.status, "working");
  assert.equal(st.dispatch, null);
});

test("F8: a hc.list that fails twice and then recovers carries on to the launch", async () => {
  const { lists, runs } = await run(2);
  assert.ok(lists >= 3);
  assert.equal(runs, 1);
});
