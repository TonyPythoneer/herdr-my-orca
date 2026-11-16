#!/usr/bin/env node
// End-to-end fake integration on a DEDICATED Herdr core. It never touches the user's core:
// every hc call carries HC_SESSION plus a scratch XDG config/state/data root (V36, V60).
// Run: node my-orca/fake-e2e.mjs
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "my-orca.mjs");
const fakeBin = path.join(here, "fake-bin");
const base = `/tmp/mo-fake-${process.pid}`;
const repo = path.join(base, "repo");
const remote = path.join(base, "remote.git");
const stateHome = path.join(base, "state");
const session = `mo-${process.pid}`;
const mode = process.env.ORCA_FAKE_MODE ?? "report";
const expectedCode = { "commit-nopush": "unpushed", noresult: "exit_without_result", block: "blocked", failtest: "task_failed" }[mode] ?? null;

const env = {
  ...process.env,
  HC_SESSION: session,
  XDG_CONFIG_HOME: path.join(base, "c"),
  XDG_STATE_HOME: path.join(base, "s"),
  XDG_DATA_HOME: path.join(base, "d"),
  MY_ORCA_HOME: stateHome,
  HERDR_APP_HOME: process.env.HERDR_APP_HOME ?? path.join(process.env.HOME, ".config/herdr-app"),
  PATH: `${fakeBin}:${process.env.PATH}`,
  ORCA_FAKE_MODE: mode,
};
delete env.HC_TERMINAL_ID;
delete env.HC_SCOPE;

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { env, encoding: "utf8", ...opts });
const hc = (args, opts = {}) => sh("hc", args, opts);
const git = (args, cwd = repo) => sh("git", args, { cwd });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const exists = (file) => fs.existsSync(file);

function step(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

async function waitFor(fn, ms = 60_000, every = 250) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  return null;
}

// Set only once the dedicated core is proven to differ from the owner's; until then cleanup() must not touch hc.
let ownCoreVerified = false;

function cleanup() {
  if (!ownCoreVerified) { try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ } return; }
  try {
    hc(["kill", `orca-r-${wtId()}`, "--json"]);
    for (const role of ["dev", "tuning", "runner"]) {
      const r = hc(["ls", "--all", "--json", "--label", `orca.role=${role}`]);
      try {
        for (const t of JSON.parse(r.stdout).terminals ?? []) hc(["rm", t.address]);
      } catch { /* none */ }
    }
  } catch { /* best effort */ }
  try { hc(["server", "stop"]); } catch { /* best effort */ }
  try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ }
}

let stateDir = null;
const wtId = () => stateDir ? path.basename(stateDir) : "";

async function main() {
  fs.rmSync(base, { recursive: true, force: true });
  for (const d of [base, path.join(base, "c"), path.join(base, "s"), path.join(base, "d"), stateHome]) fs.mkdirSync(d, { recursive: true });

  // The owner's core is read WITHOUT HC_SESSION; the dedicated core must differ, and the Runner is told to refuse it.
  const ownerEnv = { ...process.env }; delete ownerEnv.HC_SESSION;
  const coreOf = (e) => { try { return JSON.parse(spawnSync("hc", ["server", "status", "--json"], { env: e, encoding: "utf8" }).stdout)?.core?.id ?? null; } catch { return null; } };
  const ownerCore = coreOf(ownerEnv);
  if (ownerCore) env.MY_ORCA_FORBID_CORE_IDS = ownerCore;
  step("dedicated core starts", hc(["server", "status"]).status === 0);
  const ownCore = coreOf(env);
  if (!step("dedicated core is not the owner's core", Boolean(ownCore) && ownCore !== ownerCore)) return;
  ownCoreVerified = true;
  step("bare remote and repo", git(["init", "--bare", remote], base).status === 0 && git(["init", "-b", "feat", repo], base).status === 0);
  git(["config", "user.email", "fake@example.com"]);
  git(["config", "user.name", "Fake"]);
  fs.writeFileSync(path.join(repo, "README.md"), "fake e2e\n");
  fs.writeFileSync(path.join(repo, ".gitignore"), "late.txt\n");
  step("base commit", git(["add", "-A"]).status === 0 && git(["commit", "-m", "base"]).status === 0);
  git(["remote", "add", "origin", remote]);
  step("upstream created", git(["push", "-u", "origin", "feat"]).status === 0);

  const handoff = `# Handoff
## 1. Requirements and Context
fake
## 2. Technical Findings
fake
## 3. Feasibility Evidence
fake
## 4. Architecture and Implementation Strategy
fake
## 5. Tasks
T-01
## 6. Subtasks, if needed
none
## 7. Tests
test -f fake-T-01.txt
## 8. Acceptance Criteria
AC-1
## 9. Edge Cases and Risks
none
## 10. Open Questions and Known Limitations
none
`;
  const tasks = {
    schema: 1,
    tasks: [{ id: "T-01", title: "fake task", test: "test -f fake-T-01.txt", deps: [] }],
    acceptance: [{ id: "AC-1", text: "fake file exists", verify: "test -f fake-T-01.txt" }],
  };
  fs.writeFileSync(path.join(repo, "handoff.md"), handoff);
  fs.writeFileSync(path.join(repo, "tasks.json"), JSON.stringify(tasks, null, 2));

  const plan = hc(["run", "--bg", "--no-parent", "--no-notify", "--json", "--name", "mo-plan", "--cwd", repo,
    "--", "/usr/bin/env", "ORCA_FAKE_PLANNING_SHELL=1", "claude", "--dangerously-skip-permissions", "--model", "fake", "--effort", "low"]);
  const planJson = JSON.parse(plan.stdout || "{}");
  const planAddr = planJson.address;
  step("planning terminal", plan.status === 0 && Boolean(planAddr), planAddr ?? plan.stderr);
  if (!planAddr) throw new Error("no planning terminal");

  const initCmd = `node ${JSON.stringify(script)} init --handoff ${JSON.stringify(path.join(repo, "handoff.md"))} --tasks ${JSON.stringify(path.join(repo, "tasks.json"))} --no-start`;
  const send = sh("hc", ["send", planAddr, initCmd]);
  step("init command delivered", send.status === 0, send.stderr);

  stateDir = await waitFor(() => {
    try {
      const dirs = fs.readdirSync(stateHome).filter((d) => /^[0-9a-f]{12}$/.test(d));
      return dirs.length ? path.join(stateHome, dirs[0]) : null;
    } catch { return null; }
  }, 20_000);
  step("init wrote state", Boolean(stateDir), stateDir ?? "missing");
  if (!stateDir) {
    console.error("--- planning terminal ---\n" + (hc(["read", planAddr]).stdout || ""));
    throw new Error("init did not produce state");
  }

  const started = sh("node", [script, "start", wtId()], { cwd: repo });
  step("Runner started", started.status === 0, started.stdout + started.stderr);

  const final = await waitFor(() => {
    try {
      const s = readJson(path.join(stateDir, "state.json"));
      return s.status === "completed" || s.status === "needs_user" ? s : null;
    } catch { return null; }
  }, 90_000);
  step("run finished", Boolean(final), final?.status ?? "timeout");
  if (!final) throw new Error("run did not finish");
  if (expectedCode) {
    step(`needs_user ${expectedCode}`, final.status === "needs_user" && final.needs_user?.code === expectedCode, `${final.status}/${final.needs_user?.code ?? "-"}`);
    return;
  }
  step("ready_for_review", final.stage === "ready_for_review" && final.status === "completed", `${final.stage}/${final.status}`);
  step("task accepted", final.tasks?.[0]?.state === "accepted", final.tasks?.[0]?.state);
  step("review pass", final.reviews?.some((r) => r.verdict === "pass"), `${final.reviews?.length ?? 0} review(s)`);
  if (process.env.ORCA_FAKE_VERDICT === "rework-once") {
    step("one rework cycle", final.rework?.cycles === 1 && final.tasks?.length === 2 && final.tasks[1].id === "R1-01" && final.tasks[1].state === "accepted", `cycles=${final.rework?.cycles} tasks=${final.tasks?.length}`);
  }
  if (mode === "fix-once") {
    step("Tuning direct fix revalidated", final.rework?.cycles === 1 && final.reviews?.some((r) => r.stale === true) && final.reviews?.some((r) => r.verdict === "pass"), `cycles=${final.rework?.cycles} reviews=${final.reviews?.length}`);
  }
  step("planning tab kept (default off)", final.planning?.closed === "skipped:disabled", final.planning?.closed);

  const localLog = git(["log", "--format=%s"]);
  step("worker committed", /orca\(T-01\):/.test(localLog.stdout), localLog.stdout.split("\n")[0]);
  const remoteLog = sh("git", ["--git-dir", remote, "log", "--format=%s", "feat"]);
  step("worker pushed to the bare remote", /orca\(T-01\):/.test(remoteLog.stdout));
  step("upstream is even", git(["rev-list", "--count", "@{u}..HEAD"]).stdout.trim() === "0");
  step("working tree clean", git(["status", "--porcelain"]).stdout.trim() === "");

  const events = fs.readFileSync(path.join(stateDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  step("kill events carry the run", events.filter((e) => e.type === "kill").every((e) => e.run === final.run_id), `${events.filter((e) => e.type === "kill").length} kill(s)`);
  step("no live workflow terminals", hc(["ls", "--json", "--label", `orca.run=${final.run_id}`]).stdout.includes('"terminals":[]'), hc(["ls", "--json", "--label", `orca.run=${final.run_id}`]).stdout);

  console.log(process.exitCode ? "\nFAILED: state kept at " + stateDir : "\nAll fake integration checks passed.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
  if (process.exitCode) {
    try {
      console.error("state:", stateDir);
      if (stateDir) {
        console.error(fs.readFileSync(path.join(stateDir, "state.json"), "utf8"));
        console.error(fs.readFileSync(path.join(stateDir, "events.jsonl"), "utf8"));
      }
    } catch { /* ignore */ }
  }
  cleanup();
});
