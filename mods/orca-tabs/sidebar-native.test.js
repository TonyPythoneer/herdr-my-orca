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
  assert.deepEqual(calls, [["layout.resize", { id: "sidebar", px: 100 }]]);
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
  globalThis.__herdrLayout = () => ({ id: "sidebar", size: { px: 259 }, hidden: false });
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

test("the panel lets the work area shrink with it, so nothing is pinned", async () => {
  const calls = [], tasks = [];
  globalThis.__herdrRun = (name, args) => calls.push([name, args]);
  globalThis.__herdrLayout = () => ({ children: [{ id: "panel", size: { px: 350 }, hidden: false }, { id: "sidebar", size: { px: 259 }, hidden: false }] });
  const tabs = new Tabs();
  Object.assign(tabs.drawers.panel, { openPx: 350 });
  tabs.nativeHeaderWidth = 800;
  const cx = cxOf(tasks);
  tabs.togglePanelNative(cx);
  await tasks[0](cx);
  assert.equal(calls.some(([name, args]) => name === "layout.resize" && args.id === "main"), false);
  await tasks[1](cx);
  const widths = calls.filter(([name, args]) => name === "layout.resize" && args.id === "panel").map(([, args]) => args.px);
  assert.ok(new Set(widths).size > 10, "the work area's right edge moves in steps");
  await tasks[2](cx);
  assert.equal(calls.some(([name, args]) => name === "layout.resize" && args.id === "main" && args.weight === 1), false);
  delete globalThis.__herdrRun;
  delete globalThis.__herdrLayout;
});
