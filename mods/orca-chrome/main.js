// Derived from Herdr App's defaults/mods/workspace-chrome/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
import { View, div, image, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, props, window, setShared, shared, layout } from "herdr";
import { startTaskRunner } from "./runner.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Orca hides the sidebar (w-0, AppWorkspaceShell.tsx:159) and the toggle lives in the
// titlebar, outside it (TitlebarLeftControls.tsx). Same here: show/hide the column, and
// the toggle exists in both states, so a hidden sidebar is always recoverable.
const sidebarHidden = () => Boolean(find(layout(), "sidebar")?.hidden);

function toggleSidebar() {
  setShared("sidebar.collapsed", !sidebarHidden());
  run(sidebarHidden() ? "layout.show" : "layout.hide", { id: "sidebar" });
}

// Unified layout: while the sidebar is stepped narrower (orca-tabs `toggleSidebar`) its content
// keeps the open width and only fades and slides, so nothing reflows or truncates on the way.
// Opacity clamp((k-.15)/.85) and a -28px*(1-k) shift are the approved prototype's numbers.
// Untouched (returns `inner`) whenever the sidebar is at its open width or no open width is shared.
function sidebarFrame(inner) {
  const find = (n, id) => { if (n?.id === id) return n; for (const c of n?.children ?? []) { const r = find(c, id); if (r) return r; } return null; };
  if (!props()?.unified) return inner;
  const open = shared("sidebar.openPx");
  const px = find(layout(), "sidebar")?.size?.px;
  if (!(open > 0) || !(px > 0) || px >= open - 0.5) return inner;
  const k = px / open;
  // GPU cost: a group `opacity` makes the GPU draw the whole subtree off-screen every frame. A flat
  // cover in the sidebar's own colour, with the alpha the fade needs, is one blended quad.
  const bg = theme().surface;
  const cover = Math.max(0, Math.min(1, 1 - (k - 0.15) / 0.85));
  const alpha = Math.round(cover * 255).toString(16).padStart(2, "0");
  return div().size_full().overflow_hidden().relative()
    .child(div().w(open).h_full().relative().left(-(1 - k) * 28).child(inner))
    .child(div().absolute().top(0).left(0).right(0).bottom(0).bg(/^#[0-9a-f]{6}$/i.test(bg) ? `${bg}${alpha}` : bg));
}

// Glass surfaces for the header (the reference design's "liquid glass" look): translucent fills
// derived from the theme's own foreground, so both the dark and the light theme tint correctly.
function tint(hex, alpha) {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0");
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${a}` : hex;
}

export default class WorkspaceChrome extends View {
  // The Tasks page is a stack child, so its own copy only starts once it is first shown; the
  // schedule has to run from a block that is always in the layout. This footer copy is it.
  init(_props, cx) {
    if (props()?.footer) startTaskRunner(cx);
  }

  // `.titlebar-icon-button` is padding 4 + a 14px glyph = 22 (main.css:1288);
  // `.sidebar-toggle` is padding 4px 8px + a 16px glyph = 32x24 (main.css:1219).
  button(id, label, action, w = 22, h = 22) {
    const t = theme();
    return div().id(id).w(w).h(h).mr(4).flex_none().flex().items_center().justify_center().rounded(8).text_color(t.muted).hover(s => s.bg(tint(t.foreground, 0.1)).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = sidebarHidden();
    if (props()?.footer) {
      // Orca's sidebar footer: two 4px-gap clusters either side of the row
      // (SidebarToolbar.tsx:69-73). Each control is icon-xs 24px, rounded-md 8px,
      // with a 14px glyph (button.tsx:41, SidebarSettingsHelpMenu.tsx:203).
      const row = (id, icon, label, action) => div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(8)
        .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .role("button").accessibility_label(label).tooltip(label).on_click(action).child(svg(`mods/orca-chrome/${icon}.svg`).size(14));
      const footerBar = h_flex().size_full().items_center().justify_between().bg(props()?.unified ? t.surface : t.chrome).border_t(1).border_color(t.border).px(8).text_size(12)
        .child(h_flex().items_center().gap(4)
          // The Agent Manager is part of this layout's navigation: Settings is Herdr's native pane,
          // while the Agents page lives in the `main` stack (`main-agents`).
          .child(row("agents", "bot", "Agents", () => run("layout.select", { stack: "main", child: "main-agents" })))
          .child(row("providers", "hard-drive", "Model providers", () => run("layout.select", { stack: "main", child: "main-providers" })))
          // Schedules: the reset ping and anything else the person adds (orca-tasks).
          .child(row("tasks", "clock", "Tasks", () => run("layout.select", { stack: "main", child: "main-tasks" })))
          .child(row("settings", "settings", "Settings", () => run("app.settings")))
          // Herdr has no dropdown menu; Help opens the command surface. CircleHelp,
          // not CircleCheck (SidebarSettingsHelpMenu.tsx:233).
          .child(row("help", "circle-help", "Help", () => run("app.palette"))));
      return sidebarFrame(footerBar);
        // Orca's right cluster holds Reveal active workspace and Workspace board
        // (SidebarToolbar.tsx:76-112); neither has a Herdr command, so nothing is drawn.
        // The Herdr-only `+` (Add machine) that sat here is gone: Orca's footer has no plus.
    }
    // TitlebarLeftControls.tsx: with a custom titlebar (Linux/Windows) the row is the logo,
    // then the application-menu button; macOS instead reserves `.titlebar-traffic-light-pad`
    // (80px, main.css:1109-1113) or `pl-2` in full screen (line 62), and never shows the
    // app-name label or a logo. `···` opens the same command surface the sidebar's search
    // row does, since Herdr has no native app menu. Herdr's own logo replaces Orca's.
    // `window()` is null on the first paint; without a fallback the row is drawn as non-mac and
    // the toggle lands under the traffic lights. The layout's `traffic_lights` stands in until it reports.
    const live = window();
    if (live) this.win = live;
    const win = live ?? this.win;
    const mac = win ? win.platform === "macos" : Boolean(layout()?.traffic_lights);
    const leftPad = collapsed ? 6 : mac ? (win?.fullscreen ? 8 : 75) : 10;
    return h_flex().size_full().bg(t.chrome).pl(leftPad).pr(10).gap(4).items_center().border_b(1).border_color(t.border).text_size(13.5)
      .when(!collapsed && !mac, el => el.child(h_flex().gap(0).items_center()
        .child(image("frame/welcome/herdr.png").size(16).opacity(0.75))
        .child(this.button("menu", svg("mods/orca-chrome/menu.svg").size(14), () => run("mod.open", { name: "picker" })).tooltip("Menu"))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      // The glyph names what the click does (`PanelLeftClose` / `PanelLeftOpen`): the arrow points
      // into the column while the sidebar is open, and back out once it is hidden.
      .when(!(collapsed && mac), el => el.child(this.button("sidebar-toggle", svg(`mods/orca-chrome/panel-left-${collapsed ? "open" : "close"}.svg`).size(16), toggleSidebar, 32, 24).mr(4).tooltip(collapsed ? "Expand sidebar" : "Collapse sidebar")));
  }
}
