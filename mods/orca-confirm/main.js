import { themeColor } from "./theme-color.js";
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, props, run, setShared, theme } from "herdr";

                                
const ROOT_ID = "confirm";
const CANCEL_ID = "no";
const CONFIRM_ID = "yes";
const ENTER_KEY = "enter";
const ESCAPE_KEY = "escape";
const DEFAULT_TITLE = "Are you sure?";
const CANCEL_LABEL = "Cancel";
const CONFIRM_LABEL = "Confirm";
const ESCAPE_HINT = "Esc";
const RADIUS = 8;
const readConfirm = () => props();
const readDialog = () => props() ?? {};
const dismiss = () => {
	closeOverlay(readConfirm().overlay);
};
function readTheme() {
	const t = theme();
	return {
		input: themeColor(t.input),
		raised: themeColor(t.raised),
		foreground: themeColor(t.foreground),
		solid: themeColor(t.solid),
		solid_foreground: themeColor(t.solid_foreground),
		popover: themeColor(t.popover),
		dim: themeColor(t.dim),
		muted: themeColor(t.muted)
	};
}
function dialogHeader(t, title) {
	return h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(title)).child(div().text_size(11).text_color(t.dim).child(ESCAPE_HINT));
}
function dialogBody(t, detail) {
	return div().flex_1().min_h(0).overflow_y_scrollbar().text_color(t.muted).child(detail);
}
function confirmButton(id, label, style, onClick) {
	return h_flex().id(id).h(32).px(14).items_center().rounded(RADIUS).border_1().border_color(style.border).bg(style.bg).text_color(style.fg).cursor_pointer().hover((s) => s.opacity(.88)).on_click(onClick).child(label);
}
function dialogActions(t, onCancel, onConfirm) {
	return h_flex().justify_end().gap(8).text_size(12).child(confirmButton(CANCEL_ID, CANCEL_LABEL, {
		border: t.input,
		bg: t.raised,
		fg: t.foreground
	}, onCancel)).child(confirmButton(CONFIRM_ID, CONFIRM_LABEL, {
		border: t.solid,
		bg: t.solid,
		fg: t.solid_foreground
	}, onConfirm));
}
var Confirm = class extends View {
	handle;
	init(_props, cx) {
		this.handle = cx.focus_handle();
		this.handle.focus();
	}
	yes() {
		const p = readConfirm();
		if (p.confirmShared) setShared(p.confirmShared.key, p.confirmShared.value);
		closeOverlay(p.overlay);
		run(p.command.name, p.command.args ?? {});
	}
	render(_cx) {
		const t = readTheme();
		const p = readDialog();
		return v_flex().id(ROOT_ID).track_focus(this.handle).on_key_down((e, cx) => {
			if (e.key === ENTER_KEY) this.yes();
			else if (e.key === ESCAPE_KEY) dismiss();
			else return;
			cx.stop_propagation();
		}).size_full().min_h(0).p(18).gap(12).rounded(RADIUS).bg(t.popover).text_size(13).child(dialogHeader(t, p.title ?? DEFAULT_TITLE)).child(dialogBody(t, p.detail ?? "")).child(dialogActions(t, dismiss, () => this.yes()));
	}
};

export { Confirm as default };
