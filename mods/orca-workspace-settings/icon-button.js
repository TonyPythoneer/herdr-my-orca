import { themeColor } from "./theme-color.js";
import { div } from "gpui-kit";

                            
const FULL_EXTENT = "full";
const DEFAULT_SIZE = 24;
const DEFAULT_RADIUS = 6;
function IconButton(id, label, glyph, options) {
	const { t, active = false, disabled = false, color = themeColor(t.muted), hoverBg = themeColor(t.hover), hoverFg = themeColor(t.foreground) } = options;
	const base = frame(id, label, glyph, options);
	if (active) return base.bg(themeColor(t.foreground)).text_color(themeColor(t.background));
	if (disabled) return base.text_color(themeColor(t.dim));
	return hover(base.text_color(color), hoverBg, hoverFg);
}
function frame(id, label, glyph, { size = DEFAULT_SIZE, w = null, h = null, radius = DEFAULT_RADIUS, border = null, bg = null, textSize = null, tooltip = null, disabled = false, onClick }) {
	const named = outline(corners(box(id, {
		size,
		w,
		h
	}).flex_none().flex().items_center().justify_center(), radius), {
		border,
		bg,
		textSize
	}).when(!disabled, (element) => element.cursor_pointer()).role("button").accessibility_label(label);
	return (tooltip ? named.tooltip(tooltip) : named).on_click(onClick).child(glyph);
}
function outline(element, { border, bg, textSize }) {
	let out = element;
	if (border !== null) out = out.border_1().border_color(border);
	if (bg !== null) out = out.bg(bg);
	if (textSize !== null) out = out.text_size(textSize);
	return out;
}
function box(id, { size, w, h }) {
	const element = div().id(id);
	if (w === null) return element.size(size);
	return h === FULL_EXTENT ? element.w(w).h_full() : element.w(w).h(h);
}
function corners(element, radius) {
	if (radius === FULL_EXTENT) return element.rounded_full();
	return radius === null ? element : element.rounded(radius);
}
function hover(element, bg, fg) {
	return element.hover((style) => (bg === null ? style : style.bg(bg)).text_color(fg));
}

export { IconButton };
