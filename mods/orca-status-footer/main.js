// Derived from Herdr App's defaults/mods/workspace-chrome/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, layout } from "herdr";
import { startTaskRunner } from "./scheduler.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
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
    startTaskRunner(cx);
  }

  // The leftmost block of the bottom status row (`status-footer`, 144px: 8px side, five 18px buttons, 8px gaps, the divider,
  // then 5px of spare so the divider is never clipped). It stays put when the left sidebar collapses, so it has no sidebar frame.
  footer(t) {
    // Each control is a rounded-md 8px button with a 14px glyph (SidebarSettingsHelpMenu.tsx:203),
    // 18px square so it fits the 20px status bar under its 1px top border.
    // `active` inverts the button while its page is open; no hover tint then, or the inverted text would vanish.
    const row = (id, icon, label, action, active = false) => {
      const base = div().id(id).size(18).flex_none().flex().items_center().justify_center().rounded(8).cursor_pointer()
        .role("button").accessibility_label(label).tooltip(label).on_click(action).child(svg(`mods/orca-status-footer/${icon}.svg`).size(14));
      return active ? base.bg(t.foreground).text_color(t.background) : base.text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground));
    };
    const onAgents = find(layout(), "main")?.active === "main-agents";
    // Same fill and top border as orca-status-bar, so the row reads as one bar.
    const footerBar = h_flex().size_full().items_center().bg(t.surface).border_t(1).border_color(t.border).pl(8).text_size(12)
      .child(h_flex().items_center().gap(8)
        // The Agent Settings is part of this layout's navigation: Settings is Herdr's native pane,
        // while the Agents page lives in the `main` stack (`main-agents`).
        .child(row("agents", "bot", "Agents", () => run("orca-header.agent-settings"), onAgents))
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
    return this.footer(theme());
  }
}
