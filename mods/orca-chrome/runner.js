// The scheduler. It sits in orca-chrome because that mod's footer copy is in both layouts and
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

  const publish = (key, value) => {
    if (JSON.stringify(shared(key)) !== JSON.stringify(value)) setShared(key, value);
  };

  const load = async () => {
    const text = await readTextFile(FILE);
    if (text === null) {
      const seed = defaultTasks({ codexModel: await codexModel() });
      const seeded = serializeTasks(seed);
      await writeTextFile(FILE, seeded, null);
      state.text = seeded;
      state.config = seed;
      state.error = "";
      publish("tasks.text", seeded);
      publish("tasks.config", seed);
      publish("tasks.error", "");
      return;
    }
    if (text === state.text) return;
    const parsed = parseTasks(text);
    state.text = text;
    state.config = parsed.config;
    state.error = parsed.error ?? "";
    publish("tasks.text", text);
    publish("tasks.config", parsed.config);
    publish("tasks.error", state.error);
  };

  // The Codex catalog has no price; the small/fast tier is the luna family and it is last in
  // the visible list (`codex debug models`). agent-config.json already caches that list.
  const codexModel = async () => {
    try {
      const saved = JSON.parse((await readTextFile(`${appHome()}/agent-config.json`)) ?? "{}");
      const models = saved?.catalog?.codex?.models ?? [];
      const id = models[models.length - 1]?.id;
      if (typeof id === "string" && id) return id;
    } catch {
      // no cache yet: the seed's own fallback is fine
    }
    return null;
  };

  const probeResets = async () => {
    state.probedAt = Date.now();
    try {
      const { stdout } = await exec("sh", ["-c", RESET_SCRIPT], { timeout: 20000 });
      state.resets = parseResets(stdout);
      publish("tasks.resets", state.resets);
    } catch {
      // No shell, no jq, no sessions: keep the last reading and try again next time.
    }
  };

  // What the page shows for every task: its last run, whether it is running now, and when it is
  // due next. `nextRunAt` is pure, so both sides agree on the number.
  const snapshot = (now) => {
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
  };

  const publishState = (now = Date.now()) => publish("tasks.state", snapshot(now));

  const fire = async (task) => {
    state.running.add(task.id);
    publishState();
    const last = recordRun({ last: state.runs.get(task.id) ?? null }, await runTask(exec, task, { cwd: task.cwd || home() }));
    state.runs.set(task.id, last);
    state.running.delete(task.id);
    // The ping may have moved the window; read it again on the next tick.
    state.probedAt = 0;
    publishState();
    if (last.code !== 0) {
      notify({
        title: `${task.name} failed`,
        body: last.code === -1 ? last.note || "Could not start." : `Exit ${last.code}${last.note ? ` · ${last.note}` : ""}`,
        level: "warning",
      });
    }
  };

  const tick = (cx) => {
    if (state.busy) return;
    state.busy = true;
    cx.spawn(async () => {
      try {
        await load();
        if (Date.now() - state.probedAt > PROBE_MS) await probeResets();
        if (state.error) publish("tasks.error", state.error);
        else publish("tasks.error", "");
        const now = Date.now();
        // "Run now" from the page: a request rather than a direct run, so one place owns runs.
        const request = shared("tasks.request");
        if (request && typeof request.id === "string" && now - Number(request.at ?? 0) < 60_000) {
          setShared("tasks.request", null);
          const asked = state.config?.tasks?.find((task) => task.id === request.id);
          if (asked && !state.running.has(asked.id)) await fire(asked);
        }
        for (const task of state.config?.tasks ?? []) {
          const last = state.runs.get(task.id) ?? null;
          if (task.enabled !== false && !state.running.has(task.id) && isDue({ ...task, last }, { now, resets: state.resets })) {
            await fire(task);
          }
        }
        publishState();
      } catch (error) {
        publish("tasks.error", String(error?.message ?? error));
      } finally {
        state.busy = false;
      }
    });
  };

  cx.timer.every(TICK_MS, (cx) => tick(cx));
  // A page edit nudges the runner instead of waiting for the next tick. The tick still covers a
  // hidden sidebar, where a mod command does not reach this copy.
  cx.spawn(async (cx) => {
    for (;;) {
      if ((await nextCommand()) === "tasks-scan") tick(cx);
    }
  });
  tick(cx);
}
