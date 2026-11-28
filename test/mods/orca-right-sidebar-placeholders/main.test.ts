import { beforeEach, it, vi } from "vite-plus/test";
import assert from "node:assert/strict";

const state = vi.hoisted(
  (): {
    tab: string | undefined;
    props?: () => unknown;
    muted: string;
    foreground: string;
  } => ({
    tab: "checks",
    muted: "#111111",
    foreground: "#222222",
  }),
);

vi.mock("herdr", () => ({
  props: () => (state.props ? state.props() : { tab: state.tab }),
  theme: () => ({ muted: state.muted, foreground: state.foreground, surface: "#333333" }),
  shared: () => 0,
  layout: () => null,
}));

vi.mock("gpui-kit", () => ({
  View: class {},
  div: () => builder("div"),
  svg: (path: string) => builder("svg", path),
}));

vi.mock("gpui-base", () => ({ v_flex: () => builder("v_flex") }));

type Call = [string, unknown[]];
type Node = { name: string; args: unknown[]; calls: Call[] };

function builder(name: string, ...args: unknown[]): Node {
  const node: Node = { name, args, calls: [] };
  const proxy: Node = new Proxy(node, {
    get(target, key) {
      if (typeof key === "symbol" || key === "toJSON") return undefined;
      if (key in target) return Reflect.get(target, key);
      return (...values: unknown[]) => {
        target.calls.push([key, values]);
        return proxy;
      };
    },
  });
  return proxy;
}

import PanelGap from "../../../src/mods/orca-right-sidebar-placeholders/main.js";

const ASSET_PREFIX = "mods/orca-assets/";
const SUFFIX = "--orca-right-sidebar-placeholders.svg";
const WORKFLOW_ICON = `workflow${SUFFIX}`;
const LIST_CHECKS_ICON = `list-checks${SUFFIX}`;
const PLUG_ICON = `plug${SUFFIX}`;
const NO_INTEGRATION = "Herdr has no GitHub or GitLab integration";
const LEGACY_UNDEFINED_ICON = "mods/orca-assets/undefined.svg";

const cases = [
  ["workspaces", "Attached worktrees", WORKFLOW_ICON, "Herdr has no folder-workspace model"],
  ["pr-checks", "PR Checks", LIST_CHECKS_ICON, NO_INTEGRATION],
  ["checks", "Checks", LIST_CHECKS_ICON, NO_INTEGRATION],
  ["ports", "Ports", PLUG_ICON, "Herdr exposes no port API"],
] as const;

function renderTree(): Node {
  return new PanelGap().renderBody() as unknown as Node;
}

function childNodes(node: Node): Node[] {
  return node.calls.filter(([key]) => key === "child").map(([, values]) => values[0] as Node);
}

function argsOf(node: Node, name: string): unknown[] {
  const call = node.calls.find(([key]) => key === name);
  assert.ok(call, name);
  return call[1];
}

beforeEach(() => {
  state.tab = "checks";
  state.props = undefined;
  state.muted = "#111111";
  state.foreground = "#222222";
});

it("renders the right explanation and mod-local icon for each placeholder tab", () => {
  for (const [tab, title, icon, body] of cases) {
    state.tab = tab;
    const output = JSON.stringify(new PanelGap().renderBody());
    assert.ok(output.includes(title), tab);
    assert.ok(output.includes(body), tab);
    assert.ok(output.includes(`${ASSET_PREFIX}${icon}`), tab);
    assert.ok(output.includes(`gap-${tab}`), tab);
  }
});

it("uses the Checks placeholder for an unknown or missing tab", () => {
  for (const tab of ["unknown", undefined]) {
    state.tab = tab;
    const output = JSON.stringify(new PanelGap().renderBody());
    assert.ok(output.includes("Checks"));
    assert.ok(output.includes(`${ASSET_PREFIX}${LIST_CHECKS_ICON}`));
    assert.ok(output.includes(tab === "unknown" ? "gap-unknown" : "gap-checks"));
  }
});

it("passes the placeholder body through the idle panel frame", () => {
  state.tab = "checks";
  assert.ok(JSON.stringify(new PanelGap().render()).includes("Checks"));
});

it("uses the Checks placeholder when props carry no usable tab", () => {
  for (const raw of [null, undefined, "checks", {}]) {
    state.props = () => raw;
    const output = JSON.stringify(new PanelGap().renderBody());
    assert.ok(output.includes("gap-checks"));
    assert.ok(output.includes("Checks"));
  }
});

it("passes theme colors through unchanged, even when they are not hex values", () => {
  state.muted = "rgb(17, 17, 17)";
  state.foreground = "transparent";
  const tree = renderTree();
  assert.deepEqual(argsOf(tree, "text_color"), ["rgb(17, 17, 17)"]);
  assert.deepEqual(argsOf(childNodes(tree)[1], "text_color"), ["transparent"]);
});

it("resolves prototype-named tabs to the legacy undefined gap instead of Checks", () => {
  for (const tab of ["constructor", "toString", "__proto__"]) {
    state.tab = tab;
    const tree = renderTree();
    const [iconRow, titleRow, bodyRow] = childNodes(tree);
    assert.deepEqual(argsOf(tree, "id"), [`gap-${tab}`]);
    assert.deepEqual(childNodes(iconRow)[0].args, [LEGACY_UNDEFINED_ICON]);
    assert.deepEqual(argsOf(titleRow, "child"), [undefined]);
    assert.deepEqual(argsOf(bodyRow, "child"), [undefined]);
  }
});
