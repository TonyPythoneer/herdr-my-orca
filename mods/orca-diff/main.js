import { MIN_WIDTH, ROW, diffRows, diffWidth } from "./diff-rows.js";
import { diffBody } from "./diff.js";
import { themeColor } from "./theme-color.js";
import { SECTION, UNTRACKED_STATUS, loadDiff } from "./diff-data.js";
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, focused, nextCommand, panes, props, run, settings, shared, theme } from "herdr";

                             
const MOD = "orca-diff";
const TARGET_SHARED_KEY = `${MOD}.target`;
const RELOAD_INTERVAL_MS = 1e4;
const DEFAULT_FONT = "JetBrains Mono";
const CLOSE_LABEL = "Close diff";
const STAGED_LABEL = "Staged";
const isPresent = (value) => value !== void 0 && value !== null;
function diffTheme(source) {
	return {
		background: themeColor(source.background),
		foreground: themeColor(source.foreground),
		raised: themeColor(source.raised),
		selected: themeColor(source.selected),
		border: themeColor(source.border),
		muted: themeColor(source.muted),
		dim: themeColor(source.dim),
		hover: themeColor(source.hover),
		ansi1: themeColor(source.ansi1),
		ansi2: themeColor(source.ansi2)
	};
}
function monoFont() {
	return settings()?.font_family ?? DEFAULT_FONT;
}
function label(t) {
	if (t.all) return "uncommitted";
	if (t.sectionAll) return t.section === SECTION.staged ? STAGED_LABEL : "Unstaged + untracked";
	if (t.section === SECTION.staged) return STAGED_LABEL;
	return t.status === "U" ? "Untracked" : "Unstaged";
}
function title(target) {
	if (target.all) return "All changes";
	if (!target.sectionAll) return target.path;
	return target.section === SECTION.staged ? "Staged Changes" : "Changes";
}
var Diff = class extends View {
	target = null;
	rows = [];
	width = 300;
	loadGeneration = 0;
	init(_props, cx) {
		const value = props();
		this.target = value?.root ? props() : null;
		this.rows = [];
		this.width = 300;
		this.loadGeneration = 0;
		this.load(cx);
		cx.timer.every(RELOAD_INTERVAL_MS, (timerCx) => this.load(timerCx));
		cx.spawn(async (taskCx) => {
			for (;;) {
				if (await nextCommand() === "show") {
					const sharedTarget = shared(TARGET_SHARED_KEY);
					this.target = isPresent(sharedTarget) ? sharedTarget : this.target;
					this.load(taskCx);
				}
				taskCx.notify();
			}
		});
	}
	load(cx) {
		const t = this.target;
		if (!t) return;
		const generation = ++this.loadGeneration;
		cx.spawn(async (taskCx) => {
			try {
				const lines = await loadDiff(t, exec);
				if (this.target !== t || this.loadGeneration !== generation) return;
				this.rows = diffRows(lines);
			} catch (e) {
				if (this.target !== t || this.loadGeneration !== generation) return;
				this.rows = diffRows([`Cannot preview this diff: ${String(e)}`]);
			}
			this.width = diffWidth(this.rows);
			taskCx.notify();
		});
	}
	dismiss() {
		const mine = panes().filter((p) => p.mod === MOD && p.tab === focused()?.tab);
		if (mine.length === 1) run("pane.close", { pane: mine[0].pane });
	}
	empty(t) {
		return div().size_full().p(16).text_size(12).text_color(t.muted).child("Pick a file in Changes");
	}
	closeButton(t) {
		return div().id(`${MOD}-close`).w(22).h(22).flex().items_center().justify_center().rounded(6).cursor_pointer().role("button").accessibility_label(CLOSE_LABEL).tooltip(CLOSE_LABEL).text_color(t.muted).hover((s) => s.bg(t.hover)).on_click(() => this.dismiss()).child("×");
	}
	header(t, target) {
		const parts = title(target).split("/"), name = parts.pop();
		const add = this.rows.filter((r) => r.kind === ROW.added).length, del = this.rows.filter((r) => r.kind === ROW.removed).length;
		return h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).child(h_flex().flex_1().min_w(0).items_center().child(div().flex_none().max_w(320).truncate().font_semibold().child(name)).child(div().ml(6).flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(parts.join("/")))).when(add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${add}`))).when(del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${del}`))).child(div().px(6).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(label(target))).child(this.closeButton(t));
	}
	render(_cx) {
		const t = diffTheme(theme()), target = this.target;
		if (!target) return this.empty(t);
		return v_flex().id(MOD).size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13).child(this.header(t, target)).child(diffBody(t, monoFont(), this.rows, this.width));
	}
};

export { Diff as default };
