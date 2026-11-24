import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { settingsPillLeft, settingsReturnPage, settingsSidebarPlan, settingsHoldPx, SETTINGS_SIDEBAR_PX } from "./agent-settings-route.js";
register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: Tabs } = await import("./main.js");

test("Back to app stays centered in both layout modes, including asymmetric rails", () => {
  for (const [left,right] of [[280,350],[0,350],[0,0],[280,0],[140,175]]) {
    const x = settingsPillLeft(1440,left,right);
    assert.equal(left + x + 56,720);
  }
  assert.equal(settingsPillLeft(undefined,0,0),null);
  assert.ok(settingsPillLeft(200,120,80) >= 0);
});
test("return target preserves an existing nonterminal page or chooses active terminal/landing", () => {
  const pages = [{id:"main-providers"},{id:"main-tasks"}];
  assert.equal(settingsReturnPage("main-providers",pages,{tabs:[{}]}),"main-providers");
  assert.equal(settingsReturnPage("main-terminals",pages,{tabs:[{}]}),"main-terminals");
  assert.equal(settingsReturnPage("main-landing",pages,{tabs:[]}),"main-landing");
  assert.equal(settingsReturnPage("missing",pages,{tabs:[]}),"main-landing");
});
test("settings route cannot be ejected by syncLanding and renders only its Back control", () => {
  const calls=[];
  globalThis.__herdrRun=(name,args)=>calls.push([name,args]);
  globalThis.__herdrProps=()=>({unified:true});
  globalThis.__herdrLayout=()=>({id:"main",active:"main-agents",children:[]});
  globalThis.__herdrSpaces=()=>[{active:true,tabs:[{id:"one"}]}];
  globalThis.__herdrTheme=()=>new Proxy({}, {get:(_t,k)=>String(k)});
  const view=new Tabs();
  view.syncLanding({});
  assert.deepEqual(calls,[]);
  const result=JSON.stringify(view.render({}).__node);
  assert.ok(result.includes("agent-settings-back"));
  assert.ok(!result.includes('"tab-new"'));
  assert.ok(!result.includes('"tab-track"'));
  delete globalThis.__herdrRun;
  delete globalThis.__herdrProps;
  delete globalThis.__herdrLayout;
  delete globalThis.__herdrSpaces;
  delete globalThis.__herdrTheme;
});

const SIDEBAR = { id: "left-sidebar", size: { px: 259 } };
test("settings narrows the unified sidebar once, and leaving restores it once", () => {
  const enter = { open: true, prior: null, unified: true, sidebar: SIDEBAR, busy: false };
  assert.deepEqual(settingsSidebarPlan(enter), { flag: { px: 259 }, show: false, resize: SETTINGS_SIDEBAR_PX });
  assert.equal(settingsSidebarPlan({ ...enter, prior: { px: 259 }, sidebar: { size: { px: SETTINGS_SIDEBAR_PX } } }), null, "no second pass once narrow");
  assert.deepEqual(settingsSidebarPlan({ ...enter, prior: { px: 259 }, sidebar: { size: { px: 160 } } }),
    { flag: { px: 259 }, show: false, resize: SETTINGS_SIDEBAR_PX }, "a reload resumes from the current width");
  assert.deepEqual(settingsSidebarPlan({ ...enter, open: false, prior: { px: 259 } }), { flag: null, show: true, resize: 259 });
  assert.equal(settingsSidebarPlan({ ...enter, open: false }), null, "nothing to undo when it never entered");
});
test("settings leaves the width alone outside unified or without a sidebar", () => {
  for (const over of [{ unified: false }, { sidebar: null }]) {
    const plan = settingsSidebarPlan({ open: true, prior: null, unified: true, sidebar: SIDEBAR, busy: false, ...over });
    assert.deepEqual(plan, { flag: { px: null }, show: false, resize: null });
    assert.deepEqual(settingsSidebarPlan({ open: false, prior: plan.flag, unified: true, sidebar: SIDEBAR, busy: false }), { flag: null, show: true, resize: null });
  }
});
test("hidden and toggle-collapsed sidebars open to the rail and restore their hidden state", () => {
  const flag = { px: 259, hidden: true };
  for (const sidebar of [{ ...SIDEBAR, hidden: true }, { ...SIDEBAR, size: { px: 1 } }]) {
    const enter = { open: true, unified: true, sidebar, wide: 259 };
    assert.deepEqual(settingsSidebarPlan(enter), { flag, show: false, resize: 76 });
    assert.deepEqual(settingsSidebarPlan({ ...enter, prior: { px: null } }), { flag, show: false, resize: 76 });
    assert.deepEqual(settingsSidebarPlan({ ...enter, prior: flag }), { flag, show: false, resize: 76 });
    assert.deepEqual(settingsSidebarPlan({ ...enter, open: false, prior: flag }), { flag: null, show: true, resize: 0 });
    assert.deepEqual(settingsSidebarPlan({ ...enter, unified: false }), { flag: { px: null, hidden: true }, show: false, resize: null });
  }
});
test("a sidebar that is moving blocks both directions until it settles", () => {
  const sidebar = { ...SIDEBAR, size: { px: 40 } };
  assert.equal(settingsSidebarPlan({ open: true, prior: null, unified: true, sidebar, busy: true, wide: 259 }), null);
  assert.deepEqual(settingsSidebarPlan({ open: true, prior: null, unified: true, sidebar, busy: false, wide: 259 }),
    { flag: { px: 259 }, show: false, resize: 76 });
  assert.equal(settingsSidebarPlan({ open: false, prior: { px: 259 }, unified: true, sidebar: SIDEBAR, busy: true }), null);
});
test("settings renders one narrowing motion and restores from the saved width after a reload", async (t) => {
  const log = [], shared = {}, tasks = [];
  let now = 0;
  t.mock.method(Date, "now", () => now);
  let clockTick;
  const cx = {
    spawn: task => tasks.push(task),
    sleep: async ms => { now += ms; if (ms === 120) clockTick?.(); },
    notify() {},
  };
  let layoutTree;
  const sidebar = { ...SIDEBAR, size: { ...SIDEBAR.size } };
  const nav = { id: "nav-top", hidden: false };
  const tree = active => ({ id: "root", children: [sidebar, nav, { id: "main", active }] });
  globalThis.__herdrRun = (name, args) => {
    log.push([name, args]);
    if (name === "layout.resize" && args.id === sidebar.id) sidebar.size.px = args.px;
    const node = args.id === nav.id ? nav : args.id === sidebar.id ? sidebar : null;
    if (node && (name === "layout.show" || name === "layout.hide")) node.hidden = name === "layout.hide";
  };
  globalThis.__herdrSetShared = (key, value) => { log.push(["setShared", key, value]); shared[key] = value; };
  globalThis.__herdrShared = key => shared[key];
  globalThis.__herdrProps = () => ({ unified: true });
  globalThis.__herdrLayout = () => layoutTree;
  globalThis.__herdrSpaces = () => [{ active: true, tabs: [{ id: "one" }] }];
  globalThis.__herdrTheme = () => new Proxy({}, { get: (_t, k) => String(k) });
  try {
    const view = new Tabs();
    view.drawers = { sidebar: { token: 0 } };
    layoutTree = tree("main-agents");
    view.render(cx);
    view.render(cx);
    assert.deepEqual(log, [
      ["setShared", "left-sidebar.settingsPrior", { px: 259 }],
      ["setShared", "left-sidebar.openPx", 259],
    ]);
    assert.equal(tasks.length, 1);
    await tasks.shift()(cx);
    const widths = () => log.filter(([name]) => name === "layout.resize").map(([, args]) => args.px);
    assert.equal(widths().at(-1), SETTINGS_SIDEBAR_PX);
    assert.ok(widths().some(px => px > SETTINGS_SIDEBAR_PX && px < 259));
    assert.deepEqual(shared["left-sidebar.settingsPrior"], { px: 259 });
    assert.deepEqual(log.at(-1), ["layout.hide", { id: "nav-top" }]);

    log.length = 0;
    // A new instance (a restart) sees the persisted flag while settings is closed.
    layoutTree = tree("main-terminals");
    const reloaded = new Tabs();
    reloaded.drawers = { sidebar: { token: 0 } };
    reloaded.syncSettingsSidebar(cx, false, true);
    assert.deepEqual(log, [["layout.show", { id: "nav-top" }]]);
    await tasks.shift()(cx);
    assert.equal(widths().at(-1), 259);
    assert.ok(widths().some(px => px > SETTINGS_SIDEBAR_PX && px < 259));
    assert.deepEqual(log.at(-1), ["setShared", "left-sidebar.settingsPrior", null]);
    assert.equal(shared["left-sidebar.openPx"], 259);

    // Restart while the settings rail was just opening from a previously hidden sidebar.
    log.length = 0;
    globalThis.__herdrProps = () => ({ unified: true, motion: "native", pinSidebarTerminal: true });
    shared["left-sidebar.settingsPrior"] = { px: 259, hidden: true };
    sidebar.hidden = true;
    const restarted = new Tabs();
    restarted.nativeHeaderWidth = 900;
    layoutTree = tree("main-agents");
    assert.match(JSON.stringify(restarted.render(cx).__node), /sidebar-native-clock/);
    const drawer = restarted.drawers.sidebar;
    const driveClock = (first, last) => {
      clockTick = () => {
        drawer.size({ width: first }, cx, restarted.drawerEnv());
        drawer.size({ width: last }, cx, restarted.drawerEnv());
      };
    };
    driveClock(40, 76);
    while (tasks.length) await tasks.shift()(cx);
    assert.equal(sidebar.hidden, false);
    assert.equal(sidebar.size.px, SETTINGS_SIDEBAR_PX);
    assert.equal(shared["left-sidebar.collapsed"], false);
    assert.ok(log.some(([name, args]) => name === "layout.resize" && args.id === "main" && args.px === 824));
    assert.ok(log.some(([name, args]) => name === "layout.resize" && args.id === "main" && args.weight === 1));

    log.length = 0;
    restarted.requestSettingsPage("main-terminals", cx);
    restarted.syncSettingsSidebar(cx, false, true);
    assert.ok(!log.some(([name]) => name === "layout.select"));
    driveClock(40, 1);
    while (tasks.length) await tasks.shift()(cx);
    assert.equal(sidebar.hidden, true);
    assert.equal(sidebar.size.px, 259);
    assert.equal(shared["left-sidebar.collapsed"], true);
    assert.equal(shared["left-sidebar.settingsPrior"], null);
    assert.equal(shared["left-sidebar.openPx"], 259);
    const mainResizes = log.filter(([name, args]) => name === "layout.resize" && args.id === "main");
    assert.deepEqual(mainResizes, [
      ["layout.resize", { id: "main", px: 900 }],
      ["layout.resize", { id: "main", weight: 1 }],
    ]);
    assert.deepEqual(log.at(-2), ["layout.select", { stack: "main", child: "main-terminals" }]);
    assert.deepEqual(log.at(-1), ["setShared", "left-sidebar.settingsAnchor", null]);
    const position = tree => tree.c.findIndex(([method, args]) => method === "child"
      && args[0]?.c?.some(([style, values]) => style === "id" && values[0] === "sidebar-native-clock"));
    const settingsTree = restarted.render(cx).__node;
    layoutTree = tree("main-terminals");
    restarted.stripFrame = () => ({ unified: true, leftPad: 0, bar: "#000", shown: [], w: { platform: "macos" },
      geometry: { arrows: {}, viewportWidth: 0 }, t: globalThis.__herdrTheme() });
    const normalTree = restarted.render(cx).__node;
    assert.equal(settingsTree.n, normalTree.n);
    assert.ok(position(settingsTree) >= 0);
    // Compare child position, separately from the root's styling calls.
    for (const node of [settingsTree, normalTree]) {
      const children = node.c.filter(([method]) => method === "child");
      assert.equal(position({ c: children }), 0);
    }

    log.length = 0;
    sidebar.hidden = false;
    restarted.requestSettingsPage("main-agents", cx);
    restarted.syncSettingsSidebar(cx, true, true);
    driveClock(140, 76);
    while (tasks.length) await tasks.shift()(cx);
    const pin = log.findIndex(([name, args]) => name === "layout.resize" && args.id === "main");
    assert.deepEqual(log.slice(pin, pin + 3), [
      ["layout.resize", { id: "main", px: 824 }],
      ["layout.select", { stack: "main", child: "main-agents" }],
      ["layout.resize", { id: "left-sidebar", px: 140 }],
    ]);
  } finally {
    for (const name of ["Run", "SetShared", "Shared", "Props", "Layout", "Spaces", "Theme"]) delete globalThis[`__herdr${name}`];
  }
});

test("the narrow width follows the window zoom, and keys pressed on the settings page are dropped", () => {
  const plan = settingsSidebarPlan({ open: true, prior: null, unified: true, sidebar: SIDEBAR, busy: false, zoom: 1.25 });
  assert.equal(plan.resize, Math.round(SETTINGS_SIDEBAR_PX * 1.25));
  assert.equal(settingsSidebarPlan({ open: true, prior: { px: 259 }, unified: true, sidebar: { id: "left-sidebar", size: { px: 95 } }, busy: false, zoom: 1.25 }), null);
  globalThis.__herdrRun = () => {};
  globalThis.__herdrSetShared = () => {};
  globalThis.__herdrShared = () => null;
  globalThis.__herdrProps = () => ({ unified: true });
  globalThis.__herdrLayout = () => ({ id: "root", children: [{ id: "main", active: "main-agents" }] });
  globalThis.__herdrSpaces = () => [{ active: true, tabs: [{ id: "one" }] }];
  globalThis.__herdrTheme = () => new Proxy({}, { get: (_t, k) => String(k) });
  try {
    const view = new Tabs();
    view.wantToggle = 2; view.wantPanelToggle = 1;
    view.render({});
    assert.equal(view.wantToggle, 0);
    assert.equal(view.wantPanelToggle, 0);
  } finally {
    for (const name of ["Run", "SetShared", "Shared", "Props", "Layout", "Spaces", "Theme"]) delete globalThis[`__herdr${name}`];
  }
});

test("settings computes the central width for each sidebar geometry", () => {
  assert.equal(settingsHoldPx({ full: 1393, sidebar: 280 }), 1113);
  assert.equal(settingsHoldPx({ full: 1393, sidebar: 76 }), 1317);
  assert.equal(settingsHoldPx({ full: 1393, sidebar: 0, panel: 350 }), 1043);
  assert.equal(settingsHoldPx({ full: 1393, sidebar: 76, panel: 350 }), 967);
  assert.equal(settingsHoldPx({ full: 0, sidebar: 280 }), null);
});
