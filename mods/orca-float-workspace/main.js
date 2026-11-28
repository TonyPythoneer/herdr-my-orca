import { AGENT } from "./agent-catalog.js";
import { IconButton } from "./icon-button.js";
import { themeColor } from "./theme-color.js";
import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, keys, nextCommand, openOverlay, run, setShared, spaces, theme } from "herdr";

                                        
const MOD = "orca-float-workspace";
const DEFAULT_WIDTH = 920;
const DEFAULT_HEIGHT = 560;
const MIN_WIDTH = 420;
const MIN_HEIGHT = 280;
const WIDTH_MARGIN = 48;
const HEIGHT_MARGIN = 96;
const EMPTY_WIDTH = 360;
const POLL_MS = 1e3;
const IDLE_ALPHA = "66";
const LIST_BAR_ALPHA = "99";
const ROW_HOVER = "#4040402e";
const COMMAND_TOGGLE = "toggle";
const ACTION_NEW_TAB = "tab.new";
const ACTION_FOCUS_AGENT = "agent.focus";
const ACTION_TOGGLE = `${MOD}.toggle`;
const CHORD_ACTION_NEW_TAB = "orca-header.new-tab";
const SHARED_OPEN = `${MOD}.open`;
const SHARED_ATTENTION = `${MOD}.attention`;
const NEW_MENU_MOD = "orca-tab-dropdown";
const NEW_MENU_WIDTH = 288;
const TERMINAL_ICON = "mods/orca-assets/terminal-square.svg";
const MINIMIZE_ICON = "mods/orca-assets/minus--orca-float-workspace.svg";
const PLUS_ICON = "mods/orca-assets/plus--orca-float-workspace.svg";
const MONO_MARK = "mono";
const SVG_EXTENSION = ".svg";
const DROID = "droid";
const KILO = "kilo";
const AIDER = "aider";
const OWN_FILL_APPS =                 new Set([
	AGENT.omp,
	DROID,
	KILO
]);
const AGENT_MARKS = {
	[AGENT.codex]: MONO_MARK,
	[AGENT.omp]: "mods/orca-assets/omp.svg",
	[AGENT.gemini]: "mods/orca-assets/gemini.png",
	[AGENT.cursor]: "mods/orca-assets/cursor.png",
	[AGENT.grok]: "mods/orca-assets/grok.png",
	[AGENT.qoder]: "mods/orca-assets/qoder.png",
	[AGENT.hermes]: "mods/orca-assets/hermes.png",
	[AGENT["dsh-tui"]]: "mods/orca-assets/dsh.png",
	[DROID]: "mods/orca-assets/droid.svg",
	[KILO]: "mods/orca-assets/kilo.svg",
	[AIDER]: "mods/orca-assets/aider.svg"
};
const withAlpha = (color, alpha) => `${color}${alpha}`;
function floatTheme(raw) {
	return {
		foreground: themeColor(raw.foreground),
		muted: themeColor(raw.muted),
		border: themeColor(raw.border),
		raised: themeColor(raw.raised),
		hover: themeColor(raw.hover),
		working: themeColor(raw.working),
		blocked: themeColor(raw.blocked),
		done: themeColor(raw.done),
		idle: themeColor(raw.idle),
		background: themeColor(raw.background),
		dim: themeColor(raw.dim)
	};
}
function panelSize({ width, height }) {
	return {
		width: Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, width - WIDTH_MARGIN)),
		height: Math.min(DEFAULT_HEIGHT, Math.max(MIN_HEIGHT, height - HEIGHT_MARGIN))
	};
}
function chordOf(action) {
	return (keys() ?? []).find((k) => k.action === action)?.keys ?? "";
}
function stateDot(status, t) {
	const box = div().size(10).flex_none().flex().items_center().justify_center();
	if (status === "working") return box.child(svg("mods/orca-assets/agent-working-spinner.svg").size(6).flex_none().text_color(t.working).spin(1e3));
	if (status === "blocked") return box.child(svg("mods/orca-assets/message-circle-question.svg").size(10).flex_none().text_color(t.blocked));
	if (status === "done") return box.child(svg("mods/orca-assets/circle-check.svg").size(10).flex_none().text_color(t.done));
	return box.child(div().size(6).rounded_full().flex_none().bg(withAlpha(t.idle, IDLE_ALPHA)));
}
function agentMark(a, t) {
	const program = a.program;
	const app = a.app ?? "";
	const override = AGENT_MARKS[app];
	if (override === MONO_MARK) return program?.icon ? svg(program.icon).size(13).flex_none().text_color(t.muted) : null;
	if (override) return OWN_FILL_APPS.has(app) || !override.endsWith(SVG_EXTENSION) ? image(override).w(13).h(13).flex_none() : svg(override).size(13).flex_none().text_color(t.muted);
	if (!program?.icon) return null;
	return program.tint ? svg(program.icon).size(13).flex_none().text_color(t.muted) : image(program.icon).w(13).h(13).flex_none();
}
const title = (a) => a.title?.trim() || a.app || a.program?.name || "Agent";
function rowLabel(a) {
	return `${title(a)} — ${a.status} — ${a.app || a.program?.name || "agent"}, ${a.space_name || a.space || "space"}, ${a.tab_name || `tab ${a.tab_index}`}`;
}
function emptyRow(t, { id, icon, label, a11y, chord, onClick }) {
	return h_flex().id(id).h(32).w_full().px(12).gap(10).rounded(6).items_center().cursor_pointer().hover((s) => s.bg(t.hover)).role("button").accessibility_label(a11y).on_click(onClick).child(div().flex_none().opacity(.9).text_color(t.foreground).child(svg(icon).size(14))).child(div().flex_1().min_w(0).truncate().text_size(14).line_height("14px").text_color(t.foreground).child(label)).when(Boolean(chord), (el) => el.child(div().flex_none().text_size(10).line_height("12px").opacity(.9).text_color(t.foreground).child(chord)));
}
function openNewTerminal(hide, cx) {
	const space = spaces().find((s) => s.active);
	run(ACTION_NEW_TAB, space ? {
		space: space.id,
		...space.folder ? { folder: space.folder } : {}
	} : {});
	hide(cx);
}
function emptyHeading(t) {
	return h_flex().h(32).w_full().px(12).gap(10).rounded(6).items_center().child(div().flex_none().opacity(.9).text_color(t.foreground).child(svg(TERMINAL_ICON).size(14))).child(div().min_w(0).truncate().text_size(14).line_height("14px").text_color(t.foreground).child("No live agent sessions"));
}
function emptyState(t, chords, hide) {
	return v_flex().size_full().items_center().justify_center().child(v_flex().w(EMPTY_WIDTH).items_center().gap(6).child(emptyHeading(t)).child(emptyRow(t, {
		id: "orca-float-new",
		icon: TERMINAL_ICON,
		label: "New Terminal",
		a11y: "New terminal",
		chord: chords.newTab,
		onClick: (_e, cx) => openNewTerminal(hide, cx)
	})).child(emptyRow(t, {
		id: "orca-float-minimize",
		icon: MINIMIZE_ICON,
		label: "Minimize",
		a11y: "Minimize floating workspace",
		chord: chords.toggle,
		onClick: (_e, cx) => hide(cx)
	})));
}
function headerButton(t) {
	return {
		t,
		size: 24,
		radius: 6,
		border: t.border,
		bg: t.raised,
		color: t.foreground
	};
}
function header(t, hide) {
	return h_flex().h(36).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border).child(v_flex().flex_1().min_w(0).child(div().truncate().text_size(12).font_semibold().child("Floating Workspace")).child(div().truncate().text_size(11).text_color(t.muted).child("Live agent sessions"))).child(IconButton("orca-float-start-agent", "Start an agent", svg(PLUS_ICON).size(14).flex_none(), {
		...headerButton(t),
		onClick: () => openOverlay({
			mod: NEW_MENU_MOD,
			kind: "popup",
			frame: "none",
			width: NEW_MENU_WIDTH
		})
	})).child(IconButton("orca-float-close", "Hide floating workspace", "×", {
		...headerButton(t),
		textSize: 14,
		onClick: (_e, cx) => hide(cx)
	}));
}
function listBar(count, t) {
	return h_flex().h(32).flex_none().items_center().pl(12).pr(6).border_b(1).border_color(t.border).bg(withAlpha(t.raised, LIST_BAR_ALPHA)).child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().child(`${count} agent${count === 1 ? "" : "s"}`));
}
var FloatWorkspace = class extends View {
	open = false;
	published = {
		open: null,
		attention: null
	};
	seen = "";
	init(_props, cx) {
		cx.spawn(async (taskCx) => {
			for (;;) {
				if (await nextCommand() === COMMAND_TOGGLE) this.setOpen(!this.open, taskCx);
				taskCx.notify();
			}
		});
		cx.timer.every(POLL_MS, (tickCx) => {
			this.publish();
			const now = agents().map((a) => `${a.address}:${a.status}`).join(",");
			if (now === this.seen) return;
			this.seen = now;
			tickCx.notify();
		});
	}
	setOpen(open, cx) {
		if (this.open === open) return;
		this.open = open;
		this.publish();
		cx?.notify();
	}
	publish() {
		const attention = agents().some((a) => a.status === "blocked");
		if (this.published.open === this.open && this.published.attention === attention) return;
		this.published = {
			open: this.open,
			attention
		};
		setShared(SHARED_OPEN, this.open);
		setShared(SHARED_ATTENTION, attention);
	}
	row(a, t) {
		const mark = agentMark(a, t);
		return h_flex().id(`float-agent-${a.address}`).h(24).w_full().min_w(0).flex_none().pl(12).pr(6).gap(4).items_center().text_size(11).line_height("11px").text_color(t.muted).cursor_pointer().hover((s) => s.bg(ROW_HOVER)).role("button").accessibility_label(rowLabel(a)).on_click(() => run(ACTION_FOCUS_AGENT, { terminal: a.address })).child(stateDot(a.status, t)).when(mark !== null, (el) => mark ? el.child(mark) : el).child(div().min_w(0).flex_1().truncate().child(title(a)));
	}
	render() {
		if (!this.open) return div();
		const t = floatTheme(theme());
		const list = agents();
		const { width, height } = panelSize(window.viewport_size());
		const hide = (cx) => this.setOpen(false, cx);
		const chords = {
			newTab: chordOf(CHORD_ACTION_NEW_TAB),
			toggle: chordOf(ACTION_TOGGLE)
		};
		return v_flex().id(MOD).w(width).h(height).min_h(0).overflow_hidden().text_color(t.foreground).child(header(t, hide)).child(v_flex().flex_1().min_h(0).when(list.length > 0, (el) => el.child(listBar(list.length, t)).child(v_flex().id("orca-float-list").flex_1().min_h(0).overflow_y_scrollbar().children(list.map((a) => this.row(a, t))))).when(list.length === 0, (el) => el.child(emptyState(t, chords, hide))));
	}
};

export { FloatWorkspace as default };
