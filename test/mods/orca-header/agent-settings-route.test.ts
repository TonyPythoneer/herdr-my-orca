import { afterEach, beforeEach, test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import type { AsyncContext, Context } from "gpui-kit";
import {
  settingsPillLeft,
  settingsReturnPage,
  settingsSidebarPlan,
  settingsHoldPx,
  SETTINGS_SIDEBAR_PX,
} from "../../../src/mods/orca-header/agent-settings-route.js";
import Tabs from "../../../src/mods/orca-header/main.js";
import { hostState, nodeOf, resetHostState, type TaskFn } from "./host.js";

vi.mock("gpui-kit", async () => (await import("./host.js")).gpuiKit());
vi.mock("gpui-base", async () => (await import("./host.js")).gpuiBase());
vi.mock("herdr", async () => (await import("./host.js")).herdr());

beforeEach(() => {
  resetHostState();
});

afterEach(() => {
  resetHostState();
  vi.restoreAllMocks();
});

const asCx = (value: object): AsyncContext => value as AsyncContext;

test("Back to app stays centered in both layout modes, including asymmetric rails", () => {
  for (const [left, right] of [
    [280, 350],
    [0, 350],
    [0, 0],
    [280, 0],
    [140, 175],
  ]) {
    const x = settingsPillLeft(1440, left, right) as number;
    assert.equal(left + x + 56, 720);
  }
  assert.equal(settingsPillLeft(undefined, 0, 0), null);
  assert.ok((settingsPillLeft(200, 120, 80) as number) >= 0);
});

test("return target preserves an existing nonterminal page or chooses active terminal/landing", () => {
  const pages = [{ id: "main-providers" }, { id: "main-tasks" }];
  assert.equal(settingsReturnPage("main-providers", pages, { tabs: [{}] }), "main-providers");
  assert.equal(settingsReturnPage("main-terminals", pages, { tabs: [{}] }), "main-terminals");
  assert.equal(settingsReturnPage("main-landing", pages, { tabs: [] }), "main-landing");
  assert.equal(settingsReturnPage("missing", pages, { tabs: [] }), "main-landing");
});

test("settings route cannot be ejected by syncLanding and renders only its Back control", () => {
  const calls: [string, ...unknown[]][] = [];
  hostState.run = (name: string, args?: unknown) => {
    calls.push([name, args]);
    return undefined;
  };
  hostState.props = () => ({});
  hostState.layout = () => ({ id: "main", active: "main-agents", children: [] });
  hostState.spaces = () => [{ active: true, tabs: [{ id: "one" }] }];
  hostState.theme = () => new Proxy({}, { get: (_t, k) => String(k) });
  const view = new Tabs();
  view.syncLanding(asCx({}));
  assert.deepEqual(calls, []);
  const result = JSON.stringify(nodeOf(view.render({} as AsyncContext)));
  assert.ok(result.includes("agent-settings-back"));
  assert.ok(!result.includes('"tab-new"'));
  assert.ok(!result.includes('"tab-track"'));
});

const SIDEBAR = { id: "left-sidebar", size: { px: 259 } };
test("settings narrows the sidebar once, and leaving restores it once", () => {
  const enter = { open: true, prior: null, sidebar: SIDEBAR, busy: false };
  assert.deepEqual(settingsSidebarPlan(enter), {
    flag: { px: 259 },
    show: false,
    resize: SETTINGS_SIDEBAR_PX,
  });
  assert.equal(
    settingsSidebarPlan({
      ...enter,
      prior: { px: 259 },
      sidebar: { size: { px: SETTINGS_SIDEBAR_PX } },
    }),
    null,
    "no second pass once narrow",
  );
  assert.deepEqual(
    settingsSidebarPlan({ ...enter, prior: { px: 259 }, sidebar: { size: { px: 160 } } }),
    { flag: { px: 259 }, show: false, resize: SETTINGS_SIDEBAR_PX },
    "a reload resumes from the current width",
  );
  assert.deepEqual(settingsSidebarPlan({ ...enter, open: false, prior: { px: 259 } }), {
    flag: null,
    show: true,
    resize: 259,
  });
  assert.equal(
    settingsSidebarPlan({ ...enter, open: false }),
    null,
    "nothing to undo when it never entered",
  );
});

test("settings leaves the width alone without a sidebar", () => {
  const plan = settingsSidebarPlan({ open: true, prior: null, sidebar: null, busy: false });
  assert.deepEqual(plan, { flag: { px: null }, show: false, resize: null });
  assert.deepEqual(
    settingsSidebarPlan({ open: false, prior: plan?.flag, sidebar: SIDEBAR, busy: false }),
    { flag: null, show: true, resize: null },
  );
});

test("hidden and toggle-collapsed sidebars open to the rail and restore their hidden state", () => {
  const flag = { px: 259, hidden: true };
  for (const sidebar of [
    { ...SIDEBAR, hidden: true },
    { ...SIDEBAR, size: { px: 1 } },
  ]) {
    const enter = { open: true, sidebar, wide: 259 };
    assert.deepEqual(settingsSidebarPlan(enter), { flag, show: false, resize: 76 });
    assert.deepEqual(settingsSidebarPlan({ ...enter, prior: { px: null } }), {
      flag,
      show: false,
      resize: 76,
    });
    assert.deepEqual(settingsSidebarPlan({ ...enter, prior: flag }), {
      flag,
      show: false,
      resize: 76,
    });
    assert.deepEqual(settingsSidebarPlan({ ...enter, open: false, prior: flag }), {
      flag: null,
      show: true,
      resize: 0,
    });
  }
});

test("a sidebar that is moving blocks both directions until it settles", () => {
  const sidebar = { ...SIDEBAR, size: { px: 40 } };
  assert.equal(
    settingsSidebarPlan({ open: true, prior: null, sidebar, busy: true, wide: 259 }),
    null,
  );
  assert.deepEqual(
    settingsSidebarPlan({ open: true, prior: null, sidebar, busy: false, wide: 259 }),
    {
      flag: { px: 259 },
      show: false,
      resize: 76,
    },
  );
  assert.equal(
    settingsSidebarPlan({ open: false, prior: { px: 259 }, sidebar: SIDEBAR, busy: true }),
    null,
  );
});

test("settings renders one narrowing motion and restores from the saved width after a reload", async () => {
  const log: [string, ...unknown[]][] = [];
  const shared: Record<string, unknown> = {};
  const tasks: TaskFn[] = [];
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  let clockTick: (() => void) | undefined;
  const cx = asCx({
    spawn: (task: TaskFn) => {
      tasks.push(task);
    },
    sleep: async (ms: number) => {
      now += ms;
      if (ms === 120) clockTick?.();
    },
    notify() {},
  });
  let layoutTree: unknown;
  const sidebar: { id: string; size: { px: number }; hidden?: boolean } = {
    ...SIDEBAR,
    size: { ...SIDEBAR.size },
  };
  const nav: { id: string; hidden: boolean } = { id: "nav-top", hidden: false };
  const tree = (active: string) => ({
    id: "root",
    children: [sidebar, nav, { id: "main", active }],
  });
  hostState.run = (name: string, args?: unknown) => {
    log.push([name, args]);
    const a = args as { id: string; px: number };
    if (name === "layout.resize" && a.id === sidebar.id) sidebar.size.px = a.px;
    const node = a.id === nav.id ? nav : a.id === sidebar.id ? sidebar : null;
    if (node && (name === "layout.show" || name === "layout.hide"))
      node.hidden = name === "layout.hide";
    return undefined;
  };
  hostState.setShared = (key: string, value: unknown) => {
    log.push(["setShared", key, value]);
    shared[key] = value;
    return undefined;
  };
  hostState.shared = (key: string) => shared[key];
  hostState.props = () => ({});
  hostState.layout = () => layoutTree;
  hostState.spaces = () => [{ active: true, tabs: [{ id: "one" }] }];
  hostState.theme = () => new Proxy({}, { get: (_t, k) => String(k) });
  const view = new Tabs();
  Object.assign(view, { drawers: { sidebar: { token: 0 } } });
  layoutTree = tree("main-agents");
  view.render(cx);
  view.render(cx);
  assert.deepEqual(log, [
    ["setShared", "left-sidebar.settingsPrior", { px: 259 }],
    ["setShared", "left-sidebar.openPx", 259],
  ]);
  assert.equal(tasks.length, 1);
  await tasks.shift()?.(cx);
  const widths = () =>
    log.filter(([name]) => name === "layout.resize").map(([, args]) => (args as { px: number }).px);
  assert.equal(widths().at(-1), SETTINGS_SIDEBAR_PX);
  assert.ok(widths().some((px) => px > SETTINGS_SIDEBAR_PX && px < 259));
  assert.deepEqual(shared["left-sidebar.settingsPrior"], { px: 259 });
  assert.deepEqual(log.at(-1), ["layout.hide", { id: "nav-top" }]);

  log.length = 0;
  layoutTree = tree("main-terminals");
  const reloaded = new Tabs();
  Object.assign(reloaded, { drawers: { sidebar: { token: 0 } } });
  reloaded.syncSettingsSidebar(cx, false);
  assert.deepEqual(log, [["layout.show", { id: "nav-top" }]]);
  await tasks.shift()?.(cx);
  assert.equal(widths().at(-1), 259);
  assert.ok(widths().some((px) => px > SETTINGS_SIDEBAR_PX && px < 259));
  assert.deepEqual(log.at(-1), ["setShared", "left-sidebar.settingsPrior", null]);
  assert.equal(shared["left-sidebar.openPx"], 259);

  log.length = 0;
  hostState.props = () => ({ motion: "native", pinSidebarTerminal: true });
  shared["left-sidebar.settingsPrior"] = { px: 259, hidden: true };
  sidebar.hidden = true;
  const restarted = new Tabs();
  restarted.nativeHeaderWidth = 900;
  layoutTree = tree("main-agents");
  assert.match(JSON.stringify(nodeOf(restarted.render(cx))), /sidebar-native-clock/);
  const drawer = restarted.drawers.sidebar;
  const driveClock = (first: number, last: number) => {
    clockTick = () => {
      drawer.size({ width: first }, cx, restarted.drawerEnv());
      drawer.size({ width: last }, cx, restarted.drawerEnv());
    };
  };
  driveClock(40, 76);
  while (tasks.length) await tasks.shift()?.(cx);
  assert.equal(sidebar.hidden, false);
  assert.equal(sidebar.size.px, SETTINGS_SIDEBAR_PX);
  assert.equal(shared["left-sidebar.collapsed"], false);
  assert.ok(
    log.some(
      ([name, args]) =>
        name === "layout.resize" &&
        (args as { id: string; px: number }).id === "main" &&
        (args as { px: number }).px === 824,
    ),
  );
  assert.ok(
    log.some(
      ([name, args]) =>
        name === "layout.resize" &&
        (args as { id: string; weight: number }).id === "main" &&
        (args as { weight: number }).weight === 1,
    ),
  );

  log.length = 0;
  restarted.requestSettingsPage("main-terminals", cx);
  restarted.syncSettingsSidebar(cx, false);
  assert.ok(!log.some(([name]) => name === "layout.select"));
  driveClock(40, 1);
  while (tasks.length) await tasks.shift()?.(cx);
  assert.equal(sidebar.hidden, true);
  assert.equal(sidebar.size.px, 259);
  assert.equal(shared["left-sidebar.collapsed"], true);
  assert.equal(shared["left-sidebar.settingsPrior"], null);
  assert.equal(shared["left-sidebar.openPx"], 259);
  const mainResizes = log.filter(
    ([name, args]) => name === "layout.resize" && (args as { id: string }).id === "main",
  );
  assert.deepEqual(mainResizes, [
    ["layout.resize", { id: "main", px: 900 }],
    ["layout.resize", { id: "main", weight: 1 }],
  ]);
  assert.deepEqual(log.at(-2), ["layout.select", { stack: "main", child: "main-terminals" }]);
  assert.deepEqual(log.at(-1), ["setShared", "left-sidebar.settingsAnchor", null]);
  const position = (tree: { c: [string, unknown][] }) =>
    tree.c.findIndex(
      ([method, args]) =>
        method === "child" &&
        (args as { c?: [string, unknown[]][] }[])[0]?.c?.some(
          ([style, values]) => style === "id" && (values as string[])[0] === "sidebar-native-clock",
        ),
    );
  const settingsTree = nodeOf(restarted.render(cx));
  layoutTree = tree("main-terminals");
  Object.assign(restarted, {
    stripFrame: () => ({
      leftPad: 0,
      bar: "#000",
      shown: [],
      w: { platform: "macos" },
      geometry: { arrows: {}, viewportWidth: 0 },
      t: hostState.theme(),
    }),
  });
  const normalTree = nodeOf(restarted.render(cx));
  assert.equal(settingsTree.n, normalTree.n);
  assert.ok(position(settingsTree) >= 0);
  for (const node of [settingsTree, normalTree]) {
    const children = node.c.filter(([method]) => method === "child");
    assert.equal(position({ c: children }), 0);
  }

  log.length = 0;
  sidebar.hidden = false;
  restarted.requestSettingsPage("main-agents", cx);
  restarted.syncSettingsSidebar(cx, true);
  driveClock(140, 76);
  while (tasks.length) await tasks.shift()?.(cx);
  const pin = log.findIndex(
    ([name, args]) => name === "layout.resize" && (args as { id: string }).id === "main",
  );
  assert.deepEqual(log.slice(pin, pin + 3), [
    ["layout.resize", { id: "main", px: 824 }],
    ["layout.select", { stack: "main", child: "main-agents" }],
    ["layout.resize", { id: "left-sidebar", px: 140 }],
  ]);
});

test("the narrow width follows the window zoom, and keys pressed on the settings page are dropped", () => {
  const plan = settingsSidebarPlan({
    open: true,
    prior: null,
    sidebar: SIDEBAR,
    busy: false,
    zoom: 1.25,
  });
  assert.equal(plan?.resize, Math.round(SETTINGS_SIDEBAR_PX * 1.25));
  assert.equal(
    settingsSidebarPlan({
      open: true,
      prior: { px: 259 },
      sidebar: { id: "left-sidebar", size: { px: 95 } },
      busy: false,
      zoom: 1.25,
    }),
    null,
  );
  hostState.run = () => undefined;
  hostState.setShared = () => undefined;
  hostState.shared = () => null;
  hostState.props = () => ({});
  hostState.layout = () => ({ id: "root", children: [{ id: "main", active: "main-agents" }] });
  hostState.spaces = () => [{ active: true, tabs: [{ id: "one" }] }];
  hostState.theme = () => new Proxy({}, { get: (_t, k) => String(k) });
  const view = new Tabs();
  view.wantToggle = 2;
  view.wantPanelToggle = 1;
  nodeOf(view.render({} as Context));
  assert.equal(view.wantToggle, 0);
  assert.equal(view.wantPanelToggle, 0);
});

test("settings computes the central width for each sidebar geometry", () => {
  assert.equal(settingsHoldPx({ full: 1393, sidebar: 280 }), 1113);
  assert.equal(settingsHoldPx({ full: 1393, sidebar: 76 }), 1317);
  assert.equal(settingsHoldPx({ full: 1393, sidebar: 0, panel: 350 }), 1043);
  assert.equal(settingsHoldPx({ full: 1393, sidebar: 76, panel: 350 }), 967);
  assert.equal(settingsHoldPx({ full: 0, sidebar: 280 }), null);
});
