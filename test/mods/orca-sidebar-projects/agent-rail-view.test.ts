import { beforeEach, it, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { ScrollHandle } from "gpui-base";
import { handler, resetHost, type RecordedNode } from "../orca-diff/host.js";
import {
  railItem,
  railView,
  type ProviderRow,
  type RailOwner,
  type RailTheme,
} from "../../../src/mods/orca-sidebar-projects/agent-rail-view.js";
import type { RailRow } from "../../../src/mods/orca-sidebar-projects/agent-rail.js";

vi.mock("gpui-base", async (importOriginal) => {
  const { recordedElement } = await import("../../stubs/gpui-recording.js");
  return {
    ...(await importOriginal<typeof import("gpui-base")>()),
    ScrollHandle: { new: () => ({}) },
    Link: { new: (id: string) => recordedElement("Link", id) },
  };
});

const t: RailTheme = {
  accent: "#accent",
  blocked: "#blocked",
  border: "#border",
  dim: "#dim",
  done: "#done",
  foreground: "#foreground",
  hover: "#hover",
  muted: "#muted",
  raised: "#raised",
  ring: "#ring",
  surface: "#surface",
};

type Log = { selected: string[]; toggled: string[]; notified: number; stopped: number };

let log: Log;

const cx = () => ({
  notify: () => {
    log.notified += 1;
  },
  stop_propagation: () => {
    log.stopped += 1;
  },
});

const owner = (over: Partial<RailOwner> = {}): RailOwner => ({
  railHover: null,
  railSelection: "global",
  litellmEnabled: false,
  officialRailScroll: ScrollHandle.new(),
  unofficialRailScroll: ScrollHandle.new(),
  providerRailScroll: ScrollHandle.new(),
  selectRail: (key) => {
    log.selected.push(key);
  },
  toggleEnabled: (row) => {
    log.toggled.push(row.key);
  },
  ...over,
});

const fire = (id: string | undefined, key: string, ...args: unknown[]) => {
  const fn = handler(id, key);
  assert.ok(fn, `${key} on ${id}`);
  return fn(...args);
};

const asNode = (value: unknown): unknown => (value as { __node?: unknown } | null)?.__node ?? value;

const isNode = (value: unknown): value is RecordedNode =>
  typeof value === "object" && value !== null && "n" in value && "c" in value;

const nodesIn = (value: unknown): RecordedNode[] => {
  if (Array.isArray(value)) return value.flatMap(nodesIn);
  const node = asNode(value);
  if (!isNode(node)) return [];
  return [node, ...node.c.flatMap(([, args]) => nodesIn(args))];
};

const idOf = (node: RecordedNode): string | undefined => {
  const id = node.c.find(([name]) => name === "id")?.[1][0];
  return typeof id === "string" ? id : undefined;
};

const ids = (value: unknown): string[] =>
  nodesIn(value)
    .map(idOf)
    .filter((id): id is string => id !== undefined);

const hasCall = (value: unknown, method: string, arg?: unknown): boolean =>
  nodesIn(value).some((node) =>
    node.c.some(([name, args]) => name === method && (arg === undefined || args[0] === arg)),
  );

const labelOf = (value: unknown, id: string): unknown => {
  const node = nodesIn(value).find((candidate) => idOf(candidate) === id);
  assert.ok(node, id);
  return node.c.find(([name]) => name === "accessibility_label")?.[1][0];
};

const agents: RailRow[] = [
  { key: "codex", name: "Codex", installed: false, homepage: "https://example.com/codex" },
  { key: "claude", name: "Claude", installed: true, enabled: true },
];
const unofficial: RailRow[] = [
  {
    key: "freebuff",
    name: "FreeBuff CLI",
    icon: "mods/orca-assets/freebuff--orca-tab-dropdown.png",
    installed: false,
    enabled: false,
  },
];

beforeEach(() => {
  resetHost();
  log = { selected: [], toggled: [], notified: 0, stopped: 0 };
});

it("the rail lists Global, then installed agents, then missing agents in each group", () => {
  const view = railView(owner(), [...agents], unofficial, [], t);
  const order = ids(view);
  const at = (id: string) => order.indexOf(id);
  assert.ok(at("am-rail-select-global") < at("am-rail-select-claude"));
  assert.ok(at("am-rail-select-claude") < at("am-rail-select-codex"));
  assert.ok(at("am-rail-select-codex") < at("am-rail-select-freebuff"));
  assert.ok(at("am-rail-select-provider-add") > at("am-rail-select-freebuff"));
});

it("a group caps at five and a half rows and scrolls only when it overflows", () => {
  const many: RailRow[] = Array.from({ length: 6 }, (_, i) => ({
    key: `agent${i}`,
    name: `Agent ${i}`,
    installed: true,
    enabled: true,
  }));
  const overflowing = railView(owner(), many, [], [], t);
  assert.ok(hasCall(overflowing, "overflow_y_scroll"));
  assert.ok(hasCall(overflowing, "h", 330));
  const fitting = railView(owner(), many.slice(0, 2), [], [], t);
  assert.ok(!hasCall(fitting, "overflow_y_scroll"));
  assert.ok(hasCall(fitting, "h", 120));
});

it("a closed group folds its list and labels its folder to expand", () => {
  const view = railView(owner({ officialRailOpen: false }), agents, [], [], t);
  assert.equal(labelOf(view, "am-rail-folder-official"), "Expand Official");
  assert.equal(labelOf(view, "am-rail-folder-unofficial"), "Collapse Unofficial");
  assert.ok(hasCall(view, "h", 0));
});

it("clicking a folder flips its open state and asks for a redraw", () => {
  const state = owner();
  railView(state, agents, unofficial, [], t);
  fire("am-rail-folder-official", "on_click", undefined, cx());
  assert.equal(state.officialRailOpen, false);
  fire("am-rail-folder-unofficial", "on_click", undefined, cx());
  assert.equal(state.unofficialRailOpen, false);
  fire("am-rail-folder-model-providers", "on_click", undefined, cx());
  assert.equal(state.providerRailOpen, false);
  assert.equal(log.notified, 3);
});

it("a provider group lists each provider with its health, icon and an add tile", () => {
  const providers: ProviderRow[] = [
    { id: "p1", name: "Acme", health: "healthy", iconPath: "/home/icons/acme.png" },
    { id: "p2", name: "", health: "checking", iconPath: "mods/orca-assets/p2.png" },
    { id: "p3", health: "unhealthy" },
    { id: "p4", health: "surprising" },
    { id: "p5", health: null },
  ];
  const view = railView(owner({ litellmEnabled: true }), [], [], providers, t);
  assert.equal(labelOf(view, "am-rail-select-provider:p1"), "Acme · Healthy");
  assert.equal(labelOf(view, "am-rail-select-provider:p2"), "Model provider · Checking");
  assert.equal(labelOf(view, "am-rail-select-provider:p3"), "Model provider · Unhealthy");
  assert.equal(labelOf(view, "am-rail-select-provider:p4"), "Model provider · Not checked");
  assert.equal(labelOf(view, "am-rail-select-provider:p5"), "Model provider · Not checked");
  assert.equal(labelOf(view, "am-rail-select-provider-add"), "Add model provider");
  assert.ok(hasCall(view, "bg", "#done"));
  assert.ok(hasCall(view, "bg", "#blocked"));
  assert.ok(nodesIn(view).some((n) => n.n === "image" && n.a[0] === "icons/acme.png"));
  assert.ok(nodesIn(view).some((n) => n.n === "image" && n.a[0] === "mods/orca-assets/p2.png"));
  assert.ok(
    nodesIn(view).some((n) => n.n === "svg" && n.a[0] === "mods/orca-assets/hard-drive.svg"),
  );
  assert.ok(hasCall(view, "right", 2));
  assert.ok(hasCall(view, "bottom", 2));
});

it("agent tiles and the Global gear select their agent through their handlers", () => {
  railItem(owner(), { key: "global" }, t);
  fire(undefined, "on_click", undefined, cx());
  railItem(owner(), agents[1], t);
  fire("am-rail-select-claude", "on_click", undefined, cx());
  assert.deepEqual(log.selected, ["global", "claude"]);
});

it("provider rows select themselves and the add tile through their handlers", () => {
  railView(owner(), [], [], [{ id: "p1", name: "Acme" }], t);
  fire("am-rail-select-provider:p1", "on_click", undefined, cx());
  fire("am-rail-select-provider-add", "on_click", undefined, cx());
  assert.deepEqual(log.selected, ["provider:p1", "provider:add"]);
});

it("hover tracks one row at a time and ignores a leave from a row that is not hovered", () => {
  const state = owner();
  railView(state, agents, [], [{ id: "p1" }], t);
  fire("am-rail-claude", "on_hover", true, cx());
  assert.equal(state.railHover, "claude");
  assert.equal(log.notified, 1);
  fire("am-rail-claude", "on_hover", true, cx());
  assert.equal(log.notified, 1);
  fire("am-rail-codex", "on_hover", false, cx());
  assert.equal(state.railHover, "claude");
  assert.equal(log.notified, 1);
  fire("am-rail-claude", "on_hover", false, cx());
  assert.equal(state.railHover, null);
  assert.equal(log.notified, 2);
  fire("am-rail-provider:p1", "on_hover", true, cx());
  assert.equal(state.railHover, "provider:p1");
});

it("the switch reports its own hover, toggles the agent and stops the click", () => {
  const state = owner();
  railItem(state, agents[1], t);
  fire("am-rail-toggle-claude", "on_hover", true, cx());
  assert.equal(state.railControlHover, "claude");
  fire("am-rail-toggle-claude", "on_hover", true, cx());
  assert.equal(log.notified, 1);
  fire("am-rail-toggle-claude", "on_hover", false, cx());
  assert.equal(state.railControlHover, null);
  fire("am-rail-toggle-claude", "on_click", undefined, cx());
  assert.deepEqual(log.toggled, ["claude"]);
  assert.equal(log.stopped, 1);
});

it("an install control without a homepage selects its agent and stops the click", () => {
  railItem(owner(), { key: "freebuff", name: "FreeBuff CLI", installed: false }, t);
  fire("am-rail-install-freebuff", "on_click", undefined, cx());
  assert.deepEqual(log.selected, ["freebuff"]);
  assert.equal(log.stopped, 1);
});

it("an install control with a homepage links to it and reports its hover", () => {
  const state = owner();
  const view = railItem(state, agents[0], t);
  assert.ok(nodesIn(view).some((n) => n.n === "Link" && n.a[0] === "am-rail-install-codex"));
  assert.ok(hasCall(view, "href", "https://example.com/codex"));
  fire(undefined, "on_hover", true, cx());
  assert.equal(state.railControlHover, "codex");
});

it("a row without an installed flag draws no control", () => {
  const view = railItem(owner(), { key: "unknown", name: "Unknown" }, t);
  assert.ok(!hasCall(view, "role", "switch"));
  assert.ok(!ids(view).some((id) => id.startsWith("am-rail-install-")));
});

it("an installed row with a tint draws its icon as an svg and an uninstalled one dims", () => {
  const tinted = railItem(
    owner(),
    { key: "tinted", name: "Tinted", installed: true, icon: "mods/orca-assets/t.svg", tint: true },
    t,
  );
  assert.ok(nodesIn(tinted).some((n) => n.n === "svg" && n.a[0] === "mods/orca-assets/t.svg"));
  const dim = railItem(owner(), { key: "dim", name: "Dim", installed: false }, t);
  assert.ok(hasCall(dim, "opacity", 0.45));
  const plain = railItem(owner(), { key: "plain", name: "plain", installed: true }, t);
  assert.ok(hasCall(plain, "child", "P"));
});

it("the Global row never shows the LiteLLM badge; non-global rows show it when enabled", () => {
  const off = railItem(owner(), { key: "global" }, t);
  assert.ok(!hasCall(off, "tooltip", "LiteLLM enabled"));
  const on = railItem(owner({ litellmEnabled: true }), { key: "global" }, t);
  assert.ok(!hasCall(on, "tooltip", "LiteLLM enabled"));
  const agentOff = railItem(owner(), { key: "codex", name: "Codex" }, t);
  assert.ok(!hasCall(agentOff, "tooltip", "LiteLLM enabled"));
  const agentOn = railItem(owner({ litellmEnabled: true }), { key: "codex", name: "Codex" }, t);
  assert.ok(
    nodesIn(agentOn).some((n) =>
      n.c.some(([name, args]) => name === "tooltip" && args[0] === "LiteLLM enabled"),
    ),
  );
});

it("the agent availability switch hit target matches the rendered track", () => {
  const view = railView(owner(), agents, [], [], t);
  const root = nodesIn(view).find((node) => idOf(node) === "am-rail-toggle-claude");
  assert.ok(root);
  const dimension = (node: RecordedNode, name: string) => node.c.find(([method]) => method === name)?.[1][0];
  assert.equal(dimension(root, "w"), 27);
  assert.equal(dimension(root, "h"), 17);
  assert.equal(dimension(root, "top"), 38);
  const track = nodesIn(root).find((node) => node !== root && dimension(node, "w") === 27 && dimension(node, "h") === 17);
  assert.ok(track);
});
