import { RESET_SCRIPT, TASKS_FILE, defaultTasks, isDue, nextRunAt, parseResets, parseTasks, recordRun, runTask, serializeTasks } from "./tasks.js";
import { appHome, checking, exec, home, nextCommand, notify, readTextFile, setShared, shared, writeTextFile } from "herdr";

                                           
const FILE = `${appHome()}/${TASKS_FILE}`;
const SHELL = "sh";
const SCAN_COMMAND = "tasks-scan";
const NOT_STARTED_NOTE = "Could not start.";
const NOT_STARTED_CODE = -1;
const WARNING_LEVEL = "warning";
const TICK_MS = 1e4;
const PROBE_MS = 3e5;
const PROBE_TIMEOUT_MS = 2e4;
const REQUEST_FRESH_MS = 6e4;
const TASK_KEYS = {
	text: "tasks.text",
	config: "tasks.config",
	error: "tasks.error",
	state: "tasks.state",
	resets: "tasks.resets",
	request: "tasks.request"
};
function publish(key, value) {
	if (JSON.stringify(shared(key)) !== JSON.stringify(value)) setShared(key, value);
}
async function codexModel() {
	try {
		const models = JSON.parse(await readTextFile(`${appHome()}/agent-config.json`) ?? "{}")?.catalog?.codex?.models ?? [];
		const id = models[models.length - 1]?.id;
		if (typeof id === "string" && id) return id;
	} catch {}
	return null;
}
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
	publish(TASK_KEYS.text, text);
	publish(TASK_KEYS.config, config);
	publish(TASK_KEYS.error, error);
}
async function probeResets(state) {
	state.probedAt = Date.now();
	try {
		const { stdout } = await exec(SHELL, ["-c", RESET_SCRIPT], { timeout: PROBE_TIMEOUT_MS });
		state.resets = parseResets(stdout);
		publish(TASK_KEYS.resets, state.resets);
	} catch {}
}
function snapshot(state, now) {
	const out = {};
	for (const task of state.config?.tasks ?? []) {
		const last = state.runs.get(task.id) ?? null;
		out[task.id] = {
			last,
			running: state.running.has(task.id),
			nextAt: task.enabled !== false ? nextRunAt({
				...task,
				last
			}, {
				now,
				resets: state.resets
			}) : null
		};
	}
	return out;
}
function publishState(state, now = Date.now()) {
	publish(TASK_KEYS.state, snapshot(state, now));
}
async function fire(state, task) {
	state.running.add(task.id);
	publishState(state);
	const last = recordRun({ last: state.runs.get(task.id) ?? null }, await runTask(exec, task, { cwd: task.cwd || home() }));
	state.runs.set(task.id, last);
	state.running.delete(task.id);
	state.probedAt = 0;
	publishState(state);
	if (last.code !== 0) notify({
		title: `${task.name} failed`,
		body: last.code === NOT_STARTED_CODE ? last.note || NOT_STARTED_NOTE : `Exit ${last.code}${last.note ? ` · ${last.note}` : ""}`,
		level: WARNING_LEVEL
	});
}
async function serveRunRequest(state, now) {
	const request = shared(TASK_KEYS.request);
	if (!(request && typeof request.id === "string" && now - Number(request.at ?? 0) < REQUEST_FRESH_MS)) return;
	setShared(TASK_KEYS.request, null);
	const asked = state.config?.tasks?.find((task) => task.id === request.id);
	if (asked && !state.running.has(asked.id)) await fire(state, asked);
}
async function runDueTasks(state, now) {
	for (const task of state.config?.tasks ?? []) {
		const last = state.runs.get(task.id) ?? null;
		if (task.enabled !== false && !state.running.has(task.id) && isDue({
			...task,
			last
		}, {
			now,
			resets: state.resets
		})) await fire(state, task);
	}
}
async function runCycle(state) {
	await load(state);
	if (Date.now() - state.probedAt > PROBE_MS) await probeResets(state);
	publish(TASK_KEYS.error, state.error || "");
	const now = Date.now();
	await serveRunRequest(state, now);
	await runDueTasks(state, now);
	publishState(state);
}
function startTaskRunner(cx) {
	if (checking()) return;
	const state = {
		text: void 0,
		config: null,
		error: "",
		resets: {},
		probedAt: 0,
		busy: false,
		runs:                 new Map(),
		running:                 new Set()
	};
	const tick = (tickCx) => {
		if (state.busy) return;
		state.busy = true;
		tickCx.spawn(async () => {
			try {
				await runCycle(state);
			} catch (error) {
				publish(TASK_KEYS.error, String(error?.message ?? error));
			} finally {
				state.busy = false;
			}
		});
	};
	cx.timer.every(TICK_MS, (timerCx) => tick(timerCx));
	cx.spawn(async (jobCx) => {
		for (;;) if (await nextCommand() === SCAN_COMMAND) tick(jobCx);
	});
	tick(cx);
}

export { TASK_KEYS, startTaskRunner };
