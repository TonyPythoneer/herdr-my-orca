import { afterEach, test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import type { AsyncContext } from "gpui-kit";
import Tabs from "../../../src/mods/orca-header/main.js";
import { hostState, nodeOf } from "./host.js";

vi.mock("gpui-kit", async () => (await import("./host.js")).flowGpuiKit());
vi.mock("gpui-base", async () => (await import("./host.js")).flowGpuiBase());
vi.mock("herdr", async () => (await import("./host.js")).herdr());

type Entry = [string, unknown];
type RawNode = { n: string; a: unknown[]; c: Entry[] };
type Fn = (...args: unknown[]) => unknown;
type TimerFn = (cx: AsyncContext) => unknown;
type Timer = {
  ms: number;
  fn: TimerFn;
  label: string;
  after?: boolean;
  cancelled: boolean;
  cancel(): void;
};
type Task = { fn: (cx: AsyncContext) => unknown; label: string };
type Tab = {
  id: string;
  name?: string;
  status?: string;
  active?: boolean;
  named?: boolean;
  settled?: boolean;
  zoomed?: boolean;
};
type Win = {
  at?: { x: number; y: number } | null;
  viewport_size: () => { width: number; height: number };
  mouse_position: () => { x: number; y: number } | null;
};
type Opts = {
  props?: Record<string, unknown>;
  initProps?: Record<string, unknown>;
  window?: Record<string, unknown>;
  spaces?: Record<string, unknown>[];
  layout?: Record<string, unknown>;
  panes?: Record<string, unknown>[];
  terminals?: Record<string, unknown>[];
  settings?: Record<string, unknown>;
  shared?: Record<string, unknown>;
  state?: Record<string, unknown>;
  storage?: Record<string, string>;
  commands?: string[];
  keepResult?: unknown;
  logOpenPx?: boolean;
};
type Layout = {
  id?: string;
  hidden?: boolean;
  size?: { px?: number };
  active?: string;
  children?: Layout[];
} & Record<string, unknown>;
type SpaceRec = { id: string; active?: boolean; folder?: string; tabs: Tab[] };

const END = new Error("end of command stream");
const THEME: Record<string, string> = {
  surface: "#s",
  background: "#b",
  foreground: "#f",
  muted: "#m",
  dim: "#d",
  popover: "#p",
  border: "#bo",
  solid: "#so",
  solid_foreground: "#sf",
  input: "#i",
  raised: "#r",
  hover: "#h",
};
const cleanups: (() => void)[] = [];

const tab = (id: string, extra: Partial<Tab> = {}): Tab => ({
  id,
  name: `Tab ${id}`,
  status: "idle",
  ...extra,
});
const pane = (id: string, tabId: string, extra: Record<string, unknown> = {}) => ({
  pane: id,
  tab: tabId,
  terminal: `tty-${id}`,
  title: `title ${id}`,
  ...extra,
});

function valuesOf(entry: Entry): unknown[] {
  return entry[1] as unknown[];
}

function childNodes(node: RawNode): RawNode[] {
  return node.c.flatMap(([method, values]) => {
    if (method === "child") return values as RawNode[];
    if (method === "children") return (values as RawNode[][])[0];
    return [];
  });
}

function nodes(root: RawNode): RawNode[] {
  return [
    root,
    ...childNodes(root)
      .filter((child) => child?.c)
      .flatMap(nodes),
  ];
}

function has(node: RawNode, method: string, value: unknown): boolean {
  return node.c.some(([key, values]) => key === method && (values as unknown[])[0] === value);
}

function byId(tree: RawNode, id: string): RawNode | undefined {
  return nodes(tree).find((n) => has(n, "id", id));
}

function handler(node: RawNode | undefined, method: string, button?: string): Fn {
  const entry = node?.c.find(
    ([key, values]) =>
      key === method && (button === undefined || (values as unknown[])[0] === button),
  );
  if (!entry) throw new Error(`no ${method} handler`);
  return valuesOf(entry).at(-1) as Fn;
}

function hasHandler(node: RawNode, method: string, button?: string): boolean {
  return node.c.some(
    ([key, values]) =>
      key === method && (button === undefined || (values as unknown[])[0] === button),
  );
}

function pillOf(tree: RawNode, id: string): RawNode | undefined {
  const slot = byId(tree, id);
  return slot ? nodes(slot).find((n) => hasHandler(n, "on_mouse_up", "left")) : undefined;
}

const event = (extra: Record<string, unknown> = {}) => ({
  position: { x: 10, y: 10 },
  bounds: { x: 0, y: 0, width: 144, height: 36 },
  ...extra,
});

function mouse(
  w: World,
  node: RawNode | undefined,
  method: string,
  button?: string,
  e: Record<string, unknown> = event(),
): unknown {
  return handler(node, method, button)(e, w.hcx);
}

function notified(w: World, label: string): number {
  return w.log.filter(([kind, who]) => kind === "notify" && who === label).length;
}

function viewport(): Win {
  const created: Win = {
    viewport_size: () => ({ width: 1200, height: 800 }),
    mouse_position: () => created.at ?? null,
  };
  Object.assign(globalThis, { window: created });
  return created;
}

function traces(w: World, name: string): unknown[] {
  return [...w.files]
    .filter(([path]) => path.endsWith(`-${name}.json`))
    .map(([, text]) => (JSON.parse(text) as { detail: unknown }).detail);
}

function find(root: unknown, id: string): Layout | undefined {
  const node = root as Layout;
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return undefined;
}

type World = {
  log: unknown[][];
  files: Map<string, string>;
  commands: string[];
  shared: Record<string, unknown>;
  timers: Timer[];
  tasks: Task[];
  clock: number;
  panes: Record<string, unknown>[];
  terminals: Record<string, unknown>[];
  spaces: SpaceRec[];
  layout: Layout;
  keepResult: unknown;
  storage: Map<string, string>;
  host: {
    window: Record<string, unknown> | undefined;
    settings: Record<string, unknown>;
    panes: Record<string, unknown>[];
    terminals: Record<string, unknown>[];
    files: Map<string, string>;
    setShared: (key: string, value: unknown) => void;
  };
  view: Tabs;
  cx: AsyncContext;
  hcx: AsyncContext;
  loop: Task | undefined;
  props: Record<string, unknown>;
  calls: (name: string) => unknown[];
  runLog: () => unknown[][];
  runTasks: (cx?: AsyncContext) => Promise<void>;
  render: () => RawNode;
};

type Base = Omit<
  World,
  "cx" | "hcx" | "view" | "loop" | "calls" | "runLog" | "runTasks" | "render"
>;

function contextFactory(base: Base): (label: string) => AsyncContext {
  return (label: string) =>
    Object.assign({} as AsyncContext, {
      label,
      notify: (): unknown => base.log.push(["notify", label]),
      stop_propagation: (): unknown => base.log.push(["stop", label]),
      focus_handle: () => ({ focus: (): unknown => base.log.push(["focus", label]) }),
      spawn: (fn: (cx: AsyncContext) => unknown): unknown => base.tasks.push({ fn, label }),
      sleep: async (ms: number) => {
        base.clock += ms;
      },
      timer: {
        every: (ms: number, fn: TimerFn): Timer => {
          const timer: Timer = {
            ms,
            fn,
            label,
            cancelled: false,
            cancel() {
              this.cancelled = true;
            },
          };
          base.timers.push(timer);
          return timer;
        },
        after: (ms: number, fn: TimerFn): Timer => {
          const timer: Timer = {
            ms,
            fn,
            after: true,
            label,
            cancelled: false,
            cancel() {
              this.cancelled = true;
            },
          };
          base.timers.push(timer);
          return timer;
        },
      },
    });
}

function setup(o: Opts = {}): World {
  const realNow = Date.now;
  const base: Base = {
    log: [],
    files: new Map(),
    commands: [...(o.commands ?? [])],
    shared: { ...o.shared },
    timers: [],
    tasks: [],
    clock: 1_700_000_000_000,
    panes: o.panes ?? [],
    terminals: o.terminals ?? [],
    spaces: (o.spaces as SpaceRec[] | undefined) ?? [
      {
        id: "s1",
        active: true,
        folder: "/proj",
        tabs: [tab("a", { active: true }), tab("b"), tab("c")],
      },
    ],
    layout: {
      id: "root",
      children: [
        { id: "left-sidebar", size: { px: 259 } },
        { id: "main", size: { px: 900 }, active: "main-terminals" },
        { id: "panel", size: { px: 350 } },
        { id: "panel-body", active: "files" },
        { id: "status", size: { px: 24 } },
      ],
      ...o.layout,
    },
    keepResult: o.keepResult,
    storage: new Map(Object.entries(o.storage ?? {})),
    host: {
      window: o.window,
      settings: o.settings ?? {},
      panes: [],
      terminals: [],
      files: new Map(),
      setShared: () => {},
    },
    props: o.props ?? {},
  };
  base.host.panes = base.panes;
  base.host.terminals = base.terminals;
  base.host.files = base.files;
  base.host.setShared = (key: string, value: unknown) => {
    const copy = value == null ? null : structuredClone(value);
    if (o.logOpenPx || !key.endsWith(".openPx")) base.log.push(["setShared", key, copy]);
    base.shared[key] = copy ?? undefined;
  };
  vi.spyOn(Date, "now").mockImplementation(() => base.clock);
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => base.storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        base.storage.set(key, value);
        base.log.push(["storage", key, value]);
      },
    },
  });
  cleanups.push(() => {
    base.shared = {};
    for (const timer of base.timers) if (timer.ms === 16 && !timer.cancelled) timer.fn(cx);
    vi.spyOn(Date, "now").mockImplementation(() => realNow());
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "localStorage");
  });
  installHost(base, o);
  const cxOf = contextFactory(base);
  const cx = cxOf("render");
  const hcx = cxOf("handler");
  const view = new Tabs();
  view.init(o.initProps ?? {}, cx);
  const loop = base.tasks.shift();
  const w: World = Object.assign(base, {
    cx,
    hcx,
    view,
    loop,
    calls: (name: string) =>
      base.log
        .filter(([kind, command]) => kind === "run" && command === name)
        .map(([, , args]) => args),
    runLog: () =>
      base.log.filter(([kind]) => kind === "run").map(([, command, args]) => [command, args]),
    runTasks: async (runCx: AsyncContext = hcx) => {
      while (base.tasks.length) await (base.tasks.shift() as Task).fn(runCx);
    },
    render: () => nodeOf(view.render(cx)),
  });
  Object.assign(view, o.state ?? {});
  return w;
}

function installHost(w: Base, o: Opts): void {
  hostState.props = () => o.props ?? {};
  hostState.theme = () => THEME;
  hostState.spaces = () => w.spaces;
  hostState.layout = () => w.layout;
  hostState.shared = (key: string) => w.shared[key];
  hostState.closeOverlay = (id?: string) => {
    w.log.push(["closeOverlay", id]);
    return null;
  };
  hostState.run = (command: string, args?: unknown) => {
    w.log.push(["run", command, args]);
    const params = args as { id?: string; px?: number } | undefined;
    const node = params?.id ? find(w.layout, params.id) : undefined;
    if (node && command === "layout.hide") node.hidden = true;
    if (node && command === "layout.show") node.hidden = false;
    if (node && command === "layout.resize" && params?.px != null) node.size = { px: params.px };
    return command === "terminal.keep" ? w.keepResult : undefined;
  };
  hostState.setShared = (key: string, value: unknown) => w.host.setShared(key, value);
  hostState.openOverlay = (spec: unknown) => {
    w.log.push(["openOverlay", spec]);
    return "overlay-1";
  };
  hostState.nextCommand = async () => {
    if (w.commands.length) return w.commands.shift() as string;
    throw END;
  };
  hostState.writeTextFile = async (path: string, text: string) => {
    w.files.set(path, text);
    return null;
  };
  hostState.panes = () => w.host.panes;
  hostState.terminals = () => w.host.terminals;
  hostState.window = () => w.host.window;
  hostState.settings = () => w.host.settings;
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  vi.restoreAllMocks();
});

test("commands open a tab in the active space and the toggles are counted for the render", async () => {
  const w = setup({
    commands: ["new-tab", "toggle-sidebar", "toggle-panel", "toggle-sidebar", "other"],
  });
  await assert.rejects(w.loop?.fn(w.hcx) as Promise<unknown>, (error) => error === END);
  assert.deepEqual(w.runLog(), [["tab.new", { space: "s1", folder: "/proj" }]]);
  assert.equal(w.view.wantToggle, 2);
  assert.equal(w.view.wantPanelToggle, 1);
  assert.equal(notified(w, "handler"), 3);
});

test("the window is read again until it is published, then cached and repainted", () => {
  const w = setup();
  assert.equal(w.timers[0].ms, 0);
  (w.timers.shift() as Timer).fn(w.hcx);
  for (let tries = 0; tries < 20; tries++) {
    assert.equal(w.timers.at(-1)?.ms, 50);
    (w.timers.shift() as Timer).fn(w.hcx);
  }
  assert.equal(w.timers.length, 0, "gives up after twenty tries");
  const late = setup();
  (late.timers.shift() as Timer).fn(late.hcx);
  late.host.window = { platform: "linux" };
  (late.timers.shift() as Timer).fn(late.hcx);
  assert.deepEqual(late.view.windowState, { platform: "linux" });
  assert.equal(notified(late, "handler"), 1);
  const seeded = setup({ window: { platform: "macos" } });
  assert.equal(seeded.timers.length, 0);
});

test("a stored panel map is read, and a broken one is replaced by an empty map", () => {
  assert.deepEqual(setup({ storage: { panels: '{"s1":"git"}' } }).view.panels, { s1: "git" });
  assert.deepEqual(setup({ storage: { panels: "oops" } }).view.panels, {});
  assert.deepEqual(setup({ storage: { panels: "7" } }).view.panels, {});
});

test("tab labels fall back from the tab name to the pane title, the program and Terminal", () => {
  const w = setup({
    panes: [
      pane("p1", "a", { program: { agent: true, name: "Codex" }, title: "✳ Build" }),
      pane("p2", "b", { title: "", program: { name: "zsh" } }),
    ],
    terminals: [{ address: "tty-p2", argv: ["freebuff"] }],
  });
  const label = (c: Tab, ...rest: unknown[]) =>
    (w.view.getTabLabel as (...args: unknown[]) => string)(c, ...rest);
  assert.equal(label({ id: "a", named: true, name: "Mine" }), "Mine");
  assert.equal(
    label({ id: "a", name: "Tab a" }),
    "Build",
    "an agent's title loses its leading glyph",
  );
  assert.equal(label({ id: "b", name: "Tab b" }), "freebuff", "an unofficial CLI keeps its name");
  assert.equal(label({ id: "x" }), "Terminal");
  assert.equal(label({ id: "x" }, null, { name: "tool" }), "tool");
  assert.equal(label({ id: "x" }, { title: "T", program: { name: "P" } }, null), "T");
  assert.equal(label({ id: "x" }, { program: { name: "P" } }, null), "P");
  assert.equal(w.view.unofficialApp(null), null);
  assert.equal(w.view.unofficialApp({ app: "freebuff" } as never)?.name, "freebuff");
  assert.equal(
    w.view.unofficialApp({ terminal: "tty-p2", program: { agent: true } } as never),
    null,
    "an official agent always wins",
  );
});

test("a pinned tab asks before closing, an unpinned one closes at once", () => {
  const w = setup();
  w.view.requestCloseTab({ id: "a", name: "Tab a" } as never);
  assert.deepEqual(w.runLog(), [["tab.close", { id: "a" }]]);
  w.log.length = 0;
  w.view.requestCloseTab({ id: "b", name: "Tab b", settled: true } as never);
  assert.deepEqual(w.log, [
    [
      "openOverlay",
      {
        mod: "orca-header",
        kind: "dialog",
        modal: true,
        width: 384,
        height: 200,
        props: { confirmClose: { kind: "pinned", tabId: "b", tabLabel: "Tab b" } },
      },
    ],
  ]);
  w.log.length = 0;
  w.storage.set("orca.confirmClosePinnedTab", "false");
  w.view.requestCloseTab({ id: "b", settled: true } as never);
  assert.deepEqual(w.runLog(), [["tab.close", { id: "b" }]]);
  Reflect.deleteProperty(globalThis, "localStorage");
  w.log.length = 0;
  w.view.requestCloseTab({ id: "b", settled: true } as never);
  assert.equal(w.log[0][0], "openOverlay", "an unreadable store counts as ask");
});

test("the close dialog confirms on enter and cancels on escape, remembering the choice by kind", () => {
  const confirmClose = { kind: "pinned", tabId: "b", tabLabel: "pin" };
  const w = setup({ props: { confirmClose, overlay: "ov" }, initProps: { confirmClose } });
  assert.equal(w.view.isDialog, true);
  const tree = () => w.render();
  const key = (name: string) => handler(tree(), "on_key_down")({ key: name }, w.hcx);
  key("x");
  assert.deepEqual(
    w.log.filter(([kind]) => kind !== "focus"),
    [],
  );
  key("escape");
  assert.deepEqual(
    w.log.filter(([kind]) => kind !== "focus"),
    [
      ["stop", "handler"],
      ["closeOverlay", "ov"],
    ],
  );
  w.log.length = 0;
  key("enter");
  assert.deepEqual(w.log, [
    ["stop", "handler"],
    ["closeOverlay", "ov"],
    ["run", "tab.close", { id: "b" }],
  ]);
  assert.equal(w.storage.has("orca.confirmClosePinnedTab"), false);
  const checkbox = nodes(tree()).find(
    (n) => hasHandler(n, "on_click") && n.c.some(([k]) => k === "cursor_pointer"),
  );
  w.log.length = 0;
  handler(checkbox, "on_click")({}, w.hcx);
  assert.equal(w.view.dontAskAgain, true);
  assert.deepEqual(w.log, [["notify", "handler"]]);
  handler(byId(tree(), "close-confirm"), "on_click")({}, w.hcx);
  assert.equal(w.storage.get("orca.confirmClosePinnedTab"), "false");
  handler(byId(tree(), "close-cancel"), "on_click")({}, w.hcx);
  assert.deepEqual(w.log.at(-1), ["closeOverlay", "ov"]);
});

test("the close dialog's remembered choice and bulk close follow the dialog kind", () => {
  const run = (cfg: Record<string, unknown>, again = true) => {
    const w = setup({
      props: { confirmClose: cfg, overlay: "ov" },
      initProps: { confirmClose: cfg },
      state: {},
      spaces: [
        { id: "s1", active: true, tabs: [tab("a"), tab("b")] },
        { id: "s2", folder: "/two", tabs: [tab("c")] },
      ],
    });
    w.view.dontAskAgain = again;
    handler(byId(w.render(), "close-confirm"), "on_click")({}, w.hcx);
    return w;
  };
  assert.equal(
    run({ kind: "agent", tabId: "a" }).storage.get(
      "orca.skipCloseTerminalWithRunningProcessConfirm",
    ),
    "true",
  );
  assert.equal(
    run({ tabId: "a" }).storage.get("orca.skipCloseTerminalWithRunningProcessConfirm"),
    "true",
  );
  assert.equal(run({ kind: "agent", tabId: "a" }, false).storage.size, 0);
  assert.equal(run({ kind: "bulk", tabIds: ["a"] }).storage.size, 0, "bulk never remembers");
  const bulk = run({ kind: "bulk", tabIds: ["a", "b"] });
  assert.deepEqual(bulk.runLog(), [
    ["tab.new", { space: "s1", focus: false }],
    ["tab.close", { id: "a" }],
    ["tab.close", { id: "b" }],
  ]);
  assert.deepEqual(run({ kind: "command" }).runLog(), [], "no target closes nothing");
});

test("the dialog copy depends on kind and bulk scope, and bulk hides the checkbox", () => {
  const texts = (cfg: Record<string, unknown>): unknown[] => {
    const w = setup({
      props: { confirmClose: cfg, overlay: "ov" },
      initProps: { confirmClose: cfg },
    });
    return nodes(w.render()).flatMap((n) =>
      n.c
        .filter(([key, values]) => key === "child" && typeof (values as unknown[])[0] === "string")
        .map(([, values]) => (values as unknown[])[0]),
    );
  };
  assert.deepEqual(texts({}).slice(0, 2), [
    "Stop running command?",
    "Closing this terminal will stop the command running inside it.",
  ]);
  assert.ok(texts({ kind: "agent" }).includes("Stop Agent"));
  assert.ok(texts({ kind: "pinned" }).includes("Close"));
  assert.equal(texts({ kind: "bulk", scope: "others", tabIds: ["a"] })[0], "Close other tabs?");
  assert.equal(texts({ kind: "bulk", scope: "right" })[0], "Close tabs to the right?");
  assert.equal(texts({ kind: "bulk", scope: "left" })[0], "Close tabs to the left?");
  assert.equal(texts({ kind: "bulk" })[0], "Close tabs?");
  assert.equal(
    texts({ kind: "bulk", tabIds: ["a", "b"] })[1],
    "2 tabs will be closed. Pinned tabs will stay open.",
  );
  assert.equal(
    texts({ kind: "bulk", tabIds: ["a"] })[1],
    "1 tab will be closed. Pinned tabs will stay open.",
  );
  assert.equal(texts({ kind: "bulk" }).includes("Don't ask again for running terminals"), false);
  assert.ok(texts({ kind: "pinned" }).includes("Don't ask again for pinned tabs"));
});

test("a tab press, move and release reorders along the strip and selects on a plain click", () => {
  const w = setup({ panes: [pane("p1", "a"), pane("p2", "b"), pane("p3", "c")] });
  const slot = (id: string) => pillOf(w.render(), `tab-${id}`);
  mouse(w, slot("a"), "on_mouse_down", "left", event({ click_count: 2 }));
  assert.deepEqual(
    [w.view.pressed, w.view.overTab, w.view.dragTab, w.view.dragTerminal, w.view.dragPane],
    [0, "a", "a", "tty-p1", "p1"],
  );
  assert.deepEqual(w.calls("tab.rename"), [{ id: "a" }]);
  assert.equal(notified(w, "handler"), 1);
  w.log.length = 0;
  mouse(w, slot("c"), "on_mouse_move", undefined, event({ local_position: { x: 100 } }));
  mouse(w, slot("c"), "on_mouse_move", undefined, event({ local_position: { x: 100 } }));
  assert.deepEqual([w.view.overTab, w.view.overSide], ["c", "right"]);
  assert.equal(notified(w, "handler"), 1);
  mouse(w, slot("c"), "on_mouse_up", "left");
  assert.deepEqual(w.calls("tab.move"), [{ id: "a", index: 3 }]);
  assert.deepEqual([w.view.pressed, w.view.overTab, w.view.overSide], [null, null, null]);
  mouse(w, slot("a"), "on_mouse_down", "left");
  mouse(w, slot("b"), "on_mouse_move", undefined, event({ local_position: { x: 10 } }));
  w.log.length = 0;
  mouse(w, slot("b"), "on_mouse_up", "left");
  assert.deepEqual(w.runLog(), [
    ["tab.select", { id: "b" }],
    ["layout.select", { stack: "main", child: "main-terminals" }],
  ]);
  w.log.length = 0;
  mouse(w, slot("b"), "on_mouse_up", "left");
  assert.deepEqual(w.log, [], "a release with no press does nothing");
  mouse(w, slot("c"), "on_mouse_down", "left");
  mouse(w, slot("a"), "on_mouse_move", undefined, event({ local_position: { x: 10 } }));
  mouse(w, slot("a"), "on_mouse_up", "left");
  assert.deepEqual(w.calls("tab.move").at(-1), { id: "c", index: 1 });
});

test("a tab's hover, middle click, right click, close and collapse buttons act on that tab", () => {
  const w = setup({
    spaces: [
      {
        id: "s1",
        active: true,
        tabs: [tab("a", { active: true, zoomed: true }), tab("b", { settled: true })],
      },
    ],
    panes: [pane("p1", "a", { zoomed: true }), pane("p2", "b")],
  });
  const slot = (id: string) => pillOf(w.render(), `tab-${id}`);
  handler(slot("b"), "on_hover")(true, w.hcx);
  assert.equal(w.view.hoveredTab, "b");
  handler(slot("b"), "on_hover")(true, w.hcx);
  assert.equal(notified(w, "handler"), 1);
  handler(slot("a"), "on_hover")(false, w.hcx);
  assert.equal(w.view.hoveredTab, "b", "leaving another tab keeps the hover");
  handler(slot("b"), "on_hover")(false, w.hcx);
  assert.equal(w.view.hoveredTab, null);
  w.log.length = 0;
  mouse(w, slot("a"), "on_mouse_down", "middle");
  assert.deepEqual(w.log, [
    ["stop", "handler"],
    ["run", "tab.close", { id: "a" }],
  ]);
  w.log.length = 0;
  mouse(w, slot("a"), "on_mouse_down", "right");
  assert.deepEqual(w.log, [
    ["stop", "handler"],
    [
      "openOverlay",
      {
        mod: "orca-context-menu",
        kind: "popup",
        width: 272,
        props: { tab: "tab", target: { id: "a", space: "s1" } },
      },
    ],
  ]);
  w.log.length = 0;
  handler(byId(w.render(), "close-a"), "on_click")({}, w.hcx);
  assert.deepEqual(w.runLog(), [["tab.close", { id: "a" }]]);
  assert.equal(byId(w.render(), "close-b"), undefined, "a pinned tab has no close button");
  w.log.length = 0;
  handler(byId(w.render(), "collapse-a"), "on_click")({}, w.hcx);
  assert.deepEqual(w.runLog(), [["pane.zoom", { pane: "p1" }]]);
  w.panes[0].zoomed = false;
  w.log.length = 0;
  handler(byId(w.render(), "collapse-a"), "on_click")({}, w.hcx);
  assert.deepEqual(w.runLog(), []);
  w.log.length = 0;
  handler(byId(w.render(), "tab-a"), "on_size_change")({ width: 200 }, w.hcx);
  handler(byId(w.render(), "tab-a"), "on_size_change")({ width: 200.3 }, w.hcx);
  assert.equal(w.view.tabWidths.get("a"), 200);
  assert.equal(notified(w, "handler"), 1, "a width that did not change is not a repaint");
});

test("the strip's own handlers measure, scroll, reveal the active tab and slide for arrows", () => {
  const w = setup({
    spaces: [
      {
        id: "s1",
        active: true,
        tabs: ["a", "b", "c", "d", "e"].map((id, i) => tab(id, { active: i === 4 })),
      },
    ],
  });
  const first = w.render();
  const viewportNode = nodes(first).find((n) => hasHandler(n, "on_scroll_wheel"));
  handler(viewportNode, "on_size_change")({ width: 300 }, w.hcx);
  handler(viewportNode, "on_size_change")({ width: 300.2 }, w.hcx);
  assert.equal(w.view.viewportWidth, 300);
  for (const id of ["a", "b", "c", "d", "e"]) w.view.measureTabWidth(id, 144, w.hcx);
  w.render();
  assert.equal(w.view.contentWidth, 720);
  assert.equal(w.view.scrollX, 420, "a newly active tab is brought into view");
  w.log.length = 0;
  handler(viewportNode, "on_scroll_wheel")({ delta: { x: 0, y: -50 } }, w.hcx);
  assert.equal(w.view.scrollX, 370);
  handler(viewportNode, "on_scroll_wheel")({ delta: { x: 30, y: 5 } }, w.hcx);
  assert.equal(w.view.scrollX, 400);
  handler(viewportNode, "on_scroll_wheel")({ delta: {} }, w.hcx);
  handler(viewportNode, "on_scroll_wheel")({}, w.hcx);
  assert.equal(w.view.scrollX, 400);
  w.view.animatedUntil = 1;
  handler(viewportNode, "on_scroll_wheel")({ delta: { x: 1000 } }, w.hcx);
  assert.equal(w.view.scrollX, 420, "clamped at the end");
  assert.equal(w.view.animatedUntil, 0, "real input is not a slide");
  assert.equal(w.view.sliding(), false);
  const tree = w.render();
  const left = byId(tree, "tab-scroll-start");
  w.log.length = 0;
  handler(left, "on_click")({}, w.hcx);
  assert.equal(notified(w, "handler"), 1, "the arrow must notify through its click context");
  assert.equal(notified(w, "render"), 0);
  assert.equal(w.view.scrollX, 195, "three quarters of the viewport");
  assert.equal(w.view.sliding(), true);
  handler(byId(w.render(), "tab-scroll-end"), "on_click")({}, w.hcx);
  assert.equal(w.view.scrollX, 420);
  w.view.scrollX = 0;
  w.render();
  handler(byId(w.render(), "tab-scroll-start"), "on_click")({}, w.hcx);
  assert.equal(w.view.scrollX, 0, "a disabled arrow does nothing");
  w.spaces[0].tabs.pop();
  w.render();
  assert.equal(w.view.tabWidths.has("e"), false);
});

test("pressing a tab and dragging down hands over to a drop overlay and the poll resolves a release", () => {
  const pointer = viewport();
  const w = setup({ panes: [pane("p1", "a"), pane("p2", "b"), pane("p3", "c")] });
  mouse(
    w,
    pillOf(w.render(), "tab-b"),
    "on_mouse_down",
    "left",
    event({ position: { x: 5, y: 10 } }),
  );
  const strip = event().bounds;
  assert.equal(
    w.view.triggerSplit(strip, { x: 5, y: 15 }, w.hcx),
    false,
    "below the activation distance",
  );
  const root = w.render();
  w.log.length = 0;
  handler(root, "on_mouse_move")({ position: { x: 5, y: 40 } }, w.hcx);
  assert.deepEqual(w.view.pressed, null);
  const record = {
    tab: "b",
    terminal: "tty-p2",
    pane: "p2",
    strip: { x: 259, y: 0, width: 591, height: 776, stripHeight: 36 },
  };
  assert.deepEqual(w.log.slice(0, 2), [
    ["setShared", "orca-header.drop", record],
    [
      "openOverlay",
      {
        mod: "orca-header",
        kind: "popup",
        frame: "none",
        at: { x: 259, y: 36 },
        width: 591,
        height: 740,
        props: { drop: true },
      },
    ],
  ]);
  assert.deepEqual(w.log[2], [
    "setShared",
    "orca-header.drop",
    { ...record, overlay: "overlay-1" },
  ]);
  assert.equal(notified(w, "handler"), 1);
  const poll = w.timers.find((timer) => timer.ms === 16) as Timer;
  pointer.at = { x: 300, y: 400 };
  poll.fn(w.hcx);
  assert.equal((w.shared["orca-header.drop"] as { zone: string }).zone, "left");
  w.log.length = 0;
  for (let tick = 0; tick < 20; tick++) poll.fn(w.hcx);
  assert.equal(poll.cancelled, true);
  assert.deepEqual(w.log, [
    ["setShared", "orca-header.drop", null],
    ["closeOverlay", "overlay-1"],
    ["run", "terminal.park", { terminal: "tty-p2" }],
  ]);
  assert.deepEqual(traces(w, "resolve"), [{ zone: "left" }]);
  assert.equal(
    w.timers.filter((timer) => timer.ms === 16).length,
    2,
    "a keep timer waits for the park",
  );
});

test("the poll waits for a pointer outside the panel, stops without a record and honours a release", () => {
  const pointer = viewport();
  const w = setup({ panes: [pane("p1", "a"), pane("p2", "b")] });
  Object.assign(w.view, {
    pressed: 0,
    pressAt: { x: 0, y: 0 },
    dragTab: "a",
    dragTerminal: "tty-p1",
    dragPane: "p1",
  });
  assert.equal(w.view.triggerSplit(event().bounds, { x: 0, y: 20 }, w.hcx), true);
  assert.equal(
    w.view.triggerSplit(event().bounds, { x: 0, y: 40 }, w.hcx),
    false,
    "a record is already in flight",
  );
  const poll = w.timers.find((timer) => timer.ms === 16) as Timer;
  pointer.at = { x: 5, y: 5 };
  w.log.length = 0;
  for (let tick = 0; tick < 25; tick++) poll.fn(w.hcx);
  assert.deepEqual(w.log, [], "outside the panel nothing is published or resolved");
  pointer.at = { x: 500, y: 20 };
  for (let tick = 0; tick < 25; tick++) poll.fn(w.hcx);
  assert.equal(poll.cancelled, false, "inside the strip band is not a drop");
  assert.equal(
    w.log.some((entry) => entry[0] === "closeOverlay"),
    false,
  );
  w.shared["orca-header.drop"] = { ...(w.shared["orca-header.drop"] as object), released: "up" };
  w.log.length = 0;
  poll.fn(w.hcx);
  assert.deepEqual(w.runLog(), [["terminal.park", { terminal: "tty-p1" }]]);
  assert.equal(poll.cancelled, true);
  const ended: string[] = [];
  w.shared = {};
  poll.fn(
    Object.assign({} as AsyncContext, w.hcx, {
      timer: { every: (): unknown => ended.push("x"), after: () => {} },
    }),
  );
  assert.deepEqual(ended, []);
});

test("a pointer that is unavailable leaves the poll idle", () => {
  const pointer = viewport();
  const w = setup({ panes: [pane("p1", "a"), pane("p2", "b")] });
  Object.assign(w.view, {
    pressed: 0,
    pressAt: { x: 0, y: 0 },
    dragTab: "a",
    dragTerminal: "tty-p1",
    dragPane: "p1",
  });
  w.view.triggerSplit(event().bounds, { x: 0, y: 20 }, w.hcx);
  pointer.at = null;
  w.log.length = 0;
  (w.timers.find((timer) => timer.ms === 16) as Timer).fn(w.hcx);
  assert.deepEqual(w.log, []);
  assert.equal(w.view.triggerSplit(null, { x: 0, y: 40 }, w.hcx), false);
});

test("a split drop parks the terminal, keeps it beside the active tab and swaps it for left and up", () => {
  const w = setup({
    panes: [pane("p1", "a", { focused: true }), pane("p2", "b")],
    keepResult: { pane: "new" },
  });
  const every = () => w.timers.filter((timer) => timer.ms === 16 && !timer.cancelled);
  w.shared["orca-header.action"] = { kind: "move-tab-split", tab: "b", direction: "left" };
  w.log.length = 0;
  w.render();
  assert.deepEqual(w.log.slice(0, 2), [
    ["setShared", "orca-header.action", null],
    ["run", "terminal.park", { terminal: "tty-p2" }],
  ]);
  const keep = every()[0];
  keep.fn(w.hcx);
  assert.equal(keep.cancelled, false, "the pane is still there");
  w.panes.splice(1, 1);
  keep.fn(w.hcx);
  assert.equal(keep.cancelled, true);
  assert.deepEqual(w.calls("terminal.keep"), [{ terminal: "tty-p2", place: "right" }]);
  assert.deepEqual(traces(w, "move-keep"), [
    { terminal: "tty-p2", place: "right", res: { pane: "new" } },
  ]);
  const swap = every().at(-1) as Timer;
  swap.fn(w.hcx);
  assert.equal(swap.cancelled, false, "the new pane is not mounted yet");
  w.panes.push(pane("new", "a", { terminal: "tty-p2" }));
  swap.fn(w.hcx);
  assert.equal(swap.cancelled, true);
  assert.deepEqual(w.calls("pane.swap"), [{ direction: "left", pane: "new" }]);
  assert.deepEqual(traces(w, "move-swap"), [{ pane: "new", direction: "left" }]);
});

test("dropping a group's only tab on its own panel does nothing", () => {
  const w = setup({
    panes: [pane("p1", "a", { focused: true })],
    spaces: [{ id: "s1", active: true, tabs: [tab("a", { active: true })] }],
  });
  w.shared["orca-header.action"] = { kind: "move-tab-split", tab: "a", direction: "left" };
  w.render();
  assert.deepEqual(w.calls("terminal.park"), []);
});

test("a split drop gives up when the park never finishes and skips the swap for right and down", () => {
  const w = setup({ panes: [pane("p1", "a", { focused: true }), pane("p2", "b")] });
  w.shared["orca-header.action"] = { kind: "move-tab-split", tab: "b", direction: "up" };
  w.render();
  const keep = w.timers.find((timer) => timer.ms === 16) as Timer;
  for (let tick = 0; tick < 60; tick++) keep.fn(w.hcx);
  assert.equal(keep.cancelled, true);
  assert.deepEqual(w.calls("terminal.keep"), []);
  assert.deepEqual(traces(w, "move-park-timeout"), [{ terminal: "tty-p2" }]);
  const down = setup({ panes: [pane("p1", "a", { focused: true }), pane("p2", "b")] });
  down.shared["orca-header.action"] = { kind: "move-tab-split", tab: "b", direction: "down" };
  down.render();
  down.panes.splice(1, 1);
  (down.timers.find((timer) => timer.ms === 16) as Timer).fn(down.hcx);
  assert.deepEqual(down.calls("terminal.keep"), [{ terminal: "tty-p2", place: "down" }]);
  assert.equal(down.timers.filter((timer) => timer.ms === 16).length, 1, "no swap timer");
  const unknown = setup({ panes: [] });
  unknown.shared["orca-header.action"] = { kind: "move-tab-split", tab: "zzz", direction: "left" };
  unknown.render();
  assert.deepEqual(
    unknown.runLog().filter(([command]) => command === "terminal.park"),
    [],
  );
});

test("swap without a named pane finds the terminal's pane and gives up when it never mounts", () => {
  const w = setup({ panes: [pane("p1", "a", { focused: true }), pane("p2", "b")] });
  w.shared["orca-header.action"] = { kind: "move-tab-split", tab: "b", direction: "up" };
  w.render();
  w.panes.splice(1, 1);
  (w.timers.find((timer) => timer.ms === 16) as Timer).fn(w.hcx);
  const swap = w.timers.filter((timer) => timer.ms === 16).at(-1) as Timer;
  for (let tick = 0; tick < 59; tick++) swap.fn(w.hcx);
  assert.equal(swap.cancelled, false);
  swap.fn(w.hcx);
  assert.equal(swap.cancelled, true);
  assert.deepEqual(w.calls("pane.swap"), []);
  const found = setup({ panes: [pane("p1", "a", { focused: true }), pane("p2", "b")] });
  found.shared["orca-header.action"] = { kind: "move-tab-split", tab: "b", direction: "up" };
  found.render();
  found.panes.splice(1, 1);
  (found.timers.find((timer) => timer.ms === 16) as Timer).fn(found.hcx);
  found.panes.push(pane("later", "a", { terminal: "tty-p2" }));
  (found.timers.filter((timer) => timer.ms === 16).at(-1) as Timer).fn(found.hcx);
  assert.deepEqual(found.calls("pane.swap"), [{ direction: "up", pane: "later" }]);
});

test("a pane dragged out of a split becomes its own tab once it has been parked", () => {
  const w = setup({ panes: [pane("p1", "a", { focused: true }), pane("p2", "a")] });
  w.shared["orca-header.action"] = { kind: "unsplit-to-tab", pane: "p2" };
  w.log.length = 0;
  w.render();
  assert.deepEqual(w.log.slice(0, 2), [
    ["setShared", "orca-header.action", null],
    ["run", "terminal.park", { terminal: "tty-p2" }],
  ]);
  const keep = w.timers.find((timer) => timer.ms === 16) as Timer;
  keep.fn(w.hcx);
  assert.equal(keep.cancelled, false);
  w.panes.splice(1, 1);
  keep.fn(w.hcx);
  assert.deepEqual(w.calls("terminal.keep"), [{ terminal: "tty-p2", place: "tab" }]);
  assert.deepEqual(traces(w, "unsplit-keep"), [{ terminal: "tty-p2" }]);
  const stuck = setup({ panes: [pane("p1", "a"), pane("p2", "a")] });
  stuck.shared["orca-header.action"] = { kind: "unsplit-to-tab", terminal: "tty-p1" };
  stuck.render();
  const retry = stuck.timers.find((timer) => timer.ms === 16) as Timer;
  for (let tick = 0; tick < 60; tick++) retry.fn(stuck.hcx);
  assert.equal(retry.cancelled, true);
  assert.deepEqual(traces(stuck, "unsplit-park-timeout"), [{ terminal: "tty-p1" }]);
  const nothing = setup({ panes: [] });
  nothing.shared["orca-header.action"] = { kind: "unsplit-to-tab", pane: "ghost" };
  nothing.render();
  assert.deepEqual(
    nothing.runLog().filter(([command]) => command === "terminal.park"),
    [],
  );
  const other = setup();
  other.shared["orca-header.action"] = { kind: "unknown" };
  other.render();
  assert.deepEqual(
    other.runLog().filter(([command]) => command === "terminal.park"),
    [],
  );
});

test("a pane drag released over the strip unsplits it; any other release clears the press", () => {
  const w = setup({ panes: [pane("p1", "a"), pane("p2", "a")] });
  w.shared["orca-header.pane-drag"] = { active: true, terminal: "tty-p2", pane: "p2" };
  const strip = w.render();
  w.log.length = 0;
  handler(strip, "on_mouse_up", "left")({}, w.hcx);
  assert.deepEqual(w.log.slice(0, 2), [
    ["setShared", "orca-header.pane-drag", null],
    ["run", "terminal.park", { terminal: "tty-p2" }],
  ]);
  assert.equal(notified(w, "handler"), 1);
  Object.assign(w.view, { pressed: 1, overTab: "b", overSide: "left" });
  w.shared["orca-header.drop"] = { tab: "a", overlay: "ov" };
  const again = w.render();
  w.log.length = 0;
  handler(again, "on_mouse_up", "left")({}, w.hcx);
  assert.deepEqual(w.log, [
    ["closeOverlay", "ov"],
    ["setShared", "orca-header.drop", null],
    ["notify", "handler"],
  ]);
  assert.deepEqual([w.view.pressed, w.view.overTab, w.view.overSide], [null, null, null]);
  const idle = w.render();
  w.log.length = 0;
  handler(idle, "on_mouse_move")({ position: { x: 0, y: 0 } }, w.hcx);
  assert.deepEqual(w.log, []);
  w.view.pressed = 0;
  w.view.stripBounds = { x: 0, y: 0, width: 10, height: 36 };
  handler(idle, "on_mouse_move")({ position: { x: 0, y: 0 } }, w.hcx);
  assert.deepEqual(w.log, [], "a press that has not travelled far enough stays on the strip");
});

test("the drop overlay follows the pointer, takes the release and closes on escape", () => {
  const record = {
    tab: "a",
    terminal: "tty-p1",
    zone: null,
    strip: { x: 100, y: 50, width: 800, height: 601, stripHeight: 36 },
  };
  const w = setup({
    props: { drop: true, overlay: "ov" },
    initProps: { drop: true },
    shared: { "orca-header.drop": record },
  });
  assert.equal(w.view.isDropOverlay, true);
  const [alive, follow] = w.timers as [Timer, Timer];
  assert.deepEqual([alive.ms, alive.after, follow.ms], [300, true, 16]);
  alive.fn(w.hcx);
  assert.deepEqual(traces(w, "overlay-alive"), [{ seesRecord: true, key: "set", zone: null }]);
  assert.equal(notified(w, "handler"), 1);
  w.shared["orca-header.drop"] = { ...record, zone: "up" };
  follow.fn(w.hcx);
  follow.fn(w.hcx);
  assert.equal(w.view.zone, "up");
  assert.equal(notified(w, "handler"), 2);
  w.shared = {};
  follow.fn(w.hcx);
  assert.equal(w.view.zone, null);
  follow.fn(w.hcx);
  assert.equal(notified(w, "handler"), 3);
  w.shared["orca-header.drop"] = { ...record, zone: "left" };
  const overlay = byId(w.render(), "tab-drop");
  w.log.length = 0;
  handler(overlay, "on_mouse_down", "left")({}, w.hcx);
  assert.deepEqual(w.log, [["stop", "handler"]]);
  assert.equal(w.view.zone, "left", "the render takes the zone the strip's poll published");
  handler(overlay, "on_mouse_move")({ position: { x: 880, y: 300 } }, w.hcx);
  assert.equal(w.view.zone, "right");
  assert.equal(notified(w, "handler"), 1);
  w.log.length = 0;
  handler(overlay, "on_mouse_move")({ position: { x: 880, y: 300 } }, w.hcx);
  assert.deepEqual(w.log, [], "the same zone is not a repaint");
  w.view.zone = "left";
  handler(overlay, "on_mouse_up", "left")({ position: { x: 150, y: 300 } }, w.hcx);
  assert.deepEqual(w.log, [
    ["setShared", "orca-header.drop", { ...record, zone: "left", released: "left" }],
  ]);
  w.log.length = 0;
  w.view.zone = null;
  handler(overlay, "on_mouse_up", "left")({ position: { x: 150, y: 300 } }, w.hcx);
  assert.deepEqual(w.log, [
    ["setShared", "orca-header.drop", null],
    ["closeOverlay", "ov"],
  ]);
  w.log.length = 0;
  handler(overlay, "on_key_down")({ key: "a" }, w.hcx);
  assert.deepEqual(w.log, []);
  handler(overlay, "on_key_down")({ key: "escape" }, w.hcx);
  assert.deepEqual(w.log, [
    ["setShared", "orca-header.drop", null],
    ["closeOverlay", "ov"],
    ["notify", "handler"],
  ]);
});

test("the drop overlay measures the strip from the layout when the record has no strip height", () => {
  const record = {
    tab: "a",
    zone: null,
    strip: { x: 0, y: 0, width: 100, height: 100, stripHeight: 0 },
  };
  const w = setup({
    props: { drop: true, overlay: "ov" },
    initProps: { drop: true },
    shared: { "orca-header.drop": record },
    layout: { children: [{ id: "tabs", size: { px: 40 } }] },
  });
  handler(byId(w.render(), "tab-drop"), "on_mouse_move")({ position: { x: 50, y: 30 } }, w.hcx);
  assert.equal(w.view.zone, null, "inside the layout's own strip height");
  handler(byId(w.render(), "tab-drop"), "on_mouse_move")({ position: { x: 50, y: 50 } }, w.hcx);
  assert.equal(w.view.zone, "up");
  const fallback = setup({
    props: { drop: true, overlay: "ov" },
    initProps: { drop: true },
    shared: { "orca-header.drop": record },
    layout: { children: [] },
  });
  handler(byId(fallback.render(), "tab-drop"), "on_mouse_move")(
    { position: { x: 50, y: 20 } },
    fallback.hcx,
  );
  assert.equal(fallback.view.zone, null);
  handler(byId(fallback.render(), "tab-drop"), "on_mouse_move")(
    { position: { x: 50, y: 40 } },
    fallback.hcx,
  );
  assert.equal(fallback.view.zone, "up", "the fallback strip is 32px tall");
});

test("the header's buttons act on the sidebar, the panel, the new-tab menu and the window", () => {
  const w = setup({
    window: { platform: "linux" },
    spaces: [{ id: "s1", active: true, tabs: [tab("a", { active: true, zoomed: true })] }],
    panes: [pane("p1", "a", { zoomed: true })],
    layout: {
      children: [
        { id: "left-sidebar", size: { px: 259 }, hidden: true },
        { id: "panel", size: { px: 350 }, hidden: true },
        { id: "main", active: "main-terminals" },
      ],
    },
  });
  const click = (id: string, e: Record<string, unknown> = {}) =>
    handler(byId(w.render(), id), "on_click")(e, w.hcx);
  assert.equal(
    byId(w.render(), "sidebar-toggle") !== undefined,
    true,
    "the header always draws the sidebar toggle",
  );
  w.log.length = 0;
  click("sidebar-toggle");
  assert.equal(w.view.wantToggle, 1, "a press is only counted; the next render runs the drawer");
  assert.deepEqual(w.runLog(), []);
  w.log.length = 0;
  click("panel-toggle");
  assert.equal(w.view.wantPanelToggle, 1);
  assert.deepEqual(w.runLog(), []);
  w.log.length = 0;
  click("titlebar-collapse");
  assert.deepEqual(w.runLog(), [["pane.zoom", { pane: "p1" }]]);
  w.log.length = 0;
  for (const id of ["minimize", "maximize", "close-window"]) click(id);
  assert.deepEqual(w.runLog(), [
    ["window.minimize", undefined],
    ["window.maximize", undefined],
    ["window.close", undefined],
  ]);
  w.log.length = 0;
  handler(
    byId(w.render(), "tab-new"),
    "on_mouse_down",
    "left",
  )({ bounds: { x: 100, y: 4, width: 28, height: 28 } }, w.hcx);
  assert.deepEqual(w.log, [["stop", "handler"]]);
  w.log.length = 0;
  click("tab-new");
  assert.deepEqual(w.log, [
    ["openOverlay", { mod: "orca-tab-dropdown", kind: "popup", frame: "none", width: 288, at: "pointer" }],
  ]);
  const pointer = viewport();
  w.log.length = 0;
  click("tab-new");
  assert.deepEqual(
    (w.log[0][1] as { at: unknown }).at,
    { x: 90, y: 36 },
    "centred under the plus (100 + 14 - 24)",
  );
  pointer.viewport_size = () => ({ width: 2000, height: 800 });
  w.view.plusBounds = { x: 900, y: 4, width: 28, height: 28 };
  assert.deepEqual(w.view.newMenuAt(), { x: 890, y: 36 });
  w.view.plusBounds = { x: 1990, y: 4, width: 28, height: 28 };
  assert.deepEqual(w.view.newMenuAt(), { x: 1704, y: 36 });
  w.host.window = { platform: "windows", maximized: true };
  assert.ok(byId(w.render(), "maximize"));
});

test("toggles only count a press, and the next render consumes it with a live context", () => {
  const w = setup({ window: { platform: "macos" } });
  const tree = w.render();
  w.log.length = 0;
  handler(byId(tree, "sidebar-toggle"), "on_click")({}, w.hcx);
  assert.equal(w.view.wantToggle, 1);
  assert.deepEqual(w.log, [["notify", "handler"]], "the press notifies through its own context");
  w.render();
  assert.equal(w.view.wantToggle, 0);
  assert.equal(w.view.drawers.sidebar.busy, true);
  assert.equal(
    w.tasks.length > 0 && w.tasks.every((task) => task.label === "render"),
    true,
    "the motion runs on the render's context",
  );
  w.tasks.length = 0;
  (w.layout.children as Layout[])[2].hidden = true;
  const panelTree = w.render();
  w.log.length = 0;
  handler(byId(panelTree, "panel-toggle"), "on_click")({}, w.hcx);
  assert.equal(w.view.wantPanelToggle, 1);
  assert.deepEqual(w.log, [["notify", "handler"]]);
  w.render();
  assert.equal(w.view.drawers.panel.busy, true);
  w.view.wantToggle = 2;
  w.view.drawers.sidebar.busy = false;
  w.tasks.length = 0;
  w.render();
  assert.equal(w.tasks.length, 0, "an even count cancels out");
});

test("the toggles run the drawers", () => {
  const native = setup({ props: { motion: "native" } });
  native.view.toggleSidebar(native.cx);
  native.view.togglePanel(native.cx);
  assert.equal(native.tasks.length, 2, "one task per drawer");
  assert.equal(native.view.drawers.sidebar.busy, true);
  assert.equal(native.view.drawers.panel.busy, true);
});

test("the smooth collapse steps the sidebar down, hides it and publishes", async () => {
  const w = setup();
  w.view.toggleSidebar(w.cx);
  assert.equal(w.view.drawers.sidebar.busy, true);
  assert.equal(w.view.drawers.sidebar.goal, 0);
  await w.runTasks();
  const resizes = w.calls("layout.resize").map((args) => (args as { px: number }).px);
  assert.deepEqual(
    resizes,
    [
      259, 258, 256, 252, 247, 241, 234, 226, 217, 207, 196, 185, 174, 162, 150, 137, 125, 112, 100,
      88, 77, 65, 55, 45, 35, 27, 19, 13, 8, 4, 1, 259,
    ],
  );
  assert.deepEqual(w.calls("layout.hide"), [{ id: "left-sidebar" }]);
  assert.deepEqual(w.log.filter(([kind]) => kind === "setShared").at(-1), [
    "setShared",
    "left-sidebar.collapsed",
    true,
  ]);
  assert.equal(w.view.drawers.sidebar.busy, false);
  assert.equal(w.view.drawers.sidebar.goal, undefined);
  assert.equal(notified(w, "handler") > 2, true);
  w.log.length = 0;
  w.view.toggleSidebar(w.cx);
  assert.equal(w.view.drawers.sidebar.goal, 1);
  await w.runTasks();
  assert.deepEqual(w.runLog().slice(0, 2), [
    ["layout.resize", { id: "left-sidebar", px: 1 }],
    ["layout.show", { id: "left-sidebar" }],
  ]);
  assert.deepEqual(w.runLog().at(-1), ["layout.resize", { id: "left-sidebar", px: 259 }]);
  assert.deepEqual(w.log.filter(([kind]) => kind === "setShared").at(-1), [
    "setShared",
    "left-sidebar.collapsed",
    false,
  ]);
});

test("a second sidebar press reverses the motion and a stale task stops quietly", async () => {
  const w = setup({ props: { motion: "layout", measureSidebar: true } });
  w.view.toggleSidebar(w.cx);
  w.view.toggleSidebar(w.cx);
  assert.equal(w.view.drawers.sidebar.goal, 1, "reversing from the collapse");
  const [stale, current] = w.tasks.splice(0) as [Task, Task];
  await stale.fn(w.hcx);
  assert.deepEqual(w.runLog(), [], "the first press was superseded before it did anything");
  await current.fn(w.hcx);
  assert.equal(w.view.drawers.sidebar.busy, false);
  const sampled = [...w.files].find(([path]) => path.startsWith("/tmp/sidebar-motion-")) as [
    string,
    string,
  ];
  assert.equal((JSON.parse(sampled[1]) as { motion: string }).motion, "layout");
  assert.equal((JSON.parse(sampled[1]) as { target: number }).target, 1);
});

test("a press during a late hide keeps the sidebar shown", async () => {
  const w = setup({
    layout: { children: [{ id: "left-sidebar", size: { px: 100 }, hidden: true }] },
  });
  w.view.toggleSidebar(w.cx);
  await w.runTasks();
  assert.deepEqual(w.runLog().slice(0, 3), [
    ["layout.resize", { id: "left-sidebar", px: 1 }],
    ["layout.show", { id: "left-sidebar" }],
    ["layout.resize", { id: "left-sidebar", px: 1 }],
  ]);
  assert.equal((w.layout.children as Layout[])[0].hidden, false);
});

test("the native pin is released only when no drawer is moving", () => {
  const w = setup();
  w.view.nativePinned = true;
  w.view.drawers.panel.busy = true;
  w.view.releaseNativePin();
  assert.deepEqual(w.runLog(), []);
  w.view.drawers.panel.busy = false;
  w.view.releaseNativePin();
  assert.deepEqual(w.runLog(), [["layout.resize", { id: "main", weight: 1 }]]);
  assert.equal(w.view.nativePinned, false);
  const env = w.view.drawerEnv();
  assert.equal(env.zoom(), 1);
  env.pin(500);
  assert.equal(w.view.nativePinned, true);
  assert.deepEqual(w.runLog().at(-1), ["layout.resize", { id: "main", px: 500 }]);
  assert.equal(w.view.drawers.sidebar.pin(0, false), null);
  w.view.nativeHeaderWidth = 800;
  assert.equal(w.view.drawers.panel.pin(100, false), 800 + 350 - 100 - 259);
  w.host.settings = { zoom: 2 };
  assert.equal(w.view.drawers.panel.pin(100, false), 400 + 350 - 100 - 259);
});

test("a remembered panel choice is restored per space and recorded when it changes", () => {
  const panel = (hidden: boolean) => ({ id: "panel", hidden });
  const enabled = ["files", "git"];
  const w = setup({ storage: { panels: '{"s1":"git","s2":null,"s3":"gone"}' } });
  w.log.length = 0;
  w.view.syncPanel({ id: "s1" }, panel(true), { active: "files" }, enabled);
  assert.deepEqual(w.runLog(), [
    ["layout.select", { stack: "panel-body", child: "git" }],
    ["layout.show", { id: "panel" }],
  ]);
  assert.equal(w.view.panels.s1, "git", "the old frame must not overwrite the saved choice");
  assert.ok(w.view.pending);
  w.log.length = 0;
  w.view.syncPanel({ id: "s1" }, panel(false), { active: "git" }, enabled);
  assert.equal(w.view.pending, null);
  assert.deepEqual(w.log, [], "arrival of the restored choice needs no storage write");
  w.view.syncPanel({ id: "s1" }, panel(false), { active: "files" }, enabled);
  assert.deepEqual(w.log, [["storage", "panels", '{"s1":"files","s2":null,"s3":"gone"}']]);
  w.log.length = 0;
  w.view.syncPanel({ id: "s1" }, panel(false), { active: "files" }, enabled);
  assert.deepEqual(w.log, [], "no change, no write");
  w.log.length = 0;
  w.view.syncPanel({ id: "s2" }, panel(false), { active: "files" }, enabled);
  assert.deepEqual(w.runLog(), [["layout.hide", { id: "panel" }]]);
  assert.equal(w.view.panels.s2, null, "pending hide must not remember the old visible tool");
  w.log.length = 0;
  w.view.syncPanel({ id: "s3" }, panel(true), { active: "files" }, enabled);
  assert.deepEqual(w.runLog(), [], "a tool that is not enabled keeps the layout's default");
  w.view.syncPanel({ id: "s3" }, panel(true), { active: "files" }, enabled);
  w.view.syncPanel({ id: "s5" }, panel(true), { active: "files" }, enabled);
  assert.equal(w.view.panels.s5, null, "a hidden panel is remembered as hidden");
  w.log.length = 0;
  w.view.syncPanel(null, panel(true), { active: "files" }, enabled);
  w.view.syncPanel({ id: "s5" }, null, { active: "files" }, enabled);
  assert.deepEqual(w.log, []);
});

test("the landing page shows exactly when the active space has no tab", () => {
  const w = setup({ spaces: [{ id: "s1", active: true, tabs: [] }] });
  w.log.length = 0;
  w.render();
  assert.deepEqual(w.calls("layout.select"), [{ stack: "main", child: "main-landing" }]);
  w.log.length = 0;
  w.render();
  assert.deepEqual(w.calls("layout.select"), [], "only a change selects");
  w.spaces[0].tabs.push(tab("a", { active: true }));
  w.log.length = 0;
  w.render();
  assert.deepEqual(w.calls("layout.select"), [{ stack: "main", child: "main-terminals" }]);
  const seeded = setup({
    spaces: [{ id: "s1", active: true, tabs: [tab("a", { active: true })] }],
    layout: { children: [{ id: "main", active: "main-landing" }] },
  });
  seeded.render();
  assert.deepEqual(seeded.calls("layout.select"), [{ stack: "main", child: "main-terminals" }]);
  const bare = setup({ layout: { children: [] } });
  bare.render();
  assert.deepEqual(
    bare.calls("layout.select"),
    [{ stack: "main", child: "main-terminals" }],
    "no layout node counts as none selected",
  );
});

test("a render with an idle layout resets the terminal width once", async () => {
  const w = setup();
  w.log.length = 0;
  w.render();
  w.render();
  assert.equal(w.tasks.length, 1);
  await w.runTasks();
  assert.deepEqual(
    w.runLog().filter(([command]) => command === "layout.resize"),
    [["layout.resize", { id: "main", weight: 1 }]],
  );
  assert.equal(w.view.nativeRecovering, false);
  w.view.drawers.sidebar.busy = true;
  w.tasks.length = 0;
  w.render();
  assert.equal(w.tasks.length, 0);
  const open = setup({
    logOpenPx: true,
    layout: {
      children: [
        { id: "left-sidebar", size: { px: 300 } },
        { id: "panel", size: { px: 410 } },
      ],
    },
  });
  open.render();
  open.render();
  assert.deepEqual(
    open.log.filter(([kind, key]) => kind === "setShared" && (key as string).endsWith(".openPx")),
    [
      ["setShared", "left-sidebar.openPx", 300],
      ["setShared", "panel.openPx", 410],
      ["setShared", "panel.openPx", 410],
    ],
  );
  assert.equal(open.view.drawers.sidebar.openPx, 300);
  assert.equal(open.view.drawers.panel.openPx, 410);
});

test("a dialog copy that was not told at init still takes focus when it first renders", () => {
  const w = setup();
  const confirmClose = { kind: "agent", tabId: "a" };
  hostState.props = () => ({ confirmClose, overlay: "ov" });
  w.log.length = 0;
  w.render();
  assert.deepEqual(w.log, [["focus", "render"]]);
  w.render();
  assert.deepEqual(w.log, [["focus", "render"]], "only the first render asks for focus");
});

test("a press that travels down over its own tab hands over and the tab stops reacting", () => {
  viewport();
  const w = setup({ panes: [pane("p1", "a"), pane("p2", "b"), pane("p3", "c")] });
  const slot = pillOf(w.render(), "tab-b");
  mouse(w, slot, "on_mouse_down", "left", event({ position: { x: 5, y: 10 } }));
  w.log.length = 0;
  mouse(
    w,
    pillOf(w.render(), "tab-b"),
    "on_mouse_move",
    undefined,
    event({ position: { x: 5, y: 40 } }),
  );
  assert.equal(w.view.pressed, null);
  assert.deepEqual(
    w.log.map(([kind]) => kind).filter((kind) => kind !== "notify"),
    ["setShared", "openOverlay", "setShared"],
  );
  assert.equal(traces(w, "handoff").length, 1);
});

test("a pending panel restore waits until the saved choice appears or the deadline expires", () => {
  const w = setup();
  const { view, clock } = w;
  view.space = "s1";
  view.panels.s1 = "changes";
  const sync = (active: string) =>
    view.syncPanel({ id: "s1" }, {}, { active }, ["files", "changes"]);
  view.pending = { want: "changes", until: clock + 1 };
  sync("files");
  assert.equal(view.panels.s1, "changes");
  sync("changes");
  assert.equal(view.pending, null);
  view.pending = { want: "changes", until: clock };
  sync("files");
  assert.equal(view.pending, null);
  assert.equal(view.panels.s1, "files");
});

test("a partial native drawer transition completes at the fallback deadline", async () => {
  const w = setup();
  const drawer = w.view.drawers.sidebar;
  const waits: number[] = [];
  const cx = {
    ...w.hcx,
    sleep: async (ms: number) => {
      waits.push(ms);
      if (ms === 120) drawer.size({ width: 100 }, w.hcx, w.view.drawerEnv());
    },
  } as AsyncContext;
  w.view.toggleSidebarNative(w.cx);
  await (w.tasks.shift() as Task).fn(cx);
  assert.deepEqual(waits, [1, 120, 650]);
  assert.deepEqual(w.calls("layout.resize"), [
    { id: "left-sidebar", px: 100 },
    { id: "left-sidebar", px: 1 },
  ]);
  await w.runTasks();
  assert.deepEqual(w.calls("layout.hide"), [{ id: "left-sidebar" }]);
});

test("the agent-settings command opens the settings page, and a second press returns to the app", async () => {
  const opened = setup({ commands: ["agent-settings"] });
  await assert.rejects(opened.loop?.fn(opened.hcx) as Promise<unknown>, (error) => error === END);
  assert.deepEqual(opened.view.settingsPageRequest, { page: "main-agents", sent: false });
  const returned = setup({
    commands: ["agent-settings"],
    layout: {
      children: [
        { id: "left-sidebar", size: { px: 259 } },
        { id: "main", size: { px: 900 }, active: "main-agents" },
      ],
    },
  });
  await assert.rejects(
    returned.loop?.fn(returned.hcx) as Promise<unknown>,
    (error) => error === END,
  );
  assert.deepEqual(returned.view.settingsPageRequest, { page: "main-terminals", sent: false });
});

test("the settings page shows the back and window controls off macOS, and both act", () => {
  const w = setup({
    window: { platform: "linux" },
    layout: {
      children: [
        { id: "left-sidebar", size: { px: 259 } },
        { id: "main", size: { px: 900 }, active: "main-agents" },
        { id: "panel", size: { px: 350 } },
      ],
    },
  });
  const tree = w.render();
  assert.ok(byId(tree, "minimize") && byId(tree, "maximize") && byId(tree, "close-window"));
  const back = byId(tree, "agent-settings-back") as RawNode;
  handler(back, "on_mouse_down", "left")({}, w.hcx);
  assert.deepEqual(w.log.at(-1), ["stop", "handler"]);
  handler(back, "on_click")({}, w.hcx);
  assert.deepEqual(w.view.settingsPageRequest, { page: "main-terminals", sent: false });
  w.log.length = 0;
  handler(byId(tree, "minimize"), "on_mouse_down", "left")({}, w.hcx);
  assert.deepEqual(w.log, [["stop", "handler"]]);
  for (const id of ["minimize", "maximize", "close-window"])
    handler(byId(tree, id), "on_click")({}, w.hcx);
  assert.deepEqual(w.runLog(), [
    ["window.minimize", undefined],
    ["window.maximize", undefined],
    ["window.close", undefined],
  ]);
  (w.layout.children as Layout[])[2].hidden = true;
  nodeOf(w.view.render(w.cx));
  const hiddenRail = w.render();
  assert.ok(byId(hiddenRail, "agent-settings-back"));
});

test("a settings page's rail width follows the panel's size, and a hidden panel gives no rail", () => {
  const w = setup({
    layout: {
      children: [
        { id: "left-sidebar", size: { px: 259 } },
        { id: "main", size: { px: 900 }, active: "main-agents" },
        { id: "panel", size: { px: 410 } },
      ],
    },
  });
  assert.equal(w.view.settingsPillPosition(), null, "no viewport measured yet");
  const pointer = viewport();
  pointer.viewport_size = () => ({ width: 800, height: 600 });
  assert.equal(w.view.settingsPillPosition(), 278, "the open rail takes its width from the strip");
  (w.layout.children as Layout[])[2].hidden = true;
  assert.equal(w.view.settingsPillPosition(), 344, "a hidden rail takes no width");
});

test("the native clocks and the pinned header measure through their own handlers", () => {
  const w = setup({ props: { motion: "native", pinSidebarTerminal: true } });
  const tree = w.render();
  handler(tree, "on_size_change")({ width: 640 }, w.hcx);
  assert.equal(w.view.nativeHeaderWidth, 640);
  handler(byId(tree, "sidebar-native-clock"), "on_size_change")({ width: 77 }, w.hcx);
  handler(byId(tree, "panel-native-clock"), "on_size_change")({ width: 50 }, w.hcx);
  assert.equal(
    w.view.drawers.sidebar.busy,
    false,
    "a clock reading with no motion changes nothing",
  );
  assert.equal(w.view.drawers.panel.busy, false);
});

test("a native motion that measures writes its samples, and a hidden node is shown while it grows", async () => {
  const w = setup({ props: { motion: "native", measureSidebar: true } });
  w.view.toggleSidebarNative(w.cx);
  await w.runTasks();
  assert.ok(
    [...w.files.keys()].some((path) => /^\/tmp\/left-sidebar-native-\d+\.json$/.test(path)),
  );
  const hidden = setup({
    layout: { children: [{ id: "left-sidebar", size: { px: 259 }, hidden: true }] },
  });
  Object.assign(hidden.view.drawers.sidebar, { busy: true, active: true, goal: 1, openPx: 259 });
  hidden.view.drawers.sidebar.size({ width: 100 }, hidden.hcx, hidden.view.drawerEnv());
  assert.deepEqual(hidden.calls("layout.show"), [{ id: "left-sidebar" }]);
});

test("a settings sidebar whose remembered width is unknown is released without moving", () => {
  const w = setup({
    shared: { "left-sidebar.settingsPrior": { px: null as never } },
    layout: {
      children: [
        { id: "left-sidebar", size: { px: 259 } },
        { id: "main", size: { px: 900 }, active: "main-terminals" },
      ],
    },
  });
  w.view.syncSettingsSidebar(w.cx, false);
  assert.deepEqual(w.log.filter(([kind]) => kind === "setShared").at(-1), [
    "setShared",
    "left-sidebar.settingsPrior",
    null,
  ]);
});

test("a panel or sidebar reporting a null width is not remembered as an open width", () => {
  const w = setup({
    layout: {
      children: [
        { id: "left-sidebar", size: { px: null as never } },
        { id: "main", size: { px: 900 }, active: "main-terminals" },
        { id: "panel", size: { px: null as never } },
      ],
    },
  });
  w.view.rememberPanelWidth({ size: { px: null as never } });
  w.view.syncSidebarToggle(w.cx, { size: { px: null as never } });
  assert.deepEqual(
    w.log.filter(([kind, key]) => kind === "setShared" && (key as string).endsWith(".openPx")),
    [],
  );
  assert.equal(w.view.drawers.panel.openPx, 0);
  assert.equal(w.view.drawers.sidebar.openPx, 0);
});

test("a zoom given as text divides the layout like a number, and a zero zoom reads as one", () => {
  for (const [zoom, gap] of [
    ["2", 18.5],
    [0, 148],
  ] as const) {
    const w = setup({ window: { platform: "macos", titlebar: "system" }, settings: { zoom } });
    const unified = byId(w.render(), "unified-gap") as RawNode;
    const width = unified.c.find(([key]) => key === "w") as [string, unknown[]];
    assert.deepEqual(width[1], [gap]);
  }
});

test("a window that has not published itself is seeded as null", () => {
  const w = setup({ window: null as never });
  assert.equal(w.view.windowState, null);
});

test("releasing a tab with no press recorded fails the way legacy does", () => {
  const w = setup();
  Object.assign(w.view, { pressed: undefined });
  const tab0 = tab("a", { active: true });
  assert.throws(() => w.view.releaseTab(tab0 as never, 0, [tab0] as never, w.hcx));
});
