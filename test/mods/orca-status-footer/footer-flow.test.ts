import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vite-plus/test";
import type { AsyncContext } from "gpui-kit";
import { AGENT } from "../../../src/config/definitions/agent-catalog.js";
import { TASKS_VERSION, parseTasks } from "../../../src/shared/tasks.js";
import Chrome from "../../../src/mods/orca-status-footer/main.js";
import { TASK_KEYS } from "../../../src/mods/orca-status-footer/scheduler.js";

type Call = [string, unknown[]];

const TASKS_PATH = "/home/tasks.json";
const AGENT_CONFIG_PATH = "/home/agent-config.json";
const TICK_MS = 10_000;
const TASK_COMMAND = "run";
const SHELL = "sh";
const SCAN_COMMAND = "tasks-scan";

const recorder = vi.hoisted(() => {
  const calls = new WeakMap<object, [string, unknown[]][]>();
  const isCallback = (value: unknown): value is (node: object) => unknown =>
    typeof value === "function";
  function builder(name: string, ...args: unknown[]): object {
    const recorded: [string, unknown[]][] = [];
    const record: Record<string, unknown> = { name, args };
    const proxy: object = new Proxy(record, {
      get(target, key: string | symbol) {
        if (typeof key === "symbol" || key === "toJSON") return undefined;
        if (key in target) return target[key];
        return (...values: unknown[]) => {
          if (key === "when") {
            if (values[0] && isCallback(values[1])) values[1](proxy);
          } else {
            recorded.push([key, values]);
            if (key === "hover" && isCallback(values[0])) values[0](builder("hover"));
          }
          return proxy;
        };
      },
    });
    calls.set(proxy, recorded);
    return proxy;
  }
  return { calls, builder };
});

vi.mock("gpui-kit", () => ({
  View: class {},
  div: () => recorder.builder("div"),
  svg: (path: string) => recorder.builder("svg", path),
}));
vi.mock("gpui-base", () => ({
  h_flex: () => recorder.builder("h_flex"),
  v_flex: () => recorder.builder("v_flex"),
}));

type Host = typeof globalThis & {
  __herdrChecking?: () => boolean;
  __herdrExec?: (
    command: string,
    args?: string[],
  ) => Promise<{ code: number; stdout?: string; stderr?: string }>;
  __herdrShared?: (key: string) => unknown;
  __herdrSetShared?: (key: string, value: unknown) => void;
  __herdrProps?: () => unknown;
  __herdrLayout?: () => unknown;
  __herdrReadTextFile?: (path: string) => Promise<string | null>;
  __herdrWriteTextFile?: (path: string, text: string) => Promise<null>;
  __herdrNotify?: (message: unknown) => void;
  __herdrRun?: (...args: unknown[]) => void;
  __herdrNextCommand?: () => Promise<string>;
};

const host: Host = globalThis;

beforeEach(() => {
  host.__herdrChecking = () => false;
  host.__herdrExec = undefined;
  host.__herdrShared = undefined;
  host.__herdrSetShared = undefined;
  host.__herdrProps = undefined;
  host.__herdrLayout = undefined;
  host.__herdrReadTextFile = undefined;
  host.__herdrWriteTextFile = undefined;
  host.__herdrNotify = undefined;
  host.__herdrRun = undefined;
  host.__herdrNextCommand = undefined;
});

type FakeContext = {
  spawn: (fn: (cx?: AsyncContext) => unknown) => unknown;
  timer: { every: (ms: number, fn: (cx: AsyncContext) => void) => void };
};

function asContext(fake: FakeContext): AsyncContext {
  return fake as AsyncContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function fieldsOf(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value));
  return value;
}

function at(value: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>((current, key) => fieldsOf(current)[key], value);
}

function callsOfNode(node: object): Call[] {
  return recorder.calls.get(node) ?? [];
}

function collect(node: unknown, out: Call[], seen: Set<object>): void {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, out, seen);
    return;
  }
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  for (const [name, args] of callsOfNode(node)) {
    out.push([name, args]);
    for (const arg of args) collect(arg, out, seen);
  }
}

function allCalls(node: unknown): Call[] {
  const out: Call[] = [];
  collect(node, out, new Set());
  return out;
}

function byId(node: unknown, id: string): object | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = byId(item, id);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const calls = callsOfNode(node);
  if (calls.some(([name, args]) => name === "id" && args[0] === id)) return node;
  for (const [, args] of calls) {
    for (const arg of args) {
      const found = byId(arg, id);
      if (found) return found;
    }
  }
  return null;
}

test("the footer offers the agent pages and never fades or slides with the left sidebar", () => {
  const view = new Chrome();
  host.__herdrShared = () => 350;
  host.__herdrLayout = () => ({ children: [{ id: "left-sidebar", size: { px: 175 } }] });
  const frame = view.render();
  const calls = allCalls(frame);
  const labels = calls
    .filter(([name]) => name === "accessibility_label")
    .map(([, args]) => args[0]);
  const names = calls.map(([name]) => name);
  assert.ok(labels.includes("Agents"));
  assert.ok(!names.includes("opacity"));
  assert.ok(!names.includes("left"));
});

test("the Agents footer button is inverted only while the agent settings page is showing", () => {
  const view = new Chrome();
  host.__herdrProps = () => ({});
  host.__herdrShared = () => 350;
  const agents = (page: string) => {
    host.__herdrLayout = () => ({ children: [{ id: "main", active: page }] });
    const button = byId(view.render(), "agents");
    assert.ok(button);
    return callsOfNode(button).map(([name]) => name);
  };
  const [on, off] = [agents("main-agents"), agents("main-terminals")];

  assert.ok(
    on.includes("bg") && !on.includes("hover"),
    "active button is filled, with no hover tint",
  );
  assert.ok(off.includes("hover") && !off.includes("bg"), "idle button only tints on hover");
});

test("footer seeds the catalog model, then runs a requested task on the next tick", async () => {
  const jobs: Array<(cx?: AsyncContext) => unknown> = [];
  const calls: string[] = [];
  const files = new Map<string, string | null>([[TASKS_PATH, null]]);
  files.set(
    AGENT_CONFIG_PATH,
    JSON.stringify({ catalog: { [AGENT.codex]: { models: [{ id: "small" }] } } }),
  );
  host.__herdrReadTextFile = async (path) => files.get(path) ?? null;
  host.__herdrWriteTextFile = async (path, value) => {
    files.set(path, value);
    return null;
  };
  host.__herdrProps = () => ({});
  host.__herdrExec = async (cmd) => {
    calls.push(cmd);
    return { stdout: "", stderr: "", code: 0 };
  };
  let every: ((cx: AsyncContext) => void) | undefined;
  const pending: { request?: unknown } = {};
  host.__herdrShared = (key) => (key === TASK_KEYS.request ? pending.request : null);
  const cx: FakeContext = {
    spawn: (fn) => jobs.push(fn),
    timer: {
      every(ms, fn) {
        assert.equal(ms, TICK_MS);
        every = fn;
      },
    },
  };
  new Chrome().init({}, asContext(cx));

  await jobs[1]();
  const parsed = parseTasks(files.get(TASKS_PATH));
  assert.match(JSON.stringify(parsed.config), /small/);
  const task = parsed.config?.tasks[0];
  assert.ok(task);
  pending.request = { id: task.id, at: Date.now() };
  every!(asContext(cx));
  await jobs.at(-1)!();
  assert.ok(calls.includes(task.argv[0]));
});

type ExecResultLike = { code: number; stdout?: string; stderr?: string };
type RunnerExec = (command: string, args: string[]) => ExecResultLike | Promise<ExecResultLike>;
type RunnerOptions = {
  text: string | null;
  exec: RunnerExec;
  files?: Map<string, string | null>;
  resets?: string;
  request?: unknown;
};

async function startRunner({
  text,
  exec,
  files = new Map<string, string | null>(),
  resets = '{"claude":null,"codex":null}',
  request,
}: RunnerOptions) {
  const published: Record<string, unknown> = request ? { [TASK_KEYS.request]: request } : {};
  const sets: string[] = [];
  const notices: unknown[] = [];
  const jobs: Array<(cx?: AsyncContext) => unknown> = [];
  const execs: string[] = [];
  files.set(TASKS_PATH, text);
  host.__herdrReadTextFile = async (path) => files.get(path) ?? null;
  host.__herdrWriteTextFile = async (path, value) => {
    files.set(path, value);
    return null;
  };
  host.__herdrProps = () => ({});
  host.__herdrSetShared = (key, value) => {
    sets.push(key);
    published[key] = value;
  };
  host.__herdrShared = (key) => published[key];
  host.__herdrNotify = (notice) => notices.push(notice);
  host.__herdrExec = async (cmd, args = []) => {
    execs.push(cmd);
    if (cmd === SHELL) return { stdout: resets, code: 0 };
    return exec(cmd, args);
  };
  let every: ((cx: AsyncContext) => void) | undefined;
  const cx: FakeContext = {
    spawn: (fn) => jobs.push(fn),
    timer: {
      every: (_ms, fn) => {
        every = fn;
      },
    },
  };
  new Chrome().init({}, asContext(cx));
  const tick = async () => {
    await jobs.at(-1)!();
  };
  await tick();
  return {
    published,
    sets,
    notices,
    execs,
    files,
    tick: async () => {
      every!(asContext(cx));
      await tick();
    },
  };
}

const daily = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Task ${id}`,
  agent: AGENT.claude,
  argv: [TASK_COMMAND, id],
  enabled: true,
  trigger: { type: "daily", time: "00:00" },
  ...extra,
});
const configText = (tasks: unknown[]) => JSON.stringify({ version: TASKS_VERSION, tasks });

test("a broken tasks.json is published as an error and nothing runs", async () => {
  const run = await startRunner({ text: "{ nope", exec: () => assert.fail("no task may run") });
  assert.equal(run.published[TASK_KEYS.text], "{ nope");
  assert.equal(run.published[TASK_KEYS.config], null);
  assert.equal(run.published[TASK_KEYS.error], "tasks.json is not valid JSON.");
  assert.deepEqual(run.notices, []);
});

test("a due task runs once, a failure warns with its exit code and a thrown start reports its note", async () => {
  const run = await startRunner({
    text: configText([daily("a"), daily("off", { enabled: false }), daily("b")]),
    exec: (cmd, args) => {
      if (args[0] === "b") throw Error("not installed");
      return { code: 2, stderr: "bad", stdout: "" };
    },
  });
  assert.deepEqual(run.execs, [SHELL, TASK_COMMAND, TASK_COMMAND]);
  assert.deepEqual(run.notices, [
    { title: "Task a failed", body: "Exit 2 · bad", level: "warning" },
    { title: "Task b failed", body: "not installed", level: "warning" },
  ]);
  const state = fieldsOf(run.published[TASK_KEYS.state]);
  assert.deepEqual(Object.keys(state), ["a", "off", "b"]);
  assert.equal(at(state, "a", "last", "fails"), 1);
  assert.equal(at(state, "off", "last"), null);
  assert.equal(run.published[TASK_KEYS.error], "");

  const sets = run.sets.length;
  await run.tick();
  assert.deepEqual(
    run.execs.filter((cmd) => cmd === TASK_COMMAND),
    [TASK_COMMAND, TASK_COMMAND],
  );
  assert.equal(run.sets.length, sets, "an unchanged tick publishes nothing");
});

test("the reset probe publishes its readings and a failing probe keeps the last ones", async () => {
  const resets = JSON.stringify({
    claude: { live: { rate_limits: { five_hour: { resets_at: 4102444800 } } } },
    codex: null,
  });
  const run = await startRunner({ text: configText([]), exec: () => ({ code: 0 }), resets });
  assert.equal(at(run.published[TASK_KEYS.resets], "claude", "h5"), 4102444800 * 1000);
  const failing = await startRunner({
    text: configText([]),
    exec: () => ({ code: 0 }),
    resets: undefined,
  });
  assert.deepEqual(Object.keys(fieldsOf(failing.published[TASK_KEYS.resets])), ["claude", "codex"]);
  host.__herdrExec = async () => {
    throw Error("no shell");
  };
  const before = failing.published[TASK_KEYS.resets];
  await failing.tick();
  assert.equal(failing.published[TASK_KEYS.resets], before);
});

test("an unreadable file reports its message, and the runner works again on the next tick", async () => {
  const run = await startRunner({ text: "", exec: () => ({ code: 0 }), files: new Map() });
  host.__herdrReadTextFile = async () => {
    throw Error("disk gone");
  };
  await run.tick();
  assert.equal(run.published[TASK_KEYS.error], "disk gone");
  const restored = new Map<string, string | null>([[TASKS_PATH, configText([])]]);
  host.__herdrReadTextFile = async (path) => restored.get(path) ?? null;
  await run.tick();
  assert.equal(run.published[TASK_KEYS.error], "");
});

test("a missing file is seeded, with the catalog model unless the cache is unreadable", async () => {
  const files = new Map<string, string | null>([[AGENT_CONFIG_PATH, "{ broken"]]);
  const run = await startRunner({ text: null, exec: () => ({ code: 0 }), files });
  assert.equal(files.get(TASKS_PATH), run.published[TASK_KEYS.text]);
  const tasks = at(run.published[TASK_KEYS.config], "tasks");
  assert.ok(Array.isArray(tasks) && tasks.length > 0);
  assert.equal(run.published[TASK_KEYS.error], "");
});

test("a Run now request is served once while fresh and ignored when stale, malformed or for an unknown task", async () => {
  const text = configText([daily("a", { enabled: false })]);
  const exec = () => ({ code: 0 });
  const ran = async (request: unknown) =>
    (await startRunner({ text, exec, request })).execs.filter((cmd) => cmd === TASK_COMMAND).length;
  assert.equal(await ran({ id: "a", at: Date.now() }), 1);
  assert.equal(await ran({ id: "a", at: Date.now() - 120_000 }), 0);
  assert.equal(await ran({ id: "a", at: "x" }), 0);
  assert.equal(await ran({ id: 5, at: Date.now() }), 0);
  assert.equal(await ran({ id: "zzz", at: Date.now() }), 0);
  assert.equal(await ran(undefined), 0);
});

test("a layout whose children is not iterable throws, as the legacy footer did", () => {
  host.__herdrProps = () => ({});
  host.__herdrLayout = () => ({ children: 5 });
  assert.throws(() => new Chrome().render(), TypeError);
});

test("each footer button runs its own command when pressed", () => {
  host.__herdrProps = () => ({});
  host.__herdrLayout = () => ({ children: [{ id: "main", active: "main-tasks" }] });
  const ran: unknown[][] = [];
  host.__herdrRun = (...args) => {
    ran.push(args);
  };
  const frame = new Chrome().render();
  for (const id of ["agents", "tasks", "settings", "help"]) {
    const button = byId(frame, id);
    assert.ok(button);
    const press = callsOfNode(button).find(([name]) => name === "on_click")?.[1][0];
    assert.equal(typeof press, "function");
    (press as () => void)();
  }
  assert.deepEqual(ran, [
    ["orca-header.agent-settings"],
    ["layout.select", { stack: "main", child: "main-tasks" }],
    ["app.settings"],
    ["app.palette"],
  ]);
});

test("a page's scan request runs one cycle, and other commands run nothing", async () => {
  const jobs: Array<(cx?: AsyncContext) => unknown> = [];
  const commands = ["other", SCAN_COMMAND];
  host.__herdrNextCommand = () =>
    commands.length > 0 ? Promise.resolve(commands.shift()!) : new Promise(() => {});
  host.__herdrReadTextFile = async () => configText([]);
  host.__herdrProps = () => ({});
  host.__herdrExec = async () => ({ stdout: "", stderr: "", code: 0 });
  const cx: FakeContext = {
    spawn: (fn) => jobs.push(fn),
    timer: { every: () => {} },
  };
  new Chrome().init({}, asContext(cx));
  await jobs[1]!();
  const before = jobs.length;
  void jobs[0]!(asContext(cx));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(jobs.length, before + 1);
});
