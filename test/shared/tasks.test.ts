import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  TASK_TIMEOUT_MS,
  WINDOW_MINUTES,
  describeTrigger,
  formatClock,
  formatCountdown,
  isDue,
  nextDaily,
  nextRunAt,
  parseResets,
  parseTasks,
  providerLabel,
  recordRun,
  resetMs,
  runTask,
  serializeTasks,
  tail,
  windowLabel,
  windowMinutes,
} from "../../src/shared/tasks";

const MIN = 60_000;
const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime();
const at = (hour, minute, dayOffset = 0) =>
  new Date(2026, 5, 15 + dayOffset, hour, minute, 0).getTime();
const good = {
  id: "t",
  name: "T",
  argv: ["x"],
  trigger: { type: "reset", provider: "claude", window: "h5" },
};
const problem = (...tasks) => parseTasks(JSON.stringify({ tasks })).error;

test("parseTasks: missing text seeds the defaults, damaged text is an error with no config", () => {
  for (const text of [undefined, null, "", "  \n"]) {
    const parsed = parseTasks(text);
    assert.equal(parsed.seeded, true);
    assert.equal(parsed.config.tasks.length, 2);
  }
  assert.deepEqual(parseTasks("{"), {
    config: null,
    error: "tasks.json is not valid JSON.",
    seeded: false,
  });
  for (const text of ["[]", "null", "5", '"s"'])
    assert.equal(parseTasks(text).error, "tasks.json must contain a JSON object.");
  assert.equal(parseTasks("{}").error, "tasks.json needs a `tasks` list.");
  assert.equal(parseTasks('{"tasks":{}}').error, "tasks.json needs a `tasks` list.");
});

test("parseTasks: every task problem has its own message, numbered from 1", () => {
  assert.equal(problem(null), "Task 1 must be an object.");
  assert.equal(problem("x"), "Task 1 must be an object.");
  assert.equal(problem({ ...good, id: "" }), "Task 1 needs an id.");
  assert.equal(problem({ ...good, id: 5 }), "Task 1 needs an id.");
  assert.equal(problem({ ...good, name: "" }), "Task 1 needs a name.");
  for (const argv of [undefined, "x", [], [1], ["a", 2]]) {
    assert.equal(problem({ ...good, argv }), "Task 1 needs a non-empty argv list of strings.");
  }
  assert.equal(problem({ ...good, trigger: undefined }), "Task 1 needs a trigger.");
  assert.equal(problem({ ...good, trigger: "daily" }), "Task 1 needs a trigger.");
  assert.equal(
    problem({ ...good, trigger: { type: "weekly" } }),
    'Task 1 needs trigger.type "reset" or "daily".',
  );
  assert.equal(problem({ ...good, trigger: {} }), 'Task 1 needs trigger.type "reset" or "daily".');
  for (const time of [undefined, "9:00", "24:00", "12:60", "ab:cd"]) {
    assert.equal(
      problem({ ...good, trigger: { type: "daily", time } }),
      "Task 1 needs a trigger time as HH:MM.",
    );
  }
  assert.equal(
    problem({ ...good, trigger: { type: "reset", provider: "gemini", window: "h5" } }),
    'Task 1 needs trigger.provider "claude" or "codex".',
  );
  assert.equal(
    problem({ ...good, trigger: { type: "reset", provider: "codex", window: "d1" } }),
    'Task 1 needs trigger.window "h5" or "wk".',
  );
  assert.equal(problem(good, { ...good, name: "" }), "Task 2 needs a name.");
});

test("parseTasks: valid tasks are kept, enabled defaults to on, version defaults to 1", () => {
  const daily = { ...good, id: "d", trigger: { type: "daily", time: "09:30" } };
  const parsed = parseTasks(
    JSON.stringify({ tasks: [good, { ...daily, enabled: false }], extra: 1 }),
  );
  assert.equal(parsed.error, null);
  assert.equal(parsed.seeded, false);
  assert.deepEqual(
    parsed.config.tasks.map((task) => task.enabled),
    [true, false],
  );
  assert.equal(parsed.config.version, 1);
  assert.equal(parsed.config.extra, 1);
  assert.equal(parseTasks(JSON.stringify({ version: 7, tasks: [] })).config.version, 7);
});

test("serializeTasks writes the stable config shape and defaults missing values", () => {
  assert.deepEqual(JSON.parse(serializeTasks(null)), { version: 1, tasks: [] });
  const config = { version: 7, tasks: [good], extra: true };
  assert.deepEqual(JSON.parse(serializeTasks(config)), { version: 7, tasks: [good] });
});

const reset = (extra = {}, last) => ({
  ...good,
  trigger: { type: "reset", provider: "claude", window: "h5", ...extra },
  ...(last ? { last } : {}),
});
const daily = (time, last) => ({
  ...good,
  trigger: { type: "daily", time },
  ...(last ? { last } : {}),
});

test("nextRunAt: a task with no known trigger never runs", () => {
  assert.equal(nextRunAt(undefined, { now: NOW }), null);
  assert.equal(nextRunAt({}, { now: NOW }), null);
  assert.equal(nextRunAt({ trigger: { type: "weekly" } }, { now: NOW }), null);
});

test("nextRunAt: a daily task owes a time that passed, then moves to tomorrow", () => {
  assert.equal(
    nextRunAt(daily("09:00"), { now: NOW }),
    at(9, 0),
    "passed today and never run: due at 09:00",
  );
  assert.equal(
    nextRunAt(daily("09:00", { at: at(9, 1) }), { now: NOW }),
    at(9, 0, 1),
    "already run since 09:00",
  );
  assert.equal(
    nextRunAt(daily("09:00", { at: at(9, 0) }), { now: NOW }),
    at(9, 0, 1),
    "a run exactly at 09:00 is not owed again",
  );
  assert.equal(
    nextRunAt(daily("09:00", { at: at(8, 0) }), { now: NOW }),
    at(9, 0),
    "a run before 09:00 still owes it",
  );
  assert.equal(
    nextRunAt(daily("09:00", { at: "x" }), { now: NOW }),
    at(9, 0),
    "a non-numeric last.at counts as never",
  );
  assert.equal(nextRunAt(daily("15:00"), { now: NOW }), at(15, 0), "later today");
  assert.equal(nextRunAt(daily("12:00"), { now: NOW }), at(12, 0), "exactly now is owed");
  assert.equal(nextRunAt(daily("nope"), { now: NOW }), null);
  assert.equal(nextRunAt(daily(undefined), { now: NOW }), null);
});

test("nextRunAt: a failed reset task retries in two minutes, then every thirty after four failures", () => {
  const failed = (extra) => reset({}, { at: NOW - 1000, code: 1, ...extra });
  assert.equal(
    nextRunAt(failed({}), { now: NOW }),
    NOW - 1000 + 2 * MIN,
    "fails absent counts as one",
  );
  assert.equal(nextRunAt(failed({ fails: 3 }), { now: NOW }), NOW - 1000 + 2 * MIN);
  assert.equal(nextRunAt(failed({ fails: 4 }), { now: NOW }), NOW - 1000 + 30 * MIN);
  assert.equal(
    nextRunAt(failed({ fails: "many" }), { now: NOW }),
    NOW - 1000 + 30 * MIN,
    "an unreadable count is treated as many",
  );
  assert.equal(
    nextRunAt(reset({}, { code: 1 }), { now: NOW }),
    NOW,
    "a failure without a time is ignored",
  );
  assert.equal(
    nextRunAt(reset({}, { at: "bad", code: 1, fails: 4 }), { now: NOW }),
    NOW,
    "a malformed prior time does not create a retry window",
  );
  assert.equal(
    nextRunAt({ ...reset(), last: "oops" }, { now: NOW }),
    NOW,
    "a last that is not an object is ignored",
  );
});

test("nextRunAt: a reset task runs at the reported reset plus its delay, or now when idle", () => {
  const resets = (value) => ({ claude: value });
  assert.equal(
    nextRunAt(reset(), { now: NOW, resets: resets({ h5: NOW + 10_000 }) }),
    NOW + 10_000 + 5000,
    "default delay is five seconds",
  );
  assert.equal(
    nextRunAt(reset({ delaySeconds: 0 }), { now: NOW, resets: resets({ h5: NOW + 10_000 }) }),
    NOW + 10_000,
  );
  assert.equal(
    nextRunAt(reset({ delaySeconds: -9 }), { now: NOW, resets: resets({ h5: NOW + 10_000 }) }),
    NOW + 10_000,
    "a negative delay is zero",
  );
  assert.equal(
    nextRunAt(reset({ delaySeconds: 30 }), { now: NOW, resets: resets({ h5: NOW + 10_000 }) }),
    NOW + 40_000,
  );
  assert.equal(
    nextRunAt(reset({ window: "wk" }), {
      now: NOW,
      resets: resets({ wk: NOW + 1000, h5: NOW + 99 }),
    }),
    NOW + 6000,
  );
  assert.equal(
    nextRunAt(reset(), { now: NOW, resets: resets({ h5: NOW - 1 }) }),
    NOW,
    "a reset already past means idle",
  );
  assert.equal(
    nextRunAt(reset(), { now: NOW, resets: resets({ h5: NOW }) }),
    NOW,
    "a reset exactly now means idle",
  );
  assert.equal(nextRunAt(reset(), { now: NOW }), NOW, "no report means idle");
  assert.equal(
    nextRunAt(reset(), { now: NOW, resets: resets({ h5: "soon" }) }),
    NOW,
    "a non-numeric report is ignored",
  );
});

test("nextRunAt: an unmetered 5h window has nothing to run; the week is unaffected", () => {
  const resets = { claude: { metered5h: false, h5: NOW + 1000, wk: NOW + 2000 } };
  assert.equal(nextRunAt(reset(), { now: NOW, resets }), null);
  assert.equal(nextRunAt(reset({ window: "wk" }), { now: NOW, resets }), NOW + 7000);
  assert.equal(
    nextRunAt(reset(), { now: NOW, resets: { claude: { metered5h: null, h5: NOW + 1000 } } }),
    NOW + 6000,
  );
  assert.equal(
    nextRunAt(reset({ provider: "codex" }), { now: NOW, resets }),
    NOW,
    "another provider's flag does not apply",
  );
});

test("nextRunAt: a successful run holds the task inside the window it started", () => {
  const ran = (minutesAgo, trigger = {}) => reset(trigger, { at: NOW - minutesAgo * MIN, code: 0 });
  assert.equal(nextRunAt(ran(10), { now: NOW }), NOW - 10 * MIN + 300 * MIN, "5h window");
  assert.equal(
    nextRunAt(ran(10, { window: "wk" }), { now: NOW }),
    NOW - 10 * MIN + 10080 * MIN,
    "weekly window",
  );
  assert.equal(nextRunAt(ran(400), { now: NOW }), NOW, "the window has ended: idle, so now");
  assert.equal(
    nextRunAt(ran(10), { now: NOW, resets: { claude: { h5: NOW + MIN } } }),
    NOW + MIN + 5000,
    "a live reset wins over the estimate",
  );
});

test("isDue compares nextRunAt with now", () => {
  assert.equal(isDue(reset(), { now: NOW }), true);
  assert.equal(isDue(reset(), { now: NOW, resets: { claude: { h5: NOW + MIN } } }), false);
  assert.equal(isDue({}, { now: NOW }), false);
});

test("nextDaily and the small formatters", () => {
  assert.equal(nextDaily("09:00", NOW), at(9, 0, 1));
  assert.equal(nextDaily("13:00", NOW), at(13, 0));
  assert.equal(nextDaily("bad", NOW), null);
  assert.deepEqual(recordRun({ last: { fails: 2 } }, { at: 5, code: 1 }), {
    at: 5,
    code: 1,
    note: "",
    fails: 3,
  });
  assert.deepEqual(recordRun({ last: { fails: 2 } }, { at: 5, code: 0, note: "ok" }), {
    at: 5,
    code: 0,
    note: "ok",
    fails: 0,
  });
  assert.equal(describeTrigger(daily("09:00")), "Every day at 09:00");
  assert.equal(
    describeTrigger(reset({ provider: "codex", window: "wk" })),
    "At Codex weekly reset",
  );
  assert.equal(describeTrigger({}), "No trigger");
  assert.equal(formatClock(at(9, 5)), "09:05");
  assert.deepEqual(
    [windowMinutes("h5"), windowMinutes("wk"), windowMinutes("zz")],
    [300, 10080, 300],
  );
  assert.deepEqual(
    [windowLabel("h5"), windowLabel("zz"), windowLabel(undefined)],
    ["5h", "zz", ""],
  );
});

test("formatCountdown steps through seconds, minutes, hours and days", () => {
  const cases = [
    [NaN, "now"],
    [0, "now"],
    [-5, "now"],
    [499, "now"],
    [500, "in 1s"],
    [59_000, "in 59s"],
    [60_000, "in 1m"],
    [3_599_000, "in 59m"],
    [3_600_000, "in 1h 0m"],
    [11_520_000, "in 3h 12m"],
    [86_400_000, "in 1d 0h"],
    [517_200_000, "in 5d 23h"],
  ];
  for (const [ms, want] of cases) assert.equal(formatCountdown(ms), want, String(ms));
});

test("tail keeps the last non-empty line, clipped to max with an ellipsis", () => {
  assert.equal(tail("a\n\n  b  \n\n"), "b");
  assert.equal(tail(undefined), "");
  assert.equal(tail("x".repeat(10), 5), "xxxx…");
  assert.equal(tail("x".repeat(5), 5), "xxxxx");
  assert.equal(tail("y".repeat(400)).length, 300);
});

test("resetMs reads epoch seconds, milliseconds, numeric strings and ISO dates", () => {
  assert.equal(resetMs(1_700_000_000), 1_700_000_000_000);
  assert.equal(resetMs(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(resetMs("1700000000"), 1_700_000_000_000);
  assert.equal(resetMs("1700000000000"), 1_700_000_000_000);
  assert.equal(resetMs("2026-01-02T03:04:05Z"), Date.UTC(2026, 0, 2, 3, 4, 5));
  for (const bad of ["", "  ", "soon", 0, -1, NaN, Infinity, null, undefined, {}])
    assert.equal(resetMs(bad), null, String(bad));
});

test("runTask: an empty argv is reported without running anything", async () => {
  vi.spyOn(Date, "now").mockReturnValue(42);
  let called = false;
  const exec = async () => {
    called = true;
  };
  for (const task of [undefined, {}, { argv: [] }, { argv: [1, null] }]) {
    assert.deepEqual(await runTask(exec, task), {
      at: 42,
      code: -1,
      note: "This task has no argv.",
    });
  }
  assert.equal(called, false);
  vi.restoreAllMocks();
});

test("runTask: argv, cwd and timeout reach exec; the note follows the exit code", async () => {
  vi.spyOn(Date, "now").mockReturnValue(7);
  const calls = [];
  const answer =
    (result) =>
    async (...args) => {
      calls.push(args);
      return result;
    };
  const task = { argv: ["tool", "-a", 5, "b"], cwd: "/task" };
  assert.deepEqual(await runTask(answer({ code: 0, stdout: "out\nlast", stderr: "err" }), task), {
    at: 7,
    code: 0,
    note: "last",
  });
  assert.deepEqual(calls[0], ["tool", ["-a", "b"], { cwd: "/task", timeout: TASK_TIMEOUT_MS }]);
  await runTask(answer({ code: 0 }), { argv: ["t"] }, { cwd: "/opt", timeout: 9 });
  assert.deepEqual(calls[1], ["t", [], { cwd: "/opt", timeout: 9 }], "options beat the task");
  await runTask(answer({ code: 0 }), { argv: ["t"] });
  assert.deepEqual(calls[2], ["t", [], { timeout: TASK_TIMEOUT_MS }], "no cwd anywhere sends none");
  await runTask(answer({ code: 0 }), { argv: ["t"], cwd: 7 });
  assert.deepEqual(
    calls[3],
    ["t", [], { cwd: 7, timeout: TASK_TIMEOUT_MS }],
    "a truthy non-string cwd is passed on as legacy did",
  );
  await runTask(answer({ code: 0 }), { argv: ["t"], cwd: "/task" }, { cwd: null });
  assert.deepEqual(
    calls[4],
    ["t", [], { cwd: "/task", timeout: TASK_TIMEOUT_MS }],
    "a null option cwd falls back to the task",
  );
  assert.deepEqual(
    await runTask(answer({ code: 0, stdout: "", stderr: "warn" }), task),
    { at: 7, code: 0, note: "warn" },
    "success falls back to stderr",
  );
  assert.deepEqual(
    await runTask(answer({ code: 2, stdout: "so", stderr: "se" }), task),
    { at: 7, code: 2, note: "se" },
    "failure prefers stderr",
  );
  assert.deepEqual(await runTask(answer({ code: 2, stdout: "so", stderr: "" }), task), {
    at: 7,
    code: 2,
    note: "so",
  });
  assert.deepEqual(
    await runTask(answer({ stdout: "fine" }), task),
    { at: 7, code: 0, note: "fine" },
    "no code means success",
  );
  assert.deepEqual(await runTask(answer(undefined), task), { at: 7, code: 0, note: "" });
  vi.restoreAllMocks();
});

test("runTask never throws: an exec failure comes back as code -1 with its message", async () => {
  vi.spyOn(Date, "now").mockReturnValue(7);
  const task = { argv: ["tool"] };
  assert.deepEqual(
    await runTask(async () => {
      throw new Error("spawn tool ENOENT");
    }, task),
    { at: 7, code: -1, note: "spawn tool ENOENT" },
  );
  assert.deepEqual(
    await runTask(async () => {
      throw "plain";
    }, task),
    { at: 7, code: -1, note: "plain" },
  );
  assert.deepEqual(
    await runTask(async () => {
      throw null;
    }, task),
    { at: 7, code: -1, note: "null" },
  );
  vi.restoreAllMocks();
});

const EMPTY = { h5: null, wk: null, metered5h: null };
const claude = (payload) => parseResets(JSON.stringify({ claude: payload })).claude;
const codex = (payload) => parseResets(JSON.stringify({ codex: payload })).codex;

test("parseResets: unreadable input is all unknown", () => {
  for (const text of [undefined, "", "nope", "null", "[]"])
    assert.deepEqual(parseResets(text), { claude: EMPTY, codex: EMPTY });
  assert.deepEqual(claude(null), EMPTY);
  assert.deepEqual(claude("x"), EMPTY);
});

test("parseResets: Claude's live feed, with or without the rate_limits wrapper", () => {
  const windows = {
    five_hour: { resets_at: 1_700_000_000 },
    seven_day: { resets_at: "2026-01-02T00:00:00Z" },
  };
  const want = { h5: 1_700_000_000_000, wk: Date.UTC(2026, 0, 2), metered5h: true };
  assert.deepEqual(claude({ live: { rate_limits: windows } }), want);
  assert.deepEqual(claude({ live: windows }), want);
  assert.deepEqual(claude({ live: { seven_day: { resets_at: 5 } } }), {
    h5: null,
    wk: 5000,
    metered5h: false,
  });
  assert.deepEqual(claude({ live: { rate_limits: {} } }), { ...EMPTY, metered5h: false });
  assert.deepEqual(claude({}), EMPTY);
});

test("parseResets: Claude's OAuth snapshot, as limits or as named windows, and the newest wins", () => {
  const limits = {
    limits: [
      { kind: "session", resets_at: 100 },
      { kind: "weekly_all", resets_at: 200 },
      { kind: "session", resets_at: 300 },
      null,
      { kind: "other", resets_at: 9 },
    ],
  };
  assert.deepEqual(claude({ api: limits }), { h5: 300_000, wk: 200_000, metered5h: true });
  assert.deepEqual(claude({ api: { limits: [{ kind: "weekly_all", resets_at: 200 }] } }), {
    h5: null,
    wk: 200_000,
    metered5h: false,
  });
  assert.deepEqual(claude({ api: { limits: [] } }), { ...EMPTY, metered5h: false });
  assert.deepEqual(
    claude({ api: { five_hour: { resets_at: 10 }, seven_day: { resets_at: 20 } } }),
    { h5: 10_000, wk: 20_000, metered5h: true },
  );
  assert.deepEqual(claude({ api: { seven_day: { resets_at: 20 } } }), {
    h5: null,
    wk: 20_000,
    metered5h: false,
  });
  assert.deepEqual(claude({ api: "x" }), EMPTY);
  const live = { five_hour: { resets_at: 50 }, seven_day: { resets_at: 500 } };
  assert.deepEqual(claude({ live, api: limits }), { h5: 300_000, wk: 500_000, metered5h: true });
  assert.deepEqual(claude({ live: { five_hour: { resets_at: 900 } }, api: limits }), {
    h5: 900_000,
    wk: 200_000,
    metered5h: true,
  });
});

test("parseResets: an API-key or bedrock session is not a plan, so the 5h window is unknown", () => {
  const live = { five_hour: { resets_at: 50 } };
  assert.equal(claude({ live, api: { api: true } }).metered5h, null);
  assert.equal(claude({ live, api: { bedrock: true } }).metered5h, null);
  assert.equal(claude({ api: { api: { x: 1 } } }).metered5h, null);
});

test("parseResets: Codex reports its windows by length", () => {
  assert.deepEqual(
    codex({
      primary: { window_minutes: WINDOW_MINUTES.h5, resets_at: 10 },
      secondary: { window_minutes: 10080, resets_at: 20 },
    }),
    { h5: 10_000, wk: 20_000, metered5h: true },
  );
  assert.deepEqual(codex({ primary: { window_minutes: 10080, resets_at: 20 } }), {
    h5: null,
    wk: 20_000,
    metered5h: false,
  });
  assert.deepEqual(codex({ primary: { window_minutes: 300, resets_at: 10 }, secondary: null }), {
    h5: 10_000,
    wk: null,
    metered5h: true,
  });
  assert.deepEqual(
    codex({ primary: { resets_at: 10 }, secondary: { window_minutes: 10080, resets_at: 20 } }),
    { h5: 10_000, wk: 20_000, metered5h: false },
  );
  assert.deepEqual(codex({ secondary: { window_minutes: 300, resets_at: 20 } }), {
    h5: null,
    wk: 20_000,
    metered5h: true,
  });
  assert.deepEqual(codex({ secondary: { window_minutes: 10080, resets_at: 20 } }), {
    h5: null,
    wk: 20_000,
    metered5h: false,
  });
  assert.deepEqual(codex({}), EMPTY);
  assert.deepEqual(codex({ primary: "x", secondary: 5 }), EMPTY);
  assert.deepEqual(codex(null), EMPTY);
});

test("task reset validation and labels reject inherited object keys", () => {
  for (const key of ["constructor", "toString", "__proto__"]) {
    assert.match(
      problem({ ...good, trigger: { ...good.trigger, provider: key } }),
      /trigger.provider/,
    );
    assert.match(problem({ ...good, trigger: { ...good.trigger, window: key } }), /trigger.window/);
    assert.equal(windowMinutes(key), 300);
    assert.equal(windowLabel(key), key);
    assert.equal(providerLabel(key), key);
  }
});

const withProps = (props) => Object.assign(() => {}, props);
const named = (name) => ({ toString: () => name });

test("runTask: a falsy cwd is omitted, whatever its type", async () => {
  vi.spyOn(Date, "now").mockReturnValue(7);
  const calls = [];
  const exec = async (...args) => {
    calls.push(args);
    return { code: 0 };
  };
  for (const cwd of [0, "", null, false]) await runTask(exec, { argv: ["t"], cwd });
  assert.deepEqual(
    calls.map((args) => args[2]),
    [0, 1, 2, 3].map(() => ({ timeout: TASK_TIMEOUT_MS })),
  );
  vi.restoreAllMocks();
});

test("runTask reads the result's code and stderr, and the error's message, by property", async () => {
  vi.spyOn(Date, "now").mockReturnValue(7);
  const task = { argv: ["tool"] };
  assert.deepEqual(await runTask(async () => withProps({ code: 3, stderr: "bad" }), task), {
    at: 7,
    code: 3,
    note: "bad",
  });
  assert.deepEqual(
    await runTask(async () => {
      throw withProps({ message: "fm" });
    }, task),
    { at: 7, code: -1, note: "fm" },
  );
  vi.restoreAllMocks();
});

test("task, trigger, last and config are read by property, whatever their typeof", () => {
  const dailyTrigger = { type: "daily", time: "09:00" };
  assert.equal(nextRunAt(withProps({ trigger: dailyTrigger }), { now: NOW }), at(9, 0));
  assert.equal(
    nextRunAt(withProps({ trigger: { type: "reset", provider: "claude", window: "h5" } }), {
      now: NOW,
    }),
    NOW,
  );
  assert.equal(
    nextRunAt(withProps({ trigger: dailyTrigger, last: withProps({ at: at(9, 1) }) }), {
      now: NOW,
    }),
    at(9, 0, 1),
  );
  assert.equal(describeTrigger(withProps({ trigger: dailyTrigger })), "Every day at 09:00");
  assert.equal(
    recordRun(withProps({ last: withProps({ fails: 2 }) }), { at: 5, code: 1 }).fails,
    3,
  );
  assert.deepEqual(JSON.parse(serializeTasks(withProps({ version: 3, tasks: [good] }))), {
    version: 3,
    tasks: [good],
  });
});

test("nextRunAt looks up the reported reset by the trigger's own provider and window", () => {
  assert.equal(
    nextRunAt(reset({ provider: "gemini" }), { now: NOW, resets: { gemini: { h5: NOW + 1000 } } }),
    NOW + 6000,
    "a provider key outside claude and codex is still looked up",
  );
  assert.equal(nextRunAt(reset(), { now: NOW, resets: null }), NOW, "no resets object is idle");
  assert.equal(
    nextRunAt(reset({ window: named("wk") }), { now: NOW, resets: { claude: { wk: NOW + 1000 } } }),
    NOW + 6000,
    "a window object is keyed by its string form",
  );
});

test("windowMinutes, windowLabel and providerLabel key by the value's string form", () => {
  assert.equal(windowMinutes(named("wk")), 10080);
  assert.equal(windowLabel(named("wk")), "weekly");
  assert.equal(windowLabel(named("zz")), "zz");
  assert.equal(windowMinutes(named("zz")), 300);
  assert.equal(providerLabel(named("codex")), "Codex");
});
