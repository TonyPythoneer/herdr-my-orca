// Derived from Herdr App's defaults/mods/tabs/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
import { div, image, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { openOverlay, panes, run } from "herdr";
import { IconButton } from "./icon-button.js";

// Glass surfaces for the header (the reference design's "liquid glass" look): translucent fills
// derived from the theme's own foreground, so both the dark and the light theme tint correctly.
export function tint(hex, alpha) {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0");
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${a}` : hex;
}

// How long an arrow's slide takes: Orca hands `scrollBy` a `behavior: 'smooth'`, which in Chromium
// runs about this long.
export const TAB_STRIP_SLIDE_MS = 150;

export const stop = (_e, cx) => cx.stop_propagation();

// TerminalTabLeadingIcon.tsx:31-45 — the agent's identity mark, `opacity-70` while the
// tab is inactive. Orca's `AgentIcon` (`agent-catalog.tsx:50-122`) decides which mark an
// agent has; what decides the drawing is whether it brings its own fills. omp's gradient
// (`agent-icon-glyphs.tsx:30-62`), Droid's white-on-black (`status-bar/icons.tsx:343-366`),
// Kilo's yellow/black and the bundled favicons keep theirs, so they are images — `svg()` is
// a one-color mask (gpui-kit.d.ts:20273-20281) and greys them. A currentColor glyph (Codex,
// Pi, Aider, OpenCode, Copilot) takes the text color instead. An agent Orca names no mark
// for falls back to the program table's own icon. `mods/orca-sidebar-projects` draws the same table:
// a mod cannot reach another's files, so each carries its own copies.
const OWN_FILLS = new Set(["omp", "droid", "kilo"]);
const AGENT_MARKS = {
  codex: "mods/orca-assets/codex--orca-header.svg",
  omp: "mods/orca-assets/omp.svg",
  gemini: "mods/orca-assets/gemini.png",
  cursor: "mods/orca-assets/cursor.png",
  grok: "mods/orca-assets/grok.png",
  qoder: "mods/orca-assets/qoder.png",
  hermes: "mods/orca-assets/hermes.png",
  "dsh-tui": "mods/orca-assets/dsh.png",
  droid: "mods/orca-assets/droid.svg",
  kilo: "mods/orca-assets/kilo.svg",
  aider: "mods/orca-assets/aider.svg",
  freebuff: "mods/orca-assets/freebuff--orca-header.png",
};

function agentIcon(app, program, t) {
  const mark = AGENT_MARKS[app];
  if (mark) return OWN_FILLS.has(app) || !mark.endsWith(".svg")
    ? image(mark).size(12)
    : svg(mark).size(12).text_color(t.muted);
  if (!program?.icon) return null;
  return program.tint ? svg(program.icon).size(12).text_color(t.muted) : image(program.icon).size(12);
}

function tabSurface(view, { t, gapToCard, flushable }, { tab, index, copyId }) {
  // The reference design's tab strip (deliberate divergence from Orca's flat strip,
  // SortableTab.tsx:214): the ACTIVE tab is joined to the terminal below it. It is as tall as
  // the bar, fills with the terminals' own `background` (what lies under the bar), rounds its
  // top corners at 14 and flares into the terminal through two concave 14px fillets, so there
  // is no bottom bar and no border. An inactive tab is bare text; only hover raises a 24px
  // pill (radius 10). The slot that wraps it keeps Orca's measured width rules
  // (`w-[300px] max-w-[300px] min-w-[144px]`, tab-width-rules.ts:2) and its 2px inset.
  // `mr-1` on the leading icon and label (TerminalTabLeadingIcon.tsx:63, SortableTab.tsx:291)
  // is the 4px gap between children.
  // shortcut: a fillet is a 14px square of terminal colour holding a bar-coloured square with
  // one rounded corner; it assumes the bar is `bar`, so change both together.
  const flush = flushable(tab, index);
  const flare = flush ? Math.min(1, gapToCard / 14) : 1;
  // A fillet is only the concave wedge, drawn as a ring: a 56px circle with a 14px terminal-coloured
  // border, centred on the corner of a clipped 14px square, leaves exactly the part outside a
  // 14px-radius circle. It paints nothing else, so it works over the bar AND over a neighbour's
  // hover pill (the earlier two-square version painted a bar-coloured square over the pill).
  const fillet = (side) => div().absolute().bottom(0).size(14).overflow_hidden()
    .when(side === "left", el => el.left(-14).opacity(flare)).when(side === "right", el => el.right(-14))
    .child(div().absolute().top(-28).size(56).rounded_full().border(14).border_color(t.background)
      .when(side === "left", el => el.left(-28)).when(side === "right", el => el.left(-14)));
  // Both surfaces are layers that every tab always carries and that only change `opacity`, under a
  // stable id: a transition animates changes made after the element carried it, so switching tab
  // crossfades the joined shape (old fades out, new fades in) and hover fades the pill in and out.
  // (`.hover()` styles cannot animate; the strip already tracks `hoveredTab`.)
  const fade = { duration: 160, easing: "ease-out" };
  // Nothing here may depend on which tab is active in a way that moves layout: slot padding is
  // constant, so a click moves no pixel and re-measures no width. Only these two layers react.
  // The active layer is instant (click feedback). The hover pill is never inset: the neighbour's
  // fillet wedge paints over its corner, which is the intended Chrome-style bite.
  const activeLayer = div().id(`tab-active-${tab.id}${copyId}`).absolute().top(0).bottom(0)
    .left(flush && gapToCard <= 0 ? -2 : 0).right(0)
    .rounded_t(14).bg(t.background).opacity(tab.active ? 1 : 0)
    .child(fillet("left")).child(fillet("right"));
  const hoverLayer = div().id(`tab-hover-${tab.id}${copyId}`).absolute().top(4).bottom(4)
    .left(0).right(0)
    .rounded(10).bg(tint(t.foreground, 0.08)).opacity(!tab.active && view.hoveredTab === tab.id ? 1 : 0).transition("opacity", fade);
  return h_flex().w_full().h_full().min_w(0).px(10).gap(4).relative().items_center().text_size(12)
    .child(hoverLayer).child(activeLayer)
    .text_color(tab.active ? t.foreground : t.muted)
    .when(!tab.active, el => el.hover(s => s.text_color(t.foreground)));
}

function tabEvents(pill, view, { shown, space }, { tab, index, pane }) {
  return pill
    .on_hover((hovered, cx) => {
      if (!hovered && view.hoveredTab !== tab.id) return;
      const next = hovered ? tab.id : null;
      if (next === view.hoveredTab) return;
      view.hoveredTab = next;
      cx.notify();
    })
    // SortableTab.tsx:214 — cursor-pointer: tab rest hover is a pointer hand, not grab.
    .cursor_pointer()
    // Dim and grab only once the pointer has left this tab (a real drag), not on every mouse-down:
    // dimming at the press made a plain click look half-highlighted.
    .when(view.pressed === index && view.overTab !== null && view.overTab !== tab.id, el => el.cursor_grabbing().opacity(0.8))
    // SortableTab.tsx:231-243 — onAuxClick button === 1 (middle-click) closes tab.
    .on_mouse_down("middle", (_e, cx) => {
      cx.stop_propagation();
      view.requestCloseTab(tab);
    })
    // Blue drop insertion line — Orca drop-indicator.ts:4-12 (w-[2px] bg-blue-500).
    .when(view.pressed !== null && view.overTab === tab.id && view.pressed !== index, el =>
      el.child(
        div().absolute().top(0).bottom(0).w(2).bg("#3b82f6")
          .when(view.overSide === "left", line => line.left(0))
          .when(view.overSide === "right", line => line.right(0))
      )
    )
    // Tab reordering — SortableTab.tsx:213 and tab-drag-drop-commit.ts:116-126. Dragging along
    // the strip reorders via `tab.move`. A press that travels 12px or more hands the drag to
    // the drop overlay instead (`edgeZone`, `renderDrop`), because these handlers stop at the
    // tab rail — see ADR 0007 "Tab Drop-To-Split".
    .on_mouse_down("left", (e, cx) => {
      cx.stop_propagation();
      view.pressed = index;
      view.overTab = tab.id;
      view.overSide = null;
      view.stripBounds = e.bounds;
      // What a drop past the strip would carry, and where the press began.
      view.pressAt = e.position;
      view.dragTab = tab.id;
      view.dragTerminal = pane?.terminal ?? null;
      view.dragPane = pane?.pane ?? null;
      if (e.click_count === 2) run("tab.rename", { id: tab.id });
      cx.notify();
    })
    .on_mouse_move((e, cx) => view.moveOverTab(tab, index, e, cx))
    .on_mouse_up("left", (_e, cx) => view.releaseTab(tab, index, shown, cx))
    // `orca-context-menu` owns the tab menu (it already has the "tab" case); pointing at Herdr's
    // shipped `menu` made this mod depend on a mod outside the package.
    // SortableTabContextMenu.tsx:155 — `min-w-[13rem]` (208) is Orca's; Herdr's longest row
    // ("Move Tab to Split Right") plus its shortcut chip needs 272, or its label ellipses.
    .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "orca-context-menu", kind: "popup", width: 272, props: { tab: "tab", target: { id: tab.id, space: space.id } } }); });
}

function tabContent(pill, view, t, { tab, copyId, identity, label }) {
  return pill
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
    .when(tab.status === "working", el => el.child(svg("mods/orca-assets/spinner.svg").size(12).flex_none().text_color("#eab308").spin(1000)))
    .when(tab.status === "done", el => el.child(svg("mods/orca-assets/circle-check.svg").size(12).flex_none().text_color("#10b981")))
    .when(tab.status === "blocked", el => el.child(svg("mods/orca-assets/message-circle-question.svg").size(12).flex_none().text_color("#ea580c")))
    // `src/renderer/src/components/AgentStateDot.tsx:186-195` — idle is a plain dot, not a glyph: `size-2` (8px)
    // `rounded-full` in `bg-neutral-500/40` inside the md `h-3 w-3` (12px) box.
    .when(tab.status === "idle", el => el.child(div().size(12).flex_none().flex().items_center().justify_center()
      .child(div().size(8).rounded(4).bg("#73737366"))))
    .when(Boolean(identity), el => el.child(tab.active ? identity : identity.opacity(0.7)))
    // Pin — SortableTab.tsx:258-259: size-3 (12px), mr-1 (4px), shrink-0, text-muted-foreground.
    .when(Boolean(tab.settled), el => el.child(svg("mods/orca-assets/pin.svg").size(12).flex_none().mr(4).text_color(t.muted)))
    // `TAB_LABEL_WIDTH_CLASSES` (tab-width-rules.ts:4) — `tab-label min-w-0 flex-1 truncate`.
    // Orca never marks an expanded pane in the title (SortableTab.tsx:130-131); the
    // Minimize2 button below is the only indicator.
    .child(div().flex_1().min_w(0).truncate().child(label))
    // Collapse pane — SortableTab.tsx:298-316: shown while the pane is expanded, a 16px box
    // with a 12px `Minimize2`; active tabs always show it, inactive ones on TAB hover
    // (`text-transparent group-hover:text-muted-foreground`). `pane.zoom` collapses.
    .when(tab.zoomed, el => el.child(IconButton(`collapse-${tab.id}${copyId}`, "Collapse pane",
      svg("mods/orca-assets/minimize-2--orca-header.svg").size(12),
      { t, size: 16, radius: 8, tooltip: "Collapse pane", color: tab.active || view.hoveredTab === tab.id ? t.muted : t.dim,
        hoverBg: tint(t.foreground, 0.14),
        onClick: (_e, cx) => {
          cx.stop_propagation();
          // The ZOOMED pane, not the focused one: a split tab can have another pane zoomed.
          const z = (panes() ?? []).find(p => p.tab === tab.id && p.zoomed);
          if (z) run("pane.zoom", { pane: z.pane });
        } })
      .on_mouse_down("left", stop)))
    // Close — SortableTab.tsx:317-349: only when `!isPinned` (Orca's pinned tab has no close
    // button; Herdr's pin analogue is `settled`, TabInfo.settled). The box is `w-4 h-4`
    // (16px), the glyph `w-3` (12px); inactive is `text-transparent` and becomes muted on
    // TAB hover (`group-hover`), not on its own box.
    .when(!tab.settled, el => el.child(div().id(`close-${tab.id}${copyId}`).size(16).flex_none().flex().items_center().justify_center().rounded(8)
      .text_color(tab.active || view.hoveredTab === tab.id ? t.muted : t.dim)
      .hover(s => s.text_color(t.foreground).bg(tint(t.foreground, 0.14)))
      .on_mouse_down("left", stop).accessibility_label("Close").tooltip("Close")
      .on_click((_e, cx) => { cx.stop_propagation(); view.requestCloseTab(tab); })
      .child(svg("mods/orca-assets/close--orca-header.svg").size(12))));
}

// Between two neighbouring inactive tabs, unless the pointer is on either one.
function showsDivider(view, shown, tab, index, mode) {
  if (tab.active || mode.overlay || index >= shown.length - 1) return false;
  const next = shown[index + 1];
  return !next.active && view.hoveredTab !== tab.id && view.hoveredTab !== next.id;
}

export function renderTabItem(view, strip, tab, index, mode) {
  const { t, shown, tabPanes, unofficialPanes } = strip;
  const pane = tabPanes.get(tab.id) ?? null;
  const program = pane?.program;
  const unofficial = view.unofficialApp(pane, unofficialPanes);
  // SortableTab.tsx:130 — displayTitle = customTitle ?? (tabAgent ? strip(title) : title).
  const label = view.getTabLabel(tab, pane, unofficial);
  // Two copies of one tab exist only while it is pinned: the slot in the track and the
  // overlay drawn at the clamped position. Their ids must differ or GPUI treats them as one
  // element (`gpui-kit.d.ts:1098-1109`).
  const copyId = mode.overlay ? "-dock" : "";
  const identity = agentIcon(unofficial?.key ?? pane?.app, program, t);
  const item = { tab, index, pane, copyId, identity, label };
  const surface = tabSurface(view, strip, item);
  const interactive = tabEvents(surface, view, strip, item);
  const pill = tabContent(interactive, view, t, item);
  // The SLOT around the pill keeps its place and its width, so the track stays exactly as long
  // as the tab list. The width of a tab is its label's, so the strip measures the slot rather
  // than guessing (`on_size_change`, gpui-kit.d.ts:734-736 — the only measurement a mod gets).
  return h_flex().id(`tab-${tab.id}${copyId}`).h_full().px(2).relative().items_center().flex_none().min_w(144).max_w(300)
    .when(!mode.overlay, el => el.on_size_change((size, cx) => view.measureTabWidth(tab.id, size.width, cx)))
    // The pinned copy: drawn after the track, so it paints above the inactive tabs passing
    // underneath, and given the clamped left the geometry asked for. It is the same tab — its
    // own icon, indicator and close button — so nothing is clipped at the viewport edge.
    .when(Boolean(mode.overlay), el => el.absolute().top(0).left(mode.overlay.visualLeft).w(mode.overlay.width))
    // Sliding, as a pinned tab does, keeps the same share of the arrow's ease as the track.
    .when(Boolean(mode.overlay) && Boolean(mode.sliding), el => el.transition("left", { duration: TAB_STRIP_SLIDE_MS, easing: "ease-out" }))
    // The slot only stops painting while the pinned copy stands in for it. The pinned copy
    // always covers the slot's visible part, so no hole shows and no second tab appears.
    .when(mode.hidden, el => el.opacity(0))
    .child(pill)
    // 1px divider between neighbouring inactive tabs, hidden beside the active or hovered one.
    .when(showsDivider(view, shown, tab, index, mode),
      el => el.child(div().absolute().right(0).top(0).bottom(0).flex().items_center().child(div().w(1).h(14).bg(tint(t.foreground, 0.14)))));
}
