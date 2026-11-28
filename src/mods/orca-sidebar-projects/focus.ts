import {
  div,
  type Color,
  type Context,
  type Element,
  type FocusHandle,
  type KeyEvent,
  type Task,
} from "gpui-kit";
import { shared, setShared } from "herdr";

const MODE = "t3-focus";
const POOL = 64;
const TICK = 150;
const LOST_TICKS = 3;
const TYPE_AHEAD_MS = 750;

export type Notifier = { notify?: (cx: Context) => void };
export type FocusState = {
  handles: Map<string, FocusHandle>;
  free: FocusHandle[];
  modal: boolean;
  me: string;
  keyboard: boolean;
  watch: Task | null;
  last: string | null;
  hold: (() => boolean) | null;
};
export type FocusHost = Notifier & { fs?: FocusState };
export type Hosted = Notifier & { fs: FocusState };
export type TypeAhead = { typed?: string; typedAt?: number };

const notify = (view: Notifier, cx: Context): void => {
  if (view.notify) view.notify(cx);
  else cx.notify();
};

export function stopsInit(view: FocusHost, cx: Context, kind: "modal" | "entry"): void {
  view.fs = {
    handles: new Map(),
    free: Array.from({ length: POOL }, () => cx.focus_handle()),
    modal: kind === "modal",
    me: String(Math.random()),
    keyboard: false,
    watch: null,
    last: null,
    hold: null,
  };
  if (kind === "entry" && shared(MODE)) setShared(MODE, null);
}

function handleOf(s: FocusState, id: string): FocusHandle | undefined {
  let h = s.handles.get(id);
  if (!h) {
    const free = s.free.pop();
    if (free) {
      s.handles.set(id, free);
      h = free;
    }
  }
  return h;
}

export function onStop(view: FocusHost): string | null {
  const s = view.fs;
  if (!s?.keyboard) return null;
  for (const [id, h] of s.handles) if (h.is_focused()) return id;
  return null;
}

export function within(view: FocusHost, ids: (string | null)[]): boolean {
  return ids.includes(onStop(view));
}

function watch(view: Hosted, cx: Context): void {
  const s = view.fs;
  if (s.watch) return;
  let lost = 0,
    seen = onStop(view);
  s.watch = cx.timer.every(TICK, (tickCx) => {
    const id = onStop(view);
    if (id !== seen) {
      seen = id;
      notify(view, tickCx);
    }
    if (id || s.hold?.()) {
      lost = 0;
      s.last = id ?? s.last;
      return;
    }
    if (++lost < LOST_TICKS) return;
    s.watch?.cancel();
    s.watch = null;
    s.keyboard = false;
    if (shared(MODE) === s.me) setShared(MODE, null);
    notify(view, tickCx);
  });
}

export function enter(view: Hosted, cx: Context, first: string): void {
  const s = view.fs;
  const h = handleOf(s, s.last ?? first);
  s.last = null;
  s.keyboard = true;
  setShared(MODE, s.me);
  h?.focus();
  watch(view, cx);
  notify(view, cx);
}

export function focusRoot(view: Hosted, el: Element): Element {
  const s = view.fs;
  if (!s.modal && !shared(MODE)) {
    s.free.push(...s.handles.values());
    s.handles.clear();
    return el;
  }
  return el
    .on_key_up((e, cx) => {
      if (e.key !== "tab") return;
      s.keyboard = true;
      const id = onStop(view);
      if (!id) {
        s.keyboard = false;
        return;
      }
      s.last = id;
      while (s.free.length < POOL / 4) s.free.push(cx.focus_handle());
      if (!s.modal) setShared(MODE, s.me);
      watch(view, cx);
      notify(view, cx);
    })
    .on_mouse_down("left", (_e, cx) => {
      s.keyboard = false;
      notify(view, cx);
    });
}

export function stop(
  view: Hosted,
  t: { accent: Color },
  id: string,
  el: Element,
  {
    radius = 6,
    enter: act,
    handle,
  }: { radius?: number; enter?: () => void; handle?: FocusHandle } = {},
): Element {
  const s = view.fs;
  if (!s.modal && !shared(MODE)) return el;
  if (handle) s.handles.set(id, handle);
  const h = handleOf(s, id);
  if (!h) return el;
  return el
    .track_focus(h)
    .tab_index(0)
    .when(Boolean(act), (e) =>
      e.on_key_down((k, cx) => {
        if ((k.keystroke !== "enter" && k.keystroke !== "space") || !h.is_focused()) return;
        cx.stop_propagation();
        act?.();
        notify(view, cx);
      }),
    )
    .when(s.keyboard && h.is_focused(), (e) =>
      e
        .relative()
        .child(div().absolute().inset_0().rounded(radius).border(2).border_color(t.accent)),
    );
}

function isTypeable(e: KeyEvent): e is KeyEvent & { key_char: string } {
  return (
    Boolean(e.key_char?.trim()) &&
    !e.modifiers?.control &&
    !e.modifiers?.platform &&
    !e.modifiers?.alt
  );
}

function typedWord(view: TypeAhead, char: string): string {
  const now = Date.now();
  view.typed =
    now - (view.typedAt ?? -Infinity) < TYPE_AHEAD_MS
      ? (view.typed ?? "") + char.toLowerCase()
      : char.toLowerCase();
  view.typedAt = now;
  return view.typed;
}

export function menuJump(view: TypeAhead, e: KeyEvent, labels: string[], at: number): number {
  if (e.key === "home") return 0;
  if (e.key === "end") return labels.length - 1;
  if (!isTypeable(e)) return -1;
  const typed = typedWord(view, e.key_char);
  const same = [...typed].every((c) => c === typed[0]),
    word = same ? typed[0] : typed;
  for (let i = 0; i < labels.length; i++) {
    const k = (Math.max(at + (same ? 1 : 0), 0) + i) % labels.length;
    if (labels[k].toLowerCase().startsWith(word)) return k;
  }
  return -1;
}
