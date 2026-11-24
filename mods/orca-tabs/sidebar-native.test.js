import { test } from "node:test";
import { strict as assert } from "node:assert";
import { register } from "node:module";
register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: Tabs } = await import("./main.js");

const cxOf = (tasks) => ({ spawn: fn => tasks.push(fn), sleep: async () => {}, notify() {} });

test("native motion deduplicates widths and cancels a stale hide", async () => {
  const calls = [], tasks = [];
  globalThis.__herdrRun = (name, args) => calls.push([name, args]);
  const tabs = new Tabs(), d = (tabs.initDrawers(), tabs.drawers.sidebar);
  Object.assign(d, { busy: true, goal: 0, token: 1, openPx: 259, active: true, finishing: false });
  const cx = cxOf(tasks);
  d.size({ width: 100 }, cx, tabs.drawerEnv());
  d.size({ width: 100 }, cx, tabs.drawerEnv());
  assert.deepEqual(calls, [["layout.resize", { id: "left-sidebar", px: 100 }]]);
  d.size({ width: 1 }, cx, tabs.drawerEnv());
  assert.equal(tasks.length, 1);
  d.token++;
  await tasks[0](cx);
  assert.equal(calls.some(([name]) => name === "layout.hide"), false);
  delete globalThis.__herdrRun;
});

test("native motion pins the terminal and restores its flexible width", async () => {
  const calls = [], tasks = [];
  globalThis.__herdrRun = (name, args) => calls.push([name, args]);
  globalThis.__herdrProps = () => ({ pinSidebarTerminal: true });
  globalThis.__herdrLayout = () => ({ id: "left-sidebar", size: { px: 259 }, hidden: false });
  const tabs = new Tabs(); tabs.initDrawers();
  Object.assign(tabs.drawers.sidebar, { openPx: 259 });
  tabs.nativeHeaderWidth = 1000;
  const cx = cxOf(tasks);
  tabs.toggleSidebarNative(cx);
  await tasks[0](cx);
  assert.ok(calls.some(([name, args]) => name === "layout.resize" && args.id === "main" && args.px === 1000));
  await tasks[1](cx); // the silent clock's timer steps the node to the end
  await tasks[2](cx); // then the drawer finishes and releases the pin
  assert.ok(calls.some(([name, args]) => name === "layout.resize" && args.id === "main" && args.weight === 1));
  assert.equal(tabs.nativePinned, false);
  delete globalThis.__herdrRun;
  delete globalThis.__herdrProps;
  delete globalThis.__herdrLayout;
});

test("closing the right panel hides it before restoring flexible terminal width", async () => {
  const calls = [], tasks = [];
  globalThis.__herdrRun = (name, args) => calls.push([name, args]);
  globalThis.__herdrLayout = () => ({ children: [{ id: "panel", size: { px: 350 }, hidden: false }, { id: "left-sidebar", size: { px: 259 }, hidden: false }] });
  const tabs = new Tabs(); tabs.initDrawers();
  Object.assign(tabs.drawers.panel, { openPx: 350 });
  tabs.drawers.sidebar.busy = true;
  tabs.nativeHeaderWidth = 800;
  const cx = cxOf(tasks);
  tabs.togglePanelNative(cx);
  await tasks[0](cx);
  // The same hold as the sidebar, so the PTY does not reflow on every step.
  assert.ok(calls.some(([name, args]) => name === "layout.resize" && args.id === "main" && args.px === 541));
  await tasks[1](cx); // the silent clock's timer steps the node to the end
  const widths = calls.filter(([name, args]) => name === "layout.resize" && args.id === "panel").map(([, args]) => args.px);
  assert.ok(new Set(widths).size > 10, "the panel's edge moves in steps");
  assert.equal(widths.at(-1), 1);
  assert.equal(calls.some(([name]) => name === "layout.hide"), false);
  await tasks[2](cx); // then the drawer finishes
  assert.deepEqual(calls.slice(-2), [
    ["layout.hide", { id: "panel" }],
    ["layout.resize", { id: "panel", px: 350 }],
  ]);
  assert.equal(calls.some(([name, args]) => name === "layout.resize" && args.id === "main" && args.weight === 1), false, "the left drawer is still moving");
  tabs.drawers.sidebar.busy = false;
  tabs.releaseNativePin();
  assert.ok(calls.some(([name, args]) => name === "layout.resize" && args.id === "main" && args.weight === 1));
  delete globalThis.__herdrRun;
  delete globalThis.__herdrLayout;
});

test("right panel pins the terminal at its open width before showing the panel", async (t) => {
  const calls = [], tasks = [];
  globalThis.__herdrRun = (name, args) => calls.push([name, args]);
  globalThis.__herdrLayout = () => ({ children: [
    { id: "panel", size: { px: 410 }, hidden: true },
    { id: "left-sidebar", size: { px: 259 }, hidden: false },
  ] });
  t.after(() => {
    delete globalThis.__herdrRun;
    delete globalThis.__herdrLayout;
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
  const calls = [], tasks = [];
  globalThis.__herdrRun = (name, args) => calls.push([name, args]);
  globalThis.__herdrLayout = () => ({ id: "left-sidebar", size: { px: 280 }, hidden: false });
  try {
    const tabs = new Tabs(); tabs.initDrawers();
    const d = tabs.drawers.sidebar, pins = [], released = [];
    d.openPx = 280; // the caller sets it before every move
    const env = { ...tabs.drawerEnv(), pin: px => pins.push(px), release: () => released.push(true) };
    const cx = { spawn: fn => tasks.push(fn), sleep: async () => {}, notify() {} };
    d.move(cx, env, { node: { id: "left-sidebar", size: { px: 280 } }, open: 280, target: 76 / 280, timed: true, pin: 1317 });
    await tasks[0](cx);
    assert.deepEqual(pins, [1317]);
    d.size({ width: 76 }, cx, env);
    await tasks.at(-1)(cx);
    assert.deepEqual(released, [true]);
    // Without an override the spec decides (no header measured: nothing is held).
    pins.length = 0; tasks.length = 0;
    d.move(cx, env, { node: { id: "left-sidebar", size: { px: 280 } }, open: 280, target: 0.5, timed: true });
    await tasks[0](cx);
    assert.deepEqual(pins, []);
  } finally {
    delete globalThis.__herdrRun; delete globalThis.__herdrLayout;
  }
});

test("entering agent settings closes a visible right panel once, and only when it is visible", () => {
  const calls = [], tasks = [];
  globalThis.__herdrRun = (name, args) => calls.push([name, args]);
  const tabs = new Tabs(); tabs.initDrawers();
  const cx = cxOf(tasks);
  const panel = (hidden) => globalThis.__herdrLayout = () => ({ children: [{ id: "panel", size: { px: 350 }, hidden }] });
  try {
    panel(false);
    tabs.closePanelForSettings(cx);
    tabs.closePanelForSettings(cx); // a repeat render while the Drawer moves must not flip it back
    assert.equal(tasks.length, 1);
    assert.equal(tabs.drawers.panel.goal, 0, "the drawer is heading closed");
    panel(true);
    Object.assign(tabs.drawers.panel, { busy: false });
    tabs.closePanelForSettings(cx);
    assert.equal(tasks.length, 1, "a hidden panel is left alone");
    assert.deepEqual(calls, []);
  } finally {
    delete globalThis.__herdrRun; delete globalThis.__herdrLayout;
  }
});
