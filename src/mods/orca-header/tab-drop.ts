import type { AsyncContext, Task } from "gpui-kit";
import {
  closeOverlay,
  panes,
  run,
  shared,
  setShared,
  spaces,
  writeTextFile,
  type PaneInfo,
} from "herdr";
import { edgeZone, type Box, type Zone } from "./drop-zone.js";
import { find, layoutTree, scaledWidth, visibleSize, zoomOf } from "./header-layout.js";
import type { Point } from "./types.js";

export const DROP_KEY = "orca-header.drop";
const STATUS_BAR_HEIGHT = 24;
const DROP_STILL_TICKS = 20;
const DRAG_POLL_MS = 16;
const MOUNT_POLL_LIMIT = 60;
const INITIAL_TRACE_TICKS = 8;

export type DropStrip = {
  x: number;
  y: number;
  width: number;
  height: number;
  stripHeight: number;
};

export type DropRecord = {
  tab?: string | null;
  terminal?: string | null;
  pane?: string | null;
  strip?: DropStrip;
  overlay?: string;
  zone?: Zone | null;
  released?: Zone;
  still?: number;
  lastPos?: Point;
};

export type GlobalWindow = {
  viewport_size(): { width: number; height: number };
  mouse_position(): Point;
};

let dropSeq = 0;
let dropDrag: DropRecord | null = null;
let pollTimer: Task | null = null;

export function globalWindow(): GlobalWindow | undefined {
  const host: { window?: unknown } = globalThis;
  return host.window as GlobalWindow | undefined;
}

export function dropTrace(event: string, detail: unknown): void {
  const path = `/tmp/drop-${String(Date.now())}-${dropSeq++}-${event}.json`;
  writeTextFile(path, JSON.stringify({ event, detail }, null, 1), null).catch(() => {});
}

export function currentDrop(): DropRecord | null {
  return dropDrag;
}

export function dragRecord(): DropRecord | null {
  const s = shared(DROP_KEY) as DropRecord | undefined;
  return dropDrag ?? (s?.tab ? s : null);
}

function cancelTimer(timer: Task): void {
  try {
    timer.cancel();
  } catch {}
}

function stopDropPoll(): void {
  if (!pollTimer) return;
  cancelTimer(pollTimer);
  pollTimer = null;
}

export function setDragRecord(value: DropRecord | null): void {
  dropDrag = value;
  if (!value) stopDropPoll();
  setShared(DROP_KEY, value ?? null);
}

export function dropHalf(
  zone: Zone | null | undefined,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } | null {
  if (!zone) return null;
  const halfWidth = Math.round(width / 2);
  const halfHeight = Math.round(height / 2);
  if (zone === "up") return { left: 0, top: 0, width, height: halfHeight };
  if (zone === "down") return { left: 0, top: halfHeight, width, height: height - halfHeight };
  if (zone === "left") return { left: 0, top: 0, width: halfWidth, height };
  return { left: halfWidth, top: 0, width: width - halfWidth, height };
}

function containsPointer(panel: Box, at: Point): boolean {
  return (
    at.x >= panel.left &&
    at.x <= panel.left + panel.width &&
    at.y >= panel.top &&
    at.y <= panel.top + panel.height
  );
}

function releasedBelowStrip(record: DropRecord, at: Point, strip: DropStrip): boolean {
  return (record.still ?? 0) >= DROP_STILL_TICKS && at.y > strip.y + strip.stripHeight;
}

function trackPointer(record: DropRecord, at: Point): void {
  const moved = !record.lastPos || record.lastPos.x !== at.x || record.lastPos.y !== at.y;
  record.lastPos = { x: at.x, y: at.y };
  record.still = moved ? 0 : (record.still ?? 0) + 1;
}

export function pollDrop(cx: AsyncContext): void {
  const poll = { lastZone: null as Zone | null, seq: 0 };
  stopDropPoll();
  pollTimer = cx.timer.every(DRAG_POLL_MS, (tickCx) => {
    const record = dropDrag;
    if (!record || !shared(DROP_KEY)) {
      dropDrag = null;
      stopDropPoll();
      return;
    }
    const sharedDrag = shared(DROP_KEY) as DropRecord | undefined;
    const releasedZone = record.released || sharedDrag?.released;
    if (releasedZone) {
      dropResolve(releasedZone, tickCx);
      return;
    }
    const at = globalWindow()?.mouse_position() ?? null;
    if (!at) return;
    const strip = record.strip as DropStrip;
    const zone = sampleDrop(record, at, strip, poll);
    if (releasedBelowStrip(record, at, strip)) {
      record.still = 0;
      dropResolve(zone, tickCx);
    }
  });
}

function sampleDrop(
  record: DropRecord,
  at: Point,
  strip: DropStrip,
  poll: { lastZone: Zone | null; seq: number },
): Zone | null {
  const panel = { left: strip.x, top: strip.y, width: strip.width, height: strip.height };
  const inside = containsPointer(panel, at);
  const zone = inside ? edgeZone(panel, at, strip.stripHeight) : null;
  if (poll.seq++ < INITIAL_TRACE_TICKS || zone !== poll.lastZone)
    dropTrace("poll", { at, zone, inside });
  trackPointer(record, at);
  if (zone !== poll.lastZone) {
    poll.lastZone = zone;
    record.zone = zone;
    setShared(DROP_KEY, { ...record });
  }
  return zone;
}

function keepTerminal(args: { terminal: string; place?: string }): { pane?: string } | null {
  return run("terminal.keep", args);
}

function whenParked(
  cx: AsyncContext,
  terminal: string,
  timeoutEvent: string,
  keep: (tickCx: AsyncContext) => void,
): void {
  let ticks = 0;
  const timer = cx.timer.every(DRAG_POLL_MS, (tickCx) => {
    ticks++;
    const attached = (panes() ?? []).some((p) => p.terminal === terminal);
    if (attached && ticks < MOUNT_POLL_LIMIT) return;
    cancelTimer(timer);
    if (attached) dropTrace(timeoutEvent, { terminal });
    else keep(tickCx);
  });
}

function swapWhenMounted(
  cx: AsyncContext,
  terminal: string,
  direction: Zone,
  targetPane: string | null | undefined,
): void {
  let ticks = 0;
  const timer = cx.timer.every(DRAG_POLL_MS, () => {
    ticks++;
    const current = panes() ?? [];
    const mounted = targetPane
      ? current.some((p) => p.pane === targetPane)
      : current.some((p) => p.terminal === terminal);
    if (!mounted && ticks < MOUNT_POLL_LIMIT) return;
    cancelTimer(timer);
    if (!mounted) return;
    const pane = targetPane ?? current.find((p) => p.terminal === terminal)?.pane;
    if (pane) {
      run("pane.swap", { direction, pane });
      dropTrace("move-swap", { pane, direction });
    }
  });
}

function sourceTerminal(tabId: string, allPanes: PaneInfo[]): string | null | undefined {
  return (
    allPanes.find((p) => p.tab === tabId && p.focused)?.terminal ??
    allPanes.find((p) => p.tab === tabId)?.terminal
  );
}

export function moveTabToSplit(
  fromTabId: string,
  zone: Zone,
  cx: AsyncContext | undefined,
  fromTerminalHint: string | null | undefined,
): void {
  const space = (spaces() ?? []).find((s) => s.active);
  const shown = space?.tabs ?? [];
  if (shown.length <= 1) return;
  const allPanes = panes() ?? [];
  const fromTerminal = fromTerminalHint ?? sourceTerminal(fromTabId, allPanes);
  if (!fromTerminal) return;
  run("terminal.park", { terminal: fromTerminal });
  dropTrace("move-park", { terminal: fromTerminal, fromTab: fromTabId, zone });
  if (!cx) return;
  const place = zone === "left" || zone === "right" ? "right" : "down";
  whenParked(cx, fromTerminal, "move-park-timeout", (tickCx) => {
    const res = keepTerminal({ terminal: fromTerminal, place });
    dropTrace("move-keep", { terminal: fromTerminal, place, res });
    if (zone === "left" || zone === "up") swapWhenMounted(tickCx, fromTerminal, zone, res?.pane);
  });
}

export function unsplitPaneToTab(
  terminal: string | null | undefined,
  cx: AsyncContext | undefined,
  paneId: string | null | undefined,
): void {
  const allPanes = panes() ?? [];
  const targetTerminal = terminal ?? allPanes.find((p) => p.pane === paneId)?.terminal;
  if (!targetTerminal) return;
  run("terminal.park", { terminal: targetTerminal });
  dropTrace("unsplit-park", { terminal: targetTerminal });
  if (!cx) return;
  whenParked(cx, targetTerminal, "unsplit-park-timeout", () => {
    const res = keepTerminal({ terminal: targetTerminal, place: "tab" });
    dropTrace("unsplit-keep", { terminal: targetTerminal, res });
  });
}

export function dropResolve(zone: Zone | null | undefined, cx: AsyncContext | undefined): void {
  dropTrace("resolve", { zone });
  const drag = dropDrag ?? (shared(DROP_KEY) as DropRecord | undefined);
  if (!drag) return;
  const overlay = drag.overlay;
  const fromTabId = drag.tab;
  const fromTerminal = drag.terminal;
  setDragRecord(null);
  if (overlay) closeOverlay(overlay);
  if (!zone || !fromTabId) return;
  moveTabToSplit(fromTabId, zone, cx, fromTerminal);
}

export function panelRect(
  top: number,
  stripHeight: number,
): (Box & { stripHeight: number }) | null {
  const vp = globalWindow()?.viewport_size() ?? null;
  if (!vp) return null;
  const root = layoutTree();
  const sidebar = find(root, "left-sidebar");
  const panel = find(root, "panel");
  const zoom = zoomOf();
  const left = scaledWidth(sidebar, 280, zoom);
  const right = scaledWidth(panel, 350, zoom);
  const status = find(root, "status");
  const bottom = visibleSize(status, STATUS_BAR_HEIGHT) / zoom;
  return {
    left,
    top,
    width: Math.max(0, vp.width - left - right),
    height: Math.max(0, vp.height - top - bottom),
    stripHeight,
  };
}
