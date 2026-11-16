// Probe: (1) E47 wrong-dispatch result => does the Runner loop re-dispatching without counting attempts?
//        (2) Resume after task_failed => does the task get +2 attempts (M9) or fewer?
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runLoop, makeRunnerContext, writeState, readJsonMaybe, resolveConfig } from "./my-orca.mjs";

function world(stateDir, { wrongDispatch = false, failTest = false, maxLaunches = 6 } = {}) {
  let live = null, killed = false, head = "a", launches = 0;
  const hc = {
    coreId: () => "core", reads: () => ({ code: 0, stdout: "" }), list: () => [],
    get: (address) => {
      if (!live || live.address !== address) return null;
      if (killed) return { address, state: "finished", status: null, turn: 1, created_ms: 1, labels: live.labels };
      return { address, state: "live", status: { state: "idle" }, turn: 1, created_ms: 1, labels: live.labels, foreground: { pid: 1 } };
    },
    run: (args) => {
      launches++;
      if (launches > maxLaunches) throw new Error(`LOOP: ${launches} launches`);
      const labels = {};
      args.forEach((a, i) => { if (a === "--label") { const [k, v] = args[i + 1].split("="); labels[k] = v; } });
      const id = labels["orca.dispatch"];
      live = { address: "t1", labels }; if (!wrongDispatch) head = `h${launches}`;
      fs.writeFileSync(path.join(stateDir, "results", `${id}.ack`), "");
      fs.writeFileSync(path.join(stateDir, "results", `${id}.json`), JSON.stringify({ dispatch: wrongDispatch ? "deadbeef" : id, task: labels["orca.task"], status: "done", summary: "x", commits: [], test: { cmd: "x", exit: 0 } }));
      if (!failTest) fs.writeFileSync(path.join(stateDir, "ok.txt"), "ok");
      return { code: 0, json: { address: "t1" }, error: null };
    },
    kill: () => { killed = true; }, rm: () => { live = null; killed = false; },
  };
  const git = {
    info: () => ({ ok: true, toplevel: stateDir, git_dir: path.join(stateDir, ".git"), common_dir: path.join(stateDir, ".git"), branch: "feat", head, dirty: [], upstream: "origin/feat", ahead: 0 }),
    isAncestor: () => true, commitsSince: () => 1, run: () => ({ code: 0, stdout: "", stderr: "" }),
  };
  return { hc, git, launches: () => launches };
}

async function setup(extra = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "probe-"));
  await fsp.mkdir(path.join(dir, "results"), { recursive: true });
  const st = {
    run_id: "r1", status: "working", stage: "development", planning: { closed: null },
    profile: { cli: "claude", model: "m", effort: "low" },
    tasks: [{ id: "T-01", kind: "dev", title: "t", test: "test -f ok.txt", deps: [], cycle: 0, state: "pending", attempts: [] }],
    acceptance: [{ id: "AC-1", text: "a", verify: "test -f ok.txt" }], reviews: [], rework: { cycles: 0 }, dispatch: null,
    repo: { toplevel: dir, branch: "feat", head: "a", stage_head: "a", base_head: "a", dirty_at_start: [], first_commit_seen: false, git_dir: path.join(dir, ".git"), common_dir: path.join(dir, ".git") },
    ...extra,
  };
  await writeState(dir, st);
  return { dir, st };
}

const cfg = resolveConfig({ poll_s: 2, ack_timeout_s: 10, dev_timeout_min: 1, tuning_timeout_min: 1, test_timeout_min: 1, stopped_grace_s: 10 }).config;
const ctxFor = (dir, st, w) => makeRunnerContext({ stateDir: dir, state: st, hc: w.hc, git: w.git, config: cfg, event: async () => {}, sleep: async () => {}, clock: () => Date.now() });


test("F1: a result for another dispatch (E47) stops with exit_without_result, no re-dispatch", async () => {
  const { dir, st } = await setup();
  const w = world(dir, { wrongDispatch: true });
  await runLoop(ctxFor(dir, st, w));
  const final = await readJsonMaybe(path.join(dir, "state.json"));
  assert.equal(w.launches(), 1);
  assert.equal(final.status, "needs_user");
  assert.equal(final.needs_user.code, "exit_without_result");
});

test("F2: Resume after task_failed grants +2 attempts (M9)", async () => {
  const { dir, st } = await setup();
  const w = world(dir, { failTest: true, maxLaunches: 10 });
  await runLoop(ctxFor(dir, st, w));
  const s1 = await readJsonMaybe(path.join(dir, "state.json"));
  assert.equal(s1.needs_user.code, "task_failed");
  assert.equal(s1.tasks[0].attempts.length, 2);
  const w2 = world(dir, { failTest: true, maxLaunches: 10 });
  await runLoop(ctxFor(dir, s1, w2));
  const s2 = await readJsonMaybe(path.join(dir, "state.json"));
  assert.equal(w2.launches(), 2);
  assert.equal(s2.tasks[0].resume_extra, 2);
  assert.equal(s2.tasks[0].attempts.length, 4);
  assert.equal(s2.needs_user.code, "task_failed");
});
