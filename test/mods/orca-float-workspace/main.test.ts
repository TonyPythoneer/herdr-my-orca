import { it, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import type { Context } from "gpui-kit";

type Call = [string, unknown[]];
type Node = { name: string; calls: Call[] };
type Handler = (...args: unknown[]) => unknown;
type Branch = (el: Node) => Node;
const isHandler = (value: unknown): value is Handler => typeof value === "function";
const isBranch = (value: unknown): value is Branch => typeof value === "function";
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "calls" in value && "name" in value;
const asNode = (value: unknown): Node => {
  assert.ok(isNode(value));
  return value;
};
type TestState = {
  handlers: Handler[];
  log: unknown[][];
  agents: Array<Record<string, unknown>>;
  keys: Array<{ action: string; keys: string }>;
  spaces: Array<{ id: string; active?: boolean; folder?: string }>;
  viewport: { width: number; height: number };
  theme: Record<string, string>;
};
const state = vi.hoisted((): TestState => ({
  handlers: [],
  log: [],
  agents: [],
  keys: [],
  spaces: [],
  viewport: { width: 1400, height: 900 },
  theme: {},
}));

function builder(name: string): Node {
  const node: Node = { name, calls: [] };
  let proxy: Node;
  proxy = new Proxy(node, {
    get(target, key: string | symbol) {
      if (typeof key === "symbol" || key === "toJSON") return undefined;
      if (key === "name" || key === "calls") return target[key];
      return (...values: unknown[]) => {
        target.calls.push([
          String(key),
          values.map((value) => (isHandler(value) ? state.handlers.push(value) - 1 : value)),
        ]);
        if (key === "when") {
          const [condition, branch] = values;
          return condition && isBranch(branch) ? branch(proxy) : proxy;
        }
        return proxy;
      };
    },
  });
  return proxy;
}

vi.mock("gpui-kit", () => ({
  View: class {},
  div: () => builder("div"),
  svg: () => builder("svg"),
  image: () => builder("image"),
}));
vi.mock("gpui-base", () => ({ v_flex: () => builder("v_flex"), h_flex: () => builder("h_flex") }));
vi.mock("herdr", () => ({
  agents: () => state.agents,
  keys: () => state.keys,
  run: (...args: unknown[]) => {
    state.log.push(["run", ...args]);
  },
  theme: () => state.theme,
  nextCommand: () => new Promise(() => {}),
  setShared: (...args: unknown[]) => {
    state.log.push(["setShared", ...args]);
  },
  openOverlay: (...args: unknown[]) => {
    state.log.push(["open", ...args]);
  },
  spaces: () => state.spaces,
}));
vi.stubGlobal("window", { viewport_size: () => state.viewport });

import Workspace from "../../../src/mods/orca-float-workspace/main";

function childrenOf([method, args]: Call): unknown[] {
  if (method === "child") return args;
  const [first] = args;
  return method === "children" && Array.isArray(first) ? first : [];
}

function nodes(root: Node): Node[] {
  const children = root.calls.flatMap(childrenOf);
  return [
    root,
    ...children
      .filter((child): child is Node =>
        Boolean(child && typeof child === "object" && "calls" in child),
      )
      .flatMap(nodes),
  ];
}

function byId(tree: Node, id: string): Node {
  const node = nodes(tree).find((n) =>
    n.calls.some(([key, args]) => key === "id" && args[0] === id),
  );
  assert.ok(node, id);
  return node;
}

function click(node: Node, cx: Context): void {
  const call = node.calls.find(([key]) => key === "on_click");
  assert.ok(call);
  const [handler] = call[1];
  assert.ok(typeof handler === "number");
  state.handlers[handler]({}, cx);
}

let tick: ((tickCx: Context) => void) | undefined;

function setup(spaces: typeof state.spaces = []): {
  view: Workspace;
  cx: Context;
  log: unknown[][];
} {
  state.log = [];
  state.agents = [];
  state.keys = [];
  state.spaces = spaces;
  state.theme = {};
  const cx = {
    notify: () => state.log.push(["notify"]),
    spawn: () => {},
    timer: {
      every: (_ms: number, fn: (tickCx: Context) => void) => {
        tick = fn;
      },
    },
  } as unknown as Context;
  const view = new Workspace();
  view.init({}, cx);
  return { view, cx, log: state.log };
}

it("every control of an open panel does its one job and hides the panel where it should", () => {
  const { view, cx, log } = setup([{ id: "s1", active: true, folder: "/proj" }]);
  view.open = true;
  click(byId(asNode(view.render()), "orca-float-new"), cx);
  assert.deepEqual(log.splice(0), [
    ["run", "tab.new", { space: "s1", folder: "/proj" }],
    ["setShared", "orca-float-workspace.open", false],
    ["setShared", "orca-float-workspace.attention", false],
    ["notify"],
  ]);
  view.open = true;
  click(byId(asNode(view.render()), "orca-float-minimize"), cx);
  assert.equal(view.open, false);
  view.open = true;
  click(byId(asNode(view.render()), "orca-float-close"), cx);
  assert.equal(view.open, false);
  view.open = true;
  log.length = 0;
  click(byId(asNode(view.render()), "orca-float-start-agent"), cx);
  assert.deepEqual(log, [["open", { mod: "orca-tab-dropdown", kind: "popup", frame: "none", width: 288 }]]);
  assert.equal(view.open, true);
});

it("new terminal opens a bare tab without an active folder", () => {
  const none = setup([]);
  none.view.open = true;
  click(byId(asNode(none.view.render()), "orca-float-new"), none.cx);
  assert.deepEqual(none.log[0], ["run", "tab.new", {}]);
  const bare = setup([{ id: "s2", active: true }]);
  bare.view.open = true;
  click(byId(asNode(bare.view.render()), "orca-float-new"), bare.cx);
  assert.deepEqual(bare.log[0], ["run", "tab.new", { space: "s2" }]);
});

it("an agent row focuses that agent and a closed panel draws nothing", () => {
  const { view, cx, log } = setup();
  assert.deepEqual(asNode(view.render()).calls, []);
  view.open = true;
  state.agents = [
    {
      address: "t1",
      status: "idle",
      app: "codex",
      program: {},
      title: "",
      space_name: "",
      space: "",
      tab_name: "",
      tab_index: 0,
    },
  ];
  click(byId(asNode(view.render()), "float-agent-t1"), cx);
  assert.deepEqual(log.at(-1), ["run", "agent.focus", { terminal: "t1" }]);
  view.setOpen(true, cx);
  assert.equal(log.filter(([kind]) => kind === "notify").length, 0);
  view.setOpen(false);
  assert.equal(view.open, false);
});

it("publishing writes only a change in visibility or attention", () => {
  const { view, log } = setup();
  view.publish();
  assert.deepEqual(log.splice(0), [
    ["setShared", "orca-float-workspace.open", false],
    ["setShared", "orca-float-workspace.attention", false],
  ]);
  view.publish();
  assert.deepEqual(log, []);
  state.agents = [{ address: "a", status: "blocked" }];
  view.publish();
  assert.deepEqual(log, [
    ["setShared", "orca-float-workspace.open", false],
    ["setShared", "orca-float-workspace.attention", true],
  ]);
});

function colorArgs(root: Node, method: string): unknown[] {
  return nodes(root).flatMap((n) =>
    n.calls.filter(([key]) => key === method).map(([, args]) => args[0]),
  );
}

it("the poll timer publishes and repaints only when the agent list changes", () => {
  const { cx, log } = setup();
  assert.ok(tick);
  tick(cx);
  assert.deepEqual(log.splice(0), [
    ["setShared", "orca-float-workspace.open", false],
    ["setShared", "orca-float-workspace.attention", false],
  ]);
  tick(cx);
  assert.deepEqual(log, []);
  state.agents = [{ address: "a", status: "working" }];
  tick(cx);
  assert.deepEqual(log.splice(0), [["notify"]]);
  state.agents = [{ address: "a", status: "blocked" }];
  tick(cx);
  assert.deepEqual(log, [
    ["setShared", "orca-float-workspace.open", false],
    ["setShared", "orca-float-workspace.attention", true],
    ["notify"],
  ]);
});

it("each agent state draws its dot and each mark path draws its own mark", () => {
  const { view } = setup();
  view.open = true;
  state.agents = [
    { address: "w", status: "working", app: "claude", program: {}, title: "w" },
    { address: "b", status: "blocked", app: "aider", program: {}, title: "b" },
    { address: "d", status: "done", app: "omp", program: {}, title: "d" },
    { address: "p", status: "idle", app: "", program: { icon: "x.svg", tint: true }, title: "p" },
    { address: "n", status: "idle", app: "", program: { icon: "y.png", tint: false }, title: "n" },
    { address: "q", status: "idle", app: "", program: {}, title: "q" },
  ];
  const root = asNode(view.render());
  const kinds = (address: string): string[] =>
    nodes(byId(root, `float-agent-${address}`)).map((n) => n.name);
  assert.ok(kinds("w").includes("svg"));
  assert.ok(kinds("b").includes("svg"));
  assert.ok(kinds("d").includes("image"));
  assert.ok(kinds("p").includes("svg"));
  assert.ok(kinds("n").includes("image"));
  assert.ok(!kinds("q").includes("image"));
  assert.ok(!kinds("q").includes("svg"));
});

it("a theme token reaches the panel unchanged, even when missing or not #-prefixed", () => {
  const { view } = setup();
  state.theme = { foreground: "red", idle: "oklch(0.5 0 0)" };
  view.open = true;
  state.agents = [
    {
      address: "t1",
      status: "idle",
      app: "codex",
      program: {},
      title: "",
      space_name: "",
      space: "",
      tab_name: "",
      tab_index: 0,
    },
  ];
  const root = asNode(view.render());
  assert.ok(colorArgs(root, "text_color").includes("red"));
  assert.ok(colorArgs(root, "border_color").includes(undefined));
  assert.ok(colorArgs(root, "bg").includes("oklch(0.5 0 0)66"));
  assert.ok(colorArgs(root, "bg").includes("undefined99"));
  assert.ok(!colorArgs(root, "text_color").includes("#808080"));
});
