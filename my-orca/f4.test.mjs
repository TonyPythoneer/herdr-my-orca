// F4 (R-G): every kill checks the terminal's labels first and writes a `kill` event.
// Resume after needs_user kills the retained worker through the same path as settleAndKill.
import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runLoop, makeRunnerContext, writeState, readJsonMaybe, resolveConfig } from "./my-orca.mjs";

const DISPATCH = "d1";

// A retained worker at t1 whose "orca.dispatch" label is `labelDispatch`.
async function resumeWith(labelDispatch) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "f4-"));
  await fsp.mkdir(path.join(dir, "results"), { recursive: true });
  const st = {
    run_id: "r1", status: "needs_user", needs_user: { code: "task_failed", detail: "x", at: "2026-01-01T00:00:00Z" },
    stage: "development", planning: { closed: null },
    profile: { cli: "claude", model: "m", effort: "low" },
    tasks: [{ id: "T-01", kind: "dev", title: "t", test: "true", deps: [], cycle: 0, state: "dispatched", attempts: [] }],
    acceptance: [{ id: "AC-1", text: "a", verify: "true" }], reviews: [], rework: { cycles: 0 },
    dispatch: { id: DISPATCH, task: "T-01", kind: "dev", address: "t1", phase: "acked", created_ms: 1 },
    repo: { toplevel: dir, branch: "feat", head: "a", stage_head: "a", base_head: "a", dirty_at_start: [], first_commit_seen: false, git_dir: path.join(dir, ".git"), common_dir: path.join(dir, ".git") },
  };
  await writeState(dir, st);
  let kills = 0;
  const hc = {
    coreId: () => "core", reads: () => ({ code: 0, stdout: "" }), list: () => [],
    get: (address) => address === "t1"
      ? { address, state: "live", status: { state: "idle" }, turn: 1, created_ms: 1, labels: { "orca.run": "r1", "orca.dispatch": labelDispatch, "orca.role": "dev" } }
      : null,
    // the run carries on after the kill; cut it at the next launch
    run: () => { throw new Error("STOP"); },
    kill: () => { kills++; }, rm: () => {},
  };
  const git = {
    info: () => ({ ok: true, toplevel: dir, git_dir: path.join(dir, ".git"), common_dir: path.join(dir, ".git"), branch: "feat", head: "a", dirty: [], upstream: "origin/feat", ahead: 0 }),
    isAncestor: () => true, commitsSince: () => 0, run: () => ({ code: 0, stdout: "", stderr: "" }),
  };
  const events = [];
  const cfg = resolveConfig({ poll_s: 2, ack_timeout_s: 10, dev_timeout_min: 1, tuning_timeout_min: 1, test_timeout_min: 1, stopped_grace_s: 10 }).config;
  const ctx = makeRunnerContext({ stateDir: dir, state: st, hc, git, config: cfg, event: async (name, e) => events.push([name, e]), sleep: async () => {}, clock: () => Date.now() });
  await runLoop(ctx).catch((e) => { if (e.message !== "STOP") throw e; });
  return { kills: () => kills, events, final: await readJsonMaybe(path.join(dir, "state.json")) };
}

test("F4: Resume does not kill a terminal whose dispatch label is someone else's", async () => {
  const r = await resumeWith("someone-else");
  assert.equal(r.kills(), 0);
  assert.equal(r.final.needs_user.code, "identity");
  assert.equal(r.events.some(([name]) => name === "kill"), false);
});

test("F4: Resume kills a terminal whose labels match, and records a kill event", async () => {
  const r = await resumeWith(DISPATCH);
  assert.equal(r.kills(), 1);
  const kill = r.events.find(([name]) => name === "kill");
  assert.ok(kill, "kill event written");
  assert.equal(kill[1].detail.address, "t1");
});
