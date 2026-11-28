type JsonRecord = Record<string, unknown>;
type Loose = JsonRecord | null | undefined;
export type TaskProvider = "claude" | "codex";
export type TaskWindow = "h5" | "wk";
export type TaskTrigger =
  | {
      type: "daily";
      time: string;
      provider?: TaskProvider;
      window?: TaskWindow;
      delaySeconds?: unknown;
    }
  | {
      type: "reset";
      provider: TaskProvider;
      window: TaskWindow;
      time?: string;
      delaySeconds?: unknown;
    };
export type Task = JsonRecord & {
  id: string;
  name: string;
  argv: string[];
  trigger: TaskTrigger;
  enabled: boolean;
};
export type TaskConfig = JsonRecord & { version: unknown; tasks: Task[] };
export type ParseTasksResult =
  | { config: TaskConfig; error: null; seeded: boolean }
  | { config: null; error: string; seeded: false };
export type ProviderResets = { h5: number | null; wk: number | null; metered5h: boolean | null };
export type ResetSnapshot = { claude: ProviderResets; codex: ProviderResets };
type ResetTimes = Pick<ProviderResets, "h5" | "wk">;
type ScheduleContext = {
  now?: number;
  resets?: Partial<Record<TaskProvider, ProviderResets>> | null;
};
type RunOutcome = { at: number; code: number; note?: string };
type TaskExecOptions = { cwd?: string; timeout: number };
type TaskExec = (command: string, args: string[], options: TaskExecOptions) => Promise<unknown>;
type RunTaskOptions = { cwd?: string; timeout?: number };

export const TASKS_FILE = "tasks.json";
export const TASKS_VERSION = 1;
export const PING_PROMPT = "ping";

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;

export const WINDOW_MINUTES = { h5: 300, wk: 10080 };
const WINDOW_LABEL = { h5: "5h", wk: "weekly" };
const PROVIDER_LABEL = { claude: "Claude", codex: "Codex" };

const RETRY_MS = 2 * MS_PER_MINUTE;
const RETRY_SLOW_MS = 30 * MS_PER_MINUTE;
const RETRY_SLOW_AFTER = 4;
const NOTE_MAX = 300;

export const TASK_TIMEOUT_MS = 180_000;

const DEFAULT_DELAY_SECONDS = 5;

const NOT_RUN_CODE = -1;

const DAILY_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

const prop = (value: unknown, key: string): unknown => (value as Loose)?.[key];

export function defaultTasks(options: { codexModel?: unknown } = {}): TaskConfig {
  const codexModel =
    typeof options.codexModel === "string" && options.codexModel
      ? options.codexModel
      : "gpt-5.6-luna";
  return {
    version: TASKS_VERSION,
    tasks: [
      {
        id: "claude-reset-ping",
        name: "Claude reset ping",
        enabled: true,
        agent: "claude",
        trigger: {
          type: "reset",
          provider: "claude",
          window: "h5",
          delaySeconds: DEFAULT_DELAY_SECONDS,
        },

        argv: ["claude", "-p", PING_PROMPT, "--model", "haiku", "--effort", "low"],
        cwd: null,
      },
      {
        id: "codex-reset-ping",
        name: "Codex reset ping",
        enabled: true,
        agent: "codex",
        trigger: {
          type: "reset",
          provider: "codex",
          window: "h5",
          delaySeconds: DEFAULT_DELAY_SECONDS,
        },
        argv: [
          "codex",
          "exec",
          "--skip-git-repo-check",
          "-m",
          codexModel,
          "-c",
          "model_reasoning_effort=low",
          PING_PROMPT,
        ],
        cwd: null,
      },
    ],
  };
}

export function parseTasks(text: unknown): ParseTasksResult {
  if (text == null || String(text).trim() === "")
    return { config: defaultTasks(), error: null, seeded: true };
  let data: unknown;
  try {
    data = JSON.parse(String(text));
  } catch {
    return { config: null, error: "tasks.json is not valid JSON.", seeded: false };
  }
  if (!isObjectLike(data) || Array.isArray(data)) {
    return { config: null, error: "tasks.json must contain a JSON object.", seeded: false };
  }
  const taskValues = data.tasks;
  if (!Array.isArray(taskValues)) {
    return { config: null, error: "tasks.json needs a `tasks` list.", seeded: false };
  }
  const tasks = taskValues as Task[];
  for (const [index, task] of tasks.entries()) {
    const problem = taskProblem(task, index);
    if (problem) return { config: null, error: problem, seeded: false };
  }
  return {
    config: {
      ...data,
      version: data.version ?? TASKS_VERSION,
      tasks: tasks.map((task) => ({ ...task, enabled: task.enabled !== false })),
    },
    error: null,
    seeded: false,
  };
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value !== "";
const isObjectLike = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object";
const objectOrNull = (value: unknown): JsonRecord | null => (isObjectLike(value) ? value : null);
const isArgvOfStrings = (argv: unknown): argv is string[] =>
  Array.isArray(argv) && argv.length > 0 && argv.every((arg: unknown) => typeof arg === "string");
const hasOwn = (object: object, key: unknown): boolean => Object.hasOwn(object, key as PropertyKey);

function resetTriggerProblem(trigger: JsonRecord, where: string): string | null {
  if (!hasOwn(PROVIDER_LABEL, trigger.provider))
    return `${where} needs trigger.provider "claude" or "codex".`;
  if (!hasOwn(WINDOW_MINUTES, trigger.window)) return `${where} needs trigger.window "h5" or "wk".`;
  return null;
}

function triggerProblem(trigger: unknown, where: string): string | null {
  if (!isObjectLike(trigger)) return `${where} needs a trigger.`;
  if (trigger.type === "daily")
    return DAILY_TIME.test(String(trigger.time ?? ""))
      ? null
      : `${where} needs a trigger time as HH:MM.`;
  if (trigger.type === "reset") return resetTriggerProblem(trigger, where);
  return `${where} needs trigger.type "reset" or "daily".`;
}

function taskProblem(task: unknown, index: number): string | null {
  const where = `Task ${index + 1}`;
  if (!isObjectLike(task)) return `${where} must be an object.`;
  if (!isNonEmptyString(task.id)) return `${where} needs an id.`;
  if (!isNonEmptyString(task.name)) return `${where} needs a name.`;
  if (!isArgvOfStrings(task.argv)) return `${where} needs a non-empty argv list of strings.`;
  return triggerProblem(task.trigger, where);
}

export function serializeTasks(config: unknown): string {
  return `${JSON.stringify({ version: prop(config, "version") ?? TASKS_VERSION, tasks: prop(config, "tasks") ?? [] }, null, 2)}\n`;
}

export function windowMinutes(window: unknown): number {
  return hasOwn(WINDOW_MINUTES, window) ? WINDOW_MINUTES[window as TaskWindow] : WINDOW_MINUTES.h5;
}

export function windowLabel(window: unknown): string {
  return hasOwn(WINDOW_LABEL, window) ? WINDOW_LABEL[window as TaskWindow] : String(window ?? "");
}

export function providerLabel(provider: unknown): string {
  return hasOwn(PROVIDER_LABEL, provider)
    ? PROVIDER_LABEL[provider as TaskProvider]
    : String(provider ?? "");
}

export function nextRunAt(task: unknown, ctx: ScheduleContext = {}): number | null {
  const now = ctx.now ?? Date.now();
  const trigger = prop(task, "trigger") ?? {};
  if (prop(trigger, "type") === "daily") return nextDailyRun(task, trigger, now);
  if (prop(trigger, "type") === "reset") return nextResetRun(task, trigger, ctx.resets, now);
  return null;
}

function nextDailyRun(task: unknown, trigger: unknown, now: number): number | null {
  const owed = latestDaily(prop(trigger, "time"), now);
  const lastAt = prop(prop(task, "last"), "at");
  const since = typeof lastAt === "number" ? lastAt : 0;
  if (owed !== null && owed > since) return owed;
  return nextDaily(prop(trigger, "time"), now);
}

function nextResetRun(
  task: unknown,
  trigger: unknown,
  resets: ScheduleContext["resets"],
  now: number,
): number | null {
  const last = objectOrNull(prop(task, "last"));
  const lastAt = typeof last?.at === "number" ? last.at : null;
  if (lastAt !== null && last?.code !== 0) return retryAt(lastAt, last?.fails);

  const reported = prop(resets, prop(trigger, "provider") as string);
  if (isUnmetered(trigger, reported)) return null;
  const window = prop(trigger, "window");
  const reset = prop(reported, window as string);
  if (typeof reset === "number" && reset > now) return reset + pingDelayMs(trigger);
  const heldUntil = lastAt === null ? 0 : lastAt + windowMinutes(window) * MS_PER_MINUTE;
  return Math.max(now, heldUntil);
}

const isUnmetered = (trigger: unknown, reported: unknown): boolean =>
  prop(trigger, "window") === "h5" && prop(reported, "metered5h") === false;

function retryAt(lastAt: number, fails: unknown): number {
  return lastAt + (Number(fails ?? 1) < RETRY_SLOW_AFTER ? RETRY_MS : RETRY_SLOW_MS);
}

const pingDelayMs = (trigger: unknown): number =>
  Math.max(0, Number(prop(trigger, "delaySeconds") ?? DEFAULT_DELAY_SECONDS)) * MS_PER_SECOND;

export function isDue(task: unknown, ctx: ScheduleContext = {}): boolean {
  const next = nextRunAt(task, ctx);
  return typeof next === "number" && next <= (ctx.now ?? Date.now());
}

export function nextDaily(time: unknown, now = Date.now()): number | null {
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

export function latestDaily(time: unknown, now = Date.now()): number | null {
  const at = dailyAt(time, now);
  return at !== null && at <= now ? at : null;
}

function dailyAt(time: unknown, now: number): number | null {
  const match = DAILY_TIME.exec(String(time ?? ""));
  if (!match) return null;
  const at = new Date(now);
  at.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return at.getTime();
}

export function recordRun(
  task: unknown,
  run: RunOutcome,
): { at: number; code: number; note: string; fails: number } {
  const fails = run.code === 0 ? 0 : Number(prop(prop(task, "last"), "fails") ?? 0) + 1;
  return { at: run.at, code: run.code, note: run.note ?? "", fails };
}

export function describeTrigger(task: unknown): string {
  const trigger = prop(task, "trigger") ?? {};
  if (prop(trigger, "type") === "daily") return `Every day at ${prop(trigger, "time") as string}`;
  if (prop(trigger, "type") === "reset") {
    return `At ${providerLabel(prop(trigger, "provider"))} ${windowLabel(prop(trigger, "window"))} reset`;
  }
  return "No trigger";
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;

export function formatCountdown(ms: number): string {
  const left = Math.round(Number(ms) / MS_PER_SECOND);
  if (!Number.isFinite(left) || left <= 0) return "now";
  if (left < SECONDS_PER_MINUTE) return `in ${left}s`;
  if (left < SECONDS_PER_HOUR) return `in ${Math.floor(left / SECONDS_PER_MINUTE)}m`;
  if (left < SECONDS_PER_DAY)
    return `in ${Math.floor(left / SECONDS_PER_HOUR)}h ${Math.floor((left % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)}m`;
  return `in ${Math.floor(left / SECONDS_PER_DAY)}d ${Math.floor((left % SECONDS_PER_DAY) / SECONDS_PER_HOUR)}h`;
}

export function formatClock(ms: number): string {
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

export function tail(text: unknown, max = NOTE_MAX): string {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const line = lines.length ? lines[lines.length - 1] : "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export async function runTask(
  execFn: TaskExec,
  task: unknown,
  options: RunTaskOptions = {},
): Promise<RunOutcome> {
  const rawArgv = prop(task, "argv");
  const argv = Array.isArray(rawArgv)
    ? rawArgv.filter((arg: unknown): arg is string => typeof arg === "string")
    : [];
  if (argv.length === 0)
    return { at: Date.now(), code: NOT_RUN_CODE, note: "This task has no argv." };
  try {
    const result = await execFn(argv[0], argv.slice(1), execOptions(task, options));
    const exitCode = prop(result, "code");
    const code = typeof exitCode === "number" && Number.isFinite(exitCode) ? exitCode : 0;
    return { at: Date.now(), code, note: noteOf(result, code) };
  } catch (error: unknown) {
    return {
      at: Date.now(),
      code: NOT_RUN_CODE,
      note: tail(String(prop(error, "message") ?? error)),
    };
  }
}

function execOptions(task: unknown, options: RunTaskOptions): TaskExecOptions {
  const cwd = options.cwd ?? prop(task, "cwd");
  return {
    ...(cwd ? { cwd: cwd as string } : {}),
    timeout: options.timeout ?? TASK_TIMEOUT_MS,
  };
}

function noteOf(result: unknown, code: number): string {
  const [preferred, fallback] =
    code === 0
      ? [prop(result, "stdout"), prop(result, "stderr")]
      : [prop(result, "stderr"), prop(result, "stdout")];
  return tail(preferred) || tail(fallback);
}

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

export function parseResets(text: unknown): ResetSnapshot {
  let data: unknown = null;
  try {
    data = JSON.parse(String(text ?? ""));
  } catch {
    data = null;
  }
  return { claude: claudeResets(prop(data, "claude")), codex: codexResets(prop(data, "codex")) };
}

function emptyResets(): ProviderResets {
  return { h5: null, wk: null, metered5h: null };
}

function claudeResets(payload: unknown): ProviderResets {
  if (!isObjectLike(payload)) return emptyResets();
  const liveSource = payload.live;
  const live = prop(liveSource, "rate_limits") ?? liveSource ?? null;
  const api = payload.api ?? null;
  let h5 = resetMs(prop(prop(live, "five_hour"), "resets_at"));
  let wk = resetMs(prop(prop(live, "seven_day"), "resets_at"));
  const snapshot = apiResets(api);
  h5 = newest(h5, snapshot.h5);
  wk = newest(wk, snapshot.wk);
  return { h5, wk, metered5h: claudeMetersSession(live, api) };
}

function claudeMetersSession(live: unknown, api: unknown): boolean | null {
  const liveWindows = isObjectLike(live) ? live : null;
  const apiWindows = isObjectLike(api) ? api : null;
  if (isKeyedSession(apiWindows)) return null;
  if (liveWindows && "five_hour" in liveWindows) return true;
  if (apiWindows && apiReportsSession(apiWindows)) return true;
  return liveWindows || apiWindows ? false : null;
}

const isKeyedSession = (api: JsonRecord | null): boolean => Boolean(api?.api || api?.bedrock);

function apiReportsSession(api: JsonRecord): boolean {
  return Array.isArray(api.limits)
    ? (api.limits as unknown[]).some((limit) => prop(limit, "kind") === "session")
    : "five_hour" in api;
}

function apiResets(api: unknown): ResetTimes {
  if (!isObjectLike(api)) return emptyResets();
  if (Array.isArray(api.limits)) {
    let h5: number | null = null;
    let wk: number | null = null;
    for (const limit of api.limits as unknown[]) {
      if (prop(limit, "kind") === "session") h5 = newest(h5, resetMs(prop(limit, "resets_at")));
      if (prop(limit, "kind") === "weekly_all") wk = newest(wk, resetMs(prop(limit, "resets_at")));
    }
    return { h5, wk };
  }
  return {
    h5: resetMs(prop(prop(api, "five_hour"), "resets_at")),
    wk: resetMs(prop(prop(api, "seven_day"), "resets_at")),
  };
}

function codexResets(payload: unknown): ProviderResets {
  if (!isObjectLike(payload)) return emptyResets();
  const out = emptyResets();

  const reported = [payload.primary, payload.secondary].find(isObjectLike);
  if (reported) out.metered5h = Number(reported.window_minutes) === WINDOW_MINUTES.h5;
  const windows: [TaskWindow, unknown][] = [
    ["h5", payload.primary],
    ["wk", payload.secondary],
  ];
  for (const [id, value] of windows) {
    const window = isObjectLike(value) ? value : null;
    if (!window) continue;

    const bucket = Number(window.window_minutes) === WINDOW_MINUTES.wk ? "wk" : id;
    out[bucket] = newest(out[bucket], resetMs(window.resets_at));
  }
  return out;
}

const EPOCH_MS_FLOOR = 1e10;
const toEpochMs = (numeric: number): number =>
  numeric > EPOCH_MS_FLOOR ? numeric : numeric * MS_PER_SECOND;

export function resetMs(value: unknown): number | null {
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return toEpochMs(numeric);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return toEpochMs(value);
}

function newest(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return Math.max(a, b);
}
