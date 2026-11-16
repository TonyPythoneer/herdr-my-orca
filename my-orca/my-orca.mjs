#!/usr/bin/env node
// my-orca: the workflow Runner for herdr-orca (docs/spec-v2-converged.md).
// One file, zero dependencies. The pure pieces are exported so `node --test my-orca`
// can check them without a Herdr core; the CLI is at the bottom.
//
// Safety rules this file follows:
// - Runner never runs git commit/reset/stash/checkout/push; init may run `git push -u`.
// - Destructive hc commands run only after the core id matches state.core_id (M13).
// - state.json is tmp + fsync + rename, and a second writer is refused (M3).
// - No full argv, environment or terminal screen is written to state/events (D15).
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

export const SCHEMA = 1;
export const DEFAULT_CONFIG = Object.freeze({
  max_rework_cycles: 3,
  close_planning_tab: false,
  ack_timeout_s: 120,
  dev_timeout_min: 60,
  tuning_timeout_min: 60,
  test_timeout_min: 15,
  poll_s: 10,
  hc_retry_min: 5,
  stopped_grace_s: 60,
});

export const CONFIG_RULES = Object.freeze({
  max_rework_cycles: { min: 1, max: 9, type: "int" },
  close_planning_tab: { type: "bool" },
  ack_timeout_s: { min: 10, max: 600, type: "int" },
  dev_timeout_min: { min: 1, max: 240, type: "int" },
  tuning_timeout_min: { min: 1, max: 240, type: "int" },
  test_timeout_min: { min: 1, max: 60, type: "int" },
  poll_s: { min: 2, max: 60, type: "int" },
  hc_retry_min: { min: 1, max: 30, type: "int" },
  stopped_grace_s: { min: 10, max: 600, type: "int" },
});

export const HANDOFF_SECTIONS = Object.freeze([
  "Requirements and Context",
  "Technical Findings",
  "Feasibility Evidence",
  "Architecture and Implementation Strategy",
  "Tasks",
  "Subtasks, if needed",
  "Tests",
  "Acceptance Criteria",
  "Edge Cases and Risks",
  "Open Questions and Known Limitations",
]);

const MAX_HANDOFF = 256 * 1024;
const MAX_RESULT = 256 * 1024;
const MAX_SCREEN = 64 * 1024;
const MAX_FAILURE_EXCERPT = 16 * 1024;
const MAX_NEW_TASKS = 10;
const MAX_TASKS = 100;

// ---------------------------------------------------------------------------
// small utilities

export const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
export const nowMs = () => performance.now();
export const wallIso = () => new Date().toISOString();
export const utcStamp = (d = new Date()) => d.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
export const realpath = (p) => fs.realpathSync(p);
export const sha12 = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
export const randomId = () => crypto.randomBytes(4).toString("hex");
export const truncate = (text, n) => (String(text ?? "").length > n ? String(text).slice(0, n) + "\n… (truncated)" : String(text ?? ""));

export function stateHome(env = process.env) {
  return env.MY_ORCA_HOME || path.join(env.HOME || os.homedir(), ".config", "herdr-app", "my-orca");
}

export function wtIdForGitDir(gitDir) {
  return sha12(realpath(gitDir));
}

export function runIdFor(wtId, d = new Date()) {
  return `${wtId}-${utcStamp(d)}`;
}

export async function readTextMaybe(file) {
  try { return await fsp.readFile(file, "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
}

export async function readJsonMaybe(file) {
  const text = await readTextMaybe(file);
  if (text === null) return null;
  return JSON.parse(text);
}

export async function writeAtomic(file, text, mode = 0o600) {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}-${randomId()}`);
  const handle = await fsp.open(tmp, "wx", mode);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(tmp, file);
  try {
    const dh = await fsp.open(dir, "r");
    try { await dh.sync(); } finally { await dh.close(); }
  } catch { /* directory fsync is best effort on macOS */ }
}

export async function appendEvent(eventsFile, ev) {
  const line = JSON.stringify({ ts: wallIso(), ...ev }) + "\n";
  await fsp.mkdir(path.dirname(eventsFile), { recursive: true, mode: 0o700 });
  await fsp.appendFile(eventsFile, line, { mode: 0o600 });
}

export class StaleStateError extends Error {}

// Writes state.json atomically. `expectedUpdated` is the value this process last wrote;
// a different value on disk means another writer exists (M3), so refuse.
export async function writeState(stateDir, state, expectedUpdated = undefined) {
  const file = path.join(stateDir, "state.json");
  if (expectedUpdated !== undefined) {
    const disk = await readJsonMaybe(file).catch(() => null);
    if (!disk || disk.updated !== expectedUpdated) {
      throw new StaleStateError(`state.json changed underneath the Runner (disk ${disk?.updated ?? "missing"}, expected ${expectedUpdated})`);
    }
  }
  state.schema = SCHEMA;
  state.updated = Math.max(Date.now(), Number(state.updated) + 1 || 0);
  state.updated_at = wallIso();
  await writeAtomic(file, JSON.stringify(state, null, 2) + "\n");
  return state.updated;
}

// ---------------------------------------------------------------------------
// config

export function checkConfigValue(key, value) {
  const rule = CONFIG_RULES[key];
  if (!rule) return `unknown config key: ${key}`;
  if (rule.type === "bool") {
    if (value === true || value === "true") return null;
    if (value === false || value === "false") return null;
    return `${key} must be true or false`;
  }
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n)) return `${key} must be an integer`;
  if (n < rule.min || n > rule.max) return `${key} must be ${rule.min}..${rule.max}`;
  return null;
}

export function normalizeConfigValue(key, value) {
  if (CONFIG_RULES[key]?.type === "bool") return value === true || value === "true";
  return Number(value);
}

export function resolveConfig(raw) {
  const config = { ...DEFAULT_CONFIG };
  const ignored = [];
  for (const [key, value] of Object.entries(isObject(raw) ? raw : {})) {
    const bad = checkConfigValue(key, value);
    if (bad) { ignored.push({ key, value, reason: bad }); continue; }
    config[key] = normalizeConfigValue(key, value);
  }
  return { config, ignored };
}

export async function readConfig(root) {
  const raw = await readJsonMaybe(path.join(root, "config.json")).catch(() => null);
  return resolveConfig(raw);
}

// ---------------------------------------------------------------------------
// handoff / tasks validation (D14)

const TRIVIAL = /^\s*(true|:|exit\s+0|echo\b[^|&;]*)\s*;?\s*$/;

export function checkCommand(cmd) {
  if (typeof cmd !== "string" || !cmd.trim()) return "empty command";
  if (cmd.length > 4000) return "command is too long";
  if (TRIVIAL.test(cmd)) return "trivial command proves nothing";
  return null;
}

export function scanSecrets(text) {
  const patterns = [
    { kind: "sk", re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
    { kind: "aws", re: /\bAKIA[0-9A-Z]{16}\b/g },
    { kind: "github", re: /\bghp_[A-Za-z0-9]{20,}\b/g },
    { kind: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  ];
  const lines = String(text ?? "").split(/\r?\n/);
  const hits = [];
  lines.forEach((line, i) => {
    for (const p of patterns) {
      p.re.lastIndex = 0;
      if (p.re.test(line)) hits.push({ line: i + 1, kind: p.kind });
    }
  });
  return hits;
}

const normalizeHeading = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function checkHandoff(handoffText) {
  const errors = [];
  if (typeof handoffText !== "string") return ["handoff.md is missing or unreadable"];
  if (Buffer.byteLength(handoffText, "utf8") > MAX_HANDOFF) errors.push(`handoff.md is larger than ${MAX_HANDOFF} bytes`);
  const headings = String(handoffText).split(/\r?\n/)
    .filter((l) => /^\s{0,3}#{1,6}\s+/.test(l))
    .map(normalizeHeading);
  for (const section of HANDOFF_SECTIONS) {
    const needle = normalizeHeading(section);
    if (!headings.some((h) => h === needle || h.endsWith(" " + needle))) errors.push(`handoff.md is missing section: ${section}`);
  }
  return errors;
}

export function validateTasksDoc(doc) {
  const errors = [];
  if (!isObject(doc)) return ["tasks.json must be a JSON object"];
  if (!Array.isArray(doc.tasks)) return ["tasks.json: tasks must be an array"];
  if (doc.tasks.length < 1) errors.push("tasks.json: at least one task is required");
  if (doc.tasks.length > MAX_TASKS) errors.push(`tasks.json: at most ${MAX_TASKS} tasks`);
  const ids = new Set();
  const deps = new Map();
  doc.tasks.forEach((t, i) => {
    const at = `tasks[${i}]`;
    if (!isObject(t)) { errors.push(`${at}: must be an object`); return; }
    if (typeof t.id !== "string" || !/^[A-Z]+-\d+$/.test(t.id)) errors.push(`${at}: id must match ^[A-Z]+-\\d+$`);
    else if (/^R\d+-/.test(t.id)) errors.push(`${at}: id ${t.id} uses the reserved rework prefix`);
    else if (ids.has(t.id)) errors.push(`${at}: duplicate id ${t.id}`);
    else ids.add(t.id);
    if (typeof t.title !== "string" || !t.title.trim()) errors.push(`${at}: title is empty`);
    const bad = checkCommand(t.test);
    if (bad) errors.push(`${at}: test: ${bad}`);
    const d = t.deps ?? [];
    if (!Array.isArray(d) || d.some((x) => typeof x !== "string")) errors.push(`${at}: deps must be an array of strings`);
    else deps.set(t.id, d);
  });
  for (const t of doc.tasks) {
    if (!isObject(t) || typeof t.id !== "string") continue;
    for (const d of (Array.isArray(t.deps) ? t.deps : [])) {
      if (!ids.has(d)) errors.push(`tasks: ${t.id} depends on missing id ${d}`);
    }
  }
  // cycle detection
  const mark = new Map();
  const visit = (id, trail) => {
    if (mark.get(id) === 1) { errors.push(`tasks: dependency cycle: ${[...trail, id].join(" -> ")}`); return; }
    if (mark.get(id) === 2) return;
    mark.set(id, 1);
    for (const d of deps.get(id) ?? []) if (deps.has(d)) visit(d, [...trail, id]);
    mark.set(id, 2);
  };
  for (const id of deps.keys()) visit(id, []);

  if (!Array.isArray(doc.acceptance)) errors.push("tasks.json: acceptance must be an array");
  else {
    if (doc.acceptance.length < 1) errors.push("tasks.json: at least one acceptance criterion is required");
    const acIds = new Set();
    let hasVerify = false;
    doc.acceptance.forEach((a, i) => {
      const at = `acceptance[${i}]`;
      if (!isObject(a)) { errors.push(`${at}: must be an object`); return; }
      if (typeof a.id !== "string" || !/^AC-\d+$/.test(a.id)) errors.push(`${at}: id must match ^AC-\\d+$`);
      else if (acIds.has(a.id)) errors.push(`${at}: duplicate id ${a.id}`);
      else acIds.add(a.id);
      if (typeof a.text !== "string" || !a.text.trim()) errors.push(`${at}: text is empty`);
      const isManual = a.manual === true;
      const hasCmd = typeof a.verify === "string" && Boolean(a.verify.trim());
      if (!isManual && !hasCmd) errors.push(`${at}: needs verify or manual: true`);
      if (isManual && hasCmd) errors.push(`${at}: use either verify or manual: true`);
      if (hasCmd && a.manual !== true) {
        const bad = checkCommand(a.verify);
        if (bad) errors.push(`${at}: verify: ${bad}`);
        else hasVerify = true;
      }
    });
    if (!hasVerify) errors.push("tasks.json: at least one acceptance criterion needs a verify command");
  }
  return errors;
}

export function validateHandoffFiles(handoffText, tasksText) {
  const errors = [...checkHandoff(handoffText)];
  let doc = null;
  try { doc = JSON.parse(tasksText); } catch { errors.push("tasks.json is not valid JSON"); }
  if (doc) errors.push(...validateTasksDoc(doc));
  if (typeof handoffText === "string") {
    for (const hit of scanSecrets(handoffText)) errors.push(`handoff.md:${hit.line}: possible secret (${hit.kind})`);
  }
  if (typeof tasksText === "string") {
    for (const hit of scanSecrets(tasksText)) errors.push(`tasks.json:${hit.line}: possible secret (${hit.kind})`);
  }
  return { ok: errors.length === 0, errors, doc };
}

// ---------------------------------------------------------------------------
// profile parsing (4.5)

const CLI_NAMES = new Set(["claude", "codex"]);

function cliBase(token) {
  const base = path.basename(String(token ?? ""));
  return CLI_NAMES.has(base) ? base : null;
}

export function parseProfile(argv, overrides = {}) {
  const list = Array.isArray(argv) ? argv.map(String) : [];
  let idx = list.findIndex((a) => cliBase(a));
  let cli = idx >= 0 ? cliBase(list[idx]) : null;
  const args = idx >= 0 ? list.slice(idx + 1) : [];
  if (!cli) return { ok: false, code: "unsupported_cli", error: "Planning CLI must be claude or codex" };

  const flag = (names) => {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      for (const name of names) {
        if (a === name) return args[i + 1] ?? null;
        if (a.startsWith(name + "=")) return a.slice(name.length + 1);
      }
    }
    return null;
  };
  const model = overrides.model || (cli === "claude" ? flag(["--model"]) : flag(["-m", "--model"]));
  let effort = overrides.effort || flag(["--effort"]);
  if (!effort && cli === "codex") {
    const c = flag(["-c"]);
    if (c && /^model_reasoning_effort=/.test(c)) effort = c.split("=").slice(1).join("=");
    for (let i = 0; i < args.length - 1; i++) {
      if (args[i] === "-c" && /^model_reasoning_effort=/.test(args[i + 1] ?? "")) effort = args[i + 1].split("=").slice(1).join("=");
    }
  }
  if (!model || !String(model).trim()) return { ok: false, code: "missing_model", error: "Planning argv has no model; pass --model" };
  if (!effort || !String(effort).trim()) return { ok: false, code: "missing_effort", error: "Planning argv has no effort; pass --effort" };
  return { ok: true, profile: { cli, model: String(model), effort: String(effort) } };
}

export function profileArgv(profile, prompt) {
  if (profile.cli === "claude") {
    return ["claude", "--dangerously-skip-permissions", "--model", profile.model, "--effort", profile.effort, prompt];
  }
  if (profile.cli === "codex") {
    return ["codex", "--no-daemon", "-c", "disable_paste_burst=true", "--dangerously-bypass-approvals-and-sandbox",
      "-m", profile.model, "-c", `model_reasoning_effort=${profile.effort}`, prompt];
  }
  throw new Error(`unsupported profile cli: ${profile.cli}`);
}

// ---------------------------------------------------------------------------
// state / progress

export function makeInitialTasks(doc) {
  return doc.tasks.map((t) => ({
    id: t.id, kind: "dev", title: t.title, test: t.test, deps: [...(t.deps ?? [])],
    cycle: 0, state: "pending", attempts: [],
  }));
}

export function makeAcceptance(doc) {
  return doc.acceptance.map((a) => ({
    id: a.id, text: a.text,
    ...(a.manual === true ? { manual: true } : { verify: a.verify }),
  }));
}

export function chooseNextTask(state) {
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  const accepted = new Set(tasks.filter((t) => t.state === "accepted").map((t) => t.id));
  const pending = tasks.filter((t) => t.state !== "accepted");
  if (!pending.length) return { done: true };
  const ready = pending.find((t) => (t.state === "pending") && (t.deps ?? []).every((d) => accepted.has(d)));
  if (ready) return { task: ready };
  return { blocked: true, pending: pending.map((t) => t.id) };
}

const STAGE_META = [
  { id: "planning", label: "Plan", long: "Planning", color: "#7E66CC" },
  { id: "development", label: "Dev", long: "Development & Testing", color: "#367CE9" },
  { id: "tuning", label: "Tune", long: "Validation & Final Tuning", color: "#C38B35" },
  { id: "ready", label: "Ready", long: "Ready for Review", color: "#139D78" },
];

// Pure: the four lights. `state` is state.json. Status treatment is separate from stage colour.
export function lights(state) {
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  const acceptance = Array.isArray(state?.acceptance) ? state.acceptance : [];
  const reviews = Array.isArray(state?.reviews) ? state.reviews : [];
  const accepted = tasks.filter((t) => t.state === "accepted").length;
  const latest = [...reviews].reverse().find((r) => !r.stale);
  const passedAc = latest ? (latest.criteria ?? []).filter((c) => c.pass === true).length : 0;
  const overall = state?.status ?? "working";
  const at = (id, acceptedN, total, stageState) => {
    const meta = STAGE_META.find((m) => m.id === id);
    return { ...meta, accepted: acceptedN, total, state: stageState };
  };

  const ready = state?.stage === "ready_for_review" || overall === "completed";
  const devDone = ready || (tasks.length > 0 && accepted === tasks.length);
  const devState = devDone ? "complete" : (tasks.length ? "working" : "pending");
  const tuningState = state?.stage === "ready_for_review" || overall === "completed" ? "complete"
    : (acceptance.length && passedAc === acceptance.length && latest ? "complete" : (state?.stage === "tuning" || tasks.length ? "working" : "pending"));
  const readyState = state?.stage === "ready_for_review" || overall === "completed" ? "complete" : "pending";
  const out = [
    at("planning", 1, 1, "complete"),
    at("development", accepted, tasks.length, devState),
    at("tuning", passedAc, acceptance.length, tuningState),
    at("ready", readyState === "complete" ? 1 : 0, 1, readyState),
  ];
  if (overall === "needs_user") {
    const idx = state?.stage === "tuning" ? 2 : state?.stage === "ready_for_review" ? 3 : 1;
    out[idx].state = "needs_user";
  }
  if (overall === "failed") out[1].state = "failed";
  return out;
}

// Pure: inspector rows. `terminals` is state.json's worker terminals (or herdr terminals()).
export function inspector(state, terminals = []) {
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  const runs = Array.isArray(terminals) ? terminals : [];
  const byDispatch = new Map(runs.filter((t) => t?.labels?.["orca.dispatch"]).map((t) => [t.labels["orca.dispatch"], t]));
  const active = state?.dispatch?.id ?? null;
  const activeTask = state?.dispatch?.task ?? null;
  return {
    run_id: state?.run_id ?? null,
    stage: state?.stage ?? null,
    status: state?.status ?? null,
    needs_user: state?.needs_user ?? null,
    planning_closed: state?.planning?.closed ?? null,
    cycles: state?.rework?.cycles ?? 0,
    acceptance: (state?.acceptance ?? []).map((a) => ({ id: a.id, text: a.text, manual: a.manual === true })),
    tasks: tasks.map((t) => {
      const dispatchId = active && activeTask === t.id ? active : t.last_dispatch;
      const live = dispatchId ? byDispatch.get(dispatchId) : null;
      return {
        id: t.id, kind: t.kind, title: t.title, state: t.state, cycle: t.cycle,
        attempts: (t.attempts ?? []).length,
        test: t.test,
        terminal: live ? { address: live.address, state: live.state ?? live.status ?? null } : null,
      };
    }),
    reviews: (state?.reviews ?? []).map((r) => ({ dispatch: r.dispatch, verdict: r.verdict, stale: Boolean(r.stale), at: r.at })),
  };
}

export function publicStatus(state) {
  return { state, lights: lights(state), inspector: inspector(state) };
}

// ---------------------------------------------------------------------------
// git adapter (read-only helpers except init's push -u / dry-run)

export function makeGit(exec = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8", timeout: 60_000 })) {
  const run = (args, cwd) => {
    const r = exec(args, cwd);
    return { code: r.status ?? r.code ?? 1, stdout: String(r.stdout ?? "").trim(), stderr: String(r.stderr ?? "").trim() };
  };
  const info = (cwd) => {
    const top = run(["rev-parse", "--show-toplevel"], cwd);
    if (top.code !== 0) return { ok: false, error: "not_a_repo", detail: top.stderr };
    const toplevel = realpath(top.stdout);
    const gitDir = run(["rev-parse", "--path-format=absolute", "--git-dir"], cwd);
    const commonDir = run(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
    const branch = run(["symbolic-ref", "-q", "--short", "HEAD"], cwd);
    const head = run(["rev-parse", "HEAD"], cwd);
    const porcelain = run(["status", "--porcelain"], cwd);
    const upstream = run(["rev-parse", "--abbrev-ref", "@{u}"], cwd);
    const ahead = upstream.code === 0 ? run(["rev-list", "--count", "@{u}..HEAD"], cwd) : { code: 1, stdout: "" };
    return {
      ok: true,
      toplevel,
      git_dir: gitDir.code === 0 ? realpath(gitDir.stdout) : null,
      common_dir: commonDir.code === 0 ? realpath(commonDir.stdout) : null,
      branch: branch.code === 0 ? branch.stdout : null,
      head: head.code === 0 ? head.stdout : null,
      dirty: porcelain.stdout ? porcelain.stdout.split("\n").filter(Boolean) : [],
      upstream: upstream.code === 0 ? upstream.stdout : null,
      ahead: ahead.code === 0 ? Number(ahead.stdout) : null,
    };
  };
  const isAncestor = (a, b, cwd) => run(["merge-base", "--is-ancestor", a, b], cwd).code === 0;
  const commitsSince = (a, cwd) => {
    const r = run(["rev-list", "--count", `${a}..HEAD`], cwd);
    return r.code === 0 ? Number(r.stdout) : null;
  };
  return { run, info, isAncestor, commitsSince };
}

export function dispatchCheck(state, info, { first = false } = {}) {
  const tree = [];
  const push = [];
  if (!info.ok) return { ok: false, code: "tree_changed", detail: info.detail ?? info.error };
  if (info.branch !== state.repo.branch) tree.push(`branch changed: ${state.repo.branch} -> ${info.branch}`);
  if (info.head !== state.repo.head) tree.push(`HEAD moved: ${state.repo.head} -> ${info.head}`);
  const dirtyAllowed = first && Array.isArray(state.repo.dirty_at_start) && state.repo.dirty_at_start.length > 0 && !state.repo.first_commit_seen;
  if (info.dirty.length && !dirtyAllowed) tree.push(`working tree is dirty (${info.dirty.length} path${info.dirty.length === 1 ? "" : "s"})`);
  if (!info.upstream) push.push("branch has no upstream");
  else if (info.ahead !== 0) push.push(`branch is ${info.ahead} commit(s) ahead of upstream`);
  const errors = [...tree, ...push];
  return errors.length ? { ok: false, code: tree.length ? "tree_changed" : "unpushed", detail: errors.join("; ") } : { ok: true };
}

export function pushCheck(state, info, git, stageHead) {
  const errors = [];
  if (!info.ok) return { ok: false, code: "unpushed", detail: info.detail ?? info.error };
  if (info.dirty.length) errors.push(`working tree is dirty (${info.dirty.length} path${info.dirty.length === 1 ? "" : "s"})`);
  if (!info.upstream) errors.push("branch has no upstream");
  else if (info.ahead !== 0) errors.push(`branch is ${info.ahead} commit(s) ahead of upstream`);
  const base = stageHead || state.repo.stage_head || state.repo.head;
  if (base && !git.isAncestor(base, info.head, info.toplevel)) errors.push(`HEAD is not a descendant of the stage base ${base}`);
  return errors.length ? { ok: false, code: "unpushed", detail: errors.join("; ") } : { ok: true };
}

// ---------------------------------------------------------------------------
// hc adapter

export class CoreGuardError extends Error {}
export class HcError extends Error {
  constructor(message, { code = null, json = null } = {}) { super(message); this.code = code; this.json = json; }
}

const destructive = (a) => a[0] === "kill" || a[0] === "rm" || (a[0] === "server" && (a[1] === "stop" || a[1] === "restart"));

// exec(args) -> { stdout }. Fails closed: any doubt about the core id refuses the command.
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

export function makeHc({ env = process.env, expectCoreId, forbidCoreIds = [], exec = null } = {}) {
  const rawExec = exec ?? ((args) => {
    const r = spawnSync("hc", [...args], { env, encoding: "utf8", maxBuffer: 32 << 20 });
    return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  });
  const json = (args, { allowFail = false } = {}) => {
    const r = rawExec([...args, "--json"]);
    let value = null;
    try { value = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { value = null; }
    if (!allowFail && (r.code !== 0 || r.error)) {
      const kind = value?.error?.kind ?? null;
      throw new HcError(`hc ${args.join(" ")} failed (${r.code}${kind ? `, ${kind}` : ""})`, { code: kind, json: value });
    }
    return { ...r, json: value, error: value?.error ?? null };
  };
  const reads = (args) => {
    const r = rawExec([...args, "--json"]);
    let value = null;
    try { value = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { value = null; }
    return { code: r.code ?? 0, json: value, error: value?.error ?? null, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  const guardExec = (args) => {
    const r = rawExec(args);
    if (r.code !== 0) throw new HcError(`hc ${args.join(" ")} failed`, { code: r.error?.kind ?? null });
    return r;
  };
  const guarded = expectCoreId ? guardedHc({ exec: guardExec, expectCoreId, forbidCoreIds }) : null;
  const get = (address) => {
    const r = reads(["get", address]);
    if (r.code !== 0) return null;
    return r.json;
  };
  const list = (labels = [], { all = false } = {}) => {
    const args = ["ls"];
    if (all) args.push("--all");
    for (const [k, v] of Object.entries(labels)) args.push("--label", `${k}=${v}`);
    const r = reads(args);
    const addresses = (r.json?.terminals ?? []).map((t) => t.address).filter(Boolean);
    return addresses.map(get).filter(Boolean);
  };
  const coreId = () => reads(["server", "status"]).json?.core?.id ?? null;
  const run = (args) => {
    const r = rawExec(["run", ...args]);
    let value = null;
    try { value = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { value = null; }
    return { ...r, json: value, error: value?.error ?? null };
  };
  return {
    raw: rawExec, json, reads, get, list, coreId, guarded, run,
    kill: (address) => guarded ? guarded(["kill", address]) : rawExec(["kill", address]),
    rm: (address) => guarded ? guarded(["rm", address]) : rawExec(["rm", address]),
  };
}

export function workerEnvPrefix({ dispatchId, cli = "dev", sessionEnv = process.env }) {
  const args = ["/usr/bin/env", "-u", "HC_TERMINAL_ID", "-u", "HC_SCOPE",
    "-u", "XDG_CONFIG_HOME", "-u", "XDG_STATE_HOME", "-u", "XDG_DATA_HOME"];
  if (cli === "tuning") {
    for (const key of Object.keys(sessionEnv)) if (key.startsWith("CLAUDE_CODE_")) args.push("-u", key);
  }
  args.push("GIT_TERMINAL_PROMPT=0", `ORCA_DISPATCH=${dispatchId}`);
  return args;
}

// ---------------------------------------------------------------------------
// commands run by the Runner (tests / verify); stdin closed, own process group

export function runShell(cmd, { cwd, dispatchId, timeoutMs, env = process.env } = {}) {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    const child = spawn("sh", ["-c", cmd], {
      cwd, detached: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...env, GIT_TERMINAL_PROMPT: "0", ...(dispatchId ? { ORCA_DISPATCH: dispatchId } : {}) },
    });
    const take = (b) => { if (output.length < MAX_FAILURE_EXCERPT * 4) output += b.toString("utf8"); };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
    }, Math.max(1000, timeoutMs));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? 124 : (code ?? (signal ? 128 : 1)), signal, timedOut, output });
    });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: 127, signal: null, timedOut: false, output: String(e.message) }); });
  });
}

// ---------------------------------------------------------------------------
// Runner

export class RunnerExit extends Error {}

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

async function refreshConfig(ctx) {
  const { config, ignored } = await readConfig(path.dirname(ctx.stateDir));
  ctx.config = config;
  for (const i of ignored) await ctx.event("config_ignored", { detail: { key: i.key, reason: i.reason } });
}

async function readResultFile(file) {
  let st;
  try { st = await fsp.stat(file); } catch { return { exists: false }; }
  if (st.size > MAX_RESULT) return { exists: true, tooLarge: true, size: st.size };
  const text = await fsp.readFile(file, "utf8");
  let json = null;
  try { json = JSON.parse(text); } catch { return { exists: true, badJson: true, text }; }
  return { exists: true, json, text, size: st.size };
}

async function saveScreen(ctx, dispatch, label = "screen") {
  try {
    const term = dispatch.address ? ctx.hc.get(dispatch.address) : null;
    if (!term) return null;
    const r = ctx.hc.reads ? ctx.hc.reads(["read", dispatch.address]) : null;
    const text = typeof r?.stdout === "string" ? r.stdout : "";
    const file = path.join(ctx.stateDir, "logs", `${dispatch.id}.${label}.txt`);
    await writeAtomic(file, truncate(text, MAX_SCREEN));
    return file;
  } catch { return null; }
}

// Builds a runner context with injectable dependencies (unit tests use fakes).
export function makeRunnerContext({ stateDir, state, hc, git, config, save, event, log = () => {}, sleep = sleepReal, clock = nowMs, env = process.env }) {
  return { stateDir, state, hc, git, config, save, event, log, sleep, clock, env, exits: false };
}

async function saveState(ctx) {
  const updated = await writeState(ctx.stateDir, ctx.state, ctx.lastUpdated);
  ctx.lastUpdated = updated;
}

function redact(text) {
  return String(text ?? "").replace(/https?:\/\/[^\s/@]+@/g, "https://***@");
}

async function needsUser(ctx, code, detail) {
  ctx.state.status = "needs_user";
  ctx.state.needs_user = { code, detail: redact(detail).slice(0, 2000), at: wallIso() };
  await saveState(ctx);
  await ctx.event("needs_user", { detail: { code, detail: redact(detail).slice(0, 500) } });
  ctx.log(`NEEDS_USER ${code}${detail ? `: ${redact(detail)}` : ""}`);
  return { stop: true, code };
}

async function ensureSetup(ctx) {
  await fsp.mkdir(path.join(ctx.stateDir, "logs"), { recursive: true, mode: 0o700 });
}

function dispatchMarkdown(ctx, dispatch, task) {
  const d = path.join(ctx.stateDir, "dispatch", `${dispatch.id}.md`);
  const result = path.join(ctx.stateDir, "results", `${dispatch.id}.json`);
  const ack = path.join(ctx.stateDir, "results", `${dispatch.id}.ack`);
  const review = path.join(ctx.stateDir, "reviews", `${dispatch.id}.json`);
  const out = dispatch.kind === "tuning" ? review : result;
  const prev = task?.attempts?.length ? task.attempts[task.attempts.length - 1] : null;
  let prevText = "";
  if (prev?.log) { try { prevText = fs.readFileSync(prev.log, "utf8"); } catch { prevText = ""; } }
  const prevExcerpt = prevText ? `\n## Previous failed attempt (excerpt)\n\n\`\`\`\n${truncate(prevText, MAX_FAILURE_EXCERPT)}\n\`\`\`\n` : "";

  if (dispatch.kind === "tuning") {
    const ac = (ctx.state.acceptance ?? []).map((a) => `- ${a.id}: ${a.text}${a.manual ? " (manual)" : ` — verify: \`${a.verify}\``}`).join("\n");
    return `# Tuning dispatch ${dispatch.id}

Read this file and follow it exactly. You are the independent Tuning session for this worktree.

1. First, create this empty delivery marker: \`${ack}\` (use \`: > ${ack}\`).
2. Inspect the work against every acceptance criterion below. Run the verify commands yourself.
3. Write exactly one JSON file at \`${review}\` with this shape:
   {"dispatch":"${dispatch.id}","verdict":"pass|rework|needs_user","criteria":[{"id":"AC-1","pass":true,"evidence":"..."}],"new_tasks":[{"title":"...","test":"...","deps":["T-01","@1"]}],"summary":"..."}
4. If you need a fix, prefer rework tasks (1 to 10). You may commit a small fix yourself, but then your review is stale and a new Tuning round will run.
5. Stop after writing the review file. Do not start background processes, servers, watchers or sub-agents.

## Acceptance criteria

${ac}

## Constraints (verbatim)

1. Network: no outbound network except \`git push\` in this cycle.
2. Scope: this worktree only; do not touch other branches, worktrees or \$HOME.
3. Git: every task has at least one commit \`orca(<task-id>): ...\` and a plain \`git push\`; never force, amend, rebase or switch branches.
4. No background processes (\`nohup\`, \`&\`, \`setsid\`, servers, watchers) and no sub-agents.
5. Every test/verify command was reviewed and approved by the user; no empty tests.
6. Test artefacts must be covered by \`.gitignore\`.
7. Tuning may make small fixes, but that counts as one rework cycle.
`;
  }

  return `# Dispatch ${dispatch.id} — ${task.id}

Read this file and follow it exactly. Do nothing else first.

1. First, create this empty delivery marker: \`${ack}\` (use \`: > ${ack}\`).
2. Do this task: **${task.title}**.
   Acceptance for this task is the command: \`${task.test}\`.
3. Run that command in the worktree. It must exit 0.
4. Commit everything with \`git add -A && git commit -m "orca(${task.id}): ${task.title.replaceAll('"', "'")}"\`, then run \`git push\` (no flags).
5. Last of all, write the result file \`${result}\` with exactly one JSON object:
   {"dispatch":"${dispatch.id}","task":"${task.id}","status":"done","summary":"<=500 chars","commits":["sha"],"test":{"cmd":"${task.test.replaceAll('"', '\\"')}","exit":0}}
   Write it in one command, e.g. \`cat > ${result} <<'EOF' ... EOF\`.
6. Stop. Do not start background processes, servers, watchers or sub-agents.

## Forbidden

Do not use \`nohup\`, \`&\`, \`setsid\`, servers or watchers. Do not force push, amend or rebase, switch branches, push other refs or remotes, touch other worktrees, or write outside this worktree. The only network use allowed is a plain \`git push\`.

## Constraints (verbatim)

1. Network: no outbound network except \`git push\` in this cycle; commit anything you need first.
2. Scope: this worktree only; do not touch other branches, worktrees or \$HOME.
3. Git: at least one commit \`orca(${task.id}): ...\` and a plain \`git push\`; never force, amend, rebase or switch branches.
4. No background processes (\`nohup\`, \`&\`, \`setsid\`, servers, watchers) and no sub-agents.
5. Every test/verify command was reviewed and approved by the user; no empty tests.
6. Test artefacts must be covered by \`.gitignore\`.
7. Tuning may make small fixes, but that counts as one rework cycle.
${prevExcerpt}`;
}

async function launchWorker(ctx, dispatch, task) {
  const pointer = `Read ${path.join(ctx.stateDir, "dispatch", `${dispatch.id}.md`)} and follow it exactly. Do nothing else first.`;
  const argv = dispatch.kind === "tuning"
    ? profileArgv(ctx.state.profile, pointer)
    : ["opencode", "--auto", "--standalone", "--prompt", pointer];
  const envPrefix = workerEnvPrefix({ dispatchId: dispatch.id, cli: dispatch.kind === "tuning" ? "tuning" : "dev", sessionEnv: ctx.env });
  const args = ["--bg", "--no-parent", "--no-notify", "--json",
    "--name", `orca-d-${dispatch.id}`,
    "--label", `orca.run=${ctx.state.run_id}`,
    "--label", `orca.dispatch=${dispatch.id}`,
    "--label", `orca.task=${task.id}`,
    "--label", `orca.role=${dispatch.kind === "tuning" ? "tuning" : "dev"}`,
    "--cwd", ctx.state.repo.toplevel,
    "--", ...envPrefix, ...argv];
  const r = ctx.hc.run(args);
  if (r.code === 0) return { ok: true, address: r.json?.address ?? r.json?.terminal?.address ?? null, raw: r.json };
  const kind = r.error?.kind ?? r.json?.error?.kind ?? null;
  if (kind === "name_taken") {
    const found = ctx.hc.list({ "orca.dispatch": dispatch.id, "orca.run": ctx.state.run_id }, { all: true });
    const live = found.find((t) => t.state === "live");
    return { ok: Boolean(live), address: live?.address ?? null, adopted: true };
  }
  return { ok: false, kind: kind ?? "spawn_failed", detail: r.stderr ?? r.stdout ?? "" };
}

async function waitDelivery(ctx, dispatch) {
  const deadline = ctx.clock() + ctx.config.ack_timeout_s * 1000;
  while (ctx.clock() < deadline) {
    const ack = path.join(ctx.stateDir, "results", `${dispatch.id}.ack`);
    if (await readTextMaybe(ack).then((x) => x !== null).catch(() => false)) return { ok: true, evidence: "ack" };
    let term = null;
    try { term = dispatch.address ? ctx.hc.get(dispatch.address) : null; }
    catch (e) { return { hcFailure: e.message }; }
    if (term?.status?.state === "working") {
      dispatch.observed_working = true;
      dispatch.observed_turn = term.turn ?? 0;
      return { ok: true, evidence: "working" };
    }
    if (term && term.state === "finished") {
      const result = await readResultFile(path.join(ctx.stateDir, dispatch.kind === "tuning" ? "reviews" : "results", `${dispatch.id}.json`));
      if (result.exists) return { ok: true, evidence: "result" };
      return { ok: false, code: "exit_without_result" };
    }
    await ctx.sleep(ctx.config.poll_s * 1000);
  }
  return { ok: false, code: "undelivered" };
}

async function settleAndKill(ctx, dispatch) {
  const resultFile = path.join(ctx.stateDir, "results", `${dispatch.id}.json`);
  const deadline = ctx.clock() + 60_000;
  let prev = null;
  let stable = 0;
  let lastChanged = null;
  while (ctx.clock() < deadline) {
    let term = null;
    try { term = dispatch.address ? ctx.hc.get(dispatch.address) : null; }
    catch (e) {
      if (e instanceof CoreGuardError) { await needsUser(ctx, "core_mismatch", e.message); return { stop: true }; }
      throw e;
    }
    const info = ctx.git.info(ctx.state.repo.toplevel);
    const key = `${info.head}|${info.dirty.join(",")}`;
    if (prev === key) stable++; else { stable = 0; lastChanged = info; }
    prev = key;
    const notWorking = term && term.status?.state !== "working";
    if (notWorking || stable >= 2) break;
    await ctx.sleep(Math.min(ctx.config.poll_s * 1000, 5000));
  }
  const finalInfo = ctx.git.info(ctx.state.repo.toplevel);
  if (finalInfo.ok && prev !== `${finalInfo.head}|${finalInfo.dirty.join(",")}`) {
    lastChanged = finalInfo;
    // keep moving: do not accept an unsettled tree
    if (await needsUser(ctx, "unsettled", "HEAD or the working tree was still changing after the result appeared")) return { stop: true };
  }
  let canKill = false;
  if (dispatch.address) {
    let term = null;
    try { term = ctx.hc.get(dispatch.address); }
    catch (e) {
      if (e instanceof CoreGuardError) { await needsUser(ctx, "core_mismatch", e.message); return { stop: true }; }
      throw e;
    }
    const owned = term && term.labels?.["orca.run"] === ctx.state.run_id && term.labels?.["orca.dispatch"] === dispatch.id
      && term.labels?.["orca.role"] === (dispatch.kind === "tuning" ? "tuning" : "dev")
      && (!dispatch.created_ms || term.created_ms === dispatch.created_ms);
    if (term && !owned) { await needsUser(ctx, "identity", "the terminal at the dispatch address is not this dispatch"); return { stop: true }; }
    canKill = Boolean(term && owned);
  }
  if (canKill) {
    try { ctx.hc.kill(dispatch.address); }
    catch (e) {
      if (e instanceof CoreGuardError) { await needsUser(ctx, "core_mismatch", e.message); return { stop: true }; }
      ctx.log(`kill failed: ${e.message}`);
    }
    await ctx.event("kill", { dispatch: dispatch.id, detail: { address: dispatch.address, created_ms: dispatch.created_ms ?? null } });
  }
  const swept = await sweep(dispatch.id);
  await ctx.event("sweep", { dispatch: dispatch.id, detail: { clean: swept.clean, killed: swept.killed.length, remaining: swept.remaining.length } });
  if (!swept.clean) {
    await needsUser(ctx, "sweep_incomplete", `processes tagged ORCA_DISPATCH=${dispatch.id} survived the sweep`);
    return { stop: true };
  }
  const info = ctx.git.info(ctx.state.repo.toplevel);
  const locks = [info.git_dir, info.common_dir].filter(Boolean).map((d) => path.join(d, "index.lock"));
  let lock = null;
  for (const f of locks) { if (await readTextMaybe(f).catch(() => null) !== null) { lock = f; break; } }
  if (info.dirty.length || lock) {
    await needsUser(ctx, "partial_changes", `working tree is not clean after killing the worker (${info.dirty.length} path(s))`);
    return { stop: true };
  }
  return { stop: false, info };
}

async function removeWorker(ctx, dispatch) {
  if (!dispatch?.address) return;
  let term = null;
  try { term = ctx.hc.get(dispatch.address); }
  catch { await ctx.event("rm_skipped", { dispatch: dispatch.id, detail: { address: dispatch.address } }); return; }
  const owned = term && term.labels?.["orca.run"] === ctx.state.run_id && term.labels?.["orca.dispatch"] === dispatch.id
    && term.labels?.["orca.role"] === (dispatch.kind === "tuning" ? "tuning" : "dev")
    && (!dispatch.created_ms || term.created_ms === dispatch.created_ms);
  if (!owned) { await ctx.event("rm_skipped", { dispatch: dispatch.id, detail: { address: dispatch.address } }); return; }
  try { ctx.hc.rm(dispatch.address); await ctx.event("rm", { dispatch: dispatch.id, detail: { address: dispatch.address } }); } catch { /* best effort */ }
}

async function acceptDev(ctx, task, dispatch, result) {
  if (!result.exists) return { rejected: "no_result" };
  if (result.tooLarge) return { rejected: "bad_result" };
  if (result.badJson) return { rejected: "bad_result" };
  if (!isObject(result.json) || result.json.dispatch !== dispatch.id) return { noResult: true };
  if (result.json.status !== "done") return { rejected: "agent_blocked" };

  const before = ctx.git.info(ctx.state.repo.toplevel);
  if (!before.ok) return { needsUser: ["tree_changed", before.detail ?? before.error] };
  if (before.branch !== ctx.state.repo.branch) return { needsUser: ["unpushed", `branch changed during the task: ${ctx.state.repo.branch} -> ${before.branch}`] };
  if (before.dirty.length) return { needsUser: ["partial_changes", "working tree is dirty before the test"] };

  const started = ctx.clock();
  const test = await runShell(task.test, {
    cwd: ctx.state.repo.toplevel, dispatchId: dispatch.id,
    timeoutMs: ctx.config.test_timeout_min * 60_000, env: ctx.env,
  });
  const testSwept = await sweep(dispatch.id);
  if (!testSwept.clean) return { needsUser: ["sweep_incomplete", `processes from the task's test survived (${testSwept.remaining.length})`] };
  const logFile = path.join(ctx.stateDir, "logs", `${dispatch.id}.test.txt`);
  await writeAtomic(logFile, truncate(test.output, MAX_SCREEN));
  const after = ctx.git.info(ctx.state.repo.toplevel);
  if (test.timedOut) return { rejected: "test_timeout", logFile };
  if (test.code !== 0) return { rejected: "test_failed", logFile };
  if (after.dirty.length) return { rejected: "test_dirtied_tree", logFile };

  if (after.branch !== ctx.state.repo.branch) return { needsUser: ["unpushed", `branch changed during the task: ${ctx.state.repo.branch} -> ${after.branch}`] };
  if (!ctx.git.isAncestor(ctx.state.repo.head, after.head, after.toplevel)) {
    return { needsUser: ["unpushed", "HEAD is not a descendant of the last accepted HEAD"] };
  }
  const commits = ctx.git.commitsSince(ctx.state.repo.head, after.toplevel);
  if (commits === null || commits < 1) return { needsUser: ["unpushed", "the task produced no new commit"] };
  const pushed = pushCheck(ctx.state, after, ctx.git, ctx.state.repo.stage_head);
  if (!pushed.ok) return { needsUser: [pushed.code, pushed.detail] };

  task.attempts = Array.isArray(task.attempts) ? task.attempts : [];
  task.attempts.push({ at: wallIso(), dispatch: dispatch.id, reason: "accepted", head: after.head, elapsed_s: Math.round((ctx.clock() - started) / 1000) });
  task.state = "accepted";
  task.accepted_at = wallIso();
  task.accepted_head = after.head;
  task.last_dispatch = dispatch.id;
  ctx.state.repo.head = after.head;
  ctx.state.repo.first_commit_seen = true;
  await removeWorker(ctx, dispatch);
  ctx.state.dispatch = null;
  await saveState(ctx);
  await ctx.event("accepted", { task: task.id, dispatch: dispatch.id, detail: { head: after.head, commits, elapsed_s: Math.round((ctx.clock() - started) / 1000) } });
  return { ok: true };
}

async function rejectTask(ctx, task, dispatch, reason, extra = {}) {
  const safeExtra = { ...extra };
  delete safeExtra.excerpt;
  task.attempts = Array.isArray(task.attempts) ? task.attempts : [];
  task.attempts.push({ at: wallIso(), dispatch: dispatch.id, reason, ...safeExtra });
  task.state = "pending";
  // A rejected attempt may still have left a clean, pushed commit. Keep it as the baseline so
  // the second attempt does not fail R-D for a HEAD that this Runner itself accepted into history.
  const info = ctx.git.info(ctx.state.repo.toplevel);
  if (info.ok && info.head !== ctx.state.repo.head && info.dirty.length === 0) {
    const pushed = pushCheck(ctx.state, info, ctx.git, ctx.state.repo.stage_head);
    ctx.state.dispatch = null;
    if (!pushed.ok) {
      await saveState(ctx);
      await ctx.event("rejected", { task: task.id, dispatch: dispatch.id, detail: { reason, attempt: task.attempts.length, ...safeExtra } });
      await needsUser(ctx, pushed.code, pushed.detail);
      return { stop: true };
    }
    ctx.state.repo.head = info.head;
    ctx.state.repo.first_commit_seen = true;
  } else {
    ctx.state.dispatch = null;
  }
  await saveState(ctx);
  await ctx.event("rejected", { task: task.id, dispatch: dispatch.id, detail: { reason, attempt: task.attempts.length, ...safeExtra } });
  await removeWorker(ctx, dispatch);
  const extraTries = Number(task.resume_extra ?? 0);
  if (task.attempts.length >= 2 + extraTries) {
    await needsUser(ctx, "task_failed", `${task.id} was rejected ${task.attempts.length} time(s); last: ${reason}`);
    return { stop: true };
  }
  return { retry: true };
}

async function handleResult(ctx, task, dispatch) {
  if (!task) { await needsUser(ctx, "unknown_worker", `dispatch ${dispatch.id} has no task in state`); return { stop: true }; }
  await saveScreen(ctx, dispatch, "screen");
  const settled = await settleAndKill(ctx, dispatch);
  if (settled.stop) return { stop: true };
  const resultFile = path.join(ctx.stateDir, "results", `${dispatch.id}.json`);
  let result = await readResultFile(resultFile);
  if (result.exists && (result.badJson || result.tooLarge)) {
    for (let i = 0; i < 3 && result.exists && result.badJson; i++) {
      await ctx.sleep(ctx.config.poll_s * 1000);
      result = await readResultFile(resultFile);
    }
    if (result.badJson || result.tooLarge) return rejectTask(ctx, task, dispatch, "bad_result");
  }
  if (!result.exists) {
    const info = ctx.git.info(ctx.state.repo.toplevel);
    if (info.head !== ctx.state.repo.head || info.dirty.length) return needsUser(ctx, "partial_changes", "the worker finished without a result and left changes");
    ctx.state.dispatch = null;
    task.state = "pending";
    await saveState(ctx);
    return { retry: true, noResult: true };
  }
  if (!isObject(result.json) || result.json.dispatch !== dispatch.id) {
    ctx.state.dispatch = null;
    task.state = "pending";
    await saveState(ctx);
    return { retry: true, noResult: true };
  }
  if (result.json.status !== "done") {
    const r = await rejectTask(ctx, task, dispatch, "agent_blocked");
    return r;
  }
  const accepted = await acceptDev(ctx, task, dispatch, result);
  if (accepted.ok) return { accepted: true };
  if (accepted.needsUser) { await needsUser(ctx, accepted.needsUser[0], accepted.needsUser[1]); return { stop: true }; }
  if (accepted.rejected) return rejectTask(ctx, task, dispatch, accepted.rejected, accepted.logFile ? { log: accepted.logFile } : {});
  return { retry: true };
}

async function waitForResult(ctx, task, dispatch) {
  const timeoutMs = (dispatch.kind === "tuning" ? ctx.config.tuning_timeout_min : ctx.config.dev_timeout_min) * 60_000;
  const deadline = ctx.clock() + timeoutMs;
  const resultName = dispatch.kind === "tuning" ? "reviews" : "results";
  const resultFile = path.join(ctx.stateDir, resultName, `${dispatch.id}.json`);
  let notWorkingSince = null;
  let sawWorking = Boolean(dispatch.observed_working);
  let hcFailureSince = null;
  while (ctx.clock() < deadline) {
    let term = null;
    try {
      term = dispatch.address ? ctx.hc.get(dispatch.address) : null;
      hcFailureSince = null;
    } catch (e) {
      if (hcFailureSince === null) hcFailureSince = ctx.clock();
      if (ctx.clock() - hcFailureSince >= ctx.config.hc_retry_min * 60_000) return { hcFailure: e.message };
      await ctx.sleep(ctx.config.poll_s * 1000);
      continue;
    }
    const result = await readResultFile(resultFile);
    if (result.exists) return { result };
    if (term && term.state === "finished") {
      await saveScreen(ctx, dispatch, "final");
      return { finished: true };
    }
    const st = term?.status?.state ?? null;
    if (st === "blocked") return { blocked: term?.status?.kind ?? null };
    if (st === "working") { sawWorking = true; dispatch.observed_working = true; dispatch.observed_turn = term.turn ?? 0; notWorkingSince = null; }
    else if (sawWorking) {
      if (notWorkingSince === null) notWorkingSince = ctx.clock();
      const turnStable = (term?.turn ?? null) === (dispatch.observed_turn ?? null);
      const quietMs = turnStable ? (Date.now() - (term?.status_ms ?? Date.now())) : 0;
      if (ctx.clock() - notWorkingSince >= ctx.config.stopped_grace_s * 1000 || quietMs >= ctx.config.stopped_grace_s * 1000) {
        await saveScreen(ctx, dispatch, "stopped");
        return { stopped: true };
      }
    }
    await ctx.sleep(ctx.config.poll_s * 1000);
  }
  await saveScreen(ctx, dispatch, "timeout");
  return { timeout: true };
}

async function dispatchTask(ctx, task) {
  await refreshConfig(ctx);
  const first = !ctx.state.repo.first_commit_seen;
  const before = ctx.git.info(ctx.state.repo.toplevel);
  const checked = dispatchCheck(ctx.state, before, { first });
  if (!checked.ok) {
    const code = before.branch !== ctx.state.repo.branch || (before.head !== ctx.state.repo.head && !first) ? "tree_changed" : checked.code;
    return needsUser(ctx, code, checked.detail);
  }
  let workers, tuningWorkers;
  try {
    workers = ctx.hc.list({ "orca.run": ctx.state.run_id, "orca.role": "dev" }, { all: false });
    tuningWorkers = ctx.hc.list({ "orca.run": ctx.state.run_id, "orca.role": "tuning" }, { all: false });
  } catch (e) {
    if (e instanceof CoreGuardError) return needsUser(ctx, "core_mismatch", e.message);
    throw e;
  }
  if (workers.length || tuningWorkers.length) {
    return needsUser(ctx, "unknown_worker", "a dev/tuning worker is still live before a new dispatch");
  }

  const id = randomId();
  const dispatch = {
    id, kind: "dev", task: task.id, name: `orca-d-${id}`,
    address: null, phase: "intent", started_at: wallIso(), started_clock_ms: ctx.clock(),
    stage_head: ctx.state.repo.head, created_ms: null,
  };
  task.state = "dispatched";
  task.last_dispatch = id;
  ctx.state.dispatch = dispatch;
  await saveState(ctx);
  await ctx.event("intent", { task: task.id, dispatch: id, detail: { kind: "dev" } });
  await fsp.mkdir(path.join(ctx.stateDir, "dispatch"), { recursive: true, mode: 0o700 });
  await fsp.mkdir(path.join(ctx.stateDir, "results"), { recursive: true, mode: 0o700 });
  await writeAtomic(path.join(ctx.stateDir, "dispatch", `${id}.md`), dispatchMarkdown(ctx, dispatch, task));

  const launched = await launchWorker(ctx, dispatch, task);
  if (!launched.ok) {
    ctx.state.dispatch = null;
    task.state = "pending";
    await saveState(ctx);
    await ctx.event("rejected", { task: task.id, dispatch: id, detail: { reason: "spawn_failed", kind: launched.kind } });
    return needsUser(ctx, launched.kind === "spawn_failed" ? "spawn_failed" : "spawn_failed", launched.detail);
  }
  dispatch.address = launched.address;
  dispatch.phase = "launched";
  const term = launched.address ? ctx.hc.get(launched.address) : null;
  dispatch.created_ms = term?.created_ms ?? null;
  await saveState(ctx);
  await ctx.event("launched", { task: task.id, dispatch: id, detail: { address: dispatch.address, adopted: Boolean(launched.adopted) } });

  return awaitWorker(ctx, task, dispatch);
}

// Delivery + wait + route. Used by a fresh dispatch and by recovery of an adopted worker.
async function awaitWorker(ctx, task, dispatch) {
  if (dispatch.phase !== "acked") {
    const delivered = await waitDelivery(ctx, dispatch);
    if (delivered.hcFailure) return { stop: true, noStateChange: true };
    if (!delivered.ok) {
      await saveScreen(ctx, dispatch, "undelivered");
      return needsUser(ctx, delivered.code, `no delivery evidence within ${ctx.config.ack_timeout_s}s`);
    }
    dispatch.phase = "acked";
    dispatch.evidence = delivered.evidence;
    await saveState(ctx);
    await ctx.event("acked", { task: task.id, dispatch: dispatch.id, detail: { evidence: delivered.evidence } });
  }

  const waited = await waitForResult(ctx, task, dispatch);
  if (waited.hcFailure) return { stop: true, noStateChange: true };
  if (waited.result) {
    await ctx.event("result_seen", { task: task.id, dispatch: dispatch.id, detail: { kind: dispatch.kind } });
    if (dispatch.kind === "tuning") return { tuningResult: true };
    return handleResult(ctx, task, dispatch);
  }
  if (waited.finished) {
    const r = await readResultFile(path.join(ctx.stateDir, dispatch.kind === "tuning" ? "reviews" : "results", `${dispatch.id}.json`));
    if (r.exists) {
      if (dispatch.kind === "tuning") return { tuningResult: true };
      return handleResult(ctx, task, dispatch);
    }
    return needsUser(ctx, "exit_without_result", "the worker ended without writing a result");
  }
  if (waited.blocked) return needsUser(ctx, "blocked", `the worker is blocked${waited.blocked ? ` (${waited.blocked})` : ""}`);
  if (waited.stopped) return needsUser(ctx, "stopped_without_result", "the worker stopped without writing a result");
  if (waited.timeout) return needsUser(ctx, "timeout", "the worker exceeded its time budget");
  return needsUser(ctx, "unsettled", "unexpected wait state");
}

// ---- tuning

function reviewMarkdownChecks(review, state) {
  const errors = [];
  if (!isObject(review)) return ["review is not an object"];
  if (!["pass", "rework", "needs_user"].includes(review.verdict)) errors.push("verdict must be pass, rework or needs_user");
  const criteria = Array.isArray(review.criteria) ? review.criteria : [];
  if (review.verdict === "pass") {
    const ids = new Set(criteria.map((c) => c?.id));
    for (const a of state.acceptance ?? []) {
      if (!ids.has(a.id)) errors.push(`criteria is missing ${a.id}`);
      const c = criteria.find((x) => x?.id === a.id);
      if (!c || c.pass !== true) errors.push(`criteria ${a.id} did not pass`);
    }
  }
  return errors;
}

async function runTuning(ctx) {
  await refreshConfig(ctx);
  if ((ctx.state.tuning_attempts ?? 0) >= 2) return needsUser(ctx, "bad_review", "Tuning produced two invalid reviews");
  const id = randomId();
  const dispatch = {
    id, kind: "tuning", task: "TUNING", name: `orca-d-${id}`,
    address: null, phase: "intent", started_at: wallIso(), started_clock_ms: ctx.clock(),
    stage_head: ctx.state.repo.head, created_ms: null,
  };
  const before = ctx.git.info(ctx.state.repo.toplevel);
  const checked = dispatchCheck(ctx.state, before);
  if (!checked.ok) return needsUser(ctx, "tree_changed", checked.detail);
  ctx.state.dispatch = dispatch;
  ctx.state.stage_head = before.head;
  await saveState(ctx);
  await ctx.event("intent", { task: "TUNING", dispatch: id, detail: { kind: "tuning" } });
  await fsp.mkdir(path.join(ctx.stateDir, "dispatch"), { recursive: true, mode: 0o700 });
  await fsp.mkdir(path.join(ctx.stateDir, "reviews"), { recursive: true, mode: 0o700 });
  await fsp.mkdir(path.join(ctx.stateDir, "results"), { recursive: true, mode: 0o700 });
  await writeAtomic(path.join(ctx.stateDir, "dispatch", `${id}.md`), dispatchMarkdown(ctx, dispatch, { id: "TUNING", attempts: [] }));

  const launched = await launchWorker(ctx, dispatch, { id: "TUNING" });
  if (!launched.ok) {
    ctx.state.dispatch = null;
    await saveState(ctx);
    return needsUser(ctx, "spawn_failed", launched.detail);
  }
  dispatch.address = launched.address;
  dispatch.phase = "launched";
  const term = launched.address ? ctx.hc.get(launched.address) : null;
  dispatch.created_ms = term?.created_ms ?? null;
  await saveState(ctx);
  await ctx.event("launched", { task: "TUNING", dispatch: id, detail: { address: dispatch.address, adopted: Boolean(launched.adopted) } });

  const delivered = await waitDelivery(ctx, dispatch);
  if (!delivered.ok) {
    await saveScreen(ctx, dispatch, "undelivered");
    return needsUser(ctx, delivered.code, `no delivery evidence within ${ctx.config.ack_timeout_s}s`);
  }
  dispatch.phase = "acked";
  dispatch.evidence = delivered.evidence;
  await saveState(ctx);
  await ctx.event("acked", { task: "TUNING", dispatch: id, detail: { evidence: delivered.evidence } });

  const waited = await waitForResult(ctx, { id: "TUNING" }, dispatch);
  if (waited.hcFailure) return { stop: true, noStateChange: true };
  if (!waited.result) {
    if (waited.finished) return needsUser(ctx, "exit_without_result", "Tuning ended without a review");
    if (waited.blocked) return needsUser(ctx, "blocked", "Tuning is blocked");
    if (waited.stopped) return needsUser(ctx, "stopped_without_result", "Tuning stopped without a review");
    return needsUser(ctx, "timeout", "Tuning exceeded its time budget");
  }
  await ctx.event("result_seen", { task: "TUNING", dispatch: id, detail: { kind: "tuning" } });
  const settled = await settleAndKill(ctx, dispatch);
  if (settled.stop) return { stop: true };
  const reviewFile = path.join(ctx.stateDir, "reviews", `${id}.json`);
  const rr = await readResultFile(reviewFile);
  if (!rr.exists || rr.badJson || rr.tooLarge) return invalidReview(ctx, id, "review file is missing or not valid JSON");
  const review = rr.json;
  if (review?.dispatch !== id) return invalidReview(ctx, id, "review dispatch does not match");

  const after = ctx.git.info(ctx.state.repo.toplevel);
  if (after.head !== ctx.state.stage_head) {
    const pushed = pushCheck(ctx.state, after, ctx.git, ctx.state.stage_head);
    if (!pushed.ok) return needsUser(ctx, pushed.code, pushed.detail);
    return directFix(ctx, id, review, after);
  }

  if (review.verdict === "needs_user") return needsUser(ctx, "bad_review", review.summary ?? "Tuning asked for the user");
  if (review.verdict === "rework") return applyRework(ctx, id, review);
  if (review.verdict === "pass") return applyPass(ctx, id, review);
  return invalidReview(ctx, id, "unknown verdict");
}

async function invalidReview(ctx, id, detail) {
  await removeWorker(ctx, ctx.state.dispatch);
  ctx.state.tuning_attempts = (ctx.state.tuning_attempts ?? 0) + 1;
  ctx.state.dispatch = null;
  await saveState(ctx);
  await ctx.event("rejected", { task: "TUNING", dispatch: id, detail: { reason: "bad_review", detail } });
  if (ctx.state.tuning_attempts >= 2) return needsUser(ctx, "bad_review", detail);
  return { retry: true };
}

async function applyPass(ctx, id, review) {
  await refreshConfig(ctx);
  const errors = reviewMarkdownChecks(review, ctx.state);
  if (errors.length) return invalidReview(ctx, id, errors.join("; "));
  if (!ctx.state.acceptance?.some((a) => !a.manual)) return invalidReview(ctx, id, "no automated acceptance criterion");
  for (const a of ctx.state.acceptance) {
    if (a.manual) continue;
    const r = await runShell(a.verify, { cwd: ctx.state.repo.toplevel, dispatchId: id, timeoutMs: ctx.config.test_timeout_min * 60_000, env: ctx.env });
    const swept = await sweep(id);
    if (!swept.clean) return needsUser(ctx, "sweep_incomplete", `processes from acceptance ${a.id} survived`);
    if (r.code !== 0) {
      await writeAtomic(path.join(ctx.stateDir, "logs", `${id}.verify-${a.id}.txt`), truncate(r.output, MAX_SCREEN));
      return invalidReview(ctx, id, `acceptance ${a.id} failed in the Runner's rerun`);
    }
  }
  const info = ctx.git.info(ctx.state.repo.toplevel);
  const pushed = pushCheck(ctx.state, info, ctx.git, ctx.state.stage_head);
  if (!pushed.ok) return needsUser(ctx, pushed.code, pushed.detail);
  ctx.state.reviews = Array.isArray(ctx.state.reviews) ? ctx.state.reviews : [];
  await removeWorker(ctx, ctx.state.dispatch);
  ctx.state.reviews.push({ dispatch: id, verdict: "pass", criteria: review.criteria, at: wallIso(), stale: false });
  ctx.state.tuning_attempts = 0;
  ctx.state.dispatch = null;
  ctx.state.stage = "ready_for_review";
  ctx.state.status = "completed";
  ctx.state.repo.head = info.head;
  await saveState(ctx);
  await ctx.event("review", { task: "TUNING", dispatch: id, detail: { verdict: "pass" } });
  return { done: true };
}

async function applyRework(ctx, id, review) {
  await refreshConfig(ctx);
  const cycle = (ctx.state.rework?.cycles ?? 0) + 1;
  const existingIds = (ctx.state.tasks ?? []).map((t) => t.id);
  const gate = reworkGate(review.new_tasks, { cycle, existingIds });
  if (!gate.ok) {
    if (gate.code === "rework_too_large") {
      await removeWorker(ctx, ctx.state.dispatch);
      ctx.state.dispatch = null;
      await saveState(ctx);
      return needsUser(ctx, "rework_too_large", gate.errors.join("; "));
    }
    return invalidReview(ctx, id, gate.errors.join("; "));
  }
  const max = ctx.config.max_rework_cycles;
  if (cycle > max) {
    await removeWorker(ctx, ctx.state.dispatch);
    ctx.state.dispatch = null;
    await saveState(ctx);
    return needsUser(ctx, "rework_exhausted", `rework cycles reached the limit (${max})`);
  }
  await removeWorker(ctx, ctx.state.dispatch);
  ctx.state.reviews = Array.isArray(ctx.state.reviews) ? ctx.state.reviews : [];
  ctx.state.reviews.push({ dispatch: id, verdict: "rework", criteria: review.criteria ?? [], new_tasks: review.new_tasks, at: wallIso(), stale: false });
  ctx.state.tasks.push(...gate.tasks);
  ctx.state.rework = { cycles: cycle };
  ctx.state.tuning_attempts = 0;
  ctx.state.dispatch = null;
  await saveState(ctx);
  await ctx.event("rework", { task: "TUNING", dispatch: id, detail: { cycle, tasks: gate.tasks.map((t) => t.id) } });
  return { retry: true };
}

async function directFix(ctx, id, review, info) {
  await refreshConfig(ctx);
  const cycle = (ctx.state.rework?.cycles ?? 0) + 1;
  const max = ctx.config.max_rework_cycles;
  await removeWorker(ctx, ctx.state.dispatch);
  ctx.state.reviews = Array.isArray(ctx.state.reviews) ? ctx.state.reviews : [];
  ctx.state.reviews.push({ dispatch: id, verdict: review.verdict, criteria: review.criteria ?? [], at: wallIso(), stale: true });
  ctx.state.dispatch = null;
  if (cycle > max) {
    await saveState(ctx);
    return needsUser(ctx, "rework_exhausted", `Tuning committed a fix and the rework limit (${max}) is reached`);
  }
  ctx.state.rework = { cycles: cycle };
  ctx.state.tuning_attempts = 0;
  ctx.state.stage_head = info.head;
  ctx.state.repo.head = info.head;
  await saveState(ctx);
  await ctx.event("rework", { task: "TUNING", dispatch: id, detail: { cycle, direct_fix: true } });
  return { retry: true };
}

// ---------------------------------------------------------------------------
// M14 sweep

const PS_LINE = /^\s*(\d+)\s+(\w{3}\s+(?:\w{3}\s+\d+|\d+\s+\w{3})\s+[\d:]{8}\s+\d{4})\s+(.*)$/;

export function parsePs(text) {
  return String(text ?? "").split("\n").flatMap((l) => {
    const m = PS_LINE.exec(l);
    return m ? [{ pid: Number(m[1]), started: m[2].replace(/\s+/g, " "), cmd: m[3] }] : [];
  });
}

export const tagged = (procs, dispatchId, selfPid = process.pid) =>
  procs.filter((p) => p.pid !== selfPid && p.cmd.split(/\s+/).includes(`ORCA_DISPATCH=${dispatchId}`));

const psNow = () => spawnSync("ps", ["-Eww", "-o", "pid=,lstart=,command=", "-u", String(process.getuid())], { encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, LC_ALL: "C" } }).stdout ?? "";

export async function sweep(dispatchId, { ps = psNow, kill = (pid, sig) => process.kill(pid, sig), sleep = sleepReal, selfPid = process.pid, rounds = 4, graceMs = 300 } = {}) {
  const killed = [];
  for (let round = 0; round < rounds; round++) {
    const found = tagged(parsePs(ps()), dispatchId, selfPid);
    if (!found.length) return { clean: true, killed, remaining: [] };
    for (const p of tagged(parsePs(ps()), dispatchId, selfPid)) {
      if (!found.some((f) => f.pid === p.pid && f.started === p.started)) continue;
      try { kill(p.pid, round < 2 ? "SIGTERM" : "SIGKILL"); killed.push(p.pid); } catch { /* already gone */ }
    }
    await sleep(graceMs);
  }
  const remaining = tagged(parsePs(ps()), dispatchId, selfPid).map((p) => p.pid);
  return { clean: remaining.length === 0, killed, remaining };
}

// ---------------------------------------------------------------------------
// M15 rework gate (structure only; no sandbox in v2)

export function reworkGate(newTasks, { cycle, existingIds }) {
  const bad = (errors, code = "bad_review") => ({ ok: false, code, errors, tasks: [] });
  if (!Array.isArray(newTasks) || !newTasks.length) return bad(["new_tasks is empty"]);
  if (newTasks.length > MAX_NEW_TASKS) return bad([`${newTasks.length} new tasks, max ${MAX_NEW_TASKS}`], "rework_too_large");
  const ids = newTasks.map((_, i) => `R${cycle}-${String(i + 1).padStart(2, "0")}`);
  const errors = [];
  const tasks = newTasks.map((t, i) => {
    const at = `new_tasks[${i}]`;
    if (typeof t?.title !== "string" || !t.title.trim()) errors.push(`${at}: title`);
    const why = checkCommand(t?.test);
    if (why) errors.push(`${at}: test: ${why}`);
    const deps = (Array.isArray(t?.deps) ? t.deps : []).map((d) => {
      const m = /^@(\d+)$/.exec(d);
      if (m) {
        const n = Number(m[1]);
        if (n >= 1 && n <= i) return ids[n - 1];
      } else if (existingIds.includes(d)) return d;
      errors.push(`${at}: dep ${JSON.stringify(d)}`);
      return d;
    });
    return { id: ids[i], kind: "rework", title: t?.title, test: t?.test, deps, cycle, state: "pending", attempts: [] };
  });
  return errors.length ? bad(errors) : { ok: true, code: null, errors: [], tasks };
}

// ---------------------------------------------------------------------------
// Planning tab close (2.2)

export async function closePlanningTab(ctx, { app = defaultApp, wait = true } = {}) {
  const p = ctx.state.planning;
  if (!p?.address) { ctx.state.planning = { ...(p ?? {}), closed: "skipped:gone" }; await saveState(ctx); return "skipped:gone"; }
  if (!ctx.config.close_planning_tab) {
    ctx.state.planning.closed = "skipped:disabled";
    await saveState(ctx);
    await ctx.event("planning_closed", { detail: { closed: "skipped:disabled" } });
    return "skipped:disabled";
  }
  let t = null;
  try { t = ctx.hc.get(p.address); }
  catch (e) {
    if (e instanceof CoreGuardError) { await needsUser(ctx, "core_mismatch", e.message); return "needs_user"; }
    throw e;
  }
  if (wait) {
    const until = ctx.clock() + 120_000;
    while (ctx.clock() < until) {
      try { t = ctx.hc.get(p.address); }
      catch (e) {
        if (e instanceof CoreGuardError) { await needsUser(ctx, "core_mismatch", e.message); return "needs_user"; }
        throw e;
      }
      if (!t || t.state !== "live" || t.status?.state !== "working") break;
      await ctx.sleep(ctx.config.poll_s * 1000);
    }
  }
  const currentCore = ctx.hc.coreId();
  if (!currentCore || currentCore !== p.core_id) {
    ctx.state.planning.closed = "skipped:gone";
    await saveState(ctx);
    return "skipped:gone";
  }
  try { t = ctx.hc.get(p.address); }
  catch (e) {
    if (e instanceof CoreGuardError) { await needsUser(ctx, "core_mismatch", e.message); return "needs_user"; }
    throw e;
  }
  if (!t || t.state !== "live") { ctx.state.planning.closed = "skipped:gone"; await saveState(ctx); return "skipped:gone"; }
  if (t.created_ms !== p.created_ms) { ctx.state.planning.closed = "skipped:identity"; await saveState(ctx); return "skipped:identity"; }
  if (t.labels?.["herdr.tab"] !== p.tab || t.labels?.["herdr.space"] !== p.space) {
    ctx.state.planning.closed = "skipped:moved"; await saveState(ctx); return "skipped:moved";
  }
  if (t.foreground?.pid !== p.agent_pid) { ctx.state.planning.closed = "skipped:agent_exited"; await saveState(ctx); return "skipped:agent_exited"; }
  const st = t.status?.state;
  if (!(st === "done" || st === "idle") || (t.turn ?? null) !== (p.turn ?? 0) + 1) {
    ctx.state.planning.closed = "skipped:in_use"; await saveState(ctx); return "skipped:in_use";
  }
  let ls;
  try { ls = JSON.parse(app(["ls", "--json"]).stdout); } catch { ctx.state.planning.closed = "skipped:app_unavailable"; await saveState(ctx); return "skipped:app_unavailable"; }
  if (!ls || !Array.isArray(ls.spaces)) { ctx.state.planning.closed = "skipped:app_unavailable"; await saveState(ctx); return "skipped:app_unavailable"; }
  let tab = null, space = null;
  for (const s of ls.spaces) for (const tb of s.tabs ?? []) if (tb.id === p.tab) { tab = tb; space = s; }
  if (!tab || !space) { ctx.state.planning.closed = "skipped:gone"; await saveState(ctx); return "skipped:gone"; }
  if ((tab.terminals ?? []).length !== 1 || (tab.terminals ?? []).some((x) => (x.sub_agents ?? []).length)) {
    ctx.state.planning.closed = "skipped:other_work"; await saveState(ctx); return "skipped:other_work";
  }
  if ((space.tabs ?? []).length <= 1) { ctx.state.planning.closed = "skipped:last_tab"; await saveState(ctx); return "skipped:last_tab"; }
  const closed = app(["do", "tab.close", "--id", p.tab]);
  if (closed.status !== 0) { ctx.state.planning.closed = "skipped:close_failed"; await saveState(ctx); return "skipped:close_failed"; }
  let after = null;
  try { after = ctx.hc.get(p.address); } catch { after = null; }
  if (after && after.state === "live") { ctx.state.planning.closed = "skipped:close_failed"; await saveState(ctx); return "skipped:close_failed"; }
  ctx.state.planning.closed = "closed";
  await saveState(ctx);
  await ctx.event("planning_closed", { detail: { closed: "closed", address: p.address, created_ms: p.created_ms } });
  return "closed";
}

export function defaultApp(args) {
  return spawnSync("herdr-app", args, { encoding: "utf8", timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Runner startup / recovery

async function scanWorkers(ctx) {
  let workers;
  try { workers = ctx.hc.list({ "orca.run": ctx.state.run_id }, { all: true }); }
  catch (e) {
    if (e instanceof CoreGuardError) return needsUser(ctx, "core_mismatch", e.message);
    throw e;
  }
  const known = new Set();
  for (const t of ctx.state.tasks ?? []) for (const a of t.attempts ?? []) if (a.dispatch) known.add(a.dispatch);
  if (ctx.state.dispatch?.id) known.add(ctx.state.dispatch.id);
  for (const w of workers) {
    const id = w.labels?.["orca.dispatch"];
    if (!id || w.state !== "live") continue;
    if (!known.has(id)) return needsUser(ctx, "unknown_worker", `live terminal ${w.address} has dispatch ${id} that is not in state`);
  }
  return { ok: true };
}

async function reconcile(ctx) {
  const d = ctx.state.dispatch;
  if (!d) return { ok: true };
  let terminals;
  try { terminals = ctx.hc.list({ "orca.dispatch": d.id }, { all: true }); }
  catch (e) {
    if (e instanceof CoreGuardError) return needsUser(ctx, "core_mismatch", e.message);
    throw e;
  }
  const live = terminals.find((t) => t.state === "live");
  const resultFile = path.join(ctx.stateDir, d.kind === "tuning" ? "reviews" : "results", `${d.id}.json`);
  const result = await readResultFile(resultFile);
  if (live) {
    d.address = live.address;
    d.created_ms = live.created_ms ?? d.created_ms;
    d.phase = d.phase === "intent" ? "launched" : d.phase;
    await saveState(ctx);
    if (result.exists) {
      if (d.kind === "tuning") return { ok: true, tuningResult: true };
      const task = (ctx.state.tasks ?? []).find((t) => t.id === d.task);
      if (task) return handleResult(ctx, task, d);
    }
    return { ok: true, adopted: true, dispatch: d };
  }
  if (result.exists) {
    if (!d.address) d.address = terminals[0]?.address ?? null;
    const task = d.kind === "tuning" ? { id: "TUNING" } : (ctx.state.tasks ?? []).find((t) => t.id === d.task);
    if (d.kind === "tuning") return { ok: true, tuningResult: true };
    return handleResult(ctx, task, d);
  }
  const info = ctx.git.info(ctx.state.repo.toplevel);
  const clean = info.dirty.length === 0;
  if (!clean) return needsUser(ctx, "partial_changes", `dispatch ${d.id} ended with a dirty tree`);
  if (info.head === ctx.state.repo.head) {
    if (d.phase === "intent" || !d.address) {
      ctx.state.dispatch = null;
      const task = (ctx.state.tasks ?? []).find((t) => t.id === d.task);
      if (task) task.state = "pending";
      await saveState(ctx);
      return { ok: true };
    }
    const task = (ctx.state.tasks ?? []).find((t) => t.id === d.task);
    if (task) {
      task.attempts = Array.isArray(task.attempts) ? task.attempts : [];
      task.attempts.push({ at: wallIso(), dispatch: d.id, reason: "exit_without_result" });
      if (task.attempts.length >= 2 + Number(task.resume_extra ?? 0)) {
        ctx.state.dispatch = null;
        await saveState(ctx);
        return needsUser(ctx, "task_failed", `${task.id} exhausted its attempts`);
      }
      task.state = "pending";
    }
    ctx.state.dispatch = null;
    await saveState(ctx);
    return { ok: true };
  }
  if (info.head !== ctx.state.repo.head) {
    const pushed = pushCheck(ctx.state, info, ctx.git, ctx.state.repo.stage_head);
    if (!pushed.ok) return needsUser(ctx, pushed.code, pushed.detail);
    ctx.state.repo.head = info.head;
    ctx.state.stage_head = info.head;
    if (d.kind === "tuning") {
      const cycle = (ctx.state.rework?.cycles ?? 0) + 1;
      if (cycle > ctx.config.max_rework_cycles) {
        ctx.state.dispatch = null;
        await saveState(ctx);
        return needsUser(ctx, "rework_exhausted", "Tuning left a pushed commit without a review");
      }
      ctx.state.rework = { cycles: cycle };
      ctx.state.tuning_attempts = 0;
      await ctx.event("rework", { task: "TUNING", dispatch: d.id, detail: { cycle, direct_fix: true, no_review: true } });
    } else {
      const task = (ctx.state.tasks ?? []).find((t) => t.id === d.task);
      if (task) {
        task.attempts = Array.isArray(task.attempts) ? task.attempts : [];
        task.attempts.push({ at: wallIso(), dispatch: d.id, reason: "exit_without_result" });
        if (task.attempts.length >= 2 + Number(task.resume_extra ?? 0)) {
          ctx.state.dispatch = null;
          await saveState(ctx);
          return needsUser(ctx, "task_failed", `${task.id} exhausted its attempts`);
        }
        task.state = "pending";
      }
    }
  }
  ctx.state.dispatch = null;
  await saveState(ctx);
  return { ok: true };
}

async function resumeState(ctx) {
  if (ctx.state.status !== "needs_user") return { ok: true };
  const info = ctx.git.info(ctx.state.repo.toplevel);
  if (!info.ok) return { ok: false, detail: info.detail ?? info.error };
  if (info.branch !== ctx.state.repo.branch) return { ok: false, detail: `branch changed: ${ctx.state.repo.branch} -> ${info.branch}` };
  if (info.dirty.length) return { ok: false, detail: `working tree is dirty (${info.dirty.length} path(s))` };
  if (!info.upstream) return { ok: false, detail: "branch has no upstream" };
  if (info.ahead !== 0) return { ok: false, detail: `branch is ${info.ahead} commit(s) ahead of upstream; push it first` };
  if (info.head !== ctx.state.repo.head) {
    if (!ctx.git.isAncestor(ctx.state.repo.head, info.head, info.toplevel)) return { ok: false, detail: "HEAD is not a descendant of the last accepted HEAD" };
    // A worker left a pushed commit. Treat it as the new baseline; the interrupted task is re-dispatched.
    ctx.state.repo.head = info.head;
    ctx.state.stage_head = info.head;
  }
  if (ctx.state.dispatch) {
    // M10: a retained worker is looked at (result already checked by reconcile) then killed.
    const d = ctx.state.dispatch;
    const res = await readResultFile(path.join(ctx.stateDir, d.kind === "tuning" ? "reviews" : "results", `${d.id}.json`));
    if (res.exists && d.kind !== "tuning") {
      const task = (ctx.state.tasks ?? []).find((t) => t.id === d.task);
      if (task) {
        ctx.state.status = "working";
        ctx.state.needs_user = null;
        await saveState(ctx);
        return handleResult(ctx, task, d);
      }
    }
    try { if (d.address) ctx.hc.kill(d.address); }
    catch (e) {
      if (e instanceof CoreGuardError) { await needsUser(ctx, "core_mismatch", e.message); return { ok: true }; }
    }
  }
  const task = (ctx.state.tasks ?? []).find((t) => t.state === "dispatched") ?? (ctx.state.tasks ?? []).find((t) => t.id === ctx.state.dispatch?.task);
  if (task) {
    task.state = "pending";
    task.resume_extra = Number(task.resume_extra ?? 0) + 2;
  }
  ctx.state.dispatch = null;
  ctx.state.status = "working";
  ctx.state.needs_user = null;
  ctx.state.resumed_at = wallIso();
  ctx.state.stage_head = info.head;
  await saveState(ctx);
  await ctx.event("resumed", { detail: { head: info.head } });
  return { ok: true };
}

// Exported for tests: run the loop with a prepared context.
export async function runLoop(ctx, { closePlanning = false } = {}) {
  ctx.lastUpdated = ctx.state.updated;
  await ensureSetup(ctx);
  try {
    await ctx.event("runner_start", { detail: { stage: ctx.state.stage, status: ctx.state.status } });
    if (ctx.state.status === "needs_user") {
      const resumed = await resumeState(ctx);
      if (!resumed.ok) {
        ctx.log(`still needs the user: ${resumed.detail}`);
        return { stop: true, code: "needs_user" };
      }
    }
    const scanned = await scanWorkers(ctx);
    if (scanned.stop) return { stop: true, code: scanned.code };
    if (closePlanning) await closePlanningTab(ctx);
    for (;;) {
      const rec = await reconcile(ctx);
      if (rec.stop) return { stop: true, code: rec.code };
      let reviewDispatch = null;
      if (rec.adopted) {
        const task = rec.dispatch.kind === "tuning" ? { id: "TUNING" } : (ctx.state.tasks ?? []).find((t) => t.id === rec.dispatch.task);
        const out = task ? await awaitWorker(ctx, task, rec.dispatch) : { stop: true };
        if (out.stop) return out;
        if (out.tuningResult) reviewDispatch = rec.dispatch; else continue;
      } else if (rec.tuningResult) reviewDispatch = ctx.state.dispatch;
      if (reviewDispatch) {
        const d = reviewDispatch;
        const reviewFile = path.join(ctx.stateDir, "reviews", `${d.id}.json`);
        const rr = await readResultFile(reviewFile);
        if (!rr.exists || rr.badJson) { const x = await invalidReview(ctx, d.id, "review is missing or invalid"); if (x.stop) return x; continue; }
        if (rr.json?.dispatch !== d.id) { const x = await invalidReview(ctx, d.id, "review dispatch mismatch"); if (x.stop) return x; continue; }
        const after = ctx.git.info(ctx.state.repo.toplevel);
        if (after.head !== ctx.state.stage_head) {
          const pushed = pushCheck(ctx.state, after, ctx.git, ctx.state.stage_head);
          if (!pushed.ok) return needsUser(ctx, pushed.code, pushed.detail);
          const x = await directFix(ctx, d.id, rr.json, after); if (x.stop) return x; continue;
        }
        if (rr.json.verdict === "pass") { const x = await applyPass(ctx, d.id, rr.json); if (x.stop) return x; return { done: true }; }
        if (rr.json.verdict === "rework") { const x = await applyRework(ctx, d.id, rr.json); if (x.stop) return x; continue; }
        if (rr.json.verdict === "needs_user") return needsUser(ctx, "bad_review", rr.json.summary ?? "Tuning asked for the user");
        { const x = await invalidReview(ctx, d.id, "unknown verdict"); if (x.stop) return x; continue; }
      }

      if (ctx.state.status === "needs_user") return { stop: true, code: "needs_user" };
      const next = chooseNextTask(ctx.state);
      if (next.task) {
        const out = await dispatchTask(ctx, next.task);
        if (out.stop) return out;
        continue;
      }
      if (next.blocked) return needsUser(ctx, "blocked_tasks", `no runnable task; blocked: ${next.pending.join(", ")}`);
      if (ctx.state.stage === "development") {
        ctx.state.stage = "tuning";
        const info = ctx.git.info(ctx.state.repo.toplevel);
        ctx.state.stage_head = info.head;
        await saveState(ctx);
        continue;
      }
      const out = await runTuning(ctx);
      if (out.stop) return out;
      if (out.done) return { done: true };
    }
  } finally {
    await ctx.event("runner_exit", { detail: { status: ctx.state.status, stage: ctx.state.stage } }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// CLI

const EXIT = { ok: 0, reject: 1, usage: 2, env: 3 };

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
function has(argv, name) { return argv.includes(name); }

function print(out, text = "") { out.write(text + "\n"); }

async function resolveWtId(root, arg) {
  if (arg) return arg;
  const info = makeGit().info(process.cwd());
  if (!info.ok || !info.git_dir) return null;
  return wtIdForGitDir(info.git_dir);
}

function planningFromTerminal(term) {
  return {
    address: term.address,
    created_ms: term.created_ms,
    tab: term.labels?.["herdr.tab"] ?? null,
    space: term.labels?.["herdr.space"] ?? null,
    agent_pid: term.foreground?.pid ?? null,
    turn: term.turn ?? 0,
    closed: null,
  };
}

function gitFailCode(stderr) {
  const s = String(stderr ?? "");
  if (/has no upstream branch/i.test(s)) return "no_upstream";
  if (/does not appear to be a git repository|Could not read from remote repository|repository .* not found/i.test(s)) return "remote_unreachable";
  if (/non-fast-forward|fetch first|\[rejected\]/i.test(s)) return "not_fast_forward";
  return "push_failed";
}

async function cmdInit(argv, io) {
  const { out, err } = io;
  const handoffPath = argValue(argv, "--handoff");
  const tasksPath = argValue(argv, "--tasks");
  const model = argValue(argv, "--model");
  const effort = argValue(argv, "--effort");
  const check = has(argv, "--check");
  const noStart = has(argv, "--no-start");
  if (!handoffPath || !tasksPath) { print(err, "usage: my-orca init --handoff <path> --tasks <path> [--model M --effort E] [--no-start] [--check]"); return EXIT.usage; }

  const handoffText = await readTextMaybe(handoffPath);
  const tasksText = await readTextMaybe(tasksPath);
  if (handoffText === null) { print(err, `init: cannot read ${handoffPath}`); return EXIT.reject; }
  if (tasksText === null) { print(err, `init: cannot read ${tasksPath}`); return EXIT.reject; }
  const validated = validateHandoffFiles(handoffText, tasksText);
  if (!validated.ok) {
    for (const e of validated.errors) print(err, `init: ${e}`);
    return EXIT.reject;
  }
  const doc = validated.doc;

  const git = makeGit();
  const info = git.info(process.cwd());
  if (!info.ok) { print(err, `init: not a git worktree (${info.detail || info.error})`); return EXIT.reject; }
  if (!info.branch) { print(err, "init: detached HEAD is not supported"); return EXIT.reject; }
  const bare = git.run(["rev-parse", "--is-bare-repository"], info.toplevel);
  if (bare.stdout === "true") { print(err, "init: bare repositories are not supported"); return EXIT.reject; }
  if (check) {
    print(out, `handoff ok: ${doc.tasks.length} task(s), ${doc.acceptance.length} acceptance criterion/criteria, branch ${info.branch}`);
    print(out, `toplevel: ${info.toplevel}`);
    print(out, `git-dir: ${info.git_dir}`);
    return EXIT.ok;
  }

  // environment and profile first: a failed init must not create an upstream or push.
  for (const [cmd, why] of [["hc", "Herdr core"], ["herdr-app", "Herdr App"], ["opencode", "opencode"]]) {
    const r = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" });
    if (r.status !== 0) { print(err, `init: ${cmd} was not found (${why})`); return EXIT.env; }
  }
  const core = makeHc({ env: process.env });
  const coreId = core.coreId();
  if (!coreId) { print(err, "init: cannot read the Herdr core id (is the core running?)"); return EXIT.env; }
  const app = defaultApp(["status"]);
  if (app.status !== 0) { print(err, "init: herdr-app status failed; the App must be open locally (remote machines are not supported in v1)"); return EXIT.env; }

  const terminalId = process.env.HC_TERMINAL_ID;
  if (!terminalId) { print(err, "init: HC_TERMINAL_ID is missing; run this from the Planning terminal"); return EXIT.reject; }
  const planningTerm = core.get(terminalId);
  if (!planningTerm) { print(err, "init: cannot read the Planning terminal with hc get"); return EXIT.reject; }
  const profileResult = parseProfile(planningTerm.foreground?.argv ?? [], { model, effort });
  if (!profileResult.ok) { print(err, `init: ${profileResult.error}`); return EXIT.reject; }
  const profile = profileResult.profile;
  const planningCli = spawnSync("sh", ["-c", `command -v ${profile.cli}`], { encoding: "utf8" });
  if (planningCli.status !== 0) { print(err, `init: ${profile.cli} was not found`); return EXIT.env; }

  // git pre-check: refuse the default branch before creating an upstream for it,
  // then create the upstream if missing and require a real push --dry-run.
  const remoteHead = git.run(["symbolic-ref", "-q", "refs/remotes/origin/HEAD"], info.toplevel);
  const defaultBranch = remoteHead.code === 0 ? remoteHead.stdout.replace(/^refs\/remotes\/origin\//, "") : null;
  const upstreamName = info.upstream ? info.upstream.replace(/^origin\//, "") : info.branch;
  if (defaultBranch ? upstreamName === defaultBranch : ["main", "master"].includes(upstreamName)) {
    print(err, `init: refusing to run on the repository's default branch (${upstreamName}); use a dedicated worktree/branch`);
    return EXIT.reject;
  }
  if (!info.upstream) {
    print(out, `init: no upstream for ${info.branch}; running git push -u origin ${info.branch}`);
    const push = git.run(["push", "-u", "origin", info.branch], info.toplevel);
    if (push.code !== 0) { print(err, `init: ${gitFailCode(push.stderr)}: cannot create upstream (${push.stderr.split("\n")[0]})`); return EXIT.reject; }
  }
  const dry = git.run(["push", "--dry-run"], info.toplevel);
  if (dry.code !== 0) { print(err, `init: ${gitFailCode(dry.stderr)}: git push --dry-run failed (${dry.stderr.split("\n")[0]})`); return EXIT.reject; }

  // state root / archive
  const root = stateHome();
  const wtId = wtIdForGitDir(info.git_dir);
  const stateDir = path.join(root, wtId);
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  let existing = null;
  try { existing = await readJsonMaybe(path.join(stateDir, "state.json")); } catch { existing = null; }
  if (existing) {
    if (existing.status === "working" || existing.status === "needs_user") {
      print(err, `init: ${stateDir} already has a ${existing.status} run; finish it or stop it first`);
      return EXIT.reject;
    }
    const archive = path.join(root, "archive", `${wtId}-${utcStamp()}`);
    await fsp.mkdir(path.dirname(archive), { recursive: true, mode: 0o700 });
    await fsp.rename(stateDir, archive);
    print(out, `init: archived the previous run to ${archive}`);
  }

  const head = git.run(["rev-parse", "HEAD"], info.toplevel).stdout;
  const runId = runIdFor(wtId);
  const state = {
    schema: SCHEMA,
    run_id: runId,
    core_id: coreId,
    repo: {
      git_dir: info.git_dir, common_dir: info.common_dir, toplevel: info.toplevel,
      branch: info.branch, base_head: head, head, stage_head: head,
      dirty_at_start: info.dirty.map((l) => l.slice(3).trim()).filter(Boolean),
      first_commit_seen: false,
    },
    profile: { cli: profile.cli, model: profile.model, effort: profile.effort },
    planning: planningFromTerminal(planningTerm),
    stage: "development",
    status: "working",
    needs_user: null,
    rework: { cycles: 0 },
    tasks: makeInitialTasks(doc),
    acceptance: makeAcceptance(doc),
    reviews: [],
    tuning_attempts: 0,
    dispatch: null,
    updated: 0,
    updated_at: wallIso(),
  };

  // Build in a temp directory, then rename: a failed init leaves no half state (E3/E13).
  for (const name of await fsp.readdir(root).catch(() => [])) {
    if (name.startsWith(`.${wtId}.tmp-`)) await fsp.rm(path.join(root, name), { recursive: true, force: true });
  }
  const tmpDir = path.join(root, `.${wtId}.tmp-${process.pid}-${randomId()}`);
  await fsp.mkdir(tmpDir, { recursive: true, mode: 0o700 });
  for (const sub of ["dispatch", "results", "reviews", "logs"]) await fsp.mkdir(path.join(tmpDir, sub), { recursive: true, mode: 0o700 });
  await writeAtomic(path.join(tmpDir, "handoff.md"), handoffText);
  await writeAtomic(path.join(tmpDir, "tasks.json"), tasksText);
  await writeAtomic(path.join(tmpDir, "events.jsonl"), "");
  await writeState(tmpDir, state);
  try { await fsp.rename(tmpDir, stateDir); }
  catch (e) {
    await fsp.rm(tmpDir, { recursive: true, force: true });
    print(err, `init: cannot create ${stateDir} (${e.code ?? e.message})`);
    return EXIT.reject;
  }
  const indexFile = path.join(root, "index.json");
  const index = await readJsonMaybe(indexFile).catch(() => ({}));
  index[info.git_dir] = wtId;
  await writeAtomic(indexFile, JSON.stringify(index, null, 2) + "\n");
  if (!(await readTextMaybe(path.join(root, "config.json")))) {
    await writeAtomic(path.join(root, "config.json"), JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
  }

  if (info.dirty.length) print(out, `init: warning: ${info.dirty.length} uncommitted path(s) at start; the first stage will commit and push them`);
  print(out, `run: ${runId}`);
  print(out, `state: ${stateDir}`);
  print(out, `Tuning 將使用：${profile.cli} --model ${profile.model} --effort ${profile.effort}`);
  print(out, `tasks: ${doc.tasks.length}; acceptance: ${doc.acceptance.length}`);

  if (noStart) { print(out, "init: --no-start; run `my-orca start` to start the Runner"); return EXIT.ok; }
  const started = await startRunner({ wtId, stateDir, out, err, env: process.env });
  return started;
}

async function startRunner({ wtId, stateDir, out, err, env, acceptHead = false }) {
  const state = await readJsonMaybe(path.join(stateDir, "state.json"));
  if (!state) { print(err, `start: no state at ${stateDir}`); return EXIT.reject; }
  if (state.status === "completed") { print(out, `start: ${wtId} is already completed`); return EXIT.ok; }
  const git = makeGit();
  const info = git.info(state.repo.toplevel);
  if (!info.ok) { print(err, `start: worktree is missing (${state.repo.toplevel})`); return EXIT.reject; }
  if (info.git_dir !== state.repo.git_dir) {
    print(err, `start: the worktree's git-dir changed; this run belongs to ${state.repo.git_dir}`);
    return EXIT.reject;
  }
  if (info.toplevel !== state.repo.toplevel) {
    state.repo.toplevel = info.toplevel;
    await writeState(stateDir, state, state.updated);
  }
  if (acceptHead) {
    const clean = info.dirty.length === 0;
    const pushed = pushCheck(state, info, git, state.repo.stage_head);
    if (!clean || !pushed.ok) { print(err, `start --accept-head: ${pushed.detail || "working tree is dirty"}`); return EXIT.reject; }
    state.repo.head = info.head;
    state.repo.stage_head = info.head;
    state.dispatch = null;
    state.status = "working";
    state.needs_user = null;
    await writeState(stateDir, state, state.updated);
    print(out, `start: accepted HEAD ${info.head} as the new baseline`);
  }
  const hc = makeHc({ env });
  const currentCore = hc.coreId();
  if (!currentCore) { print(err, "start: cannot read the Herd core id"); return EXIT.env; }
  if (!state.dispatch && state.core_id !== currentCore) {
    state.core_id = currentCore;
    await writeState(stateDir, state, state.updated);
  }
  try {
    const guard = makeHc({ env, expectCoreId: state.core_id });
    for (const t of hc.list({ "orca.run": state.run_id }, { all: true })) {
      if (t.state !== "live") { try { guard.rm(t.address); } catch { /* not ours / gone */ } }
    }
  } catch { /* cleanup is best effort */ }
  const name = `orca-r-${wtId}`;
  const run = hc.run([
    "--bg", "--no-parent", "--no-notify", "--json",
    "--name", name,
    "--label", `orca.run=${state.run_id}`, "--label", "orca.role=runner",
    "--cwd", state.repo.toplevel,
    "--", "node", fileURLToPath(import.meta.url), "run", wtId,
  ]);
  if (run.code === 0) {
    print(out, `Runner started: ${run.json?.address ?? name}`);
    return EXIT.ok;
  }
  const kind = run.error?.kind ?? run.json?.error?.kind ?? null;
  if (kind === "name_taken") { print(out, `Runner already live: ${name}`); return EXIT.ok; }
  print(err, `start: hc run failed (${kind ?? "unknown"}): ${run.stderr ?? ""}`.trim());
  return EXIT.env;
}

async function cmdStart(argv, io) {
  const { out, err } = io;
  const wt = await resolveWtId(stateHome(), argv.find((a) => !a.startsWith("-") && a !== "start"));
  if (!wt) { print(err, "start: not in a git worktree; pass <wt-id>"); return EXIT.reject; }
  return startRunner({ wtId: wt, stateDir: path.join(stateHome(), wt), out, err, env: process.env, acceptHead: has(argv, "--accept-head") });
}

async function cmdRun(argv, io) {
  const { err } = io;
  const wt = argv.find((a) => !a.startsWith("-") && a !== "run");
  if (!wt) { print(err, "usage: my-orca run <wt-id> (Runner only)"); return EXIT.usage; }
  const self = process.env.HC_TERMINAL_ID;
  if (!self) { print(err, "run: HC_TERMINAL_ID is missing; the Runner must run inside hc"); return EXIT.reject; }
  const expected = `orca-r-${wt}`;
  const stateDir = path.join(stateHome(), wt);
  const state = await readJsonMaybe(path.join(stateDir, "state.json"));
  if (!state) { print(err, `run: no state at ${stateDir}`); return EXIT.reject; }
  const rawHc = makeHc({ env: process.env });
  const term = rawHc.get(self);
  if (!term || term.name !== expected) { print(err, `run: refusing: terminal name is ${term?.name ?? "unknown"}, expected ${expected}`); return EXIT.reject; }
  const currentCore = rawHc.coreId();
  if (state.core_id !== currentCore) {
    if (!state.dispatch) { state.core_id = currentCore; await writeState(stateDir, state, state.updated); }
    else { print(err, "run: core id changed with an active dispatch; resume will reconcile it"); }
  }
  const forbidCoreIds = String(process.env.MY_ORCA_FORBID_CORE_IDS ?? "").split(",").filter(Boolean);
  const hc = makeHc({ env: process.env, expectCoreId: state.core_id, forbidCoreIds });
  const cfg = await readConfig(stateHome());
  const config = cfg.config;
  for (const ignored of cfg.ignored) {
    await appendEvent(path.join(stateDir, "events.jsonl"), { type: "config_ignored", detail: { key: ignored.key, reason: ignored.reason } });
  }
  const git = makeGit();
  const ctx = makeRunnerContext({
    stateDir, state, hc, git, config,
    save: () => saveState(ctx),
    event: async (type, extra = {}) => {
      await appendEvent(path.join(stateDir, "events.jsonl"), { type, run: state.run_id, ...extra });
      print(io.out, `${new Date().toISOString()} ${type}${extra.task ? ` task=${extra.task}` : ""}${extra.dispatch ? ` dispatch=${extra.dispatch}` : ""}`);
    },
    log: (line) => print(io.out, `${new Date().toISOString()} ${line}`),
  });
  ctx.lastUpdated = state.updated;
  const out = await runLoop(ctx, { closePlanning: true });
  return out.done ? EXIT.ok : (out.code === "needs_user" || out.stop ? EXIT.ok : EXIT.reject);
}

async function cmdStop(argv, io) {
  const { out, err } = io;
  const wt = await resolveWtId(stateHome(), argv.find((a) => !a.startsWith("-") && a !== "stop"));
  if (!wt) { print(err, "stop: pass <wt-id>"); return EXIT.reject; }
  const state = await readJsonMaybe(path.join(stateHome(), wt, "state.json"));
  if (!state) { print(err, `stop: no state for ${wt}`); return EXIT.reject; }
  const hc = makeHc({ env: process.env });
  const id = hc.coreId();
  if (!id || id !== state.core_id) { print(err, `stop: refusing: core ${id ?? "unknown"} is not ${state.core_id}`); return EXIT.env; }
  const guarded = makeHc({ env: process.env, expectCoreId: state.core_id });
  const name = `orca-r-${wt}`;
  try { guarded.kill(name); } catch { /* not live */ }
  if (has(argv, "--workers")) {
    for (const role of ["dev", "tuning"]) {
      for (const t of hc.list({ "orca.run": state.run_id, "orca.role": role }, { all: false })) {
        try { guarded.kill(t.address); print(out, `stopped ${role} ${t.address}`); } catch { /* gone */ }
      }
    }
  }
  for (const t of hc.list({ "orca.run": state.run_id }, { all: true })) if (t.state !== "live") { try { guarded.rm(t.address); } catch { /* gone */ } }
  print(out, `stopped Runner ${name}${has(argv, "--workers") ? " and workers" : ""}`);
  return EXIT.ok;
}

function listLiveRoles(out, hc) {
  let any = false;
  for (const role of ["runner", "dev", "tuning"]) {
    for (const t of hc.list({ "orca.role": role }, { all: false })) {
      any = true;
      print(out, `live ${role} ${t.address} run=${t.labels?.["orca.run"] ?? "?"}`);
    }
  }
  if (!any) print(out, "no live workflow terminals");
}

async function cmdStatus(argv, io) {
  const { out, err } = io;
  const wt = await resolveWtId(stateHome(), argv.find((a) => !a.startsWith("-") && a !== "status"));
  if (!wt) {
    if (has(argv, "--all")) { listLiveRoles(out, makeHc({ env: process.env })); return EXIT.ok; }
    print(err, "status: not in a git worktree; pass <wt-id>"); return EXIT.reject;
  }
  const state = await readJsonMaybe(path.join(stateHome(), wt, "state.json"));
  if (!state) {
    if (has(argv, "--all")) { listLiveRoles(out, makeHc({ env: process.env })); return EXIT.ok; }
    print(err, `status: no run for ${wt}`); return EXIT.reject;
  }
  if (has(argv, "--json")) { print(out, JSON.stringify(publicStatus(state), null, 2)); return EXIT.ok; }
  print(out, `run ${state.run_id}`);
  print(out, `stage ${state.stage} · status ${state.status}${state.needs_user ? ` (${state.needs_user.code})` : ""}`);
  const ls = lights(state);
  print(out, ls.map((l) => `${l.long} ${l.accepted}/${l.total} ${l.state}`).join(" · "));
  print(out, `rework cycles ${state.rework?.cycles ?? 0}${state.dispatch ? ` · dispatch ${state.dispatch.id} (${state.dispatch.kind}, ${state.dispatch.phase})` : ""}`);
  for (const t of state.tasks ?? []) print(out, `  ${t.id} [${t.state}] ${t.title} — attempts ${(t.attempts ?? []).length}`);
  if (has(argv, "--all")) listLiveRoles(out, makeHc({ env: process.env }));
  if (state.needs_user) print(out, `needs user: ${state.needs_user.code} — ${state.needs_user.detail}`);
  return EXIT.ok;
}

async function cmdConfig(argv, io) {
  const { out, err } = io;
  const root = stateHome();
  if (argv[1] === "get" || argv[1] === undefined) {
    const { config, ignored } = await readConfig(root);
    print(out, JSON.stringify(config, null, 2));
    for (const i of ignored) print(err, `ignored ${i.key}: ${i.reason}`);
    return EXIT.ok;
  }
  if (argv[1] !== "set") { print(err, "usage: my-orca config set <key> <value>"); return EXIT.usage; }
  const key = argv[2], value = argv[3];
  const bad = checkConfigValue(key, value);
  if (bad) { print(err, `config set: ${bad}`); return EXIT.reject; }
  const raw = await readJsonMaybe(path.join(root, "config.json")).catch(() => ({}));
  const next = { ...DEFAULT_CONFIG, ...(isObject(raw) ? raw : {}), [key]: normalizeConfigValue(key, value) };
  await writeAtomic(path.join(root, "config.json"), JSON.stringify(next, null, 2) + "\n");
  print(out, `${key} = ${next[key]}`);
  return EXIT.ok;
}

async function cmdInitCheck(argv, io) {
  return cmdInit(argv, io);
}

export async function main(argv = process.argv.slice(2), io = { out: process.stdout, err: process.stderr }) {
  const cmd = argv[0];
  if (!cmd || cmd === "--help" || cmd === "-h") {
    print(io.out, `my-orca — workflow Runner (docs/spec-v2-converged.md)

  init --handoff <path> --tasks <path> [--model M] [--effort E] [--no-start] [--check]
  start [<wt-id>] [--accept-head]
  run <wt-id>                 (inside orca-r-<wt-id> only)
  stop [<wt-id>] [--workers]
  status [<wt-id>] [--json] [--all]
  config [get | set <key> <value>]`);
    return EXIT.ok;
  }
  if (cmd === "init") return cmdInit(argv, io);
  if (cmd === "start") return cmdStart(argv, io);
  if (cmd === "run") return cmdRun(argv, io);
  if (cmd === "stop") return cmdStop(argv, io);
  if (cmd === "status") return cmdStatus(argv, io);
  if (cmd === "config") return cmdConfig(argv, io);
  print(io.err, `my-orca: unknown command ${cmd}`);
  return EXIT.usage;
}

const entry = process.argv[1] ? (() => { try { return fs.realpathSync(process.argv[1]); } catch { return path.resolve(process.argv[1]); } })() : null;
const isMain = entry && entry === fileURLToPath(import.meta.url);
if (isMain) {
  main().then((code) => { process.exitCode = code; }).catch((e) => {
    console.error(`my-orca: ${e.message}`);
    process.exitCode = 1;
  });
}
