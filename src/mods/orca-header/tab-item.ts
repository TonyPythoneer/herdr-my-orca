import {
  div,
  image,
  svg,
  type ClickEvent,
  type Color,
  type Context,
  type NativeElement,
} from "gpui-kit";
import { h_flex } from "gpui-base";
import {
  openOverlay,
  panes,
  run,
  type PaneInfo,
  type Program,
  type SpaceInfo,
  type TabInfo,
} from "herdr";
import { IconButton } from "../../shared/icon-button.js";
import { AGENT } from "../../config/definitions/agent-catalog.js";
import type { UnofficialApp } from "./unofficial-apps.js";
import type { TabArrows, TabSlot } from "./tab-strip-scroll.js";
import type { HeaderTheme } from "./types.js";
import type Tabs from "./main.js";

export function tint(hex: Color, alpha: number): Color {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${a}` : hex;
}

export const TAB_STRIP_SLIDE_MS = 150;

export const stop = (_e: ClickEvent, cx: Context): void => cx.stop_propagation();

const OWN_FILLS = new Set<string>(["omp", "droid", "kilo"]);
const AGENT_MARKS: Record<string, string> = {
  [AGENT.codex]: "mods/orca-assets/codex--orca-header.svg",
  [AGENT.omp]: "mods/orca-assets/omp.svg",
  [AGENT.gemini]: "mods/orca-assets/gemini.png",
  [AGENT.cursor]: "mods/orca-assets/cursor.png",
  [AGENT.grok]: "mods/orca-assets/grok.png",
  [AGENT.qoder]: "mods/orca-assets/qoder.png",
  [AGENT.hermes]: "mods/orca-assets/hermes.png",
  [AGENT["dsh-tui"]]: "mods/orca-assets/dsh.png",
  droid: "mods/orca-assets/droid.svg",
  kilo: "mods/orca-assets/kilo.svg",
  aider: "mods/orca-assets/aider.svg",
  freebuff: "mods/orca-assets/freebuff--orca-header.png",
};

export type TabGeometry = {
  arrows: TabArrows;
  slot: TabSlot;
  activeTab: TabInfo | null;
  activeIndex: number;
  activeWidth: number;
  docked: boolean;
};

export type StripFrame = {
  t: HeaderTheme;
  shown: TabInfo[];
  space: SpaceInfo;
  tabPanes: Map<string, PaneInfo>;
  unofficialPanes: Map<unknown, UnofficialApp>;
  gapToCard: number;
  flushable: (tab: TabInfo, index: number) => boolean;
  geometry: TabGeometry;
};

export type TabMode = {
  hidden?: boolean;
  overlay?: { visualLeft: number; width: number };
  sliding?: boolean;
};

type TabItem = {
  tab: TabInfo;
  index: number;
  pane: PaneInfo | null;
  copyId: string;
  identity: NativeElement | null;
  label: string;
};

function agentIcon(
  app: string | null | undefined,
  program: Program | undefined,
  t: HeaderTheme,
): NativeElement | null {
  const mark = app ? AGENT_MARKS[app] : undefined;
  if (mark)
    return OWN_FILLS.has(app ?? "") || !mark.endsWith(".svg")
      ? image(mark).size(12)
      : svg(mark).size(12).text_color(t.muted);
  if (!program?.icon) return null;
  return program.tint
    ? svg(program.icon).size(12).text_color(t.muted)
    : image(program.icon).size(12);
}

function fillet(side: "left" | "right", t: HeaderTheme, flare: number): NativeElement {
  return div()
    .absolute()
    .bottom(0)
    .size(14)
    .overflow_hidden()
    .when(side === "left", (el) => el.left(-14).opacity(flare))
    .when(side === "right", (el) => el.right(-14))
    .child(
      div()
        .absolute()
        .top(-28)
        .size(56)
        .rounded_full()
        .border(14)
        .border_color(t.background)
        .when(side === "left", (el) => el.left(-28))
        .when(side === "right", (el) => el.left(-14)),
    );
}

function tabSurface(
  view: Tabs,
  { t, gapToCard, flushable }: StripFrame,
  { tab, index, copyId }: TabItem,
): NativeElement {
  const flush = flushable(tab, index);
  const flare = flush ? Math.min(1, gapToCard / 14) : 1;
  const fade = { duration: 160, easing: "ease-out" as const };
  const activeLayer = div()
    .id(`tab-active-${tab.id}${copyId}`)
    .absolute()
    .top(0)
    .bottom(0)
    .left(flush && gapToCard <= 0 ? -2 : 0)
    .right(0)
    .rounded_t(14)
    .bg(t.background)
    .opacity(tab.active ? 1 : 0)
    .child(fillet("left", t, flare))
    .child(fillet("right", t, flare));
  const hoverLayer = div()
    .id(`tab-hover-${tab.id}${copyId}`)
    .absolute()
    .top(4)
    .bottom(4)
    .left(0)
    .right(0)
    .rounded(10)
    .bg(tint(t.foreground, 0.08))
    .opacity(!tab.active && view.hoveredTab === tab.id ? 1 : 0)
    .transition("opacity", fade);
  return h_flex()
    .w_full()
    .h_full()
    .min_w(0)
    .px(10)
    .gap(4)
    .relative()
    .items_center()
    .text_size(12)
    .child(hoverLayer)
    .child(activeLayer)
    .text_color(tab.active ? t.foreground : t.muted)
    .when(!tab.active, (el) => el.hover((s) => s.text_color(t.foreground)));
}

function tabPressEvents(
  pill: NativeElement,
  view: Tabs,
  { tab, index, pane }: TabItem,
  shown: TabInfo[],
  space: SpaceInfo,
): NativeElement {
  return pill
    .on_mouse_down("left", (e, cx) => {
      cx.stop_propagation();
      view.pressed = index;
      view.overTab = tab.id;
      view.overSide = null;
      view.stripBounds = e.bounds;
      view.pressAt = e.position;
      view.dragTab = tab.id;
      view.dragTerminal = pane?.terminal ?? null;
      view.dragPane = pane?.pane ?? null;
      if (e.click_count === 2) run("tab.rename", { id: tab.id });
      cx.notify();
    })
    .on_mouse_move((e, cx) => view.moveOverTab(tab, index, e, cx))
    .on_mouse_up("left", (_e, cx) => view.releaseTab(tab, index, shown, cx))
    .on_mouse_down("right", (_e, cx) => {
      cx.stop_propagation();
      openOverlay({
        mod: "orca-context-menu",
        kind: "popup",
        width: 272,
        props: { tab: "tab", target: { id: tab.id, space: space.id } },
      });
    });
}

function dropLine(view: Tabs, tab: TabInfo, index: number): NativeElement {
  return div()
    .absolute()
    .top(0)
    .bottom(0)
    .w(2)
    .bg("#3b82f6")
    .when(view.overSide === "left", (line) => line.left(0))
    .when(view.overSide === "right", (line) => line.right(0));
}

function tabEvents(
  pill: NativeElement,
  view: Tabs,
  frame: { shown: TabInfo[]; space: SpaceInfo },
  item: TabItem,
): NativeElement {
  const { tab, index } = item;
  const hovered = pill
    .on_hover((hoveredNow, cx) => {
      if (!hoveredNow && view.hoveredTab !== tab.id) return;
      const next = hoveredNow ? tab.id : null;
      if (next === view.hoveredTab) return;
      view.hoveredTab = next;
      cx.notify();
    })
    .cursor_pointer()
    .when(view.pressed === index && view.overTab !== null && view.overTab !== tab.id, (el) =>
      el.cursor_grabbing().opacity(0.8),
    );
  const middle = hovered.on_mouse_down("middle", (_e, cx) => {
    cx.stop_propagation();
    view.requestCloseTab(tab);
  });
  const withLine = middle.when(
    view.pressed !== null && view.overTab === tab.id && view.pressed !== index,
    (el) => el.child(dropLine(view, tab, index)),
  );
  return tabPressEvents(withLine, view, item, frame.shown, frame.space);
}

function tabContent(pill: NativeElement, view: Tabs, t: HeaderTheme, item: TabItem): NativeElement {
  const { tab, copyId, identity, label } = item;
  const statused = pill
    .when(tab.status === "working", (el) =>
      el.child(
        svg("mods/orca-assets/spinner.svg").size(12).flex_none().text_color("#eab308").spin(1000),
      ),
    )
    .when(tab.status === "done", (el) =>
      el.child(svg("mods/orca-assets/circle-check.svg").size(12).flex_none().text_color("#10b981")),
    )
    .when(tab.status === "blocked", (el) =>
      el.child(
        svg("mods/orca-assets/message-circle-question.svg")
          .size(12)
          .flex_none()
          .text_color("#ea580c"),
      ),
    )
    .when(tab.status === "idle", (el) =>
      el.child(
        div()
          .size(12)
          .flex_none()
          .flex()
          .items_center()
          .justify_center()
          .child(div().size(8).rounded(4).bg("#73737366")),
      ),
    );
  const withIdentity = identity
    ? statused.child(tab.active ? identity : identity.opacity(0.7))
    : statused;
  return withIdentity
    .when(Boolean(tab.settled), (el) =>
      el.child(svg("mods/orca-assets/pin.svg").size(12).flex_none().mr(4).text_color(t.muted)),
    )
    .child(div().flex_1().min_w(0).truncate().child(label))
    .when(tab.zoomed, (el) => el.child(collapseButton(view, t, tab, copyId)))
    .when(!tab.settled, (el) => el.child(closeButton(view, t, tab, copyId)));
}

function collapseButton(view: Tabs, t: HeaderTheme, tab: TabInfo, copyId: string): NativeElement {
  return IconButton(
    `collapse-${tab.id}${copyId}`,
    "Collapse pane",
    svg("mods/orca-assets/minimize-2--orca-header.svg").size(12),
    {
      t,
      size: 16,
      radius: 8,
      tooltip: "Collapse pane",
      color: tab.active || view.hoveredTab === tab.id ? t.muted : t.dim,
      hoverBg: tint(t.foreground, 0.14),
      onClick: (_e, cx) => {
        cx.stop_propagation();
        const z = (panes() ?? []).find((p) => p.tab === tab.id && p.zoomed);
        if (z) run("pane.zoom", { pane: z.pane });
      },
    },
  ).on_mouse_down("left", stop);
}

function closeButton(view: Tabs, t: HeaderTheme, tab: TabInfo, copyId: string): NativeElement {
  return div()
    .id(`close-${tab.id}${copyId}`)
    .size(16)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(8)
    .text_color(tab.active || view.hoveredTab === tab.id ? t.muted : t.dim)
    .hover((s) => s.text_color(t.foreground).bg(tint(t.foreground, 0.14)))
    .on_mouse_down("left", stop)
    .accessibility_label("Close")
    .tooltip("Close")
    .on_click((_e, cx) => {
      cx.stop_propagation();
      view.requestCloseTab(tab);
    })
    .child(svg("mods/orca-assets/close--orca-header.svg").size(12));
}

function showsDivider(
  view: Tabs,
  shown: TabInfo[],
  tab: TabInfo,
  index: number,
  mode: TabMode,
): boolean {
  if (tab.active || mode.overlay || index >= shown.length - 1) return false;
  const next = shown[index + 1];
  return !next.active && view.hoveredTab !== tab.id && view.hoveredTab !== next.id;
}

function divider(t: HeaderTheme): NativeElement {
  return div()
    .absolute()
    .right(0)
    .top(0)
    .bottom(0)
    .flex()
    .items_center()
    .child(div().w(1).h(14).bg(tint(t.foreground, 0.14)));
}

export function renderTabItem(
  view: Tabs,
  strip: StripFrame,
  tab: TabInfo,
  index: number,
  mode: TabMode,
): NativeElement {
  const { t, shown, tabPanes, unofficialPanes } = strip;
  const pane = tabPanes.get(tab.id) ?? null;
  const program = pane?.program;
  const unofficial = view.unofficialApp(pane, unofficialPanes);
  const label = view.getTabLabel(tab, pane, unofficial);
  const copyId = mode.overlay ? "-dock" : "";
  const identity = agentIcon(unofficial?.key ?? pane?.app, program, t);
  const item: TabItem = { tab, index, pane, copyId, identity, label };
  const surface = tabSurface(view, strip, item);
  const interactive = tabEvents(surface, view, strip, item);
  const pill = tabContent(interactive, view, t, item);
  return h_flex()
    .id(`tab-${tab.id}${copyId}`)
    .h_full()
    .px(2)
    .relative()
    .items_center()
    .flex_none()
    .min_w(144)
    .max_w(300)
    .when(!mode.overlay, (el) =>
      el.on_size_change((size, cx) => view.measureTabWidth(tab.id, size.width, cx)),
    )
    .when(mode.overlay !== undefined, (el) =>
      mode.overlay ? el.absolute().top(0).left(mode.overlay.visualLeft).w(mode.overlay.width) : el,
    )
    .when(Boolean(mode.overlay) && Boolean(mode.sliding), (el) =>
      el.transition("left", { duration: TAB_STRIP_SLIDE_MS, easing: "ease-out" as const }),
    )
    .when(Boolean(mode.hidden), (el) => el.opacity(0))
    .child(pill)
    .when(showsDivider(view, shown, tab, index, mode), (el) => el.child(divider(t)));
}
