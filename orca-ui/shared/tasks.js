// Task management: the schedule and reset-time logic both mods share, and the one-shot runner.
//
// Pure except `runTask`, which takes the host's `exec` as an argument so `node --test` runs it.
// `scripts/sync-shared.mjs` copies this file into orca-tasks (the page) and orca-chrome (the
// runner, which must live in an always-shown block).
//
// Times: every instant here is epoch milliseconds. `tasks.json` stores the last run; the next
// due time is recomputed from it and from the CLIs' own reset reports, so a relaunch cannot
// ping twice inside one usage window.

export const TASKS_FILE = "tasks.json";
export const TASKS_VERSION = 1;
export const PING_PROMPT = "ping";

// The windows the CLIs meter, in minutes: Claude's session and week, Codex's primary/secondary.
export const WINDOW_MINUTES = { h5: 300, wk: 10080 };
const WINDOW_LABEL = { h5: "5h", wk: "weekly" };
const PROVIDER_LABEL = { claude: "Claude", codex: "Codex" };

// A failed ping is retried soon (a Codex window may not have rolled over yet), then slowly.
const RETRY_MS = 2 * 60_000;
const RETRY_SLOW_MS = 30 * 60_000;
const RETRY_SLOW_AFTER = 4;
const NOTE_MAX = 300;
// `exec` caps at ten minutes; a ping takes seconds and a stuck CLI should give the slot back.
export const TASK_TIMEOUT_MS = 180_000;

/** The two seeded tasks. `codexModel` comes from the Codex catalog (see runner.js). */
export function defaultTasks(options = {}) {
  const codexModel = typeof options.codexModel === "string" && options.codexModel ? options.codexModel : "gpt-5.6-luna";
  return {
    version: TASKS_VERSION,
    tasks: [
      {
        id: "claude-reset-ping",
        name: "Claude reset ping",
        enabled: true,
        agent: "claude",
        trigger: { type: "reset", provider: "claude", window: "h5", delaySeconds: 5 },
        // Claude Code's own initialize response: `haiku` is claude-haiku-5-5, the cheapest
        // model, and `low` is the lowest effort it accepts.
        argv: ["claude", "-p", PING_PROMPT, "--model", "haiku", "--effort", "low"],
        cwd: null,
      },
      {
        id: "codex-reset-ping",
        name: "Codex reset ping",
        enabled: true,
        agent: "codex",
        trigger: { type: "reset", provider: "codex", window: "h5", delaySeconds: 5 },
        argv: ["codex", "exec", "--skip-git-repo-check", "-m", codexModel, "-c", "model_reasoning_effort=low", PING_PROMPT],
        cwd: null,
      },
    ],
  };
}

/**
 * `tasks.json` as `{ config, error }`. Missing or blank text is a fresh seed (`seeded: true`),
 * a damaged file is an error with no config, so the page can show it and the runner never
 * overwrites the person's file with a seed.
 */
export function parseTasks(text) {
  if (text == null || String(text).trim() === "") return { config: defaultTasks(), error: null, seeded: true };
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { config: null, error: "tasks.json is not valid JSON.", seeded: false };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { config: null, error: "tasks.json must contain a JSON object.", seeded: false };
  }
  if (!Array.isArray(data.tasks)) {
    return { config: null, error: "tasks.json needs a `tasks` list.", seeded: false };
  }
  for (const [index, task] of data.tasks.entries()) {
    const problem = taskProblem(task, index);
    if (problem) return { config: null, error: problem, seeded: false };
  }
  return {
    // `enabled` absent means on (a hand-written task should not start paused).
    config: { ...data, version: data.version ?? TASKS_VERSION, tasks: data.tasks.map((task) => ({ ...task, enabled: task.enabled !== false })) },
    error: null,
    seeded: false,
  };
}

function taskProblem(task, index) {
  const where = `Task ${index + 1}`;
  if (!task || typeof task !== "object") return `${where} must be an object.`;
  if (typeof task.id !== "string" || !task.id) return `${where} needs an id.`;
  if (typeof task.name !== "string" || !task.name) return `${where} needs a name.`;
  if (!Array.isArray(task.argv) || task.argv.length === 0 || task.argv.some((arg) => typeof arg !== "string")) {
    return `${where} needs a non-empty argv list of strings.`;
  }
  const trigger = task.trigger;
  if (!trigger || typeof trigger !== "object") return `${where} needs a trigger.`;
  if (trigger.type === "daily") {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(trigger.time ?? ""))) return `${where} needs a trigger time as HH:MM.`;
    return null;
  }
  if (trigger.type === "reset") {
    if (!PROVIDER_LABEL[trigger.provider]) return `${where} needs trigger.provider "claude" or "codex".`;
    if (!WINDOW_MINUTES[trigger.window]) return `${where} needs trigger.window "h5" or "wk".`;
    return null;
  }
  return `${where} needs trigger.type "reset" or "daily".`;
}

export function serializeTasks(config) {
  return `${JSON.stringify({ version: config?.version ?? TASKS_VERSION, tasks: config?.tasks ?? [] }, null, 2)}\n`;
}

export function windowMinutes(window) {
  return WINDOW_MINUTES[window] ?? 300;
}

export function windowLabel(window) {
  return WINDOW_LABEL[window] ?? String(window ?? "");
}

export function providerLabel(provider) {
  return PROVIDER_LABEL[provider] ?? String(provider ?? "");
}

/**
 * When this task should run next, in epoch ms.
 * `ctx`: `{ now, resets, }`; the last run comes from `task.last` (`at`, `code`, `fails`).
 *
 * A reset task runs at the window's own reset time; when the window looks idle (no reset
 * reported, or one already past) it runs now, which is the trigger the person wanted. It
 * never runs again inside a window it started (`last.at + window`), so a relaunch with a
 * stale usage file cannot ping twice. A failed run retries in two minutes, then every 30.
 */
export function nextRunAt(task, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const trigger = task?.trigger ?? {};
  if (trigger.type === "daily") {
    // A day's time that passed while Herdr was closed is still owed today: report it as due
    // (the timer fires within its tick), and only then move to tomorrow.
    const owed = latestDaily(trigger.time, now);
    const lastAt = typeof task?.last?.at === "number" ? task.last.at : 0;
    if (owed !== null && owed > lastAt) return owed;
    return nextDaily(trigger.time, now);
  }
  if (trigger.type !== "reset") return null;

  const last = task.last && typeof task.last === "object" ? task.last : null;
  const lastAt = typeof last?.at === "number" ? last.at : null;
  if (lastAt !== null && last.code !== 0) {
    const fails = Number(last.fails ?? 1);
    return lastAt + (fails < RETRY_SLOW_AFTER ? RETRY_MS : RETRY_SLOW_MS);
  }

  // A plan that does not meter the 5h window has nothing to ping for; the page greys it out.
  if (trigger.window === "h5" && ctx.resets?.[trigger.provider]?.metered5h === false) return null;
  const delay = Math.max(0, Number(trigger.delaySeconds ?? 5)) * 1000;
  const reset = ctx.resets?.[trigger.provider]?.[trigger.window];
  // A reported live window is the truth about when it ends, even when it is sooner than the
  // one the last run appeared to start (that ping can land inside an already-running window).
  if (typeof reset === "number" && reset > now) return reset + delay;
  const startedAt = lastAt !== null && last.code === 0 ? lastAt + windowMinutes(trigger.window) * 60_000 : 0;
  return Math.max(now, startedAt);
}

export function isDue(task, ctx = {}) {
  const next = nextRunAt(task, ctx);
  return typeof next === "number" && next <= (ctx.now ?? Date.now());
}

/** The next local `HH:MM` (a run at 09:00 makes the next one tomorrow). */
export function nextDaily(time, now = Date.now()) {
  const at = dailyAt(time, now);
  if (at === null) return null;
  if (at <= now) {
    const next = new Date(now);
    next.setHours(new Date(at).getHours(), new Date(at).getMinutes(), 0, 0);
    next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  return at;
}

/** Today's local `HH:MM` when it is at or before `now`, else null. */
export function latestDaily(time, now = Date.now()) {
  const at = dailyAt(time, now);
  return at !== null && at <= now ? at : null;
}

function dailyAt(time, now) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time ?? ""));
  if (!match) return null;
  const at = new Date(now);
  at.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return at.getTime();
}

/** The task's `last` after a run: failures count up, a success resets them. */
export function recordRun(task, run) {
  const fails = run.code === 0 ? 0 : Number(task?.last?.fails ?? 0) + 1;
  return { at: run.at, code: run.code, note: run.note ?? "", fails };
}

/** "At Claude 5h reset" / "Every day at 09:00". */
export function describeTrigger(task) {
  const trigger = task?.trigger ?? {};
  if (trigger.type === "daily") return `Every day at ${trigger.time}`;
  if (trigger.type === "reset") {
    return `At ${providerLabel(trigger.provider)} ${windowLabel(trigger.window)} reset`;
  }
  return "No trigger";
}

/** "now", "in 4m", "in 3h 12m", "in 5d 23h". */
export function formatCountdown(ms) {
  const left = Math.round(Number(ms) / 1000);
  if (!Number.isFinite(left) || left <= 0) return "now";
  if (left < 60) return `in ${left}s`;
  if (left < 3600) return `in ${Math.floor(left / 60)}m`;
  if (left < 86400) return `in ${Math.floor(left / 3600)}h ${Math.floor((left % 3600) / 60)}m`;
  return `in ${Math.floor(left / 86400)}d ${Math.floor((left % 86400) / 3600)}h`;
}

/** Local "13:50". */
export function formatClock(ms) {
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** The last non-empty line of output, trimmed to `max` characters. */
export function tail(text, max = NOTE_MAX) {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const line = lines.length ? lines[lines.length - 1] : "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Runs a task's argv through the host's `exec` and reports what happened. Never throws: a
 * command that is not installed, a timeout and a nonzero exit all come back as a code + note.
 */
export async function runTask(execFn, task, options = {}) {
  const argv = Array.isArray(task?.argv) ? task.argv.filter((arg) => typeof arg === "string") : [];
  if (argv.length === 0) return { at: Date.now(), code: -1, note: "This task has no argv." };
  try {
    const result = await execFn(argv[0], argv.slice(1), {
      ...(options.cwd ?? task.cwd ? { cwd: options.cwd ?? task.cwd } : {}),
      timeout: options.timeout ?? TASK_TIMEOUT_MS,
    });
    const code = Number.isFinite(result?.code) ? result.code : 0;
    const note = code === 0 ? tail(result?.stdout) || tail(result?.stderr) : tail(result?.stderr) || tail(result?.stdout);
    return { at: Date.now(), code, note };
  } catch (error) {
    return { at: Date.now(), code: -1, note: tail(String(error?.message ?? error)) };
  }
}

// The reset instants already on this computer, in one `sh` run. The same files orca-status
// reads for the quota bar: Claude's live statusLine feed and its OAuth snapshot, and the
// newest Codex rollout that reports rate limits. A limited Codex writes `primary: null` in a
// newer rollout, hence the `"primary":{` filter (exactly local-usage.js's rule).
export const RESET_SCRIPT = `d="$HOME/.cache/herdr-usage"
live=null; api=null
if [ -s "$d/claude-statusline.json" ]; then live=$(cat "$d/claude-statusline.json" 2>/dev/null); fi
if [ -s "$d/claude-oauth.json" ]; then api=$(cat "$d/claude-oauth.json" 2>/dev/null); fi
[ -n "$live" ] || live=null
[ -n "$api" ] || api=null
codex=null
if [ -s "$HOME/.codex/auth.json" ]; then
  codex=$(ls -t "$HOME"/.codex/sessions/*/*/*/*.jsonl 2>/dev/null | while IFS= read -r f; do
    v=$(grep '"rate_limits"' "$f" 2>/dev/null | tail -n 1 | jq -c '.. | objects | select(has("rate_limits")) | .rate_limits | select(.primary != null or .secondary != null) | {primary, secondary}' 2>/dev/null)
    if [ -n "$v" ]; then printf '%s' "$v"; break; fi
  done)
  [ -n "$codex" ] || codex=null
fi
printf '{"claude":{"live":%s,"api":%s},"codex":%s}' "$live" "$api" "$codex"`;

/** `{ claude: { h5, wk, metered5h }, codex: { … } }`: epoch ms or null, and whether the plan
 *  meters the 5h window at all (false: the ping is greyed out, null: not known). */
export function parseResets(text) {
  let data = null;
  try {
    data = JSON.parse(String(text ?? ""));
  } catch {
    data = null;
  }
  return { claude: claudeResets(data?.claude), codex: codexResets(data?.codex) };
}

function emptyResets() {
  return { h5: null, wk: null, metered5h: null };
}

function claudeResets(payload) {
  if (!payload || typeof payload !== "object") return emptyResets();
  const live = payload.live?.rate_limits ?? payload.live ?? null;
  const api = payload.api ?? null;
  let h5 = resetMs(live?.five_hour?.resets_at);
  let wk = resetMs(live?.seven_day?.resets_at);
  const snapshot = apiResets(api);
  h5 = newest(h5, snapshot.h5);
  wk = newest(wk, snapshot.wk);
  return { h5, wk, metered5h: claudeMetersSession(live, api) };
}

/**
 * Whether Claude's plan meters a 5h session at all. A plan whose reports carry only the weekly
 * window (higher subscriptions drop the session limit) is `false`; no report at all is `null`,
 * so an unknown plan is never greyed out by guesswork.
 */
function claudeMetersSession(live, api) {
  const liveWindows = live && typeof live === "object" ? live : null;
  const apiWindows = api && typeof api === "object" ? api : null;
  if (apiWindows?.api || apiWindows?.bedrock) return null; // an API-key/bedrock session: not a plan
  if (liveWindows && "five_hour" in liveWindows) return true;
  if (apiWindows) {
    const ranged = Array.isArray(apiWindows.limits) ? apiWindows.limits.some((limit) => limit?.kind === "session") : "five_hour" in apiWindows;
    if (ranged) return true;
  }
  if (liveWindows || apiWindows) return false;
  return null;
}

function apiResets(api) {
  if (!api || typeof api !== "object") return emptyResets();
  if (Array.isArray(api.limits)) {
    let h5 = null;
    let wk = null;
    for (const limit of api.limits) {
      if (limit?.kind === "session") h5 = newest(h5, resetMs(limit.resets_at));
      if (limit?.kind === "weekly_all") wk = newest(wk, resetMs(limit.resets_at));
    }
    return { h5, wk };
  }
  return { h5: resetMs(api.five_hour?.resets_at), wk: resetMs(api.seven_day?.resets_at) };
}

function codexResets(payload) {
  if (!payload || typeof payload !== "object") return emptyResets();
  const out = emptyResets();
  // A plan that meters only the week reports a weekly window and no 5h one: that is exempt,
  // not unknown, and greys the 5h ping out. A payload with no window at all says nothing.
  if (payload.primary && typeof payload.primary === "object") {
    out.metered5h = Number(payload.primary.window_minutes) === WINDOW_MINUTES.h5;
  } else if (payload.secondary && typeof payload.secondary === "object") {
    out.metered5h = Number(payload.secondary.window_minutes) === WINDOW_MINUTES.h5;
  }
  for (const [id, window] of [["h5", payload.primary], ["wk", payload.secondary]]) {
    if (!window || typeof window !== "object") continue;
    // secondary is the week on a Plus/Pro plan; trust the reported length when it is there.
    const bucket = Number(window.window_minutes) === WINDOW_MINUTES.wk ? "wk" : id;
    out[bucket] = newest(out[bucket], resetMs(window.resets_at));
  }
  return out;
}

/** Epoch seconds, epoch milliseconds or an ISO string, as epoch milliseconds; null otherwise. */
export function resetMs(value) {
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 1e10 ? numeric : numeric * 1000;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value > 1e10 ? value : value * 1000;
}

function newest(a, b) {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return Math.max(a, b);
}
