import { themeColor } from "./theme-color.js";
import { div, svg } from "gpui-kit";

                             
const MOTION = {
	duration: 200,
	easing: "ease-out"
};
const CHECK_INSET = 2;
const CHECK_SIZE = 14;
const CHECK_GLYPH_SIZE = 9;
const CHECK_ICON = "mods/orca-assets/check.svg";
const CHECK_MARK = "✓";
const MARK_WIDTH = 8;
function hoverHighlight(hovered, t, radius) {
	return div().absolute().inset_0().rounded(radius).bg(themeColor(t.hover)).opacity(hovered ? 1 : 0).transition("opacity", MOTION);
}
function selectedCheck(selected, t) {
	return div().when(selected, (el) => el.absolute().top(CHECK_INSET).right(CHECK_INSET).size(CHECK_SIZE).rounded_full().bg(themeColor(t.accent)).flex().items_center().justify_center().child(svg(CHECK_ICON).size(CHECK_GLYPH_SIZE).text_color(themeColor(t.surface))));
}
function selectionMark(selected, t) {
	return div().flex_none().w(MARK_WIDTH).flex().items_center().justify_center().when(selected, (el) => el.text_color(themeColor(t.accent)).child(CHECK_MARK));
}

export { hoverHighlight, selectedCheck, selectionMark };
