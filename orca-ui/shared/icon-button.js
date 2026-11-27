import { div } from "gpui-kit";

// The ghost icon control: a muted glyph in a box, with a tint on hover. Square by default; pass `w`/`h`
// for the titlebar's rectangles (`h: "full"` fills the row). `radius` is a number, "full" or null (square
// corners). `border` and `bg` make the outline and fill of the outline buttons; `textSize` sizes a text glyph.
// `hoverBg: null` keeps the hover to the glyph's colour. `active` inverts it while its page is open, with no
// hover tint, or the inverted text vanishes. `disabled` keeps the glyph dim and draws no hover.
// The call site names the control, `IconButton("<id>", "<label>", glyph, {...})`, and ui-index reads both.
export function IconButton(id, label, glyph, options) {
  const { t, active = false, disabled = false, color = t.muted, hoverBg = t.hover, hoverFg = t.foreground } = options;
  const base = frame(id, label, glyph, options);
  if (active) return base.bg(t.foreground).text_color(t.background);
  if (disabled) return base.text_color(t.dim);
  return hover(base.text_color(color), hoverBg, hoverFg);
}

// Everything that is the same in every state: the box, the outline, the cursor, the name, the tooltip and the press.
function frame(id, label, glyph, { size = 24, w = null, h = null, radius = 6, border = null, bg = null, textSize = null,
  tooltip = null, disabled = false, onClick }) {
  const el = outline(corners(box(id, { size, w, h }).flex_none().flex().items_center().justify_center(), radius),
    { border, bg, textSize });
  return el.when(!disabled, x => x.cursor_pointer())
    .role("button").accessibility_label(label)
    .when(Boolean(tooltip), x => x.tooltip(tooltip))
    .on_click(onClick)
    .child(glyph);
}

// The outline and fill of an outline button, and the text size of a text glyph; only what the caller gave.
function outline(el, { border, bg, textSize }) {
  let out = el;
  if (border !== null) out = out.border_1().border_color(border);
  if (bg !== null) out = out.bg(bg);
  if (textSize !== null) out = out.text_size(textSize);
  return out;
}

// The box: a square of `size`, or a `w` x `h` rectangle (`h: "full"` fills the row).
function box(id, { size, w, h }) {
  const element = div().id(id);
  if (w === null) return element.size(size);
  return h === "full" ? element.w(w).h_full() : element.w(w).h(h);
}

// Corners last, after the layout calls, as the mods always wrote them.
function corners(element, radius) {
  if (radius === "full") return element.rounded_full();
  return radius === null ? element : element.rounded(radius);
}

// Hover changes the glyph colour, and the box tint unless the caller passes `null` for no tint.
function hover(element, bg, fg) {
  return element.hover(s => (bg === null ? s : s.bg(bg)).text_color(fg));
}
