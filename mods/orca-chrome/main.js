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
const sidebarHidden = () => Boolean(find(layout(), "left-sidebar")?.hidden);

function toggleSidebar() {
  setShared("left-sidebar.collapsed", !sidebarHidden());
  run(sidebarHidden() ? "layout.show" : "layout.hide", { id: "left-sidebar" });
}

// Glass surfaces for the header (the reference design's "liquid glass" look): translucent fills
// derived from the theme's own foreground, so both the dark and the light theme tint correctly.
function tint(hex, alpha) {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0");
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${a}` : hex;
}

// Left padding of the titlebar row: 6 while the sidebar is hidden; on macOS 75 beside the
// traffic lights, or 8 in full screen; 10 on a custom titlebar.
function titlebarPad(collapsed, mac, win) {
  if (collapsed) return 6;
  if (!mac) return 10;
  return win?.fullscreen ? 8 : 75;
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
  // The leftmost block of the bottom status row (`status-footer`, 144px: 8px side, five 18px buttons, 8px gaps, the divider,
  // then 5px of spare so the divider is never clipped), in both layouts. It stays put when the left sidebar collapses, so it has no sidebar frame.
  footer(t) {
    // Each control is a rounded-md 8px button with a 14px glyph (SidebarSettingsHelpMenu.tsx:203),
    // 18px square so it fits the 20px status bar under its 1px top border.
    // `active` inverts the button while its page is open; no hover tint then, or the inverted text would vanish.
    const row = (id, icon, label, action, active = false) => {
      const base = div().id(id).size(18).flex_none().flex().items_center().justify_center().rounded(8).cursor_pointer()
        .role("button").accessibility_label(label).tooltip(label).on_click(action).child(svg(`mods/orca-chrome/${icon}.svg`).size(14));
      return active ? base.bg(t.foreground).text_color(t.background) : base.text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground));
    };
    const onAgents = find(layout(), "main")?.active === "main-agents";
    // Same fill and top border as orca-status, so the row reads as one bar.
    const footerBar = h_flex().size_full().items_center().bg(t.surface).border_t(1).border_color(t.border).pl(8).text_size(12)
      .child(h_flex().items_center().gap(8)
        // The Agent Manager is part of this layout's navigation: Settings is Herdr's native pane,
        // while the Agents page lives in the `main` stack (`main-agents`).
        .child(row("agents", "bot", "Agents", () => run("orca-tabs.agent-settings"), onAgents))
        .child(row("providers", "hard-drive", "Model providers", () => run("layout.select", { stack: "main", child: "main-providers" })))
        // Schedules: the reset ping and anything else the person adds (orca-tasks).
        .child(row("tasks", "clock", "Tasks", () => run("layout.select", { stack: "main", child: "main-tasks" })))
        .child(row("settings", "settings", "Settings", () => run("app.settings")))
        // Herdr has no dropdown menu; Help opens the command surface. CircleHelp,
        // not CircleCheck (SidebarSettingsHelpMenu.tsx:233).
        .child(row("help", "circle-help", "Help", () => run("app.palette")))
        // The divider between these buttons and the status text.
        .child(div().w(1).h(12).flex_none().bg(tint(t.muted, 0.5))));
    // Orca's right cluster (Reveal active workspace, Workspace board; SidebarToolbar.tsx:76-112) has
    // no Herdr command, so nothing is drawn. Orca's footer has no `+` (Add machine) either.
    return footerBar;
  }

  render() {
    const t = theme();
    const collapsed = sidebarHidden();
    if (props()?.footer) return this.footer(t);
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
    const leftPad = titlebarPad(collapsed, mac, win);
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
