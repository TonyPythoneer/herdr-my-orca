import {
  View,
  div,
  svg,
  type AsyncContext,
  type Color,
  type Context,
  type FocusHandle,
  type MouseMoveEvent,
  type NativeElement,
} from "gpui-kit";
import { h_flex } from "gpui-base";
import {
  closeOverlay,
  nextCommand,
  openOverlay,
  panes,
  props,
  run,
  setShared,
  shared,
  spaces,
  terminals,
  window as herdrWindow,
  writeTextFile,
  type PaneInfo,
  type SpaceInfo,
  type TabInfo,
} from "herdr";
import { selectTabPanes } from "./tab-panes.js";
import { edgeZone, type Box, type Zone } from "./drop-zone.js";
import { sidebarEase } from "./sidebar-motion.js";
import { Drawer, type DrawerEnv } from "./drawer.js";
import {
  isCollapsed,
  settingsHoldPx,
  settingsPillLeft,
  settingsReturnPage,
  settingsSidebarPlan,
  type SidebarPlan,
} from "./agent-settings-route.js";
import { stripLeadingAgentTitleDecoration } from "./tab-title.js";
import { TAB_STRIP_SLIDE_MS, type StripFrame, type TabGeometry } from "./tab-item.js";
import { addEndControls, addSidebarToggle, addTabTrack } from "./header-controls.js";
import { find, layoutTree, scaledWidth, toggleLeft, visibleSize, zoomOf } from "./header-layout.js";
import { renderCloseDialog, type DialogView } from "./close-dialog.js";
import { newTabArgs } from "./new-tab.js";
import { UNOFFICIAL_APPS, unofficialByTerminal, type UnofficialApp } from "./unofficial-apps.js";
import {
  clampTabStripScroll,
  revealTabStripSlot,
  tabStripActiveSlot,
  tabStripArrowState,
  tabStripContentWidth,
  tabStripOffset,
  tabStripScrollTarget,
} from "./tab-strip-scroll.js";
import { headerTheme } from "./theme.js";
import {
  dragRecord,
  dropHalf,
  dropTrace,
  globalWindow,
  moveTabToSplit,
  panelRect,
  pollDrop,
  setDragRecord,
  currentDrop,
  unsplitPaneToTab,
  DROP_KEY,
  type DropRecord,
} from "./tab-drop.js";
import type { Flag, HeaderProps, HeaderTheme, LayoutNode, Point, WindowState } from "./types.js";

const SIDEBAR_STEP_MS = 16;
const SIDEBAR_RESIZE_SETTLE_MS = 80;
const SIDEBAR_SHOW_SETTLE_MS = 50;
const SIDEBAR_HIDE_SETTLE_MS = 80;
const LEAVE_RENDER_MS = 1;
const SIDEBAR_DEFAULT_OPEN = 259;
const DRAWER_MIN_OPEN_PX = 120;
const SETTINGS_HEADER_HEIGHT = 32;
const SETTINGS_BUTTON_INSET = 4;
const SETTINGS_BUTTON_HEIGHT = SETTINGS_HEADER_HEIGHT - SETTINGS_BUTTON_INSET * 2;
const TAB_DRAG_DISTANCE = 12;
const TAB_STRIP_FALLBACK = 32;
const WINDOW_RETRY_MS = 50;
const PANEL_RESTORE_TIMEOUT_MS = 1000;
const WINDOW_RETRIES = 20;
const OVERLAY_PROBE_MS = 300;
const SLIDE_GRACE_MS = 60;
const DRAG_POLL_MS = 16;
const DROP_REV = 13;

const drawerEase = (() => {
  const [x1, y1, x2, y2] = [0.32, 0.72, 0, 1];
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (x: number): number => {
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 24; i++) {
      if (bx(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return by(t);
  };
})();

type TabLike = { id: string; name: string; named?: boolean };
type Drawers = { sidebar: Drawer; panel: Drawer };
type StripState = { t: HeaderTheme; bar: Color; leftPad: number };
export type Frame = StripState &
  StripFrame & {
    sidebar: LayoutNode | null | undefined;
    panel: LayoutNode | null | undefined;
    zoomK: number;
    w: WindowState;
    paneDrag:
      | { inTabStrip?: boolean; active?: boolean; terminal?: string | null; pane?: string | null }
      | undefined;
  };

function paneForLabel(tabId: string): PaneInfo | undefined {
  return (
    (panes() ?? []).find((p) => p.tab === tabId && p.program?.agent) ??
    (panes() ?? []).find((p) => p.tab === tabId)
  );
}

function derivedTabName(
  raw: string,
  pane: PaneInfo | null | undefined,
  unofficial: UnofficialApp | null | undefined,
): string {
  return unofficial?.name || pane?.title || pane?.program?.name || raw || "Terminal";
}

function tabLabel(
  c: TabLike,
  pane: PaneInfo | null | undefined,
  unofficial: UnofficialApp | null | undefined,
): string {
  const raw = c.name ?? "Terminal";
  const name = c.named ? raw : derivedTabName(raw, pane, unofficial);
  return pane?.program?.agent ? stripLeadingAgentTitleDecoration(name) : name;
}

function storedPanels(): Record<string, string | null> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem("panels") ?? "{}");
    return stored && typeof stored === "object" ? (stored as Record<string, string | null>) : {};
  } catch {
    return {};
  }
}

function takeToggle(view: Tabs, field: "wantToggle" | "wantPanelToggle"): boolean {
  const count = view[field];
  if (!count) return false;
  view[field] = 0;
  return count % 2 === 1;
}

function lightsOverlap(w: WindowState, lights: number[] | undefined): boolean {
  return (
    w.platform === "macos" && w.titlebar === "none" && !w.fullscreen && Boolean(lights?.length)
  );
}

function trafficLightPadding(root: LayoutNode | null | undefined, w: WindowState): number {
  const lights = root?.traffic_lights;
  return lightsOverlap(w, lights) && lights ? Math.max(0, (lights[0] + 64) / zoomOf()) : 0;
}

const sidebarHiddenNow = (): boolean => Boolean(find(layoutTree(), "left-sidebar")?.hidden);

function sidebarMotionMs(distance: number): number {
  return (320 + 120 * distance) * (0.5 + 0.5 * distance) + 60;
}

function sidebarPlan(
  drawer: Drawer,
  node: LayoutNode | null | undefined,
): { open: number; target: number; from: number } {
  const hidden = Boolean(node?.hidden);
  const open = drawer.openPx > 0 ? drawer.openPx : SIDEBAR_DEFAULT_OPEN;
  if (drawer.busy) return { open, target: drawer.goal === 1 ? 0 : 1, from: drawer.p };
  return {
    open,
    target: hidden ? 1 : 0,
    from: hidden ? 0 : Math.min(1, (node?.size?.px ?? open) / open),
  };
}

type SidebarMotion = {
  open: number;
  target: number;
  from: number;
  dur: number;
  t0: number;
  kind: string;
  samples: { ms: number; px: number }[] | null;
};

function sidebarMotionOf(open: number, target: number, from: number): SidebarMotion {
  return {
    open,
    target,
    from,
    dur: sidebarMotionMs(Math.abs(target - from)),
    t0: Date.now(),
    kind: props()?.motion === "layout" ? "layout" : "smooth",
    samples: props()?.measureSidebar ? [] : null,
  };
}

function writeSidebarSamples(motion: SidebarMotion): void {
  if (!motion.samples) return;
  writeTextFile(
    `/tmp/sidebar-motion-${motion.t0}.json`,
    JSON.stringify({
      motion: motion.kind,
      open: motion.open,
      target: motion.target,
      dur: motion.dur,
      samples: motion.samples,
    }),
    null,
  ).catch(() => {});
}

function insertionSide(event: MouseMoveEvent): "left" | "right" {
  const width = event.bounds?.width ?? 144;
  const localX = event.local_position?.x ?? width / 2;
  return localX < width / 2 ? "left" : "right";
}

function settingsFrom(sidebar: LayoutNode | null | undefined, restore: number): number {
  return sidebar?.hidden ? 1 : (sidebar?.size?.px ?? restore);
}

function settingsSettled(
  resize: number,
  sidebar: LayoutNode | null | undefined,
  from: number,
): boolean {
  if (resize === 0 && sidebar?.hidden) return true;
  return !sidebar?.hidden && from === resize;
}

function newSplitOverlay(
  half: { left: number; top: number; width: number; height: number },
  t: HeaderTheme,
): NativeElement {
  return div()
    .absolute()
    .left(half.left)
    .top(half.top)
    .w(half.width)
    .h(half.height)
    .bg("#3b82f633")
    .border_2()
    .border_color("#3b82f680")
    .rounded(4)
    .child(
      div()
        .absolute()
        .bottom(8)
        .left(8)
        .px(6)
        .py(2)
        .rounded(2)
        .text_size(11)
        .font_medium()
        .text_color(t.solid_foreground)
        .bg("#5b8def33")
        .child("New split"),
    );
}

export default class Tabs extends View {
  nativePinned!: boolean;
  nativeHeaderWidth!: number;
  drawers!: Drawers;
  pressed?: number | null;
  overTab?: string | null;
  overSide?: "left" | "right" | null;
  hoveredTab?: string | null;
  scrollX!: number;
  viewportWidth!: number;
  contentWidth!: number;
  tabWidths!: Map<string, number>;
  activeTabId?: string | null;
  revealPending!: boolean;
  animatedUntil!: number;
  panels!: Record<string, string | null>;
  pending?: { want: string | null; until: number } | null;
  space?: string;
  landing?: string | null;
  navAsked?: boolean;
  lastAppPage?: string;
  settingsPageRequest?: { page: string; sent: boolean } | null;
  nativeRecovering?: boolean;
  windowState?: WindowState | null;
  wantToggle?: number;
  wantPanelToggle?: number;
  dontAskAgain?: boolean;
  handle!: FocusHandle;
  isDialog?: boolean;
  isDropOverlay?: boolean;
  zone?: Zone | null;
  drag?: DropRecord;
  plusBounds?: { x: number; y: number; width: number; height: number };
  stripBounds?: { x: number; y: number; width: number; height: number };
  pressAt?: { x: number; y: number };
  dragTab?: string;
  dragTerminal?: string | null;
  dragPane?: string | null;

  constructor(...args: ConstructorParameters<typeof View>) {
    super(...args);
    this.initDrawers();
  }

  initDrawers(): void {
    this.nativePinned = false;
    this.nativeHeaderWidth = 0;
    this.drawers = {
      sidebar: new Drawer({
        id: "left-sidebar",
        defaultOpen: 259,
        measure: "measureSidebar",
        pin: () =>
          props()?.pinSidebarTerminal && !this.nativePinned && this.nativeHeaderWidth > 0
            ? this.nativeHeaderWidth / zoomOf()
            : null,
        after: (target) => setShared("left-sidebar.collapsed", target === 0),
      }),
      panel: new Drawer({
        id: "panel",
        defaultOpen: 350,
        measure: "measurePanel",
        pin: (open) => {
          if (!(this.nativeHeaderWidth > 0)) return null;
          const root = layoutTree();
          const sidebarWidth = visibleSize(find(root, "left-sidebar"), 0);
          const panelWidth = visibleSize(find(root, "panel"), 0);
          return Math.max(1, this.nativeHeaderWidth / zoomOf() + panelWidth - open - sidebarWidth);
        },
      }),
    };
  }

  init(_props: unknown, cx: AsyncContext): void {
    const p = (_props as HeaderProps | undefined)?.confirmClose ? (_props as HeaderProps) : props();
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
    this.hoveredTab = null;
    this.scrollX = 0;
    this.viewportWidth = 0;
    this.contentWidth = 0;
    this.tabWidths = new Map();
    this.activeTabId = undefined;
    this.revealPending = false;
    this.animatedUntil = 0;
    this.panels = storedPanels();
    this.seedWindow(cx);
    this.listenForCommands(cx);
  }

  initDropOverlay(cx: AsyncContext): void {
    this.isDropOverlay = true;
    this.zone = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
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
        if (this.zone !== null) {
          this.zone = null;
          tickCx.notify();
        }
        return;
      }
      if (drag.zone === this.zone) return;
      this.zone = drag.zone;
      tickCx.notify();
    });
  }

  seedWindow(cx: AsyncContext): void {
    this.windowState = herdrWindow();
    const seed = (seedCx: AsyncContext, tries: number): void => {
      const w = herdrWindow();
      if (w) {
        this.windowState = w;
        seedCx.notify();
        return;
      }
      if (tries > 0) seedCx.timer.after(WINDOW_RETRY_MS, (retryCx) => seed(retryCx, tries - 1));
    };
    if (!this.windowState) cx.timer.after(0, (firstCx) => seed(firstCx, WINDOW_RETRIES));
  }

  listenForCommands(cx: AsyncContext): void {
    cx.spawn(async (taskCx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "new-tab") {
          run("tab.new", newTabArgs(spaces().find((s) => s.active)));
          continue;
        }
        if (command === "agent-settings") {
          if (find(layoutTree(), "main")?.active === "main-agents") this.returnToApp(taskCx);
          else this.requestSettingsPage("main-agents", taskCx);
          continue;
        }
        if (command === "toggle-sidebar") this.wantToggle = (this.wantToggle ?? 0) + 1;
        if (command === "toggle-panel") this.wantPanelToggle = (this.wantPanelToggle ?? 0) + 1;
        if (command === "toggle-sidebar" || command === "toggle-panel") taskCx.notify();
      }
    });
  }

  triggerSplit(
    box: { width: number; height: number; y: number } | null | undefined,
    at: { x: number; y: number },
    cx: AsyncContext,
  ): boolean {
    if (this.pressed === null || dragRecord() || !this.pressAt) return false;
    const space = (spaces() ?? []).find((s) => s.active);
    const shown = space?.tabs ?? [];
    if (shown.length <= 1) return false;
    const rect = box?.width ? panelRect(box.y, box.height) : null;
    if (!rect || at.y - this.pressAt.y < TAB_DRAG_DISTANCE) return false;
    const bodyTop = rect.top + rect.stripHeight;
    const bodyHeight = Math.max(1, rect.height - rect.stripHeight);
    const record: DropRecord = {
      tab: this.dragTab,
      terminal: this.dragTerminal,
      pane: this.dragPane,
      strip: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        stripHeight: rect.stripHeight,
      },
    };
    setDragRecord(record);
    this.pressed = null;
    this.overTab = null;
    this.overSide = null;
    dropTrace("handoff", { press: this.pressAt, at, rect });
    const overlayId = openOverlay({
      mod: "orca-header",
      kind: "popup",
      frame: "none",
      at: { x: rect.left, y: bodyTop },
      width: rect.width,
      height: bodyHeight,
      props: { drop: true },
    });
    record.overlay = overlayId;
    setShared(DROP_KEY, { ...record });
    pollDrop(cx);
    cx.notify();
    return true;
  }

  newMenuAt(): "pointer" | { x: number; y: number } {
    const b = this.plusBounds;
    const vp = globalWindow()?.viewport_size();
    if (!b || !vp) return "pointer";
    return {
      x: Math.max(8, Math.min(b.x + b.width - 288, vp.width - 288 - 8)),
      y: b.y + b.height + 4,
    };
  }

  syncLanding(_cx: AsyncContext): void {
    if (find(layoutTree(), "main")?.active === "main-agents") return;
    const active = (spaces() ?? []).find((s) => s.active);
    const want = (active?.tabs?.length ?? 0) > 0 ? "main-terminals" : "main-landing";
    if (this.landing === undefined) {
      const stack = find(layoutTree(), "main");
      this.landing = stack && "active" in stack ? stack.active : null;
    }
    if (this.landing === want) return;
    this.landing = want;
    run("layout.select", { stack: "main", child: want });
  }

  syncPanel(
    space: Pick<SpaceInfo, "id"> | null | undefined,
    panel: LayoutNode | null | undefined,
    body: LayoutNode | null | undefined,
    enabled: readonly (string | null)[],
  ): void {
    if (!space || !panel) return;
    const now = panel.hidden ? null : (body?.active ?? null);
    if (space.id !== this.space) this.restorePanel(space, panel, now, enabled);
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  restorePanel(
    space: Pick<SpaceInfo, "id">,
    panel: LayoutNode,
    now: string | null,
    enabled: readonly (string | null)[],
  ): void {
    this.space = space.id;
    this.pending = null;
    const stored = this.panels[space.id] ?? null;
    const want = enabled.includes(stored) ? stored : null;
    if (want) {
      if (want !== now || panel.hidden)
        this.pending = { want, until: Date.now() + PANEL_RESTORE_TIMEOUT_MS };
      if (want !== now) run("layout.select", { stack: "panel-body", child: want });
      if (panel.hidden) run("layout.show", { id: "panel" });
    } else if (space.id in this.panels && this.panels[space.id] === null && !panel.hidden) {
      this.pending = { want: null, until: Date.now() + PANEL_RESTORE_TIMEOUT_MS };
      run("layout.hide", { id: "panel" });
    }
  }

  measureTabWidth(id: string, width: number, cx: Context): void {
    const known = this.tabWidths.get(id);
    if (known !== undefined && Math.abs(known - width) < 0.5) return;
    this.tabWidths.set(id, width);
    cx.notify();
  }

  stopSlide(): void {
    this.animatedUntil = 0;
  }

  setStripScroll(x: number, cx: Context): void {
    const next = clampTabStripScroll(x, this.viewportWidth, this.contentWidth);
    if (next === this.scrollX) return;
    this.scrollX = next;
    cx.notify();
  }

  toggleSidebar(cx: AsyncContext): void {
    if (props()?.motion === "native") return this.toggleSidebarNative(cx);
    this.startSidebarMotion(
      cx,
      sidebarPlan(this.drawers.sidebar, find(layoutTree(), "left-sidebar")),
    );
  }

  startSidebarMotion(
    cx: AsyncContext,
    plan: { open: number; target: number; from: number },
    onFinish?: () => void,
  ): void {
    const drawer = this.drawers.sidebar;
    const token = ++drawer.token;
    drawer.busy = true;
    drawer.goal = plan.target;
    cx.spawn((taskCx) => this.runSidebarMotion(taskCx, token, plan, onFinish));
  }

  async runSidebarMotion(
    cx: AsyncContext,
    token: number,
    { open, target, from }: { open: number; target: number; from: number },
    onFinish?: () => void,
  ): Promise<void> {
    const drawer = this.drawers.sidebar;
    await cx.sleep(LEAVE_RENDER_MS);
    if (token !== drawer.token) return;
    if (!(await this.showSidebarFromHidden(cx, token, target))) return;
    const motion = sidebarMotionOf(open, target, from);
    if (!(await this.stepSidebar(cx, token, motion))) return;
    writeSidebarSamples(motion);
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
    drawer.busy = false;
    drawer.goal = undefined;
    cx.notify();
  }

  async showSidebarFromHidden(cx: AsyncContext, token: number, target: number): Promise<boolean> {
    if (target <= 0 || !sidebarHiddenNow()) return true;
    const drawer = this.drawers.sidebar;
    run("layout.resize", { id: "left-sidebar", px: 1 });
    await cx.sleep(SIDEBAR_RESIZE_SETTLE_MS);
    if (token !== drawer.token) return false;
    run("layout.show", { id: "left-sidebar" });
    await cx.sleep(SIDEBAR_SHOW_SETTLE_MS);
    return token === drawer.token;
  }

  async stepSidebar(
    cx: AsyncContext,
    token: number,
    {
      open,
      target,
      from,
      dur,
      t0,
      kind,
      samples,
    }: {
      open: number;
      target: number;
      from: number;
      dur: number;
      t0: number;
      kind: string;
      samples: { ms: number; px: number }[] | null;
    },
  ): Promise<boolean> {
    const drawer = this.drawers.sidebar;
    const ease = kind === "layout" ? drawerEase : sidebarEase;
    let lastPx = -1;
    for (;;) {
      const k = Math.min(1, (Date.now() - t0) / dur);
      drawer.p = from + (target - from) * ease(k);
      const px = Math.max(1, Math.round(open * drawer.p));
      if (px !== lastPx) {
        lastPx = px;
        if (samples) samples.push({ ms: Date.now() - t0, px });
        run("layout.resize", { id: "left-sidebar", px });
        if (target > 0 && sidebarHiddenNow()) run("layout.show", { id: "left-sidebar" });
        cx.notify();
      }
      if (k >= 1) return true;
      await cx.sleep(SIDEBAR_STEP_MS);
      if (token !== drawer.token) return false;
    }
  }

  drawerEnv(): DrawerEnv {
    return {
      run,
      find,
      layout: layoutTree,
      props,
      zoom: () => zoomOf(),
      write: (path, text) => writeTextFile(path, text, null),
      pin: (px) => {
        this.nativePinned = true;
        run("layout.resize", { id: "main", px });
      },
      release: () => this.releaseNativePin(),
    };
  }

  toggleSidebarNative(cx: AsyncContext): void {
    this.drawers.sidebar.toggle(cx, this.drawerEnv());
  }

  togglePanel(cx: AsyncContext): void {
    this.togglePanelNative(cx);
  }

  togglePanelNative(cx: AsyncContext): void {
    this.drawers.panel.toggle(cx, this.drawerEnv());
  }

  releaseNativePin(): void {
    if (this.nativePinned && !this.drawers.sidebar.busy && !this.drawers.panel.busy) {
      run("layout.resize", { id: "main", weight: 1 });
      this.nativePinned = false;
    }
  }

  scrollTabStrip(direction: "start" | "end", cx: Context): void {
    const to = tabStripScrollTarget(this.scrollX, this.viewportWidth, this.contentWidth, direction);
    if (to === this.scrollX) return;
    this.animatedUntil = Date.now() + TAB_STRIP_SLIDE_MS + SLIDE_GRACE_MS;
    this.setStripScroll(to, cx);
  }

  sliding(): boolean {
    return Boolean(this.animatedUntil) && Date.now() < this.animatedUntil;
  }

  wheelTabStrip(e: { delta?: { x?: number; y?: number } }, cx: Context): void {
    const dx =
      Math.abs(e.delta?.x ?? 0) >= Math.abs(e.delta?.y ?? 0)
        ? (e.delta?.x ?? 0)
        : (e.delta?.y ?? 0);
    if (!dx) return;
    this.stopSlide();
    this.setStripScroll(this.scrollX + dx, cx);
  }

  measuredWidths(ids: string[]): number[] {
    for (const id of [...this.tabWidths.keys()]) {
      if (!ids.includes(id)) this.tabWidths.delete(id);
    }
    return ids.map((id) => this.tabWidths.get(id) ?? 0);
  }

  stripGeometry(shown: TabInfo[]): TabGeometry {
    const ids = shown.map((tab) => tab.id);
    const widths = this.measuredWidths(ids);
    const contentWidth = tabStripContentWidth(widths);
    this.contentWidth = contentWidth;
    const activeIndex = shown.findIndex((c) => c.active);
    const activeId = activeIndex >= 0 ? ids[activeIndex] : null;
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
        widths[activeIndex],
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
      docked: slot.docked && activeWidth > 0,
    };
  }

  unofficialApp(
    pane: PaneInfo | null | undefined,
    byTerminal?: Map<unknown, UnofficialApp>,
  ): UnofficialApp | null {
    if (!pane) return null;
    const direct = UNOFFICIAL_APPS.find((a) => a.key === pane.app);
    if (direct) return direct;
    if (pane.program?.agent) return null;
    return (byTerminal ?? unofficialByTerminal(terminals() ?? [])).get(pane.terminal) ?? null;
  }

  getTabLabel(
    c: TabLike,
    pane: PaneInfo | null | undefined = undefined,
    unofficial: UnofficialApp | null | undefined = undefined,
  ): string {
    const resolvedPane = pane === undefined ? paneForLabel(c.id) : pane;
    const resolvedUnofficial =
      unofficial === undefined ? this.unofficialApp(resolvedPane) : unofficial;
    return tabLabel(c, resolvedPane, resolvedUnofficial);
  }

  requestCloseTab(c: TabInfo): void {
    const label = this.getTabLabel(c);
    if (c.settled) {
      let skipPinned = false;
      try {
        skipPinned = localStorage.getItem("orca.confirmClosePinnedTab") === "false";
      } catch {}
      if (!skipPinned) {
        openOverlay({
          mod: "orca-header",
          kind: "dialog",
          modal: true,
          width: 384,
          height: 200,
          props: { confirmClose: { kind: "pinned", tabId: c.id, tabLabel: label } },
        });
        return;
      }
      run("tab.close", { id: c.id });
      return;
    }
    run("tab.close", { id: c.id });
  }

  renderConfirmDialog(cx: AsyncContext): NativeElement {
    return renderCloseDialog(this as DialogView, cx);
  }

  renderDrop(): NativeElement {
    const t = headerTheme();
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
      .on_mouse_down("left", (_e, downCx) => downCx.stop_propagation())
      .on_mouse_move((e, moveCx) => this.moveDrop(panel, box.stripHeight, e.position, moveCx))
      .on_mouse_up("left", (e) => {
        dropTrace("drop-up", { at: e.position, zone: this.zone });
        this.drop();
      })
      .on_key_down((e, keyCx) => this.escapeDrop(e.key, keyCx))
      .when(Boolean(half), (el) => (half ? el.child(newSplitOverlay(half, t)) : el));
  }

  moveDrop(panel: Box, stripHeight: number, at: Point, moveCx: Context): void {
    const next = edgeZone(
      panel,
      at,
      stripHeight || find(layoutTree(), "tabs")?.size?.px || TAB_STRIP_FALLBACK,
    );
    dropTrace("drop-move", { panel, at, zone: next });
    if (next === this.zone) return;
    this.zone = next;
    moveCx.notify();
  }

  escapeDrop(key: string, keyCx: Context): void {
    if (key !== "escape") return;
    setDragRecord(null);
    closeOverlay(props()?.overlay as string);
    keyCx.notify();
  }

  drop(): void {
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

  moveOverTab(tab: TabInfo, i: number, e: MouseMoveEvent, cx: Context): void {
    if (this.pressed !== null && this.pressAt) {
      dropTrace("move", {
        i,
        pressed: this.pressed,
        dy: e.position.y - this.pressAt.y,
        busy: Boolean(currentDrop()),
        hasBounds: Boolean(e.bounds?.width),
      });
    }
    if (this.triggerSplit(e.bounds ?? this.stripBounds, e.position, cx)) return;
    if (this.pressed === null) return;
    const side = insertionSide(e);
    if (this.overTab === tab.id && this.overSide === side) return;
    this.overTab = tab.id;
    this.overSide = side;
    cx.notify();
  }

  releaseTab(tab: TabInfo, i: number, shown: TabInfo[], cx: Context): void {
    const from = this.pressed as number | null;
    const overSide = this.overSide;
    this.pressed = null;
    this.overTab = null;
    this.overSide = null;
    if (from === null) return;
    if (from !== i) {
      const oldIndex = from;
      const rawInsertIndex = i + (overSide === "right" ? 1 : 0);
      const nextIndex = oldIndex < rawInsertIndex ? rawInsertIndex - 1 : rawInsertIndex;
      if (oldIndex !== nextIndex) {
        run("tab.move", { id: shown[from].id, index: nextIndex + 1 });
        cx.notify();
        return;
      }
    }
    run("tab.select", { id: tab.id });
    run("layout.select", { stack: "main", child: "main-terminals" });
    cx.notify();
  }

  applyTabAction(cx: AsyncContext): void {
    const action = shared("orca-header.action") as
      | {
          kind?: string;
          tab?: string;
          direction?: Zone;
          terminal?: string | null;
          pane?: string | null;
        }
      | null
      | undefined;
    if (action && typeof action === "object") {
      setShared("orca-header.action", null);
      if (action.kind === "move-tab-split" && action.tab && action.direction) {
        moveTabToSplit(action.tab, action.direction, cx, undefined);
      } else if (action.kind === "unsplit-to-tab" && (action.terminal || action.pane)) {
        unsplitPaneToTab(action.terminal, cx, action.pane);
      }
    }
  }

  recoverMainWidth(root: LayoutNode | null | undefined, cx: AsyncContext): void {
    if (
      !this.drawers.sidebar.busy &&
      !this.drawers.panel.busy &&
      !this.nativeRecovering &&
      find(root, "main")?.size?.px != null
    ) {
      this.nativeRecovering = true;
      cx.spawn(async (taskCx) => {
        await taskCx.sleep(1);
        if (
          !this.drawers.sidebar.busy &&
          !this.drawers.panel.busy &&
          find(layoutTree(), "main")?.size?.px != null
        )
          run("layout.resize", { id: "main", weight: 1 });
        this.nativeRecovering = false;
      });
    }
  }

  syncSidebarToggle(cx: AsyncContext, sidebar: LayoutNode | null | undefined): void {
    if (shared("left-sidebar.settingsPrior")) return;
    if (takeToggle(this, "wantToggle")) this.toggleSidebar(cx);
    const px = sidebar?.size?.px;
    const drawer = this.drawers.sidebar;
    if (
      !drawer.busy &&
      !sidebar?.hidden &&
      px !== undefined &&
      px >= DRAWER_MIN_OPEN_PX &&
      drawer.openPx !== px
    ) {
      drawer.openPx = px;
      setShared("left-sidebar.openPx", drawer.openPx);
    }
  }

  syncPanelToggle(cx: AsyncContext, panel: LayoutNode | null | undefined, zoom: number): void {
    if (takeToggle(this, "wantPanelToggle")) this.togglePanel(cx);
    if (this.drawers.panel.busy) return;
    this.rememberPanelWidth(panel);
    this.drawers.panel.clockPx = (panel?.hidden ? 1 : (panel?.size?.px ?? 350)) / zoom;
  }

  rememberPanelWidth(panel: LayoutNode | null | undefined): void {
    const px = panel?.size?.px;
    if (panel?.hidden || px === undefined || px < DRAWER_MIN_OPEN_PX) return;
    this.drawers.panel.openPx = px;
    setShared("panel.openPx", this.drawers.panel.openPx);
  }

  releaseStrip(cx: AsyncContext): void {
    const paneDrag = shared("orca-header.pane-drag") as
      | { active?: boolean; terminal?: string | null; pane?: string | null }
      | undefined;
    if (paneDrag?.active) {
      setShared("orca-header.pane-drag", null);
      unsplitPaneToTab(paneDrag.terminal, cx, paneDrag.pane);
      cx.notify();
      return;
    }
    const live = dragRecord();
    if (live?.overlay) closeOverlay(live.overlay);
    setDragRecord(null);
    this.pressed = null;
    this.overTab = null;
    this.overSide = null;
    cx.notify();
  }

  headerSurface(
    header: NativeElement,
    { panel, zoomK }: { panel: LayoutNode | null | undefined; zoomK: number },
  ): NativeElement {
    return header
      .relative()
      .child(
        div()
          .id("panel-native-clock")
          .absolute()
          .left(0)
          .top(0)
          .h(1)
          .w(this.drawers.panel.clockPx ?? (panel?.hidden ? 1 : (panel?.size?.px ?? 350)) / zoomK)
          .transition("width", { duration: 500, easing: "ease-in-out" as const })
          .on_size_change((size, cx) => this.drawers.panel.size(size, cx, this.drawerEnv())),
      )
      .on_mouse_move((e, cx) => {
        if (this.pressed !== null && this.stripBounds)
          this.triggerSplit(this.stripBounds, e.position, cx);
      })
      .on_mouse_up("left", (_e, cx) => this.releaseStrip(cx));
  }

  sidebarClock(header: NativeElement): NativeElement {
    return header
      .when(Boolean(props()?.pinSidebarTerminal), (el) =>
        el.on_size_change((size) => {
          this.nativeHeaderWidth = size.width;
        }),
      )
      .when(props()?.motion === "native", (el) =>
        el.relative().child(
          div()
            .id("sidebar-native-clock")
            .absolute()
            .left(0)
            .top(0)
            .h(1)
            .w(this.drawers.sidebar.clockPx)
            .transition("width", { duration: 500, easing: "ease-in-out" as const })
            .on_size_change((size, cx) => this.drawers.sidebar.size(size, cx, this.drawerEnv())),
        ),
      );
  }

  render(cx: AsyncContext): NativeElement {
    const overlay = this.renderOverlay(cx);
    if (overlay) return overlay;
    const currentPage = find(layoutTree(), "main")?.active;
    const requestedPage = this.settlePageRequest(currentPage);
    this.syncTabsHeight();
    this.syncSettingsSidebar(cx, requestedPage === "main-agents");
    if (requestedPage === "main-agents") this.closePanelForSettings(cx);
    const frame = this.frameForPage(cx, currentPage);
    const base = h_flex().size_full().min_w(0);
    if (frame) base.pl(frame.leftPad).gap(0).items_center().bg(frame.bar);
    const header = this.sidebarClock(base);
    if (!frame) return this.settingsHeader(header);
    const row = addSidebarToggle(this.headerSurface(header, frame), this, frame);
    return addEndControls(addTabTrack(row, this, frame), this, frame);
  }

  renderOverlay(cx: AsyncContext): NativeElement | null {
    const p = props();
    if (this.isDialog || p?.confirmClose) return this.renderConfirmDialog(cx);
    if (this.isDropOverlay || p?.drop) return this.renderDrop();
    return null;
  }

  settlePageRequest(currentPage: string | null | undefined): string | null | undefined {
    if (this.settingsPageRequest?.page === currentPage) this.settingsPageRequest = null;
    return this.settingsPageRequest?.page ?? currentPage;
  }

  syncTabsHeight(): void {
    const tabs = find(layoutTree(), "tabs");
    if (tabs && tabs.size?.px !== SETTINGS_HEADER_HEIGHT)
      run("layout.resize", { id: "tabs", px: SETTINGS_HEADER_HEIGHT });
  }

  frameForPage(cx: AsyncContext, currentPage: string | null | undefined): Frame | undefined {
    if (currentPage === "main-agents") {
      this.wantToggle = 0;
      this.wantPanelToggle = 0;
      return undefined;
    }
    if (currentPage) this.lastAppPage = currentPage;
    this.applyTabAction(cx);
    return this.stripFrame(cx);
  }

  requestSettingsPage(page: string, cx: Context): void {
    this.settingsPageRequest = { page, sent: false };
    cx.notify();
  }

  closePanelForSettings(cx: AsyncContext): void {
    const panel = find(layoutTree(), "panel");
    if (!panel || panel.hidden || this.drawers.panel.busy) return;
    this.togglePanelNative(cx);
  }

  selectRequestedSettingsPage(): void {
    const request = this.settingsPageRequest;
    if (!request || request.sent) return;
    request.sent = true;
    run("layout.select", { stack: "main", child: request.page });
  }

  finishSettings(open: boolean): void {
    if (open) this.showSettingsNav(false);
    else setShared("left-sidebar.settingsPrior", null);
    this.selectRequestedSettingsPage();
    if (shared("left-sidebar.settingsAnchor")) setShared("left-sidebar.settingsAnchor", null);
  }

  syncSettingsSidebar(cx: AsyncContext, open: boolean): void {
    const sidebar = find(layoutTree(), "left-sidebar");
    const prior = shared("left-sidebar.settingsPrior") as Flag | null | undefined;
    const drawer = this.drawers.sidebar;
    const wide =
      (shared("left-sidebar.openPx") as number | undefined) || drawer.openPx || drawer.defaultOpen;
    const plan = settingsSidebarPlan({
      open,
      prior,
      sidebar,
      busy: drawer.busy,
      zoom: zoomOf(),
      wide,
    });
    if (!plan) {
      if (!drawer.busy) this.idleSettingsSidebar(open, prior, sidebar);
      return;
    }
    if (open && plan.flag !== prior) setShared("left-sidebar.settingsPrior", plan.flag);
    const collapsed = isCollapsed(sidebar);
    if (!open || collapsed) this.showSettingsNav(!open);
    if (plan.resize == null) {
      this.finishSettings(open);
      return;
    }
    this.moveSettingsSidebar(cx, open, plan, plan.resize, { sidebar, prior, wide });
  }

  idleSettingsSidebar(
    open: boolean,
    prior: Flag | null | undefined,
    sidebar: LayoutNode | null | undefined,
  ): void {
    if (open && prior && !sidebar?.hidden) this.showSettingsNav(false);
    this.selectRequestedSettingsPage();
    if (shared("left-sidebar.settingsAnchor")) setShared("left-sidebar.settingsAnchor", null);
  }

  moveSettingsSidebar(
    cx: AsyncContext,
    open: boolean,
    plan: SidebarPlan,
    resize: number,
    {
      sidebar,
      prior,
      wide,
    }: { sidebar: LayoutNode | null | undefined; prior: Flag | null | undefined; wide: number },
  ): void {
    const restore = (open ? plan.flag?.px : prior?.px) ?? wide;
    this.drawers.sidebar.openPx = restore;
    if (shared("left-sidebar.openPx") !== restore) setShared("left-sidebar.openPx", restore);
    const from = settingsFrom(sidebar, restore);
    if (settingsSettled(resize, sidebar, from)) return this.finishSettings(open);
    const target = resize / restore;
    if (props()?.motion === "native") {
      this.moveSettingsNative(cx, open, resize, { sidebar, restore, target, from });
      return;
    }
    this.startSidebarMotion(cx, { open: restore, target, from: from / restore }, () => {
      setShared("left-sidebar.collapsed", target === 0);
      this.finishSettings(open);
    });
  }

  moveSettingsNative(
    cx: AsyncContext,
    open: boolean,
    resize: number,
    {
      sidebar,
      restore,
      target,
      from,
    }: { sidebar: LayoutNode | null | undefined; restore: number; target: number; from: number },
  ): void {
    const drawer = this.drawers.sidebar;
    const zoom = zoomOf();
    const full = this.nativeHeaderWidth / zoom;
    const current = visibleSize(sidebar, 0);
    const left = open ? resize : current;
    const width = settingsHoldPx({ full, sidebar: left });
    if (width != null) setShared("left-sidebar.settingsAnchor", { left, width });
    const hold =
      props()?.pinSidebarTerminal && !this.nativePinned
        ? settingsHoldPx({ full, sidebar: open ? left : Math.min(current, resize) })
        : null;
    drawer.clockPx = from / zoom;
    drawer.move(cx, this.drawerEnv(), {
      node: sidebar,
      open: restore,
      target,
      pin: hold,
      before:
        open && this.settingsPageRequest ? () => this.selectRequestedSettingsPage() : undefined,
      after: () => this.finishSettings(open),
    });
  }

  showSettingsNav(show: boolean): void {
    const nav = find(layoutTree(), "nav-top");
    if (!nav || Boolean(nav.hidden) !== show || this.navAsked === show) return;
    this.navAsked = show;
    run(show ? "layout.show" : "layout.hide", { id: nav.id });
  }

  settingsHeader(header: NativeElement): NativeElement {
    const t = headerTheme();
    const desiredLeft = this.settingsPillPosition();
    const back = this.settingsBack(t);
    const w: WindowState = herdrWindow() ?? this.windowState ?? {};
    return header
      .relative()
      .items_center()
      .justify_center()
      .bg(t.surface)
      .child(
        desiredLeft == null
          ? back
          : div().absolute().left(desiredLeft).top(SETTINGS_BUTTON_INSET).child(back),
      )
      .when(Boolean(w.platform && w.platform !== "macos"), (el) =>
        el.child(this.settingsWindowControls(w, t)),
      );
  }

  settingsPillPosition(): number | null {
    const root = layoutTree();
    const panel = find(root, "panel");
    const zoom = zoomOf();
    const vp = globalWindow()?.viewport_size();
    const left = 0;
    const right = panel ? this.settingsRailWidth(panel, 350, zoom) : 0;
    return settingsPillLeft(vp?.width, left, right, 112);
  }

  settingsRailWidth(rail: LayoutNode, fallback: number, zoom: number): number {
    if (rail.hidden) return 0;
    return (rail.size?.px ?? fallback) / zoom;
  }

  settingsBack(t: HeaderTheme): NativeElement {
    return h_flex()
      .id("agent-settings-back")
      .h(SETTINGS_BUTTON_HEIGHT)
      .w(112)
      .flex_none()
      .items_center()
      .justify_center()
      .gap(5)
      .rounded_full()
      .border_1()
      .border_color(t.border)
      .bg(t.raised)
      .text_color(t.foreground)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .role("button")
      .accessibility_label("Back to app")
      .on_mouse_down("left", (_e, eventCx) => eventCx.stop_propagation())
      .on_click((_e, eventCx) => {
        this.returnToApp(eventCx);
      })
      .child(svg("mods/orca-assets/chevron-left--orca-header.svg").size(13))
      .child(div().text_size(12).child("Back to app"));
  }

  returnToApp(cx: Context): void {
    const active = (spaces() ?? []).find((s) => s.active);
    const target = settingsReturnPage(
      this.lastAppPage,
      find(layoutTree(), "main")?.children,
      active,
    );
    this.landing = active?.tabs?.length ? "main-terminals" : "main-landing";
    this.requestSettingsPage(target, cx);
  }

  settingsWindowControls(w: WindowState, t: HeaderTheme): NativeElement {
    const winControl = (
      id: string,
      label: string,
      glyph: string,
      action: () => unknown,
    ): NativeElement =>
      div()
        .id(id)
        .w(46)
        .h_full()
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .text_color(t.muted)
        .hover((s) => s.bg(t.hover))
        .role("button")
        .accessibility_label(label)
        .tooltip(label)
        .on_mouse_down("left", (_e, eventCx) => eventCx.stop_propagation())
        .on_click(() => {
          action();
        })
        .child(svg(glyph).size(10));
    return h_flex()
      .absolute()
      .right(0)
      .top(0)
      .bottom(0)
      .items_center()
      .child(
        winControl("minimize", "Minimize", "mods/orca-assets/win-min.svg", () =>
          run("window.minimize"),
        ),
      )
      .child(
        winControl(
          "maximize",
          "Maximize",
          w.maximized ? "mods/orca-assets/win-restore.svg" : "mods/orca-assets/win-max.svg",
          () => run("window.maximize"),
        ),
      )
      .child(
        winControl("close-window", "Close window", "mods/orca-assets/win-close.svg", () =>
          run("window.close"),
        ),
      );
  }

  currentWindow(): WindowState {
    const live = herdrWindow();
    if (live) this.windowState = live;
    return live ?? this.windowState ?? {};
  }

  stripFrame(cx: AsyncContext): Frame {
    const t = headerTheme();
    const bar = t.surface;
    const space = (spaces() ?? []).find((candidate) => candidate.active);
    const shown = space?.tabs ?? [];
    const tabPanes = selectTabPanes(panes() ?? []);
    const unofficialPanes = unofficialByTerminal(terminals() ?? []);
    const geometry = this.stripGeometry(shown);
    const root = layoutTree();
    const sidebar = find(root, "left-sidebar");
    this.recoverMainWidth(root, cx);
    const w = this.currentWindow();
    const leftPad = trafficLightPadding(root, w);
    const zoomK = zoomOf();
    const toggleRightX = toggleLeft(w) + 36;
    const sbPx = scaledWidth(sidebar, 0, zoomK);
    const gapToCard = Math.max(sbPx, toggleRightX) - sbPx;
    const flushable = (c: TabInfo, i: number) =>
      c.active && i === 0 && !geometry.arrows.hasOverflow && this.scrollX <= 0;
    const panel = find(root, "panel");
    this.syncChrome(cx, { space, sidebar, panel, body: find(root, "panel-body"), zoomK });
    return {
      t,
      bar,
      leftPad,
      sidebar,
      panel,
      zoomK,
      w,
      paneDrag: shared("orca-header.pane-drag") as Frame["paneDrag"],
      shown,
      space: space as SpaceInfo,
      geometry,
      tabPanes,
      unofficialPanes,
      gapToCard,
      flushable,
    };
  }

  syncChrome(
    cx: AsyncContext,
    {
      space,
      sidebar,
      panel,
      body,
      zoomK,
    }: {
      space: SpaceInfo | undefined;
      sidebar: LayoutNode | null | undefined;
      panel: LayoutNode | null | undefined;
      body: LayoutNode | null | undefined;
      zoomK: number;
    },
  ): void {
    this.syncSidebarToggle(cx, sidebar);
    this.syncPanelToggle(cx, panel, zoomK);
    const enabled = [
      ...((shared("workspace.panels") as string[] | undefined) ?? ["files", "changes"]),
    ];
    this.syncPanel(space, panel, body, enabled);
    this.syncLanding(cx);
    if (!this.drawers.sidebar.busy)
      this.drawers.sidebar.clockPx = (sidebar?.hidden ? 1 : (sidebar?.size?.px ?? 259)) / zoomK;
  }
}
