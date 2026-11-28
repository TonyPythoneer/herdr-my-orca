import { afterEach, beforeEach, it, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { ScrollHandle } from "gpui-base";
import { nodeOf, resetHost, type RecordedNode } from "../orca-diff/host.js";
import {
  agentRailOwner,
  agentSettingsOpen,
  leftSidebarAgentRail,
} from "../../../src/mods/orca-sidebar-projects/left-sidebar-agents.js";
import {
  railItem,
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

type TestGlobal = typeof globalThis & {
  __herdrShared?: (key: string) => unknown;
  __herdrSetShared?: (key: string, value: unknown) => void;
  __herdrLayout?: () => unknown;
};

const host = globalThis as TestGlobal;

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

const inventory: { agents: RailRow[]; unofficial: RailRow[] } = {
  agents: [
    { key: "codex", name: "Codex", installed: false },
    { key: "claude", name: "Claude", installed: true, enabled: true },
  ],
  unofficial: [
    {
      key: "freebuff",
      name: "FreeBuff CLI",
      icon: "mods/orca-assets/freebuff--orca-tab-dropdown.png",
      installed: true,
      enabled: false,
    },
  ],
};

const rail = (over: Partial<RailOwner> = {}): RailOwner => ({
  railHover: null,
  railSelection: "global",
  litellmEnabled: false,
  officialRailScroll: ScrollHandle.new(),
  unofficialRailScroll: ScrollHandle.new(),
  providerRailScroll: ScrollHandle.new(),
  selectRail: () => {},
  toggleEnabled: () => {},
  ...over,
});

const childrenOf = (node: RecordedNode): RecordedNode[] =>
  node.c.filter(([name]) => name === "child").map(([, args]) => args[0] as RecordedNode);

const draw = (values: Record<string, unknown>) => {
  host.__herdrShared = (key) => values[key];
  return JSON.stringify(nodeOf(leftSidebarAgentRail({ agentRail: agentRailOwner() }, t)));
};

beforeEach(() => {
  resetHost();
});

afterEach(() => {
  delete host.__herdrShared;
  delete host.__herdrSetShared;
  delete host.__herdrLayout;
});

it("the rail replaces Projects only while the agent settings page is the active main page", () => {
  const tree = (active: string | undefined) => ({
    children: [{ id: "left-sidebar" }, { id: "main", active }],
  });
  host.__herdrLayout = () => tree("main-agents");
  assert.equal(agentSettingsOpen(), true);
  for (const other of ["main-terminals", "main-providers", "page-tasks", undefined]) {
    host.__herdrLayout = () => tree(other);
    assert.equal(agentSettingsOpen(), false, String(other));
  }
});

it("Projects stay in the regular sidebar frame while Search is fading", () => {
  const nav = { id: "nav-top", hidden: false };
  host.__herdrLayout = () => ({ children: [nav, { id: "main", active: "main-agents" }] });
  assert.equal(agentSettingsOpen(), false);
  nav.hidden = true;
  assert.equal(agentSettingsOpen(), true);
});

it("rows: Global first, installed agents before missing ones, a switch on installed rows and an install on missing ones", () => {
  const out = draw({ "agent-manager.inventory": inventory });
  const order = ["global", "claude", "codex", "freebuff"].map((key) =>
    out.indexOf(`am-rail-select-${key}`),
  );
  assert.ok(
    order.every((at) => at > 0),
    "every row is drawn",
  );
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
  assert.ok(out.includes("am-rail-toggle-claude") && out.includes("am-rail-toggle-freebuff"));
  assert.ok(out.includes("am-rail-install-codex") && !out.includes("am-rail-toggle-codex"));
  assert.ok(out.includes("Official") && out.includes("Unofficial"));
});

it("until the agent settings has published, the rail shows Global alone", () => {
  const out = draw({});
  assert.ok(out.includes("am-rail-select-global"));
  assert.ok(!out.includes("am-rail-select-claude"));
});

it("the tile keeps the same rounded square while its hover colour fades", () => {
  const [row] = inventory.agents;
  for (const over of [{}, { railHover: row.key }, { railSelection: row.key }]) {
    const [indicator, tile] = childrenOf(nodeOf(railItem(rail(over), row, t)));
    const [pill] = childrenOf(indicator);
    const [fill] = childrenOf(tile);
    assert.ok(tile.c.some(([name, args]) => name === "rounded" && args[0] === 13));
    assert.ok(fill.c.some(([name, args]) => name === "rounded" && args[0] === 13));
    assert.ok(fill.c.some(([name, args]) => name === "transition" && args[0] === "opacity"));
    assert.ok(pill.c.some(([name, args]) => name === "transition" && args[0] === "height"));
  }
});

it("Global uses robot and gear, and FreeBuff keeps its brand icon", () => {
  const render = (row: RailRow, selected = row.key) =>
    JSON.stringify(nodeOf(railItem(rail({ railSelection: selected }), row, t)));
  const global = render({ key: "global" });
  assert.ok(global.includes("mods/orca-assets/bot.svg"));
  assert.ok(global.includes("mods/orca-assets/settings.svg"));
  assert.ok(global.includes("Global Agent Settings"));
  const [freebuff] = inventory.unofficial;
  assert.ok(render(freebuff).includes(freebuff.icon ?? ""));
  assert.ok(render({ ...freebuff, installed: false }).includes("am-rail-install-freebuff"));
  assert.ok(!render({ ...freebuff, installed: undefined }).includes("am-rail-install-freebuff"));
});

it("the rail owner reads the manager's shared values and sends one-shot requests", () => {
  const values: Record<string, unknown> = {
    "agent-manager.litellm-enabled": true,
    "agent-manager.selected": { key: "claude" },
  };
  const sent: [string, unknown][] = [];
  host.__herdrShared = (key) => values[key];
  host.__herdrSetShared = (key, value) => {
    sent.push([key, value]);
  };
  const owner = agentRailOwner();
  assert.equal(owner.litellmEnabled, true);
  assert.equal(owner.railSelection, "claude");
  assert.equal(owner.railHover, null);
  assert.equal(owner.providerRailOpen, true);
  values["agent-manager.selected"] = undefined;
  assert.equal(owner.railSelection, "global");
  values["agent-manager.litellm-enabled"] = "yes";
  assert.equal(owner.litellmEnabled, false);
  owner.selectRail("codex");
  owner.toggleEnabled({ key: "claude" });
  assert.deepEqual(sent, [
    ["agent-manager.open-agent", { key: "codex" }],
    ["agent-manager.toggle-agent", { key: "claude" }],
  ]);
});
