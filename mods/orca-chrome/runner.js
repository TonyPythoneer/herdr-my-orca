// The scheduler. It sits in orca-chrome because that mod's footer copy is in the layout and
// always on screen: a stack page's copy only starts the first time it is shown, so a timer in
// the Tasks page would miss the reset after a fresh launch (AGENTS.md, "Mods").
//
// Nothing here draws. The timer reads one small file and compares numbers; it calls
// `setShared` only when something really changed, so a quiet minute does not redraw the window.
// The config file is written only to seed it; the last run of each task lives in `shared`,
// which Herdr persists, so the page edits the file and the runner never races it.
import { appHome, checking, exec, home, nextCommand, notify, readTextFile, setShared, shared, writeTextFile } from "herdr";
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
} from "./tasks.js";

const FILE = `${appHome()}/${TASKS_FILE}`;
const TICK_MS = 10_000;
const PROBE_MS = 5 * 60_000;
const PROBE_TIMEOUT_MS = 20_000;
// A "Run now" request older than this is stale (the page was closed or the runner was busy).
const REQUEST_FRESH_MS = 60_000;

const publish = (key, value) => {
  if (JSON.stringify(shared(key)) !== JSON.stringify(value)) setShared(key, value);
};

// The Codex catalog has no price; the small/fast tier is the luna family and it is last in
// the visible list (`codex debug models`). agent-config.json already caches that list.
async function codexModel() {
  try {
    const saved = JSON.parse((await readTextFile(`${appHome()}/agent-config.json`)) ?? "{}");
    const models = saved?.catalog?.codex?.models ?? [];
    const id = models[models.length - 1]?.id;
    if (typeof id === "string" && id) return id;
  } catch {
    // no cache yet: the seed's own fallback is fine
  }
  return null;
}

// Reads tasks.json into `state` and publishes it when it changed; a missing file is seeded.
async function load(state) {
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

function adopt(state, text, config, error) {
  state.text = text;
  state.config = config;
  state.error = error;
  publish("tasks.text", text);
  publish("tasks.config", config);
  publish("tasks.error", error);
}

async function probeResets(state) {
  state.probedAt = Date.now();
  try {
    const { stdout } = await exec("sh", ["-c", RESET_SCRIPT], { timeout: PROBE_TIMEOUT_MS });
    state.resets = parseResets(stdout);
    publish("tasks.resets", state.resets);
  } catch {
    // No shell, no jq, no sessions: keep the last reading and try again next time.
  }
}

// What the page shows for every task: its last run, whether it is running now, and when it is
// due next. `nextRunAt` is pure, so both sides agree on the number.
function snapshot(state, now) {
  const out = {};
  for (const task of state.config?.tasks ?? []) {
    const last = state.runs.get(task.id) ?? null;
    out[task.id] = {
      last,
      running: state.running.has(task.id),
      nextAt: task.enabled !== false ? nextRunAt({ ...task, last }, { now, resets: state.resets }) : null,
    };
  }
  return out;
}

const publishState = (state, now = Date.now()) => publish("tasks.state", snapshot(state, now));

async function fire(state, task) {
  state.running.add(task.id);
  publishState(state);
  const last = recordRun({ last: state.runs.get(task.id) ?? null }, await runTask(exec, task, { cwd: task.cwd || home() }));
  state.runs.set(task.id, last);
  state.running.delete(task.id);
  // The ping may have moved the window; read it again on the next tick.
  state.probedAt = 0;
  publishState(state);
  if (last.code !== 0) {
    notify({
      title: `${task.name} failed`,
      body: last.code === -1 ? last.note || "Could not start." : `Exit ${last.code}${last.note ? ` · ${last.note}` : ""}`,
      level: "warning",
    });
  }
}

// "Run now" from the page: a request rather than a direct run, so one place owns runs.
async function serveRunRequest(state, now) {
  const request = shared("tasks.request");
  const fresh = request && typeof request.id === "string" && now - Number(request.at ?? 0) < REQUEST_FRESH_MS;
  if (!fresh) return;
  setShared("tasks.request", null);
  const asked = state.config?.tasks?.find((task) => task.id === request.id);
  if (asked && !state.running.has(asked.id)) await fire(state, asked);
}

async function runDueTasks(state, now) {
  for (const task of state.config?.tasks ?? []) {
    const last = state.runs.get(task.id) ?? null;
    if (task.enabled !== false && !state.running.has(task.id) && isDue({ ...task, last }, { now, resets: state.resets })) {
      await fire(state, task);
    }
  }
}

async function runCycle(state) {
  await load(state);
  if (Date.now() - state.probedAt > PROBE_MS) await probeResets(state);
  publish("tasks.error", state.error || "");
  const now = Date.now();
  await serveRunRequest(state, now);
  await runDueTasks(state, now);
  publishState(state);
}

export function startTaskRunner(cx) {
  if (checking()) return;

  const state = {
    text: undefined, // tasks.json as last read or seeded; undefined = not read yet
    config: null,
    error: "",
    resets: {},
    probedAt: 0,
    busy: false,
    runs: new Map(), // id -> the task's last run ({at, code, note, fails}) or null
    running: new Set(),
  };

  const tick = (tickCx) => {
    if (state.busy) return;
    state.busy = true;
    tickCx.spawn(async () => {
      try {
        await runCycle(state);
      } catch (error) {
        publish("tasks.error", String(error?.message ?? error));
      } finally {
        state.busy = false;
      }
    });
  };

  cx.timer.every(TICK_MS, (timerCx) => tick(timerCx));
  // A page edit nudges the runner instead of waiting for the next tick. The tick still covers a
  // hidden sidebar, where a mod command does not reach this copy.
  cx.spawn(async (jobCx) => {
    for (;;) {
      if ((await nextCommand()) === "tasks-scan") tick(jobCx);
    }
  });
  tick(cx);
}
