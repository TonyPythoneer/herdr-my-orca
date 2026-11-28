import { afterEach, beforeEach, test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import type { Context, Element, FocusHandle, KeyEvent } from "gpui-kit";
import { callsOf, div } from "../../stubs/gpui-kit.js";
import {
  enter,
  focusRoot,
  menuJump,
  onStop,
  stop,
  stopsInit,
  within,
  type FocusHost,
  type Hosted,
} from "../../../src/mods/orca-sidebar-projects/focus.js";

const MODE = "t3-focus";
const POOL = 64;
const THEME = { accent: "#aabbcc" } as const;

type Fake = FocusHandle & { focused: boolean; focuses: number };
type Tick = { run: (cx: Context) => void; cancelled: number };

const store = new Map<string, unknown>();

function fakeHandle(focused = false): Fake {
  const h: Fake = {
    focused,
    focuses: 0,
    focus() {
      h.focuses++;
    },
    is_focused: () => h.focused,
    release: () => true,
  };
  return h;
}

function fakeCx() {
  const timers: Tick[] = [];
  const cx = {
    notified: 0,
    stopped: 0,
    timers,
    focus_handle: (): FocusHandle => fakeHandle(),
    notify() {
      cx.notified++;
    },
    stop_propagation() {
      cx.stopped++;
    },
    timer: {
      every(_ms: number, run: (cx: Context) => void) {
        const tick: Tick = { run, cancelled: 0 };
        timers.push(tick);
        return {
          cancel() {
            tick.cancelled++;
          },
          is_done: () => false,
        };
      },
    },
  };
  return cx;
}

type Cx = ReturnType<typeof fakeCx>;
const ctx = (cx: Cx): Context => cx as unknown as Context;
const newEl = (): Element => div() as unknown as Element;
const asObj = (value: Element): object => value as unknown as object;

function hostView(kind: "modal" | "entry", cx: Cx): Hosted {
  const view: FocusHost = {};
  stopsInit(view, ctx(cx), kind);
  return view as Hosted;
}

const firstCall = (element: object, name: string): unknown[] | undefined =>
  callsOf(element).find(([call]) => call === name)?.[1];

const handlerAt = <F>(element: object, name: string, index: number): F =>
  firstCall(element, name)?.[index] as F;

type KeyUp = (k: KeyEvent, cx: Context) => void;

const keyEvent = (over: Partial<KeyEvent>): KeyEvent => ({
  key: "",
  keystroke: "",
  modifiers: { shift: false, control: false, alt: false, platform: false, function: false },
  ...over,
});

beforeEach(() => {
  store.clear();
  vi.stubGlobal("__herdrShared", (key: string) => store.get(key));
  vi.stubGlobal("__herdrSetShared", (key: string, value: unknown) => {
    store.set(key, value);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("stopsInit gives an entry its own pool and clears a mode a quit left behind", () => {
  store.set(MODE, "left-over");
  const entry = hostView("entry", fakeCx());
  assert.equal(entry.fs.free.length, POOL);
  assert.equal(entry.fs.modal, false);
  assert.equal(entry.fs.keyboard, false);
  assert.equal(store.get(MODE), null);
});

test("stopsInit keeps a modal's stops and leaves another mod's mode alone", () => {
  store.set(MODE, "other");
  const modal = hostView("modal", fakeCx());
  assert.equal(modal.fs.modal, true);
  assert.equal(store.get(MODE), "other");
  store.delete(MODE);
  hostView("entry", fakeCx());
  assert.equal(store.has(MODE), false);
});

test("onStop names the focused stop only while the keyboard is walking", () => {
  const view = hostView("modal", fakeCx());
  const a = fakeHandle(true);
  stop(view, THEME, "a", newEl(), { handle: a });
  assert.equal(onStop(view), null);
  view.fs.keyboard = true;
  assert.equal(onStop(view), "a");
  assert.equal(within(view, ["a"]), true);
  assert.equal(within(view, ["b"]), false);
  a.focused = false;
  assert.equal(onStop(view), null);
  assert.equal(onStop({}), null);
});

test("stop returns the element unchanged when the mode is off or no stop can be made", () => {
  const cx = fakeCx();
  const entry = hostView("entry", cx);
  const plain = newEl();
  assert.equal(stop(entry, THEME, "a", plain), plain);
  assert.equal(firstCall(asObj(plain), "track_focus"), undefined);

  const modal = hostView("modal", cx);
  modal.fs.free = [];
  const noStop = newEl();
  assert.equal(stop(modal, THEME, "x", noStop), noStop);
  assert.equal(firstCall(asObj(noStop), "track_focus"), undefined);
});

test("a stop tracks its handle, reuses it, and draws a ring while focused", () => {
  const cx = fakeCx();
  const modal = hostView("modal", cx);
  const h = fakeHandle(true);
  const first = asObj(stop(modal, THEME, "a", newEl(), { handle: h, radius: 4 }));
  assert.equal(firstCall(first, "track_focus")?.[0], h);
  assert.deepEqual(firstCall(first, "tab_index"), [0]);
  assert.equal(firstCall(first, "on_key_down"), undefined);
  assert.equal(firstCall(first, "relative"), undefined);

  modal.fs.keyboard = true;
  const ringed = asObj(stop(modal, THEME, "a", newEl(), { radius: 4 }));
  assert.equal(firstCall(ringed, "track_focus")?.[0], h);
  assert.notEqual(firstCall(ringed, "relative"), undefined);
  const ring = firstCall(ringed, "child")?.[0] as object;
  assert.deepEqual(firstCall(ring, "border_color"), [THEME.accent]);
  assert.deepEqual(firstCall(ring, "rounded"), [4]);
  assert.deepEqual(firstCall(ring, "border"), [2]);
});

test("a stop with an enter action runs it on Enter or Space and stops the key there", () => {
  const cx = fakeCx();
  const modal = hostView("modal", cx);
  const h = fakeHandle(true);
  let pressed = 0;
  const el = asObj(stop(modal, THEME, "a", newEl(), { enter: () => pressed++, handle: h }));
  const press = handlerAt<KeyUp>(el, "on_key_down", 0);
  press(keyEvent({ keystroke: "enter" }), ctx(cx));
  press(keyEvent({ keystroke: "space" }), ctx(cx));
  press(keyEvent({ keystroke: "a" }), ctx(cx));
  assert.equal(pressed, 2);
  assert.equal(cx.stopped, 2);
  assert.equal(cx.notified, 2);
  h.focused = false;
  press(keyEvent({ keystroke: "enter" }), ctx(cx));
  assert.equal(pressed, 2);
});

test("enter lands on the stop the keyboard left, else on the first stop", () => {
  const cx = fakeCx();
  const view = hostView("modal", cx);
  const a = fakeHandle();
  const b = fakeHandle();
  stop(view, THEME, "a", newEl(), { handle: a });
  stop(view, THEME, "b", newEl(), { handle: b });
  view.fs.last = "b";
  enter(view, ctx(cx), "a");
  assert.equal(b.focuses, 1);
  assert.equal(a.focuses, 0);
  assert.equal(view.fs.keyboard, true);
  assert.equal(view.fs.last, null);
  assert.equal(store.get(MODE), view.fs.me);
  assert.equal(cx.notified, 1);
  assert.equal(cx.timers.length, 1);

  const again = hostView("modal", cx);
  stop(again, THEME, "a", newEl(), { handle: a });
  enter(again, ctx(cx), "a");
  assert.equal(a.focuses, 1);
});

test("enter with no stop to land on still takes the keyboard", () => {
  const cx = fakeCx();
  const view = hostView("modal", cx);
  view.fs.free = [];
  enter(view, ctx(cx), "nowhere");
  assert.equal(view.fs.keyboard, true);
  assert.equal(cx.notified, 1);
});

test("the watch notifies when the focused stop moves and keeps the mode while a stop holds focus", () => {
  const cx = fakeCx();
  const view = hostView("modal", cx);
  const a = fakeHandle(true);
  const b = fakeHandle();
  stop(view, THEME, "a", newEl(), { handle: a });
  stop(view, THEME, "b", newEl(), { handle: b });
  enter(view, ctx(cx), "a");
  assert.equal(cx.timers.length, 1);
  const notifiedAtEnter = cx.notified;

  a.focused = false;
  b.focused = true;
  cx.timers[0].run(ctx(cx));
  assert.equal(cx.notified, notifiedAtEnter + 1);
  assert.equal(view.fs.last, "b");
  assert.equal(view.fs.keyboard, true);
  assert.equal(store.get(MODE), view.fs.me);

  cx.timers[0].run(ctx(cx));
  assert.equal(cx.notified, notifiedAtEnter + 1);
});

test("the watch gives the keyboard back after three ticks with no stop focused", () => {
  const cx = fakeCx();
  const view = hostView("modal", cx);
  const a = fakeHandle(true);
  stop(view, THEME, "a", newEl(), { handle: a });
  enter(view, ctx(cx), "a");
  a.focused = false;
  const timer = cx.timers[0];
  timer.run(ctx(cx));
  timer.run(ctx(cx));
  assert.equal(view.fs.keyboard, true);
  assert.equal(timer.cancelled, 0);
  timer.run(ctx(cx));
  assert.equal(timer.cancelled, 1);
  assert.equal(view.fs.watch, null);
  assert.equal(view.fs.keyboard, false);
  assert.equal(store.get(MODE), null);
});

test("a quiet watch leaves another mod's mode in place", () => {
  const cx = fakeCx();
  const view = hostView("entry", cx);
  store.set(MODE, view.fs.me);
  const a = fakeHandle(true);
  stop(view, THEME, "a", newEl(), { handle: a });
  enter(view, ctx(cx), "a");
  store.set(MODE, "other");
  a.focused = false;
  for (let i = 0; i < 3; i++) cx.timers[0].run(ctx(cx));
  assert.equal(view.fs.keyboard, false);
  assert.equal(store.get(MODE), "other");
});

test("a hold keeps the keyboard walking while no stop has focus", () => {
  const cx = fakeCx();
  const view = hostView("modal", cx);
  const a = fakeHandle(true);
  stop(view, THEME, "a", newEl(), { handle: a });
  enter(view, ctx(cx), "a");
  view.fs.hold = () => true;
  a.focused = false;
  for (let i = 0; i < 5; i++) cx.timers[0].run(ctx(cx));
  assert.equal(view.fs.keyboard, true);
  assert.equal(view.fs.last, null);
  assert.equal(cx.timers[0].cancelled, 0);
});

test("focusRoot hands the pool back when no mode is on, and returns the element", () => {
  const cx = fakeCx();
  const entry = hostView("entry", cx);
  store.set(MODE, "other");
  stop(entry, THEME, "a", newEl());
  stop(entry, THEME, "b", newEl());
  assert.equal(entry.fs.free.length, POOL - 2);
  store.delete(MODE);
  const root = newEl();
  assert.equal(focusRoot(entry, root), root);
  assert.equal(entry.fs.free.length, POOL);
  assert.equal(entry.fs.handles.size, 0);
  assert.equal(firstCall(asObj(root), "on_key_up"), undefined);
});

test("a modal root listens for Tab and ignores other keys", () => {
  const cx = fakeCx();
  const modal = hostView("modal", cx);
  stop(modal, THEME, "a", newEl(), { handle: fakeHandle() });
  const root = asObj(focusRoot(modal, newEl()));
  const onKeyUp = handlerAt<KeyUp>(root, "on_key_up", 0);
  onKeyUp(keyEvent({ key: "a" }), ctx(cx));
  assert.equal(modal.fs.keyboard, false);
  assert.equal(cx.timers.length, 0);

  onKeyUp(keyEvent({ key: "tab" }), ctx(cx));
  assert.equal(modal.fs.keyboard, false);
  assert.equal(cx.notified, 0);
});

test("Tab with a focused stop starts the keyboard walk, refills the pool, and sets the mode for an entry", () => {
  const cx = fakeCx();
  const entry = hostView("entry", cx);
  store.set(MODE, "other");
  const a = fakeHandle(true);
  stop(entry, THEME, "a", newEl(), { handle: a });
  entry.fs.free = [];
  const root = asObj(focusRoot(entry, newEl()));
  handlerAt<KeyUp>(root, "on_key_up", 0)(keyEvent({ key: "tab" }), ctx(cx));
  assert.equal(entry.fs.keyboard, true);
  assert.equal(entry.fs.last, "a");
  assert.equal(entry.fs.free.length, POOL / 4);
  assert.equal(store.get(MODE), entry.fs.me);
  assert.equal(cx.timers.length, 1);
  assert.equal(cx.notified, 1);
});

test("Tab on a modal takes the keyboard without setting the shared mode", () => {
  const cx = fakeCx();
  const modal = hostView("modal", cx);
  stop(modal, THEME, "a", newEl(), { handle: fakeHandle(true) });
  const root = asObj(focusRoot(modal, newEl()));
  handlerAt<KeyUp>(root, "on_key_up", 0)(keyEvent({ key: "tab" }), ctx(cx));
  assert.equal(modal.fs.keyboard, true);
  assert.equal(store.has(MODE), false);
});

test("a press with the mouse ends the keyboard walk", () => {
  const cx = fakeCx();
  const modal = hostView("modal", cx);
  modal.fs.keyboard = true;
  const root = asObj(focusRoot(modal, newEl()));
  handlerAt<(e: unknown, c: Context) => void>(root, "on_mouse_down", 1)(undefined, ctx(cx));
  assert.equal(modal.fs.keyboard, false);
  assert.equal(cx.notified, 1);
});

test("menuJump moves Home and End, and a typed letter moves to the next row it starts", () => {
  const labels = ["Alpha", "Beta", "Bravo"];
  const view = {};
  assert.equal(menuJump(view, keyEvent({ key: "home" }), labels, 2), 0);
  assert.equal(menuJump(view, keyEvent({ key: "end" }), labels, 0), 2);
  assert.equal(menuJump(view, keyEvent({ key: "b", key_char: "b" }), labels, 0), 1);
  assert.equal(menuJump(view, keyEvent({ key: "x", key_char: "x" }), labels, 0), -1);
});

test("menuJump steps through rows with the same first letter and wraps", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000);
  const labels = ["Alpha", "Beta", "Bravo"];
  const view = {};
  assert.equal(menuJump(view, keyEvent({ key: "b", key_char: "B" }), labels, 0), 1);
  vi.setSystemTime(1_100);
  assert.equal(menuJump(view, keyEvent({ key: "b", key_char: "b" }), labels, 1), 2);
  vi.setSystemTime(1_200);
  assert.equal(menuJump(view, keyEvent({ key: "b", key_char: "b" }), labels, 2), 1);
  assert.equal(menuJump({}, keyEvent({ key: "a", key_char: "a" }), ["Alpha", "Beta"], -1), 0);
  assert.equal(menuJump({}, keyEvent({ key: "a", key_char: "a" }), ["Beta", "Alpha"], 1), 1);
});

test("menuJump matches a typed word from the current row, and restarts after a pause", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(5_000);
  const labels = ["Alpha", "Beta", "Bravo"];
  const view = {};
  assert.equal(menuJump(view, keyEvent({ key: "b", key_char: "b" }), labels, 0), 1);
  vi.setSystemTime(5_100);
  assert.equal(menuJump(view, keyEvent({ key: "r", key_char: "r" }), labels, 0), 2);
  vi.setSystemTime(6_000);
  assert.equal(menuJump(view, keyEvent({ key: "a", key_char: "a" }), labels, 2), 0);
});

test("menuJump ignores keys that are not typed text", () => {
  const labels = ["Alpha"];
  const view = {};
  const modifiers = keyEvent({}).modifiers;
  assert.equal(menuJump(view, keyEvent({ key: "space", key_char: " " }), labels, 0), -1);
  assert.equal(menuJump(view, keyEvent({ key: "a" }), labels, 0), -1);
  for (const held of ["control", "platform", "alt"] as const) {
    const event = keyEvent({ key: "a", key_char: "a", modifiers: { ...modifiers, [held]: true } });
    assert.equal(menuJump(view, event, labels, 0), -1);
  }
});
