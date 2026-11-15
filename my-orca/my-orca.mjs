// my-orca: the Runner's safety pieces M13 to M15 (docs/spec-v2-converged.md 4.4, 4.9, 8.2.6).
// The CLI and the Runner loop are not written yet; this file only exports what the loop will call.
import { spawnSync } from "node:child_process";

// ---- M13: never run a destructive hc command against a core we did not expect ----

export class CoreGuardError extends Error {}

const destructive = (a) => a[0] === "kill" || a[0] === "rm" || (a[0] === "server" && (a[1] === "stop" || a[1] === "restart"));

// exec(args) -> { stdout }. Fails closed: any doubt about the core id refuses the command.
// shortcut: `hc server status` auto-starts a core when none answers; fine while the session is pinned by the caller's env.
export function guardedHc({ exec, expectCoreId, forbidCoreIds = [] }) {
  if (!expectCoreId) throw new CoreGuardError("expectCoreId is required");
  return (args) => {
    if (destructive(args)) {
      let id;
      try { id = JSON.parse(exec(["server", "status", "--json"]).stdout).core.id; }
      catch { throw new CoreGuardError(`refusing ${args[0]}: cannot read the core id`); }
      if (!id || id !== expectCoreId || forbidCoreIds.includes(id)) throw new CoreGuardError(`refusing ${args[0]}: core ${id} is not the expected core`);
    }
    return exec(args);
  };
}

// ---- M14: after killing a worker, sweep the processes that escaped hc kill ----
// hc kill leaves setsid/double-fork daemons alive (V42), so every worker, test and preflight
// is started with this env tag and the survivors are found by it. Cooperative, not a boundary:
// a process that clears its env escapes. shortcut: macOS ps (-E, lstart); Linux is deferred (4.7).

export const tagEnv = (dispatchId) => ({ ORCA_DISPATCH: dispatchId });

// lstart is locale dependent ("Mon Nov 16 ..." or en_AU "Mon 16 Nov ..."); psNow pins LC_ALL=C, the pattern accepts both anyway
const PS_LINE = /^\s*(\d+)\s+(\w{3}\s+(?:\w{3}\s+\d+|\d+\s+\w{3})\s+[\d:]{8}\s+\d{4})\s+(.*)$/;

export function parsePs(text) {
  return text.split("\n").flatMap((l) => {
    const m = PS_LINE.exec(l);
    return m ? [{ pid: Number(m[1]), started: m[2].replace(/\s+/g, " "), cmd: m[3] }] : [];
  });
}

// whole-token match, so tag d1 never matches d10; the raw ps text is never stored or printed
export const tagged = (procs, dispatchId, selfPid = process.pid) =>
  procs.filter((p) => p.pid !== selfPid && p.cmd.split(/\s+/).includes(`ORCA_DISPATCH=${dispatchId}`));

const psNow = () => spawnSync("ps", ["-Eww", "-o", "pid=,lstart=,command=", "-u", String(process.getuid())], { encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, LC_ALL: "C" } }).stdout ?? "";

// -> { clean, killed: pids, remaining: pids }. clean=false means needs_user `sweep_incomplete`: do not accept the result.
export async function sweep(dispatchId, { ps = psNow, kill = (pid, sig) => process.kill(pid, sig), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), selfPid = process.pid, rounds = 4, graceMs = 300 } = {}) {
  const killed = [];
  for (let round = 0; round < rounds; round++) {
    const found = tagged(parsePs(ps()), dispatchId, selfPid);
    if (!found.length) return { clean: true, killed, remaining: [] };
    // re-read right before killing: a pid whose start time changed was reused by someone else
    for (const p of tagged(parsePs(ps()), dispatchId, selfPid)) {
      if (!found.some((f) => f.pid === p.pid && f.started === p.started)) continue;
      try { kill(p.pid, round < 2 ? "SIGTERM" : "SIGKILL"); killed.push(p.pid); } catch { /* already gone */ }
    }
    await sleep(graceMs);
  }
  const remaining = tagged(parsePs(ps()), dispatchId, selfPid).map((p) => p.pid);
  return { clean: remaining.length === 0, killed, remaining };
}

// ---- M15: Tuning-written rework tasks are untrusted until structure, command policy and preflight pass ----

const TRIVIAL = /^\s*(true|:|exit\s+0|echo\b[^|&;]*)\s*;?\s*$/;
// shortcut: a denylist is a tripwire, not a boundary (`sh script.sh` hides anything); the sandboxed preflight is the real gate
const RISKY = /\b(curl|wget|sudo|ssh|scp|nc)\b|\bgit\s+(push|clone|remote|fetch|pull)\b|\bnpm\s+(i|ci|install|publish)\b|\bpip3?\s+install\b|\bbrew\s+install\b|\$\{?HOME\b|(^|\s)~(\/|\s|$)|(^|[\s/="'])\.\.(\/|\s|$|["'])/;

export function checkCommand(cmd) {
  if (typeof cmd !== "string" || !cmd.trim()) return "empty command";
  if (TRIVIAL.test(cmd)) return "trivial command proves nothing";
  if (RISKY.test(cmd)) return "command needs network, privileges or paths outside the worktree";
  return null;
}

const MAX_NEW = 10; // D13

// -> { ok, code, errors, tasks }. code is the needs_user / review-rejection code: bad_review (counts toward E20's 2 tries) or rework_too_large (D13).
export function reworkGate(newTasks, { cycle, existingIds }) {
  const bad = (errors) => ({ ok: false, code: "bad_review", errors, tasks: [] });
  if (!Array.isArray(newTasks) || !newTasks.length) return bad(["new_tasks is empty"]);
  if (newTasks.length > MAX_NEW) return { ok: false, code: "rework_too_large", errors: [`${newTasks.length} new tasks, max ${MAX_NEW}`], tasks: [] };
  const ids = newTasks.map((_, i) => `R${cycle}-${String(i + 1).padStart(2, "0")}`);
  const errors = [];
  const tasks = newTasks.map((t, i) => {
    const at = `new_tasks[${i}]`;
    if (typeof t?.title !== "string" || !t.title.trim()) errors.push(`${at}: title`);
    const why = checkCommand(t?.test);
    if (why) errors.push(`${at}: test: ${why}`);
    const deps = (Array.isArray(t?.deps) ? t.deps : []).map((d) => {
      const m = /^@(\d+)$/.exec(d);
      if (m) { // "@n" = the n-th task of this batch, earlier ones only, so no cycle is possible (E22)
        const n = Number(m[1]);
        if (n >= 1 && n <= i) return ids[n - 1];
      } else if (existingIds.includes(d)) return d;
      errors.push(`${at}: dep ${JSON.stringify(d)}`);
      return d;
    });
    return { id: ids[i], kind: "rework", title: t?.title, test: t?.test, deps, cycle, state: "pending", attempts: [], preflight: "pending" };
  });
  return errors.length ? bad(errors) : { ok: true, code: null, errors: [], tasks };
}

// a rework task never runs before its command passed the sandboxed preflight
export const isRunnable = (task) => task.kind !== "rework" || task.preflight === "passed";
