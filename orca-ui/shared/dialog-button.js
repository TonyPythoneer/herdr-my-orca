import { div } from "gpui-kit";

// A labelled text button for dialog footers and the tasks editor: a box with a label, an optional outline
// and fill. Hover changes the background when `hoverBg` is given and the text when `hoverFg` is, and nothing
// otherwise. A disabled button is dimmed and takes no hover, no press and no pointer. `name` is what a screen
// reader says; `tooltip` is for the pointer; `label` is what is drawn. The call site names the control,
// `DialogButton("<id>", "<label>", {...})`.
export function DialogButton(id, label, options) {
  const { name = label, tooltip = null, disabled = false, onClick, icon = null } = options;
  const named = box(id, options).role("button").accessibility_label(name);
  const tipped = tooltip === null ? named : named.tooltip(tooltip);
  const content = icon === null ? label : div().flex().items_center().gap(options.gap ?? 6).child(icon).child(label);
  if (disabled) return tipped.opacity(0.4).child(content);
  return hoverable(tipped.cursor_pointer().on_click(onClick), options).child(content);
}

// The box and its text: height (null for padding), padding, corners, label colour, fill and outline.
function box(id, { t, h = 32, py = 0, px = 12, rounded = 6, size = 12, medium = false, bg = null, color = t.foreground, border = null }) {
  let el = div().id(id);
  if (h !== null) el = el.h(h);
  if (py > 0) el = el.py(py);
  el = el.px(px).flex_none().flex().items_center().justify_center();
  if (rounded !== null) el = el.rounded(rounded);
  el = el.text_size(size).text_color(color);
  if (medium) el = el.font_medium();
  if (bg !== null) el = el.bg(bg);
  return border === null ? el : el.border_1().border_color(border);
}

// Hover: the background, the text colour and/or the opacity, only where the caller gave one.
function hoverable(el, { hoverBg = null, hoverFg = null, hoverOpacity = null }) {
  if (hoverBg === null && hoverFg === null && hoverOpacity === null) return el;
  return el.hover(s => hoverStyle(s, hoverBg, hoverFg, hoverOpacity));
}

function hoverStyle(s, bg, fg, opacity) {
  let out = s;
  if (bg !== null) out = out.bg(bg);
  if (fg !== null) out = out.text_color(fg);
  if (opacity !== null) out = out.opacity(opacity);
  return out;
}
