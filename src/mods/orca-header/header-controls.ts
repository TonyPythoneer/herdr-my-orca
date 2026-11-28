import { div, svg, type ClickEvent, type Context, type NativeElement } from "gpui-kit";
import { h_flex } from "gpui-base";
import { openOverlay, panes, run, type TabInfo } from "herdr";
import { IconButton } from "../../shared/icon-button.js";
import { find, layoutTree, toggleLeft, zoomOf } from "./header-layout.js";
import { renderTabItem, stop, tint, TAB_STRIP_SLIDE_MS, type StripFrame } from "./tab-item.js";
import type { HeaderTheme, LayoutNode, WindowState } from "./types.js";
import type Tabs from "./main.js";

const SHARED_ASSET_PATHS: Record<string, string> = {
  "mods/orca-header/chevron-left.svg": "mods/orca-assets/chevron-left--orca-header.svg",
  "mods/orca-header/chevron-right.svg": "mods/orca-assets/chevron-right--orca-header.svg",
  "mods/orca-header/close.svg": "mods/orca-assets/close--orca-header.svg",
  "mods/orca-header/git-branch.svg": "mods/orca-assets/git-branch--orca-header.svg",
  "mods/orca-header/minimize-2.svg": "mods/orca-assets/minimize-2--orca-header.svg",
  "mods/orca-header/plus.svg": "mods/orca-assets/plus--orca-header.svg",
};

function sharedAsset(path: string): string {
  return SHARED_ASSET_PATHS[path] ?? `mods/orca-assets/${path.slice(path.lastIndexOf("/") + 1)}`;
}

export type SidebarFrame = {
  t: HeaderTheme;
  sidebar: LayoutNode | null | undefined;
  w: WindowState;
  leftPad: number;
};

export function addSidebarToggle(
  row: NativeElement,
  view: Tabs,
  { t, sidebar, w, leftPad }: SidebarFrame,
): NativeElement {
  const label = sidebar?.hidden ? "Expand sidebar" : "Collapse sidebar";
  const glyph = svg(
    sharedAsset(`mods/orca-header/panel-left-${sidebar?.hidden ? "open" : "close"}.svg`),
  ).size(16);
  const toggle = IconButton("sidebar-toggle", label, glyph, {
    t,
    w: 32,
    h: 24,
    radius: 8,
    tooltip: label,
    hoverBg: tint(t.foreground, 0.1),
    onClick: (_e: ClickEvent, ecx: Context) => {
      view.wantToggle = (view.wantToggle ?? 0) + 1;
      ecx.notify();
    },
  })
    .ml(toggleLeft(w, leftPad))
    .mr(4)
    .on_mouse_down("left", stop);
  return row.child(toggle).when(!sidebar?.hidden, (el) => {
    const zoom = zoomOf();
    const toggleRight = toggleLeft(w) + 36;
    return el.child(
      div()
        .id("unified-gap")
        .w(Math.max(0, (sidebar?.size?.px ?? 0) / zoom - toggleRight))
        .h(1)
        .flex_none(),
    );
  });
}

function tabScrollButton(
  view: Tabs,
  t: HeaderTheme,
  direction: "start" | "end",
  disabled: boolean,
): NativeElement {
  const label = direction === "start" ? "Scroll tabs left" : "Scroll tabs right";
  const glyph = sharedAsset(
    `mods/orca-header/chevron-${direction === "start" ? "left" : "right"}.svg`,
  );
  return IconButton(`tab-scroll-${direction}`, label, svg(glyph).size(14).flex_none(), {
    t,
    w: 20,
    h: 24,
    radius: 8,
    tooltip: label,
    disabled,
    hoverBg: tint(t.foreground, 0.1),
    onClick: (_e, cx) => {
      if (!disabled) view.scrollTabStrip(direction, cx);
    },
  })
    .when(direction === "start", (el) => el.ml(2).mr(16))
    .when(direction === "end", (el) => el.ml(16).mr(2))
    .when(!disabled, (el) => el.on_mouse_down("left", stop));
}

function trackViewport(view: Tabs, frame: TabTrackFrame): NativeElement {
  const { geometry, shown } = frame;
  const item = (
    tab: TabInfo,
    index: number,
    mode: { hidden?: boolean; overlay?: { visualLeft: number; width: number }; sliding?: boolean },
  ) => renderTabItem(view, frame, tab, index, mode);
  return div()
    .id("tab-viewport")
    .relative()
    .flex_shrink(1)
    .min_w(0)
    .h_full()
    .overflow_hidden()
    .on_size_change((size, cx) => {
      if (Math.abs(size.width - view.viewportWidth) < 0.5) return;
      view.viewportWidth = size.width;
      cx.notify();
    })
    .on_scroll_wheel((e, cx) => view.wheelTabStrip(e, cx))
    .child(
      h_flex()
        .id("tab-track")
        .relative()
        .left(-view.scrollX)
        .h_full()
        .items_center()
        .gap(0)
        .flex_none()
        .when(view.sliding(), (el) =>
          el.transition("left", { duration: TAB_STRIP_SLIDE_MS, easing: "ease-out" as const }),
        )
        .children(
          shown.map((c, i) =>
            item(c, i, { hidden: geometry.docked && i === geometry.activeIndex }),
          ),
        ),
    )
    .when(geometry.docked, (el) =>
      el.child(
        item(geometry.activeTab as TabInfo, geometry.activeIndex, {
          overlay: { ...geometry.slot, width: geometry.activeWidth },
          sliding: view.sliding(),
        }),
      ),
    );
}

function edgeFillet(side: "left" | "right", tab: TabInfo, t: HeaderTheme): NativeElement {
  return div()
    .id(`tab-active-${side}-${tab.id}`)
    .w(14)
    .h_full()
    .flex_none()
    .relative()
    .when(side === "left", (el) => el.ml(-14))
    .when(side === "right", (el) => el.mr(-14))
    .child(
      div()
        .absolute()
        .bottom(0)
        .size(14)
        .overflow_hidden()
        .child(
          div()
            .absolute()
            .top(-28)
            .when(side === "left", (el) => el.left(-28))
            .when(side === "right", (el) => el.left(-14))
            .size(56)
            .rounded_full()
            .border(14)
            .border_color(t.background),
        ),
    );
}

export type TabTrackFrame = StripFrame;

export function addTabTrack(row: NativeElement, view: Tabs, frame: TabTrackFrame): NativeElement {
  const { t, geometry } = frame;
  const leftFillet =
    geometry.arrows.hasOverflow && Boolean(geometry.activeTab) && geometry.slot.visualLeft <= 1;
  const rightFillet =
    Boolean(geometry.activeTab) &&
    geometry.slot.visualLeft + geometry.activeWidth >= geometry.slot.viewportWidth - 1;
  return row
    .when(geometry.arrows.hasOverflow, (el) =>
      el.child(
        tabScrollButton(view, t, "start", geometry.arrows.leftDisabled)
          .id("tab-scroll-start")
          .relative(),
      ),
    )
    .when(leftFillet, (el) => el.child(edgeFillet("left", geometry.activeTab as TabInfo, t)))
    .child(trackViewport(view, frame))
    .when(rightFillet, (el) => el.child(edgeFillet("right", geometry.activeTab as TabInfo, t)))
    .when(geometry.arrows.hasOverflow, (el) =>
      el.child(
        tabScrollButton(view, t, "end", geometry.arrows.rightDisabled)
          .id("tab-scroll-end")
          .relative(),
      ),
    );
}

export type EndFrame = {
  t: HeaderTheme;
  paneDrag: { inTabStrip?: boolean } | undefined;
  shown: TabInfo[];
  w: WindowState;
};

export function addEndControls(
  row: NativeElement,
  view: Tabs,
  { t, paneDrag, shown, w }: EndFrame,
): NativeElement {
  const tabNew = (action: () => void) =>
    IconButton(
      "tab-new",
      "New tab",
      svg("mods/orca-assets/plus--orca-header.svg").size(14).flex_none(),
      {
        t,
        size: 28,
        radius: "full",
        tooltip: "New tab",
        hoverBg: tint(t.foreground, 0.1),
        onClick: action,
      },
    )
      .ml(8)
      .on_mouse_down("left", (e, cx) => {
        view.plusBounds = e.bounds;
        stop(e, cx);
      });
  return row
    .when(Boolean(paneDrag?.inTabStrip), (el) => el.child(dropIndicator(t)))
    .child(
      tabNew(() =>
        openOverlay({
          mod: "orca-tab-dropdown",
          kind: "popup",
          frame: "none",
          width: 288,
          at: view.newMenuAt(),
        }),
      )
        .id("tab-new")
        .relative(),
    )
    .child(div().flex_1())
    .when(shown.length === 1 && shown[0].zoomed, (el) => el.child(collapseButton(t, shown[0])))
    .child(panelToggle(view, t))
    .when(w.platform !== "macos", (el) => el.child(windowControls(t, w)));
}

function dropIndicator(t: HeaderTheme): NativeElement {
  return h_flex()
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
    .child(div().text_size(12).font_medium().text_color(t.foreground).child("+ Move to Tab"));
}

function collapseButton(t: HeaderTheme, tab: TabInfo): NativeElement {
  return IconButton(
    "titlebar-collapse",
    "Collapse pane",
    svg("mods/orca-assets/minimize-2--orca-header.svg").size(14),
    {
      t,
      size: 22,
      radius: "full",
      tooltip: "Collapse pane",
      hoverBg: tint(t.foreground, 0.1),
      onClick: () => {
        const z = (panes() ?? []).find((p) => p.tab === tab.id && p.zoomed);
        if (z) run("pane.zoom", { pane: z.pane });
      },
    },
  )
    .mr(8)
    .on_mouse_down("left", stop);
}

function panelToggle(view: Tabs, t: HeaderTheme): NativeElement {
  const panelHidden = Boolean(find(layoutTree(), "panel")?.hidden);
  const panelLabel = panelHidden ? "Expand right sidebar" : "Collapse right sidebar";
  return IconButton(
    "panel-toggle",
    panelLabel,
    svg(
      panelHidden
        ? "mods/orca-assets/panel-right-open.svg"
        : "mods/orca-assets/panel-right-close--orca-right-sidebar-header.svg",
    ).size(16),
    {
      t,
      w: 32,
      h: 24,
      radius: 8,
      tooltip: panelLabel,
      hoverBg: tint(t.foreground, 0.1),
      onClick: (_e, cx) => {
        view.wantPanelToggle = (view.wantPanelToggle ?? 0) + 1;
        cx.notify();
      },
    },
  )
    .mr(8)
    .on_mouse_down("left", stop);
}

function windowControls(t: HeaderTheme, w: WindowState): NativeElement {
  return h_flex()
    .h_full()
    .items_center()
    .child(
      winButton(t, {
        id: "minimize",
        label: "Minimize",
        glyph: svg("mods/orca-assets/win-min.svg").size(10),
        action: () => run("window.minimize"),
        close: false,
      }),
    )
    .child(
      winButton(t, {
        id: "maximize",
        label: "Maximize",
        glyph: svg(
          sharedAsset(`mods/orca-header/${w.maximized ? "win-restore" : "win-max"}.svg`),
        ).size(10),
        action: () => run("window.maximize"),
        close: false,
      }),
    )
    .child(
      winButton(t, {
        id: "close-window",
        label: "Close window",
        glyph: svg("mods/orca-assets/win-close.svg").size(10),
        action: () => run("window.close"),
        close: true,
      }),
    );
}

function winButton(
  t: HeaderTheme,
  {
    id,
    label,
    glyph,
    action,
    close,
  }: {
    id: string;
    label: string;
    glyph: NativeElement;
    action: () => void;
    close: boolean;
  },
): NativeElement {
  return IconButton(id, label, glyph, {
    t,
    w: 46,
    h: "full",
    radius: null,
    tooltip: label,
    hoverBg: close ? "#c42b1c" : tint(t.foreground, 0.1),
    hoverFg: close ? "#ffffff" : t.foreground,
    onClick: action,
  }).on_mouse_down("left", stop);
}
