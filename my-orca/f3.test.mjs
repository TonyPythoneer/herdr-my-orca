// F3 (M7): when the wait cap is hit and HEAD keeps moving, the worker is still killed
// (and swept) before the run stops with needs_user(unsettled).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runLoop, makeRunnerContext, writeState, readJsonMaybe, resolveConfig } from "./my-orca.mjs";

function world(stateDir) {
  let live = null, killed = false, launches = 0, infoCalls = 0, kills = 0;
  const hc = {
    coreId: () => "core", reads: () => ({ code: 0, stdout: "" }), list: () => [],
    get: (address) => {
      if (!live || live.address !== address) return null;
      if (killed) return { address, state: "finished", status: null, turn: 1, created_ms: 1, labels: live.labels };
      return { address, state: "live", status: { state: "working" }, turn: 1, created_ms: 1, labels: live.labels, foreground: { pid: 1 } };
    },
    run: (args) => {
      launches++;
      const labels = {};
      args.forEach((a, i) => { if (a === "--label") { const [k, v] = args[i + 1].split("="); labels[k] = v; } });
      const id = labels["orca.dispatch"];
      live = { address: "t1", labels };
      fs.writeFileSync(path.join(stateDir, "results", `${id}.ack`), "");
      fs.writeFileSync(path.join(stateDir, "results", `${id}.json`), JSON.stringify({ dispatch: id, task: labels["orca.task"], status: "done", summary: "x", commits: [], test: { cmd: "x", exit: 0 } }));
      return { code: 0, json: { address: "t1" }, error: null };
    },
    kill: () => { kills++; killed = true; }, rm: () => { live = null; killed = false; },
  };
  const git = {
    // matches the run until the worker starts, then a new HEAD on every call: the tree never settles
    info: () => ({ ok: true, toplevel: stateDir, git_dir: path.join(stateDir, ".git"), common_dir: path.join(stateDir, ".git"), branch: "feat", head: launches ? `h${++infoCalls}` : "a", dirty: [], upstream: "origin/feat", ahead: 0 }),
    isAncestor: () => true, commitsSince: () => 1, run: () => ({ code: 0, stdout: "", stderr: "" }),
  };
  return { hc, git, launches: () => launches, kills: () => kills };
}

test("F3: wait cap with a still-moving HEAD kills the worker, then reports unsettled", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "f3-"));
  await fsp.mkdir(path.join(dir, "results"), { recursive: true });
  const st = {
    run_id: "r1", status: "working", stage: "development", planning: { closed: null },
    profile: { cli: "claude", model: "m", effort: "low" },
    tasks: [{ id: "T-01", kind: "dev", title: "t", test: "true", deps: [], cycle: 0, state: "pending", attempts: [] }],
    acceptance: [{ id: "AC-1", text: "a", verify: "true" }], reviews: [], rework: { cycles: 0 }, dispatch: null,
    repo: { toplevel: dir, branch: "feat", head: "a", stage_head: "a", base_head: "a", dirty_at_start: [], first_commit_seen: false, git_dir: path.join(dir, ".git"), common_dir: path.join(dir, ".git") },
  };
  await writeState(dir, st);
  const w = world(dir);
  let now = Date.now();
  const cfg = resolveConfig({ poll_s: 2, ack_timeout_s: 10, dev_timeout_min: 1, tuning_timeout_min: 1, test_timeout_min: 1, stopped_grace_s: 10 }).config;
  const ctx = makeRunnerContext({ stateDir: dir, state: st, hc: w.hc, git: w.git, config: cfg, event: async () => {}, sleep: async () => {}, clock: () => (now += 31_000) });
  await runLoop(ctx);
  const final = await readJsonMaybe(path.join(dir, "state.json"));
  assert.ok(w.kills() >= 1, `worker must be killed before unsettled (kills: ${w.kills()})`);
  assert.equal(final.status, "needs_user");
  assert.equal(final.needs_user.code, "unsettled");
});
