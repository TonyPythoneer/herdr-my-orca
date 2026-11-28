import {
  View,
  div,
  svg,
  type AbsoluteLength,
  type AsyncContext,
  type ClickEvent,
  type Color,
  type Context,
  type Length,
  type NativeElement,
  type Point,
  type Task,
} from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
  panes,
  props,
  run,
  openOverlay,
  closeOverlay,
  spaces,
  setShared,
  settings,
  terminals,
  theme,
  type OverlaySpec,
  type PaneInfo,
} from "herdr";
import { IconButton } from "../../primitives/icon-button.js";
import {
  crewOf,
  crewGroups,
  crewMembers,
  crewSignature,
  type Crew,
  type CrewStatus,
  type TerminalInfo,
} from "./crew.js";
import { ASSET_DIR, statusMark, agentMark, type StatusPalette } from "./status.js";
import { themeColor } from "../../shared/theme-color.js";

const pointerOf = (host: object): Point | null =>
  Reflect.apply(Reflect.get(host, "mouse_position"), host, []);

const GROUP_WORD: Record<CrewStatus, string> = {
  blocked: "need you",
  working: "working",
  done: "done",
  idle: "idle",
};

const titleOf = (m: TerminalInfo): string =>
  m.title?.trim() || m.report?.app || m.program?.name || m.address;

const CREW_POLL_MS = 1000;
const DRAG_POLL_MS = 16;
const DRAG_START_PX = 8;
const DRAG_STILL_TICKS = 15;
const TAB_STRIP_HEIGHT = 48;
const STACK_SHOWN = 3;
const PANE_HEADER_DIR = "mods/orca-pane-header";
const POPUP = "popup";
const BUTTON_ROLE = "button";
const SPLIT_RIGHT_LABEL = "Split terminal right";
const MOUSE = { left: "left", right: "right" } as const;
const DIRECTION = { right: "right", down: "down" } as const;
const PANE_HEADER_MOD = "orca-pane-header";
const CONTEXT_MENU_MOD = "orca-context-menu";
const DRAG_STATE_KEY = "orca-header.pane-drag";
const ACTION_KEY = "orca-header.action";
const UNSPLIT_TO_TAB = "unsplit-to-tab";
const RUN = {
  focusPane: "pane.focus",
  splitPane: "pane.split",
  closePane: "pane.close",
  closeTab: "tab.close",
  focusAgent: "agent.focus",
} as const;
const PALETTE = {
  header: "#141416",
  focusedBorder: "#ffffff24",
  border: "#ffffff0f",
  titleFocused: "#222226",
  title: "#19191c",
  titleBorder: "#ffffff0d",
  caret: "#8a8a93",
  faint: "#ffffff4d",
  soft: "#ffffffcc",
  ghost: "#ffffff14",
  chip: "#ffffff0a",
  white: "#ffffff",
  muted: "#a1a1aa",
  danger: "#ef4444",
  grip: "#ffffff66",
  crewRowHover: "#4040402e",
} as const;
const paneHeaderIcon = (name: string): string => `${ASSET_DIR}/${name}--orca-pane-header.svg`;
const ICON = {
  workflow: paneHeaderIcon("workflow"),
  close: paneHeaderIcon("x"),
  plus: paneHeaderIcon("plus"),
};

type PaneProps = { pane?: string; overlay?: string };
type PaneTheme = StatusPalette & {
  surface: Color;
  background: Color;
  foreground: Color;
  border: Color;
  hover: Color;
  dim: Color;
  muted: Color;
};
type DragStart = { x: number; y: number; pane: string; terminal: string | null; time: number };
type IconStyle = { id: string; size: Length; radius: AbsoluteLength; glyph: Length };
const paneProps = (): PaneProps => props() ?? {};
const themeColors = (): PaneTheme => {
  const t = theme();
  return {
    blocked: themeColor(t.blocked),
    working: themeColor(t.working),
    done: themeColor(t.done),
    idle: themeColor(t.idle),
    surface: themeColor(t.surface),
    background: themeColor(t.background),
    foreground: themeColor(t.foreground),
    border: themeColor(t.border),
    hover: themeColor(t.hover),
    dim: themeColor(t.dim),
    muted: themeColor(t.muted),
  };
};
const zoomLevel = (): number => Number(settings().zoom || 1);

function cancelQuietly(timer: Task): void {
  try {
    timer.cancel();
  } catch {}
}

function pointerAt(): Point | null;
function pointerAt(fallback: Point): Point;
function pointerAt(fallback: Point | null = null): Point | null {
  return typeof window !== "undefined" ? pointerOf(window) : fallback;
}
const stripBottom = (): number => TAB_STRIP_HEIGHT * zoomLevel();
const paneMenu = (pane: string, terminal: string | null): OverlaySpec => ({
  mod: CONTEXT_MENU_MOD,
  kind: POPUP,
  width: 240,
  props: { tab: "pane", target: { pane, terminal } },
});

const terminalList = (): TerminalInfo[] => terminals() as unknown as TerminalInfo[];

export default class Pane extends View {
  hovered = false;
  dragStart: DragStart | null = null;
  isDragging = false;
  pollTimer: Task | null = null;
  lastPos: Point | null = null;
  still = 0;

  crew: Crew = { managing: [], managedBy: null };
  crewSeen = "";

  init(_props: unknown, cx: AsyncContext): void {
    this.hovered = false;
    this.dragStart = null;
    this.isDragging = false;
    this.pollTimer = null;
    this.lastPos = null;
    this.still = 0;

    this.crew = { managing: [], managedBy: null };
    this.crewSeen = "";
    const read = (): void => {
      this.crew = crewOf(terminalList(), this.crewAddress());
    };
    read();
    this.crewSeen = crewSignature(this.crew);
    cx.timer.every(CREW_POLL_MS, (tickCx) => {
      const before = this.crewSeen;
      read();
      this.crewSeen = crewSignature(this.crew);
      if (this.crewSeen !== before) tickCx.notify();
    });

    if (paneProps().overlay) {
      cx.timer.every(CREW_POLL_MS, () => {
        const overlay = paneProps().overlay;
        if (this.crewPaneGone() && overlay) closeOverlay(overlay);
      });
    }
  }

  crewPaneId(): string | undefined {
    return paneProps().pane ?? panes().find((x) => x.focused)?.pane;
  }

  crewAddress(): string | null {
    return panes().find((x) => x.pane === this.crewPaneId())?.terminal ?? null;
  }

  crewPaneGone(): boolean {
    const p = panes().find((x) => x.pane === this.crewPaneId());
    if (!p) return true;
    const space = spaces().find((s) => s.tabs.some((t) => t.id === p.tab));
    return !space?.tabs.find((t) => t.id === p.tab)?.active;
  }

  me(): PaneInfo | undefined {
    return panes().find((p) => p.pane === paneProps().pane);
  }

  startPaneDrag(pos: Point, pane: string, terminal: string | null, cx: AsyncContext): void {
    this.dragStart = {
      x: pos.x,
      y: pos.y,
      pane,
      terminal,
      time: Date.now(),
    };
    this.isDragging = false;
    this.still = 0;
    this.lastPos = { x: pos.x, y: pos.y };
    this.stopPollTimer();
    this.pollTimer = cx.timer.every(DRAG_POLL_MS, (tickCx) => this.pollPaneDrag(tickCx));
  }

  stopPollTimer(): void {
    if (!this.pollTimer) return;
    cancelQuietly(this.pollTimer);
    this.pollTimer = null;
  }

  pollPaneDrag(cx: Context): void {
    if (!this.dragStart) {
      this.stopPollTimer();
      return;
    }
    const at = pointerAt();
    if (!at) return;
    const dist = Math.hypot(at.x - this.dragStart.x, at.y - this.dragStart.y);
    if (!this.isDragging && dist >= DRAG_START_PX) this.isDragging = true;
    if (!this.isDragging) return;

    setShared(DRAG_STATE_KEY, {
      active: true,
      pane: this.dragStart.pane,
      terminal: this.dragStart.terminal,
      x: at.x,
      y: at.y,
      inTabStrip: at.y <= stripBottom(),
    });

    const moved = !this.lastPos || this.lastPos.x !== at.x || this.lastPos.y !== at.y;
    this.lastPos = { x: at.x, y: at.y };
    this.still = moved ? 0 : (this.still ?? 0) + 1;

    if (this.still >= DRAG_STILL_TICKS) this.finishPaneDrag(at, cx);
  }

  finishPaneDrag(at: Point, cx: Context): void {
    const drag = this.dragStart;
    this.dragStart = null;
    this.isDragging = false;
    this.still = 0;
    this.lastPos = null;
    this.stopPollTimer();
    setShared(DRAG_STATE_KEY, null);

    if (!drag) return;

    if (at.y <= stripBottom()) {
      setShared(ACTION_KEY, {
        kind: UNSPLIT_TO_TAB,
        terminal: drag.terminal,
        pane: drag.pane,
        dropX: at.x,
      });
      cx.notify();
    }
  }

  endPaneDrag(pos: Point, pane: string, terminal: string | null, cx: Context): void {
    if (!this.dragStart) return;
    const wasDragging = this.isDragging;
    this.finishPaneDrag(pointerAt(pos), cx);

    if (!wasDragging) openOverlay(paneMenu(pane, terminal));
  }

  openPaneMenu(pane: string, terminal: string | null): void {
    run(RUN.focusPane, { pane });
    openOverlay(paneMenu(pane, terminal));
  }

  button(
    id: string,
    label: string,
    icon: string,
    action: string | ((cx: Context) => void),
    args?: Record<string, unknown>,
  ): NativeElement {
    return IconButton(id, label, svg(sharedAsset(`${PANE_HEADER_DIR}/${icon}.svg`)).size(12), {
      t: themeColors(),
      size: 24,
      radius: 6,
      tooltip: label,
      color: PALETTE.faint,
      hoverBg: null,
      hoverFg: PALETTE.soft,
      onClick: (_e: ClickEvent, cx: Context) => {
        cx.stop_propagation();
        if (typeof action === "function") action(cx);
        else run(action, args);
      },
    });
  }

  crewChip(pane: string, t: PaneTheme): NativeElement {
    const groups = crewGroups(this.crew);
    const label = groups.map((g) => `${g.members.length} ${GROUP_WORD[g.status]}`).join(", ");
    return h_flex()
      .id(`pane-crew-${pane}`)
      .h(22)
      .px(5)
      .gap(4)
      .items_center()
      .flex_none()
      .rounded(4)
      .border_1()
      .border_color(PALETTE.ghost)
      .bg(PALETTE.chip)
      .text_color(PALETTE.muted)
      .hover((s) => s.bg(PALETTE.ghost).text_color(PALETTE.white))
      .cursor_pointer()
      .tooltip(`Orchestration: ${label}`)
      .role(BUTTON_ROLE)
      .accessibility_label(`Show orchestration: ${label}`)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: PANE_HEADER_MOD, kind: POPUP, width: 300, props: { pane } });
      })
      .child(svg(ICON.workflow).size(12).flex_none())

      .when(this.crew.managing.length > 0, (el) =>
        el.child(div().text_size(11).child(String(this.crew.managing.length))),
      )
      .children(
        groups.map((g) =>
          h_flex()
            .gap(2)
            .items_center()
            .flex_none()
            .child(statusMark(g.status, 12, t))
            .child(this.agentStack(g.members, t)),
        ),
      );
  }

  agentStack(members: TerminalInfo[], t: PaneTheme): NativeElement {
    const shown = members.slice(0, STACK_SHOWN);
    return h_flex()
      .items_center()
      .flex_none()
      .children(
        shown.map((m, i) => {
          const mark = agentMark(m, 13, t);
          const slot = div()
            .size(16)
            .rounded_full()
            .flex()
            .items_center()
            .justify_center()
            .bg(t.surface)
            .when(i > 0, (el) => el.ml(-6));
          return mark ? slot.child(mark) : slot;
        }),
      )
      .when(members.length > shown.length, (el) =>
        el.child(
          div()
            .ml(2)
            .text_size(10)
            .text_color(t.muted)
            .child(`+${members.length - shown.length}`),
        ),
      );
  }

  crewCard(): NativeElement {
    if (this.crewPaneGone()) {
      const overlay = paneProps().overlay;
      if (overlay) closeOverlay(overlay);
      return div();
    }
    const t = themeColors();
    const crew = this.crew;
    const allSections: Array<[string, TerminalInfo[]]> = [
      ["Managing", crew.managing],
      ["Managed by", crew.managedBy ? [crew.managedBy] : []],
    ];
    const sections = allSections.filter(([, rows]) => rows.length > 0);

    return v_flex()
      .id("orca-crew-card")
      .w_full()
      .bg(t.surface)
      .text_color(t.foreground)
      .child(
        h_flex()
          .h(36)
          .flex_none()
          .px(12)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .child(div().text_size(12).font_medium().child("Orchestration")),
      )
      .children(
        sections.map(([title, rows]) =>
          v_flex()
            .pt(12)
            .pb(6)
            .child(
              h_flex()
                .px(12)
                .pb(6)
                .gap(6)
                .items_center()
                .child(
                  div()
                    .text_size(10)
                    .font_semibold()
                    .text_color(t.muted)
                    .child(title.toUpperCase()),
                )
                .child(
                  div()
                    .text_size(10)
                    .font_semibold()
                    .text_color(t.muted)
                    .child(String(rows.length)),
                ),
            )
            .children(rows.map((m) => this.crewRow(m, t))),
        ),
      );
  }

  crewRow(m: TerminalInfo, t: PaneTheme): NativeElement {
    const mark = agentMark(m, 13, t);
    const row = h_flex()
      .id(`crew-row-${m.address}`)
      .h(24)
      .w_full()
      .pl(12)
      .pr(6)
      .gap(4)
      .items_center()
      .cursor_pointer()
      .hover((s) => s.bg(PALETTE.crewRowHover))
      .role(BUTTON_ROLE)
      .accessibility_label(`${titleOf(m)} - ${m.status}`)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(RUN.focusAgent, { terminal: m.address });
        const overlay = paneProps().overlay;
        if (overlay) closeOverlay(overlay);
      })
      .child(statusMark(m.status, 12, t));
    return (mark ? row.child(mark) : row).child(
      div().min_w(0).flex_1().truncate().text_size(12).child(titleOf(m)),
    );
  }

  render(_cx: Context): NativeElement {
    if (paneProps().overlay) return this.crewCard();

    const p = this.me();
    if (!p) return div();
    const pane = p.pane;
    const tab = spaces()
      .flatMap((s) => s.tabs)
      .find((t) => t.id === p.tab);
    const tabTitle = tab && tab.named ? tab.name : p.title;
    const isFocused = Boolean(p.focused);
    const paneCount = panes().filter((x) => x.tab === p.tab).length;

    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .h(32)
      .px(6)
      .items_center()
      .relative()
      .bg(PALETTE.header)
      .border_b(1)
      .border_color(isFocused ? PALETTE.focusedBorder : PALETTE.border)
      .when(!isFocused, (el) => el.opacity(0.95))
      .text_size(12)
      .font_family("JetBrains Mono")
      .on_hover((hovered, hoverCx) => {
        this.hovered = hovered;
        hoverCx.notify();
      })
      .on_click(() => run(RUN.focusPane, { pane }))

      .on_mouse_down(MOUSE.right, (_e, downCx) => {
        downCx.stop_propagation();
        this.openPaneMenu(pane, p.terminal);
      })

      .child(this.titleCluster(p, tabTitle, isFocused, paneCount))

      .child(this.dragHandle(p, paneCount))

      .child(this.actionCluster(p, isFocused, paneCount));
  }

  closeButton(
    p: PaneInfo,
    paneCount: number,
    { id, size, radius, glyph }: IconStyle,
  ): NativeElement {
    const label = paneCount > 1 ? "Close pane" : "Close tab";
    return IconButton(id, label, svg(ICON.close).size(glyph), {
      t: themeColors(),
      size,
      radius,
      tooltip: label,
      color: PALETTE.faint,
      hoverBg: PALETTE.ghost,
      hoverFg: PALETTE.danger,
      onClick: (_e, clickCx) => {
        clickCx.stop_propagation();
        run(
          paneCount > 1 ? RUN.closePane : RUN.closeTab,
          paneCount > 1 ? { pane: p.pane } : { id: p.tab },
        );
      },
    });
  }

  titleCluster(
    p: PaneInfo,
    tabTitle: string,
    isFocused: boolean,
    paneCount: number,
  ): NativeElement {
    return h_flex()
      .items_center()
      .gap(4)
      .child(
        h_flex()
          .h(26)
          .px(8)
          .gap(6)
          .items_center()
          .rounded(4)
          .bg(isFocused ? PALETTE.titleFocused : PALETTE.title)
          .border_1()
          .border_color(isFocused ? PALETTE.focusedBorder : PALETTE.titleBorder)
          .cursor_pointer()
          .child(div().text_size(11).text_color(PALETTE.caret).child(">"))
          .child(
            div()
              .max_w(180)
              .truncate()
              .text_size(12)
              .font_medium()
              .text_color(isFocused ? PALETTE.white : PALETTE.muted)
              .child(tabTitle || "terminal"),
          )
          .child(
            this.closeButton(p, paneCount, {
              id: `ph-x-title-${p.pane}`,
              size: 16,
              radius: 3,
              glyph: 10,
            }),
          ),
      )
      .child(
        div()
          .size(24)
          .flex()
          .items_center()
          .justify_center()
          .rounded(4)
          .text_color(PALETTE.faint)
          .hover((s) => s.text_color(PALETTE.soft).bg(PALETTE.ghost))
          .tooltip(SPLIT_RIGHT_LABEL)
          .on_click((_e, clickCx) => {
            clickCx.stop_propagation();
            run(RUN.splitPane, { direction: DIRECTION.right, pane: p.pane });
          })
          .child(svg(ICON.plus).size(12)),
      );
  }

  gripDots(): NativeElement {
    return div()
      .flex()
      .flex_col()
      .gap(3)
      .items_center()
      .children(
        [0, 1].map(() =>
          div()
            .flex()
            .gap(3)
            .children([0, 1, 2].map(() => div().size(2).rounded_full().bg(PALETTE.grip))),
        ),
      );
  }

  dragHandle(p: PaneInfo, paneCount: number): NativeElement {
    const pane = p.pane;
    return div()
      .flex_1()
      .h_full()
      .flex()
      .items_center()
      .justify_center()
      .cursor_grab()
      .active((s) => s.cursor_grabbing())
      .on_mouse_down(MOUSE.left, (e, downCx) => {
        this.startPaneDrag(e.position, pane, p.terminal, downCx);
      })
      .on_mouse_up(MOUSE.left, (e, upCx) => {
        if (this.isDragging) {
          upCx.stop_propagation();
          this.endPaneDrag(e.position, pane, p.terminal, upCx);
        } else {
          this.dragStart = null;
          this.stopPollTimer();
        }
      })
      .on_mouse_down(MOUSE.right, (_e, downCx) => {
        downCx.stop_propagation();
        this.openPaneMenu(pane, p.terminal);
      })
      .when(this.hovered && paneCount > 1, (el) => el.child(this.gripDots()));
  }

  actionCluster(p: PaneInfo, isFocused: boolean, paneCount: number): NativeElement {
    const pane = p.pane;
    return h_flex()
      .items_center()
      .gap(2)
      .when(!isFocused, (el) => el.opacity(0.6).hover((s) => s.opacity(1.0)))

      .when(crewMembers(this.crew).length > 0, (el) => el.child(this.crewChip(pane, themeColors())))

      .child(
        h_flex()
          .h(22)
          .px(6)
          .gap(4)
          .items_center()
          .rounded(4)
          .border_1()
          .border_color(PALETTE.ghost)
          .text_color(isFocused ? PALETTE.white : PALETTE.muted)
          .hover((s) => s.bg(PALETTE.ghost).text_color(PALETTE.white))
          .tooltip("Open pane commands")
          .on_click((_e, clickCx) => {
            clickCx.stop_propagation();
            this.openPaneMenu(pane, p.terminal);
          })
          .child(div().text_size(9).text_color(PALETTE.muted).child("▷"))
          .child(div().text_size(11).font_medium().child("Command")),
      )

      .child(
        this.button(`ph-m-${pane}`, "Pane actions", "ellipsis", () =>
          this.openPaneMenu(pane, p.terminal),
        ),
      )

      .child(
        this.button(`ph-r-${pane}`, SPLIT_RIGHT_LABEL, "square-split-vertical", RUN.splitPane, {
          direction: DIRECTION.right,
          pane,
        }),
      )
      .child(
        this.button(`ph-d-${pane}`, "Split terminal down", "split-down", RUN.splitPane, {
          direction: DIRECTION.down,
          pane,
        }),
      )

      .child(
        this.closeButton(p, paneCount, { id: `ph-x-${pane}`, size: 24, radius: 6, glyph: 12 }),
      );
  }
}

const SHARED_ASSET_PATHS: Readonly<Record<string, string>> = Object.freeze({
  [`${PANE_HEADER_DIR}/close.svg`]: paneHeaderIcon("close"),
  [`${PANE_HEADER_DIR}/ellipsis.svg`]: paneHeaderIcon("ellipsis"),
  [`${PANE_HEADER_DIR}/plus.svg`]: paneHeaderIcon("plus"),
  [`${PANE_HEADER_DIR}/workflow.svg`]: paneHeaderIcon("workflow"),
  [`${PANE_HEADER_DIR}/x.svg`]: paneHeaderIcon("x"),
});
function sharedAsset(path: string): string {
  return SHARED_ASSET_PATHS[path] ?? `${ASSET_DIR}/${path.slice(path.lastIndexOf("/") + 1)}`;
}
