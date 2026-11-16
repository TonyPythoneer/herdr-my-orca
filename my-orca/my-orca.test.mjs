import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  CoreGuardError, guardedHc, parsePs, tagged, sweep,
  checkCommand, reworkGate, checkConfigValue, resolveConfig, DEFAULT_CONFIG,
  checkHandoff, validateTasksDoc, validateHandoffFiles, scanSecrets,
  parseProfile, profileArgv, chooseNextTask, lights, inspector,
  writeState, readJsonMaybe, StaleStateError, dispatchCheck, pushCheck,
  workerEnvPrefix, runShell, runLoop, makeRunnerContext, stateHome, wtIdForGitDir,
} from "./my-orca.mjs";

// ---- M13: destructive hc commands only on the expected core ----

const fakeExec = (coreId) => {
  const calls = [];
  const exec = (args) => {
    calls.push(args.join(" "));
    if (args[0] === "server" && args[1] === "status") {
      if (coreId === "garbage") return { stdout: "not json" };
      return { stdout: JSON.stringify({ core: { id: coreId } }) };
    }
    return { stdout: "{}" };
  };
  return { exec, calls };
};

test("M13: a destructive command runs only on the expected core", () => {
  const { exec, calls } = fakeExec("dedicated");
  guardedHc({ exec, expectCoreId: "dedicated" })(["kill", "oe-a"]);
  assert.deepEqual(calls, ["server status --json", "kill oe-a"]);
});

test("M13: another core with the same addresses is refused and nothing is killed", () => {
  const { exec, calls } = fakeExec("owners");
  assert.throws(() => guardedHc({ exec, expectCoreId: "dedicated" })(["kill", "t1"]), CoreGuardError);
  assert.ok(!calls.some((c) => c.startsWith("kill")));
});

test("M13: a forbidden core id is refused even if it equals the expected one", () => {
  const { exec } = fakeExec("owners");
  assert.throws(() => guardedHc({ exec, expectCoreId: "owners", forbidCoreIds: ["owners"] })(["rm", "t1"]), CoreGuardError);
});

test("M13: fails closed when the core id cannot be read", () => {
  assert.throws(() => guardedHc({ exec: fakeExec("garbage").exec, expectCoreId: "x" })(["kill", "a"]), CoreGuardError);
  assert.throws(() => guardedHc({ exec: () => { throw new Error("hc missing"); }, expectCoreId: "x" })(["kill", "a"]), CoreGuardError);
  assert.throws(() => guardedHc({ exec: fakeExec("x").exec }), CoreGuardError);
});

test("M13: server stop and restart are destructive, reads are not checked", () => {
  const { exec, calls } = fakeExec("owners");
  const hc = guardedHc({ exec, expectCoreId: "dedicated" });
  assert.throws(() => hc(["server", "stop"]), CoreGuardError);
  assert.throws(() => hc(["server", "restart"]), CoreGuardError);
  hc(["get", "t1", "--json"]);
  hc(["ls", "--json"]);
  assert.ok(calls.includes("get t1 --json") && calls.includes("ls --json"));
});

// ---- M14: sweep processes that escaped hc kill ----

const ps = (...rows) => rows.join("\n");
const row = (pid, started, cmd) => `${String(pid).padStart(6)} ${started} ${cmd}`;
const T1 = "Mon Nov 16 07:28:43 2026";

test("M14: ps lines parse into pid, start time and command", () => {
  const out = parsePs(ps(row(31016, T1, "/usr/bin/python3 daemon.py HOME=/Users/x ORCA_DISPATCH=d5b MARK=/tmp/m"), "garbage line"));
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].pid, out[0].started], [31016, T1]);
});

test("M14: the en_AU lstart order (day before month) parses too", () => {
  const out = parsePs(row(7847, "Mon 16 Nov 07:33:13 2026", "/opt/homebrew/bin/node -e x ORCA_DISPATCH=d1"));
  assert.deepEqual([out[0].pid, out[0].started], [7847, "Mon 16 Nov 07:33:13 2026"]);
});

test("M14: the tag matches a whole token only, and never this process", () => {
  const procs = parsePs(ps(
    row(10, T1, "a ORCA_DISPATCH=d1 b"),
    row(11, T1, "a ORCA_DISPATCH=d10 b"),
    row(12, T1, "a XORCA_DISPATCH=d1 b"),
    row(13, T1, "a ORCA_DISPATCH=d1"),
  ));
  assert.deepEqual(tagged(procs, "d1", 13).map((p) => p.pid), [10]);
});

const fakeWorld = (initial, { stubborn = [] } = {}) => {
  let alive = new Map(initial);
  const killed = [];
  return {
    killed,
    ps: () => [...alive].map(([pid, s]) => row(pid, s, "daemon ORCA_DISPATCH=d1")).join("\n"),
    kill: (pid, sig) => { killed.push([pid, sig]); if (!stubborn.includes(pid) || sig === "SIGKILL") alive.delete(pid); },
  };
};
const fast = { sleep: async () => {}, selfPid: 1 };

test("M14: survivors are killed and the rescan comes back clean", async () => {
  const w = fakeWorld([[20, T1], [21, T1]]);
  const r = await sweep("d1", { ...fast, ps: w.ps, kill: w.kill });
  assert.deepEqual(r, { clean: true, killed: [20, 21], remaining: [] });
});

test("M14: nothing to sweep is clean and kills nothing", async () => {
  const w = fakeWorld([]);
  assert.deepEqual(await sweep("d1", { ...fast, ps: w.ps, kill: w.kill }), { clean: true, killed: [], remaining: [] });
});

test("M14: a process that ignores SIGTERM gets SIGKILL in a later round", async () => {
  const w = fakeWorld([[30, T1]], { stubborn: [30] });
  const r = await sweep("d1", { ...fast, ps: w.ps, kill: w.kill });
  assert.equal(r.clean, true);
  assert.deepEqual(w.killed.map(([, s]) => s), ["SIGTERM", "SIGTERM", "SIGKILL"]);
});

test("M14: a process that cannot be killed leaves clean=false", async () => {
  const r = await sweep("d1", { ...fast, ps: () => row(40, T1, "x ORCA_DISPATCH=d1"), kill: () => {} });
  assert.deepEqual([r.clean, r.remaining], [false, [40]]);
});

test("M14: a pid reused by another process (new start time) is not killed", async () => {
  let n = 0;
  const kills = [];
  const psFn = () => row(50, ++n === 1 ? T1 : "Mon Nov 16 07:29:59 2026", "x ORCA_DISPATCH=d1");
  await sweep("d1", { ...fast, ps: psFn, kill: (pid) => kills.push(pid), rounds: 1 });
  assert.deepEqual(kills, []);
});

test("M14: real process tree, a setsid daemon survives hc-style kill but not the sweep", async () => {
  const id = `t${process.pid}x${Date.now()}`;
  const sleeper = (env) => spawn(process.execPath, ["-e", "setTimeout(()=>{}, 60000)"], { detached: true, stdio: "ignore", env: { ...process.env, ...env } });
  const tagged1 = sleeper({ ORCA_DISPATCH: id });
  const other = sleeper({});
  tagged1.unref(); other.unref();
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(alive(tagged1.pid) && alive(other.pid));
    const r = await sweep(id);
    assert.equal(r.clean, true);
    assert.deepEqual(r.killed, [tagged1.pid]);
    assert.equal(alive(tagged1.pid), false);
    assert.equal(alive(other.pid), true);
  } finally {
    for (const p of [tagged1, other]) try { process.kill(p.pid, "SIGKILL"); } catch { /* gone */ }
  }
});

// ---- command policy ----

test("checkCommand rejects empty and trivial tests but allows real commands", () => {
  for (const t of ["", "true", ":", "exit 0", "echo ok", "  true ; "]) assert.ok(checkCommand(t), t);
  for (const t of ["sh tests/t01.sh", "node --test", "grep -q '^v1$' CHANGELOG.md", "python3 -m unittest tests.test_a", "test -f greet.sh && sh tests/t01.sh"]) assert.equal(checkCommand(t), null, t);
  assert.equal(checkCommand(undefined), "empty command");
});

// ---- config ----

test("config values are range-checked and invalid values fall back", () => {
  assert.equal(checkConfigValue("max_rework_cycles", 3), null);
  assert.ok(checkConfigValue("max_rework_cycles", 0));
  assert.ok(checkConfigValue("max_rework_cycles", 10));
  assert.ok(checkConfigValue("max_rework_cycles", "x"));
  assert.equal(checkConfigValue("close_planning_tab", "true"), null);
  assert.ok(checkConfigValue("close_planning_tab", "yes"));
  assert.ok(checkConfigValue("nope", 1));
  const { config, ignored } = resolveConfig({ max_rework_cycles: 99, poll_s: 5, close_planning_tab: true });
  assert.equal(config.max_rework_cycles, DEFAULT_CONFIG.max_rework_cycles);
  assert.equal(config.poll_s, 5);
  assert.equal(config.close_planning_tab, true);
  assert.equal(ignored.length, 1);
});

// ---- handoff / tasks ----

const HANDOFF = `# Handoff

## 1. Requirements and Context
x
## 2. Technical Findings
x
## 3. Feasibility Evidence
x
## 4. Architecture and Implementation Strategy
x
## 5. Tasks
x
## 6. Subtasks, if needed
x
## 7. Tests
x
## 8. Acceptance Criteria
x
## 9. Edge Cases and Risks
x
## 10. Open Questions and Known Limitations
x
`;
const TASKS = {
  schema: 1,
  tasks: [
    { id: "T-01", title: "make a file", test: "test -f a.txt" },
    { id: "T-02", title: "make b", test: "test -f b.txt", deps: ["T-01"] },
  ],
  acceptance: [{ id: "AC-1", text: "both files exist", verify: "test -f a.txt && test -f b.txt" }],
};

test("handoff needs all ten mandatory sections", () => {
  assert.deepEqual(checkHandoff(HANDOFF), []);
  assert.ok(checkHandoff(HANDOFF.replace("## 7. Tests", "## Tests removed")).some((e) => e.includes("Tests")));
  assert.ok(checkHandoff("not a handoff").length >= 10);
});

test("tasks.json validates ids, tests, deps, cycles and acceptance", () => {
  assert.deepEqual(validateTasksDoc(TASKS), []);
  const bad = (doc) => validateTasksDoc(doc).length > 0;
  assert.ok(bad({ ...TASKS, tasks: [] }));
  assert.ok(bad({ ...TASKS, tasks: [TASKS.tasks[0], { ...TASKS.tasks[1], id: "T-01" }] }));
  assert.ok(bad({ ...TASKS, tasks: [{ id: "R1-01", title: "x", test: "test -f x" }] }));
  assert.ok(bad({ ...TASKS, tasks: [{ id: "T-01", title: "x", test: "true" }] }));
  assert.ok(bad({ ...TASKS, tasks: [{ id: "T-01", title: "x", test: "test -f x", deps: ["T-99"] }] }));
  assert.ok(bad({ ...TASKS, tasks: [{ id: "T-01", title: "x", test: "test -f x", deps: ["T-02"] }, { id: "T-02", title: "y", test: "test -f y", deps: ["T-01"] }] }));
  assert.ok(bad({ ...TASKS, acceptance: [] }));
  assert.ok(bad({ ...TASKS, acceptance: [{ id: "AC-1", text: "manual only", manual: true }] }));
  assert.ok(bad({ ...TASKS, acceptance: [{ id: "AC-1", text: "both", verify: "test -f a", manual: true }] }));
  assert.equal(validateTasksDoc({ ...TASKS, acceptance: [...TASKS.acceptance, { id: "AC-2", text: "manual", manual: true }] }).length, 0);
});

test("secrets scan reports line numbers and kinds, not the value", () => {
  const hits = scanSecrets(`a\nkey sk-abcdefghijklmnopqrstuvwx\nAKIAABCDEFGHIJKLMNOP\n`);
  assert.deepEqual(hits.map((h) => [h.line, h.kind]), [[2, "sk"], [3, "aws"]]);
  const checked = validateHandoffFiles(HANDOFF + "\nghp_abcdefghijklmnopqrstuvwxyz\n", JSON.stringify(TASKS));
  assert.ok(!checked.ok && checked.errors.some((e) => e.includes("possible secret")));
});

// ---- profile ----

test("profile reads only whitelisted model/effort flags", () => {
  const claude = parseProfile(["claude", "--dangerously-skip-permissions", "--model", "m", "--effort", "high", "prompt text"]);
  assert.deepEqual(claude, { ok: true, profile: { cli: "claude", model: "m", effort: "high" } });
  const codex = parseProfile(["codex", "--no-daemon", "-c", "disable_paste_burst=true", "-m", "gpt", "-c", "model_reasoning_effort=low", "prompt"]);
  assert.deepEqual(codex, { ok: true, profile: { cli: "codex", model: "gpt", effort: "low" } });
  assert.equal(parseProfile(["opencode", "--model", "x"]).code, "unsupported_cli");
  assert.equal(parseProfile(["claude", "prompt"]).code, "missing_model");
  assert.equal(parseProfile(["claude", "--model", "x"]).code, "missing_effort");
  const overridden = parseProfile(["claude", "prompt"], { model: "M", effort: "E" });
  assert.deepEqual(overridden.profile, { cli: "claude", model: "M", effort: "E" });
});

test("profile argv matches the spec table exactly", () => {
  assert.deepEqual(profileArgv({ cli: "claude", model: "M", effort: "E" }, "P"), [
    "claude", "--dangerously-skip-permissions", "--model", "M", "--effort", "E", "P",
  ]);
  assert.deepEqual(profileArgv({ cli: "codex", model: "M", effort: "E" }, "P"), [
    "codex", "--no-daemon", "-c", "disable_paste_burst=true", "--dangerously-bypass-approvals-and-sandbox",
    "-m", "M", "-c", "model_reasoning_effort=E", "P",
  ]);
});

test("worker environment keeps HC_SESSION, drops the wrapper and XDG, and tags the process", () => {
  const env = { HC_SESSION: "s", HC_TERMINAL_ID: "t1", HC_SCOPE: "x", XDG_CONFIG_HOME: "a", XDG_STATE_HOME: "b", XDG_DATA_HOME: "c", CLAUDE_CODE_CHILD_SESSION: "1", HOME: "/h" };
  const dev = workerEnvPrefix({ dispatchId: "d1", cli: "dev", sessionEnv: env });
  assert.ok(dev.includes("HC_TERMINAL_ID") && dev.includes("XDG_CONFIG_HOME"));
  assert.ok(!dev.includes("HC_SESSION"));
  assert.ok(dev.includes("GIT_TERMINAL_PROMPT=0") && dev.includes("ORCA_DISPATCH=d1"));
  const tuning = workerEnvPrefix({ dispatchId: "d1", cli: "tuning", sessionEnv: env });
  assert.ok(tuning.includes("CLAUDE_CODE_CHILD_SESSION"));
});

// ---- next task / lights ----

const stateWith = (tasks, extra = {}) => ({
  run_id: "r", status: "working", stage: "development",
  planning: { closed: null }, tasks, acceptance: [{ id: "AC-1", text: "a", verify: "test -f a" }],
  reviews: [], rework: { cycles: 0 }, dispatch: null, ...extra,
});

test("chooseNextTask respects deps and reports blocked vs done", () => {
  const s = stateWith([
    { id: "T-01", state: "accepted", deps: [] },
    { id: "T-02", state: "pending", deps: ["T-01"] },
    { id: "T-03", state: "pending", deps: ["T-02"] },
  ]);
  assert.equal(chooseNextTask(s).task.id, "T-02");
  s.tasks[1].state = "accepted";
  assert.equal(chooseNextTask(s).task.id, "T-03");
  s.tasks[2].state = "accepted";
  assert.deepEqual(chooseNextTask(s), { done: true });
  assert.equal(chooseNextTask(stateWith([{ id: "T-01", state: "pending", deps: ["T-02"] }, { id: "T-02", state: "pending", deps: ["T-01"] }])).blocked, true);
});

test("lights count accepted tasks, acceptance criteria and the ready gate", () => {
  const s = stateWith([
    { id: "T-01", state: "accepted", deps: [] },
    { id: "T-02", state: "pending", deps: [] },
  ]);
  const l = lights(s);
  assert.deepEqual(l.map((x) => [x.id, x.accepted, x.total]), [
    ["planning", 1, 1], ["development", 1, 2], ["tuning", 0, 1], ["ready", 0, 1],
  ]);
  s.stage = "ready_for_review"; s.status = "completed";
  s.reviews = [{ dispatch: "d", verdict: "pass", criteria: [{ id: "AC-1", pass: true }] }];
  assert.deepEqual(lights(s).map((x) => x.state), ["complete", "complete", "complete", "complete"]);
  s.status = "needs_user";
  assert.equal(lights(s).find((x) => x.id === "ready").state, "needs_user");
});

test("inspector exposes tasks, attempts and a live terminal", () => {
  const s = stateWith([{ id: "T-01", kind: "dev", title: "a", state: "dispatched", deps: [], attempts: [{ reason: "x" }], test: "test -f a" }], { dispatch: { id: "d1", kind: "dev", task: "T-01" } });
  const i = inspector(s, [{ address: "t9", state: "live", labels: { "orca.dispatch": "d1" } }]);
  assert.equal(i.tasks[0].terminal.address, "t9");
  assert.equal(i.tasks[0].attempts, 1);
  assert.equal(i.stage, "development");
});

// ---- state atomic write / second writer ----

test("writeState is atomic and refuses a second writer", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "my-orca-state-"));
  try {
    const s = stateWith([]);
    const first = await writeState(dir, s);
    assert.equal((await readJsonMaybe(path.join(dir, "state.json"))).updated, first);
    await writeState(dir, { ...s, stage: "tuning" }, first);
    await assert.rejects(() => writeState(dir, { ...s, stage: "development" }, first), StaleStateError);
    assert.equal((await readJsonMaybe(path.join(dir, "state.json"))).stage, "tuning");
    assert.ok(!(await fsp.readdir(dir)).some((f) => f.includes(".tmp-")));
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

// ---- git checks ----

const info = (over = {}) => ({ ok: true, toplevel: "/w", git_dir: "/w/.git", common_dir: "/w/.git", branch: "feat", head: "a", dirty: [], upstream: "origin/feat", ahead: 0, ...over });
const state = () => ({ repo: { branch: "feat", head: "a", stage_head: "a", dirty_at_start: [], first_commit_seen: true } });

test("dispatchCheck refuses a moved HEAD, dirty tree, branch change and unpushed commits", () => {
  assert.equal(dispatchCheck(state(), info()).ok, true);
  assert.equal(dispatchCheck(state(), info({ branch: "other" })).ok, false);
  assert.equal(dispatchCheck(state(), info({ head: "b" })).ok, false);
  assert.equal(dispatchCheck(state(), info({ dirty: ["?? x"] })).ok, false);
  assert.equal(dispatchCheck(state(), info({ upstream: null })).ok, false);
  assert.equal(dispatchCheck(state(), info({ ahead: 1 })).ok, false);
  const dirtyStart = { repo: { ...state().repo, dirty_at_start: ["x"], first_commit_seen: false } };
  assert.equal(dispatchCheck(dirtyStart, info({ dirty: ["?? x"] }), { first: true }).ok, true);
});

test("pushCheck requires clean, upstream, ahead 0 and the stage head as an ancestor", () => {
  const git = { isAncestor: (a, b) => a === b || a === "a" };
  const s = { repo: { stage_head: "a" } };
  assert.equal(pushCheck(s, info({ head: "b" }), git, "a").ok, true);
  assert.equal(pushCheck(s, info({ head: "b", ahead: 1 }), git, "a").ok, false);
  assert.equal(pushCheck(s, info({ head: "b", dirty: ["?? x"] }), git, "a").ok, false);
  assert.equal(pushCheck(s, info({ head: "c" }), { isAncestor: () => false }, "a").ok, false);
});

// ---- M15 ----

const ok = { cycle: 2, existingIds: ["T-01", "T-02"] };

test("M15: a valid batch gets Runner-assigned ids and resolved deps", () => {
  const r = reworkGate([
    { title: "add changelog", test: "grep -q '^v1$' CHANGELOG.md", deps: ["T-02"] },
    { title: "link it", test: "sh tests/t04.sh", deps: ["@1", "T-01"] },
  ], ok);
  assert.equal(r.ok, true);
  assert.deepEqual(r.tasks.map((t) => [t.id, t.kind, t.deps]), [
    ["R2-01", "rework", ["T-02"]],
    ["R2-02", "rework", ["R2-01", "T-01"]],
  ]);
});

test("M15: empty is a bad review, more than 10 is rework_too_large", () => {
  assert.equal(reworkGate([], ok).code, "bad_review");
  assert.equal(reworkGate(undefined, ok).code, "bad_review");
  const eleven = Array.from({ length: 11 }, (_, i) => ({ title: `t${i}`, test: "sh a.sh" }));
  assert.equal(reworkGate(eleven, ok).code, "rework_too_large");
  assert.equal(reworkGate(eleven.slice(0, 10), ok).ok, true);
});

test("M15: trivial tests and bad deps are rejected", () => {
  assert.ok(reworkGate([{ title: "x", test: "true" }], ok).errors.length);
  const t = (deps, title = "x") => reworkGate([{ title: "first", test: "sh a.sh" }, { title, test: "sh b.sh", deps }], ok);
  assert.equal(t(["@1"]).ok, true);
  for (const d of [["@2"], ["@0"], ["@3"], ["T-99"], ["R2-01"]]) assert.equal(t(d).ok, false, JSON.stringify(d));
  assert.equal(t([], "").ok, false);
  assert.equal(reworkGate([{ title: "a", test: "sh a.sh", deps: ["@1"] }], ok).ok, false);
});

// ---- runShell ----

test("runShell closes stdin, returns the exit code and kills a hung test", async () => {
  const r = await runShell("cat; exit 3", { cwd: os.tmpdir(), dispatchId: "d", timeoutMs: 5000 });
  assert.equal(r.code, 3);
  const t = await runShell("sleep 9999", { cwd: os.tmpdir(), dispatchId: "d", timeoutMs: 1000 });
  assert.equal(t.timedOut, true);
  assert.equal(t.code, 124);
});

// ---- full happy path with a fake hc and git, no core ----

function fakeHappyWorld(stateDir) {
  let live = null;
  let killed = false;
  let head = "a";
  const log = [];
  const hc = {
    coreId: () => "core",
    reads: () => ({ code: 0, stdout: "" }),
    get: (address) => {
      if (!live || live.address !== address) return null;
      if (killed) return { address, state: "finished", status: null, turn: 1, created_ms: 1, labels: live.labels };
      return { address, state: "live", status: { state: "idle" }, turn: 1, created_ms: 1, labels: live.labels, foreground: { pid: 1 } };
    },
    list: () => [],
    run: (args) => {
      const labels = {};
      args.forEach((a, i) => { if (a === "--label") { const [k, v] = args[i + 1].split("="); labels[k] = v; } });
      const id = labels["orca.dispatch"];
      const role = labels["orca.role"];
      live = { address: "t1", labels };
      head = "b";
      fs.writeFileSync(path.join(stateDir, "results", `${id}.ack`), "");
      if (role === "dev") {
        fs.writeFileSync(path.join(stateDir, "results", `${id}.json`), JSON.stringify({ dispatch: id, task: labels["orca.task"], status: "done", summary: "ok", commits: ["b"], test: { cmd: "test -f ok.txt", exit: 0 } }));
        fs.writeFileSync(path.join(stateDir, "ok.txt"), "ok");
      } else {
        fs.writeFileSync(path.join(stateDir, "reviews", `${id}.json`), JSON.stringify({ dispatch: id, verdict: "pass", criteria: [{ id: "AC-1", pass: true, evidence: "ok" }], summary: "ok" }));
      }
      return { code: 0, json: { address: "t1" }, error: null };
    },
    kill: () => { killed = true; log.push("kill"); },
    rm: () => { log.push("rm"); live = null; killed = false; },
  };
  const git = {
    info: () => ({ ok: true, toplevel: stateDir, git_dir: path.join(stateDir, ".git"), common_dir: path.join(stateDir, ".git"), branch: "feat", head, dirty: [], upstream: "origin/feat", ahead: 0 }),
    isAncestor: () => true,
    commitsSince: () => 1,
    run: () => ({ code: 0, stdout: "", stderr: "" }),
  };
  return { hc, git, log, getHead: () => head };
}

test("Runner happy path: dispatch, accept, tune, ready_for_review", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "my-orca-run-"));
  try {
    const st = stateWith([{ id: "T-01", kind: "dev", title: "make ok", test: "test -f ok.txt", deps: [], cycle: 0, state: "pending", attempts: [] }]);
    st.run_id = "r1"; st.profile = { cli: "claude", model: "m", effort: "low" };
    st.acceptance = [{ id: "AC-1", text: "ok exists", verify: "test -f ok.txt" }];
    st.repo = { toplevel: dir, branch: "feat", head: "a", stage_head: "a", base_head: "a", dirty_at_start: [], first_commit_seen: false, git_dir: path.join(dir, ".git"), common_dir: path.join(dir, ".git") };
    await writeState(dir, st);
    const world = fakeHappyWorld(dir);
    const config = resolveConfig({ poll_s: 2, ack_timeout_s: 10, dev_timeout_min: 1, tuning_timeout_min: 1, test_timeout_min: 1, stopped_grace_s: 10 }).config;
    const ctx = makeRunnerContext({ stateDir: dir, state: st, hc: world.hc, git: world.git, config, event: async (type, extra = {}) => fs.appendFileSync(path.join(dir, "events.jsonl"), JSON.stringify({ type, ...extra }) + "\n"), sleep: async () => {}, clock: () => Date.now() });
    const out = await runLoop(ctx);
    const final = await readJsonMaybe(path.join(dir, "state.json"));
    assert.equal(out.done, true);
    assert.equal(final.stage, "ready_for_review");
    assert.equal(final.status, "completed");
    assert.equal(final.tasks[0].state, "accepted");
    assert.equal(final.reviews.length, 1);
    assert.equal(final.reviews[0].verdict, "pass");
    assert.ok(world.log.includes("kill") && world.log.includes("rm"));
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test("stateHome honours MY_ORCA_HOME and wt-id is the git-dir hash prefix", () => {
  assert.equal(stateHome({ HOME: "/h", MY_ORCA_HOME: "/tmp/x" }), "/tmp/x");
  assert.equal(stateHome({ HOME: "/h" }), "/h/.config/herdr-app/my-orca");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "my-orca-wt-"));
  try { assert.match(wtIdForGitDir(dir), /^[0-9a-f]{12}$/); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
