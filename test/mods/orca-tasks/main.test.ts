import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vite-plus/test";
import type { Context } from "gpui-kit";
import { TextareaState } from "gpui-base";
import { AGENT } from "../../../src/shared/agent-catalog.js";
import Tasks from "../../../src/mods/orca-tasks/main.js";
import { parseTasks, serializeTasks, type Task } from "../../../src/shared/tasks.js";

type Call = [string, unknown[]];
const recorder = vi.hoisted(() => {
  type ChangeHandler = (event: unknown, cx: unknown) => void;
  const changeHandlers: ChangeHandler[] = [];
  const calls = new WeakMap<object, Call[]>();
  function builder(name: string, ...args: unknown[]): object {
    const recorded: Call[] = [];
    const record = { name, args };
    const proxy: object = new Proxy(record, {
      get(target, key) {
        if (typeof key === "symbol" || key === "toJSON") return undefined;
        if (key === "name" || key === "args") return target[key];
        return (...values: unknown[]) => {
          if (key === "when") {
            const [condition, branch] = values;
            if (condition && typeof branch === "function") branch(proxy);
          } else {
            recorded.push([key, values]);
            const [style] = values;
            if (key === "hover" && typeof style === "function") style(proxy);
          }
          return proxy;
        };
      },
    });
    calls.set(proxy, recorded);
    return proxy;
  }
  return { calls, builder, changeHandlers };
});

vi.mock("gpui-kit", () => ({
  View: class {},
  div: () => recorder.builder("div"),
  svg: (path: string) => recorder.builder("svg", path),
}));

vi.mock("gpui-base", () => {
  class TextareaState {
    private text: string;
    constructor(value = "") {
      this.text = value;
    }
    static new(options: { value?: string } = {}) {
      return new TextareaState(options.value);
    }
    value() {
      return this.text;
    }
    set_soft_wrap() {}
    on(_event: string, handler: (event: unknown, cx: unknown) => void) {
      recorder.changeHandlers.push(handler);
      return true;
    }
  }
  return {
    h_flex: () => recorder.builder("h_flex"),
    v_flex: () => recorder.builder("v_flex"),
    TextareaState,
    Textarea: { new: (state: object) => recorder.builder("Textarea", state) },
  };
});

type Host = typeof globalThis & {
  __herdrShared?: (key: string) => unknown;
  __herdrSetShared?: (key: string, value: unknown) => void;
  __herdrRun?: (...args: unknown[]) => void;
  __herdrLayout?: () => unknown;
  __herdrReadTextFile?: (path: string) => Promise<string | null>;
  __herdrWriteTextFile?: (path: string, text: string, expected?: string | null) => Promise<null>;
  __herdrSettings?: () => Record<string, unknown>;
  __herdrTheme?: () => Record<string, string>;
};
const host: Host = globalThis;
const FILE = "/home/tasks.json";
const KEY = {
  text: "tasks.text",
  config: "tasks.config",
  error: "tasks.error",
  state: "tasks.state",
  resets: "tasks.resets",
  request: "tasks.request",
} as const;
const SCAN_COMMAND = "orca-status-footer.tasks-scan";

let shared: Record<string, unknown>;
let published: Record<string, unknown>;
let commands: unknown[][];
let files: Map<string, string>;
let notices: number;

beforeEach(() => {
  shared = {};
  published = {};
  commands = [];
  files = new Map();
  notices = 0;
  host.__herdrShared = (key) => shared[key];
  host.__herdrSetShared = (key, value) => {
    shared[key] = value;
    published[key] = value;
  };
  host.__herdrRun = (...args) => {
    commands.push(args);
  };
  host.__herdrLayout = () => ({ children: [{ id: "main", active: "main-tasks" }] });
  host.__herdrReadTextFile = async (path) => files.get(path) ?? null;
  host.__herdrWriteTextFile = async (path, text) => {
    files.set(path, text);
    return null;
  };
  host.__herdrSettings = () => ({ font_family: "Mono" });
  host.__herdrTheme = undefined;
  recorder.changeHandlers.length = 0;
});

function asContext(stub: object): Context {
  return stub as Context;
}

const cx = (): Context =>
  asContext({
    notify: () => {
      notices += 1;
    },
    timer: { every: () => {} },
  });

const sample = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  agent: AGENT.claude,
  name: `Name ${id}`,
  argv: ["echo", id],
  enabled: true,
  trigger: { type: "daily", time: "09:00" },
  ...extra,
});

function page(tasks: Task[]): Tasks {
  const text = serializeTasks({ version: 1, tasks });
  files.set(FILE, text);
  shared[KEY.text] = text;
  return new Tasks();
}

function tasksOf(value: unknown): Task[] {
  const config = parseTasks(JSON.stringify(value)).config;
  assert.ok(config);
  return config.tasks;
}

function fileTasks(): Task[] {
  return tasksOf(JSON.parse(files.get(FILE) ?? ""));
}

function requestedId(): unknown {
  const request = published[KEY.request];
  return typeof request === "object" && request !== null && "id" in request
    ? request.id
    : undefined;
}

function editorStub(value: string) {
  return TextareaState.new({ value });
}

function calls(node: unknown): Call[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((item) => calls(item));
  const out = [...(recorder.calls.get(node) ?? [])];
  for (const [, args] of recorder.calls.get(node) ?? [])
    for (const arg of args) out.push(...calls(arg));
  return out;
}

type Handler = (event: unknown, cx: unknown) => void;
const isHandler = (value: unknown): value is Handler => typeof value === "function";

function clickHandler(node: unknown, id: string): Handler | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = clickHandler(item, id);
      if (hit) return hit;
    }
    return null;
  }
  const own = recorder.calls.get(node) ?? [];
  const ownId = own.find(([name]) => name === "id")?.[1][0];
  if (ownId === id) {
    const handler = own.find(([name]) => name === "on_click")?.[1][0];
    return isHandler(handler) ? handler : null;
  }
  for (const [, args] of own)
    for (const arg of args) {
      const hit = clickHandler(arg, id);
      if (hit) return hit;
    }
  return null;
}

test("page timer, editor and stale writes keep their notification and retry behavior", async () => {
  const view = new Tasks();
  let tick: ((cx: unknown) => void) | undefined;
  const context = {
    notify: () => {
      notices += 1;
    },
    timer: {
      every: (ms: number, fn: (cx: unknown) => void) => {
        assert.equal(ms, 30000);
        tick = fn;
      },
    },
  };
  view.init({}, asContext(context));
  tick?.(context);
  assert.equal(notices, 1);
  shared[KEY.text] = '{"tasks":[]}';
  let writes = 0;
  host.__herdrWriteTextFile = async () => {
    writes += 1;
    throw Error("stale");
  };
  files.set(FILE, '{"version":1,"tasks":[]}');
  await view.apply(asContext(context), (config) => config);
  assert.equal(writes, 2);
  assert.match(view.error, /changed while saving/);
  host.__herdrWriteTextFile = async (path, text) => {
    files.set(path, text);
    return null;
  };
  await view.apply(asContext(context), (config) => config, { saved: true });
  assert.equal(view.saved, true);
  assert.deepEqual(commands, [[SCAN_COMMAND]]);
  view.openEditor(asContext(context));
  assert.equal(view.editing, true);
});

test("task cards show last failure, reset exemption, paused and scheduled states", () => {
  const view = new Tasks();
  const task = sample("one", {
    enabled: false,
    trigger: { type: "reset", provider: AGENT.codex, window: "h5" },
  });
  shared[KEY.config] = { tasks: [task] };
  shared[KEY.state] = { one: { last: { code: 2, fails: 3, note: "oops", at: 1 } } };
  shared[KEY.resets] = { codex: { metered5h: false } };
  const draw = () => JSON.stringify(calls(view.render()));
  assert.match(draw(), /no 5h limit on this plan/);
  assert.match(draw(), /exit 2 · oops · 3×/);
  shared[KEY.resets] = { codex: { metered5h: true } };
  assert.match(draw(), /paused/);
  task.enabled = true;
  assert.match(draw(), /no next run/);
});

test("toggle, delete and New task rewrite the file and publish the new config", async () => {
  const pageView = page([sample("a"), sample("b")]);
  const context = cx();
  await pageView.toggle(context, sample("a"));
  assert.deepEqual(
    fileTasks().map((t) => [t.id, t.enabled]),
    [
      ["a", false],
      ["b", true],
    ],
  );
  assert.deepEqual(commands, [[SCAN_COMMAND]]);
  assert.equal(published[KEY.error], "");
  assert.equal(pageView.saved, false);
  await pageView.remove(context, sample("a"));
  assert.deepEqual(
    tasksOf(published[KEY.config]).map((t) => t.id),
    ["b"],
  );
  await pageView.add(context);
  const added = fileTasks().at(-1);
  assert.ok(added);
  assert.match(added.id, /^task-/);
  assert.deepEqual(
    [added.name, added.enabled, added.agent, added.trigger, added.cwd],
    ["New task", false, AGENT.claude, { type: "daily", time: "09:00" }, null],
  );
  assert.equal(pageView.saved, true);
  assert.equal(notices, 3);
});

test("a stored text that is not a task list, or a mutation that throws, reports its message", async () => {
  const bad = page([]);
  shared[KEY.text] = "not json";
  await bad.apply(cx(), (config) => config);
  assert.equal(bad.error, "tasks.json is not valid JSON.");
  assert.deepEqual(commands, []);
  notices = 0;
  const thrown = page([sample("a")]);
  await thrown.apply(cx(), () => {
    throw Error("no good");
  });
  assert.equal(thrown.error, "no good");
  assert.equal(notices, 1);
  assert.deepEqual(published, {});
});

test("a stale write re-reads the file once and publishes what it found", async () => {
  const pageView = page([sample("a")]);
  const fresh = serializeTasks({ version: 1, tasks: [sample("z")] });
  let sets = 0;
  host.__herdrReadTextFile = async () => fresh;
  host.__herdrWriteTextFile = async () => {
    sets += 1;
    throw Error("stale");
  };
  await pageView.apply(cx(), (config) => config);
  assert.equal(sets, 2);
  assert.deepEqual(
    tasksOf(published[KEY.config]).map((t) => t.id),
    ["z"],
  );
  assert.equal(published[KEY.text], fresh);
  assert.match(pageView.error, /changed while saving/);
});

test("Run now files a request for the runner; the JSON editor validates, saves and cancels", async () => {
  const pageView = page([sample("a")]);
  const context = cx();
  pageView.runNow(context, sample("a"));
  assert.equal(requestedId(), "a");
  assert.deepEqual(commands, [[SCAN_COMMAND]]);
  pageView.openEditor(context);
  assert.equal(pageView.editing, true);
  const edited = async (value: string) => {
    pageView.editor = editorStub(value);
    return pageView.saveEditor(context);
  };
  await edited("{");
  assert.equal(pageView.error, "tasks.json is not valid JSON.");
  await edited('{"tasks": []}');
  assert.equal(files.get(FILE), '{"tasks": []}\n');
  assert.deepEqual([pageView.saved, pageView.error, published[KEY.error]], [true, "", ""]);
  host.__herdrWriteTextFile = async () => {
    throw Error("stale");
  };
  await edited('{"tasks": []}\n');
  assert.match(pageView.error, /cancel and reopen/);
  pageView.closeEditor(context);
  assert.deepEqual([pageView.editing, pageView.editor, pageView.error], [false, null, ""]);
});

test("cards word the last run: never, ok with note, failure with count, running and paused", () => {
  const view = new Tasks();
  const tasks = [sample("n"), sample("ok"), sample("zero", { enabled: false }), sample("run")];
  shared[KEY.config] = { tasks };
  shared[KEY.state] = {
    ok: { last: { code: 0, at: 1, note: "fine" }, nextAt: Date.now() + 3_630_000 },
    zero: { last: { code: 3, at: 1, fails: 0 } },
    run: { running: true },
  };
  shared[KEY.error] = "shared failure";
  const rendered = JSON.stringify(calls(view.render()));
  for (const text of [
    "Never ran.",
    "· ok · fine",
    "exit 3",
    "paused",
    "running…",
    "shared failure",
    "Edit JSON",
    "in 1h 0m",
  ])
    assert.ok(rendered.includes(text), text);
  assert.ok(!rendered.includes("3×"));
  view.editing = true;
  view.editor = editorStub("");
  assert.match(JSON.stringify(calls(view.render())), /Close JSON[\s\S]*tm-editor/);
});

test("rendered task controls never reuse expired render or event contexts", async () => {
  const task = sample("a", { enabled: false });
  const pageView = page([task]);
  const current = () => fileTasks();
  shared[KEY.text] = files.get(FILE);
  shared[KEY.config] = { tasks: current() };
  const click = async (id: string) => {
    const handler = clickHandler(pageView.render(), id);
    assert.ok(handler, id);
    let valid = true;
    let pending: Promise<void> | undefined;
    const eventCx = {
      notify() {
        assert.ok(valid, "event context expired");
      },
      spawn(fn: (cx: Context) => Promise<void>) {
        assert.ok(valid);
        pending = Promise.resolve().then(() => fn(cx()));
      },
    };
    handler({}, eventCx);
    valid = false;
    await pending;
  };
  await click("tm-json");
  assert.equal(pageView.editing, true);
  await click("tm-cancel");
  assert.equal(pageView.editing, false);
  await click("tm-json");
  pageView.editor = editorStub(JSON.stringify({ tasks: current() }));
  await click("tm-save");
  assert.equal(pageView.saved, true);
  await click("tm-json");
  assert.equal(pageView.editing, false);
  await click("tm-on-a");
  assert.equal(current()[0].enabled, true);
  await click("tm-run-a");
  assert.equal(requestedId(), "a");
  await click("tm-add");
  assert.equal(current().length, 2);
  assert.equal(current()[1].enabled, false);
  await click("tm-del-a");
  assert.equal(current().length, 1);
});

test("editing tasks JSON presents the editor ahead of the task cards and hides the reset list", () => {
  const view = new Tasks();
  shared[KEY.config] = { tasks: [sample("a")] };
  view.editing = true;
  view.editor = editorStub("");
  const rendered = JSON.stringify(calls(view.render()));
  assert.match(rendered, /Close JSON[\s\S]*tm-editor[\s\S]*tm-save[\s\S]*tm-cancel/);
  assert.doesNotMatch(rendered, /tm-task-a|RESET WINDOWS/);
});

test("the refresh timer redraws only while the tasks page is the active page", () => {
  const view = new Tasks();
  let tick: ((cx: Context) => void) | undefined;
  const timerCx = asContext({
    notify: () => {
      notices += 1;
    },
    timer: {
      every: (_ms: number, fn: (cx: Context) => void) => {
        tick = fn;
      },
    },
  });
  view.init({}, timerCx);
  host.__herdrLayout = () => ({ children: [{ id: "main", active: "main-terminals" }] });
  tick?.(timerCx);
  host.__herdrLayout = () => ({ children: [{ id: "other", children: [] }] });
  tick?.(timerCx);
  host.__herdrLayout = () => null;
  tick?.(timerCx);
  assert.equal(notices, 0);
});

test("a non-object reset or live entry reads as no entry: no reset window, no last run", () => {
  const view = new Tasks();
  const task = sample("a", {
    enabled: false,
    trigger: { type: "reset", provider: AGENT.claude, window: "h5" },
  });
  shared[KEY.config] = { tasks: [task] };
  shared[KEY.resets] = { claude: 5, codex: { metered5h: true, h5: Date.now() + 3_600_000 } };
  shared[KEY.state] = { a: 5 };
  const rendered = JSON.stringify(calls(view.render()));
  assert.match(rendered, /no window reported/);
  assert.match(rendered, /Never ran\./);
  assert.match(rendered, /in 1h 0m/);
});

test("a shared config that is not an object is used as given: no waiting text, no tasks", () => {
  shared[KEY.config] = "text";
  const rendered = JSON.stringify(calls(new Tasks().render()));
  assert.doesNotMatch(rendered, /Waiting for the task runner/);
  assert.match(rendered, /No tasks\. New task adds/);
});

test("a shared config whose tasks is not a list fails on render, as the legacy page did", () => {
  shared[KEY.config] = { tasks: "abc" };
  assert.throws(() => new Tasks().render(), TypeError);
});

test("a shared task without a trigger renders as an untriggered task instead of throwing", () => {
  shared[KEY.config] = { tasks: [{ id: "bare", name: "Bare", enabled: true, argv: ["echo"] }] };
  const rendered = JSON.stringify(calls(new Tasks().render()));
  assert.match(rendered, /Bare/);
  assert.match(rendered, /no next run/);
});

test("malformed live state is used as given: a truthy running flag and a non-number code show", () => {
  shared[KEY.config] = { tasks: [sample("a")] };
  shared[KEY.state] = { a: { running: "yes", last: { at: 1, code: "0", note: 7 } } };
  const rendered = JSON.stringify(calls(new Tasks().render()));
  assert.match(rendered, /running…/);
  assert.match(rendered, /exit 0 · 7/);
});

test("a shared error that is not a string is shown as given", () => {
  shared[KEY.error] = 5;
  const rendered = calls(new Tasks().render());
  assert.ok(rendered.some(([name, args]) => name === "child" && args[0] === 5));
});

test("a shared text that is not a string is parsed as given, not replaced by the default file", async () => {
  shared[KEY.text] = 5;
  const pageView = new Tasks();
  await pageView.apply(cx(), (config) => config);
  assert.equal(pageView.error, "tasks.json must contain a JSON object.");
  assert.deepEqual(commands, []);
  assert.equal(files.size, 0);
  assert.equal(published[KEY.text], undefined);
});

test("a mutation that throws a non-Error object reports its message field", async () => {
  const pageView = page([sample("a")]);
  await pageView.apply(cx(), () => {
    throw { message: "boom" };
  });
  assert.equal(pageView.error, "boom");
});

test("the refresh timer throws on layout children that are not iterable, as the legacy page did", () => {
  const view = new Tasks();
  let tick: ((cx: Context) => void) | undefined;
  const timerCx = asContext({
    notify: () => {
      notices += 1;
    },
    timer: {
      every: (_ms: number, fn: (cx: Context) => void) => {
        tick = fn;
      },
    },
  });
  view.init({}, timerCx);
  host.__herdrLayout = () => ({ children: 5 });
  assert.throws(() => tick?.(timerCx), TypeError);
});

test("without a task list the page says the runner is still starting", () => {
  const rendered = JSON.stringify(calls(new Tasks().render()));
  assert.match(rendered, /Waiting for the task runner…/);
});

test("theme tokens pass through unchanged, and a missing token paints an unset color", () => {
  host.__herdrTheme = () => ({ background: "red", surface: "rgb(1, 2, 3)" });
  const painted = calls(new Tasks().render())
    .filter(([name]) => name === "bg")
    .map(([, args]) => args[0]);
  assert.ok(painted.includes("red"));
  assert.ok(painted.includes("rgb(1, 2, 3)"));
  host.__herdrTheme = () => ({});
  assert.ok(
    calls(new Tasks().render()).some(([name, args]) => name === "bg" && args[0] === undefined),
  );
});

test("the mono font is the settings font as given, else JetBrains Mono", () => {
  shared[KEY.config] = { tasks: [sample("a")] };
  const families = () =>
    calls(new Tasks().render())
      .filter(([name]) => name === "font_family")
      .map(([, args]) => args[0]);
  host.__herdrSettings = () => ({ font_family: 5 });
  assert.ok(families().includes(5));
  assert.ok(!families().includes("JetBrains Mono"));
  host.__herdrSettings = () => ({});
  assert.ok(families().includes("JetBrains Mono"));
  assert.ok(!families().includes(5));
});

test("the back button returns to the terminals page", () => {
  const handler = clickHandler(new Tasks().render(), "tm-back");
  assert.ok(handler);
  handler({}, {});
  assert.deepEqual(commands, [["layout.select", { stack: "main", child: "main-terminals" }]]);
});

test("typing in the JSON editor clears the saved note", () => {
  const pageView = page([sample("a")]);
  const context = cx();
  pageView.saved = true;
  pageView.openEditor(context);
  for (const handler of recorder.changeHandlers) handler({}, context);
  assert.equal(pageView.saved, false);
  assert.equal(notices, 2);
});

test("a stale write whose re-read fails keeps the stored text and reports the conflict", async () => {
  const pageView = page([sample("a")]);
  host.__herdrReadTextFile = async () => {
    throw Error("unreadable");
  };
  host.__herdrWriteTextFile = async () => {
    throw Error("stale");
  };
  await pageView.apply(cx(), (config) => config);
  assert.match(pageView.error, /changed while saving/);
  assert.equal(published[KEY.config], undefined);
});
