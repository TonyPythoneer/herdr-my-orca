import { themeColor } from "./theme-color.js";
import { div } from "gpui-kit";

                              
const DEFAULT_HEIGHT = 32;
const DEFAULT_RADIUS = 6;
const DEFAULT_PADDING_X = 12;
const DEFAULT_PADDING_Y = 0;
const DEFAULT_TEXT_SIZE = 12;
const DEFAULT_ICON_GAP = 6;
const DISABLED_OPACITY = .4;
function DialogButton(id, label, options) {
	const { name = label, tooltip = null, disabled = false, onClick, icon = null } = options;
	const named = box(id, options).role("button").accessibility_label(name);
	const tipped = tooltip === null ? named : named.tooltip(tooltip);
	const content = icon === null ? label : div().flex().items_center().gap(options.gap ?? DEFAULT_ICON_GAP).child(icon).child(label);
	if (disabled) return tipped.opacity(DISABLED_OPACITY).child(content);
	return hoverable(tipped.cursor_pointer().on_click(onClick), options).child(content);
}
function box(id, { t, h = DEFAULT_HEIGHT, py = DEFAULT_PADDING_Y, px = DEFAULT_PADDING_X, rounded = DEFAULT_RADIUS, size = DEFAULT_TEXT_SIZE, medium = false, bg = null, color = themeColor(t.foreground), border = null }) {
	return boxColor(boxShape(div().id(id), h, py, px, rounded), {
		size,
		medium,
		bg,
		color,
		border
	});
}
function boxShape(element, h, py, px, rounded) {
	let out = element;
	if (h !== null) out = out.h(h);
	if (py > 0) out = out.py(py);
	out = out.px(px).flex_none().flex().items_center().justify_center();
	return rounded === null ? out : out.rounded(rounded);
}
function boxColor(element, { size, medium, bg, color, border }) {
	let out = element.text_size(size).text_color(color);
	if (medium) out = out.font_medium();
	if (bg !== null) out = out.bg(bg);
	return border === null ? out : out.border_1().border_color(border);
}
function hoverable(element, { hoverBg = null, hoverFg = null, hoverOpacity = null }) {
	if (hoverBg === null && hoverFg === null && hoverOpacity === null) return element;
	return element.hover((style) => hoverStyle(style, hoverBg, hoverFg, hoverOpacity));
}
function hoverStyle(element, bg, fg, opacity) {
	let out = element;
	if (bg !== null) out = out.bg(bg);
	if (fg !== null) out = out.text_color(fg);
	if (opacity !== null) out = out.opacity(opacity);
	return out;
}

export { DialogButton };
