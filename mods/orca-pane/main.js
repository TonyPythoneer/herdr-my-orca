// Derived from Herdr App's defaults/mods/pane/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "pane" } } } }
// Shows the pane's title, and on hover buttons that split and close this pane.
// Multi-pane drag to tab area ported from Orca: TerminalPaneHeaderOverlay.tsx:188-196,
// terminal.css:275-306, terminal-tab-strip-drop-target.ts:12-16, and use-terminal-pane-tab-detach-actions.ts:16-36,61-73.
// Props from the app: { pane, terminal }. Click: focus the pane.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { panes, props, run, openOverlay, closeOverlay, spaces, setShared, settings, terminals, theme } from "herdr";
import { crewOf, crewGroups, crewMembers, crewSignature } from "./crew.js";
import { statusMark, agentMark } from "./status.js";

// Orca's group words (`OrchestrationCrewPanel.tsx:50-56`): needsYou is Herdr's blocked.
const GROUP_WORD = { blocked: "need you", working: "working", done: "done", idle: "idle" };

// Row titles fall through title -> app -> program name, the same order orca-agents uses
// (`mods/orca-agents/main.js:22`; `report.app` is the terminal's app key).
const titleOf = (m) => m.title?.trim() || m.report?.app || m.program?.name || m.address;

const CREW_POLL_MS = 1000;
const DRAG_POLL_MS = 16; // one frame
const DRAG_START_PX = 8; // Orca's drag activation distance
const DRAG_STILL_TICKS = 15; // 15 ticks at 16ms = ~240ms of stillness
const TAB_STRIP_HEIGHT = 48; // the strip's bottom edge at zoom 1
const STACK_SHOWN = 3; // overlapping marks drawn per crew group

// A timer that has already ended may refuse a second cancel; there is nothing left to undo then.
function cancelQuietly(timer) {
  try { timer.cancel(); } catch { /* already ended */ }
}

// The pointer from the host, or `fallback` where there is no window (tests, headless).
const pointerAt = (fallback = null) => (typeof window !== "undefined" ? window.mouse_position() : fallback);
const stripBottom = () => TAB_STRIP_HEIGHT * (settings()?.zoom || 1);
const paneMenu = (pane, terminal) => ({ mod: "orca-menu", kind: "popup", width: 240, props: { tab: "pane", target: { pane, terminal } } });

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    this.dragStart = null;
    this.isDragging = false;
    this.pollTimer = null;
    this.lastPos = null;
    this.still = 0;

    // `terminals()` is live but does not notify a mod (the reason `orca-float` runs a timer);
    // recompute at 1s and repaint only when an address or status changed.
    this.crew = { managing: [], managedBy: null };
    this.crewSeen = "";
    const read = () => { this.crew = crewOf(terminals(), this.crewAddress()); };
    read();
    this.crewSeen = crewSignature(this.crew);
    cx.timer.every(CREW_POLL_MS, (tickCx) => {
      const before = this.crewSeen;
      read();
      this.crewSeen = crewSignature(this.crew);
      if (this.crewSeen !== before) tickCx.notify();
    });

    // Orca's card is a child of the pane's surface (`OrchestrationCrewPanel.tsx:266-278`), so a tab
    // switch takes it away. A Herdr popup is window-level; close it when its pane is gone or its
    // tab is no longer the one shown, or it would describe a pane that is not on screen.
    if (props()?.overlay) {
      cx.timer.every(CREW_POLL_MS, () => {
        if (this.crewPaneGone() && props()?.overlay) closeOverlay(props().overlay);
      });
    }
  }

  // A popup opened from `mod.open` carries no props, so it describes the focused pane; one opened
  // from a chip names its pane.
  crewPaneId() {
    return props()?.pane ?? panes().find((x) => x.focused)?.pane;
  }

  crewAddress() {
    return panes().find((x) => x.pane === this.crewPaneId())?.terminal ?? null;
  }

  crewPaneGone() {
    const p = panes().find((x) => x.pane === this.crewPaneId());
    if (!p) return true;
    const space = spaces().find((s) => s.tabs.some((t) => t.id === p.tab));
    return !space?.tabs.find((t) => t.id === p.tab)?.active;
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  // Orca: onBeginPaneDrag (TerminalPaneHeaderOverlay.tsx:188-196) & beginPaneDragFromPointerDown
  // (pane-drag-pointer.ts:12-100). Starts tracking the drag; if moved >= 8px towards the tab strip,
  // broadcasts drag state through shared store so orca-tabs shows the insertion indicator.
  startPaneDrag(pos, pane, terminal, cx) {
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

  stopPollTimer() {
    if (!this.pollTimer) return;
    cancelQuietly(this.pollTimer);
    this.pollTimer = null;
  }

  // One poll tick while a press is held: start the drag past the activation distance, then
  // broadcast where it is and infer the release from stillness.
  pollPaneDrag(cx) {
    if (!this.dragStart) {
      this.stopPollTimer();
      return;
    }
    const at = pointerAt();
    if (!at) return;
    const dist = Math.hypot(at.x - this.dragStart.x, at.y - this.dragStart.y);
    if (!this.isDragging && dist >= DRAG_START_PX) this.isDragging = true;
    if (!this.isDragging) return;

    // Tab strip is at y <= 48 * zoom (terminal-tab-strip-drop-target.ts:12-16 & use-terminal-pane-tab-detach-actions.ts:16-36).
    setShared("orca-tabs.pane-drag", {
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

    // Pointer stopped moving (inferred release since host provides no global mouse-up).
    if (this.still >= DRAG_STILL_TICKS) this.finishPaneDrag(at, cx);
  }

  // Orca: detachTerminalPaneToTab (terminal-pane-tab-detach.ts:40-58) & handleExternalPaneDrop
  // (use-terminal-pane-tab-detach-actions.ts:61-73). When released in the tab strip area (y <= 48 * zoom),
  // unsplit the pane into a new tab via terminal.park -> terminal.keep.
  finishPaneDrag(at, cx) {
    const drag = this.dragStart;
    this.dragStart = null;
    this.isDragging = false;
    this.still = 0;
    this.lastPos = null;
    this.stopPollTimer();
    setShared("orca-tabs.pane-drag", null);

    if (!drag) return;

    if (at.y <= stripBottom()) {
      setShared("orca-tabs.action", {
        kind: "unsplit-to-tab",
        terminal: drag.terminal,
        pane: drag.pane,
        dropX: at.x,
      });
      cx.notify();
    }
  }

  endPaneDrag(pos, pane, terminal, cx) {
    if (!this.dragStart) return;
    const wasDragging = this.isDragging;
    this.finishPaneDrag(pointerAt(pos), cx);

    // If mouse was released without dragging (< 8px), treat as a click to open orca-menu.
    if (!wasDragging) openOverlay(paneMenu(pane, terminal));
  }

  // The pane menu for this pane's header, after focusing the pane it belongs to.
  openPaneMenu(pane, terminal) {
    run("pane.focus", { pane });
    openOverlay(paneMenu(pane, terminal));
  }

  button(id, icon, action, args) {
    return div()
      .id(id)
      .size(24)
      .flex()
      .items_center()
      .justify_center()
      .rounded(6)
      // terminal.css:398,464: button fg rgb(255 255 255 / 0.3) → hover /0.8.
      .text_color("#ffffff4d")
      .hover((s) => s.text_color("#ffffffcc"))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (typeof action === "function") action(cx);
        else run(action, args);
      })
      .child(svg(`mods/orca-pane/${icon}.svg`).size(12));
  }

  // Orca's collapsed pill (`OrchestrationCrewPanel.tsx:344-380`): `Workflow` + the managing count,
  // then a status mark and a stack of agent marks per status group. Two pieces are dropped:
  // `PanelRight` and its divider (they read "open the right panel"; this opens a popup) and
  // `shadow-floating` (no shadow token in this theme).
  crewChip(pane, t) {
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
      .border_color("#ffffff14")
      .bg("#ffffff0a")
      .text_color("#a1a1aa")
      .hover((s) => s.bg("#ffffff14").text_color("#ffffff"))
      .cursor_pointer()
      .tooltip(`Orchestration: ${label}`)
      .role("button")
      .accessibility_label(`Show orchestration: ${label}`)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "orca-pane", kind: "popup", width: 300, props: { pane } });
      })
      .child(svg("mods/orca-pane/workflow.svg").size(12).flex_none())
      // OrchestrationCrewPanel.tsx:363-365: the count exists only when something is managed.
      .when(this.crew.managing.length > 0, (el) =>
        el.child(div().text_size(11).child(String(this.crew.managing.length))))
      .children(groups.map((g) => h_flex().gap(2).items_center().flex_none()
        .child(statusMark(g.status, 12, t))
        .child(this.agentStack(g.members, t))));
  }

  // `CrewAgentStack` (`CrewAgentIcons.tsx:186-215`): up to 3 overlapping 16px circles, a 13px
  // mark in each, `+N` for the rest of that group.
  agentStack(members, t) {
    const shown = members.slice(0, STACK_SHOWN);
    return h_flex().items_center().flex_none()
      .children(shown.map((m, i) => {
        const mark = agentMark(m, 13, t);
        return div().size(16).rounded_full().flex().items_center().justify_center()
          .bg(t.surface).when(i > 0, (el) => el.ml(-6))
          .when(Boolean(mark), (el) => el.child(mark));
      }))
      .when(members.length > shown.length, (el) =>
        el.child(div().ml(2).text_size(10).text_color(t.muted).child(`+${members.length - shown.length}`)));
  }

  // Orca's expanded card (`OrchestrationCrewPanel.tsx:284-330`): 36px title, one section per
  // relation with an uppercase count, then lean rows. Row previews, the collapse button and the
  // per-row menus are dropped: Herdr has no task or question text, closing the popup is the
  // collapse, and focus is the only row action.
  crewCard() {
    if (this.crewPaneGone()) {
      if (props()?.overlay) closeOverlay(props().overlay);
      return div();
    }
    const t = theme();
    const crew = this.crew;
    const sections = [
      ["Managing", crew.managing],
      ["Managed by", crew.managedBy ? [crew.managedBy] : []],
    ].filter(([, rows]) => rows.length > 0);

    return v_flex()
      .id("orca-crew-card")
      .w_full()
      .bg(t.surface)
      .text_color(t.foreground)
      .child(h_flex().h(36).flex_none().px(12).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(12).font_medium().child("Orchestration")))
      .children(sections.map(([title, rows]) =>
        v_flex().pt(12).pb(6)
          .child(h_flex().px(12).pb(6).gap(6).items_center()
            .child(div().text_size(10).font_semibold().text_color(t.muted).child(title.toUpperCase()))
            .child(div().text_size(10).font_semibold().text_color(t.muted).child(String(rows.length))))
          .children(rows.map((m) => this.crewRow(m, t)))));
  }

  crewRow(m, t) {
    const mark = agentMark(m, 13, t);
    return h_flex()
      .id(`crew-row-${m.address}`)
      .h(24)
      .w_full()
      .pl(12)
      .pr(6)
      .gap(4)
      .items_center()
      .cursor_pointer()
      .hover((s) => s.bg("#4040402e"))
      .role("button")
      .accessibility_label(`${titleOf(m)} - ${m.status}`)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run("agent.focus", { terminal: m.address });
        if (props()?.overlay) closeOverlay(props().overlay);
      })
      .child(statusMark(m.status, 12, t))
      .when(Boolean(mark), (el) => el.child(mark))
      .child(div().min_w(0).flex_1().truncate().text_size(12).child(titleOf(m)));
  }

  render() {
    // The popup instance of this mod: its render is the crew list, not a header.
    if (props()?.overlay) return this.crewCard();

    const p = this.me();
    if (!p) return div();
    const pane = p.pane;
    const tab = spaces().flatMap((s) => s.tabs).find((t) => t.id === p.tab);
    const tabTitle = tab && tab.named ? tab.name : p.title;
    const isFocused = Boolean(p.focused);
    const paneCount = panes().filter((x) => x.tab === p.tab).length;

    // TabGroupPanel.tsx:281-315: attached split tab strip is h-[32px] shrink-0 border-b border-border bg-tab-bar.
    // split-group-dim.ts:1 UNFOCUSED_SPLIT_GROUP_OPACITY = 0.95.
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .h(32)
      .px(6)
      .items_center()
      .relative()
      .bg("#141416")
      .border_b(1)
      .border_color(isFocused ? "#ffffff24" : "#ffffff0f")
      .when(!isFocused, (el) => el.opacity(0.95))
      .text_size(12)
      .font_family("JetBrains Mono")
      .on_hover((hovered, hoverCx) => { this.hovered = hovered; hoverCx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      // TerminalPaneHeaderOverlay.tsx:149 onContextMenuCapture={(e) => onPaneTitleContextMenu(e, pane.id)}
      .on_mouse_down("right", (_e, downCx) => {
        downCx.stop_propagation();
        this.openPaneMenu(pane, p.terminal);
      })
      // TabGroupPanel.tsx:288-301: Left side renders TabBar items (tab pill + add button)
      .child(this.titleCluster(p, tabTitle, isFocused, paneCount))
      // Center area: draggable handle for unsplitting to tab strip (terminal-tab-strip-drop-target.ts:12-16)
      .child(this.dragHandle(p, paneCount))
      // TabGroupPanel.tsx:302-314: Right action chrome (TabBarQuickCommandsButton + TabGroupPaneActionsMenu + split controls)
      .child(this.actionCluster(p, isFocused, paneCount));
  }

  // The close control, as "Close pane" while the tab is split and "Close tab" when it is alone.
  // TerminalPaneHeaderOverlay.tsx:125-131: terminalPaneCloseLabel(paneCount)
  closeButton(p, paneCount, { id, size, radius, glyph }) {
    const button = id ? div().id(id) : div();
    return button
      .size(size)
      .flex()
      .items_center()
      .justify_center()
      .rounded(radius)
      .text_color("#ffffff4d")
      .hover((s) => s.text_color("#ef4444").bg("#ffffff14"))
      .tooltip(paneCount > 1 ? "Close pane" : "Close tab")
      .on_click((_e, clickCx) => {
        clickCx.stop_propagation();
        run(paneCount > 1 ? "pane.close" : "tab.close", paneCount > 1 ? { pane: p.pane } : { id: p.tab });
      })
      .child(svg("mods/orca-pane/x.svg").size(glyph));
  }

  titleCluster(p, tabTitle, isFocused, paneCount) {
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
          .bg(isFocused ? "#222226" : "#19191c")
          .border_1()
          .border_color(isFocused ? "#ffffff24" : "#ffffff0d")
          .cursor_pointer()
          .child(div().text_size(11).text_color("#8a8a93").child(">"))
          .child(div().max_w(180).truncate().text_size(12).font_medium().text_color(isFocused ? "#ffffff" : "#a1a1aa").child(tabTitle || "terminal"))
          .child(this.closeButton(p, paneCount, { size: 16, radius: 3, glyph: 10 }))
      )
      .child(
        div()
          .size(24)
          .flex()
          .items_center()
          .justify_center()
          .rounded(4)
          .text_color("#ffffff4d")
          .hover((s) => s.text_color("#ffffffcc").bg("#ffffff14"))
          .tooltip("Split terminal right")
          .on_click((_e, clickCx) => {
            clickCx.stop_propagation();
            run("pane.split", { direction: "right", pane: p.pane });
          })
          .child(svg("mods/orca-pane/plus.svg").size(12))
      );
  }

  // Two rows of three dots, shown while the pointer is over a split pane's handle.
  gripDots() {
    return div()
      .flex()
      .flex_col()
      .gap(3)
      .items_center()
      .children([0, 1].map(() =>
        div()
          .flex()
          .gap(3)
          .children([0, 1, 2].map(() =>
            div().size(2).rounded_full().bg("#ffffff66")
          ))
      ));
  }

  dragHandle(p, paneCount) {
    const pane = p.pane;
    return div()
      .flex_1()
      .h_full()
      .flex()
      .items_center()
      .justify_center()
      .cursor_grab()
      .active((s) => s.cursor_grabbing())
      .on_mouse_down("left", (e, downCx) => {
        this.startPaneDrag(e.position, pane, p.terminal, downCx);
      })
      .on_mouse_up("left", (e, upCx) => {
        if (this.isDragging) {
          upCx.stop_propagation();
          this.endPaneDrag(e.position, pane, p.terminal, upCx);
        } else {
          this.dragStart = null;
          this.stopPollTimer();
        }
      })
      .on_mouse_down("right", (_e, downCx) => {
        downCx.stop_propagation();
        this.openPaneMenu(pane, p.terminal);
      })
      .when(this.hovered && paneCount > 1, (el) => el.child(this.gripDots()));
  }

  actionCluster(p, isFocused, paneCount) {
    const pane = p.pane;
    return h_flex()
      .items_center()
      .gap(2)
      .when(!isFocused, (el) => el.opacity(0.6).hover((s) => s.opacity(1.0)))
      // Placement is ours: Orca's pill rides the pane's right corner
      // (`OrchestrationCrewPanel.tsx:344-380`); here that corner is the header's action cluster.
      .when(crewMembers(this.crew).length > 0, (el) => el.child(this.crewChip(pane, theme())))
      // TabBarQuickCommandsButton.tsx:180-186: Play icon + "Command" pill
      .child(
        h_flex()
          .h(22)
          .px(6)
          .gap(4)
          .items_center()
          .rounded(4)
          .border_1()
          .border_color("#ffffff14")
          .text_color(isFocused ? "#ffffff" : "#a1a1aa")
          .hover((s) => s.bg("#ffffff14").text_color("#ffffff"))
          .tooltip("Open pane commands")
          .on_click((_e, clickCx) => {
            clickCx.stop_propagation();
            this.openPaneMenu(pane, p.terminal);
          })
          .child(div().text_size(9).text_color("#a1a1aa").child("▷"))
          .child(div().text_size(11).font_medium().child("Command"))
      )
      // TabGroupPaneActionsMenu.tsx:41-45: Ellipsis button
      .child(
        this.button(`ph-m-${pane}`, "ellipsis", () => this.openPaneMenu(pane, p.terminal)).tooltip("Pane actions")
      )
      // Split right & split down buttons
      .child(
        this.button(`ph-r-${pane}`, "square-split-vertical", "pane.split", { direction: "right", pane }).tooltip("Split terminal right")
      )
      .child(
        this.button(`ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }).tooltip("Split terminal down")
      )
      // TerminalPaneHeaderOverlay.tsx:125-131: Close split pane or tab when alone
      .child(this.closeButton(p, paneCount, { id: `ph-x-${pane}`, size: 24, radius: 6, glyph: 12 }));
  }
}
