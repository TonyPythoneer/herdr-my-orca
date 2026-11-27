import { div } from "gpui-kit";

// The ghost icon control: a muted glyph in a box, with a tint on hover. Square by default; pass `w`/`h`
// for the titlebar's rectangles (`h: "full"` fills the row). `radius` is a number, "full" or null (square
// corners). `active` inverts it while its page is open, with no hover tint, or the inverted text vanishes.
// `disabled` keeps the glyph dim and draws no hover. The call site names the control,
// `IconButton("<id>", "<label>", glyph, {...})`, and ui-index reads both.
export function IconButton(id, label, glyph, {
  t, size = 24, w = null, h = null, radius = 6, tooltip = null, active = false, disabled = false,
  color = t.muted, hoverBg = t.hover, hoverFg = t.foreground, onClick,
}) {
  const box = div().id(id);
  const sized = w === null ? box.size(size) : h === "full" ? box.w(w).h_full() : box.w(w).h(h);
  const shaped = radius === null ? sized : radius === "full" ? sized.rounded_full() : sized.rounded(radius);
  const base = shaped.flex_none().flex().items_center().justify_center()
    .when(!disabled, el => el.cursor_pointer())
    .role("button").accessibility_label(label)
    .when(Boolean(tooltip), el => el.tooltip(tooltip))
    .on_click(onClick)
    .child(glyph);
  if (active) return base.bg(t.foreground).text_color(t.background);
  if (disabled) return base.text_color(t.dim);
  return base.text_color(color).hover(s => s.bg(hoverBg).text_color(hoverFg));
}
