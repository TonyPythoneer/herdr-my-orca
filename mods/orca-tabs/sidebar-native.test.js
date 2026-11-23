import { test } from "node:test";
import { strict as assert } from "node:assert";
import { register } from "node:module";
register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: Tabs } = await import("./main.js");

test("native motion deduplicates widths and cancels a stale hide", async () => {
  const calls = [], tasks = [];
  globalThis.__herdrRun = (name, args) => calls.push([name, args]);
  const tabs = new Tabs();
  Object.assign(tabs, { sbBusy: true, sbGoal: 0, sbToken: 1, sbOpenPx: 259, nativeActive: true, nativeFinishing: false });
  const cx = { spawn: fn => tasks.push(fn), sleep: async () => {}, notify() {} };
  tabs.sidebarNativeSize({ width: 100 }, cx);
  tabs.sidebarNativeSize({ width: 100 }, cx);
  assert.deepEqual(calls, [["layout.resize", { id: "sidebar", px: 100 }]]);
  tabs.sidebarNativeSize({ width: 1 }, cx);
  assert.equal(tasks.length, 1);
  tabs.sbToken++;
  await tasks[0](cx);
  assert.equal(calls.some(([name]) => name === "layout.hide"), false);
  delete globalThis.__herdrRun;
});


test("native motion pins the terminal and restores its flexible width", async () => {
  const calls = [], tasks = [];
  globalThis.__herdrRun = (name, args) => calls.push([name, args]);
  globalThis.__herdrProps = () => ({ pinSidebarTerminal: true });
  globalThis.__herdrLayout = () => ({ id: "sidebar", size: { px: 259 }, hidden: false });
  const tabs = new Tabs();
  Object.assign(tabs, { sbBusy: false, sbToken: 0, sbOpenPx: 259, nativeHeaderWidth: 1000 });
  const cx = { spawn: fn => tasks.push(fn), sleep: async () => {}, notify() {} };
  tabs.toggleSidebarNative(cx);
  await tasks[0](cx);
  assert.ok(calls.some(([name, args]) => name === "layout.resize" && args.id === "main" && args.px === 1000));
  await tasks[1](cx);
  assert.ok(calls.some(([name, args]) => name === "layout.resize" && args.id === "main" && args.weight === 1));
  assert.equal(tabs.nativePinned, false);
  delete globalThis.__herdrRun;
  delete globalThis.__herdrProps;
  delete globalThis.__herdrLayout;
});


test("right panel holds the terminal width until both animations finish", async () => {
  const calls = [], tasks = [];
  globalThis.__herdrRun = (name, args) => calls.push([name, args]);
  globalThis.__herdrLayout = () => ({ children: [{ id: "panel", size: { px: 350 }, hidden: false }, { id: "sidebar", size: { px: 259 }, hidden: false }] });
  const tabs = new Tabs();
  Object.assign(tabs, { panelBusy: false, panelToken: 0, panelOpenPx: 350, nativeHeaderWidth: 800, sbBusy: true });
  const cx = { spawn: fn => tasks.push(fn), sleep: async () => {}, notify() {} };
  tabs.togglePanelNative(cx);
  await tasks[0](cx);
  assert.ok(calls.some(([name, args]) => name === "layout.resize" && args.id === "main" && args.px === 891));
  await tasks[1](cx);
  assert.equal(calls.some(([name, args]) => name === "layout.resize" && args.id === "main" && args.weight === 1), false);
  tabs.sbBusy = false;
  tabs.releaseNativePin();
  assert.ok(calls.some(([name, args]) => name === "layout.resize" && args.id === "main" && args.weight === 1));
  delete globalThis.__herdrRun;
  delete globalThis.__herdrLayout;
});
