// Derived from Herdr App's defaults/mods/tabs/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, openOverlay, panes, run, setShared, settings } from "herdr";
import { find, toggleLeft } from "./header-layout.js";
import { renderTabItem, stop, tint, TAB_STRIP_SLIDE_MS } from "./tab-item.js";

export function addSidebarToggle(row, view, { t, unified, sidebar, w, leftPad }) {
  // .sidebar-toggle (main.css:1213-1230) — padding 4px 8px around a 16px glyph = 32x24,
  // radius 4, muted, hover --accent. .window-controls-btn (main.css:1145-1168) — 46x36,
  // square, muted, hover --accent, close hover #c42b1c.
  // TitlebarLeftControls.tsx:74-88 — Orca has ONE sidebar toggle, at the LEFT of the
  // titlebar. `orca-chrome` draws it (inside the sidebar column); this copy only appears
  // while that column is hidden, because Herdr skips a hidden node's content
  // (layout.rs:551) and there would otherwise be no way back. Orca keeps the control
  // reachable by floating `titlebar-left` over the workspace
  // (AppWorkspaceShell.tsx:163-167). Its glyph names what the click does (`PanelLeftClose` while
  // the column is open, `PanelLeftOpen` while it is hidden), and the label follows the glyph.
  const sidebarToggle = (glyph, action, ml, label) => div().id("sidebar-toggle").ml(ml).mr(4).w(32).h(24).flex_none().flex().items_center().justify_center().rounded(8)
    .text_color(t.muted).hover(s => s.bg(tint(t.foreground, 0.1)).text_color(t.foreground))
    .role("button").accessibility_label(label).tooltip(label)
    .on_mouse_down("left", stop).on_click(action).child(glyph);
  return row
    // TitlebarLeftControls.tsx:74-88 — ONE sidebar toggle, at the LEFT; `orca-chrome` draws it
    // inside the sidebar column. This copy appears only while that column is hidden, since
    // Herdr skips a hidden node's content (layout.rs:551); Orca keeps the control at the same
    // left slot by floating `titlebar-left` over the workspace
    // (AppWorkspaceShell.tsx:163-167).
    .when(unified || Boolean(sidebar?.hidden), el => el.child(sidebarToggle(svg(`mods/orca-chrome/panel-left-${sidebar?.hidden ? "open" : "close"}.svg`).size(16), (_e, ecx) => {
      // Same route as the `toggle-sidebar` command: the render consumes the flag with a live render
      // context. The `cx` captured by this render is dead once the click arrives.
      if (unified) { view.wantToggle = (view.wantToggle ?? 0) + 1; ecx.notify(); return; }
      setShared("sidebar.collapsed", !sidebar?.hidden);
      run(sidebar?.hidden ? "layout.show" : "layout.hide", { id: "sidebar" });
      // Same x and glyph as orca-chrome's toggle (75, or 8 in full screen) so the button does not jump on collapse.
    }, toggleLeft(w, leftPad), sidebar?.hidden ? "Expand sidebar" : "Collapse sidebar")))
    // Unified: the tab strip starts on the card's left edge, i.e. at the sidebar's right edge
    // (or right after the toggle while the sidebar is hidden, or narrower than that).
    .when(unified && !sidebar?.hidden, el => {
      const zoom = settings()?.zoom || 1;
      const toggleRight = toggleLeft(w) + 36;
      return el.child(div().id("unified-gap").w(Math.max(0, (sidebar?.size?.px ?? 0) / zoom - toggleRight)).h(1).flex_none());
    });
}

export function addTabTrack(row, view, frame) {
  const { t, geometry, shown } = frame;
  // Orca's chevrons (`tab-bar-surface.tsx:124-146`, `:189-211`): a ghost `icon-xs` button, so
  // `mx-0.5 my-auto h-6 w-5` (2px sides, 24x20) around a 14px `ChevronLeft/Right`, shown only
  // while the track overflows and disabled only at that end of it. They live outside the
  // viewport, so the active tab is never behind them (§5).
  const tabScrollButton = (direction, disabled) => {
    const label = direction === "start" ? "Scroll tabs left" : "Scroll tabs right";
    const glyph = `mods/orca-tabs/chevron-${direction === "start" ? "left" : "right"}.svg`;
    return div().id(`tab-scroll-${direction}`).mx(2).w(20).h(24).flex_none().flex().items_center().justify_center().rounded(8)
      .text_color(disabled ? t.dim : t.muted)
      .when(!disabled, el => el.hover(s => s.bg(tint(t.foreground, 0.1)).text_color(t.foreground)).on_mouse_down("left", stop))
      .role("button").accessibility_label(label).tooltip(label)
      .on_click((_e, cx) => { if (!disabled) view.scrollTabStrip(direction, cx); })
      .child(svg(glyph).size(14).flex_none());
  };
  const item = (tab, index, mode) => renderTabItem(view, frame, tab, index, mode);
  return row
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
    .when(geometry.arrows.hasOverflow, el => el.child(view.glide(tabScrollButton("start", geometry.arrows.leftDisabled), "tab-scroll-start")))
    .child(view.glide(div(), "tab-viewport").flex_shrink(1).min_w(0).h_full().overflow_hidden()
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - view.viewportWidth) < 0.5) return;
        view.viewportWidth = size.width;
        cx.notify();
      })
      .on_scroll_wheel((e, cx) => view.wheelTabStrip(e, cx))
      .child(h_flex().id("tab-track").relative().left(-view.scrollX).h_full().items_center().gap(0).flex_none()
        .when(view.sliding(), el => el.transition("left", { duration: TAB_STRIP_SLIDE_MS, easing: "ease-out" }))
        .children(shown.map((c, i) => item(c, i, { hidden: geometry.docked && i === geometry.activeIndex }))))
      .when(geometry.docked, el => el.child(item(geometry.activeTab, geometry.activeIndex, { overlay: { ...geometry.slot, width: geometry.activeWidth }, sliding: view.sliding() }))))
    .when(geometry.arrows.hasOverflow, el => el.child(view.glide(tabScrollButton("end", geometry.arrows.rightDisabled), "tab-scroll-end")));
}

export function addEndControls(row, view, { t, paneDrag, shown, unified, w }) {
  // tab-bar-surface.tsx:221-227 — `ml-2 my-auto flex h-7 w-7 shrink-0 items-center
  // justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground`,
  // holding a Lucide `Plus` at `w-3.5 h-3.5` (14px). It is a DropdownMenuTrigger, not a bare
  // action: it opens the new-tab menu, which `orca-new-menu` provides.
  // `rounded-md` resolves to 8px, not 6: --radius .625rem x .8 (main.css:175,195).
  const tabNew = (action) => div().id("tab-new").ml(8).size(28).flex_none().flex().items_center().justify_center().rounded_full()
    .text_color(t.muted).hover(s => s.bg(tint(t.foreground, 0.1)).text_color(t.foreground))
    .role("button").accessibility_label("New tab").tooltip("New tab")
    .on_mouse_down("left", (e, cx) => { view.plusBounds = e.bounds; stop(e, cx); }).on_click(action)
    .child(svg("mods/orca-tabs/plus.svg").size(14).flex_none());
  const winBtn = (id, label, glyph, action, close) => div().id(id).w(46).h_full().flex_none().flex().items_center().justify_center()
    .text_color(t.muted).hover(s => s.bg(close ? "#c42b1c" : tint(t.foreground, 0.1)).text_color(close ? "#ffffff" : t.foreground))
    .role("button").accessibility_label(label).tooltip(label)
    .on_mouse_down("left", stop).on_click(action).child(glyph);
  // TitlebarMainStrip.tsx:12-33,76 — `RightSidebarToggle`: `.sidebar-toggle mr-2`
  // (main.css:1213-1230 = 4px/8px padding around the 16px `PanelRight`, so 32x24, radius 4,
  // muted, hover --accent + foreground). Herdr toggles it with `layout.toggle` (commands.rs:77).
  // The panel's own icon state: this copy only ever draws while the panel is hidden, so it always
  // offers `PanelRightOpen` (the arrow points back in), and `orca-panel-head` offers the close one.
  const panelToggle = (action) => div().id("panel-toggle").mr(8).w(32).h(24).flex_none().flex().items_center().justify_center().rounded(8)
    .text_color(t.muted).hover(s => s.bg(tint(t.foreground, 0.1)).text_color(t.foreground))
    .role("button").accessibility_label("Expand right sidebar").tooltip("Expand right sidebar")
    .on_mouse_down("left", stop).on_click(action)
    .child(svg("mods/orca-tabs/panel-right-open.svg").size(16));
  return row
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
    .child(view.glide(tabNew(() => openOverlay({ mod: "orca-new-menu", kind: "popup", width: 288, height: 512, at: view.newMenuAt() })), "tab-new"))
    .child(div().flex_1())
    // TitlebarMainStrip.tsx:58-69 — the single-tab case gets a `Minimize2`
    // (`showTitlebarExpandButton` = `!hasTabBar && effectiveActiveTabExpanded`,
    // use-app-chrome-layout.ts:129; hasTabBar is `tabCount >= 2`). `.titlebar-icon-button` is
    // 4px padding around a 14px glyph with `mr-2`, radius 4 (main.css:1288-1313).
    .when(shown.length === 1 && shown[0].zoomed, el => el.child(div().id("titlebar-collapse").mr(8).size(22).flex_none().flex().items_center().justify_center().rounded_full()
      .text_color(t.muted).hover(s => s.bg(tint(t.foreground, 0.1)).text_color(t.foreground))
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
    .when(find(layout(), "panel")?.hidden, el => el.child(panelToggle((_e, cx) => { if (unified) { view.wantPanelToggle = (view.wantPanelToggle ?? 0) + 1; cx.notify(); } else run("layout.toggle", { id: "panel" }); })))
    // WindowControls.tsx:27-30,42-49,60-67 — Orca replaces native chrome on Linux and Windows
    // with the same 10x10 SVG paths; only macOS keeps its traffic lights. Herdr reports
    // `buttons: false` here (the compositor owns decorations) but draws none of its own, so
    // the strip is the only place these actions exist — draw them on every non-macOS window.
    .when(w.platform !== "macos", el => el.child(h_flex().h_full().items_center()
      .child(winBtn("minimize", "Minimize", svg("mods/orca-tabs/win-min.svg").size(10), () => run("window.minimize"), false))
      .child(winBtn("maximize", "Maximize", svg(`mods/orca-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(10), () => run("window.maximize"), false))
      .child(winBtn("close-window", "Close window", svg("mods/orca-tabs/win-close.svg").size(10), () => run("window.close"), true))));
}
