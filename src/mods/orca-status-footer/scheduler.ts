import type { AsyncContext } from "gpui-kit";
import {
  appHome,
  checking,
  exec,
  home,
  nextCommand,
  notify,
  readTextFile,
  setShared,
  shared,
  writeTextFile,
} from "herdr";
import {
  RESET_SCRIPT,
  TASKS_FILE,
  defaultTasks,
  isDue,
  nextRunAt,
  parseResets,
  parseTasks,
  recordRun,
  runTask,
  serializeTasks,
  type ResetSnapshot,
  type Task,
  type TaskConfig,
} from "../../shared/tasks.js";

const FILE = `${appHome()}/${TASKS_FILE}`;
const SHELL = "sh";
const SCAN_COMMAND = "tasks-scan";
const NOT_STARTED_NOTE = "Could not start.";
const NOT_STARTED_CODE = -1;
const WARNING_LEVEL = "warning";
const TICK_MS = 10_000;
const PROBE_MS = 5 * 60_000;
const PROBE_TIMEOUT_MS = 20_000;
const REQUEST_FRESH_MS = 60_000;

export const TASK_KEYS = {
  text: "tasks.text",
  config: "tasks.config",
  error: "tasks.error",
  state: "tasks.state",
  resets: "tasks.resets",
  request: "tasks.request",
} as const;

type RunRecord = ReturnType<typeof recordRun>;
type TaskSnapshot = { last: RunRecord | null; running: boolean; nextAt: number | null };
type RunnerState = {
  text: string | undefined;
  config: TaskConfig | null;
  error: string;
  resets: Partial<ResetSnapshot>;
  probedAt: number;
  busy: boolean;
  runs: Map<string, RunRecord>;
  running: Set<string>;
};
type AgentConfigFile = {
  catalog?: { codex?: { models?: ArrayLike<{ id?: unknown }> | null } | null } | null;
} | null;
type RunRequest = { id?: unknown; at?: unknown } | null | undefined;
type Thrown = { message?: unknown } | null | undefined;

function publish(key: string, value: unknown): void {
  if (JSON.stringify(shared(key)) !== JSON.stringify(value)) setShared(key, value);
}

async function codexModel(): Promise<string | null> {
  try {
    const saved = JSON.parse(
      (await readTextFile(`${appHome()}/agent-config.json`)) ?? "{}",
    ) as AgentConfigFile;
    const models = saved?.catalog?.codex?.models ?? [];
    const id = models[models.length - 1]?.id;
    if (typeof id === "string" && id) return id;
  } catch {}
  return null;
}

async function load(state: RunnerState): Promise<void> {
  const text = await readTextFile(FILE);
  if (text === null) {
    const seed = defaultTasks({ codexModel: await codexModel() });
    const seeded = serializeTasks(seed);
    await writeTextFile(FILE, seeded, null);
    adopt(state, seeded, seed, "");
    return;
  }
  if (text === state.text) return;
  const parsed = parseTasks(text);
  adopt(state, text, parsed.config, parsed.error ?? "");
}

function adopt(state: RunnerState, text: string, config: TaskConfig | null, error: string): void {
  state.text = text;
  state.config = config;
  state.error = error;
  publish(TASK_KEYS.text, text);
  publish(TASK_KEYS.config, config);
  publish(TASK_KEYS.error, error);
}

async function probeResets(state: RunnerState): Promise<void> {
  state.probedAt = Date.now();
  try {
    const { stdout } = await exec(SHELL, ["-c", RESET_SCRIPT], { timeout: PROBE_TIMEOUT_MS });
    state.resets = parseResets(stdout);
    publish(TASK_KEYS.resets, state.resets);
  } catch {}
}

function snapshot(state: RunnerState, now: number): Record<string, TaskSnapshot> {
  const out: Record<string, TaskSnapshot> = {};
  for (const task of state.config?.tasks ?? []) {
    const last = state.runs.get(task.id) ?? null;
    out[task.id] = {
      last,
      running: state.running.has(task.id),
      nextAt:
        task.enabled !== false ? nextRunAt({ ...task, last }, { now, resets: state.resets }) : null,
    };
  }
  return out;
}

function publishState(state: RunnerState, now = Date.now()): void {
  publish(TASK_KEYS.state, snapshot(state, now));
}

async function fire(state: RunnerState, task: Task): Promise<void> {
  state.running.add(task.id);
  publishState(state);
  const last = recordRun(
    { last: state.runs.get(task.id) ?? null },
    await runTask(exec, task, { cwd: (task.cwd || home()) as string }),
  );
  state.runs.set(task.id, last);
  state.running.delete(task.id);

  state.probedAt = 0;
  publishState(state);
  if (last.code !== 0) {
    notify({
      title: `${task.name} failed`,
      body:
        last.code === NOT_STARTED_CODE
          ? last.note || NOT_STARTED_NOTE
          : `Exit ${last.code}${last.note ? ` · ${last.note}` : ""}`,
      level: WARNING_LEVEL,
    });
  }
}

async function serveRunRequest(state: RunnerState, now: number): Promise<void> {
  const request = shared(TASK_KEYS.request) as RunRequest;
  const fresh =
    request && typeof request.id === "string" && now - Number(request.at ?? 0) < REQUEST_FRESH_MS;
  if (!fresh) return;
  setShared(TASK_KEYS.request, null);
  const asked = state.config?.tasks?.find((task) => task.id === request.id);
  if (asked && !state.running.has(asked.id)) await fire(state, asked);
}

async function runDueTasks(state: RunnerState, now: number): Promise<void> {
  for (const task of state.config?.tasks ?? []) {
    const last = state.runs.get(task.id) ?? null;
    if (
      task.enabled !== false &&
      !state.running.has(task.id) &&
      isDue({ ...task, last }, { now, resets: state.resets })
    ) {
      await fire(state, task);
    }
  }
}

async function runCycle(state: RunnerState): Promise<void> {
  await load(state);
  if (Date.now() - state.probedAt > PROBE_MS) await probeResets(state);
  publish(TASK_KEYS.error, state.error || "");
  const now = Date.now();
  await serveRunRequest(state, now);
  await runDueTasks(state, now);
  publishState(state);
}

export function startTaskRunner(cx: AsyncContext): void {
  if (checking()) return;

  const state: RunnerState = {
    text: undefined,
    config: null,
    error: "",
    resets: {},
    probedAt: 0,
    busy: false,
    runs: new Map(),
    running: new Set(),
  };

  const tick = (tickCx: AsyncContext): void => {
    if (state.busy) return;
    state.busy = true;
    tickCx.spawn(async () => {
      try {
        await runCycle(state);
      } catch (error: unknown) {
        publish(TASK_KEYS.error, String((error as Thrown)?.message ?? error));
      } finally {
        state.busy = false;
      }
    });
  };

  cx.timer.every(TICK_MS, (timerCx) => tick(timerCx));

  cx.spawn(async (jobCx) => {
    for (;;) {
      if ((await nextCommand()) === SCAN_COMMAND) tick(jobCx);
    }
  });
  tick(cx);
}
