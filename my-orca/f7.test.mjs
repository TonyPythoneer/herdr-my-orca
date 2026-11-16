// F7: the startup scan kills (through the label check) and removes a live worker left over from a finished attempt.
import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runLoop, makeRunnerContext, writeState, resolveConfig } from "./my-orca.mjs";

async function startWith(labelDispatch) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "f7-"));
  await fsp.mkdir(path.join(dir, "results"), { recursive: true });
  const g = path.join(dir, ".git");
  const st = {
    run_id: "r1", status: "working", stage: "development", planning: { closed: null },
    profile: { cli: "claude", model: "m", effort: "low" },
    tasks: [{ id: "T-01", kind: "dev", title: "t", test: "true", deps: [], cycle: 0, state: "pending", attempts: [{ dispatch: "d0", at: "2026-01-01T00:00:00Z", reason: "test_failed" }] }],
    acceptance: [{ id: "AC-1", text: "a", verify: "true" }], reviews: [], rework: { cycles: 0 }, dispatch: null,
    repo: { toplevel: dir, branch: "feat", head: "a", stage_head: "a", base_head: "a", dirty_at_start: [], first_commit_seen: false, git_dir: g, common_dir: g },
  };
  await writeState(dir, st);
  const left = { address: "t9", state: "live", created_ms: 5, status: { state: "idle" }, labels: { "orca.run": "r1", "orca.dispatch": labelDispatch, "orca.role": "dev" } };
  const calls = [];
  const hc = {
    coreId: () => "core", reads: () => ({ code: 0, stdout: "" }),
    list: () => [left],
    get: (a) => (a === "t9" ? left : null),
    run: () => { throw new Error("STOP"); }, // the run carries on after the scan; cut it at the next launch
    kill: (a) => calls.push(["kill", a]), rm: (a) => calls.push(["rm", a]),
  };
  const git = { info: () => ({ ok: true, toplevel: dir, git_dir: g, common_dir: g, branch: "feat", head: "a", dirty: [], upstream: "origin/feat", ahead: 0 }), isAncestor: () => true, commitsSince: () => 0, run: () => ({ code: 0, stdout: "", stderr: "" }) };
  const cfg = resolveConfig({ poll_s: 2, ack_timeout_s: 10, dev_timeout_min: 1, tuning_timeout_min: 1, test_timeout_min: 1, stopped_grace_s: 10 }).config;
  const ctx = makeRunnerContext({ stateDir: dir, state: st, hc, git, config: cfg, event: async () => {}, sleep: async () => {}, clock: () => Date.now() });
  await runLoop(ctx).catch((e) => { if (e.message !== "STOP") throw e; });
  return calls;
}

test("F7: a live worker from a finished attempt is killed, then removed", async () => {
  assert.deepEqual(await startWith("d0"), [["kill", "t9"], ["rm", "t9"]]);
});

test("F7: a live worker whose dispatch is not in state still stops the run and is left alone", async () => {
  assert.deepEqual(await startWith("never-seen"), []);
});
