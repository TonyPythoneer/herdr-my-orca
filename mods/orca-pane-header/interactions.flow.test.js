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
      export const panes = (...args) => globalThis.host.panes(...args);
      export const terminals = (...args) => globalThis.host.terminals(...args);
      export const openOverlay = (...args) => globalThis.host.openOverlay(...args);
      export const setShared = (...args) => globalThis.host.setShared(...args);
      export const settings = () => globalThis.host.settings ?? {};
    `;
    return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
  },
});
const { default: View } = await import("./main.js");

function nodes(root) {
  const children = root.c.flatMap(([method, args]) => {
    if (method === "child") return args;
    if (method === "children") return args[0];
    return [];
  });
  return [root, ...children.filter(child => child?.c).flatMap(nodes)];
}
const has = (node, method, value) => node.c.some(([key, args]) => key === method && args[0] === value);
const event = (node, method, button) => node.c.find(([key, args]) =>
  key === method && (button === undefined || args[0] === button))[1].at(-1);

function setup(crew = [], zoom) {
  const pane = { pane: "p", tab: "tab", terminal: "tty", title: "Shell", focused: true };
  const visible = [pane];
  const calls = [], ticks = [];
  globalThis.host = {
    settings: zoom ? { zoom } : {},
    panes: () => visible, terminals: () => crew,
    setShared: (...args) => calls.push(args), openOverlay: spec => calls.push(["open", spec]),
  };
  globalThis.__herdrProps = () => ({ pane: "p" });
  globalThis.__herdrSpaces = () => [{ tabs: [{ id: "tab", named: true, name: "My Tab", active: true }] }];
  globalThis.__herdrRun = (...args) => calls.push(args);
  const cx = { notify() {}, stop_propagation() {}, timer: { every(ms, tick) {
    const timer = { ms, tick, cancel() { this.cancelled = true; } };
    ticks.push(timer);
    return timer;
  } } };
  const view = new View();
  view.init({}, cx);
  return { view, visible, pane, calls, cx, ticks };
}

test("header buttons focus, open the pane menu, split and close the correct target", () => {
  const { view, visible, pane, cx, calls } = setup();
  for (const split of [false, true]) {
    if (split) visible.push({ ...pane, pane: "other" });
    const tree = nodes(view.render(cx).__node);
    const by = (key, value) => tree.find(n => has(n, key, value));
    const menu = ["open", { mod: "orca-context-menu", kind: "popup", width: 240, props: { tab: "pane", target: { pane: "p", terminal: "tty" } } }];
    assert.ok(by("child", "My Tab"));
    for (const [node, method, button] of [
      [tree[0], "on_mouse_down", "right"], [by("tooltip", "Open pane commands"), "on_click"],
      [by("id", "ph-m-p"), "on_click"], [tree.find(n => has(n, "cursor_grab", undefined)), "on_mouse_down", "right"],
    ]) {
      event(node, method, button)({}, cx);
      assert.deepEqual(calls.splice(0), [["pane.focus", { pane: "p" }], menu]);
    }
    for (const close of tree.filter(n => has(n, "tooltip", split ? "Close pane" : "Close tab"))) {
      event(close, "on_click")({}, cx);
      assert.deepEqual(calls.pop(), split ? ["pane.close", { pane: "p" }] : ["tab.close", { id: "tab" }]);
    }
    for (const direction of ["right", "down"]) {
      event(by("id", "ph-" + direction[0] + "-p"), "on_click")({}, cx);
      assert.deepEqual(calls.pop(), ["pane.split", { direction, pane: "p" }]);
    }
  }
});

test("drag starts at eight pixels and releases after fifteen stationary ticks", () => {
  const { view, cx, ticks, calls } = setup();
  let at = { x: 0, y: 48 };
  globalThis.window = { mouse_position: () => at };
  const handle = nodes(view.render(cx).__node).find(n => has(n, "cursor_grab", undefined));
  const press = () => event(handle, "on_mouse_down", "left")({ position: at }, cx);
  press();
  event(handle, "on_mouse_up", "left")({ position: at }, cx);
  assert.ok(ticks.at(-1).cancelled);
  press();
  const timer = ticks.at(-1);
  assert.equal(timer.ms, 16);
  at = { x: 7, y: 48 };
  timer.tick(cx);
  assert.equal(calls.length, 0);
  at = { x: 8, y: 48 };
  timer.tick(cx);
  assert.deepEqual(calls[0], ["orca-header.pane-drag", { active: true, pane: "p", terminal: "tty", ...at, inTabStrip: true }]);
  for (let i = 0; i < 14; i++) timer.tick(cx);
  assert.equal(timer.cancelled, undefined);
  timer.tick(cx);
  assert.equal(timer.cancelled, true);
  assert.deepEqual(calls.slice(-2), [["orca-header.pane-drag", null], ["orca-header.action", { kind: "unsplit-to-tab", pane: "p", terminal: "tty", dropX: 8 }]]);
  press();
  at = { x: 17, y: 49 };
  ticks.at(-1).tick(cx);
  event(handle, "on_mouse_up", "left")({ position: at }, cx);
  assert.deepEqual(calls.at(-1), ["orca-header.pane-drag", null]);
});

test("crew polling updates only on signature change and an abandoned popup closes", () => {
  const { view, cx, ticks, visible } = setup();
  let notices = 0;
  cx.notify = () => notices++;
  host.terminals = () => [{ address: "child", parent: "tty", state: "live", status: "working" }];
  ticks[0].tick(cx);
  ticks[0].tick(cx);
  assert.equal(notices, 1);
  globalThis.__herdrProps = () => ({ pane: "p", overlay: "overlay" });
  let closed;
  globalThis.__herdrCloseOverlay = id => { closed = id; };
  view.init({}, cx);
  visible.length = 0;
  ticks.at(-1).tick(cx);
  assert.equal(closed, "overlay");
});

test("agent marks preserve source, size, tint and full-color rendering", async () => {
  const { agentMark } = await import("./status.js");
  const program = { icon: "mine.svg", tint: true };
  for (const [term, expected, source] of [
    [null, null], [{ report: { app: "codex" } }, null],
    [{ report: { app: "codex" }, program }, "svg", "mine.svg"],
    [{ report: { app: "omp" } }, "image", "mods/orca-pane-header/agent-icons/omp.svg"],
    [{ report: { app: "gemini" } }, "image", "mods/orca-pane-header/agent-icons/gemini.png"],
    [{ report: { app: "aider" } }, "svg", "mods/orca-pane-header/agent-icons/aider.svg"],
    [{ program }, "svg", "mine.svg"], [{ program: { ...program, tint: false } }, "image", "mine.svg"],
  ]) {
    const mark = agentMark(term, 15, { muted: "grey" })?.__node;
    assert.equal(mark?.n ?? null, expected);
    if (mark) {
      assert.deepEqual(mark.a, [source]);
      assert.deepEqual(mark.c, expected === "svg" ? [["size", [15]], ["flex_none", []], ["text_color", ["grey"]]] : [["w", [15]], ["h", [15]], ["flex_none", []]]);
    }
  }
});

const member = (address, status, extra = {}) => ({ address, parent: "tty", state: "live", status, ...extra });

test("the crew chip opens its popup and a crew row focuses that agent, closing the popup", () => {
  const { view, cx, calls } = setup([member("c1", "working", { title: "build" }), member("c2", "blocked")]);
  const chip = nodes(view.render(cx).__node).find(n => has(n, "id", "pane-crew-p"));
  event(chip, "on_click")({}, cx);
  assert.deepEqual(calls.splice(0), [["open", { mod: "orca-pane-header", kind: "popup", width: 300, props: { pane: "p" } }]]);
  assert.ok(has(chip, "tooltip", "Orchestration: 1 need you, 1 working"));
  globalThis.__herdrProps = () => ({ pane: "p", overlay: "ov" });
  const popup = new View();
  popup.init({}, cx);
  const row = nodes(popup.render(cx).__node).find(n => has(n, "id", "crew-row-c1"));
  let closed;
  globalThis.__herdrCloseOverlay = id => { closed = id; };
  event(row, "on_click")({}, cx);
  assert.deepEqual(calls.splice(0), [["agent.focus", { terminal: "c1" }]]);
  assert.equal(closed, "ov");
  assert.ok(has(row, "accessibility_label", "build - working"));
});

test("a popup whose pane is gone closes itself and renders nothing", () => {
  const { cx } = setup();
  globalThis.__herdrProps = () => ({ pane: "gone", overlay: "ov" });
  let closed;
  globalThis.__herdrCloseOverlay = id => { closed = id; };
  const popup = new View();
  popup.init({}, cx);
  assert.deepEqual(popup.render(cx).__node.c, []);
  assert.equal(closed, "ov");
});

test("hovering the header repaints it and a plain press on the handle only cancels the poll", () => {
  const { view, cx, ticks } = setup();
  let notices = 0;
  cx.notify = () => notices++;
  const header = nodes(view.render(cx).__node)[0];
  event(header, "on_hover")(true, cx);
  assert.equal(view.hovered, true);
  assert.equal(notices, 1);
  globalThis.window = { mouse_position: () => ({ x: 0, y: 48 }) };
  const handle = nodes(view.render(cx).__node).find(n => has(n, "cursor_grab", undefined));
  event(handle, "on_mouse_down", "left")({ position: { x: 0, y: 48 } }, cx);
  const timer = ticks.at(-1);
  event(handle, "on_mouse_up", "left")({ position: { x: 0, y: 48 } }, cx);
  assert.equal(timer.cancelled, true);
  assert.equal(view.dragStart, null);
  timer.tick(cx);
  assert.equal(view.pollTimer, null);
});

test("a drag that never reaches eight pixels or loses the pointer starts nothing", () => {
  const { view, cx, ticks, calls } = setup();
  delete globalThis.window;
  view.startPaneDrag({ x: 0, y: 48 }, "p", "tty", cx);
  ticks.at(-1).tick(cx);
  assert.equal(calls.length, 0, "no window, no pointer");
  globalThis.window = { mouse_position: () => null };
  ticks.at(-1).tick(cx);
  assert.equal(calls.length, 0);
  globalThis.window = { mouse_position: () => ({ x: 7, y: 48 }) };
  ticks.at(-1).tick(cx);
  assert.deepEqual([view.isDragging, calls.length], [false, 0]);
});

test("a drag released below the strip clears the broadcast without unsplitting, and zoom scales the strip", () => {
  const { view, cx, ticks, calls } = setup([], 2);
  let at = { x: 0, y: 120 };
  globalThis.window = { mouse_position: () => at };
  view.startPaneDrag({ x: 0, y: 120 }, "p", "tty", cx);
  at = { x: 20, y: 120 };
  ticks.at(-1).tick(cx);
  assert.deepEqual(calls[0], ["orca-header.pane-drag", { active: true, pane: "p", terminal: "tty", x: 20, y: 120, inTabStrip: false }]);
  at = { x: 20, y: 96 };
  ticks.at(-1).tick(cx);
  assert.equal(calls[1][1].inTabStrip, true, "48 times the zoom is still inside the strip");
  for (let i = 0; i < 15; i++) ticks.at(-1).tick(cx);
  assert.deepEqual(calls.at(-2), ["orca-header.pane-drag", null]);
  assert.deepEqual(calls.at(-1), ["orca-header.action", { kind: "unsplit-to-tab", terminal: "tty", pane: "p", dropX: 20 }]);
  view.startPaneDrag({ x: 0, y: 200 }, "p", "tty", cx);
  view.finishPaneDrag({ x: 0, y: 200 }, cx);
  assert.deepEqual(calls.at(-1), ["orca-header.pane-drag", null], "released below the strip");
  view.finishPaneDrag({ x: 0, y: 0 }, cx);
  assert.deepEqual(calls.at(-1), ["orca-header.pane-drag", null], "nothing was being dragged");
});

test("ending a drag that never started does nothing and one that did not travel opens the menu", () => {
  const { view, cx, calls } = setup();
  delete globalThis.window;
  view.endPaneDrag({ x: 1, y: 2 }, "p", "tty", cx);
  assert.deepEqual(calls, []);
  view.startPaneDrag({ x: 1, y: 200 }, "p", "tty", cx);
  view.endPaneDrag({ x: 1, y: 200 }, "p", "tty", cx);
  assert.deepEqual(calls, [["orca-header.pane-drag", null], ["open", { mod: "orca-context-menu", kind: "popup", width: 240, props: { tab: "pane", target: { pane: "p", terminal: "tty" } } }]]);
});

test("a popup polls its own pane and a header without a pane renders empty", () => {
  const { view, cx, visible } = setup();
  assert.deepEqual(view.me().pane, "p");
  visible.length = 0;
  assert.deepEqual(view.render(cx).__node.c, []);
});

test("a second press cancels the first poll, a poll with no drag stops itself and the plus splits right", () => {
  const { view, cx, ticks, calls } = setup();
  globalThis.window = { mouse_position: () => ({ x: 0, y: 48 }) };
  view.startPaneDrag({ x: 0, y: 48 }, "p", "tty", cx);
  const first = ticks.at(-1);
  view.startPaneDrag({ x: 0, y: 48 }, "p", "tty", cx);
  assert.equal(first.cancelled, true);
  const second = ticks.at(-1);
  view.dragStart = null;
  second.tick(cx);
  assert.equal(second.cancelled, true);
  assert.equal(view.pollTimer, null);
  const plus = nodes(view.render(cx).__node).find(n => has(n, "tooltip", "Split terminal right") && !has(n, "id", "ph-r-p"));
  event(plus, "on_click")({}, cx);
  assert.deepEqual(calls.at(-1), ["pane.split", { direction: "right", pane: "p" }]);
});
