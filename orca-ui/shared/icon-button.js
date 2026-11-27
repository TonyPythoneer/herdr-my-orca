import { div } from "gpui-kit";

// The ghost icon control: square, muted, a `t.hover` tint on hover, one glyph inside. The agent-settings
// back arrow, the sidebar project and workspace actions, the status footer and the ports button use it.
// The titlebar controls and the status-port close button keep their own styles for now.
// `active` inverts it while its page is open, with no hover tint, or the inverted text vanishes.
// The call site names the control, `IconButton("<id>", "<label>", glyph, {...})`, and ui-index reads both.
export function IconButton(id, label, glyph, { t, size = 24, radius = 6, tooltip = null, active = false, onClick }) {
  const base = div().id(id).size(size).flex_none().flex().items_center().justify_center().rounded(radius)
    .cursor_pointer().role("button").accessibility_label(label)
    .when(Boolean(tooltip), el => el.tooltip(tooltip))
    .on_click(onClick)
    .child(glyph);
  return active
    ? base.bg(t.foreground).text_color(t.background)
    : base.text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground));
}
