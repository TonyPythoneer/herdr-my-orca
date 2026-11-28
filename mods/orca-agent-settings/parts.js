import { themeColor } from "./theme-color.js";
import { LIST_HEADER_HEIGHT } from "./state.js";
import { PERMISSION_SHORT_LABELS } from "./permissions.js";
import { IconButton } from "./icon-button.js";
import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings } from "herdr";

                                        
const monoFont = () => String(settings()?.font_family ?? "JetBrains Mono");
function badge(text, t, options) {
	const color = options.color ?? themeColor(t.muted);
	const bg = options.bg ?? null;
	return div().h(18).px(6).flex_none().flex().items_center().rounded(4).bg(bg === null ? themeColor(t.muted) : themeColor(bg)).when(options.border === true, (el) => el.border_1().border_color(themeColor(t.border))).text_size(10).font_medium().text_color(color).child(text);
}
function icon(row, size, t) {
	if (row.icon) {
		const iconPath = row.icon;
		if (row.tint) return svg(iconPath).size(size).flex_none().text_color(themeColor(t.muted));
		return image(iconPath).w(size).h(size).flex_none().rounded(3);
	}
	return div().size(size).flex_none().rounded(3).bg(themeColor(t.raised)).flex().items_center().justify_center().text_size(Math.round(size * .55)).text_color(themeColor(t.muted)).child((row.name ?? "?").slice(0, 1).toUpperCase());
}
function permissionBadge(choice, t) {
	return badge(PERMISSION_SHORT_LABELS[choice] ?? "Custom", t, {
		color: choice === "full-access" ? themeColor(t.blocked) : themeColor(t.muted),
		border: true
	});
}
function section(title, count, t, note, muted = false) {
	return h_flex().w_full().items_center().h(42).gap(8).pt(0).pb(0).child(div().text_size(13).font_semibold().text_color(muted ? themeColor(t.muted) : themeColor(t.foreground)).child(title)).child(badge(String(count), t, {
		border: true,
		color: muted ? themeColor(t.muted) : themeColor(t.accent)
	})).when(note !== void 0, (el) => el.child(div().text_size(11).text_color(themeColor(t.dim)).child(note))).child(div().flex_1());
}
function banner(text, t, options) {
	const borderColor = options.border ?? themeColor(t.blocked);
	const bgColor = options.bg === null ? themeColor(t.muted) : themeColor(options.bg);
	return h_flex().w_full().gap(8).p(10).rounded(8).border_1().border_color(borderColor).bg(bgColor).items_start().child(div().flex_none().text_size(12).text_color(options.color ?? themeColor(t.blocked)).child("!")).child(v_flex().flex_1().min_w(0).gap(4).child(div().text_size(12).text_color(options.color ?? themeColor(t.blocked)).child(text)).when(options.actions !== void 0, (el) => el.child(options.actions)));
}
function empty(text, t) {
	return div().w_full().p(16).rounded(8).border_1().border_color(themeColor(t.border)).border_dashed().text_size(12).text_color(themeColor(t.muted)).child(text);
}
function group(title, note, t) {
	return v_flex().w_full().pt(14).pb(2).gap(2).child(div().text_size(15).font_semibold().text_color(themeColor(t.foreground)).child(title)).child(div().text_size(11).text_color(themeColor(t.dim)).child(note));
}
function backButton(t, onClick) {
	return IconButton("am-back", "Back to terminals", svg("mods/orca-assets/chevron-left--orca-agent-settings.svg").size(16), {
		t,
		size: 28,
		tooltip: "Back to terminals",
		onClick
	});
}

export { backButton, badge, banner, empty, group, icon, monoFont, permissionBadge, section };
