import { it, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import type { Context } from "gpui-kit";

type Call = [string, unknown[]];
type Node = { name: string; calls: Call[] };
type Handler = (...args: unknown[]) => unknown;
type State = { handlers: Handler[]; props: unknown; calls: unknown[] };

const state = vi.hoisted((): State => ({
  handlers: [],
  props: undefined,
  calls: [],
}));

const isHandler = (value: unknown): value is Handler => typeof value === "function";
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "name" in value && "calls" in value;
const asNode = (value: unknown): Node => {
  assert.ok(isNode(value));
  return value;
};

function builder(name: string): Node {
  const node: Node = { name, calls: [] };
  const proxy: Node = new Proxy(node, {
    get(target, key: string | symbol) {
      if (typeof key === "symbol" || key === "toJSON") return undefined;
      if (key === "name" || key === "calls") return target[key];
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

vi.mock("gpui-kit", () => ({ View: class {}, div: () => builder("div") }));
vi.mock("gpui-base", () => ({ v_flex: () => builder("v_flex"), h_flex: () => builder("h_flex") }));
vi.mock("herdr", () => ({
  props: () => state.props,
  theme: () => ({}),
  closeOverlay: (id?: string) => {
    state.calls.push(["close", id]);
  },
  run: (...args: unknown[]) => {
    state.calls.push(["run", ...args]);
  },
  setShared: (...args: unknown[]) => {
    state.calls.push(["publish", ...args]);
  },
}));

import Confirm from "../../../src/mods/orca-confirm/main";

function callback(node: Node, name: string): Handler {
  const call = node.calls.find(([method]) => method === name);
  assert.ok(call, name);
  const index = call[1][0];
  assert.ok(typeof index === "number", name);
  return state.handlers[index];
}

it("dialog focuses, confirms in order, cancels, and consumes only Enter and Escape", () => {
  state.handlers.length = 0;
  state.calls = [];
  state.props = {
    overlay: "dialog",
    command: { name: "delete" },
    confirmShared: { key: "target", value: "a" },
  };
  const view = new Confirm();
  view.init({}, {
    focus_handle: () => ({
      focus: () => {
        state.calls.push("focus");
      },
    }),
  } as Context);
  assert.deepEqual(state.calls.splice(0), ["focus"]);
  const root = asNode(view.render({} as Context));
  const keyDown = callback(root, "on_key_down");
  const press = (key: string): void => {
    keyDown({ key }, { stop_propagation: () => state.calls.push("stop") });
  };
  press("a");
  assert.deepEqual(state.calls, []);
  press("escape");
  assert.deepEqual(state.calls.splice(0), [["close", "dialog"], "stop"]);
  const confirmed = [
    ["publish", "target", "a"],
    ["close", "dialog"],
    ["run", "delete", {}],
  ];
  press("enter");
  assert.deepEqual(state.calls.splice(0), [...confirmed, "stop"]);
  assert.deepEqual(
    root.calls.find(([name]) => name === "bg"),
    ["bg", [undefined]],
  );
  const actions = asNode(root.calls.filter(([name]) => name === "child").at(-1)?.[1][0]);
  const buttons = actions.calls
    .filter(([name]) => name === "child")
    .map(([, [button]]) => asNode(button));
  const [cancelButton, confirmButton] = buttons;
  assert.deepEqual(
    cancelButton.calls.find(([name]) => name === "border_color"),
    ["border_color", [undefined]],
  );
  assert.deepEqual(
    confirmButton.calls.find(([name]) => name === "bg"),
    ["bg", [undefined]],
  );
  const clicks = buttons.map((button) => callback(button, "on_click"));
  clicks[0]();
  assert.deepEqual(state.calls.splice(0), [["close", "dialog"]]);
  clicks[1]();
  assert.deepEqual(state.calls, confirmed);
});
