import { it, vi } from "vite-plus/test";
import assert from "node:assert/strict";

type Call = [string, unknown[]];
type Node = { name: string; calls: Call[] };
type Handler = (...args: unknown[]) => unknown;
type LandingState = {
  handlers: Handler[];
  calls: unknown[];
  keys: Array<{ action: string; keys: string | number }> | undefined;
  spaces: Array<{ id: string }> | undefined;
  theme: Record<string, string | undefined>;
};
const state = vi.hoisted((): LandingState => ({
  handlers: [],
  calls: [],
  keys: [],
  spaces: [],
  theme: { foreground: "#ffffff", muted: "#888888", border: "#333333", canvas: "#000000" },
}));

const isHandler = (value: unknown): value is Handler => typeof value === "function";

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "calls" in value;

const isNodeKey = (target: Node, key: string): key is keyof Node => key in target;

function builder(name: string): Node {
  const node: Node = { name, calls: [] };
  const proxy: Node = new Proxy(node, {
    get(target, key: string | symbol) {
      if (typeof key === "symbol" || key === "toJSON") return undefined;
      if (isNodeKey(target, key)) return target[key];
      return (...values: unknown[]) => {
        target.calls.push([
          key,
          values.map((value) => (isHandler(value) ? state.handlers.push(value) - 1 : value)),
        ]);
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
}));
vi.mock("gpui-base", () => ({ v_flex: () => builder("v_flex"), h_flex: () => builder("h_flex") }));
vi.mock("herdr", () => ({
  theme: () => state.theme,
  run: (...args: unknown[]) => {
    state.calls.push(["run", ...args]);
  },
  openOverlay: (spec: unknown) => {
    state.calls.push(["open", spec]);
  },
  spaces: () => state.spaces,
  keys: () => state.keys,
}));

import Landing from "../../../src/mods/orca-landing/main";

function childValues([method, args]: Call): unknown[] {
  if (method === "child") return args;
  if (method === "children") return Array.isArray(args[0]) ? args[0] : [];
  return [];
}

function nodes(root: Node): Node[] {
  return [root, ...root.calls.flatMap(childValues).filter(isNode).flatMap(nodes)];
}

function treeOf(value: unknown): Node {
  assert.ok(isNode(value));
  return value;
}

function byId(tree: Node, id: string): Node {
  const node = nodes(tree).find((n) =>
    n.calls.some(([key, args]) => key === "id" && args[0] === id),
  );
  assert.ok(node, id);
  return node;
}

function argOf(node: Node, name: string): unknown {
  const call = node.calls.find(([method]) => method === name);
  assert.ok(call, name);
  return call[1][0];
}

function callback(node: Node, name: string): Handler {
  const call = node.calls.find(([method]) => method === name);
  assert.ok(call, name);
  const [index] = call[1];
  assert.ok(typeof index === "number", name);
  return state.handlers[index];
}

it("add project runs space.new and create workspace opens the new menu", () => {
  state.calls = [];
  const tree = treeOf(new Landing().render());
  callback(byId(tree, "landing-add"), "on_click")();
  callback(byId(tree, "landing-create"), "on_click")();
  assert.deepEqual(state.calls, [
    ["run", "space.new"],
    ["open", { mod: "orca-new-menu", kind: "popup", width: 288 }],
  ]);
});

it("renders shortcut caps in binding order with plus separators", () => {
  state.keys = [{ action: "space.new", keys: "Ctrl + Shift + N" }];
  state.spaces = [{ id: "s" }];
  const tree = treeOf(new Landing().render());
  const labels: string[] = [];
  const visit = (node: Node): void => {
    for (const [method, args] of node.calls) {
      if (method !== "child") continue;
      if (typeof args[0] === "string") labels.push(args[0]);
      else if (isNode(args[0])) visit(args[0]);
    }
  };
  visit(tree);
  assert.deepEqual(labels.slice(labels.lastIndexOf("Create workspace")), [
    "Create workspace",
    "Ctrl",
    "+",
    "Shift",
    "+",
    "N",
    "Move up workspace",
    "Move down workspace",
  ]);
});

it("passes theme tokens through unchanged when missing or not #-prefixed", () => {
  const previous = state.theme;
  state.theme = { foreground: "rgb(1, 2, 3)", muted: "", border: "transparent", canvas: undefined };
  state.spaces = [];
  const tree = treeOf(new Landing().render());
  state.theme = previous;
  assert.equal(argOf(byId(tree, "landing-add"), "border_color"), "transparent");
  assert.equal(argOf(byId(tree, "landing-add"), "text_color"), "rgb(1, 2, 3)");
  assert.equal(argOf(tree, "bg"), undefined);
  assert.ok(nodes(tree).some((n) => n.calls.some(([m, a]) => m === "text_color" && a[0] === "")));
});

it("treats missing keys and projects as empty, like legacy", () => {
  const previous = { keys: state.keys, spaces: state.spaces };
  state.keys = undefined;
  state.spaces = undefined;
  const tree = treeOf(new Landing().render());
  Object.assign(state, previous);
  assert.ok(
    nodes(tree).some((n) =>
      n.calls.some(([m, a]) => m === "child" && a[0] === "Add a project to get started."),
    ),
  );
  assert.ok(nodes(tree).every((n) => n.calls.every(([m, a]) => !(m === "child" && a[0] === "+"))));
});

it("button hover paints the legacy hover background", () => {
  const tree = treeOf(new Landing().render());
  const style = builder("style");
  callback(byId(tree, "landing-add"), "hover")(style);
  assert.equal(argOf(style, "bg"), "#f0f0f01f");
});
