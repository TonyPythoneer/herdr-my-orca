// Flow tests for the header strip: the real handlers run against a small model of the host.
// Handlers are called with their own context, never the one the render got, because the render's
// context is dead once a click arrives.
import test from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
// Keep real handlers on the recorded tree so tests can dispatch pointer and key events.
registerHooks({
  load(url, context, next) {
    const result = next(url, context);
    if (!url.startsWith("stub:gpui-")) return result;
    return { ...result, source: result.source.replace('return "fn";', 'return a;') };
  },
  resolve(name, context, next) {
    const result = next(name, context);
    if (name !== "herdr") return result;
    const source = `export * from ${JSON.stringify(result.url)};
      export const panes = () => globalThis.host.panes;
      export const terminals = () => globalThis.host.terminals;
      export const window = () => globalThis.host.window;
      export const settings = () => globalThis.host.settings;
      export const nextCommand = () => globalThis.host.nextCommand();
      export const openOverlay = (spec) => globalThis.host.openOverlay(spec);
      export const setShared = (key, value) => globalThis.host.setShared(key, value);
      export const writeTextFile = async (path, text) => { globalThis.host.files.set(path, text); };
    `;
    return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
  },
});
const { default: Tabs } = await import("./main.js");

const THEME = { surface: "#s", background: "#b", foreground: "#f", muted: "#m", dim: "#d", popover: "#p", border: "#bo", solid: "#so", solid_foreground: "#sf", input: "#i", raised: "#r", hover: "#h" };
const END = new Error("end of command stream");
const tab = (id, extra = {}) => ({ id, name: `Tab ${id}`, status: "idle", ...extra });
const pane = (id, tabId, extra = {}) => ({ pane: id, tab: tabId, terminal: `tty-${id}`, title: `title ${id}`, ...extra });
const find = (node, id) => (node.id === id ? node : (node.children ?? []).map((c) => find(c, id)).find(Boolean));

function contextFactory(w) {
  return (label) => ({
    label,
    notify: () => w.log.push(["notify", label]),
    stop_propagation: () => w.log.push(["stop", label]),
    focus_handle: () => ({ focus: () => w.log.push(["focus", label]) }),
    spawn: (fn) => { w.tasks.push({ fn, label }); },
    sleep: async (ms) => { w.clock += ms; },
    timer: {
      every: (ms, fn) => { const timer = { ms, fn, label, cancelled: false, cancel() { this.cancelled = true; } }; w.timers.push(timer); return timer; },
      after: (ms, fn) => { const timer = { ms, fn, after: true, label, cancelled: false, cancel() { this.cancelled = true; } }; w.timers.push(timer); return timer; },
    },
  });
}

// The host: a mutable layout that answers resize/show/hide, a pane list, shared values and the
// timers and tasks a view asks for. Time only moves when a task sleeps.
function setup(t, o = {}) {
  const w = {
    log: [], files: new Map(), shared: { ...o.shared }, timers: [], tasks: [], clock: 1_700_000_000_000,
    panes: o.panes ?? [], terminals: o.terminals ?? [], window: o.window, settings: o.settings ?? {}, commands: [...(o.commands ?? [])],
    spaces: o.spaces ?? [{ id: "s1", active: true, folder: "/proj", tabs: [tab("a", { active: true }), tab("b"), tab("c")] }],
    layout: { id: "root", children: [{ id: "left-sidebar", size: { px: 259 } }, { id: "main", size: { px: 900 }, active: "main-terminals" },
      { id: "panel", size: { px: 350 } }, { id: "panel-body", active: "files" }, { id: "status", size: { px: 24 } }], ...o.layout },
    keepResult: o.keepResult,
  };
  const realNow = Date.now;
  Date.now = () => w.clock;
  const stored = new Map(Object.entries(o.storage ?? {}));
  globalThis.localStorage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); w.log.push(["storage", key, value]); } };
  w.storage = stored;
  w.host = globalThis.host = {
    panes: w.panes, terminals: w.terminals, window: w.window, settings: w.settings, files: w.files,
    nextCommand: async () => { if (w.commands.length) return w.commands.shift(); throw END; },
    openOverlay: (spec) => { w.log.push(["openOverlay", spec]); return "overlay-1"; },
    setShared: (key, value) => {
      const copy = value == null ? null : structuredClone(value);
      // Every settled render republishes the open widths; only the test that is about them logs them.
      if (o.logOpenPx || !key.endsWith(".openPx")) w.log.push(["setShared", key, copy]);
      w.shared[key] = copy ?? undefined;
    },
  };
  globalThis.__herdrProps = () => o.props ?? {};
  globalThis.__herdrTheme = () => THEME;
  globalThis.__herdrSpaces = () => w.spaces;
  globalThis.__herdrLayout = () => w.layout;
  globalThis.__herdrShared = (key) => w.shared[key];
  globalThis.__herdrCloseOverlay = (id) => w.log.push(["closeOverlay", id]);
  globalThis.__herdrRun = (command, args) => {
    w.log.push(["run", command, args]);
    const node = args?.id && find(w.layout, args.id);
    if (node && command === "layout.hide") node.hidden = true;
    if (node && command === "layout.show") node.hidden = false;
    if (node && command === "layout.resize" && args.px != null) node.size = { px: args.px };
    return command === "terminal.keep" ? w.keepResult : undefined;
  };
  const cxOf = contextFactory(w);
  w.cxOf = cxOf;
  w.cx = cxOf("render");
  w.hcx = cxOf("handler");
  w.calls = (name) => w.log.filter(([kind, command]) => kind === "run" && command === name).map(([, , args]) => args);
  w.runLog = () => w.log.filter(([kind]) => kind === "run").map(([, command, args]) => [command, args]);
  w.runTasks = async (cx = w.hcx) => { while (w.tasks.length) await w.tasks.shift().fn(cx); };
  w.view = new Tabs();
  w.view.init(o.initProps ?? {}, w.cx);
  w.loop = w.tasks.shift(); // the command loop, when this copy of the view runs one
  w.render = () => w.view.render(w.cx).__node;
  t.after(() => {
    // A drag leaves a module-level record and a poll timer: end it the way the timer would.
    w.shared = {};
    for (const timer of w.timers) if (timer.ms === 16 && !timer.cancelled) timer.fn(w.cx);
    Date.now = realNow;
    delete globalThis.window;
    for (const key of ["host", "localStorage", "__herdrProps", "__herdrTheme", "__herdrSpaces", "__herdrLayout", "__herdrShared", "__herdrCloseOverlay", "__herdrRun"]) delete globalThis[key];
  });
  return w;
}

function nodes(root) {
  const children = root.c.flatMap(([method, args]) => {
    if (method === "child") return args;
    if (method === "children") return args[0];
    return [];
  });
  return [root, ...children.filter((child) => child?.c).flatMap(nodes)];
}
const has = (node, method, value) => node.c.some(([key, args]) => key === method && args[0] === value);
const byId = (tree, id) => nodes(tree).find((n) => has(n, "id", id));
const handler = (node, method, button) => node.c.find(([key, args]) =>
  key === method && (button === undefined || args[0] === button))[1].at(-1);
const hasHandler = (node, method, button) => node.c.some(([key, args]) => key === method && (button === undefined || args[0] === button));
// The pill is the tab slot's child that carries the pointer handlers.
const pillOf = (tree, id) => nodes(byId(tree, id)).find((n) => hasHandler(n, "on_mouse_up", "left"));
const event = (extra = {}) => ({ position: { x: 10, y: 10 }, bounds: { x: 0, y: 0, width: 144, height: 36 }, ...extra });
const mouse = (w, node, method, button, e = event()) => handler(node, method, button)(e, w.hcx);
const notified = (w, label) => w.log.filter(([kind, who]) => kind === "notify" && who === label).length;
const viewport = () => { globalThis.window = { viewport_size: () => ({ width: 1200, height: 800 }), mouse_position: () => globalThis.window.at }; };
const traces = (w, name) => [...w.files].filter(([path]) => path.endsWith(`-${name}.json`)).map(([, text]) => JSON.parse(text).detail);

test("commands open a tab in the active space and the toggles are counted for the render", async (t) => {
  const w = setup(t, { commands: ["new-tab", "toggle-sidebar", "toggle-panel", "toggle-sidebar", "other"] });
  await assert.rejects(w.loop.fn(w.hcx), (error) => error === END);
  assert.deepEqual(w.runLog(), [["tab.new", { space: "s1", folder: "/proj" }]]);
  assert.equal(w.view.wantToggle, 2);
  assert.equal(w.view.wantPanelToggle, 1);
  assert.equal(notified(w, "handler"), 3);
});

test("the window is read again until it is published, then cached and repainted", async (t) => {
  const w = setup(t);
  assert.equal(w.timers[0].ms, 0);
  w.timers.shift().fn(w.hcx);
  for (let tries = 0; tries < 20; tries++) {
    assert.equal(w.timers.at(-1).ms, 50);
    w.timers.shift().fn(w.hcx);
  }
  assert.equal(w.timers.length, 0, "gives up after twenty tries");
  const late = setup(t);
  late.timers.shift().fn(late.hcx);
  late.host.window = { platform: "linux" };
  late.timers.shift().fn(late.hcx);
  assert.deepEqual(late.view.windowState, { platform: "linux" });
  assert.equal(notified(late, "handler"), 1);
  const seeded = setup(t, { window: { platform: "macos" } });
  assert.equal(seeded.timers.length, 0);
});

test("a stored panel map is read, and a broken one is replaced by an empty map", (t) => {
  assert.deepEqual(setup(t, { storage: { panels: '{"s1":"git"}' } }).view.panels, { s1: "git" });
  assert.deepEqual(setup(t, { storage: { panels: "oops" } }).view.panels, {});
  assert.deepEqual(setup(t, { storage: { panels: "7" } }).view.panels, {});
});

test("tab labels fall back from the tab name to the pane title, the program and Terminal", (t) => {
  const w = setup(t, { panes: [pane("p1", "a", { program: { agent: true, name: "Codex" }, title: "✳ Build" }), pane("p2", "b", { title: "" , program: { name: "zsh" } })], terminals: [{ address: "tty-p2", argv: ["freebuff"] }] });
  const label = (c, ...rest) => w.view.getTabLabel(c, ...rest);
  assert.equal(label({ id: "a", named: true, name: "Mine" }), "Mine");
  assert.equal(label({ id: "a", name: "Tab a" }), "Build", "an agent's title loses its leading glyph");
  assert.equal(label({ id: "b", name: "Tab b" }), "freebuff", "an unofficial CLI keeps its name");
  assert.equal(label({ id: "x" }), "Terminal");
  assert.equal(label({ id: "x" }, null, { name: "tool" }), "tool");
  assert.equal(label({ id: "x" }, { title: "T", program: { name: "P" } }, null), "T");
  assert.equal(label({ id: "x" }, { program: { name: "P" } }, null), "P");
  assert.equal(w.view.unofficialApp(null), null);
  assert.equal(w.view.unofficialApp({ app: "freebuff" }).name, "freebuff");
  assert.equal(w.view.unofficialApp({ terminal: "tty-p2", program: { agent: true } }), null, "an official agent always wins");
});

test("a pinned tab asks before closing, an unpinned one closes at once", (t) => {
  const w = setup(t);
  w.view.requestCloseTab({ id: "a", name: "Tab a" });
  assert.deepEqual(w.runLog(), [["tab.close", { id: "a" }]]);
  w.log.length = 0;
  w.view.requestCloseTab({ id: "b", name: "Tab b", settled: true });
  assert.deepEqual(w.log, [["openOverlay", { mod: "orca-tabs", kind: "dialog", modal: true, width: 384, height: 200, props: { confirmClose: { kind: "pinned", tabId: "b", tabLabel: "Tab b" } } }]]);
  w.log.length = 0;
  w.storage.set("orca.confirmClosePinnedTab", "false");
  w.view.requestCloseTab({ id: "b", settled: true });
  assert.deepEqual(w.runLog(), [["tab.close", { id: "b" }]]);
  delete globalThis.localStorage;
  w.log.length = 0;
  w.view.requestCloseTab({ id: "b", settled: true });
  assert.equal(w.log[0][0], "openOverlay", "an unreadable store counts as ask");
});

test("the close dialog confirms on enter and cancels on escape, remembering the choice by kind", async (t) => {
  const confirmClose = { kind: "pinned", tabId: "b", tabLabel: "pin" };
  const w = setup(t, { props: { confirmClose, overlay: "ov" }, initProps: { confirmClose } });
  assert.equal(w.view.isDialog, true);
  const tree = () => w.render();
  const key = (name) => handler(tree(), "on_key_down")({ key: name }, w.hcx);
  key("x");
  assert.deepEqual(w.log.filter(([kind]) => kind !== "focus"), []);
  key("escape");
  assert.deepEqual(w.log.filter(([kind]) => kind !== "focus"), [["stop", "handler"], ["closeOverlay", "ov"]]);
  w.log.length = 0;
  key("enter");
  assert.deepEqual(w.log, [["stop", "handler"], ["closeOverlay", "ov"], ["run", "tab.close", { id: "b" }]]);
  assert.equal(w.storage.has("orca.confirmClosePinnedTab"), false);
  const checkbox = nodes(tree()).find((n) => hasHandler(n, "on_click") && n.c.some(([k]) => k === "cursor_pointer"));
  w.log.length = 0;
  handler(checkbox, "on_click")({}, w.hcx);
  assert.equal(w.view.dontAskAgain, true);
  assert.deepEqual(w.log, [["notify", "handler"]]);
  handler(byId(tree(), "close-confirm"), "on_click")({}, w.hcx);
  assert.equal(w.storage.get("orca.confirmClosePinnedTab"), "false");
  handler(byId(tree(), "close-cancel"), "on_click")({}, w.hcx);
  assert.deepEqual(w.log.at(-1), ["closeOverlay", "ov"]);
});

test("the close dialog's remembered choice and bulk close follow the dialog kind", (t) => {
  const run = (cfg, again = true) => {
    const w = setup(t, { props: { confirmClose: cfg, overlay: "ov" }, initProps: { confirmClose: cfg }, state: {},
      spaces: [{ id: "s1", active: true, tabs: [tab("a"), tab("b")] }, { id: "s2", folder: "/two", tabs: [tab("c")] }] });
    w.view.dontAskAgain = again;
    handler(byId(w.render(), "close-confirm"), "on_click")({}, w.hcx);
    return w;
  };
  assert.equal(run({ kind: "agent", tabId: "a" }).storage.get("orca.skipCloseTerminalWithRunningProcessConfirm"), "true");
  assert.equal(run({ tabId: "a" }).storage.get("orca.skipCloseTerminalWithRunningProcessConfirm"), "true");
  assert.equal(run({ kind: "agent", tabId: "a" }, false).storage.size, 0);
  assert.equal(run({ kind: "bulk", tabIds: ["a"] }).storage.size, 0, "bulk never remembers");
  const bulk = run({ kind: "bulk", tabIds: ["a", "b"] });
  assert.deepEqual(bulk.runLog(), [["tab.new", { space: "s1", focus: false }], ["tab.close", { id: "a" }], ["tab.close", { id: "b" }]]);
  assert.deepEqual(run({ kind: "command" }).runLog(), [], "no target closes nothing");
});

test("the dialog copy depends on kind and bulk scope, and bulk hides the checkbox", (t) => {
  const texts = (cfg) => {
    const w = setup(t, { props: { confirmClose: cfg, overlay: "ov" }, initProps: { confirmClose: cfg } });
    const found = nodes(w.render()).flatMap((n) => n.c.filter(([key, args]) => key === "child" && typeof args[0] === "string").map(([, args]) => args[0]));
    return found;
  };
  assert.deepEqual(texts({}).slice(0, 2), ["Stop running command?", "Closing this terminal will stop the command running inside it."]);
  assert.ok(texts({ kind: "agent" }).includes("Stop Agent"));
  assert.ok(texts({ kind: "pinned" }).includes("Close"));
  assert.equal(texts({ kind: "bulk", scope: "others", tabIds: ["a"] })[0], "Close other tabs?");
  assert.equal(texts({ kind: "bulk", scope: "right" })[0], "Close tabs to the right?");
  assert.equal(texts({ kind: "bulk", scope: "left" })[0], "Close tabs to the left?");
  assert.equal(texts({ kind: "bulk" })[0], "Close tabs?");
  assert.equal(texts({ kind: "bulk", tabIds: ["a", "b"] })[1], "2 tabs will be closed. Pinned tabs will stay open.");
  assert.equal(texts({ kind: "bulk", tabIds: ["a"] })[1], "1 tab will be closed. Pinned tabs will stay open.");
  assert.equal(texts({ kind: "bulk" }).includes("Don't ask again for running terminals"), false);
  assert.ok(texts({ kind: "pinned" }).includes("Don't ask again for pinned tabs"));
});

test("a tab press, move and release reorders along the strip and selects on a plain click", (t) => {
  const w = setup(t, { panes: [pane("p1", "a"), pane("p2", "b"), pane("p3", "c")] });
  const slot = (id) => pillOf(w.render(), `tab-${id}`);
  mouse(w, slot("a"), "on_mouse_down", "left", event({ click_count: 2 }));
  assert.deepEqual([w.view.pressed, w.view.overTab, w.view.dragTab, w.view.dragTerminal, w.view.dragPane], [0, "a", "a", "tty-p1", "p1"]);
  assert.deepEqual(w.calls("tab.rename"), [{ id: "a" }]);
  assert.equal(notified(w, "handler"), 1);
  // Moving over tab c's right half marks the insertion point once.
  w.log.length = 0;
  mouse(w, slot("c"), "on_mouse_move", undefined, event({ local_position: { x: 100 } }));
  mouse(w, slot("c"), "on_mouse_move", undefined, event({ local_position: { x: 100 } }));
  assert.deepEqual([w.view.overTab, w.view.overSide], ["c", "right"]);
  assert.equal(notified(w, "handler"), 1);
  mouse(w, slot("c"), "on_mouse_up", "left");
  assert.deepEqual(w.calls("tab.move"), [{ id: "a", index: 3 }]);
  assert.deepEqual([w.view.pressed, w.view.overTab, w.view.overSide], [null, null, null]);
  // Dropping on the left half of the neighbour keeps the order, so it is a plain click there.
  mouse(w, slot("a"), "on_mouse_down", "left");
  mouse(w, slot("b"), "on_mouse_move", undefined, event({ local_position: { x: 10 } }));
  w.log.length = 0;
  mouse(w, slot("b"), "on_mouse_up", "left");
  assert.deepEqual(w.runLog(), [["tab.select", { id: "b" }], ["layout.select", { stack: "main", child: "main-terminals" }]]);
  w.log.length = 0;
  mouse(w, slot("b"), "on_mouse_up", "left");
  assert.deepEqual(w.log, [], "a release with no press does nothing");
  mouse(w, slot("c"), "on_mouse_down", "left");
  mouse(w, slot("a"), "on_mouse_move", undefined, event({ local_position: { x: 10 } }));
  mouse(w, slot("a"), "on_mouse_up", "left");
  assert.deepEqual(w.calls("tab.move").at(-1), { id: "c", index: 1 });
});

test("a tab's hover, middle click, right click, close and collapse buttons act on that tab", (t) => {
  const w = setup(t, { spaces: [{ id: "s1", active: true, tabs: [tab("a", { active: true, zoomed: true }), tab("b", { settled: true })] }], panes: [pane("p1", "a", { zoomed: true }), pane("p2", "b")] });
  const slot = (id) => pillOf(w.render(), `tab-${id}`);
  handler(slot("b"), "on_hover")(true, w.hcx);
  assert.equal(w.view.hoveredTab, "b");
  handler(slot("b"), "on_hover")(true, w.hcx);
  assert.equal(notified(w, "handler"), 1);
  handler(slot("a"), "on_hover")(false, w.hcx);
  assert.equal(w.view.hoveredTab, "b", "leaving another tab keeps the hover");
  handler(slot("b"), "on_hover")(false, w.hcx);
  assert.equal(w.view.hoveredTab, null);
  w.log.length = 0;
  mouse(w, slot("a"), "on_mouse_down", "middle");
  assert.deepEqual(w.log, [["stop", "handler"], ["run", "tab.close", { id: "a" }]]);
  w.log.length = 0;
  mouse(w, slot("a"), "on_mouse_down", "right");
  assert.deepEqual(w.log, [["stop", "handler"], ["openOverlay", { mod: "orca-menu", kind: "popup", width: 272, props: { tab: "tab", target: { id: "a", space: "s1" } } }]]);
  w.log.length = 0;
  handler(byId(w.render(), "close-a"), "on_click")({}, w.hcx);
  assert.deepEqual(w.runLog(), [["tab.close", { id: "a" }]]);
  assert.equal(byId(w.render(), "close-b"), undefined, "a pinned tab has no close button");
  w.log.length = 0;
  handler(byId(w.render(), "collapse-a"), "on_click")({}, w.hcx);
  assert.deepEqual(w.runLog(), [["pane.zoom", { pane: "p1" }]]);
  w.panes[0].zoomed = false;
  w.log.length = 0;
  handler(byId(w.render(), "collapse-a"), "on_click")({}, w.hcx);
  assert.deepEqual(w.runLog(), []);
  w.log.length = 0;
  handler(byId(w.render(), "tab-a"), "on_size_change")({ width: 200 }, w.hcx);
  handler(byId(w.render(), "tab-a"), "on_size_change")({ width: 200.3 }, w.hcx);
  assert.equal(w.view.tabWidths.get("a"), 200);
  assert.equal(notified(w, "handler"), 1, "a width that did not change is not a repaint");
});

test("the strip's own handlers measure, scroll, reveal the active tab and slide for arrows", (t) => {
  const w = setup(t, { spaces: [{ id: "s1", active: true, tabs: ["a", "b", "c", "d", "e"].map((id, i) => tab(id, { active: i === 4 })) }] });
  const first = w.render();
  const viewportNode = nodes(first).find((n) => hasHandler(n, "on_scroll_wheel"));
  handler(viewportNode, "on_size_change")({ width: 300 }, w.hcx);
  handler(viewportNode, "on_size_change")({ width: 300.2 }, w.hcx);
  assert.equal(w.view.viewportWidth, 300);
  for (const id of ["a", "b", "c", "d", "e"]) w.view.measureTabWidth(id, 144, w.hcx);
  w.render();
  assert.equal(w.view.contentWidth, 720);
  assert.equal(w.view.scrollX, 420, "a newly active tab is brought into view");
  w.log.length = 0;
  handler(viewportNode, "on_scroll_wheel")({ delta: { x: 0, y: -50 } }, w.hcx);
  assert.equal(w.view.scrollX, 370);
  handler(viewportNode, "on_scroll_wheel")({ delta: { x: 30, y: 5 } }, w.hcx);
  assert.equal(w.view.scrollX, 400);
  handler(viewportNode, "on_scroll_wheel")({ delta: {} }, w.hcx);
  handler(viewportNode, "on_scroll_wheel")({}, w.hcx);
  assert.equal(w.view.scrollX, 400);
  w.view.animatedUntil = 1;
  handler(viewportNode, "on_scroll_wheel")({ delta: { x: 1000 } }, w.hcx);
  assert.equal(w.view.scrollX, 420, "clamped at the end");
  assert.equal(w.view.animatedUntil, 0, "real input is not a slide");
  assert.equal(w.view.sliding(), false);
  const tree = w.render();
  const left = byId(tree, "tab-scroll-start-g0");
  w.log.length = 0;
  handler(left, "on_click")({}, w.hcx);
  assert.equal(notified(w, "handler"), 1, "the arrow must notify through its click context");
  assert.equal(notified(w, "render"), 0);
  assert.equal(w.view.scrollX, 195, "three quarters of the viewport");
  assert.equal(w.view.sliding(), true);
  handler(byId(w.render(), "tab-scroll-end-g0"), "on_click")({}, w.hcx);
  assert.equal(w.view.scrollX, 420);
  w.view.scrollX = 0;
  w.render();
  handler(byId(w.render(), "tab-scroll-start-g0"), "on_click")({}, w.hcx);
  assert.equal(w.view.scrollX, 0, "a disabled arrow does nothing");
  // A tab that vanished stops counting toward the width.
  w.spaces[0].tabs.pop();
  w.render();
  assert.equal(w.view.tabWidths.has("e"), false);
});

test("pressing a tab and dragging down hands over to a drop overlay and the poll resolves a release", async (t) => {
  viewport();
  const w = setup(t, { panes: [pane("p1", "a"), pane("p2", "b"), pane("p3", "c")] });
  mouse(w, pillOf(w.render(), "tab-b"), "on_mouse_down", "left", event({ position: { x: 5, y: 10 } }));
  const strip = event().bounds;
  assert.equal(w.view.triggerSplit(strip, { x: 5, y: 15 }, w.hcx), false, "below the activation distance");
  const root = w.render();
  w.log.length = 0;
  handler(root, "on_mouse_move")({ position: { x: 5, y: 40 } }, w.hcx);
  assert.deepEqual(w.view.pressed, null);
  const record = { tab: "b", terminal: "tty-p2", pane: "p2", strip: { x: 259, y: 0, width: 591, height: 776, stripHeight: 36 } };
  assert.deepEqual(w.log.slice(0, 2), [
    ["setShared", "orca-tabs.drop", record],
    ["openOverlay", { mod: "orca-tabs", kind: "popup", frame: "none", at: { x: 259, y: 36 }, width: 591, height: 740, props: { drop: true } }],
  ]);
  assert.deepEqual(w.log[2], ["setShared", "orca-tabs.drop", { ...record, overlay: "overlay-1" }]);
  assert.equal(notified(w, "handler"), 1);
  const poll = w.timers.find((timer) => timer.ms === 16);
  // The pointer sits in the left band of the body: the zone is published once, then the release is inferred.
  globalThis.window.at = { x: 300, y: 400 };
  poll.fn(w.hcx);
  assert.deepEqual(w.shared["orca-tabs.drop"].zone, "left");
  w.log.length = 0;
  for (let tick = 0; tick < 20; tick++) poll.fn(w.hcx);
  assert.equal(poll.cancelled, true);
  assert.deepEqual(w.log, [
    ["setShared", "orca-tabs.drop", null], ["closeOverlay", "overlay-1"], ["run", "terminal.park", { terminal: "tty-p2" }],
  ]);
  assert.deepEqual(traces(w, "resolve"), [{ zone: "left" }]);
  assert.equal(w.timers.filter((timer) => timer.ms === 16).length, 2, "a keep timer waits for the park");
});

test("the poll waits for a pointer outside the panel, stops without a record and honours a release", (t) => {
  viewport();
  const w = setup(t, { panes: [pane("p1", "a"), pane("p2", "b")] });
  Object.assign(w.view, { pressed: 0, pressAt: { x: 0, y: 0 }, dragTab: "a", dragTerminal: "tty-p1", dragPane: "p1" });
  assert.equal(w.view.triggerSplit(event().bounds, { x: 0, y: 20 }, w.hcx), true);
  assert.equal(w.view.triggerSplit(event().bounds, { x: 0, y: 40 }, w.hcx), false, "a record is already in flight");
  const poll = w.timers.find((timer) => timer.ms === 16);
  globalThis.window.at = { x: 5, y: 5 };
  w.log.length = 0;
  for (let tick = 0; tick < 25; tick++) poll.fn(w.hcx);
  assert.deepEqual(w.log, [], "outside the panel nothing is published or resolved");
  globalThis.window.at = { x: 500, y: 20 };
  for (let tick = 0; tick < 25; tick++) poll.fn(w.hcx);
  assert.equal(poll.cancelled, false, "inside the strip band is not a drop");
  assert.equal(w.log.some(([kind, name]) => kind === "closeOverlay"), false);
  w.shared["orca-tabs.drop"] = { ...w.shared["orca-tabs.drop"], released: "up" };
  w.log.length = 0;
  poll.fn(w.hcx);
  assert.deepEqual(w.runLog(), [["terminal.park", { terminal: "tty-p1" }]]);
  assert.equal(poll.cancelled, true);
  const ended = [];
  w.shared = {};
  poll.fn({ ...w.hcx, timer: { every: () => ended.push("x") } });
  assert.deepEqual(ended, []);
});

test("a pointer that is unavailable leaves the poll idle", (t) => {
  viewport();
  const w = setup(t, { panes: [pane("p1", "a"), pane("p2", "b")] });
  Object.assign(w.view, { pressed: 0, pressAt: { x: 0, y: 0 }, dragTab: "a", dragTerminal: "tty-p1", dragPane: "p1" });
  w.view.triggerSplit(event().bounds, { x: 0, y: 20 }, w.hcx);
  globalThis.window.at = null;
  w.log.length = 0;
  w.timers.find((timer) => timer.ms === 16).fn(w.hcx);
  assert.deepEqual(w.log, []);
  assert.equal(w.view.triggerSplit(null, { x: 0, y: 40 }, w.hcx), false);
});

test("a split drop parks the terminal, keeps it beside the active tab and swaps it for left and up", (t) => {
  const w = setup(t, { panes: [pane("p1", "a", { focused: true }), pane("p2", "b")], keepResult: { pane: "new" } });
  const every = () => w.timers.filter((timer) => timer.ms === 16 && !timer.cancelled);
  w.shared["orca-tabs.action"] = { kind: "move-tab-split", tab: "b", direction: "left" };
  w.log.length = 0;
  w.render();
  assert.deepEqual(w.log.slice(0, 2), [["setShared", "orca-tabs.action", null], ["run", "terminal.park", { terminal: "tty-p2" }]]);
  const keep = every()[0];
  keep.fn(w.hcx);
  assert.equal(keep.cancelled, false, "the pane is still there");
  w.panes.splice(1, 1);
  keep.fn(w.hcx);
  assert.equal(keep.cancelled, true);
  assert.deepEqual(w.calls("terminal.keep"), [{ terminal: "tty-p2", place: "right" }]);
  assert.deepEqual(traces(w, "move-keep"), [{ terminal: "tty-p2", place: "right", res: { pane: "new" } }]);
  const swap = every().at(-1);
  swap.fn(w.hcx);
  assert.equal(swap.cancelled, false, "the new pane is not mounted yet");
  w.panes.push(pane("new", "a", { terminal: "tty-p2" }));
  swap.fn(w.hcx);
  assert.equal(swap.cancelled, true);
  assert.deepEqual(w.calls("pane.swap"), [{ direction: "left", pane: "new" }]);
  assert.deepEqual(traces(w, "move-swap"), [{ pane: "new", direction: "left" }]);
});

test("dropping a group's only tab on its own panel does nothing", (t) => {
  const w = setup(t, { panes: [pane("p1", "a", { focused: true })], spaces: [{ id: "s1", active: true, tabs: [tab("a", { active: true })] }] });
  w.shared["orca-tabs.action"] = { kind: "move-tab-split", tab: "a", direction: "left" };
  w.render();
  assert.deepEqual(w.calls("terminal.park"), []);
});

test("a split drop gives up when the park never finishes and skips the swap for right and down", (t) => {
  const w = setup(t, { panes: [pane("p1", "a", { focused: true }), pane("p2", "b")] });
  w.shared["orca-tabs.action"] = { kind: "move-tab-split", tab: "b", direction: "up" };
  w.render();
  const keep = w.timers.find((timer) => timer.ms === 16);
  for (let tick = 0; tick < 60; tick++) keep.fn(w.hcx);
  assert.equal(keep.cancelled, true);
  assert.deepEqual(w.calls("terminal.keep"), []);
  assert.deepEqual(traces(w, "move-park-timeout"), [{ terminal: "tty-p2" }]);
  const down = setup(t, { panes: [pane("p1", "a", { focused: true }), pane("p2", "b")] });
  down.shared["orca-tabs.action"] = { kind: "move-tab-split", tab: "b", direction: "down" };
  down.render();
  down.panes.splice(1, 1);
  down.timers.find((timer) => timer.ms === 16).fn(down.hcx);
  assert.deepEqual(down.calls("terminal.keep"), [{ terminal: "tty-p2", place: "down" }]);
  assert.equal(down.timers.filter((timer) => timer.ms === 16).length, 1, "no swap timer");
  const unknown = setup(t, { panes: [] });
  unknown.shared["orca-tabs.action"] = { kind: "move-tab-split", tab: "zzz", direction: "left" };
  unknown.render();
  assert.deepEqual(unknown.runLog().filter(([command]) => command === "terminal.park"), []);
});

test("swap without a named pane finds the terminal's pane and gives up when it never mounts", (t) => {
  const w = setup(t, { panes: [pane("p1", "a", { focused: true }), pane("p2", "b")] });
  w.shared["orca-tabs.action"] = { kind: "move-tab-split", tab: "b", direction: "up" };
  w.render();
  w.panes.splice(1, 1);
  w.timers.find((timer) => timer.ms === 16).fn(w.hcx);
  const swap = w.timers.filter((timer) => timer.ms === 16).at(-1);
  for (let tick = 0; tick < 59; tick++) swap.fn(w.hcx);
  assert.equal(swap.cancelled, false);
  swap.fn(w.hcx);
  assert.equal(swap.cancelled, true);
  assert.deepEqual(w.calls("pane.swap"), []);
  const found = setup(t, { panes: [pane("p1", "a", { focused: true }), pane("p2", "b")] });
  found.shared["orca-tabs.action"] = { kind: "move-tab-split", tab: "b", direction: "up" };
  found.render();
  found.panes.splice(1, 1);
  found.timers.find((timer) => timer.ms === 16).fn(found.hcx);
  found.panes.push(pane("later", "a", { terminal: "tty-p2" }));
  found.timers.filter((timer) => timer.ms === 16).at(-1).fn(found.hcx);
  assert.deepEqual(found.calls("pane.swap"), [{ direction: "up", pane: "later" }]);
});

test("a pane dragged out of a split becomes its own tab once it has been parked", (t) => {
  const w = setup(t, { panes: [pane("p1", "a", { focused: true }), pane("p2", "a")] });
  w.shared["orca-tabs.action"] = { kind: "unsplit-to-tab", pane: "p2" };
  w.log.length = 0;
  w.render();
  assert.deepEqual(w.log.slice(0, 2), [["setShared", "orca-tabs.action", null], ["run", "terminal.park", { terminal: "tty-p2" }]]);
  const keep = w.timers.find((timer) => timer.ms === 16);
  keep.fn(w.hcx);
  assert.equal(keep.cancelled, false);
  w.panes.splice(1, 1);
  keep.fn(w.hcx);
  assert.deepEqual(w.calls("terminal.keep"), [{ terminal: "tty-p2", place: "tab" }]);
  assert.deepEqual(traces(w, "unsplit-keep"), [{ terminal: "tty-p2" }]);
  const stuck = setup(t, { panes: [pane("p1", "a"), pane("p2", "a")] });
  stuck.shared["orca-tabs.action"] = { kind: "unsplit-to-tab", terminal: "tty-p1" };
  stuck.render();
  const retry = stuck.timers.find((timer) => timer.ms === 16);
  for (let tick = 0; tick < 60; tick++) retry.fn(stuck.hcx);
  assert.equal(retry.cancelled, true);
  assert.deepEqual(traces(stuck, "unsplit-park-timeout"), [{ terminal: "tty-p1" }]);
  const nothing = setup(t, { panes: [] });
  nothing.shared["orca-tabs.action"] = { kind: "unsplit-to-tab", pane: "ghost" };
  nothing.render();
  assert.deepEqual(nothing.runLog().filter(([command]) => command === "terminal.park"), []);
  const other = setup(t);
  other.shared["orca-tabs.action"] = { kind: "unknown" };
  other.render();
  assert.deepEqual(other.runLog().filter(([command]) => command === "terminal.park"), []);
});

test("a pane drag released over the strip unsplits it; any other release clears the press", (t) => {
  const w = setup(t, { panes: [pane("p1", "a"), pane("p2", "a")] });
  w.shared["orca-tabs.pane-drag"] = { active: true, terminal: "tty-p2", pane: "p2" };
  const strip = w.render();
  w.log.length = 0;
  handler(strip, "on_mouse_up", "left")({}, w.hcx);
  assert.deepEqual(w.log.slice(0, 2), [["setShared", "orca-tabs.pane-drag", null], ["run", "terminal.park", { terminal: "tty-p2" }]]);
  assert.equal(notified(w, "handler"), 1);
  Object.assign(w.view, { pressed: 1, overTab: "b", overSide: "left" });
  w.shared["orca-tabs.drop"] = { tab: "a", overlay: "ov" };
  const again = w.render();
  w.log.length = 0;
  handler(again, "on_mouse_up", "left")({}, w.hcx);
  assert.deepEqual(w.log, [["closeOverlay", "ov"], ["setShared", "orca-tabs.drop", null], ["notify", "handler"]]);
  assert.deepEqual([w.view.pressed, w.view.overTab, w.view.overSide], [null, null, null]);
  // A plain move over the strip only hands over while a tab is pressed.
  const idle = w.render();
  w.log.length = 0;
  handler(idle, "on_mouse_move")({ position: { x: 0, y: 0 } }, w.hcx);
  assert.deepEqual(w.log, []);
  w.view.pressed = 0;
  w.view.stripBounds = { x: 0, y: 0, width: 10, height: 36 };
  handler(idle, "on_mouse_move")({ position: { x: 0, y: 0 } }, w.hcx);
  assert.deepEqual(w.log, [], "a press that has not travelled far enough stays on the strip");
});

test("the drop overlay follows the pointer, takes the release and closes on escape", (t) => {
  const record = { tab: "a", terminal: "tty-p1", zone: null, strip: { x: 100, y: 50, width: 800, height: 601, stripHeight: 36 } };
  const w = setup(t, { props: { drop: true, overlay: "ov" }, initProps: { drop: true }, shared: { "orca-tabs.drop": record } });
  assert.equal(w.view.isDropOverlay, true);
  const [alive, follow] = w.timers;
  assert.deepEqual([alive.ms, alive.after, follow.ms], [300, true, 16]);
  alive.fn(w.hcx);
  assert.deepEqual(traces(w, "overlay-alive"), [{ seesRecord: true, key: "set", zone: null }]);
  assert.equal(notified(w, "handler"), 1);
  w.shared["orca-tabs.drop"] = { ...record, zone: "up" };
  follow.fn(w.hcx);
  follow.fn(w.hcx);
  assert.equal(w.view.zone, "up");
  assert.equal(notified(w, "handler"), 2);
  w.shared = {};
  follow.fn(w.hcx);
  assert.equal(w.view.zone, null);
  follow.fn(w.hcx);
  assert.equal(notified(w, "handler"), 3);
  w.shared["orca-tabs.drop"] = { ...record, zone: "left" };
  const overlay = byId(w.render(), "tab-drop");
  w.log.length = 0;
  handler(overlay, "on_mouse_down", "left")({}, w.hcx);
  assert.deepEqual(w.log, [["stop", "handler"]]);
  assert.equal(w.view.zone, "left", "the render takes the zone the strip's poll published");
  handler(overlay, "on_mouse_move")({ position: { x: 880, y: 300 } }, w.hcx);
  assert.equal(w.view.zone, "right");
  assert.equal(notified(w, "handler"), 1);
  w.log.length = 0;
  handler(overlay, "on_mouse_move")({ position: { x: 880, y: 300 } }, w.hcx);
  assert.deepEqual(w.log, [], "the same zone is not a repaint");
  w.view.zone = "left";
  handler(overlay, "on_mouse_up", "left")({ position: { x: 150, y: 300 } }, w.hcx);
  assert.deepEqual(w.log, [["setShared", "orca-tabs.drop", { ...record, zone: "left", released: "left" }]]);
  w.log.length = 0;
  w.view.zone = null;
  handler(overlay, "on_mouse_up", "left")({ position: { x: 150, y: 300 } }, w.hcx);
  assert.deepEqual(w.log, [["setShared", "orca-tabs.drop", null], ["closeOverlay", "ov"]]);
  w.log.length = 0;
  handler(overlay, "on_key_down")({ key: "a" }, w.hcx);
  assert.deepEqual(w.log, []);
  handler(overlay, "on_key_down")({ key: "escape" }, w.hcx);
  assert.deepEqual(w.log, [["setShared", "orca-tabs.drop", null], ["closeOverlay", "ov"], ["notify", "handler"]]);
});

test("the drop overlay measures the strip from the layout when the record has no strip height", (t) => {
  const record = { tab: "a", zone: null, strip: { x: 0, y: 0, width: 100, height: 100, stripHeight: 0 } };
  const w = setup(t, { props: { drop: true, overlay: "ov" }, initProps: { drop: true }, shared: { "orca-tabs.drop": record }, layout: { children: [{ id: "tabs", size: { px: 40 } }] } });
  handler(byId(w.render(), "tab-drop"), "on_mouse_move")({ position: { x: 50, y: 30 } }, w.hcx);
  assert.equal(w.view.zone, null, "inside the layout's own strip height");
  handler(byId(w.render(), "tab-drop"), "on_mouse_move")({ position: { x: 50, y: 50 } }, w.hcx);
  assert.equal(w.view.zone, "up");
  const fallback = setup(t, { props: { drop: true, overlay: "ov" }, initProps: { drop: true }, shared: { "orca-tabs.drop": record }, layout: { children: [] } });
  handler(byId(fallback.render(), "tab-drop"), "on_mouse_move")({ position: { x: 50, y: 20 } }, fallback.hcx);
  assert.equal(fallback.view.zone, null);
  handler(byId(fallback.render(), "tab-drop"), "on_mouse_move")({ position: { x: 50, y: 40 } }, fallback.hcx);
  assert.equal(fallback.view.zone, "up", "the fallback strip is 32px tall");
});

test("the header's buttons act on the sidebar, the panel, the new-tab menu and the window", async (t) => {
  const w = setup(t, { window: { platform: "linux" }, spaces: [{ id: "s1", active: true, tabs: [tab("a", { active: true, zoomed: true })] }], panes: [pane("p1", "a", { zoomed: true })],
    layout: { children: [{ id: "left-sidebar", size: { px: 259 }, hidden: true }, { id: "panel", size: { px: 350 }, hidden: true }, { id: "main", active: "main-terminals" }] } });
  const click = (id, e = {}) => handler(byId(w.render(), id), "on_click")(e, w.hcx);
  assert.equal(byId(w.render(), "sidebar-toggle") !== undefined, true, "the header always draws the sidebar toggle");
  w.log.length = 0;
  click("sidebar-toggle");
  assert.equal(w.view.wantToggle, 1, "a press is only counted; the next render runs the drawer");
  assert.deepEqual(w.runLog(), []);
  w.log.length = 0;
  click("panel-toggle");
  assert.equal(w.view.wantPanelToggle, 1);
  assert.deepEqual(w.runLog(), []);
  w.log.length = 0;
  click("titlebar-collapse");
  assert.deepEqual(w.runLog(), [["pane.zoom", { pane: "p1" }]]);
  w.log.length = 0;
  for (const id of ["minimize", "maximize", "close-window"]) click(id);
  assert.deepEqual(w.runLog(), [["window.minimize", undefined], ["window.maximize", undefined], ["window.close", undefined]]);
  w.log.length = 0;
  handler(byId(w.render(), "tab-new"), "on_mouse_down", "left")({ bounds: { x: 100, y: 4, width: 28, height: 28 } }, w.hcx);
  assert.deepEqual(w.log, [["stop", "handler"]]);
  w.log.length = 0;
  click("tab-new");
  assert.deepEqual(w.log, [["openOverlay", { mod: "orca-new-menu", kind: "popup", width: 288, height: 512, at: "pointer" }]]);
  viewport();
  w.log.length = 0;
  click("tab-new");
  assert.deepEqual(w.log[0][1].at, { x: 8, y: 36 }, "anchored under the plus, kept inside the window");
  globalThis.window.viewport_size = () => ({ width: 2000, height: 800 });
  w.view.plusBounds = { x: 900, y: 4, width: 28, height: 28 };
  assert.deepEqual(w.view.newMenuAt(), { x: 640, y: 36 });
  w.view.plusBounds = { x: 1990, y: 4, width: 28, height: 28 };
  assert.deepEqual(w.view.newMenuAt(), { x: 1704, y: 36 });
  w.window = undefined;
  w.host.window = { platform: "windows", maximized: true };
  assert.ok(byId(w.render(), "maximize"));
});

test("toggles only count a press, and the next render consumes it with a live context", (t) => {
  const w = setup(t, { window: { platform: "macos" } });
  const tree = w.render();
  w.log.length = 0;
  handler(byId(tree, "sidebar-toggle"), "on_click")({}, w.hcx);
  assert.equal(w.view.wantToggle, 1);
  assert.deepEqual(w.log, [["notify", "handler"]], "the press notifies through its own context");
  w.render();
  assert.equal(w.view.wantToggle, 0);
  assert.equal(w.view.drawers.sidebar.busy, true);
  assert.equal(w.tasks.length > 0 && w.tasks.every((task) => task.label === "render"), true, "the motion runs on the render's context");
  w.tasks.length = 0;
  w.layout.children[2].hidden = true;
  const panelTree = w.render();
  w.log.length = 0;
  handler(byId(panelTree, "panel-toggle"), "on_click")({}, w.hcx);
  assert.equal(w.view.wantPanelToggle, 1);
  assert.deepEqual(w.log, [["notify", "handler"]]);
  w.render();
  assert.equal(w.view.drawers.panel.busy, true);
  w.view.wantToggle = 2;
  w.view.drawers.sidebar.busy = false;
  w.tasks.length = 0;
  w.render();
  assert.equal(w.tasks.length, 0, "an even count cancels out");
});

test("the toggles run the drawers", async (t) => {
  const native = setup(t, { props: { motion: "native" } });
  native.view.toggleSidebar(native.cx);
  native.view.togglePanel(native.cx);
  assert.equal(native.tasks.length, 2, "one task per drawer");
  assert.equal(native.view.drawers.sidebar.busy, true);
  assert.equal(native.view.drawers.panel.busy, true);
});

test("the smooth collapse steps the sidebar down, hides it and publishes", async (t) => {
  const w = setup(t);
  w.view.toggleSidebar(w.cx);
  assert.equal(w.view.drawers.sidebar.busy, true);
  assert.equal(w.view.drawers.sidebar.goal, 0);
  await w.runTasks();
  const resizes = w.calls("layout.resize").map((args) => args.px);
  assert.deepEqual(resizes, [259, 258, 256, 252, 247, 241, 234, 226, 217, 207, 196, 185, 174, 162, 150, 137, 125, 112, 100, 88, 77, 65, 55, 45, 35, 27, 19, 13, 8, 4, 1, 259]);
  assert.deepEqual(w.calls("layout.hide"), [{ id: "left-sidebar" }]);
  assert.deepEqual(w.log.filter(([kind]) => kind === "setShared").at(-1), ["setShared", "left-sidebar.collapsed", true]);
  assert.equal(w.view.drawers.sidebar.busy, false);
  assert.equal(w.view.drawers.sidebar.goal, undefined);
  assert.equal(notified(w, "handler") > 2, true);
  // Expanding starts from 1px while hidden, then shows and ends at the open width.
  w.log.length = 0;
  w.view.toggleSidebar(w.cx);
  assert.equal(w.view.drawers.sidebar.goal, 1);
  await w.runTasks();
  assert.deepEqual(w.runLog().slice(0, 2), [["layout.resize", { id: "left-sidebar", px: 1 }], ["layout.show", { id: "left-sidebar" }]]);
  assert.deepEqual(w.runLog().at(-1), ["layout.resize", { id: "left-sidebar", px: 259 }]);
  assert.deepEqual(w.log.filter(([kind]) => kind === "setShared").at(-1), ["setShared", "left-sidebar.collapsed", false]);
});

test("a second sidebar press reverses the motion and a stale task stops quietly", async (t) => {
  const w = setup(t, { props: { motion: "layout", measureSidebar: true } });
  w.view.toggleSidebar(w.cx);
  w.view.toggleSidebar(w.cx);
  assert.equal(w.view.drawers.sidebar.goal, 1, "reversing from the collapse");
  const [stale, current] = w.tasks.splice(0);
  await stale.fn(w.hcx);
  assert.deepEqual(w.runLog(), [], "the first press was superseded before it did anything");
  await current.fn(w.hcx);
  assert.equal(w.view.drawers.sidebar.busy, false);
  const sampled = [...w.files].find(([path]) => path.startsWith("/tmp/sidebar-motion-"));
  assert.equal(JSON.parse(sampled[1]).motion, "layout");
  assert.equal(JSON.parse(sampled[1]).target, 1);
});

test("a press during a late hide keeps the sidebar shown", async (t) => {
  const w = setup(t, { layout: { children: [{ id: "left-sidebar", size: { px: 100 }, hidden: true }] } });
  w.view.toggleSidebar(w.cx);
  await w.runTasks();
  assert.deepEqual(w.runLog().slice(0, 3), [["layout.resize", { id: "left-sidebar", px: 1 }], ["layout.show", { id: "left-sidebar" }], ["layout.resize", { id: "left-sidebar", px: 1 }]]);
  assert.equal(w.layout.children[0].hidden, false);
});

test("the native pin is released only when no drawer is moving", (t) => {
  const w = setup(t);
  w.view.nativePinned = true;
  w.view.drawers.panel.busy = true;
  w.view.releaseNativePin();
  assert.deepEqual(w.runLog(), []);
  w.view.drawers.panel.busy = false;
  w.view.releaseNativePin();
  assert.deepEqual(w.runLog(), [["layout.resize", { id: "main", weight: 1 }]]);
  assert.equal(w.view.nativePinned, false);
  const env = w.view.drawerEnv();
  assert.equal(env.zoom(), 1);
  env.pin(500);
  assert.equal(w.view.nativePinned, true);
  assert.deepEqual(w.runLog().at(-1), ["layout.resize", { id: "main", px: 500 }]);
  assert.equal(w.view.drawers.sidebar.pin(), null);
  w.view.nativeHeaderWidth = 800;
  assert.equal(w.view.drawers.panel.pin(100), 800 + 350 - 100 - 259);
  w.host.settings = { zoom: 2 };
  assert.equal(w.view.drawers.panel.pin(100), 400 + 350 - 100 - 259);
});

test("a remembered panel choice is restored per space and recorded when it changes", (t) => {
  const panel = (hidden) => ({ id: "panel", hidden });
  const enabled = ["files", "git"];
  const w = setup(t, { storage: { panels: '{"s1":"git","s2":null,"s3":"gone"}' } });
  w.log.length = 0;
  w.view.syncPanel({ id: "s1" }, panel(true), { active: "files" }, enabled);
  assert.deepEqual(w.runLog(), [["layout.select", { stack: "panel-body", child: "git" }], ["layout.show", { id: "panel" }]]);
  assert.equal(w.view.panels.s1, "git", "the old frame must not overwrite the saved choice");
  assert.ok(w.view.pending);
  w.log.length = 0;
  w.view.syncPanel({ id: "s1" }, panel(false), { active: "git" }, enabled);
  assert.equal(w.view.pending, null);
  assert.deepEqual(w.log, [], "arrival of the restored choice needs no storage write");
  w.view.syncPanel({ id: "s1" }, panel(false), { active: "files" }, enabled);
  assert.deepEqual(w.log, [["storage", "panels", '{"s1":"files","s2":null,"s3":"gone"}']]);
  w.log.length = 0;
  w.view.syncPanel({ id: "s1" }, panel(false), { active: "files" }, enabled);
  assert.deepEqual(w.log, [], "no change, no write");
  w.log.length = 0;
  w.view.syncPanel({ id: "s2" }, panel(false), { active: "files" }, enabled);
  assert.deepEqual(w.runLog(), [["layout.hide", { id: "panel" }]]);
  assert.equal(w.view.panels.s2, null, "pending hide must not remember the old visible tool");
  w.log.length = 0;
  w.view.syncPanel({ id: "s3" }, panel(true), { active: "files" }, enabled);
  assert.deepEqual(w.runLog(), [], "a tool that is not enabled keeps the layout's default");
  w.view.syncPanel({ id: "s3" }, panel(true), { active: "files" }, enabled);
  w.view.syncPanel({ id: "s5" }, panel(true), { active: "files" }, enabled);
  assert.equal(w.view.panels.s5, null, "a hidden panel is remembered as hidden");
  w.log.length = 0;
  w.view.syncPanel(null, panel(true), { active: "files" }, enabled);
  w.view.syncPanel({ id: "s5" }, null, { active: "files" }, enabled);
  assert.deepEqual(w.log, []);
});

test("the landing page shows exactly when the active space has no tab", (t) => {
  const w = setup(t, { spaces: [{ id: "s1", active: true, tabs: [] }] });
  w.log.length = 0;
  w.render();
  assert.deepEqual(w.calls("layout.select"), [{ stack: "main", child: "main-landing" }]);
  w.log.length = 0;
  w.render();
  assert.deepEqual(w.calls("layout.select"), [], "only a change selects");
  w.spaces[0].tabs.push(tab("a", { active: true }));
  w.log.length = 0;
  w.render();
  assert.deepEqual(w.calls("layout.select"), [{ stack: "main", child: "main-terminals" }]);
  const seeded = setup(t, { spaces: [{ id: "s1", active: true, tabs: [tab("a", { active: true })] }], layout: { children: [{ id: "main", active: "main-landing" }] } });
  seeded.render();
  assert.deepEqual(seeded.calls("layout.select"), [{ stack: "main", child: "main-terminals" }]);
  const bare = setup(t, { layout: { children: [] } });
  bare.render();
  assert.deepEqual(bare.calls("layout.select"), [{ stack: "main", child: "main-terminals" }], "no layout node counts as none selected");
});

test("a render with an idle layout resets the terminal width once", async (t) => {
  const w = setup(t);
  w.log.length = 0;
  w.render();
  w.render();
  assert.equal(w.tasks.length, 1);
  await w.runTasks();
  assert.deepEqual(w.runLog().filter(([command]) => command === "layout.resize"), [["layout.resize", { id: "main", weight: 1 }]]);
  assert.equal(w.view.nativeRecovering, false);
  w.view.drawers.sidebar.busy = true;
  w.tasks.length = 0;
  w.render();
  assert.equal(w.tasks.length, 0);
  // Open widths are published once, and only for a settled drawer.
  const open = setup(t, { logOpenPx: true, layout: { children: [{ id: "left-sidebar", size: { px: 300 } }, { id: "panel", size: { px: 410 } }] } });
  open.render();
  open.render();
  assert.deepEqual(open.log.filter(([kind, key]) => kind === "setShared" && key.endsWith(".openPx")), [["setShared", "left-sidebar.openPx", 300], ["setShared", "panel.openPx", 410], ["setShared", "panel.openPx", 410]]);
  assert.equal(open.view.drawers.sidebar.openPx, 300);
  assert.equal(open.view.drawers.panel.openPx, 410);
});

test("a dialog copy that was not told at init still takes focus when it first renders", (t) => {
  const w = setup(t);
  const confirmClose = { kind: "agent", tabId: "a" };
  globalThis.__herdrProps = () => ({ confirmClose, overlay: "ov" });
  w.log.length = 0;
  w.render();
  assert.deepEqual(w.log, [["focus", "render"]]);
  w.render();
  assert.deepEqual(w.log, [["focus", "render"]], "only the first render asks for focus");
});

test("a press that travels down over its own tab hands over and the tab stops reacting", (t) => {
  viewport();
  const w = setup(t, { panes: [pane("p1", "a"), pane("p2", "b"), pane("p3", "c")] });
  const slot = pillOf(w.render(), "tab-b");
  mouse(w, slot, "on_mouse_down", "left", event({ position: { x: 5, y: 10 } }));
  w.log.length = 0;
  mouse(w, pillOf(w.render(), "tab-b"), "on_mouse_move", undefined, event({ position: { x: 5, y: 40 } }));
  assert.equal(w.view.pressed, null);
  assert.deepEqual(w.log.map(([kind]) => kind).filter((kind) => kind !== "notify"), ["setShared", "openOverlay", "setShared"]);
  assert.equal(traces(w, "handoff").length, 1);
});

test("a pending panel restore waits until the saved choice appears or the deadline expires", (t) => {
  const { view, clock } = setup(t);
  view.space = "s1";
  view.panels.s1 = "changes";
  const sync = (active) => view.syncPanel({ id: "s1" }, {}, { active }, ["files", "changes"]);
  view.pending = { want: "changes", until: clock + 1 };
  sync("files");
  assert.equal(view.panels.s1, "changes");
  sync("changes");
  assert.equal(view.pending, null);
  view.pending = { want: "changes", until: clock };
  sync("files");
  assert.equal(view.pending, null);
  assert.equal(view.panels.s1, "files");
});

test("a partial native drawer transition completes at the fallback deadline", async (t) => {
  const w = setup(t);
  const drawer = w.view.drawers.sidebar;
  const waits = [];
  const cx = { ...w.hcx, sleep: async (ms) => {
    waits.push(ms);
    if (ms === 120) drawer.size({ width: 100 }, w.hcx, w.view.drawerEnv());
  } };
  w.view.toggleSidebarNative(w.cx);
  await w.tasks.shift().fn(cx);
  assert.deepEqual(waits, [1, 120, 650]);
  assert.deepEqual(w.calls("layout.resize"), [{ id: "left-sidebar", px: 100 }, { id: "left-sidebar", px: 1 }]);
  await w.runTasks();
  assert.deepEqual(w.calls("layout.hide"), [{ id: "left-sidebar" }]);
});
