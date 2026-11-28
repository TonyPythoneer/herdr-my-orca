import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type MenuClass from "../../../src/mods/orca-tab-dropdown/main.js";
import type { AgentRow } from "../../../src/mods/orca-tab-dropdown/rows.js";

type Fn = (...args: unknown[]) => unknown;
type Rec = { n: string; a: unknown[]; c: unknown[] };
type Pair = [string, Fn];
type Effects = unknown[][];
type Cx = {
  notify(): void;
  spawn(job: Job): void;
  focus_handle(): { focus(): void };
  timer: { after(ms: number, fn: () => void): void };
};
type Job = (cx: Cx) => unknown;
type Menu = InstanceType<typeof MenuClass>;
type Row = ReturnType<Menu["list"]>[number];
type Size = { width: number; height: number };
type Host = {
  spaces: Record<string, unknown>[];
  panes: Record<string, unknown>[];
  known: unknown;
  shared: Record<string, unknown>;
  files?: Record<string, unknown>;
  ls?: Record<string, string>;
  exec?: Record<string, unknown>;
  mac?: boolean;
  viewports?: Size[];
  viewport?: Size;
  checking?: boolean;
  picked?: string;
  typed?: string;
};
type World = {
  host: Host;
  effects: Effects;
  shared: Map<string, unknown>;
  ls: Map<string, string>;
  opened: number;
  inputHandlers: Record<string, Fn>;
  handlers: Pair[];
  input: {
    on(event: string, fn: Fn): void;
    value(): string;
    set_value(value: unknown): void;
    focus(): void;
  };
};
type Opened = {
  menu: Menu;
  cx: Cx;
  handlers: Pair[];
  jobs: Job[];
  timers: [number, () => void][];
  inputHandlers: Record<string, Fn>;
  shared: Map<string, unknown>;
};

const live = vi.hoisted(() => ({ world: null as World | null }));

const rig = vi.hoisted(() => {
  const current = (): World => {
    if (!live.world) throw new Error("no menu is running");
    return live.world;
  };
  const replacer = (k: string, v: unknown): unknown => {
    if (typeof v === "function") return "fn";
    if (k === "at" && typeof v === "number" && v > 1e12) return "<now>";
    return v;
  };
  const plain = (x: unknown): unknown => JSON.parse(JSON.stringify(x, replacer));
  const log = (name: string, ...args: unknown[]): void => {
    current().effects.push([name, ...(plain(args) as unknown[])]);
  };
  const fail = (value: unknown): unknown => {
    if (value instanceof Error) throw value;
    return value;
  };
  return { current, plain, log, fail };
});

const recorder = vi.hoisted(() => {
  const cleanse = (a: unknown): unknown => {
    const node = (a as { __node?: Rec } | null | undefined)?.__node;
    if (node) return node;
    if (Array.isArray(a)) return a.map(cleanse);
    if (typeof a === "function") return "fn";
    if (a && typeof a === "object")
      return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, cleanse(v)]));
    return a;
  };
  type El = { __node: Rec } & Record<string, (...args: unknown[]) => El>;
  const wired = new WeakMap<Rec, Map<string, Fn>>();
  const node = (name: string, args: unknown[]): El => {
    const rec: Rec = { n: name, a: args.map(cleanse), c: [] };
    const proxy: El = new Proxy({} as El, {
      get(_target, key) {
        if (key === "__node") return rec;
        if (typeof key === "symbol") return undefined;
        return (...values: unknown[]) => {
          if (key === "when") {
            if (values[0]) {
              const result = (values[1] as (builder: El) => unknown)(proxy);
              if (result !== proxy) rec.c.push(["when", cleanse(result)]);
            }
            return proxy;
          }
          if (key === "hover") {
            const inner = node("hover", []);
            (values[0] as (builder: El) => unknown)(inner);
            rec.c.push(["hover", inner.__node]);
            return proxy;
          }
          if (key.startsWith("on_")) {
            live.world?.handlers.push([key, values[0] as Fn]);
            const own = wired.get(rec) ?? new Map<string, Fn>();
            own.set(key, values[0] as Fn);
            wired.set(rec, own);
          }
          rec.c.push([key, values.map(cleanse)]);
          return proxy;
        };
      },
    });
    return proxy;
  };
  const el =
    (name: string) =>
    (...args: unknown[]) =>
      node(name, args);
  return { node, el, wired };
});

vi.mock("gpui-kit", () => ({
  View: class {},
  div: recorder.el("div"),
  svg: recorder.el("svg"),
  image: recorder.el("image"),
}));

vi.mock("gpui-base", () => ({
  v_flex: recorder.el("v_flex"),
  h_flex: recorder.el("h_flex"),
  InputState: { new: () => rig.current().input },
  Input: { new: (...args: unknown[]) => recorder.node("Input.new", args) },
  HoverCard: { new: (id: unknown) => recorder.node("HoverCard.new", [id]) },
}));

vi.mock("herdr", () => {
  const theme = {
    popover: "pop",
    foreground: "fg",
    selected: "sel",
    muted: "mu",
    dim: "dim",
    border: "bd",
    ring: "rg",
    input: "in",
    hover: "hv",
  };
  const keys = [{ section: "global", action: "orca-header.new-tab", keys: "ctrl-shift-t" }];
  const runExec = async (command: string, args?: string[]) => {
    const w = rig.current();
    rig.log("exec", command, args);
    const spec = w.host.exec ?? {};
    if (command === "zsh") {
      if (spec.freebuff === "throws") throw new Error("no zsh");
      return { code: spec.freebuff ? 0 : 1, stdout: "" };
    }
    const out = rig.fail(spec[command]);
    return { code: 0, stdout: typeof out === "string" ? out : "" };
  };
  return {
    checking: () => Boolean(rig.current().host.checking),
    theme: () => theme,
    spaces: () => rig.current().host.spaces,
    panes: () => rig.current().host.panes,
    props: () => ({ overlay: "menu" }),
    keys: () => keys,
    window: () => ({ platform: rig.current().host.mac ? "macos" : "linux" }),
    appHome: () => "/home/app",
    home: () => "/home",
    shared: (key: string) => rig.current().shared.get(key),
    setShared: (key: string, value: unknown) => {
      rig.current().shared.set(key, value);
      rig.log("setShared", key, value);
    },
    readTextFile: async (path: string) => rig.fail(rig.current().host.files?.[path]),
    exec: async (command: string, args?: string[]) => runExec(command, args),
    knownAgents: async (opts: unknown) => {
      rig.log("knownAgents", opts);
      return rig.fail(rig.current().host.known);
    },
    run: (...args: unknown[]) => rig.log("run", ...args),
    closeOverlay: (id: unknown) => rig.log("closeOverlay", id),
    openOverlay: (spec: unknown) => {
      rig.log("openOverlay", spec);
      return `pop${++rig.current().opened}`;
    },
    pickFolder: async (opts: unknown) => {
      rig.log("pickFolder", opts);
      return rig.current().host.picked === undefined ? "/picked" : rig.current().host.picked;
    },
  };
});

const GOLDEN = new URL("../../../mods/orca-tab-dropdown/menu.golden.json", import.meta.url);
const { plain } = rig;

const canon = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.map(canon);
  if (!x || typeof x !== "object") return x;
  const entries = x as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(entries)
      .sort()
      .map((k) => [k, canon(entries[k])]),
  );
};
const sha = (x: unknown): string =>
  createHash("sha1")
    .update(JSON.stringify(canon(x)))
    .digest("hex");
const digest = (x: unknown): string => sha(plain(x));
const summary = (got: Record<string, Record<string, unknown>>) =>
  Object.fromEntries(
    Object.entries(plain(got) as Record<string, Record<string, unknown>>).map(
      ([name, sections]) => [
        name,
        Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, sha(v)])),
      ],
    ),
  );

const NOW = Date.now();
const agent = (key: string, more: Record<string, unknown> = {}) => ({
  key,
  name: key[0].toUpperCase() + key.slice(1),
  installed: true,
  run: [key],
  icon: `/i/${key}.svg`,
  ...more,
});
const ALL = [
  "claude",
  "codex",
  "gemini",
  "grok",
  "omp",
  "antigravity",
  "kimi",
  "pi",
  "opencode",
  "notofficial",
].map((k) => agent(k, k === "kimi" ? { tint: true } : {}));
const space = (more: Record<string, unknown> = {}) => ({
  id: "s1",
  active: true,
  folder: "/repo",
  machine: null,
  ...more,
});
const OMP = JSON.stringify({
  models: [
    { selector: "p/a", name: "A" },
    { provider: "q", id: "b" },
    { id: "default" },
    null,
    { name: "x" },
  ],
});
const AGY = "fetching\nslug-a\tLabel A\nslug-b\t \n\nslug-c\tLabel C\n";

const HOSTS: Record<string, Host> = {
  "local, fresh inventory, freebuff on": {
    spaces: [space()],
    panes: [{ pane: "p1", focused: true, cwd: "/repo/sub" }],
    known: ALL.map((a) => ({ ...a, installed: a.key !== "grok" })),
    shared: {
      "agent-manager.inventory": {
        at: NOW,
        agents: ALL.map((a) => ({
          ...a,
          run: a.key === "claude" ? ["/c/claude", "--x"] : a.run,
        })),
        disabled: ["pi"],
        freebuff: true,
      },
    },
    exec: { omp: OMP, agy: AGY, freebuff: true },
    mac: true,
    viewports: [
      { width: 1200, height: 800 },
      { width: 700, height: 600 },
      { width: 330, height: 300 },
    ],
  },
  "local, probes only, manager file and overrides": {
    spaces: [space({ folder: undefined })],
    panes: [],
    known: ALL.slice(0, 7).map((a, i) => ({ ...a, installed: i !== 2 })),
    shared: {},
    files: {
      "/home/app/agent-manager.json": '{"disabled":["codex",3]}',
      "/home/app/programs.json": JSON.stringify({
        programs: {
          claude: { run: ["claude", "--prog"] },
          codex: { run: [] },
          kimi: { run: [1] },
        },
      }),
    },
    exec: { omp: "no json", agy: new Error("missing"), freebuff: true },
  },
  "local, programs.json is not json": {
    spaces: [space()],
    panes: [{ pane: "p1", cwd: "/w" }],
    known: ALL.slice(0, 3),
    shared: {},
    files: { "/home/app/programs.json": "{", "/home/app/agent-manager.json": "{" },
    exec: { freebuff: "throws" },
    ls: {
      "new-menu.models.v1": JSON.stringify({
        omp: { at: NOW, models: [{ id: "cached", label: "Cached" }] },
        antigravity: { at: 1, models: [{ id: "old", label: "Old" }] },
      }),
    },
  },
  "local, nothing installed, no freebuff": {
    spaces: [space()],
    panes: [],
    known: ALL.map((a) => ({ ...a, installed: false })),
    shared: {},
    exec: { freebuff: false },
  },
  "local, catalog fails": {
    spaces: [space()],
    panes: [],
    known: new Error("down"),
    shared: {},
    exec: { freebuff: false },
    files: { "/home/app/agent-manager.json": new Error("denied") },
  },
  "local, catalog fails after an inventory": {
    spaces: [space()],
    panes: [],
    known: new Error("down"),
    shared: {
      "agent-manager.inventory": {
        at: NOW,
        agents: [agent("claude")],
        disabled: [],
        freebuff: false,
      },
    },
    exec: { freebuff: false },
  },
  "remote machine": {
    spaces: [space({ machine: "m1" })],
    panes: [{ pane: "p1", focused: true }],
    known: ALL.slice(0, 4),
    shared: {
      "agent-manager.inventory": {
        at: NOW,
        agents: ALL,
        disabled: ["claude"],
        freebuff: true,
      },
    },
    exec: { freebuff: true },
    mac: false,
  },
  "checking, no space": {
    spaces: [],
    panes: [],
    known: ALL.slice(0, 2),
    shared: {},
    exec: {},
    checking: true,
  },
  "inventory says freebuff but manager disabled it": {
    spaces: [space()],
    panes: [],
    known: [],
    shared: {
      "agent-manager.inventory": {
        at: NOW,
        agents: [agent("claude")],
        disabled: ["freebuff"],
        freebuff: true,
      },
    },
    exec: { freebuff: true },
  },
};

const KEY_PRESSES = ["down", "up", "home", "end", "enter", "space", "escape", "x"].map((key) => ({
  key,
}));

function handler(list: Pair[], name: string): Fn {
  const found = list.find(([key]) => key === name);
  if (!found) throw new Error(`no ${name} handler`);
  return found[1];
}

function worldFor(host: Host, effects: Effects): World {
  const world: World = {
    host,
    effects,
    shared: new Map(Object.entries(host.shared)),
    ls: new Map(Object.entries(host.ls ?? {})),
    opened: 0,
    inputHandlers: {},
    handlers: [],
    input: {
      on: (event, fn) => {
        world.inputHandlers[event] = fn;
      },
      value: () => host.typed ?? "",
      set_value: (value) => rig.log("input.set_value", value),
      focus: () => rig.log("input.focus"),
    },
  };
  return world;
}

function stubBrowserGlobals(world: World): void {
  vi.stubGlobal("window", {
    viewport_size: () => world.host.viewport ?? { width: 1000, height: 700 },
  });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (world.ls.has(k) ? (world.ls.get(k) ?? null) : null),
    setItem: (k: string, v: string) => {
      world.ls.set(k, v);
      rig.log("localStorage.setItem", k, v.replace(/"at":\d+/g, '"at":"<now>"'));
    },
  });
}

async function start(host: Host, effects: Effects): Promise<Opened> {
  const world = worldFor(host, effects);
  live.world = world;
  stubBrowserGlobals(world);
  vi.resetModules();
  const { default: NewMenu } = await import("../../../src/mods/orca-tab-dropdown/main.js");
  const jobs: Job[] = [];
  const timers: [number, () => void][] = [];
  const cx: Cx = {
    notify: () => effects.push(["notify"]),
    spawn: (job) => jobs.push(job),
    focus_handle: () => ({
      focus() {
        effects.push(["focus"]);
      },
    }),
    timer: { after: (ms, fn) => timers.push([ms, fn]) },
  };
  return {
    menu: new NewMenu(),
    cx,
    handlers: world.handlers,
    jobs,
    timers,
    inputHandlers: world.inputHandlers,
    shared: world.shared,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function settle(w: Opened): Promise<void> {
  for (let round = 0; round < 4; round++) {
    for (const job of w.jobs.splice(0)) await job(w.cx);
    for (const [, fn] of w.timers.splice(0)) fn();
    await flush();
  }
}

async function opened(host: Host, effects: Effects = []): Promise<Opened> {
  const w = await start(host, effects);
  w.menu.init({}, w.cx as never);
  await settle(w);
  return w;
}

const treeOf = (value: unknown): Rec => (value as { __node: Rec }).__node;

const isNode = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && "n" in v && "c" in v;
const nodesIn = (v: unknown): Rec[] => {
  if (isNode(v)) return [v];
  if (Array.isArray(v)) return v.flatMap(nodesIn);
  if (typeof v === "object" && v !== null) return Object.values(v).flatMap(nodesIn);
  return [];
};
const childrenOf = (n: Rec): Rec[] => n.c.flatMap(nodesIn);
const allNodes = (n: Rec): Rec[] => [n, ...childrenOf(n).flatMap(allNodes)];
const attrOf = (n: Rec, key: string): unknown =>
  n.c.find((e): e is [string, unknown[]] => Array.isArray(e) && e[0] === key)?.[1][0];
const labelOf = (n: Rec): unknown => attrOf(n, "accessibility_label");
const renderedTree = (w: Opened): Rec => treeOf(w.menu.render());
const elementLabelled = (root: Rec, label: string): Rec | undefined =>
  allNodes(root).find((n) => labelOf(n) === label);
const containerOf = (root: Rec, label: string): Rec | undefined =>
  allNodes(root).find((n) => childrenOf(n).some((k) => labelOf(k) === label));
const handlerOf = (node: Rec | undefined, event: string): Fn | undefined =>
  node && recorder.wired.get(node)?.get(event);

const state = (menu: Menu) => ({
  at: menu.at,
  backAt: menu.backAt,
  picking: menu.picking?.key ?? null,
  models: menu.models,
  modelsFailed: menu.modelsFailed,
  filter: menu.filter,
  machine: menu.machine,
  agents: menu.agents?.map((a) => `${a.key}${a.installed ? "+" : "-"}${a.run?.join(" ")}`) ?? null,
  agentsFailed: menu.agentsFailed,
  disabled: [...menu.disabled].sort(),
  disabledReady: menu.disabledReady,
  freebuff: menu.freebuff,
});

const kindOf = (r: Row): string => {
  if (r.stay) return "stay";
  if (r.config) return `config:${r.config.key}`;
  return r.run ? "run" : "none";
};

const listOf = (menu: Menu) =>
  menu.list().map((r) => ({
    label: r.label,
    hint: r.hint,
    icon: r.icon,
    image: r.image,
    sep: r.sep,
    section: r.section,
    disabled: r.disabled,
    kind: kindOf(r),
    program: r.program?.key,
  }));

const view = (w: Opened): string => {
  w.handlers.length = 0;
  return digest(treeOf(w.menu.render()));
};

const rowEvent = (xPos: number, y: number) => ({
  position: { x: 300 + xPos, y: 100 + y },
  local_position: { x: xPos, y },
  bounds: { width: 272 },
});

function renderTrail(w: Opened): unknown[] {
  const render: unknown[] = [];
  for (const at of [0, 4, 99]) {
    w.menu.at = at;
    render.push([view(w), w.handlers.length]);
  }
  return render;
}

async function recordChoose(host: Host, count: number): Promise<unknown[]> {
  const choose: unknown[] = [];
  for (let i = 0; i <= count; i++) {
    const log: Effects = [];
    const x = await opened(host, log);
    log.length = 0;
    x.menu.choose(i, x.cx as never);
    await settle(x);
    choose.push([plain(log), state(x.menu), listOf(x.menu).length]);
  }
  return choose;
}

async function recordKeys(host: Host, count: number): Promise<unknown[]> {
  const keys: unknown[] = [];
  for (const press of KEY_PRESSES)
    for (const at of [0, count - 1]) {
      const log: Effects = [];
      const x = await opened(host, log);
      x.menu.at = Math.max(at, 0);
      view(x);
      log.length = 0;
      handler(x.handlers, "on_key_down")(press, x.cx);
      await settle(x);
      keys.push([press.key, at, plain(log), state(x.menu)]);
    }
  return keys;
}

async function recordWheel(host: Host): Promise<unknown[]> {
  const wheel: unknown[] = [];
  for (const dy of [0, 2, -2]) {
    const log: Effects = [];
    const x = await opened(host, log);
    view(x);
    log.length = 0;
    handler(x.handlers, "on_scroll_wheel")({ delta: { y: dy } }, x.cx);
    wheel.push([dy, plain(log), x.menu.at]);
  }
  return wheel;
}

async function recordPointer(host: Host): Promise<unknown[]> {
  const pointer: unknown[] = [];
  const px = await opened(host, []);
  view(px);
  const hovers = px.handlers.filter(([name]) => name === "on_hover");
  const moves = px.handlers.filter(([name]) => name === "on_mouse_move");
  const plog: Effects = [];
  px.cx.notify = () => plog.push(["notify"]);
  for (const [, fn] of hovers) {
    fn(false, px.cx);
    fn(true, px.cx);
    pointer.push(["hover", px.menu.at]);
  }
  px.menu.tipHot = "new-terminal";
  const tipOn = view(px);
  px.menu.tipHot = null;
  pointer.push(["tip", tipOn, view(px)]);
  for (const [, fn] of moves)
    for (const e of [{}, rowEvent(10, 5), rowEvent(250, 5)]) {
      plog.length = 0;
      fn(e, px.cx);
      await settle(px);
      pointer.push(["move", plain(plog), plain(px.menu.rowEdge ?? null)]);
    }
  return pointer;
}

async function recordFlyout(host: Host): Promise<unknown[]> {
  const flyout: unknown[] = [];
  for (const viewport of host.viewports ?? []) {
    const f = await opened({ ...host, viewport }, []);
    view(f);
    const trackers = f.handlers.filter(([name]) => name === "on_mouse_move");
    for (const [, fn] of trackers) fn(rowEvent(250, 20), f.cx);
    if (trackers.length) flyout.push([viewport, plain(f.menu.rowEdge ?? null)]);
  }
  return flyout;
}

async function recordClick(host: Host): Promise<unknown> {
  const clickLog: Effects = [];
  const y = await opened(host, clickLog);
  view(y);
  clickLog.length = 0;
  const clickFns = y.handlers.filter(([name]) => name === "on_click");
  if (clickFns.length) {
    clickFns[clickFns.length - 1][1]({}, y.cx);
    await settle(y);
  }
  return plain(clickLog);
}

async function pickerKeys(host: Host, i: number): Promise<unknown[]> {
  const pressed: unknown[] = [];
  for (const press of KEY_PRESSES) {
    const q = await opened(host, []);
    q.menu.choose(i, q.cx as never);
    await settle(q);
    view(q);
    handler(q.handlers, "on_key_down")(press, q.cx);
    await settle(q);
    pressed.push([press.key, state(q.menu)]);
  }
  return pressed;
}

async function pickerFor(host: Host, i: number): Promise<Record<string, unknown>> {
  const log2: Effects = [];
  const p = await opened(host, log2);
  p.menu.choose(i, p.cx as never);
  await settle(p);
  const steps: Record<string, unknown> = {
    after: [state(p.menu), listOf(p.menu), view(p), plain(log2)],
  };
  for (const typed of ["", "g", "zzz"]) {
    p.inputHandlers.change?.({}, p.cx);
    p.menu.filter = typed;
    p.menu.at = 0;
    steps[`filter ${typed}`] = [listOf(p.menu), view(p)];
  }
  p.menu.at = 1;
  p.inputHandlers.submit?.({}, p.cx);
  await settle(p);
  steps.submit = [plain(log2.slice(-4)), state(p.menu)];
  steps.keys = await pickerKeys(host, i);
  const r = await opened(host, []);
  r.menu.choose(i, r.cx as never);
  await settle(r);
  view(r);
  const rowClicks = r.handlers.filter(([name]) => name === "on_click");
  rowClicks[rowClicks.length - 1][1]({}, r.cx);
  steps.back = state(r.menu);
  return steps;
}

async function recordPicker(host: Host, w: Opened): Promise<Record<string, unknown>> {
  const picker: Record<string, unknown> = {};
  for (const [i, row] of listOf(w.menu).entries())
    if (row.kind === "stay") picker[row.label] = await pickerFor(host, i);
  return picker;
}

async function record(host: Host): Promise<Record<string, unknown>> {
  const effects: Effects = [];
  const w = await opened(host, effects);
  const out: Record<string, unknown> = {
    init: {
      effects: plain(effects),
      state: state(w.menu),
      shared: [...w.shared.entries()],
      state2: plain(w.menu.currentState()),
    },
    rows: listOf(w.menu),
    create: plain(w.menu.createRows().map((r) => ({ ...r, run: undefined }))),
    render: renderTrail(w),
  };
  const count = w.menu.list().length;
  out.choose = await recordChoose(host, count);
  out.keys = await recordKeys(host, count);
  out.wheel = await recordWheel(host);
  out.pointer = await recordPointer(host);
  out.flyout = await recordFlyout(host);
  out.click = await recordClick(host);
  out.picker = await recordPicker(host, w);
  return out;
}

test("every host records as before", async () => {
  const got: Record<string, Record<string, unknown>> = {};
  for (const [name, host] of Object.entries(HOSTS)) got[name] = await record(host);
  assert.deepEqual(summary(got), JSON.parse(readFileSync(GOLDEN, "utf8")));
});

test("the agent bar arrow steps one icon", async () => {
  const w = await opened(HOSTS["local, fresh inventory, freebuff on"], []);
  const arrow = handlerOf(elementLabelled(renderedTree(w), "More agents"), "on_click");
  assert.ok(arrow);
  arrow({}, w.cx);
  assert.equal(w.menu.agentAt, 1);
});

test("the agent bar scrolls its icon window with the wheel", async () => {
  const w = await opened(HOSTS["local, fresh inventory, freebuff on"], []);
  const scroll = handlerOf(containerOf(renderedTree(w), "More agents"), "on_scroll_wheel");
  assert.ok(scroll);
  const cx = { ...w.cx, stop_propagation() {} };
  w.menu.agentAt = 0;
  scroll({ delta: { y: 1 } }, cx);
  assert.equal(w.menu.agentAt, 1);
  scroll({ delta: { y: -1 } }, cx);
  assert.equal(w.menu.agentAt, 0);
});

test("New Terminal and FreeBuff use the light pointer tooltip and release it on leave", async () => {
  const w = await opened(HOSTS["local, fresh inventory, freebuff on"], []);
  for (const [tip, label, startAt] of [
    ["new-terminal", "New Terminal", 0],
    ["freebuff", "FreeBuff CLI", 99],
  ] as const) {
    w.menu.agentAt = startAt;
    w.menu.tipHot = tip;
    const lit = JSON.stringify(treeOf(w.menu.render()));
    assert.match(lit, new RegExp(label));
    assert.match(lit, /tip-arrow--orca-tab-dropdown\.svg/);
    assert.match(lit, /#f4f4f5/);
  }
  w.menu.tipHot = null;
  assert.doesNotMatch(JSON.stringify(treeOf(w.menu.render())), /tip-arrow--orca-tab-dropdown\.svg/);
});

test("crossing onto a non-agent action drops the open agent flyout", async () => {
  const log: Effects = [];
  const w = await opened(HOSTS["local, fresh inventory, freebuff on"], log);
  const claude = w.menu.agents?.find((a) => a.key === "claude");
  assert.ok(claude);
  w.menu.hoverConfig(claude, true, false);
  const move = handlerOf(elementLabelled(renderedTree(w), "New Terminal"), "on_mouse_move");
  assert.ok(move);
  move({ local_position: { x: 1, y: 1 }, bounds: {} }, w.cx);
  assert.equal(w.menu.hoverAgent, null);
  assert.deepEqual(plain(log.at(-1)), ["setShared", "orca-agent-flyout", null]);
});

test("the flyout opens through the orca-agent-flyout popup and swaps for another agent", async () => {
  const log: Effects = [];
  const w = await opened(HOSTS["local, fresh inventory, freebuff on"], log);
  const claude = w.menu.agents?.find((a) => a.key === "claude") as AgentRow;
  const codex = w.menu.agents?.find((a) => a.key === "codex") as AgentRow;
  w.menu.hoverConfig(claude, true, false);
  w.menu.hoverConfig(claude, true, false);
  w.menu.hoverConfig(codex, true, false);
  w.menu.hoverConfig(codex, false, false);
  w.menu.closeFlyout();
  assert.deepEqual(plain(log.filter((e) => e[0] === "closeOverlay" || e[0] === "setShared")), [
    ["setShared", "orca-agent-flyout", { id: "pop1", key: "claude" }],
    ["closeOverlay", "pop1"],
    ["setShared", "orca-agent-flyout", { id: "pop2", key: "codex" }],
    ["closeOverlay", "pop2"],
    ["setShared", "orca-agent-flyout", null],
  ]);
});
