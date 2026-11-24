// Derived from Herdr App's defaults/mods/tabs/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, terminals, run, openOverlay, closeOverlay, props, theme, window as appWindow, shared, layout, settings, setShared, writeTextFile, nextCommand } from "herdr";
import { selectTabPanes } from "./tab-panes.js";
import { edgeZone } from "./drop-zone.js";
import { sidebarEase } from "./sidebar-motion.js";
import { Drawer } from "./drawer.js";
import { settingsPillLeft, settingsReturnPage, settingsSidebarPlan, settingsHoldPx } from "./agent-settings-route.js";
import { stripLeadingAgentTitleDecoration } from "./tab-title.js";
import { TAB_STRIP_SLIDE_MS } from "./tab-item.js";
import { addSidebarToggle, addTabTrack, addEndControls } from "./header-controls.js";
import { find, scaledWidth, visibleSize, toggleLeft } from "./header-layout.js";
import { renderCloseDialog } from "./close-dialog.js";
import { newTabArgs } from "./new-tab.js";
import { UNOFFICIAL_APPS, unofficialByTerminal } from "./unofficial-apps.js";
import {
  clampTabStripScroll,
  revealTabStripSlot,
  tabStripActiveSlot,
  tabStripArrowState,
  tabStripContentWidth,
  tabStripOffset,
  tabStripScrollTarget,
} from "./tab-strip-scroll.js";



function paneForLabel(tabId) {
  return (panes() ?? []).find(p => p.tab === tabId && p.program?.agent) ?? (panes() ?? []).find(p => p.tab === tabId);
}

// What a tab with no name of its own is called: the unofficial CLI's name, the pane's title, the program.
function derivedTabName(raw, pane, unofficial) {
  return unofficial?.name || pane?.title || pane?.program?.name || raw || "Terminal";
}

function tabLabel(c, pane, unofficial) {
  const raw = c.name ?? "Terminal";
  const name = c.named ? raw : derivedTabName(raw, pane, unofficial);
  return pane?.program?.agent ? stripLeadingAgentTitleDecoration(name) : name;
}

// The per-space panel choices kept from last time; anything unreadable starts empty.
function storedPanels() {
  try {
    const stored = JSON.parse(localStorage.getItem("panels") ?? "{}");
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

// A press counted in `view[field]` while no render was live: an odd count is a toggle, an even one cancels out.
function takeToggle(view, field) {
  const count = view[field];
  if (!count) return false;
  view[field] = 0;
  return count % 2 === 1;
}

function lightsOverlap(w, lights) {
  return w.platform === "macos" && w.titlebar === "none" && !w.fullscreen && lights?.length;
}

// .titlebar has no horizontal padding (main.css:1072-1084), so the strip is flush from the
// left; only macOS traffic lights that land over this column reserve space. Old saved rails
// and a dragged-narrow sidebar can be smaller than the window buttons.
// (scripts/titlebar-height.test.js reads the expression below from this file.)
function trafficLightPadding(root, w, sidebar, unified) {
  const lights = root?.traffic_lights;
  return lightsOverlap(w, lights)
    ? Math.max(0, (lights[0] + 64) / (settings()?.zoom || 1) - (unified || sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
    : 0;
}

const sidebarHiddenNow = () => Boolean(find(layout(), "left-sidebar")?.hidden);

// How long a sidebar motion takes: longer the farther it goes, with a floor for a nudge.
function sidebarMotionMs(distance) {
  return (320 + 120 * distance) * (0.5 + 0.5 * distance) + 60;
}

// Where a sidebar press goes (1 open, 0 closed) and the fraction it starts from: a second press
// reverses a running motion from where it is, otherwise it flips the node's state.
function sidebarPlan(drawer, node) {
  const hidden = Boolean(node?.hidden);
  const open = drawer.openPx > 0 ? drawer.openPx : SIDEBAR_DEFAULT_OPEN;
  if (drawer.busy) return { open, target: drawer.goal === 1 ? 0 : 1, from: drawer.p };
  return { open, target: hidden ? 1 : 0, from: hidden ? 0 : Math.min(1, (node?.size?.px ?? open) / open) };
}

// --- Tab drop-to-split ------------------------------------------------------
// Orca paints `TabGroupDropOverlay` over half the panel while a tab is dragged
// (`TabPaneColumnSplitDragOverlay.tsx:11-54`) and picks the zone with
// `resolvePaneColumnEdgeZone` (`tab-drop-zone.ts:38-88`).
// Orca does not learn the pointer from the dragged tab either: its sensor listens on `document`
// for `pointermove`/`pointerup`/`pointercancel` (`tab-drag-pointer-sensor.ts:174-176`) and
// records the point globally (`tab-drag-pointer.ts:18`). This host also keeps the pointer itself:
// `window.mouse_position()` (`gpui-kit.d.ts:20498`, `window_api.rs:278`), readable from any view,
// terminal or not. So the drag is polled by a timer and carried by a frame-less overlay window
// that paints the quadrant and takes the release.
const STATUS_BAR_HEIGHT = 24; // `orca-status` draws this (`layouts/orca.json` node `status`).
const TAB_STRIP_FALLBACK = 32; // `TAB_GROUP_TAB_STRIP_HEIGHT_PX` (tab-drop-zone.ts:4), the fallback.
// The reference design's sidebar collapse is 300ms.
const GLIDE_START_MS = 40;
const SIDEBAR_GLIDE_MS = 300;
const SIDEBAR_STEP_MS = 16; // one step per frame (60fps); steps that would not change the width are skipped
const SIDEBAR_RESIZE_SETTLE_MS = 80; // after sizing a hidden sidebar to 1px, before `show`
const SIDEBAR_SHOW_SETTLE_MS = 50;
const SIDEBAR_HIDE_SETTLE_MS = 80;
const LEAVE_RENDER_MS = 1; // one tick, enough to be out of the render phase
const SIDEBAR_DEFAULT_OPEN = 259;
const DRAWER_MIN_OPEN_PX = 120; // a narrower node is mid-motion, not a width worth remembering
// The reference design's drawer curve, cubic-bezier(.32,.72,0,1), solved by bisection.
const drawerEase = (() => {
  const [x1, y1, x2, y2] = [.32, .72, 0, 1];
  const bx = t => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = t => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (x) => { let lo = 0, hi = 1, t = x; for (let i = 0; i < 24; i++) { if (bx(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; } return by(t); };
})();
const DROP_STILL_TICKS = 20; // ~320ms of a motionless pointer is the release fallback, since the host has no button state.
const TAB_DRAG_DISTANCE = 12; // `useTabDragSplit.ts:42` — dnd-kit activation distance, and how far down a press must travel before it is a split.
const WINDOW_RETRY_MS = 50;
const PANEL_RESTORE_TIMEOUT_MS = 1000;
const WINDOW_RETRIES = 20;
const OVERLAY_PROBE_MS = 300;
const SLIDE_GRACE_MS = 60;
const DRAG_POLL_MS = 16;
const MOUNT_POLL_LIMIT = 60;
const INITIAL_TRACE_TICKS = 8;
const DROP_REV = 13; // bumped every time the instrumentation changes
let dropSeq = 0;
function dropTrace(event, detail) {
  const path = `/tmp/drop-${String(Date.now())}-${dropSeq++}-${event}.json`;
  writeTextFile(path, JSON.stringify({ event, detail }, null, 1), null).catch(() => { /* Diagnostic output is best effort. */ });
}

// The tab column's rect, measured rather than assumed: the layout (this package's `orca` layout) sets `left-sidebar` to
// 280px and `status` to 24px, the strip reports its own top and height, and the rest is the
// viewport. A hidden rail contributes nothing (its node is skipped, `layout.rs:551`).
function panelRect(top, stripHeight) {
  const vp = typeof window !== "undefined" ? window.viewport_size() : null;
  if (!vp) return null;
  const root = layout();
  const sidebar = find(root, "left-sidebar"), panel = find(root, "panel");
  const zoom = settings()?.zoom || 1;
  const left = scaledWidth(sidebar, 280, zoom);
  const right = scaledWidth(panel, 350, zoom);
  // the layout's `status` node, so a resized or hidden bar stays right.
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


let dropDrag = null;
let pollTimer = null;
// `mods.rs:432` — `shared()` is the host's per-key store, one value every mod instance reads,
// and `set_shared` refreshes the views. Module memory is NOT shared: an overlay copy of this mod
// runs in its own realm, which is why the record lives here.
const DROP_KEY = "orca-tabs.drop";
function dragRecord() {
  const s = shared(DROP_KEY);
  return dropDrag ?? (s?.tab ? s : null);
}
function cancelTimer(timer) {
  try { timer.cancel(); } catch { /* The timer may already have ended. */ }
}

function stopDropPoll() {
  if (!pollTimer) return;
  cancelTimer(pollTimer);
  pollTimer = null;
}

function setDragRecord(value) {
  dropDrag = value;
  if (!value) stopDropPoll();
  // `null` or `undefined` clears the record in the host's shared store.
  setShared(DROP_KEY, value ?? null);
}

function insertionSide(event) {
  const width = event.bounds?.width ?? 144;
  const localX = event.local_position?.x ?? width / 2;
  return localX < width / 2 ? "left" : "right";
}

function dropHalf(zone, width, height) {
  if (!zone) return null;
  const halfWidth = Math.round(width / 2), halfHeight = Math.round(height / 2);
  if (zone === "up") return { left: 0, top: 0, width, height: halfHeight };
  if (zone === "down") return { left: 0, top: halfHeight, width, height: height - halfHeight };
  if (zone === "left") return { left: 0, top: 0, width: halfWidth, height };
  return { left: halfWidth, top: 0, width: width - halfWidth, height };
}

function containsPointer(panel, at) {
  return at.x >= panel.left && at.x <= panel.left + panel.width
    && at.y >= panel.top && at.y <= panel.top + panel.height;
}

function releasedBelowStrip(at, strip) {
  return dropDrag.still >= DROP_STILL_TICKS && at.y > strip.y + strip.stripHeight;
}

function trackPointer(at) {
  const moved = !dropDrag.lastPos || dropDrag.lastPos.x !== at.x || dropDrag.lastPos.y !== at.y;
  dropDrag.lastPos = { x: at.x, y: at.y };
  // The overlay takes no pointer events for a press that started elsewhere (measured: no
  // `drop-move`, no `drop-up` for a real drag) and the host exposes no button state, so the
  // release is inferred: a pointer that stops moving, below the strip, is where it was let go.
  dropDrag.still = moved ? 0 : (dropDrag.still ?? 0) + 1;
}

// The poll writes here; the overlay's view reads it on its own tick and repaints. Two views of
// one module share `dropDrag`, and neither needs the other's `cx`.
function pollDrop(cx) {
  const poll = { lastZone: null, seq: 0 };
  stopDropPoll();
  pollTimer = cx.timer.every(DRAG_POLL_MS, (tickCx) => {
    if (!dropDrag || !shared(DROP_KEY)) {
      dropDrag = null;
      stopDropPoll();
      return;
    }
    const sharedDrag = shared(DROP_KEY);
    const releasedZone = dropDrag.released || sharedDrag?.released;
    if (releasedZone) {
      dropResolve(releasedZone, tickCx);
      return;
    }
    const at = typeof window !== "undefined" ? window.mouse_position() : null;
    if (!at) return;
    const strip = dropDrag.strip;
    const zone = sampleDrop(at, strip, poll);
    if (releasedBelowStrip(at, strip)) {
      dropDrag.still = 0;
      dropResolve(zone, tickCx);
    }
  });
}

// One look at the pointer during a drop: which zone it is over, and the zone published when it changed.
function sampleDrop(at, strip, poll) {
  const panel = { left: strip.x, top: strip.y, width: strip.width, height: strip.height };
  // Inside the panel first, as Orca requires before asking for a zone
  // (`tab-group-panel-split-target.ts:210-218`).
  const inside = containsPointer(panel, at);
  const zone = inside ? edgeZone(panel, at, strip.stripHeight) : null;
  if (poll.seq++ < INITIAL_TRACE_TICKS || zone !== poll.lastZone) dropTrace("poll", { at, zone, inside });
  trackPointer(at);
  if (zone !== poll.lastZone) {
    poll.lastZone = zone;
    dropDrag.zone = zone;
    setShared(DROP_KEY, { ...dropDrag });
  }
  return zone;
}

function whenParked(cx, terminal, timeoutEvent, keep) {
  let ticks = 0;
  const timer = cx.timer.every(DRAG_POLL_MS, (tickCx) => {
    ticks++;
    const attached = (panes() ?? []).some(p => p.terminal === terminal);
    if (attached && ticks < MOUNT_POLL_LIMIT) return;
    cancelTimer(timer);
    if (attached) dropTrace(timeoutEvent, { terminal });
    else keep(tickCx);
  });
}

function swapWhenMounted(cx, terminal, direction, targetPane) {
  let ticks = 0;
  const timer = cx.timer.every(DRAG_POLL_MS, () => {
    ticks++;
    const current = panes() ?? [];
    const mounted = targetPane
      ? current.some(p => p.pane === targetPane)
      : current.some(p => p.terminal === terminal);
    if (!mounted && ticks < MOUNT_POLL_LIMIT) return;
    cancelTimer(timer);
    if (!mounted) return;
    const pane = targetPane ?? current.find(p => p.terminal === terminal)?.pane;
    if (pane) {
      run("pane.swap", { direction, pane });
      dropTrace("move-swap", { pane, direction });
    }
  });
}

function sourceTerminal(tabId, allPanes) {
  return allPanes.find(p => p.tab === tabId && p.focused)?.terminal
    ?? allPanes.find(p => p.tab === tabId)?.terminal;
}

// In Orca (`tabs-drop-actions.ts:26-170` and `tab-move-to-pane-column.ts:45-84`), moving a tab
// into a split column moves the dragged/selected tab into the split group and removes it from
// the source group. If sourceTabCount <= 1 on its own matching panel, it is a no-op (`pane-column-split-drop-no-op.ts:60-62`
// & `tab-drag-data.ts:46`). In Herdr, we port this behavior:
// 1. If shown.length <= 1, do nothing (`isPaneColumnSplitDropNoOp`).
// 2. Take the dragged tab's terminal, park it via `terminal.park` (`commands.rs:46`, `window.rs:2569-2607`),
//    which detaches its pane and closes the tab once empty (`model.rs:350-388`).
// 3. Once parking finishes, place it into the active tab via `terminal.keep` (`commands.rs:45`, `window.rs:2541-2635`).
// 4. If the split was "left" or "up", swap the new pane with its neighbor via `pane.swap` (`window.rs:3026-3042`).
function moveTabToSplit(fromTabId, zone, cx, fromTerminalHint) {
  const space = (spaces() ?? []).find((s) => s.active);
  const shown = space?.tabs ?? [];
  // `pane-column-split-drop-no-op.ts:60-62` & `tab-drag-data.ts:46`:
  // Dropping a group's last tab on its own matching panel is a no-op.
  if (shown.length <= 1) return;

  const allPanes = panes() ?? [];
  const fromTerminal = fromTerminalHint ?? sourceTerminal(fromTabId, allPanes);
  if (!fromTerminal) return;

  run("terminal.park", { terminal: fromTerminal });
  dropTrace("move-park", { terminal: fromTerminal, fromTab: fromTabId, zone });

  if (!cx) return;

  const place = (zone === "left" || zone === "right") ? "right" : "down";
  whenParked(cx, fromTerminal, "move-park-timeout", (tickCx) => {
    const res = run("terminal.keep", { terminal: fromTerminal, place });
    dropTrace("move-keep", { terminal: fromTerminal, place, res });
    if (zone === "left" || zone === "up") swapWhenMounted(tickCx, fromTerminal, zone, res?.pane);
  });
}

// In Orca (`tab-drag-drop-commit.ts:147-175`, `tab-drag-drop-commit.ts:184-210`, and `tabs-drop-actions.ts:149-158`),
// moving a tab from a split group into another group's tab strip or center collapses the source group
// once empty (unsplits). In Herdr, a tab contains multiple panes when split. Moving a split pane to a
// separate tab unsplits the original tab and gives the pane its own top-level tab:
// 1. Park the terminal via `terminal.park` (`commands.rs:46`), detaching its pane from the split tab.
// 2. The remaining panes in the tab expand to fill the tab (unsplit).
// 3. Once parking finishes, place the terminal into its own tab via `terminal.keep` (`commands.rs:45`, `window.rs:3059`).
function unsplitPaneToTab(terminal, cx, paneId) {
  const allPanes = panes() ?? [];
  const targetTerminal = terminal ?? allPanes.find((p) => p.pane === paneId)?.terminal;
  if (!targetTerminal) return;

  run("terminal.park", { terminal: targetTerminal });
  dropTrace("unsplit-park", { terminal: targetTerminal });

  if (!cx) return;

  whenParked(cx, targetTerminal, "unsplit-park-timeout", () => {
    const res = run("terminal.keep", { terminal: targetTerminal, place: "tab" });
    dropTrace("unsplit-keep", { terminal: targetTerminal, res });
  });
}

function dropResolve(zone, cx) {
  dropTrace("resolve", { zone });
  const drag = dropDrag ?? shared(DROP_KEY);
  if (!drag) return;
  const overlay = drag.overlay;
  const fromTabId = drag.tab;
  const fromTerminal = drag.terminal;
  setDragRecord(null);
  if (overlay) closeOverlay(overlay);
  if (!zone || !fromTabId) return;

  moveTabToSplit(fromTabId, zone, cx, fromTerminal);
}

// The drag in flight: the tab it started from and the panel it aims at. Written through
// `DROP_KEY` above, because the overlay's copy of this mod is a separate realm.

export default class Tabs extends View {
  // Built here rather than in `init()`: the dialog and drag-overlay copies return from `init()`
  // early and still render, so every instance needs its drawers.
  constructor(...args) {
    super(...args);
    this.initDrawers();
  }

  // The two animated drawers (drawer.js). Both hold `main` narrow while they move, so the pin and
  // the header width that computes it live here rather than on a drawer.
  initDrawers() {
    this.nativePinned = false;
    this.nativeHeaderWidth = 0;
    this.drawers = {
      sidebar: new Drawer({
        id: "left-sidebar", defaultOpen: 259, measure: "measureSidebar",
        pin: () => (props()?.pinSidebarTerminal && !this.nativePinned && this.nativeHeaderWidth > 0 ? this.nativeHeaderWidth / (settings()?.zoom || 1) : null),
        after: (target) => setShared("left-sidebar.collapsed", target === 0),
      }),
      // Size the PTY for the open panel before moving the panel, and hold that width during motion.
      panel: new Drawer({
        id: "panel", defaultOpen: 350, measure: "measurePanel",
        pin: (open) => {
          if (!(this.nativeHeaderWidth > 0)) return null;
          const root = layout();
          const sb = find(root, "left-sidebar"), panel = find(root, "panel");
          const sidebarWidth = visibleSize(sb, 0);
          const panelWidth = visibleSize(panel, 0);
          return Math.max(1, this.nativeHeaderWidth / (settings()?.zoom || 1) + panelWidth - open - sidebarWidth);
        },
      }),
    };
  }

  init(_props, cx) {
    const p = _props?.confirmClose ? _props : props();
    // TEMPORARY: which copy of this mod is actually running. A drag that leaves no trace at all
    // then means "stale copy", not "handler never fired".
    dropTrace("load", {
      rev: DROP_REV,
      drop: Boolean(p?.drop),
      stale: Boolean(shared(DROP_KEY)),
      from: p?.drop ? "overlay" : "strip",
    });
    if (p?.confirmClose) {
      this.isDialog = true;
      this.dontAskAgain = false;
      this.handle = cx.focus_handle();
      this.handle.focus();
      return;
    }
    if (p?.drop) {
      this.initDropOverlay(cx);
      return;
    }
    this.pressed = null;
    this.overTab = null;
    this.overSide = null;
    // Which tab is under the pointer. Orca's close/collapse reveal is `group-hover` on the
    // tab (SortableTab.tsx:317,323); gpui-kit has no group-hover, so the id is tracked here.
    this.hoveredTab = null;
    // The tab strip scrolls itself: Herdr has no horizontal scroller a mod can read back
    // (`ScrollHandle` only takes requests, gpui-kit.d.ts:21331) and no `position: sticky`, so this
    // offset is the strip's only scroll position and there is no second copy to fall out of step
    // with. Widths are measured, never assumed: a tab is as wide as its label.
    this.scrollX = 0;
    this.viewportWidth = 0;
    this.contentWidth = 0;
    this.tabWidths = new Map();
    this.activeTabId = undefined;
    this.revealPending = false;
    this.animatedUntil = 0;
    this.glideShift = 0;
    this.glideGen = 0;
    this.panels = storedPanels();
    this.seedWindow(cx);
    this.listenForCommands(cx);
  }

  initDropOverlay(cx) {
    // The drop overlay's copy: a frame-less window over the whole app, painting the panel
    // quadrant Orca paints (`TabPaneColumnSplitDragOverlay.tsx:11-54`).
    this.isDropOverlay = true;
    this.zone = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // The strip's poll writes the pointer and the zone into module memory; this copy repaints
    // when either moves. Its own handlers also resolve the drop, so a release that arrives
    // here is never lost.
    cx.timer.after(OVERLAY_PROBE_MS, (probeCx) => {
      const seen = dragRecord();
      dropTrace("overlay-alive", {
        seesRecord: Boolean(seen),
        key: shared(DROP_KEY) ? "set" : "unset",
        zone: seen?.zone ?? null,
      });
      probeCx.notify();
    });
    cx.timer.every(DRAG_POLL_MS, (tickCx) => {
      const drag = dragRecord();
      if (!drag) {
        if (this.zone !== null) { this.zone = null; tickCx.notify(); }
        return;
      }
      if (drag.zone === this.zone) return;
      this.zone = drag.zone;
      tickCx.notify();
    });
  }

  seedWindow(cx) {
    // `window()` is null until the window publishes it. Seed it here first; if it is still
    // null, read it again in the task phase, cache it, and repaint. Orca seeds the same flags
    // with useState(false) + useEffect (WindowControls.tsx:7-16).
    this.windowState = appWindow();
    const seed = (seedCx, tries) => {
      const w = appWindow();
      if (w) { this.windowState = w; seedCx.notify(); return; }
      if (tries > 0) seedCx.timer.after(WINDOW_RETRY_MS, (retryCx) => seed(retryCx, tries - 1));
    };
    if (!this.windowState) cx.timer.after(0, (firstCx) => seed(firstCx, WINDOW_RETRIES));
  }

  listenForCommands(cx) {
    // One instance handles new tabs and sidebar toggles; overlays return early from init().
    cx.spawn(async (taskCx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "new-tab") {
          run("tab.new", newTabArgs(spaces().find((s) => s.active)));
          continue;
        }
        if (command === "agent-settings") {
          this.requestSettingsPage("main-agents", taskCx);
          continue;
        }
        if (!props()?.unified) continue;
        if (command === "toggle-sidebar") this.wantToggle = (this.wantToggle ?? 0) + 1;
        if (command === "toggle-panel") this.wantPanelToggle = (this.wantPanelToggle ?? 0) + 1;
        if (command === "toggle-sidebar" || command === "toggle-panel") taskCx.notify();
      }
    });
  }

  // useTabDragSplit.ts:42 — TAB_DRAG_ACTIVATION_DISTANCE_PX = 12. Once downward travel reaches
  // 12px, hand the drag to a popup overlay positioned over the terminal area.
  triggerSplit(box, at, cx) {
    if (this.pressed === null || dragRecord() || !this.pressAt) return false;
    const space = (spaces() ?? []).find(s => s.active);
    const shown = space?.tabs ?? [];
    // `pane-column-split-drop-no-op.ts:60-62` & `tab-drag-data.ts:46`:
    // Dropping a group's last tab on its own matching panel is a no-op;
    // Orca requires overGroup.tabOrder.length > 1 before allowing a pane-body drop split.
    if (shown.length <= 1) return false;
    const rect = box?.width ? panelRect(box.y, box.height) : null;
    if (!rect || at.y - this.pressAt.y < TAB_DRAG_DISTANCE) return false;
    const bodyTop = rect.top + rect.stripHeight;
    const bodyHeight = Math.max(1, rect.height - rect.stripHeight);
    setDragRecord({
      tab: this.dragTab,
      terminal: this.dragTerminal,
      pane: this.dragPane,
      strip: { x: rect.left, y: rect.top, width: rect.width, height: rect.height, stripHeight: rect.stripHeight },
    });
    this.pressed = null;
    this.overTab = null;
    this.overSide = null;
    dropTrace("handoff", { press: this.pressAt, at, rect });
    const overlayId = openOverlay({
      mod: "orca-tabs",
      kind: "popup",
      frame: "none",
      at: { x: rect.left, y: bodyTop },
      width: rect.width,
      height: bodyHeight,
      props: { drop: true },
    });
    dropDrag.overlay = overlayId;
    setShared(DROP_KEY, { ...dropDrag });
    pollDrop(cx);
    cx.notify();
    return true;
  }

  // Orca's menu is `align="end"` under the `+` (tab-bar-surface.tsx:224-240). A popup defaults to the pointer, which
  // near the right edge slides the menu up over the tab strip; anchor it under the button instead.
  newMenuAt() {
    const b = this.plusBounds, vp = typeof window !== "undefined" ? window.viewport_size() : null;
    if (!b || !vp) return "pointer";
    return { x: Math.max(8, Math.min(b.x + b.width - 288, vp.width - 288 - 8)), y: b.y + b.height + 4 };
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  // `AppWorkspaceShell.tsx:106` decides when Orca's landing shows:
  //   activeView === 'terminal' && !hasActiveWorktree && !creationLayoutActive
  // In Herdr the equivalent of `!hasActiveWorktree` is "no space is active": with none open
  // there is no tab surface to draw, which is exactly the blank canvas Orca puts the page on.
  // The center is a stack (`main`) holding `main-terminals` and `main-landing`, so switching is
  // `layout.select` — the same call this mod already makes for `panel-body`.
  syncLanding(cx) {
    if (find(layout(), "main")?.active === "main-agents") return;
    // Orca's `hasActiveWorktree` is about the SELECTED worktree, not about whether any exists:
    // a selected space with no tabs open is still "no active worktree", and that is the blank
    // canvas Landing sits on. So the test is "the active space has at least one tab".
    const active = (spaces() ?? []).find((s) => s.active);
    const want = (active?.tabs?.length ?? 0) > 0 ? "main-terminals" : "main-landing";
    // Seed from the layout rather than from `undefined`: on the first render there is nothing
    // to compare against, so a `this.landing` of undefined would either skip the switch when
    // it was needed or fire one that was not.
    if (this.landing === undefined) {
      const stack = find(layout(), "main");
      this.landing = stack && "active" in stack ? stack.active : null;
    }
    if (this.landing === want) return;
    this.landing = want;
    run("layout.select", { stack: "main", child: want });
  }

  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) this.restorePanel(space, panel, now, enabled);
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  restorePanel(space, panel, now, enabled) {
    this.space = space.id; this.pending = null;
    // Restore what the person left: a remembered tool shows it, a remembered hide (null) hides it,
    // and a space never seen keeps the layout's default. Only a remembered hide is kept as hidden.
    const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
    if (want) {
      if (want !== now || panel.hidden) this.pending = { want, until: Date.now() + PANEL_RESTORE_TIMEOUT_MS };
      if (want !== now) run("layout.select", { stack: "panel-body", child: want });
      if (panel.hidden) run("layout.show", { id: "panel" });
    } else if (space.id in this.panels && this.panels[space.id] === null && !panel.hidden) {
      this.pending = { want: null, until: Date.now() + PANEL_RESTORE_TIMEOUT_MS };
      run("layout.hide", { id: "panel" });
    }
  }

  // --- Tab strip scrolling ---------------------------------------------------
  // `tab-strip-scroll.js` holds the geometry; what follows are the state changes that use it.
  // Herdr offers no native scroller a mod can read back and no sticky positioning, so the strip
  // carries the one scroll offset there is — nothing else can disagree with it (spec §9).

  // `on_size_change` (gpui-kit.d.ts:734-736) is the only measurement a mod gets, so every tab
  // reports its own width and the strip adds them up. Repainting once per real change keeps a
  // resize from turning into a render loop.
  measureTabWidth(id, width, cx) {
    const known = this.tabWidths.get(id);
    if (known !== undefined && Math.abs(known - width) < 0.5) return;
    this.tabWidths.set(id, width);
    cx.notify();
  }

  // Real input (a wheel, a trackpad) is not a slide: it moves the strip now.
  stopSlide() {
    this.animatedUntil = 0;
  }

  // Every scroll change goes through here, so the offset is clamped against the real track each
  // time and a wheel can never leave it past an end.
  setStripScroll(x, cx) {
    const next = clampTabStripScroll(x, this.viewportWidth, this.contentWidth);
    if (next === this.scrollX) return;
    this.scrollX = next;
    cx.notify();
  }

  // Arrow press: `scrollTabStripByStep` (tab-strip-overflow-navigation.ts:22-31) moves three
  // quarters of the viewport, at least 120px, and `scrollBy({behavior: 'smooth'})` eases the move.
  // GPUI's own `transition` is that ease — it runs natively between frames, so nothing here needs
  // a timer. The flag only says "these next changes slide"; it lapses on its own, so a wheel or a
  // trackpad in between moves the strip directly, the way `scrollBy` is cut short by real input.
  // Unified layout: the toggle steps the sidebar's width itself, so the strip, the sidebar content
  // and the terminals move in the same frames (only `layout.resize` can move a layout node). The
  // loop owns just the target width; everything drawn is derived from the width `layout()` reports.
  // A second press while it runs reverses from where it is. The PTY is resized once at the end
  // (measured), not per step. Collapse ends with `hide` and puts the open width back while hidden,
  // so the next `show` returns at that width; expand starts from 1px while hidden.
  toggleSidebar(cx) {
    // Only the unified layout has the header clock and the content frames, so anywhere else keeps
    // the plain toggle `keys.json` used to call.
    if (!props()?.unified) return run("layout.toggle", { id: "left-sidebar" });
    if (props()?.motion === "native") return this.toggleSidebarNative(cx);
    this.startSidebarMotion(cx, sidebarPlan(this.drawers.sidebar, find(layout(), "left-sidebar")));
  }

  startSidebarMotion(cx, plan, onFinish) {
    const drawer = this.drawers.sidebar;
    const token = ++drawer.token;
    drawer.busy = true; drawer.goal = plan.target;
    cx.spawn((taskCx) => this.runSidebarMotion(taskCx, token, plan, onFinish));
  }

  async runSidebarMotion(cx, token, { open, target, from }, onFinish) {
    const drawer = this.drawers.sidebar;
    await cx.sleep(LEAVE_RENDER_MS); // leave the render phase: notify() is only legal from a task
    if (token !== drawer.token) return;
    if (!(await this.showSidebarFromHidden(cx, token, target))) return;
    const dur = sidebarMotionMs(Math.abs(target - from));
    const motion = { open, target, from, dur, t0: Date.now(), kind: props()?.motion === "layout" ? "layout" : "smooth", samples: props()?.measureSidebar ? [] : null };
    if (!(await this.stepSidebar(cx, token, motion))) return;
    if (motion.samples) writeTextFile(`/tmp/sidebar-motion-${motion.t0}.json`, JSON.stringify({ motion: motion.kind, open, target, dur, samples: motion.samples }), null).catch(() => { /* Diagnostic output is best effort. */ });
    if (target === 0) {
      run("layout.hide", { id: "left-sidebar" });
      await cx.sleep(SIDEBAR_HIDE_SETTLE_MS);
      if (token !== drawer.token) return;
      if (onFinish) run("layout.resize", { id: "left-sidebar", px: open });
    }
    if (onFinish) onFinish();
    else {
      run("layout.resize", { id: "left-sidebar", px: open });
      setShared("left-sidebar.collapsed", target === 0);
    }
    drawer.busy = false; drawer.goal = undefined;
    cx.notify();
  }

  // Read the node live: a press can land in the tail of a collapse (hide already sent) or in the
  // preamble of an expand (show not yet applied), and `hidden` above may be a frame stale.
  // False when a newer press took over while this one waited.
  async showSidebarFromHidden(cx, token, target) {
    if (target <= 0 || !sidebarHiddenNow()) return true;
    const drawer = this.drawers.sidebar;
    run("layout.resize", { id: "left-sidebar", px: 1 });
    await cx.sleep(SIDEBAR_RESIZE_SETTLE_MS);
    if (token !== drawer.token) return false;
    run("layout.show", { id: "left-sidebar" });
    await cx.sleep(SIDEBAR_SHOW_SETTLE_MS);
    return token === drawer.token;
  }

  // The width steps of one sidebar motion; false when a newer press took over while it slept.
  async stepSidebar(cx, token, { open, target, from, dur, t0, kind, samples }) {
    const drawer = this.drawers.sidebar;
    const ease = kind === "layout" ? drawerEase : sidebarEase;
    let lastPx = -1;
    for (;;) {
      const k = Math.min(1, (Date.now() - t0) / dur);
      drawer.p = from + (target - from) * ease(k);
      const px = Math.max(1, Math.round(open * drawer.p));
      if (px !== lastPx) { // each resize repaints the terminals, so never send one that changes nothing
        lastPx = px;
        if (samples) samples.push({ ms: Date.now() - t0, px });
        run("layout.resize", { id: "left-sidebar", px });
        if (target > 0 && sidebarHiddenNow()) run("layout.show", { id: "left-sidebar" }); // the hide of a reversed collapse landed late
        cx.notify();
      }
      if (k >= 1) return true;
      await cx.sleep(SIDEBAR_STEP_MS);
      if (token !== drawer.token) return false;
    }
  }

  // One implementation for both drawers (drawer.js); each toggle only says which node and how the
  // terminal is held while it moves.
  drawerEnv() {
    return {
      run, find, layout, props,
      zoom: () => settings()?.zoom || 1,
      write: (path, text) => writeTextFile(path, text, null),
      pin: (px) => { this.nativePinned = true; run("layout.resize", { id: "main", px }); },
      release: () => this.releaseNativePin(),
    };
  }

  toggleSidebarNative(cx) { this.drawers.sidebar.toggle(cx, this.drawerEnv()); }

  // Only the unified layout renders the panel's clock, so anywhere else keeps the plain toggle.
  togglePanel(cx) {
    if (!props()?.unified) return run("layout.toggle", { id: "panel" });
    this.togglePanelNative(cx);
  }

  togglePanelNative(cx) { this.drawers.panel.toggle(cx, this.drawerEnv()); }

  releaseNativePin() {
    if (this.nativePinned && !this.drawers.sidebar.busy && !this.drawers.panel.busy) {
      run("layout.resize", { id: "main", weight: 1 });
      this.nativePinned = false;
    }
  }

  scrollTabStrip(direction, cx) {
    const to = tabStripScrollTarget(this.scrollX, this.viewportWidth, this.contentWidth, direction);
    if (to === this.scrollX) return;
    this.animatedUntil = Date.now() + TAB_STRIP_SLIDE_MS + SLIDE_GRACE_MS;
    this.setStripScroll(to, cx);
  }

  // Whether this frame's scroll change is an arrow's slide or input's direct move.
  sliding() {
    return Boolean(this.animatedUntil) && Date.now() < this.animatedUntil;
  }

  // `scrollStripSidewaysOnWheel` (tab-strip-scroll-metrics.ts:14-21): a mouse wheel comes in
  // vertically and turns the strip sideways, while a trackpad's own horizontal delta goes the
  // way it is pushed. Both land on the same `scrollX` as the arrows, so the sticky behaviour and
  // the limits are identical whichever the person uses.
  wheelTabStrip(e, cx) {
    const dx = Math.abs(e.delta?.x ?? 0) >= Math.abs(e.delta?.y ?? 0) ? e.delta?.x ?? 0 : e.delta?.y ?? 0;
    if (!dx) return;
    this.stopSlide();
    this.setStripScroll(this.scrollX + dx, cx);
  }

  measuredWidths(ids) {
    for (const id of [...this.tabWidths.keys()]) {
      if (!ids.includes(id)) this.tabWidths.delete(id);
    }
    return ids.map((id) => this.tabWidths.get(id) ?? 0);
  }

  // Everything the strip needs to know about itself this frame: the measured widths, the real
  // track limits, which arrows are live, and where the active tab is drawn. The dock never feeds
  // back into any of it — that is the whole point of §4.
  stripGeometry(shown) {
    const ids = shown.map(tab => tab.id);
    const widths = this.measuredWidths(ids);
    const contentWidth = tabStripContentWidth(widths);
    this.contentWidth = contentWidth;
    const activeIndex = shown.findIndex((c) => c.active);
    const activeId = activeIndex >= 0 ? ids[activeIndex] : null;

    // A newly selected tab comes on screen with the smallest scroll that shows it — Orca's
    // `revealTabStripSlot` (tab-strip-slot-geometry.ts:84-107). A tab that is already visible
    // leaves the strip exactly where the person put it.
    if (activeId !== this.activeTabId) {
      this.activeTabId = activeId;
      this.revealPending = activeId !== null;
    }
    const measured = this.viewportWidth > 0 && widths.every((w) => w > 0);
    if (this.revealPending && activeIndex >= 0 && measured) {
      this.scrollX = revealTabStripSlot(
        this.scrollX,
        this.viewportWidth,
        contentWidth,
        tabStripOffset(widths, activeIndex),
        widths[activeIndex]
      );
      this.revealPending = false;
    }
    this.scrollX = clampTabStripScroll(this.scrollX, this.viewportWidth, contentWidth);

    const activeWidth = activeIndex >= 0 ? widths[activeIndex] : 0;
    const slot = tabStripActiveSlot({
      scrollLeft: this.scrollX,
      viewportWidth: this.viewportWidth,
      contentWidth,
      activeOffset: activeIndex >= 0 ? tabStripOffset(widths, activeIndex) : 0,
      activeWidth,
    });
    return {
      arrows: tabStripArrowState(this.scrollX, this.viewportWidth, contentWidth),
      slot,
      activeTab: activeIndex >= 0 ? shown[activeIndex] : null,
      activeIndex,
      activeWidth,
      // The pinned copy is drawn only while the tab is actually held at an edge; at rest the tab
      // draws in its own slot exactly as it always did.
      docked: slot.docked && activeWidth > 0,
    };
  }

  // Official agents resolve through their own report or the program table. An unofficial CLI
  // cannot, so its tab keeps the name the menu shows instead of Herdr's fallback title
  // (freebuff sets none, so the tab would otherwise be called by its terminal address, "t9k").
  unofficialApp(pane, byTerminal = undefined) {
    if (!pane) return null;
    const direct = UNOFFICIAL_APPS.find((a) => a.key === pane.app);
    if (direct) return direct;
    // An official agent's own name and icon always win over a launch command that mentions one.
    if (pane.program?.agent) return null;
    return (byTerminal ?? unofficialByTerminal(terminals() ?? [])).get(pane.terminal) ?? null;
  }

  // Resolves tab display title matching SortableTab.tsx:130-131 & terminal-tab-actions.ts:111.
  getTabLabel(c, pane = undefined, unofficial = undefined) {
    if (pane === undefined) pane = paneForLabel(c.id);
    if (unofficial === undefined) unofficial = this.unofficialApp(pane);
    return tabLabel(c, pane, unofficial);
  }

  // Close confirmation logic ported from Orca:
  // - `src/renderer/src/components/terminal/terminal-tab-actions.ts:121-131` (shouldConfirmRunningTerminalClose)
  // - `src/renderer/src/components/terminal/running-terminal-close-guard.ts:22-34,56-97` (guardRunningTerminalClose)
  // - `src/renderer/src/components/terminal-pane/CloseTerminalDialog.tsx:15-184` (CloseTerminalDialog)
  // - `src/renderer/src/store/pinned-tab-close-guard.ts:27-57` (guardPinnedTabClose)
  // - `src/renderer/src/components/terminal-pane/PinnedTabCloseDialog.tsx:17-96` (PinnedTabCloseDialog)
  requestCloseTab(c) {
    const label = this.getTabLabel(c);

    // Pinned-tab guard: PinnedTabCloseDialog.tsx & pinned-tab-close-guard.ts:27-57.
    // Herdr's `settled` represents Orca's pinned tabs.
    if (c.settled) {
      let skipPinned = false;
      try { skipPinned = localStorage.getItem("orca.confirmClosePinnedTab") === "false"; } catch { /* Keep confirmation enabled if storage is unavailable. */ }
      if (!skipPinned) {
        openOverlay({
          mod: "orca-tabs",
          kind: "dialog",
          modal: true,
          width: 384,
          height: 200,
          props: {
            confirmClose: {
              kind: "pinned",
              tabId: c.id,
              tabLabel: label,
            }
          }
        });
        return;
      }
      run("tab.close", { id: c.id });
      return;
    }

    // No running-agent or running-command guard: closing a tab closes it.
    run("tab.close", { id: c.id });
  }

  renderConfirmDialog(cx) {
    return renderCloseDialog(this, cx);
  }

  // `TabPaneColumnSplitDragOverlay.tsx:11-38` paints half the panel — a column half for
  // left/right, a row half for up/down — with `.tab-drop-overlay` (`terminal.css:205-213`):
  // an rgba(59,130,246,0.2) fill, a 2px rgba(59,130,246,0.5) border, 4px radius, no
  // transition. This window covers the terminal body below the strip.
  renderDrop(cx) {
    const t = theme();
    const drag = dragRecord() ?? this.drag;
    if (drag && this.zone !== drag.zone) this.zone = drag.zone;
    const box = drag?.strip;
    if (!box) return div().size_full();
    const bodyWidth = box.width;
    const bodyHeight = Math.max(1, box.height - box.stripHeight);
    const panel = { left: box.x, top: box.y, width: box.width, height: box.height };
    const half = dropHalf(this.zone, bodyWidth, bodyHeight);
    return div()
      .id("tab-drop")
      .track_focus(this.handle)
      .w(bodyWidth)
      .h(bodyHeight)
      .relative()
      .overflow_hidden()
      // A window would follow any press it isn't told to stop (herdr.d.ts OverlaySpec).
      .on_mouse_down("left", (_e, downCx) => downCx.stop_propagation())
      .on_mouse_move((e, moveCx) => {
        const next = edgeZone(panel, e.position, box.stripHeight || find(layout(), "tabs")?.size?.px || TAB_STRIP_FALLBACK);
        dropTrace("drop-move", { panel, at: e.position, zone: next });
        if (next === this.zone) return;
        this.zone = next;
        moveCx.notify();
      })
      .on_mouse_up("left", (e) => {
        dropTrace("drop-up", { at: e.position, zone: this.zone });
        this.drop();
      })
      .on_key_down((e, keyCx) => {
        if (e.key !== "escape") return;
        setDragRecord(null);
        closeOverlay(props()?.overlay);
        keyCx.notify();
      })
      .when(Boolean(half), (el) => el.child(div()
        .absolute().left(half.left).top(half.top).w(half.width).h(half.height)
        .bg("#3b82f633").border_2().border_color("#3b82f680").rounded(4)
        // `TabGroupDropOverlay.tsx:31-39` — the "New split" label, bottom-left.
        .child(div().absolute().bottom(8).left(8).px(6).py(2).rounded(2)
          .text_size(11).font_medium().text_color(t.solid_foreground).bg("#5b8def33")
          .child("New split"))));
  }

  // `tabs-drop-actions.ts:26-170` — committing the split moves the dragged tab into the new group.
  // The overlay's pointer release writes `released = zone` to the shared drag record so the
  // strip's permanent poll timer drives `terminal.park` -> `terminal.keep` on a lasting `cx`.
  drop() {
    const zone = this.zone;
    const drag = dragRecord();
    if (drag && zone) {
      drag.released = zone;
      setShared(DROP_KEY, { ...drag });
    } else {
      setDragRecord(null);
      closeOverlay(props()?.overlay);
    }
  }

  moveOverTab(tab, i, e, cx) {
    // TEMPORARY: which guard stops the hand-off.
    if (this.pressed !== null && this.pressAt) {
      dropTrace("move", {
        i, pressed: this.pressed, dy: e.position.y - this.pressAt.y,
        busy: Boolean(dropDrag), hasBounds: Boolean(e.bounds?.width),
      });
    }
    // A press on any tab that travels down past Orca's activation distance becomes a
    // panel drop. The pointer is about to leave this block, so a frame-less popup overlay over
    // the terminal area takes over: it paints the quadrant and receives the release.
    if (this.triggerSplit(e.bounds ?? this.stripBounds, e.position, cx)) {
      return;
    }
    if (this.pressed === null) return;
    const side = insertionSide(e);
    if (this.overTab === tab.id && this.overSide === side) return;
    this.overTab = tab.id;
    this.overSide = side;
    cx.notify();
  }

  releaseTab(tab, i, shown, cx) {
    const from = this.pressed;
    const overSide = this.overSide;
    this.pressed = null;
    this.overTab = null;
    this.overSide = null;

    if (from === null) return;

    if (from !== i) {
      // Orca tab-drag-drop-commit.ts:116-126 insertion algorithm
      const oldIndex = from;
      const rawInsertIndex = i + (overSide === "right" ? 1 : 0);
      const nextIndex = oldIndex < rawInsertIndex ? rawInsertIndex - 1 : rawInsertIndex;
      if (oldIndex !== nextIndex) {
        run("tab.move", { id: shown[from].id, index: nextIndex + 1 });
        cx.notify();
        return;
      }
    }

    // Plain click — select tab and restore main-terminals layout stack
    run("tab.select", { id: tab.id });
    run("layout.select", { stack: "main", child: "main-terminals" });
    cx.notify();
  }

  applyTabAction(cx) {
    // Process actions dispatched from orca-menu on this lasting cx.
    const action = shared("orca-tabs.action");
    if (action && typeof action === "object") {
      setShared("orca-tabs.action", null);
      if (action.kind === "move-tab-split" && action.tab && action.direction) {
        moveTabToSplit(action.tab, action.direction, cx);
      } else if (action.kind === "unsplit-to-tab" && (action.terminal || action.pane)) {
        unsplitPaneToTab(action.terminal, cx, action.pane);
      }
    }
  }

  recoverMainWidth(root, cx) {
    if (!this.drawers.sidebar.busy && !this.drawers.panel.busy && !this.nativeRecovering && find(root, "main")?.size?.px != null) {
      this.nativeRecovering = true;
      cx.spawn(async taskCx => {
        await taskCx.sleep(1);
        if (!this.drawers.sidebar.busy && !this.drawers.panel.busy && find(layout(), "main")?.size?.px != null) run("layout.resize", { id: "main", weight: 1 });
        this.nativeRecovering = false;
      });
    }
  }

  updateGlide(unified, sidebar, w, cx) {
    // The layout moves the strip's left edge in one step when the sidebar hides or shows, so the
    // strip is drawn where it was and eased home: render 1 holds the old spot, a moment later
    // render 2 lets `left` go to 0 under a transition. A transition only animates changes made
    // after the element carried it, so each glide gets fresh element ids (`-g<n>`): render 1
    // creates them already at the old spot, render 2 moves the same elements home. Only the tabs
    // glide; the toggle stays put.
    // shortcut: the column and the terminals still jump, since a mod cannot move layout nodes.
    const sidebarHidden = Boolean(sidebar?.hidden);
    if (!unified && this.lastSidebarHidden !== undefined && sidebarHidden !== this.lastSidebarHidden) {
      const stripStartHidden = toggleLeft(w) + 36;
      const jump = (sidebar?.size?.px ?? 280) - stripStartHidden;
      this.glideShift = sidebarHidden ? jump : -jump;
      this.glideGen = (this.glideGen ?? 0) + 1;
      cx.spawn(async (taskCx) => {
        await taskCx.sleep(GLIDE_START_MS);
        this.glideShift = 0;
        taskCx.notify();
      });
    }
    this.lastSidebarHidden = sidebarHidden;
  }

  glide(el, id) {
    return el.id(`${id}-g${this.glideGen ?? 0}`).relative().left(this.glideShift)
      .transition("left", { duration: SIDEBAR_GLIDE_MS, easing: "ease-out" });
  }

  syncSidebarToggle(cx, sidebar, unified) {
    if (shared("left-sidebar.settingsPrior")) return;
    if (takeToggle(this, "wantToggle")) this.toggleSidebar(cx);
    if (unified && !this.drawers.sidebar.busy && !sidebar?.hidden && (sidebar?.size?.px ?? 0) >= DRAWER_MIN_OPEN_PX && this.drawers.sidebar.openPx !== sidebar.size.px) {
      this.drawers.sidebar.openPx = sidebar.size.px;
      setShared("left-sidebar.openPx", this.drawers.sidebar.openPx);
    }
  }

  syncPanelToggle(cx, panel, unified, zoom) {
    if (takeToggle(this, "wantPanelToggle")) this.togglePanel(cx);
    if (!unified || this.drawers.panel.busy) return;
    this.rememberPanelWidth(panel);
    this.drawers.panel.clockPx = (panel?.hidden ? 1 : (panel?.size?.px ?? 350)) / zoom;
  }

  // A settled panel's width is the one it opens to again.
  rememberPanelWidth(panel) {
    if (panel?.hidden || (panel?.size?.px ?? 0) < DRAWER_MIN_OPEN_PX) return;
    this.drawers.panel.openPx = panel.size.px;
    // The panel mods keep their content at this width while the panel narrows (panel-motion.js).
    setShared("panel.openPx", this.drawers.panel.openPx);
  }

  releaseStrip(cx) {
    // Orca use-terminal-pane-tab-detach-actions.ts:61-73: dropping a dragged pane on the tab strip.
    const paneDrag = shared("orca-tabs.pane-drag");
    if (paneDrag?.active) {
      setShared("orca-tabs.pane-drag", null);
      unsplitPaneToTab(paneDrag.terminal, cx, paneDrag.pane);
      cx.notify();
      return;
    }
    // A release back over the strip cancels a drop the overlay never took.
    const live = dragRecord();
    if (live?.overlay) closeOverlay(live.overlay);
    setDragRecord(null);
    this.pressed = null;
    this.overTab = null;
    this.overSide = null;
    cx.notify();
  }

  headerSurface(header, { unified, panel, zoomK }) {
    // `.titlebar`: 36px, border-bottom var(--border), background var(--card) #171717
    // (main.css:1072-1084). Tabs sit flush to each edge of that bar.
    // The Explorer / Source Control activity buttons are NOT here: Orca renders its activity
    // bar only inside the right sidebar (`right-sidebar-top-activity-bar.tsx:40`), which
    // `orca-panel-head` owns. Drawing them twice put two strip icons in the titlebar corner.
    return header
      .when(unified, el => el.relative().child(div().id("panel-native-clock").absolute().left(0).top(0).h(1).w(this.drawers.panel.clockPx ?? (panel?.hidden ? 1 : (panel?.size?.px ?? 350)) / zoomK).transition("width", { duration: 500, easing: "ease-in-out" })
        .on_size_change((size, cx) => this.drawers.panel.size(size, cx, this.drawerEnv()))))
      .on_mouse_move((e, cx) => {
        if (this.pressed !== null && this.stripBounds) {
          this.triggerSplit(this.stripBounds, e.position, cx);
        }
      })
      .on_mouse_up("left", (_e, cx) => this.releaseStrip(cx));
  }

  sidebarClock(header, unified) {
    return header
      .when(unified && props()?.pinSidebarTerminal, el => el.on_size_change(size => { this.nativeHeaderWidth = size.width; }))
      .when(unified && props()?.motion === "native", el => el.relative().child(div().id("sidebar-native-clock").absolute().left(0).top(0).h(1).w(this.drawers.sidebar.clockPx).transition("width", { duration: 500, easing: "ease-in-out" })
        .on_size_change((size, cx) => this.drawers.sidebar.size(size, cx, this.drawerEnv()))));
  }

  render(cx) {
    const p = props();
    if (this.isDialog || p?.confirmClose) {
      return this.renderConfirmDialog(cx);
    }
    if (this.isDropOverlay || p?.drop) {
      return this.renderDrop(cx);
    }

    const unified = Boolean(p?.unified);
    const currentPage = find(layout(), "main")?.active;
    if (this.settingsPageRequest?.page === currentPage) this.settingsPageRequest = null;
    const requestedPage = this.settingsPageRequest?.page ?? currentPage;
    this.syncSettingsSidebar(cx, requestedPage === "main-agents", unified);
    if (requestedPage === "main-agents") this.closePanelForSettings(cx, unified);
    let frame;
    if (currentPage === "main-agents") {
      // The strip is not drawn here, so nothing would consume a sidebar or panel key pressed on this page;
      // left queued, it would fire after Back.
      this.wantToggle = this.wantPanelToggle = 0;
    } else {
      if (currentPage) this.lastAppPage = currentPage;
      this.applyTabAction(cx);
      frame = this.stripFrame(cx, unified);
    }
    // The native clock is the first child of the same root on both pages.
    const base = h_flex().size_full().min_w(0);
    if (frame) base.pl(frame.leftPad).gap(0).items_center().bg(frame.bar);
    const header = this.sidebarClock(base, unified);
    if (!frame) return this.settingsHeader(header, unified);
    const row = addSidebarToggle(this.headerSurface(header, frame), this, frame);
    return addEndControls(addTabTrack(row, this, frame), this, frame);
  }

  requestSettingsPage(page, cx) {
    this.settingsPageRequest = { page, sent: false };
    cx.notify();
  }

  // Agent Settings has no right sidebar. Called on every render while it is requested, so the `busy`
  // guard stops a second call from flipping the Drawer back open.
  closePanelForSettings(cx, unified) {
    const panel = find(layout(), "panel");
    if (!panel || panel.hidden || this.drawers.panel.busy) return;
    if (unified) this.togglePanelNative(cx);
    else run("layout.hide", { id: "panel" });
  }

  selectRequestedSettingsPage() {
    const request = this.settingsPageRequest;
    if (!request || request.sent) return;
    request.sent = true;
    run("layout.select", { stack: "main", child: request.page });
  }

  syncSettingsSidebar(cx, open, unified) {
    const root = layout();
    const sidebar = find(root, "left-sidebar");
    const prior = shared("left-sidebar.settingsPrior");
    const drawer = this.drawers.sidebar;
    const wide = shared("left-sidebar.openPx") || drawer.openPx || drawer.defaultOpen;
    const plan = settingsSidebarPlan({ open, unified, prior, sidebar, busy: drawer.busy, zoom: settings()?.zoom || 1, wide });
    if (!plan) {
      if (!drawer.busy) {
        if (open && prior && !sidebar?.hidden) this.showSettingsNav(false);
        this.selectRequestedSettingsPage();
        if (shared("left-sidebar.settingsAnchor")) setShared("left-sidebar.settingsAnchor", null);
      }
      return;
    }
    if (open && plan.flag !== prior) setShared("left-sidebar.settingsPrior", plan.flag);
    const collapsed = Boolean(sidebar && (sidebar.hidden || sidebar.size?.px <= 2));
    // Keep Projects and Search in their existing frame until it has faded at the narrow end.
    if (!open || collapsed) this.showSettingsNav(!open);
    const finish = () => {
      if (open) this.showSettingsNav(false);
      else setShared("left-sidebar.settingsPrior", null);
      this.selectRequestedSettingsPage();
      if (shared("left-sidebar.settingsAnchor")) setShared("left-sidebar.settingsAnchor", null);
    };
    if (plan.resize == null) {
      if (open ? collapsed : prior.hidden && !sidebar?.hidden) {
        run(open ? "layout.show" : "layout.hide", { id: "left-sidebar" });
        setShared("left-sidebar.collapsed", !open);
      }
      return finish();
    }
    const restore = (open ? plan.flag : prior).px ?? wide;
    drawer.openPx = restore;
    if (shared("left-sidebar.openPx") !== restore) setShared("left-sidebar.openPx", restore);
    if (plan.resize === 0 && sidebar?.hidden) return finish();
    const from = sidebar?.hidden ? 1 : (sidebar?.size?.px ?? restore);
    if (!sidebar?.hidden && from === plan.resize) return finish();
    const target = plan.resize / restore;
    if (props()?.motion === "native") {
      const zoom = settings()?.zoom || 1;
      // The tabs block spans the left column; the right panel is already excluded.
      const full = this.nativeHeaderWidth / zoom;
      const current = visibleSize(sidebar, 0);
      const left = open ? plan.resize : current;
      const width = settingsHoldPx({ full, sidebar: left });
      if (width != null) setShared("left-sidebar.settingsAnchor", { left, width });
      const hold = props()?.pinSidebarTerminal && !this.nativePinned
        ? settingsHoldPx({ full, sidebar: open ? left : Math.min(current, plan.resize) }) : null;
      drawer.clockPx = from / zoom;
      drawer.move(cx, this.drawerEnv(), {
        node: sidebar, open: restore, target, pin: hold,
        before: open && this.settingsPageRequest ? () => this.selectRequestedSettingsPage() : undefined,
        after: finish,
      });
    } else {
      this.startSidebarMotion(cx, { open: restore, target, from: from / restore }, () => {
        setShared("left-sidebar.collapsed", target === 0);
        finish();
      });
    }
  }

  showSettingsNav(show) {
    const nav = find(layout(), "nav-top");
    // `layout()` can still show the old state in the next render; ask once per direction.
    if (!nav || Boolean(nav.hidden) !== show || this.navAsked === show) return;
    this.navAsked = show;
    run(show ? "layout.show" : "layout.hide", { id: nav.id });
  }

  settingsHeader(header, unified) {
    const t = theme();
    const desiredLeft = this.settingsPillPosition(unified);
    const back = this.settingsBack(t);
    const w = appWindow() ?? this.windowState ?? {};
    return header.relative().items_center().justify_center().bg(t.surface)
      .child(desiredLeft == null ? back : div().absolute().left(desiredLeft).top(3).child(back))
      .when(w.platform && w.platform !== "macos", el => el.child(this.settingsWindowControls(w, t)));
  }

  settingsPillPosition(unified) {
    const root = layout();
    const sidebar = find(root, "left-sidebar"), panel = find(root, "panel");
    const zoom = settings()?.zoom || 1;
    const vp = typeof window !== "undefined" ? window.viewport_size() : null;
    const left = unified ? 0 : this.settingsRailWidth(sidebar, 280, zoom);
    const right = panel ? this.settingsRailWidth(panel, 350, zoom) : 0;
    // Balance the insets so the pill is centered in the window, not merely the strip.
    return settingsPillLeft(vp?.width, left, right, 112);
  }

  settingsRailWidth(rail, fallback, zoom) {
    if (rail?.hidden) return 0;
    return (rail?.size?.px ?? fallback) / zoom;
  }

  settingsBack(t) {
    const previous = this.lastAppPage;
    return h_flex().id("agent-settings-back").h(26).w(112).flex_none().items_center().justify_center().gap(5)
      .rounded_full().border_1().border_color(t.border).bg(t.raised).text_color(t.foreground)
      .cursor_pointer().hover(s => s.bg(t.hover)).role("button").accessibility_label("Back to app")
      .on_mouse_down("left", (_e, eventCx) => eventCx.stop_propagation()).on_click((_e, eventCx) => {
        const active = (spaces() ?? []).find(s => s.active);
        const target = settingsReturnPage(previous, find(layout(), "main")?.children, active);
        this.landing = active?.tabs?.length ? "main-terminals" : "main-landing";
        this.requestSettingsPage(target, eventCx);
      })
      .child(svg("mods/orca-tabs/chevron-left.svg").size(13))
      .child(div().text_size(12).child("Back to app"));
  }

  settingsWindowControls(w, t) {
    const winControl = (id,label,glyph,action) => div().id(id).w(46).h_full().flex_none().flex().items_center().justify_center()
      .text_color(t.muted).hover(s => s.bg(t.hover)).role("button").accessibility_label(label).tooltip(label)
      .on_mouse_down("left", (_e, eventCx) => eventCx.stop_propagation()).on_click(action).child(svg(glyph).size(10));
    return h_flex().absolute().right(0).top(0).bottom(0).items_center()
      .child(winControl("minimize","Minimize","mods/orca-tabs/win-min.svg",()=>run("window.minimize")))
      .child(winControl("maximize","Maximize",w.maximized ? "mods/orca-tabs/win-restore.svg" : "mods/orca-tabs/win-max.svg",()=>run("window.maximize")))
      .child(winControl("close-window","Close window","mods/orca-tabs/win-close.svg",()=>run("window.close")));
  }

  // Live read keeps maximize/restore current (Orca subscribes to onMaximizeChanged,
  // WindowControls.tsx:15); the cached seed covers the first paint, when `window()` is null.
  currentWindow() {
    const live = appWindow();
    if (live) this.windowState = live;
    return live ?? this.windowState ?? {};
  }

  // Everything one frame of the strip reads, in the order it has to be read: the layout is
  // measured, the toggles and the panel are synced against it, and the rest only derives.
  stripFrame(cx, unified) {
    const t = theme();
    // `unified`: this block is the single header over the sidebar AND the work column
    // (layouts/orca-unified.json); the sidebar there is `surface` too, so bar, sidebar and fillets match.
    const bar = t.surface;
    const space = (spaces() ?? []).find(candidate => candidate.active);
    const shown = space?.tabs ?? [];
    const tabPanes = selectTabPanes(panes() ?? []);
    const unofficialPanes = unofficialByTerminal(terminals() ?? []);
    // Once per frame, before anything reads it: widths, real limits, arrow states and the clamped
    // position of the active tab (which is where a newly selected tab is also revealed).
    const geometry = this.stripGeometry(shown);
    const root = layout();
    const sidebar = find(root, "left-sidebar");
    if (unified) this.recoverMainWidth(root, cx);
    const w = this.currentWindow();
    this.updateGlide(unified, sidebar, w, cx);
    const leftPad = trafficLightPadding(root, w, sidebar, unified);
    // Where the strip starts against the card's left edge (the sidebar's right edge): a first tab that
    // lands exactly on it is flush and needs no left flare; the further it sits, the more flare shows.
    // In the old layout the strip starts on the card, so the gap is 0. The card's own rounded
    // top-left corner is NOT drawn: this block cannot paint into the terminal block below it
    // (tried, clipped), and a static pane radius would leave a notch under a flush first tab.
    const zoomK = settings()?.zoom || 1;
    const toggleRightX = toggleLeft(w) + 36;
    const sbPx = scaledWidth(sidebar, 0, zoomK);
    const gapToCard = unified ? Math.max(sbPx, toggleRightX) - sbPx : 0;
    const flushable = (c, i) => c.active && i === 0 && !geometry.arrows.hasOverflow && this.scrollX <= 0;
    const panel = find(root, "panel");
    this.syncChrome(cx, { space, sidebar, panel, body: find(root, "panel-body"), unified, zoomK });
    return { t, bar, unified, sidebar, panel, zoomK, w, leftPad, paneDrag: shared("orca-tabs.pane-drag"),
      shown, space, geometry, tabPanes, unofficialPanes, gapToCard, flushable };
  }

  // The toggles, the open widths, the remembered panel and the landing page all follow the layout.
  syncChrome(cx, { space, sidebar, panel, body, unified, zoomK }) {
    this.syncSidebarToggle(cx, sidebar, unified);
    this.syncPanelToggle(cx, panel, unified, zoomK);
    const enabled = [...(shared("workspace.panels") ?? ["files", "changes"])];
    this.syncPanel(space, panel, body, enabled);
    this.syncLanding(cx);
    if (unified && !this.drawers.sidebar.busy) this.drawers.sidebar.clockPx = (sidebar?.hidden ? 1 : (sidebar?.size?.px ?? 259)) / zoomK;
  }
}
