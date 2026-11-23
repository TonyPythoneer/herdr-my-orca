import test from "node:test";
import assert from "node:assert/strict";
import {
  PING_PROMPT,
  TASKS_VERSION,
  WINDOW_MINUTES,
  defaultTasks,
  describeTrigger,
  formatClock,
  formatCountdown,
  isDue,
  nextDaily,
  nextRunAt,
  parseResets,
  parseTasks,
  recordRun,
  resetMs,
  runTask,
  serializeTasks,
  tail,
  windowLabel,
} from "./tasks.js";

const H = 60 * 60 * 1000;
const at = (iso) => Date.parse(`${iso}Z`);
const NOW = at("2026-11-23T05:00:00");

const resetTask = (over = {}) => ({
  id: "t",
  name: "T",
  enabled: true,
  trigger: { type: "reset", provider: "claude", window: "h5", delaySeconds: 5 },
  argv: ["claude", "-p", PING_PROMPT],
  ...over,
});

test("the seed has one Claude and one Codex reset ping at the cheapest settings", () => {
  const { tasks } = defaultTasks();
  assert.equal(tasks.length, 2);
  const [claude, codex] = tasks;
  assert.deepEqual(claude.argv, ["claude", "-p", "ping", "--model", "haiku", "--effort", "low"]);
  assert.equal(claude.trigger.provider, "claude");
  assert.equal(claude.trigger.window, "h5");
  assert.equal(claude.enabled, true);
  assert.deepEqual(codex.argv.slice(0, 6), ["codex", "exec", "--skip-git-repo-check", "-m", "gpt-5.6-luna", "-c"]);
  assert.equal(codex.argv.at(-1), "ping");
  assert.ok(codex.argv.includes("model_reasoning_effort=low"));
  assert.equal(codex.trigger.provider, "codex");
});

test("the seed takes the Codex model it is given and falls back to luna", () => {
  assert.equal(defaultTasks({ codexModel: "gpt-9-luna" }).tasks[1].argv[4], "gpt-9-luna");
  assert.equal(defaultTasks({ codexModel: "" }).tasks[1].argv[4], "gpt-5.6-luna");
});

test("blank or missing tasks.json is a fresh seed, not an error", () => {
  for (const text of [null, undefined, "", "  \n "]) {
    const parsed = parseTasks(text);
    assert.equal(parsed.error, null);
    assert.equal(parsed.seeded, true);
    assert.equal(parsed.config.version, TASKS_VERSION);
    assert.equal(parsed.config.tasks.length, 2);
  }
});

test("a damaged file keeps its error and gives no config to overwrite", () => {
  for (const [text, message] of [
    ["{", "not valid JSON"],
    ["[]", "must contain a JSON object"],
    ['{"version":1}', "needs a `tasks` list"],
  ]) {
    const parsed = parseTasks(text);
    assert.equal(parsed.config, null);
    assert.equal(parsed.seeded, false);
    assert.match(parsed.error, new RegExp(message.replace(/[`]/g, "`")));
  }
});

test("every task is checked: id, name, argv and a known trigger", () => {
  const base = defaultTasks().tasks[0];
  const bad = [
    [{ ...base, id: "" }, /needs an id/],
    [{ ...base, name: "" }, /needs a name/],
    [{ ...base, argv: [] }, /non-empty argv/],
    [{ ...base, argv: ["claude", 3] }, /non-empty argv/],
    [{ ...base, trigger: undefined }, /needs a trigger/],
    [{ ...base, trigger: { type: "cron" } }, /type "reset" or "daily"/],
    [{ ...base, trigger: { type: "reset", provider: "gemini", window: "h5" } }, /provider/],
    [{ ...base, trigger: { type: "reset", provider: "claude", window: "1d" } }, /window/],
    [{ ...base, trigger: { type: "daily", time: "9:00" } }, /HH:MM/],
    [{ ...base, trigger: { type: "daily", time: "25:00" } }, /HH:MM/],
  ];
  for (const [task, message] of bad) {
    const parsed = parseTasks(JSON.stringify({ version: 1, tasks: [task] }));
    assert.equal(parsed.config, null);
    assert.match(parsed.error, message);
  }
});

test("a valid file round-trips, unknown fields included", () => {
  const config = { version: 7, tasks: [resetTask({ note: "mine" })], extra: true };
  const parsed = parseTasks(serializeTasks(config));
  assert.equal(parsed.error, null);
  assert.equal(parsed.seeded, false);
  assert.deepEqual(parsed.config.tasks, config.tasks);
  assert.equal(parsed.config.version, 7);
});

test("a live window is pinged just after its own reset time", () => {
  const reset = NOW + 12 * 60_000;
  const next = nextRunAt(resetTask(), { now: NOW, resets: { claude: { h5: reset } } });
  assert.equal(next, reset + 5000);
});

test("an idle window (no reset reported, or one already past) is pinged now", () => {
  for (const resets of [undefined, { claude: { h5: null } }, { claude: { h5: NOW - H } }]) {
    assert.equal(nextRunAt(resetTask(), { now: NOW, resets }), NOW);
  }
});

test("a window this task started is not pinged again", () => {
  const task = resetTask({ last: { at: NOW - 2 * H, code: 0, note: "ok", fails: 0 } });
  assert.equal(nextRunAt(task, { now: NOW, resets: null }), NOW - 2 * H + WINDOW_MINUTES.h5 * 60_000);
  // the window it started is over: ping now
  const old = resetTask({ last: { at: NOW - 6 * H, code: 0, note: "ok", fails: 0 } });
  assert.equal(nextRunAt(old, { now: NOW, resets: null }), NOW);
});

test("a still-reported reset wins over the started-window guard", () => {
  const task = resetTask({ last: { at: NOW - 2 * H, code: 0, note: "ok", fails: 0 } });
  const reset = NOW + 60_000;
  assert.equal(nextRunAt(task, { now: NOW, resets: { claude: { h5: reset } } }), reset + 5000);
});

test("a failed run retries in two minutes, then every thirty", () => {
  for (const fails of [1, 2, 3]) {
    const task = resetTask({ last: { at: NOW - 60_000, code: 1, note: "limit", fails } });
    assert.equal(nextRunAt(task, { now: NOW, resets: null }), NOW - 60_000 + 2 * 60_000);
  }
  const task = resetTask({ last: { at: NOW - H, code: 1, note: "limit", fails: 4 } });
  assert.equal(nextRunAt(task, { now: NOW, resets: null }), NOW - H + 30 * 60_000);
});

test("a daily task runs at its local time, tomorrow after today's run", () => {
  const now = new Date(2026, 10, 23, 8, 30, 0, 0).getTime();
  const task = { id: "d", name: "D", trigger: { type: "daily", time: "09:00" }, argv: ["x"] };
  const first = nextRunAt(task, { now });
  assert.equal(first, new Date(2026, 10, 23, 9, 0, 0, 0).getTime());
  const done = { ...task, last: { at: first, code: 0, note: "", fails: 0 } };
  assert.equal(nextRunAt(done, { now: first + 1000 }), new Date(2026, 10, 24, 9, 0, 0, 0).getTime());
  assert.equal(nextDaily("09:00", first), new Date(2026, 10, 24, 9, 0, 0, 0).getTime());
  assert.equal(nextDaily("nope", now), null);
});

test("a daily time that passed while Herdr was closed is still owed today", () => {
  const task = { id: "d", name: "D", trigger: { type: "daily", time: "09:00" }, argv: ["x"] };
  const ten = new Date(2026, 10, 23, 10, 0, 0, 0).getTime();
  const nine = new Date(2026, 10, 23, 9, 0, 0, 0).getTime();
  // never ran: due now, and the page shows the owed time rather than tomorrow
  assert.equal(nextRunAt(task, { now: ten }), nine);
  assert.equal(isDue(task, { now: ten }), true);
  // ran earlier today: tomorrow
  assert.equal(nextRunAt({ ...task, last: { at: nine, code: 0, note: "", fails: 0 } }, { now: ten }), new Date(2026, 10, 24, 9, 0, 0, 0).getTime());
  assert.equal(isDue({ ...task, last: { at: nine, code: 0, note: "", fails: 0 } }, { now: ten }), false);
  // a failed run is still a run for the day
  assert.equal(isDue({ ...task, last: { at: nine, code: 1, note: "", fails: 1 } }, { now: ten }), false);
  assert.equal(nextRunAt({ ...task, trigger: { type: "once" } }, { now: ten }), null);
});

test("due is the next time at or before now", () => {
  const reset = NOW + 60_000;
  const ctx = { now: NOW, resets: { claude: { h5: reset } } };
  assert.equal(isDue(resetTask(), ctx), false);
  assert.equal(isDue(resetTask(), { ...ctx, now: reset + 5000 }), true);
});

test("describe, countdown and clock are what the page prints", () => {
  assert.equal(describeTrigger(resetTask()), "At Claude 5h reset");
  assert.equal(describeTrigger({ trigger: { type: "reset", provider: "codex", window: "wk" } }), "At Codex weekly reset");
  assert.equal(describeTrigger({ trigger: { type: "daily", time: "09:00" } }), "Every day at 09:00");
  assert.equal(formatCountdown(0), "now");
  assert.equal(formatCountdown(-5000), "now");
  assert.equal(formatCountdown(30_000), "in 30s");
  assert.equal(formatCountdown(12 * 60_000), "in 12m");
  assert.equal(formatCountdown(3.2 * H), "in 3h 12m");
  assert.equal(formatCountdown(5 * 24 * H + 3 * H), "in 5d 3h");
  assert.equal(formatClock(new Date(2026, 10, 23, 9, 5).getTime()), "09:05");
  assert.equal(windowLabel("h5"), "5h");
  assert.equal(windowLabel("wk"), "weekly");
});

test("tail keeps the last non-empty line, cut to size", () => {
  assert.equal(tail("\n\n  hello  \n\n"), "hello");
  assert.equal(tail("a\nb\n"), "b");
  assert.equal(tail(""), "");
  assert.equal(tail("x".repeat(400)).length, 300);
  assert.ok(tail("x".repeat(400)).endsWith("…"));
});

test("Claude resets come from the live feed, the snapshot, or whichever is newer", () => {
  const live = { five_hour: { resets_at: 1000 }, seven_day: { resets_at: 2000 } };
  const api = { five_hour: { resets_at: "1970-01-01T00:20:00Z" }, seven_day: { resets_at: "1970-01-01T00:10:00Z" } };
  const both = parseResets(JSON.stringify({ claude: { live, api } })).claude;
  assert.equal(both.h5, 1_200_000);
  assert.equal(both.wk, 2_000_000);
  assert.equal(both.metered5h, true);
  assert.deepEqual(parseResets(JSON.stringify({ claude: { live } })).claude, { h5: 1_000_000, wk: 2_000_000, metered5h: true });
  // the newer usage API shape: array of limits with kinds
  const limits = { limits: [{ kind: "session", resets_at: 3000 }, { kind: "weekly_all", resets_at: 4000 }, { kind: "weekly_fable", resets_at: 9999 }] };
  assert.deepEqual(parseResets(JSON.stringify({ claude: { api: limits } })).claude, { h5: 3_000_000, wk: 4_000_000, metered5h: true });
  assert.deepEqual(parseResets("nonsense").claude, { h5: null, wk: null, metered5h: null });
});

test("a plan without the 5h session is marked exempt, and an unknown one is not", () => {
  // a weekly-only report: the plan dropped the session limit
  const weeklyOnly = parseResets(JSON.stringify({ claude: { live: { seven_day: { resets_at: 2000 } } } })).claude;
  assert.deepEqual(weeklyOnly, { h5: null, wk: 2_000_000, metered5h: false });
  const weeklyApi = parseResets(JSON.stringify({ claude: { api: { limits: [{ kind: "weekly_all", resets_at: 4000 }] } } })).claude;
  assert.equal(weeklyApi.metered5h, false);
  // an API-key or bedrock session is not a plan at all: unknown, so nothing is greyed
  assert.equal(parseResets(JSON.stringify({ claude: { api: { api: true } } })).claude.metered5h, null);
  assert.equal(parseResets(JSON.stringify({ claude: null })).claude.metered5h, null);
});

test("a plan that meters only the week is exempt from the 5h ping but not a weekly one", () => {
  const weeklyAt = NOW + 7 * 24 * H;
  const resets = { claude: { h5: null, wk: weeklyAt, metered5h: false } };
  const h5 = resetTask();
  assert.equal(nextRunAt(h5, { now: NOW, resets }), null);
  assert.equal(isDue(h5, { now: NOW, resets }), false);
  const weekly = resetTask({ trigger: { type: "reset", provider: "claude", window: "wk", delaySeconds: 5 } });
  assert.equal(nextRunAt(weekly, { now: NOW, resets }), weeklyAt + 5000);
  // unknown stays scheduled
  assert.equal(nextRunAt(h5, { now: NOW, resets: { claude: { h5: null, wk: null, metered5h: null } } }), NOW);
});

test("Codex resets come from primary/secondary by their window length", () => {
  const codex = parseResets(JSON.stringify({ codex: { primary: { window_minutes: 300, resets_at: 1000 }, secondary: { window_minutes: 10080, resets_at: 2000 } } })).codex;
  assert.deepEqual(codex, { h5: 1_000_000, wk: 2_000_000, metered5h: true });
  // primary is the week: no 5h window on this plan
  const swapped = parseResets(JSON.stringify({ codex: { primary: { window_minutes: 10080, resets_at: 5000 }, secondary: null } })).codex;
  assert.deepEqual(swapped, { h5: null, wk: 5_000_000, metered5h: false });
  // a weekly-only secondary says the same
  const weeklyOnly = parseResets(JSON.stringify({ codex: { primary: null, secondary: { window_minutes: 10080, resets_at: 6000 } } })).codex;
  assert.equal(weeklyOnly.metered5h, false);
  assert.deepEqual(parseResets(JSON.stringify({ codex: null })).codex, { h5: null, wk: null, metered5h: null });
});

test("resetMs accepts epoch seconds, epoch milliseconds and ISO, and rejects junk", () => {
  assert.equal(resetMs(1795413000), 1_795_413_000_000);
  assert.equal(resetMs(1_795_413_000_000), 1_795_413_000_000);
  assert.equal(resetMs("1795413000"), 1_795_413_000_000);
  assert.equal(resetMs("2026-11-23T05:50:00Z"), at("2026-11-23T05:50:00"));
  for (const value of [null, undefined, "", "later", 0, -1, NaN]) assert.equal(resetMs(value), null);
});

test("a run reports its exit code and the line worth reading", async () => {
  const calls = [];
  const exec = async (cmd, args, options) => {
    calls.push([cmd, args, options]);
    return { code: 0, stdout: "hi\nping ok\n", stderr: "" };
  };
  const run = await runTask(exec, resetTask({ cwd: "/tmp" }), { timeout: 5000 });
  assert.equal(run.code, 0);
  assert.equal(run.note, "ping ok");
  assert.deepEqual(calls, [["claude", ["-p", "ping"], { cwd: "/tmp", timeout: 5000 }]]);

  const failing = await runTask(async () => ({ code: 1, stdout: "out", stderr: "ERROR: use limit\n" }), resetTask());
  assert.deepEqual([failing.code, failing.note], [1, "ERROR: use limit"]);

  const threw = await runTask(async () => {
    throw new Error("no such command");
  }, resetTask());
  assert.deepEqual([threw.code, threw.note], [-1, "no such command"]);

  const empty = await runTask(async () => assert.fail("must not run"), { argv: [] });
  assert.equal(empty.code, -1);
});

test("a run records failures, and a success clears them", () => {
  const task = resetTask();
  let last = recordRun(task, { at: 1, code: 1, note: "a" });
  assert.deepEqual(last, { at: 1, code: 1, note: "a", fails: 1 });
  last = recordRun({ ...task, last }, { at: 2, code: 1, note: "b" });
  assert.equal(last.fails, 2);
  last = recordRun({ ...task, last }, { at: 3, code: 0, note: "ok" });
  assert.deepEqual(last, { at: 3, code: 0, note: "ok", fails: 0 });
});
