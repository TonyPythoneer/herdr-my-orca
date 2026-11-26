// Derived from Herdr App's defaults/mods/tabs/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, openOverlay, panes, run, settings } from "herdr";
import { find, toggleLeft } from "./header-layout.js";
import { renderTabItem, stop, tint, TAB_STRIP_SLIDE_MS } from "./tab-item.js";

export function addSidebarToggle(row, view, { t, sidebar, w, leftPad }) {
  // .sidebar-toggle (main.css:1213-1230) — padding 4px 8px around a 16px glyph = 32x24,
  // radius 4, muted, hover --accent. .window-controls-btn (main.css:1145-1168) — 46x36,
  // square, muted, hover --accent, close hover #c42b1c.
  // TitlebarLeftControls.tsx:74-88 — Orca has ONE sidebar toggle, at the LEFT of the titlebar. This
  // header spans the sidebar too, so it draws that toggle always. Its glyph names what the click does
  // (`PanelLeftClose` while the column is open, `PanelLeftOpen` while it is hidden), and the label follows it.
  const sidebarToggle = (glyph, action, ml, label) => div().id("sidebar-toggle").ml(ml).mr(4).w(32).h(24).flex_none().flex().items_center().justify_center().rounded(8)
    .text_color(t.muted).hover(s => s.bg(tint(t.foreground, 0.1)).text_color(t.foreground))
    .role("button").accessibility_label(label).tooltip(label)
    .on_mouse_down("left", stop).on_click(action).child(glyph);
  return row
    // Same x (75, or 8 in full screen) in every state so the button does not jump on collapse.
    .child(sidebarToggle(svg(sharedAsset(`mods/orca-header/panel-left-${sidebar?.hidden ? "open" : "close"}.svg`)).size(16), (_e, ecx) => {
      // Same route as the `toggle-sidebar` command: the render consumes the flag with a live render
      // context. The `cx` captured by this render is dead once the click arrives.
      view.wantToggle = (view.wantToggle ?? 0) + 1;
      ecx.notify();
    }, toggleLeft(w, leftPad), sidebar?.hidden ? "Expand sidebar" : "Collapse sidebar"))
    // The tab strip starts on the card's left edge, i.e. at the sidebar's right edge
    // (or right after the toggle while the sidebar is hidden, or narrower than that).
    .when(!sidebar?.hidden, el => {
      const zoom = settings()?.zoom || 1;
      const toggleRight = toggleLeft(w) + 36;
      return el.child(div().id("unified-gap").w(Math.max(0, (sidebar?.size?.px ?? 0) / zoom - toggleRight)).h(1).flex_none());
    });
}

export function addTabTrack(row, view, frame) {
  const { t, geometry, shown } = frame;
  // Orca's chevrons (`tab-bar-surface.tsx:124-146`, `:189-211`): a ghost 20x24 button around a
  // 14px `ChevronLeft/Right`, shown only while the track overflows and disabled only at that end.
  // The 14px gutter beside each arrow lets an active edge fillet clear the clipped viewport.
  const tabScrollButton = (direction, disabled) => {
    const label = direction === "start" ? "Scroll tabs left" : "Scroll tabs right";
    const glyph = sharedAsset(`mods/orca-header/chevron-${direction === "start" ? "left" : "right"}.svg`);
    return div().id(`tab-scroll-${direction}`).w(20).h(24).flex_none().flex().items_center().justify_center().rounded(8)
      .when(direction === "start", el => el.ml(2).mr(16)).when(direction === "end", el => el.ml(16).mr(2))
      .text_color(disabled ? t.dim : t.muted)
      .when(!disabled, el => el.hover(s => s.bg(tint(t.foreground, 0.1)).text_color(t.foreground)).on_mouse_down("left", stop))
      .role("button").accessibility_label(label).tooltip(label)
      .on_click((_e, cx) => { if (!disabled) view.scrollTabStrip(direction, cx); })
      .child(svg(glyph).size(14).flex_none());
  };
  const item = (tab, index, mode) => renderTabItem(view, frame, tab, index, mode);
  const edgeFillet = (side, tab) => div().id(`tab-active-${side}-${tab.id}`).w(14).h_full().flex_none().relative()
    .when(side === "left", el => el.ml(-14)).when(side === "right", el => el.mr(-14))
    .child(div().absolute().bottom(0).size(14).overflow_hidden()
      .child(div().absolute().top(-28).when(side === "left", el => el.left(-28)).when(side === "right", el => el.left(-14))
        .size(56).rounded_full().border(14).border_color(t.background)));
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
    .when(geometry.arrows.hasOverflow, el => el.child(tabScrollButton("start", geometry.arrows.leftDisabled).id("tab-scroll-start").relative()))
    .when(geometry.arrows.hasOverflow && geometry.activeTab && geometry.slot.visualLeft <= 1, el => el.child(edgeFillet("left", geometry.activeTab)))
    .child(div().id("tab-viewport").relative().flex_shrink(1).min_w(0).h_full().overflow_hidden()
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
    .when(geometry.activeTab && geometry.slot.visualLeft + geometry.activeWidth >= geometry.slot.viewportWidth - 1, el =>
      el.child(edgeFillet("right", geometry.activeTab)))
    .when(geometry.arrows.hasOverflow, el => el.child(tabScrollButton("end", geometry.arrows.rightDisabled).id("tab-scroll-end").relative()));
}

export function addEndControls(row, view, { t, paneDrag, shown, w }) {
  // tab-bar-surface.tsx:221-227 — `ml-2 my-auto flex h-7 w-7 shrink-0 items-center
  // justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground`,
  // holding a Lucide `Plus` at `w-3.5 h-3.5` (14px). It is a DropdownMenuTrigger, not a bare
  // action: it opens the new-tab menu, which `orca-new-menu` provides.
  // `rounded-md` resolves to 8px, not 6: --radius .625rem x .8 (main.css:175,195).
  const tabNew = (action) => div().id("tab-new").ml(8).size(28).flex_none().flex().items_center().justify_center().rounded_full()
    .text_color(t.muted).hover(s => s.bg(tint(t.foreground, 0.1)).text_color(t.foreground))
    .role("button").accessibility_label("New tab").tooltip("New tab")
    .on_mouse_down("left", (e, cx) => { view.plusBounds = e.bounds; stop(e, cx); }).on_click(action)
    .child(svg("mods/orca-assets/plus--orca-header.svg").size(14).flex_none());
  const winBtn = (id, label, glyph, action, close) => div().id(id).w(46).h_full().flex_none().flex().items_center().justify_center()
    .text_color(t.muted).hover(s => s.bg(close ? "#c42b1c" : tint(t.foreground, 0.1)).text_color(close ? "#ffffff" : t.foreground))
    .role("button").accessibility_label(label).tooltip(label)
    .on_mouse_down("left", stop).on_click(action).child(glyph);
  // Keep the right-sidebar toggle in the tab header in both states, like the left-sidebar toggle.
  // The glyph names the action: open when hidden, close when visible.
  const panelHidden = Boolean(find(layout(), "panel")?.hidden);
  const panelToggle = (action) => div().id("panel-toggle").mr(8).w(32).h(24).flex_none().flex().items_center().justify_center().rounded(8)
    .text_color(t.muted).hover(s => s.bg(tint(t.foreground, 0.1)).text_color(t.foreground))
    .role("button").accessibility_label(panelHidden ? "Expand right sidebar" : "Collapse right sidebar").tooltip(panelHidden ? "Expand right sidebar" : "Collapse right sidebar")
    .on_mouse_down("left", stop).on_click(action)
    .child(svg(panelHidden ? "mods/orca-assets/panel-right-open.svg" : "mods/orca-assets/panel-right-close--orca-right-sidebar-header.svg").size(16));
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
    .child(tabNew(() => openOverlay({ mod: "orca-new-menu", kind: "popup", width: 288, at: view.newMenuAt() })).id("tab-new").relative())
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
      .child(svg("mods/orca-assets/minimize-2--orca-header.svg").size(14))))
    // Keep one right-sidebar toggle in the tab header for both open and closed states.
    .child(panelToggle((_e, cx) => { view.wantPanelToggle = (view.wantPanelToggle ?? 0) + 1; cx.notify(); }))
    // WindowControls.tsx:27-30,42-49,60-67 — Orca replaces native chrome on Linux and Windows
    // with the same 10x10 SVG paths; only macOS keeps its traffic lights. Herdr reports
    // `buttons: false` here (the compositor owns decorations) but draws none of its own, so
    // the strip is the only place these actions exist — draw them on every non-macOS window.
    .when(w.platform !== "macos", el => el.child(h_flex().h_full().items_center()
      .child(winBtn("minimize", "Minimize", svg("mods/orca-assets/win-min.svg").size(10), () => run("window.minimize"), false))
      .child(winBtn("maximize", "Maximize", svg(sharedAsset(`mods/orca-header/${w.maximized ? "win-restore" : "win-max"}.svg`)).size(10), () => run("window.maximize"), false))
      .child(winBtn("close-window", "Close window", svg("mods/orca-assets/win-close.svg").size(10), () => run("window.close"), true))));
}

const SHARED_ASSET_PATHS = Object.freeze({
  "mods/orca-header/chevron-left.svg": "mods/orca-assets/chevron-left--orca-header.svg",
  "mods/orca-header/chevron-right.svg": "mods/orca-assets/chevron-right--orca-header.svg",
  "mods/orca-header/close.svg": "mods/orca-assets/close--orca-header.svg",
  "mods/orca-header/git-branch.svg": "mods/orca-assets/git-branch--orca-header.svg",
  "mods/orca-header/minimize-2.svg": "mods/orca-assets/minimize-2--orca-header.svg",
  "mods/orca-header/plus.svg": "mods/orca-assets/plus--orca-header.svg"
});
function sharedAsset(path) {
  return SHARED_ASSET_PATHS[path] ?? `mods/orca-assets/${path.slice(path.lastIndexOf("/") + 1)}`;
}
