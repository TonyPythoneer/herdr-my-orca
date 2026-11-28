import { it, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import type { AsyncContext } from "gpui-kit";
import Pane from "../../../src/mods/orca-pane-header/main.js";
import { agentMark } from "../../../src/mods/orca-pane-header/status.js";
import type { TerminalInfo } from "../../../src/mods/orca-pane-header/crew.js";
import { asyncContext, host, resetHost, setPointer, clearPointer, type TestPane } from "./host.js";
import { nodeOf, type RecordedNode } from "./recording.js";

vi.mock("gpui-kit", async () => {
  const { View, element } = await import("./recording.js");
  return {
    View,
    div: element("div", true),
    svg: element("svg", true),
    image: element("image", true),
  };
});

vi.mock("gpui-base", async () => {
  const { element } = await import("./recording.js");
  return { h_flex: element("h_flex", true), v_flex: element("v_flex", true) };
});

vi.mock("herdr", async () => {
  const { herdrMock } = await import("./host.js");
  return herdrMock();
});

type Handler = (...args: unknown[]) => void;
type TestTimer = {
  ms: number;
  tick: (cx: AsyncContext) => void;
  cancelled?: boolean;
  cancel(): void;
};

function nth<T>(items: T[], index = -1): T {
  const item = index < 0 ? items.at(index) : items[index];
  if (item === undefined) throw new Error("missing item");
  return item;
}

function tree(view: Pane, cx: AsyncContext): RecordedNode {
  return nodeOf(view.render(cx));
}

function argsOf(entry: unknown): unknown[] {
  return Array.isArray(entry) ? entry : [];
}

const isHandler = (value: unknown): value is Handler => typeof value === "function";
const inTabStripOf = (value: unknown): unknown =>
  typeof value === "object" && value !== null && "inTabStrip" in value
    ? value.inTabStrip
    : undefined;

function nodes(root: RecordedNode): RecordedNode[] {
  const children = root.c.flatMap(([method, args]) => {
    if (method === "child") return argsOf(args);
    if (method === "children") return argsOf(argsOf(args)[0]);
    return [];
  });
  return [
    root,
    ...children
      .filter((child): child is RecordedNode =>
        Boolean(child && typeof child === "object" && "c" in child),
      )
      .flatMap(nodes),
  ];
}
const has = (node: RecordedNode, method: string, value: unknown): boolean =>
  node.c.some(([key, args]) => key === method && argsOf(args)[0] === value);
function event(node: RecordedNode | undefined, method: string, button?: string): Handler {
  const call = node?.c.find(
    ([key, args]) => key === method && (button === undefined || argsOf(args)[0] === button),
  );
  if (!call) throw new Error(`${method} not found`);
  const handler = argsOf(call[1]).at(-1);
  if (!isHandler(handler)) throw new Error(`${method} has no handler`);
  return handler;
}

function setup(crew: TerminalInfo[] = [], zoom?: number) {
  const pane: TestPane = { pane: "p", tab: "tab", terminal: "tty", title: "Shell", focused: true };
  const visible: TestPane[] = [pane];
  const calls: unknown[][] = [];
  const ticks: TestTimer[] = [];
  resetHost({
    settings: zoom ? { zoom } : {},
    panes: visible,
    terminals: crew,
    props: { pane: "p" },
    spaces: [{ tabs: [{ id: "tab", named: true, name: "My Tab", active: true }] }],
    theme: {},
    onSetShared: (...args) => calls.push(args),
    onOpenOverlay: (spec) => calls.push(["open", spec]),
    onRun: (...args) => calls.push(args),
  });
  const cx = asyncContext({
    notify() {},
    stop_propagation() {},
    timer: {
      every(ms: number, tick: (cx: AsyncContext) => void) {
        const timer: TestTimer = {
          ms,
          tick,
          cancel() {
            this.cancelled = true;
          },
        };
        ticks.push(timer);
        return timer;
      },
    },
  });
  const view = new Pane();
  view.init({}, cx);
  return { view, visible, pane, calls, cx, ticks };
}

it("header buttons focus, open the pane menu, split and close the correct target", () => {
  const { view, visible, pane, cx, calls } = setup();
  for (const split of [false, true]) {
    if (split) visible.push({ ...pane, pane: "other" });
    const root = nodes(tree(view, cx));
    const by = (key: string, value: unknown): RecordedNode | undefined =>
      root.find((n) => has(n, key, value));
    const menu = [
      "open",
      {
        mod: "orca-context-menu",
        kind: "popup",
        width: 240,
        props: { tab: "pane", target: { pane: "p", terminal: "tty" } },
      },
    ];
    assert.ok(by("child", "My Tab"));
    const targets: Array<[RecordedNode | undefined, string, string?]> = [
      [root[0], "on_mouse_down", "right"],
      [by("tooltip", "Open pane commands"), "on_click"],
      [by("id", "ph-m-p"), "on_click"],
      [root.find((n) => has(n, "cursor_grab", undefined)), "on_mouse_down", "right"],
    ];
    for (const [node, method, button] of targets) {
      event(node, method, button)({}, cx);
      assert.deepEqual(calls.splice(0), [["pane.focus", { pane: "p" }], menu]);
    }
    for (const close of root.filter((n) => has(n, "tooltip", split ? "Close pane" : "Close tab"))) {
      event(close, "on_click")({}, cx);
      assert.deepEqual(
        calls.pop(),
        split ? ["pane.close", { pane: "p" }] : ["tab.close", { id: "tab" }],
      );
    }
    for (const direction of ["right", "down"]) {
      event(by("id", `ph-${direction[0]}-p`), "on_click")({}, cx);
      assert.deepEqual(calls.pop(), ["pane.split", { direction, pane: "p" }]);
    }
  }
});

it("drag starts at eight pixels and releases after fifteen stationary ticks", () => {
  const { view, cx, ticks, calls } = setup();
  let at = { x: 0, y: 48 };
  setPointer(() => at);
  const handle = nodes(tree(view, cx)).find((n) => has(n, "cursor_grab", undefined));
  const press = (): void => event(handle, "on_mouse_down", "left")({ position: at }, cx);
  press();
  event(handle, "on_mouse_up", "left")({ position: at }, cx);
  assert.ok(nth(ticks).cancelled);
  press();
  const timer = nth(ticks);
  assert.equal(timer.ms, 16);
  at = { x: 7, y: 48 };
  timer.tick(cx);
  assert.equal(calls.length, 0);
  at = { x: 8, y: 48 };
  timer.tick(cx);
  assert.deepEqual(calls[0], [
    "orca-header.pane-drag",
    { active: true, pane: "p", terminal: "tty", ...at, inTabStrip: true },
  ]);
  for (let i = 0; i < 14; i++) timer.tick(cx);
  assert.equal(timer.cancelled, undefined);
  timer.tick(cx);
  assert.equal(timer.cancelled, true);
  assert.deepEqual(calls.slice(-2), [
    ["orca-header.pane-drag", null],
    ["orca-header.action", { kind: "unsplit-to-tab", pane: "p", terminal: "tty", dropX: 8 }],
  ]);
  press();
  at = { x: 17, y: 49 };
  nth(ticks).tick(cx);
  event(handle, "on_mouse_up", "left")({ position: at }, cx);
  assert.deepEqual(calls.at(-1), ["orca-header.pane-drag", null]);
});

it("crew polling updates only on signature change and an abandoned popup closes", () => {
  const { view, cx, ticks, visible } = setup();
  let notices = 0;
  cx.notify = () => notices++;
  host.terminals = [{ address: "child", parent: "tty", state: "live", status: "working" }];
  nth(ticks, 0).tick(cx);
  nth(ticks, 0).tick(cx);
  assert.equal(notices, 1);
  host.props = { pane: "p", overlay: "overlay" };
  let closed: string | undefined;
  host.onCloseOverlay = (id) => {
    closed = id;
  };
  view.init({}, cx);
  visible.length = 0;
  nth(ticks).tick(cx);
  assert.equal(closed, "overlay");
});

it("agent marks preserve source, size, tint and full-color rendering", async () => {
  const program = { icon: "mine.svg", tint: true };
  const cases: Array<[Parameters<typeof agentMark>[0], string | null, string?]> = [
    [null, null],
    [{ report: { app: "codex" } }, null],
    [{ report: { app: "codex" }, program }, "svg", "mine.svg"],
    [{ report: { app: "omp" } }, "image", "mods/orca-assets/omp.svg"],
    [{ report: { app: "gemini" } }, "image", "mods/orca-assets/gemini.png"],
    [{ report: { app: "aider" } }, "svg", "mods/orca-assets/aider.svg"],
    [{ program }, "svg", "mine.svg"],
    [{ program: { ...program, tint: false } }, "image", "mine.svg"],
  ];
  for (const [term, expected, source] of cases) {
    const mark = agentMark(term, 15, { muted: "grey" });
    const node = mark === null ? null : nodeOf(mark);
    assert.equal(node?.n ?? null, expected);
    if (node) {
      assert.deepEqual(node.a, [source]);
      assert.deepEqual(
        node.c,
        expected === "svg"
          ? [
              ["size", [15]],
              ["flex_none", []],
              ["text_color", ["grey"]],
            ]
          : [
              ["w", [15]],
              ["h", [15]],
              ["flex_none", []],
            ],
      );
    }
  }
});

const member = (
  address: string,
  status: string,
  extra: Partial<TerminalInfo> = {},
): TerminalInfo => ({ address, parent: "tty", state: "live", status, ...extra });

it("the crew chip opens its popup and a crew row focuses that agent, closing the popup", () => {
  const { view, cx, calls } = setup([
    member("c1", "working", { title: "build" }),
    member("c2", "blocked"),
  ]);
  const chip = nodes(tree(view, cx)).find((n) => has(n, "id", "pane-crew-p"));
  event(chip, "on_click")({}, cx);
  assert.deepEqual(calls.splice(0), [
    ["open", { mod: "orca-pane-header", kind: "popup", width: 300, props: { pane: "p" } }],
  ]);
  assert.ok(chip && has(chip, "tooltip", "Orchestration: 1 need you, 1 working"));
  host.props = { pane: "p", overlay: "ov" };
  const popup = new Pane();
  popup.init({}, cx);
  const row = nodes(tree(popup, cx)).find((n) => has(n, "id", "crew-row-c1"));
  let closed: string | undefined;
  host.onCloseOverlay = (id) => {
    closed = id;
  };
  event(row, "on_click")({}, cx);
  assert.deepEqual(calls.splice(0), [["agent.focus", { terminal: "c1" }]]);
  assert.equal(closed, "ov");
  assert.ok(row && has(row, "accessibility_label", "build - working"));
});

it("a popup whose pane is gone closes itself and renders nothing", () => {
  const { cx } = setup();
  host.props = { pane: "gone", overlay: "ov" };
  let closed: string | undefined;
  host.onCloseOverlay = (id) => {
    closed = id;
  };
  const popup = new Pane();
  popup.init({}, cx);
  assert.deepEqual(tree(popup, cx).c, []);
  assert.equal(closed, "ov");
});

it("hovering the header repaints it and a plain press on the handle only cancels the poll", () => {
  const { view, cx, ticks } = setup();
  let notices = 0;
  cx.notify = () => notices++;
  const header = nodes(tree(view, cx))[0];
  event(header, "on_hover")(true, cx);
  assert.equal(view.hovered, true);
  assert.equal(notices, 1);
  setPointer({ x: 0, y: 48 });
  const handle = nodes(tree(view, cx)).find((n) => has(n, "cursor_grab", undefined));
  event(handle, "on_mouse_down", "left")({ position: { x: 0, y: 48 } }, cx);
  const timer = nth(ticks);
  event(handle, "on_mouse_up", "left")({ position: { x: 0, y: 48 } }, cx);
  assert.equal(timer.cancelled, true);
  assert.equal(view.dragStart, null);
  timer.tick(cx);
  assert.equal(view.pollTimer, null);
});

it("a drag that never reaches eight pixels or loses the pointer starts nothing", () => {
  const { view, cx, ticks, calls } = setup();
  clearPointer();
  view.startPaneDrag({ x: 0, y: 48 }, "p", "tty", cx);
  nth(ticks).tick(cx);
  assert.equal(calls.length, 0, "no window, no pointer");
  setPointer(null);
  nth(ticks).tick(cx);
  assert.equal(calls.length, 0);
  setPointer({ x: 7, y: 48 });
  nth(ticks).tick(cx);
  assert.deepEqual([view.isDragging, calls.length], [false, 0]);
});

it("a drag released below the strip clears the broadcast without unsplitting, and zoom scales the strip", () => {
  const { view, cx, ticks, calls } = setup([], 2);
  let at = { x: 0, y: 120 };
  setPointer(() => at);
  view.startPaneDrag({ x: 0, y: 120 }, "p", "tty", cx);
  at = { x: 20, y: 120 };
  nth(ticks).tick(cx);
  assert.deepEqual(calls[0], [
    "orca-header.pane-drag",
    { active: true, pane: "p", terminal: "tty", x: 20, y: 120, inTabStrip: false },
  ]);
  at = { x: 20, y: 96 };
  nth(ticks).tick(cx);
  assert.equal(inTabStripOf(calls[1][1]), true, "48 times the zoom is still inside the strip");
  for (let i = 0; i < 15; i++) nth(ticks).tick(cx);
  assert.deepEqual(calls.at(-2), ["orca-header.pane-drag", null]);
  assert.deepEqual(calls.at(-1), [
    "orca-header.action",
    { kind: "unsplit-to-tab", terminal: "tty", pane: "p", dropX: 20 },
  ]);
  view.startPaneDrag({ x: 0, y: 200 }, "p", "tty", cx);
  view.finishPaneDrag({ x: 0, y: 200 }, cx);
  assert.deepEqual(calls.at(-1), ["orca-header.pane-drag", null], "released below the strip");
  view.finishPaneDrag({ x: 0, y: 0 }, cx);
  assert.deepEqual(calls.at(-1), ["orca-header.pane-drag", null], "nothing was being dragged");
});

it("ending a drag that never started does nothing and one that did not travel opens the menu", () => {
  const { view, cx, calls } = setup();
  clearPointer();
  view.endPaneDrag({ x: 1, y: 2 }, "p", "tty", cx);
  assert.deepEqual(calls, []);
  view.startPaneDrag({ x: 1, y: 200 }, "p", "tty", cx);
  view.endPaneDrag({ x: 1, y: 200 }, "p", "tty", cx);
  assert.deepEqual(calls, [
    ["orca-header.pane-drag", null],
    [
      "open",
      {
        mod: "orca-context-menu",
        kind: "popup",
        width: 240,
        props: { tab: "pane", target: { pane: "p", terminal: "tty" } },
      },
    ],
  ]);
});

it("a popup polls its own pane and a header without a pane renders empty", () => {
  const { view, cx, visible } = setup();
  assert.deepEqual(view.me()?.pane, "p");
  visible.length = 0;
  assert.deepEqual(tree(view, cx).c, []);
});

it("a second press cancels the first poll, a poll with no drag stops itself and the plus splits right", () => {
  const { view, cx, ticks, calls } = setup();
  setPointer({ x: 0, y: 48 });
  view.startPaneDrag({ x: 0, y: 48 }, "p", "tty", cx);
  const first = nth(ticks);
  view.startPaneDrag({ x: 0, y: 48 }, "p", "tty", cx);
  assert.equal(first.cancelled, true);
  const second = nth(ticks);
  view.dragStart = null;
  second.tick(cx);
  assert.equal(second.cancelled, true);
  assert.equal(view.pollTimer, null);
  const plus = nodes(tree(view, cx)).find(
    (n) => has(n, "tooltip", "Split terminal right") && !has(n, "id", "ph-r-p"),
  );
  event(plus, "on_click")({}, cx);
  assert.deepEqual(calls.at(-1), ["pane.split", { direction: "right", pane: "p" }]);
});

it("a terminal without an address still counts as crew, as before", () => {
  const { view, cx } = setup();
  host.terminals = [{ parent: "tty", state: "live", status: "working" }];
  view.init({}, cx);
  assert.equal(view.crew.managing.length, 1);
});

it("a header without props renders empty, as before", () => {
  const { cx } = setup();
  host.props = undefined;
  const bare = new Pane();
  bare.init({}, cx);
  assert.deepEqual(tree(bare, cx).c, []);
});

it("pane props pass through unchecked, as before", () => {
  const { view } = setup();
  host.props = { pane: 5 };
  assert.equal(view.crewPaneId(), 5);
});

it("zoom is coerced in the strip height, as before", () => {
  const { view, cx, ticks, calls } = setup();
  host.settings = { zoom: "2" };
  let at = { x: 0, y: 96 };
  setPointer(() => at);
  view.startPaneDrag({ x: 0, y: 96 }, "p", "tty", cx);
  at = { x: 20, y: 96 };
  nth(ticks).tick(cx);
  assert.deepEqual(calls[0], [
    "orca-header.pane-drag",
    { active: true, pane: "p", terminal: "tty", x: 20, y: 96, inTabStrip: true },
  ]);
  clearPointer();
});

it("a window without a pointer read throws, as before", () => {
  const { view, cx, ticks } = setup();
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  view.startPaneDrag({ x: 0, y: 48 }, "p", "tty", cx);
  assert.throws(() => nth(ticks).tick(cx), TypeError);
  clearPointer();
});

it("theme tokens pass through unchanged, as before", () => {
  const { cx } = setup();
  host.theme = { surface: "grey" };
  host.props = { pane: "p", overlay: "ov" };
  const popup = new Pane();
  popup.init({}, cx);
  assert.ok(has(tree(popup, cx), "bg", "grey"));
});
