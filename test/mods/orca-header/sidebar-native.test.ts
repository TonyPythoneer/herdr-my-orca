import { afterEach, beforeEach, test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import Tabs from "../../../src/mods/orca-header/main.js";
import { cxOf, hostState, resetHostState, type TaskFn } from "./host.js";

vi.mock("gpui-kit", async () => (await import("./host.js")).gpuiKit());
vi.mock("gpui-base", async () => (await import("./host.js")).gpuiBase());
vi.mock("herdr", async () => (await import("./host.js")).herdr());

beforeEach(() => {
  resetHostState();
});

afterEach(() => {
  resetHostState();
});

type Call = [string, unknown];

function recordRuns(calls: Call[]): void {
  hostState.run = (name: string, args?: unknown) => {
    calls.push([name, args]);
    return undefined;
  };
}

function argsOf(call: Call): Record<string, unknown> {
  return call[1] as Record<string, unknown>;
}

test("native motion deduplicates widths and cancels a stale hide", async () => {
  const calls: Call[] = [];
  const tasks: TaskFn[] = [];
  recordRuns(calls);
  const tabs = new Tabs();
  tabs.initDrawers();
  const d = tabs.drawers.sidebar;
  Object.assign(d, { busy: true, goal: 0, token: 1, openPx: 259, active: true, finishing: false });
  const cx = cxOf(tasks);
  d.size({ width: 100 }, cx, tabs.drawerEnv());
  d.size({ width: 100 }, cx, tabs.drawerEnv());
  assert.deepEqual(calls, [["layout.resize", { id: "left-sidebar", px: 100 }]]);
  d.size({ width: 1 }, cx, tabs.drawerEnv());
  assert.equal(tasks.length, 1);
  d.token++;
  await tasks[0](cx);
  assert.equal(
    calls.some(([name]) => name === "layout.hide"),
    false,
  );
});

test("native motion pins the terminal and restores its flexible width", async () => {
  const calls: Call[] = [];
  const tasks: TaskFn[] = [];
  recordRuns(calls);
  hostState.props = () => ({ pinSidebarTerminal: true });
  hostState.layout = () => ({ id: "left-sidebar", size: { px: 259 }, hidden: false });
  const tabs = new Tabs();
  tabs.initDrawers();
  Object.assign(tabs.drawers.sidebar, { openPx: 259 });
  tabs.nativeHeaderWidth = 1000;
  const cx = cxOf(tasks);
  tabs.toggleSidebarNative(cx);
  await tasks[0](cx);
  assert.ok(
    calls.some(
      ([name, args]) =>
        name === "layout.resize" &&
        argsOf([name, args]).id === "main" &&
        argsOf([name, args]).px === 1000,
    ),
  );
  await tasks[1](cx);
  await tasks[2](cx);
  assert.ok(
    calls.some(
      ([name, args]) =>
        name === "layout.resize" &&
        argsOf([name, args]).id === "main" &&
        argsOf([name, args]).weight === 1,
    ),
  );
  assert.equal(tabs.nativePinned, false);
});

test("closing the right panel hides it before restoring flexible terminal width", async () => {
  const calls: Call[] = [];
  const tasks: TaskFn[] = [];
  recordRuns(calls);
  hostState.layout = () => ({
    children: [
      { id: "panel", size: { px: 350 }, hidden: false },
      { id: "left-sidebar", size: { px: 259 }, hidden: false },
    ],
  });
  const tabs = new Tabs();
  tabs.initDrawers();
  Object.assign(tabs.drawers.panel, { openPx: 350 });
  tabs.drawers.sidebar.busy = true;
  tabs.nativeHeaderWidth = 800;
  const cx = cxOf(tasks);
  tabs.togglePanelNative(cx);
  await tasks[0](cx);
  assert.ok(
    calls.some(
      ([name, args]) =>
        name === "layout.resize" &&
        argsOf([name, args]).id === "main" &&
        argsOf([name, args]).px === 541,
    ),
  );
  await tasks[1](cx);
  const widths = calls
    .filter(([name, args]) => name === "layout.resize" && argsOf([name, args]).id === "panel")
    .map(([, args]) => (args as { px: number }).px);
  assert.ok(new Set(widths).size > 10, "the panel's edge moves in steps");
  assert.equal(widths.at(-1), 1);
  assert.equal(
    calls.some(([name]) => name === "layout.hide"),
    false,
  );
  await tasks[2](cx);
  assert.deepEqual(calls.slice(-2), [
    ["layout.hide", { id: "panel" }],
    ["layout.resize", { id: "panel", px: 350 }],
  ]);
  assert.equal(
    calls.some(
      ([name, args]) =>
        name === "layout.resize" &&
        argsOf([name, args]).id === "main" &&
        argsOf([name, args]).weight === 1,
    ),
    false,
    "the left drawer is still moving",
  );
  tabs.drawers.sidebar.busy = false;
  tabs.releaseNativePin();
  assert.ok(
    calls.some(
      ([name, args]) =>
        name === "layout.resize" &&
        argsOf([name, args]).id === "main" &&
        argsOf([name, args]).weight === 1,
    ),
  );
});

test("right panel pins the terminal at its open width before showing the panel", async () => {
  const calls: Call[] = [];
  const tasks: TaskFn[] = [];
  recordRuns(calls);
  hostState.layout = () => ({
    children: [
      { id: "panel", size: { px: 410 }, hidden: true },
      { id: "left-sidebar", size: { px: 259 }, hidden: false },
    ],
  });
  const tabs = new Tabs();
  tabs.nativeHeaderWidth = 1150;
  const cx = cxOf(tasks);
  tabs.togglePanelNative(cx);
  await tasks[0](cx);
  assert.deepEqual(calls.slice(0, 3), [
    ["layout.resize", { id: "main", px: 481 }],
    ["layout.resize", { id: "panel", px: 1 }],
    ["layout.show", { id: "panel" }],
  ]);
});

test("a move with its own hold width pins main at exactly that width, once, and lets go at the end", async () => {
  const calls: Call[] = [];
  const tasks: TaskFn[] = [];
  recordRuns(calls);
  hostState.layout = () => ({ id: "left-sidebar", size: { px: 280 }, hidden: false });
  const tabs = new Tabs();
  tabs.initDrawers();
  const d = tabs.drawers.sidebar;
  const pins: number[] = [];
  const released: boolean[] = [];
  d.openPx = 280;
  const env = {
    ...tabs.drawerEnv(),
    pin: (px: number) => pins.push(px),
    release: () => released.push(true),
  };
  const cx = cxOf(tasks);
  d.move(cx, env, {
    node: { id: "left-sidebar", size: { px: 280 } },
    open: 280,
    target: 76 / 280,
    pin: 1317,
  });
  await tasks[0](cx);
  assert.deepEqual(pins, [1317]);
  d.size({ width: 76 }, cx, env);
  await tasks.at(-1)?.(cx);
  assert.deepEqual(released, [true]);
  pins.length = 0;
  tasks.length = 0;
  d.move(cx, env, { node: { id: "left-sidebar", size: { px: 280 } }, open: 280, target: 0.5 });
  await tasks[0](cx);
  assert.deepEqual(pins, []);
});

test("entering agent settings closes a visible right panel once, and only when it is visible", () => {
  const calls: Call[] = [];
  const tasks: TaskFn[] = [];
  recordRuns(calls);
  const tabs = new Tabs();
  tabs.initDrawers();
  const cx = cxOf(tasks);
  const panel = (hidden: boolean) => {
    hostState.layout = () => ({ children: [{ id: "panel", size: { px: 350 }, hidden }] });
  };
  panel(false);
  tabs.closePanelForSettings(cx);
  tabs.closePanelForSettings(cx);
  assert.equal(tasks.length, 1);
  assert.equal(tabs.drawers.panel.goal, 0, "the drawer is heading closed");
  panel(true);
  Object.assign(tabs.drawers.panel, { busy: false });
  tabs.closePanelForSettings(cx);
  assert.equal(tasks.length, 1, "a hidden panel is left alone");
  assert.deepEqual(calls, []);
});
