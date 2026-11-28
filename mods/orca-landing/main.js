import { themeColor } from "./theme-color.js";
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { keys, openOverlay, run, spaces, theme } from "herdr";

                                
const LANDING_ASSET_DIR = "mods/orca-landing";
const SHARED_ASSET_DIR = "mods/orca-assets";
const SHARED_ASSET_PATHS = Object.freeze({
	[`${LANDING_ASSET_DIR}/folder-plus.svg`]: `${SHARED_ASSET_DIR}/folder-plus--orca-landing.svg`,
	[`${LANDING_ASSET_DIR}/git-branch-plus.svg`]: `${SHARED_ASSET_DIR}/git-branch-plus--orca-landing.svg`
});
const ACTION = {
	newSpace: "space.new",
	previousSpace: "space.prev",
	nextSpace: "space.next"
};
const CREATE_WORKSPACE = "Create workspace";
const KEY_SEPARATOR = "+";
const BRAND_FOREGROUND = "#f0f0f0";
const BRAND_BACKGROUND = "#12181e";
const BRAND_BORDER = "#f0f0f033";
const KEYCAP_BACKGROUND = "#f0f0f00f";
const BUTTON_BACKGROUND = "#f0f0f012";
const BUTTON_HOVER_BACKGROUND = "#f0f0f01f";
const TEXT_SMALL = 12;
const TEXT_BODY = 14;
const ICON_SIZE = 14;
function sharedAsset(path) {
	return SHARED_ASSET_PATHS[path] ?? `${SHARED_ASSET_DIR}/${path.slice(path.lastIndexOf("/") + 1)}`;
}
function landingTheme(raw) {
	return {
		border: themeColor(raw.border),
		muted: themeColor(raw.muted),
		foreground: themeColor(raw.foreground),
		canvas: themeColor(raw.canvas)
	};
}
function keyCap(label, t) {
	return div().flex_none().h(20).min_w(24).px(6).py(2).flex().items_center().justify_center().rounded(4).border_1().border_color(t.border).bg(KEYCAP_BACKGROUND).text_size(TEXT_SMALL).font_medium().text_color(t.muted).child(label);
}
function combo(caps, t) {
	const row = h_flex().items_center().gap(4);
	caps.forEach((k, i) => {
		if (i) row.child(div().text_size(TEXT_SMALL).text_color(t.muted).child(KEY_SEPARATOR));
		row.child(keyCap(k, t));
	});
	return row;
}
function keysFor(action) {
	const found = (keys() ?? []).find((b) => b.action === action);
	return found ? String(found.keys).replace(/\s*\+\s*/g, KEY_SEPARATOR).split(KEY_SEPARATOR) : [];
}
function brandMark() {
	return div().size(80).flex_none().flex().items_center().justify_center().rounded(16).border_1().border_color(BRAND_BORDER).bg(BRAND_BACKGROUND).child(div().text_size(16).font_bold().text_color(BRAND_FOREGROUND).child("HERDR"));
}
function actionButton(id, icon, label, onClick, t) {
	return h_flex().id(id).flex_none().h(36).px(16).gap(6).items_center().rounded(6).border_1().border_color(t.border).bg(BUTTON_BACKGROUND).text_size(TEXT_BODY).font_medium().text_color(t.foreground).cursor_pointer().role("button").accessibility_label(label).hover((s) => s.bg(BUTTON_HOVER_BACKGROUND)).on_click(onClick).child(svg(sharedAsset(`${LANDING_ASSET_DIR}/${icon}.svg`)).size(ICON_SIZE).flex_none()).child(label);
}
function actionRow(t) {
	return h_flex().items_center().justify_center().gap(10).child(actionButton("landing-add", "folder-plus", "Add project", () => run(ACTION.newSpace), t)).child(actionButton("landing-create", "git-branch-plus", CREATE_WORKSPACE, () => openOverlay({
		mod: "orca-new-menu",
		kind: "popup",
		width: 288
	}), t));
}
function shortcutRow(label, action, t) {
	const ks = keysFor(action);
	return h_flex().w(320).items_center().justify_between().gap(12).child(div().text_size(TEXT_BODY).text_color(t.muted).child(label)).child(ks.length ? combo(ks, t) : div());
}
function shortcutList(t) {
	return v_flex().mt(24).gap(8).items_center().child(shortcutRow(CREATE_WORKSPACE, ACTION.newSpace, t)).child(shortcutRow("Move up workspace", ACTION.previousSpace, t)).child(shortcutRow("Move down workspace", ACTION.nextSpace, t));
}
function column(t, hasProjects) {
	return v_flex().items_center().gap(16).py(32).child(brandMark()).child(div().text_size(36).font_bold().text_color(t.foreground).child("Herdr Orca")).child(div().text_size(TEXT_BODY).text_center().text_color(t.muted).child(hasProjects ? "Select a project from the sidebar to begin." : "Add a project to get started.")).child(actionRow(t)).child(shortcutList(t));
}
var Landing = class extends View {
	render() {
		const t = landingTheme(theme());
		const hasProjects = (spaces() ?? []).length > 0;
		return v_flex().size_full().min_h(0).items_center().justify_center().bg(t.canvas).child(v_flex().w(512).px(24).items_center().child(column(t, hasProjects)));
	}
};

export { Landing as default };
