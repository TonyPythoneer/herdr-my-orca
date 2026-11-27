import { div } from "gpui-kit";

// A labelled text button for dialog footers and the tasks editor: a box with a label, an optional outline
// and fill. Hover changes the background when `hoverBg` is given and the text when `hoverFg` is, and nothing
// otherwise. A disabled button is dimmed and takes no hover, no press and no pointer. `name` is what a screen
// reader says; `tooltip` is for the pointer; `label` is what is drawn. The call site names the control,
// `DialogButton("<id>", "<label>", {...})`.
export function DialogButton(id, label, options) {
  const { name = label, tooltip = null, disabled = false, onClick } = options;
  const named = box(id, options).role("button").accessibility_label(name);
  const tipped = tooltip === null ? named : named.tooltip(tooltip);
  if (disabled) return tipped.opacity(0.4).child(label);
  return hoverable(tipped.cursor_pointer().on_click(onClick), options).child(label);
}

// The box and its text: size, corners, label colour, fill and outline.
function box(id, { t, h = 32, px = 12, size = 12, medium = false, bg = null, color = t.foreground, border = null }) {
  let el = div().id(id).h(h).px(px).flex_none().flex().items_center().justify_center().rounded(6)
    .text_size(size).text_color(color);
  if (medium) el = el.font_medium();
  if (bg !== null) el = el.bg(bg);
  return border === null ? el : el.border_1().border_color(border);
}

// Hover: the background and/or the text colour, only where the caller gave one.
function hoverable(el, { hoverBg = null, hoverFg = null }) {
  if (hoverBg === null && hoverFg === null) return el;
  return el.hover(s => hoverStyle(s, hoverBg, hoverFg));
}

function hoverStyle(s, bg, fg) {
  let out = s;
  if (bg !== null) out = out.bg(bg);
  if (fg !== null) out = out.text_color(fg);
  return out;
}
