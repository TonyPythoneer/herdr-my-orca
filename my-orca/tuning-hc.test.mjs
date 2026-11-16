// Tuning: when hc keeps failing while waiting for delivery, stop quietly (state untouched) like a dev task does,
// instead of reporting needs_user with an undefined code.
import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runLoop, makeRunnerContext, writeState, resolveConfig, HcError } from "./my-orca.mjs";

test("Tuning: hc failing during delivery stops without needs_user", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "tuning-hc-"));
  await fsp.mkdir(path.join(dir, "reviews"), { recursive: true });
  const g = path.join(dir, ".git");
  const st = {
    run_id: "r1", status: "working", stage: "tuning", planning: { closed: null },
    profile: { cli: "claude", model: "m", effort: "low" },
    tasks: [{ id: "T-01", kind: "dev", title: "t", test: "true", deps: [], cycle: 0, state: "accepted", attempts: [] }],
    acceptance: [{ id: "AC-1", text: "a", verify: "true" }], reviews: [], rework: { cycles: 0 }, dispatch: null,
    repo: { toplevel: dir, branch: "feat", head: "a", base_head: "a", dirty_at_start: [], first_commit_seen: true, git_dir: g, common_dir: g },
  };
  await writeState(dir, st);
  let launched = false, gets = 0, now = 0;
  const hc = {
    coreId: () => "core", reads: () => ({ code: 0, stdout: "" }), list: () => [], kill: () => {}, rm: () => {},
    get: () => { if (gets++ > 0) throw new HcError("hc get failed"); return { created_ms: 1 }; }, // the read right after launch works; waiting for delivery fails
    run: () => { launched = true; return { code: 0, json: { address: "t1" }, error: null }; },
  };
  const git = { info: () => ({ ok: true, toplevel: dir, git_dir: g, common_dir: g, branch: "feat", head: "a", dirty: [], upstream: "origin/feat", ahead: 0 }), isAncestor: () => true, commitsSince: () => 0, run: () => ({ code: 0, stdout: "", stderr: "" }) };
  const cfg = resolveConfig({ poll_s: 2, ack_timeout_s: 10, dev_timeout_min: 1, tuning_timeout_min: 1, test_timeout_min: 1, stopped_grace_s: 10 }).config;
  const ctx = makeRunnerContext({ stateDir: dir, state: st, hc, git, config: cfg, event: async () => {}, sleep: async (ms) => { now += ms; }, clock: () => now });
  const out = await runLoop(ctx);
  assert.equal(launched, true);
  assert.equal(out.stop, true);
  assert.notEqual(st.status, "needs_user");
});
