// Derived from Herdr App's defaults/mods/tabs/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, terminals, run, openOverlay, closeOverlay, props, theme, window as appWindow, shared, layout, settings, setShared, writeTextFile } from "herdr";
import { selectTabPanes } from "./tab-panes.js";
import { edgeZone } from "./drop-zone.js";
import { stripLeadingAgentTitleDecoration } from "./tab-title.js";
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

// Memoized tab colour store: shared() is the primary source; localStorage is the fallback.
// Cache the parsed fallback by its raw string so repeated renders skip re-parsing.
let _tabColorCache = { raw: undefined, value: null };
function readTabColorStore() {
  const s = shared("tab.colors");
  if (s && typeof s === "object") return s;
  try {
    const raw = localStorage.getItem("tab.colors.v1");
    if (_tabColorCache.raw === raw && _tabColorCache.value) return _tabColorCache.value;
    const v = raw ? JSON.parse(raw) : {};
    const value = v && typeof v === "object" && !Array.isArray(v) ? v : {};
    _tabColorCache = { raw, value };
    return value;
  } catch {
    return {};
  }
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
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
// How long an arrow's slide takes: Orca hands `scrollBy` a `behavior: 'smooth'`, which in Chromium
// runs about this long.
const TAB_STRIP_SLIDE_MS = 150;
const DROP_STILL_TICKS = 20; // ~320ms of a motionless pointer is the release fallback, since the host has no button state.
const TAB_DRAG_DISTANCE = 12; // `useTabDragSplit.ts:42` — dnd-kit activation distance, and how far down a press must travel before it is a split.
const DROP_REV = 13; // bumped every time the instrumentation changes
let dropSeq = 0;
function dropTrace(event, detail) {
  const path = `/tmp/drop-${String(Date.now())}-${dropSeq++}-${event}.json`;
  writeTextFile(path, JSON.stringify({ event, detail }, null, 1), null).catch(() => {});
}

// The tab column's rect, measured rather than assumed: the layout (this package's `orca` layout) sets `sidebar` to
// 280px and `status` to 24px, the strip reports its own top and height, and the rest is the
// viewport. A hidden rail contributes nothing (its node is skipped, `layout.rs:551`).
function panelRect(top, stripHeight) {
  const vp = typeof window !== "undefined" ? window.viewport_size() : null;
  if (!vp) return null;
  const root = layout();
  const sidebar = find(root, "sidebar"), panel = find(root, "panel");
  const zoom = settings()?.zoom || 1;
  const left = sidebar?.hidden ? 0 : (sidebar?.size?.px ?? 280) / zoom;
  const right = panel?.hidden ? 0 : (panel?.size?.px ?? 350) / zoom;
  // the layout's `status` node, so a resized or hidden bar stays right.
  const status = find(root, "status");
  const bottom = (status?.hidden ? 0 : (status?.size?.px ?? STATUS_BAR_HEIGHT)) / zoom;
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
function setDragRecord(value) {
  dropDrag = value;
  if (!value && pollTimer) {
    try { pollTimer.cancel(); } catch {}
    pollTimer = null;
  }
  // `null` or `undefined` clears the record in the host's shared store.
  setShared(DROP_KEY, value ?? null);
}

// The poll writes here; the overlay's view reads it on its own tick and repaints. Two views of
// one module share `dropDrag`, and neither needs the other's `cx`.
function pollDrop(cx) {
  let lastZone = null;
  let pollSeq = 0;
  if (pollTimer) {
    try { pollTimer.cancel(); } catch {}
    pollTimer = null;
  }
  pollTimer = cx.timer.every(16, (cx) => {
    if (!dropDrag || !shared(DROP_KEY)) {
      dropDrag = null;
      if (pollTimer) {
        try { pollTimer.cancel(); } catch {}
        pollTimer = null;
      }
      return;
    }
    const sharedDrag = shared(DROP_KEY);
    const releasedZone = dropDrag.released || sharedDrag?.released;
    if (releasedZone) {
      dropResolve(releasedZone, cx);
      return;
    }
    const at = typeof window !== "undefined" ? window.mouse_position() : null;
    if (!at) return;
    const s = dropDrag.strip;
    const panel = { left: s.x, top: s.y, width: s.width, height: s.height };
    // Inside the panel first, as Orca requires before asking for a zone
    // (`tab-group-panel-split-target.ts:210-218`).
    const inside = at.x >= panel.left && at.x <= panel.left + panel.width
      && at.y >= panel.top && at.y <= panel.top + panel.height;
    const zone = inside ? edgeZone(panel, at, s.stripHeight) : null;
    if (pollSeq++ < 8 || zone !== lastZone) dropTrace("poll", { at, zone, inside });
    const moved = !dropDrag.lastPos || dropDrag.lastPos.x !== at.x || dropDrag.lastPos.y !== at.y;
    dropDrag.lastPos = { x: at.x, y: at.y };
    // The overlay takes no pointer events for a press that started elsewhere (measured: no
    // `drop-move`, no `drop-up` for a real drag) and the host exposes no button state, so the
    // release is inferred: a pointer that stops moving, below the strip, is where it was let go.
    dropDrag.still = moved ? 0 : (dropDrag.still ?? 0) + 1;
    if (zone !== lastZone) {
      lastZone = zone;
      dropDrag.zone = zone;
      setShared(DROP_KEY, { ...dropDrag });
    }
    if (dropDrag.still >= DROP_STILL_TICKS && at.y > panel.top + s.stripHeight) {
      dropDrag.still = 0;
      dropResolve(zone, cx);
    }
  });
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
  const fromTerminal = fromTerminalHint
    ?? allPanes.find((p) => p.tab === fromTabId && p.focused)?.terminal
    ?? allPanes.find((p) => p.tab === fromTabId)?.terminal;
  if (!fromTerminal) return;

  run("terminal.park", { terminal: fromTerminal });
  dropTrace("move-park", { terminal: fromTerminal, fromTab: fromTabId, zone });

  if (!cx) return;

  const place = (zone === "left" || zone === "right") ? "right" : "down";
  let parkTicks = 0;
  const keepTimer = cx.timer.every(16, (cx) => {
    parkTicks++;
    const current = panes() ?? [];
    const stillHasPane = current.some((p) => p.terminal === fromTerminal);
    if (stillHasPane && parkTicks < 60) return;
    try { keepTimer.cancel(); } catch {}
    if (stillHasPane) {
      dropTrace("move-park-timeout", { terminal: fromTerminal });
      return;
    }
    const res = run("terminal.keep", { terminal: fromTerminal, place });
    dropTrace("move-keep", { terminal: fromTerminal, place, res });

    if (zone === "left" || zone === "up") {
      let swapTicks = 0;
      const targetPane = res?.pane;
      const swapTimer = cx.timer.every(16, (cx) => {
        swapTicks++;
        const pList = panes() ?? [];
        const hasMounted = targetPane
          ? pList.some((p) => p.pane === targetPane)
          : pList.some((p) => p.terminal === fromTerminal);
        if (!hasMounted && swapTicks < 60) return;
        try { swapTimer.cancel(); } catch {}
        if (!hasMounted) return;
        const paneId = targetPane ?? pList.find((p) => p.terminal === fromTerminal)?.pane;
        if (paneId) {
          run("pane.swap", { direction: zone, pane: paneId });
          dropTrace("move-swap", { pane: paneId, direction: zone });
        }
      });
    }
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

  let parkTicks = 0;
  const keepTimer = cx.timer.every(16, (cx) => {
    parkTicks++;
    const current = panes() ?? [];
    const stillHasPane = current.some((p) => p.terminal === targetTerminal);
    if (stillHasPane && parkTicks < 60) return;
    try { keepTimer.cancel(); } catch {}
    if (stillHasPane) {
      dropTrace("unsplit-park-timeout", { terminal: targetTerminal });
      return;
    }
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
      // The drop overlay's copy: a frame-less window over the whole app, painting the panel
      // quadrant Orca paints (`TabPaneColumnSplitDragOverlay.tsx:11-54`).
      this.isDropOverlay = true;
      this.zone = null;
      this.handle = cx.focus_handle();
      this.handle.focus();
      // The strip's poll writes the pointer and the zone into module memory; this copy repaints
      // when either moves. Its own handlers also resolve the drop, so a release that arrives
      // here is never lost.
      cx.timer.after(300, (cx) => {
        const seen = dragRecord();
        dropTrace("overlay-alive", {
          seesRecord: Boolean(seen),
          key: shared(DROP_KEY) ? "set" : "unset",
          zone: seen?.zone ?? null,
        });
        cx.notify();
      });
      cx.timer.every(16, (cx) => {
        const drag = dragRecord();
        if (!drag) {
          if (this.zone !== null) { this.zone = null; cx.notify(); }
          return;
        }
        if (drag.zone === this.zone) return;
        this.zone = drag.zone;
        cx.notify();
      });
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
    try {
      const stored = JSON.parse(localStorage.getItem("panels") ?? "{}");
      this.panels = stored && typeof stored === "object" ? stored : {};
    } catch {
      this.panels = {};
    }
    // `window()` is null until the window publishes it. Seed it here first; if it is still
    // null, read it again in the task phase, cache it, and repaint. Orca seeds the same flags
    // with useState(false) + useEffect (WindowControls.tsx:7-16).
    this.windowState = appWindow();
    const seed = (cx, tries) => {
      const w = appWindow();
      if (w) { this.windowState = w; cx.notify(); return; }
      if (tries > 0) cx.timer.after(50, (cx) => seed(cx, tries - 1));
    };
    if (!this.windowState) cx.timer.after(0, (cx) => seed(cx, 20));
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
    if (space.id !== this.space) {
      this.space = space.id; this.pending = null;
      // Restore what the person left: a remembered tool shows it, a remembered hide (null) hides it,
      // and a space never seen keeps the layout's default. Only a remembered hide is kept as hidden.
      const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
      if (want) {
        if (want !== now) run("layout.select", { stack: "panel-body", child: want });
        if (panel.hidden) run("layout.show", { id: "panel" });
      } else if (space.id in this.panels && this.panels[space.id] === null && !panel.hidden) {
        run("layout.hide", { id: "panel" });
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
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
  scrollTabStrip(direction, cx) {
    const to = tabStripScrollTarget(this.scrollX, this.viewportWidth, this.contentWidth, direction);
    if (to === this.scrollX) return;
    this.animatedUntil = Date.now() + TAB_STRIP_SLIDE_MS + 60;
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

  // Everything the strip needs to know about itself this frame: the measured widths, the real
  // track limits, which arrows are live, and where the active tab is drawn. The dock never feeds
  // back into any of it — that is the whole point of §4.
  stripGeometry(shown) {
    const ids = shown.map((c) => c.id);
    for (const id of [...this.tabWidths.keys()]) {
      if (!ids.includes(id)) this.tabWidths.delete(id);
    }
    const widths = ids.map((id) => this.tabWidths.get(id) ?? 0);
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
    if (pane === undefined) pane = (panes() ?? []).find(p => p.tab === c.id && p.program?.agent) ?? (panes() ?? []).find(p => p.tab === c.id);
    if (unofficial === undefined) unofficial = this.unofficialApp(pane);
    const program = pane?.program;
    const raw = c.name ?? "Terminal";
    const name = c.named ? raw : (unofficial?.name || pane?.title || program?.name || raw || "Terminal");
    return program?.agent ? stripLeadingAgentTitleDecoration(name) : name;
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
      try { skipPinned = localStorage.getItem("orca.confirmClosePinnedTab") === "false"; } catch {}
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

  // Dialog ported from Orca: CloseTerminalDialog.tsx:101-184, PinnedTabCloseDialog.tsx:52-94,
  // and BULK_TAB_CLOSE_COPY (bulk-tab-close-confirmation.ts:5-15); layout follows dialog.tsx:139-163.
  renderConfirmDialog(cx) {
    const t = theme();
    const p = props() ?? {};
    const cfg = p.confirmClose ?? {};
    const kind = cfg.kind ?? "command";
    const isAgent = kind === "agent";
    const isPinned = kind === "pinned";
    const isBulk = kind === "bulk";

    if (!this.handle) {
      this.handle = cx.focus_handle();
      this.handle.focus();
    }

    let title = "Stop running command?";
    let desc = "Closing this terminal will stop the command running inside it.";
    if (isAgent) {
      title = "Stop this agent?";
      desc = "Closing this terminal will stop the agent's current work.";
    } else if (isPinned) {
      title = "Close pinned tab?";
      desc = "This tab is pinned. Are you sure you want to close it?";
    } else if (isBulk) {
      if (cfg.scope === "others") title = "Close other tabs?";
      else if (cfg.scope === "right") title = "Close tabs to the right?";
      else if (cfg.scope === "left") title = "Close tabs to the left?";
      else title = "Close tabs?";
      desc = "The selected tabs will be closed. Pinned tabs will stay open.";
    }

    let confirmLabel = "Stop and Close";
    if (isAgent) confirmLabel = "Stop Agent";
    else if (isPinned) confirmLabel = "Close";
    else if (isBulk) confirmLabel = "Close tabs";

    const confirm = () => {
      if (this.dontAskAgain) {
        try {
          if (isPinned) {
            localStorage.setItem("orca.confirmClosePinnedTab", "false");
          } else if (isAgent || kind === "command") {
            localStorage.setItem("orca.skipCloseTerminalWithRunningProcessConfirm", "true");
          }
        } catch {}
      }
      closeOverlay(p.overlay);
      if (cfg.tabId) {
        run("tab.close", { id: cfg.tabId });
      } else if (cfg.tabIds) {
        for (const id of cfg.tabIds) run("tab.close", { id });
      }
    };

    const cancel = () => {
      closeOverlay(p.overlay);
    };

    const checkboxLabel = isPinned ? "Don't ask again for pinned tabs" : "Don't ask again for running terminals";

    return v_flex()
      .id("orca-close-dialog")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "enter") {
          cx.stop_propagation();
          confirm();
        } else if (e.key === "escape") {
          cx.stop_propagation();
          cancel();
        }
      })
      .size_full()
      .p(24)
      .gap(16)
      .rounded(8)
      .bg(t.popover)
      .border_1()
      .border_color(t.border)
      // DialogHeader (dialog.tsx:139-147).
      .child(
        v_flex().gap(4)
          .child(div().text_size(14).font_semibold().text_color(t.foreground).child(title))
          .child(div().text_size(12).text_color(t.muted).child(desc))
      )
      // CloseTerminalDialog.tsx:132-139.
      .when(isAgent, el =>
        el.child(div().text_size(12).text_color(t.muted).child("This terminal will not resume automatically. Cancel and put the workspace to sleep to resume it later."))
      )
      // CloseTerminalDialog.tsx:140-144.
      .when(Boolean(cfg.tabLabel), el =>
        el.child(div().truncate().text_size(12).font_medium().text_color(t.foreground).child(cfg.tabLabel))
      )
      // CloseTerminalDialog.tsx:145-159 & PinnedTabCloseDialog.tsx:72-84.
      .when(!isBulk, el =>
        el.child(
          h_flex().items_center().gap(8).cursor_pointer()
            .on_click((_e, cx) => {
              this.dontAskAgain = !this.dontAskAgain;
              cx.notify();
            })
            .child(
              div().size(16).flex_none().rounded(4).border_1()
                .border_color(this.dontAskAgain ? t.solid : t.input)
                .bg(this.dontAskAgain ? t.solid : "#00000000")
                .flex().items_center().justify_center()
                .when(this.dontAskAgain, checkEl =>
                  checkEl.child(svg("mods/orca-tabs/check.svg").size(12).text_color(t.solid_foreground))
                )
            )
            .child(div().text_size(12).text_color(t.muted).child(checkboxLabel))
        )
      )
      // DialogFooter (dialog.tsx:149-163).
      .child(
        h_flex().justify_end().gap(8)
          // Outline, size-sm.
          .child(
            h_flex().id("close-cancel").h(32).px(12).items_center().justify_center().rounded(6)
              .border_1().border_color(t.border).bg(t.raised).text_color(t.foreground)
              .text_size(12).font_medium().cursor_pointer()
              .hover(s => s.bg(t.hover))
              .on_click((_e, _cx) => cancel())
              .child("Cancel")
          )
          // Destructive, size-sm.
          .child(
            h_flex().id("close-confirm").h(32).px(12).items_center().justify_center().rounded(6)
              .bg("#dc2626").text_color("#ffffff")
              .text_size(12).font_medium().cursor_pointer()
              .hover(s => s.bg("#b91c1c"))
              .on_click((_e, _cx) => confirm())
              .child(confirmLabel)
          )
      );
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
    const zone = this.zone;
    const wHalf = Math.round(bodyWidth / 2);
    const hHalf = Math.round(bodyHeight / 2);
    // `TabPaneColumnSplitDragOverlay.tsx:11-38`, in the panel body's coordinates:
    const half = !zone ? null
      : zone === "up" ? { left: 0, top: 0, width: bodyWidth, height: hHalf }
      : zone === "down" ? { left: 0, top: hHalf, width: bodyWidth, height: bodyHeight - hHalf }
      : zone === "left" ? { left: 0, top: 0, width: wHalf, height: bodyHeight }
      : { left: wHalf, top: 0, width: bodyWidth - wHalf, height: bodyHeight };
    return div()
      .id("tab-drop")
      .track_focus(this.handle)
      .w(bodyWidth)
      .h(bodyHeight)
      .relative()
      .overflow_hidden()
      // A window would follow any press it isn't told to stop (herdr.d.ts OverlaySpec).
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_move((e, cx) => {
        const next = edgeZone(panel, e.position, box.stripHeight || find(layout(), "tabs")?.size?.px || TAB_STRIP_FALLBACK);
        dropTrace("drop-move", { panel, at: e.position, zone: next });
        if (next === this.zone) return;
        this.zone = next;
        cx.notify();
      })
      .on_mouse_up("left", (e) => {
        dropTrace("drop-up", { at: e.position, zone: this.zone });
        this.drop();
      })
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        setDragRecord(null);
        closeOverlay(props()?.overlay);
        cx.notify();
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

  render(cx) {
    const p = props();
    if (this.isDialog || p?.confirmClose) {
      return this.renderConfirmDialog(cx);
    }
    if (this.isDropOverlay || p?.drop) {
      return this.renderDrop(cx);
    }

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

    const paneDrag = shared("orca-tabs.pane-drag");
    const t = theme();
    const space = (spaces() ?? []).find(p => p.active);
    const shown = space?.tabs ?? [];
    const tabPanes = selectTabPanes(panes() ?? []);
    const unofficialPanes = unofficialByTerminal(terminals() ?? []);
    // Tab colour store, read once per render. orca-menu writes shared("tab.colors")
    // and mirrors to localStorage["tab.colors.v1"]. SortableTab.tsx:293-297 drives the dot below.
    const tabColorStore = readTabColorStore();
    // Once per frame, before anything reads it: widths, real limits, arrow states and the clamped
    // position of the active tab (which is where a newly selected tab is also revealed).
    const geometry = this.stripGeometry(shown);
    const stop = (_e, cx) => cx.stop_propagation();
    // .sidebar-toggle (main.css:1213-1230) — padding 4px 8px around a 16px glyph = 32x24,
    // radius 4, muted, hover --accent. .window-controls-btn (main.css:1145-1168) — 46x36,
    // square, muted, hover --accent, close hover #c42b1c.
    // TitlebarLeftControls.tsx:74-88 — Orca has ONE sidebar toggle, at the LEFT of the
    // titlebar. `orca-chrome` draws it (inside the sidebar column); this copy only appears
    // while that column is hidden, because Herdr skips a hidden node's content
    // (layout.rs:551) and there would otherwise be no way back. Orca keeps the control
    // reachable by floating `titlebar-left` over the workspace
    // (AppWorkspaceShell.tsx:163-167).
    const sidebarToggle = (glyph, action, ml) => div().id("sidebar-toggle").ml(ml).mr(4).w(32).h(24).flex_none().flex().items_center().justify_center().rounded(4)
      .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .role("button").accessibility_label("Toggle sidebar").tooltip("Toggle sidebar")
      .on_mouse_down("left", stop).on_click(action).child(glyph);
    // tab-bar-surface.tsx:221-227 — `ml-2 my-auto flex h-7 w-7 shrink-0 items-center
    // justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground`,
    // holding a Lucide `Plus` at `w-3.5 h-3.5` (14px). It is a DropdownMenuTrigger, not a bare
    // action: it opens the new-tab menu, which `orca-new-menu` provides.
    // `rounded-md` resolves to 8px, not 6: --radius .625rem x .8 (main.css:175,195).
    const tabNew = (action) => div().id("tab-new").ml(8).size(28).flex_none().flex().items_center().justify_center().rounded(8)
      .text_color(t.muted).hover(s => s.bg("#40404080").text_color(t.foreground))
      .role("button").accessibility_label("New tab").tooltip("New tab")
      .on_mouse_down("left", (e, cx) => { this.plusBounds = e.bounds; stop(e, cx); }).on_click(action)
      .child(svg("mods/orca-tabs/plus.svg").size(14).flex_none());
    // Orca's chevrons (`tab-bar-surface.tsx:124-146`, `:189-211`): a ghost `icon-xs` button, so
    // `mx-0.5 my-auto h-6 w-5` (2px sides, 24x20) around a 14px `ChevronLeft/Right`, shown only
    // while the track overflows and disabled only at that end of it. They live outside the
    // viewport, so the active tab is never behind them (§5).
    const tabScrollButton = (direction, disabled) => {
      const label = direction === "start" ? "Scroll tabs left" : "Scroll tabs right";
      const glyph = `mods/orca-tabs/chevron-${direction === "start" ? "left" : "right"}.svg`;
      return div().id(`tab-scroll-${direction}`).mx(2).w(20).h(24).flex_none().flex().items_center().justify_center().rounded(6)
        .text_color(disabled ? t.dim : t.muted)
        .when(!disabled, el => el.hover(s => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop))
        .role("button").accessibility_label(label).tooltip(label)
        .on_click(() => { if (!disabled) this.scrollTabStrip(direction, cx); })
        .child(svg(glyph).size(14).flex_none());
    };
    const winBtn = (id, label, glyph, action, close) => div().id(id).w(46).h_full().flex_none().flex().items_center().justify_center()
      .text_color(t.muted).hover(s => s.bg(close ? "#c42b1c" : t.hover).text_color(close ? "#ffffff" : t.foreground))
      .role("button").accessibility_label(label).tooltip(label)
      .on_mouse_down("left", stop).on_click(action).child(glyph);
    // TitlebarMainStrip.tsx:12-33,76 — `RightSidebarToggle`: `.sidebar-toggle mr-2`
    // (main.css:1213-1230 = 4px/8px padding around the 16px `PanelRight`, so 32x24, radius 4,
    // muted, hover --accent + foreground). Herdr toggles it with `layout.toggle` (commands.rs:77).
    const panelToggle = (action) => div().id("panel-toggle").mr(8).w(32).h(24).flex_none().flex().items_center().justify_center().rounded(4)
      .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .role("button").accessibility_label("Toggle right sidebar").tooltip("Toggle right sidebar")
      .on_mouse_down("left", stop).on_click(action)
      .child(svg("mods/orca-tabs/panel-right.svg").size(16));
    const item = (c, i, mode = {}) => {
      const pane = tabPanes.get(c.id) ?? null;
      const program = pane?.program;
      const unofficial = this.unofficialApp(pane, unofficialPanes);
      // SortableTab.tsx:130 — displayTitle = customTitle ?? (tabAgent ? strip(title) : title).
      const label = this.getTabLabel(c, pane, unofficial);
      const tabColour = tabColorStore[c.id] ?? null;
      // TerminalTabLeadingIcon.tsx:31-45 — the agent's identity mark, `opacity-70` while the
      // tab is inactive. Orca's `AgentIcon` (`agent-catalog.tsx:50-122`) decides which mark an
      // agent has; what decides the drawing is whether it brings its own fills. omp's gradient
      // (`agent-icon-glyphs.tsx:30-62`), Droid's white-on-black (`status-bar/icons.tsx:343-366`),
      // Kilo's yellow/black and the bundled favicons keep theirs, so they are images — `svg()` is
      // a one-color mask (gpui-kit.d.ts:20273-20281) and greys them. A currentColor glyph (Codex,
      // Pi, Aider, OpenCode, Copilot) takes the text color instead. An agent Orca names no mark
      // for falls back to the program table's own icon. `mods/orca-spaces` draws the same table:
      // a mod cannot reach another's files, so each carries its own copies.
      const ownFills = new Set(["omp", "droid", "kilo"]);
      const agentMarks = {
        codex: "mods/orca-tabs/agent-icons/codex.svg",
        omp: "mods/orca-tabs/agent-icons/omp.svg",
        gemini: "mods/orca-tabs/agent-icons/gemini.png",
        cursor: "mods/orca-tabs/agent-icons/cursor.png",
        grok: "mods/orca-tabs/agent-icons/grok.png",
        qoder: "mods/orca-tabs/agent-icons/qoder.png",
        hermes: "mods/orca-tabs/agent-icons/hermes.png",
        "dsh-tui": "mods/orca-tabs/agent-icons/dsh.png",
        droid: "mods/orca-tabs/agent-icons/droid.svg",
        kilo: "mods/orca-tabs/agent-icons/kilo.svg",
        aider: "mods/orca-tabs/agent-icons/aider.svg",
        freebuff: "mods/orca-tabs/agent-icons/freebuff.png",
      };
      const identityApp = unofficial?.key ?? pane?.app;
      const mark = agentMarks[identityApp];
      // Two copies of one tab exist only while it is pinned: the slot in the track and the
      // overlay drawn at the clamped position. Their ids must differ or GPUI treats them as one
      // element (`gpui-kit.d.ts:1098-1109`).
      const copyId = mode.overlay ? "-dock" : "";
      let identity = null;
      if (mark === "mono") identity = program?.icon ? svg(program.icon).size(12).text_color(t.muted) : null;
      else if (mark) identity = ownFills.has(identityApp) || !mark.endsWith(".svg")
        ? image(mark).size(12)
        : svg(mark).size(12).text_color(t.muted);
      else if (program?.icon) identity = program.tint ? svg(program.icon).size(12).text_color(t.muted) : image(program.icon).size(12);
      // Orca's tab: flat, full height, no pill. SortableTab.tsx:214 — h-full px-1.5 text-xs plus
      // getTabStripBorderClasses (border-t border-r border-border). The slot clamps the tab to
      // `w-[300px] max-w-[300px] min-w-[144px] flex-1` (tab-width-rules.ts:2, applied at
      // use-tab-strip-slot-props.ts:16). Dark theme, main.css:428-429: active is 6% foreground
      // over #171717 (#242424), inactive is #171717; drop-indicator.ts:15-16 — the active bar is
      // 2px, inset-x-0, bottom. `mr-1` on the leading icon and label
      // (TerminalTabLeadingIcon.tsx:63, SortableTab.tsx:291) is the 4px gap between children.
      return h_flex().id(`tab-${c.id}${copyId}`).h_full().px(6).gap(4).relative().items_center().flex_none().min_w(144).max_w(300).text_size(12)
        .bg(c.active ? "#242424" : "#171717").text_color(c.active ? t.foreground : t.muted)
        .border_t(1).border_color(t.border)
        .when(!c.active, el => el.hover(s => s.text_color(t.foreground)))
        .when(i < shown.length - 1, el => el.border_r(1))
        .when(c.active, el => el.child(div().absolute().bottom(0).left(0).right(0).h(2).bg(t.foreground)))
        .on_hover((hovered, cx) => {
          const next = hovered ? c.id : this.hoveredTab === c.id ? null : this.hoveredTab;
          if (next === this.hoveredTab) return;
          this.hoveredTab = next;
          cx.notify();
        })
        // SortableTab.tsx:214 — cursor-pointer: tab rest hover is a pointer hand, not grab.
        .cursor_pointer()
        .when(this.pressed === i, el => el.cursor_grabbing().opacity(0.8))
        // SortableTab.tsx:231-243 — onAuxClick button === 1 (middle-click) closes tab.
        .on_mouse_down("middle", (_e, cx) => {
          cx.stop_propagation();
          this.requestCloseTab(c);
        })
        // Blue drop insertion line — Orca drop-indicator.ts:4-12 (w-[2px] bg-blue-500).
        .when(this.pressed !== null && this.overTab === c.id && this.pressed !== i, el =>
          el.child(
            div().absolute().top(0).bottom(0).w(2).bg("#3b82f6")
              .when(this.overSide === "left", line => line.left(0))
              .when(this.overSide === "right", line => line.right(0))
          )
        )
        // Tab reordering — SortableTab.tsx:213 and tab-drag-drop-commit.ts:116-126. Dragging along
        // the strip reorders via `tab.move`. A press that travels 12px or more hands the drag to
        // the drop overlay instead (`edgeZone`, `renderDrop`), because these handlers stop at the
        // tab rail — see ADR 0007 "Tab Drop-To-Split".
        .on_mouse_down("left", (e, cx) => {
          cx.stop_propagation();
          this.pressed = i;
          this.overTab = c.id;
          this.overSide = null;
          this.stripBounds = e.bounds;
          // What a drop past the strip would carry, and where the press began.
          this.pressAt = e.position;
          this.dragTab = c.id;
          this.dragTerminal = pane?.terminal ?? null;
          this.dragPane = pane?.pane ?? null;
          if (e.click_count === 2) run("tab.rename", { id: c.id });
          cx.notify();
        })
        .on_mouse_move((e, cx) => {
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
          if (this.pressed !== null) {
            const width = e.bounds?.width ?? 144;
            const localX = e.local_position?.x ?? (width / 2);
            const side = localX < width / 2 ? "left" : "right";
            if (this.overTab !== c.id || this.overSide !== side) {
              this.overTab = c.id;
              this.overSide = side;
              cx.notify();
            }
          }
        })
        .on_mouse_up("left", (_e, cx) => {
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
          run("tab.select", { id: c.id });
          run("layout.select", { stack: "main", child: "main-terminals" });
          cx.notify();
        })
        // `orca-menu` owns the tab menu (it already has the "tab" case); pointing at Herdr's
        // shipped `menu` made this mod depend on a mod outside the package.
        // SortableTabContextMenu.tsx:155 — `min-w-[13rem]` (208).
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "orca-menu", kind: "popup", width: 208, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        // ORDER — SortableTab.tsx:249-351. Left to right inside a tab:
        //   TerminalTabLeadingIcon (the agent/shell icon)  :249 — size={12} (TerminalTabLeadingIcon.tsx:42,100)
        //   Pin (size-3 = 12px, mr-1)                      :258-259  [pinned only]
        //   label (mr-1)                                   :289
        //   colour dot (size-2, mr-1.5)                    :291-296  [only when the tab has a colour]
        //   Minimize2 collapse (w-4 box, w-3 glyph)        :298-316  [expanded tabs]
        //   X close (w-4 box, w-3 glyph)                   :317-349
        // TerminalTabLeadingIcon.tsx:72-103 — the activity mark (`AgentStateDot`) comes first,
        // then the agent's identity, and only the identity is `opacity-70` on an inactive tab
        // (:44-50). working = the agent-working spinner, done = CircleCheck in emerald-500,
        // blocked — Herdr's word for a waiting agent — = AgentQuestionIcon, a
        // MessageCircleQuestion in --agent-question. A bare dot is Orca's idle mark only.
        .when(c.status === "working", el => el.child(svg("mods/orca-tabs/spinner.svg").size(12).flex_none().text_color("#eab308").spin(1000)))
        .when(c.status === "done", el => el.child(svg("mods/orca-tabs/circle-check.svg").size(12).flex_none().text_color("#10b981")))
        .when(c.status === "blocked", el => el.child(svg("mods/orca-tabs/message-circle-question.svg").size(12).flex_none().text_color("#ea580c")))
        // `src/renderer/src/components/AgentStateDot.tsx:186-195` — idle is a plain dot, not a glyph: `size-2` (8px)
        // `rounded-full` in `bg-neutral-500/40` inside the md `h-3 w-3` (12px) box.
        .when(c.status === "idle", el => el.child(div().size(12).flex_none().flex().items_center().justify_center()
          .child(div().size(8).rounded(4).bg("#73737366"))))
        .when(Boolean(identity), el => el.child(c.active ? identity : identity.opacity(0.7)))
        // Pin — SortableTab.tsx:258-259: size-3 (12px), mr-1 (4px), shrink-0, text-muted-foreground.
        .when(Boolean(c.settled), el => el.child(svg("mods/orca-tabs/pin.svg").size(12).flex_none().mr(4).text_color(t.muted)))
        // `TAB_LABEL_WIDTH_CLASSES` (tab-width-rules.ts:4) — `tab-label min-w-0 flex-1 truncate`.
        // Orca never marks an expanded pane in the title (SortableTab.tsx:130-131); the
        // Minimize2 button below is the only indicator.
        .child(div().flex_1().min_w(0).truncate().child(label))
        // Colour dot — SortableTab.tsx:293-297: size-2 rounded-full dot, shown only when tab has a colour. Orca reads tab.color; Herdr has no colour field, so the value comes from localStorage["tab.colors.v1"] written by orca-menu. No !isEditing guard exists in this port.
        .when(Boolean(tabColour), el => el.child(div().size(8).flex_none().rounded(4).mr(6).bg(tabColour)))
        // Collapse pane — SortableTab.tsx:298-316: shown while the pane is expanded, a 16px box
        // with a 12px `Minimize2`; active tabs always show it, inactive ones on TAB hover
        // (`text-transparent group-hover:text-muted-foreground`). `pane.zoom` collapses.
        .when(c.zoomed, el => el.child(div().id(`collapse-${c.id}${copyId}`).size(16).flex_none().flex().items_center().justify_center().rounded(2)
          .text_color(c.active || this.hoveredTab === c.id ? t.muted : "#00000000")
          .hover(s => s.text_color(t.foreground).bg(t.raised))
          .role("button").accessibility_label("Collapse pane").tooltip("Collapse pane")
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => {
            cx.stop_propagation();
            // The ZOOMED pane, not the focused one: a split tab can have another pane zoomed.
            const z = (panes() ?? []).find(p => p.tab === c.id && p.zoomed);
            if (z) run("pane.zoom", { pane: z.pane });
          })
          .child(svg("mods/orca-tabs/minimize-2.svg").size(12))))
        // Close — SortableTab.tsx:317-349: only when `!isPinned` (Orca's pinned tab has no close
        // button; Herdr's pin analogue is `settled`, TabInfo.settled). The box is `w-4 h-4`
        // (16px), the glyph `w-3` (12px); inactive is `text-transparent` and becomes muted on
        // TAB hover (`group-hover`), not on its own box.
        .when(!c.settled, el => el.child(div().id(`close-${c.id}${copyId}`).size(16).flex_none().flex().items_center().justify_center().rounded(2)
          .text_color(c.active || this.hoveredTab === c.id ? t.muted : "#00000000")
          .hover(s => s.text_color(t.foreground).bg(t.raised))
          .on_mouse_down("left", stop).accessibility_label("Close").tooltip("Close")
          .on_click((_e, cx) => { cx.stop_propagation(); this.requestCloseTab(c); })
          .child(svg("mods/orca-tabs/close.svg").size(12))))
        // The width of a tab is its label's, so the strip measures the slot rather than guessing
        // (`on_size_change`, gpui-kit.d.ts:734-736 — the only measurement a mod gets).
        .when(!mode.overlay, el => el.on_size_change((size, cx) => this.measureTabWidth(c.id, size.width, cx)))
        // The pinned copy: drawn after the track, so it paints above the inactive tabs passing
        // underneath, and given the clamped left the geometry asked for. It is the same tab — its
        // own icon, indicator and close button — so nothing is clipped at the viewport edge.
        .when(Boolean(mode.overlay), el => el.absolute().top(0).left(mode.overlay.visualLeft).w(mode.overlay.width))
        // Sliding, as a pinned tab does, keeps the same share of the arrow's ease as the track.
        .when(Boolean(mode.overlay) && Boolean(mode.sliding), el => el.transition("left", { duration: TAB_STRIP_SLIDE_MS, easing: "ease-out" }))
        // The slot itself keeps its place and its width, so the track stays exactly as long as the
        // tab list; it only stops painting while the pinned copy stands in for it. The pinned copy
        // always covers the slot's visible part, so no hole shows and no second tab appears.
        .when(mode.hidden, el => el.opacity(0));
    };
    const root = layout();
    const sidebar = find(root, "sidebar");
    // Live read keeps maximize/restore current (Orca subscribes to onMaximizeChanged,
    // WindowControls.tsx:15); the cached seed covers the first paint, when `window()` is null.
    const live = appWindow();
    if (live) this.windowState = live;
    const w = live ?? this.windowState ?? {};
    // .titlebar has no horizontal padding (main.css:1072-1084), so the strip is flush from the
    // left; only macOS traffic lights that land over this column reserve space. Old saved rails
    // and a dragged-narrow sidebar can be smaller than the window buttons.
    const lights = root?.traffic_lights;
    const leftPad = w.platform === "macos" && w.titlebar === "none" && !w.fullscreen && lights?.length
      ? Math.max(0, (lights[0] + 64) / (settings()?.zoom || 1) - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 0;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = [...(shared("workspace.panels") ?? ["files", "changes"])];
    this.syncPanel(space, panel, body, enabled);
    this.syncLanding(cx);
    // `.titlebar`: 36px, border-bottom var(--border), background var(--card) #171717
    // (main.css:1072-1084). Tabs sit flush to each edge of that bar.
    // The Explorer / Source Control activity buttons are NOT here: Orca renders its activity
    // bar only inside the right sidebar (`right-sidebar-top-activity-bar.tsx:40`), which
    // `orca-panel-head` owns. Drawing them twice put two strip icons in the titlebar corner.
    return h_flex().size_full().min_w(0).pl(leftPad).gap(0).items_center().bg(t.surface).border_b(1).border_color(t.border)
      .on_mouse_move((e, cx) => {
        if (this.pressed !== null && this.stripBounds) {
          this.triggerSplit(this.stripBounds, e.position, cx);
        }
      })
      .on_mouse_up("left", (_e, cx) => {
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
      })
      // TitlebarLeftControls.tsx:74-88 — ONE sidebar toggle, at the LEFT; `orca-chrome` draws it
      // inside the sidebar column. This copy appears only while that column is hidden, since
      // Herdr skips a hidden node's content (layout.rs:551); Orca keeps the control at the same
      // left slot by floating `titlebar-left` over the workspace
      // (AppWorkspaceShell.tsx:163-167).
      .when(Boolean(sidebar?.hidden), el => el.child(sidebarToggle(svg("mods/orca-chrome/panel-left.svg").size(16), () => {
        setShared("sidebar.collapsed", false);
        run("layout.show", { id: "sidebar" });
        // Same x and glyph as orca-chrome's toggle (75, or 8 in full screen) so the button does not jump on collapse.
      }, w.platform === "macos" || !w.platform ? (w.fullscreen ? 8 : 75) - leftPad : 6)))
      // Orca hides the strip's native scrollbar (`tab-bar-surface.tsx:164-175`) and paints only
      // its 3px hover thumb (`TabStripScrollIndicator.tsx:196-215`), which Herdr has no
      // primitive for — so no scrollbar is painted and no thumb is faked. The wheel scrolls the
      // strip (`wheelTabStrip`): Orca does not switch tabs on wheel.
      // `tab-bar-surface.tsx:164-170` — the strip is `w-max … max-w-full shrink`: content-wide,
      // never stretched, so the `+` that follows it sits directly after the last tab. It shrinks
      // (and scrolls) once the tabs outgrow the row, so the `+` and the right-sidebar toggle stay visible.
      //
      // The viewport clips; the track inside it holds every tab in order at its measured width,
      // shifted by the strip's own scroll offset. The active tab is drawn twice only while it is
      // pinned — its slot in the track (unpainted, but still holding the width) and the overlay at
      // the clamped left — which is what keeps `contentWidth` and the scroll limits independent of
      // the dock (§4). The arrows sit outside this box, so the pinned tab can never slide under them.
      .when(geometry.arrows.hasOverflow, el => el.child(tabScrollButton("start", geometry.arrows.leftDisabled)))
      .child(div().id("tab-viewport").relative().flex_shrink(1).min_w(0).h_full().overflow_hidden()
        .on_size_change((size, cx) => {
          if (Math.abs(size.width - this.viewportWidth) < 0.5) return;
          this.viewportWidth = size.width;
          cx.notify();
        })
        .on_scroll_wheel((e, cx) => this.wheelTabStrip(e, cx))
        .child(h_flex().id("tab-track").relative().left(-this.scrollX).h_full().items_center().gap(0).flex_none()
          .when(this.sliding(), el => el.transition("left", { duration: TAB_STRIP_SLIDE_MS, easing: "ease-out" }))
          .children(shown.map((c, i) => item(c, i, { hidden: geometry.docked && i === geometry.activeIndex }))))
        .when(geometry.docked, el => el.child(item(geometry.activeTab, geometry.activeIndex, { overlay: { ...geometry.slot, width: geometry.activeWidth }, sliding: this.sliding() }))))
      .when(geometry.arrows.hasOverflow, el => el.child(tabScrollButton("end", geometry.arrows.rightDisabled)))
      // Orca terminal-tab-strip-drop-target.ts:39-52 — visual drop indicator when a pane is dragged to the tab strip.
      .when(Boolean(paneDrag?.inTabStrip), el =>
        el.child(
          h_flex()
            .id("pane-drop-strip-indicator")
            .h(28)
            .px(8)
            .ml(4)
            .items_center()
            .justify_center()
            .rounded(6)
            .border_2()
            .border_color("#3b82f6")
            .bg("#3b82f626")
            .child(div().text_size(12).font_medium().text_color(t.foreground).child("+ Move to Tab"))
        )
      )
      // tab-bar-surface.tsx:232 — the create menu is `w-72` (288).
      .child(tabNew(() => openOverlay({ mod: "orca-new-menu", kind: "popup", width: 288, height: 512, at: this.newMenuAt() })))
      .child(div().flex_1())
      // TitlebarMainStrip.tsx:58-69 — the single-tab case gets a `Minimize2`
      // (`showTitlebarExpandButton` = `!hasTabBar && effectiveActiveTabExpanded`,
      // use-app-chrome-layout.ts:129; hasTabBar is `tabCount >= 2`). `.titlebar-icon-button` is
      // 4px padding around a 14px glyph with `mr-2`, radius 4 (main.css:1288-1313).
      .when(shown.length === 1 && shown[0].zoomed, el => el.child(div().id("titlebar-collapse").mr(8).size(22).flex_none().flex().items_center().justify_center().rounded(4)
        .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
        .role("button").accessibility_label("Collapse pane").tooltip("Collapse pane")
        .on_mouse_down("left", stop)
        .on_click(() => {
          const z = (panes() ?? []).find(p => p.tab === shown[0].id && p.zoomed);
          if (z) run("pane.zoom", { pane: z.pane });
        })
        .child(svg("mods/orca-tabs/minimize-2.svg").size(14))))
      // TitlebarMainStrip.tsx:76 — Orca's `RightSidebarToggle` moves into the panel header
      // while the panel is open (`right-sidebar/index.tsx:124-144`); `orca-panel-head` draws it
      // there, so this copy shows only while the panel is hidden (a hidden node draws nothing).
      .when(find(layout(), "panel")?.hidden, el => el.child(panelToggle(() => run("layout.toggle", { id: "panel" }))))
      // WindowControls.tsx:27-30,42-49,60-67 — Orca replaces native chrome on Linux and Windows
      // with the same 10x10 SVG paths; only macOS keeps its traffic lights. Herdr reports
      // `buttons: false` here (the compositor owns decorations) but draws none of its own, so
      // the strip is the only place these actions exist — draw them on every non-macOS window.
      .when(w.platform !== "macos", el => el.child(h_flex().h_full().items_center()
        .child(winBtn("minimize", "Minimize", svg("mods/orca-tabs/win-min.svg").size(10), () => run("window.minimize"), false))
        .child(winBtn("maximize", "Maximize", svg(`mods/orca-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(10), () => run("window.maximize"), false))
        .child(winBtn("close-window", "Close window", svg("mods/orca-tabs/win-close.svg").size(10), () => run("window.close"), true))));
  }
}
