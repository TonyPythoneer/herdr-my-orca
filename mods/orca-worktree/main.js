import { themeColor } from "./theme-color.js";
import { REMOVE_UNAVAILABLE, removeWorktree } from "./remove.js";
import { ROOT, ago, branchRows, slug, spaceOf, switchBlocker, tilde } from "./helpers.js";
import { View, div } from "gpui-kit";
import { Input, InputState, Scrollbar, h_flex, v_flex } from "gpui-base";
import { agents, closeOverlay, exec, home, panes, props, run, spaces, theme } from "herdr";

                                 
const ACTION = {
	open: "open",
	switch: "switch",
	remove: "remove"
};
const KEY = {
	escape: "escape",
	enter: "enter",
	up: "up",
	down: "down"
};
const RUN = {
	spaceNew: "space.new",
	spaceSelect: "space.select"
};
const BRANCH_REF_ARGS = [
	"for-each-ref",
	"--format=%(refname:short)%09%(committerdate:unix)",
	"refs/heads"
];
const NO_FOLDER = "This folder";
const ELLIPSIS = "…";
const ESC_CLOSE = "esc close";
const NAV_HINT = "↑↓ choose · ";
const INPUT_FOCUS_DELAY_MS = 100;
const WORKTREE_ADD_TIMEOUT_MS = 6e5;
const SPINNER_FRAMES = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏"
];
const SPINNER_FRAME_MS = 90;
const PLACEHOLDER =                 new Map([[ACTION.open, "filter worktrees"], [ACTION.switch, "filter branches"]]);
const dialogProps = () => props();
const worktreeTheme = (colors) => ({
	popover: themeColor(colors.popover),
	accent: themeColor(colors.accent),
	input: themeColor(colors.input),
	background: themeColor(colors.background),
	foreground: themeColor(colors.foreground),
	dim: themeColor(colors.dim),
	selected: themeColor(colors.selected),
	hover: themeColor(colors.hover),
	muted: themeColor(colors.muted),
	blocked: themeColor(colors.blocked)
});
const notARepo = (folder, userHome) => `${folder ? tilde(folder, userHome) : NO_FOLDER} is not in a git repository.`;
const isCheckout = (row) => row !== void 0 && "path" in row;
const isBranchRow = (row) => row !== void 0 && "held" in row;
async function checkouts(repo, on) {
	const list = await git(repo.main, [
		"worktree",
		"list",
		"--porcelain"
	], on);
	if (!list.ok) return [];
	const refs = await git(repo.main, BRANCH_REF_ARGS, on);
	const when = new Map(refs.out.split("\n").map((l) => l.split("	")).map(([b, at]) => [b, Number(at) || 0]));
	const out = [];
	for (const block of list.out.split(/\n\n+/)) {
		const lines = block.split("\n");
		const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
		if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
		const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
		out.push({
			path,
			branch,
			main: out.length === 0,
			at: branch ? when.get(branch) ?? 0 : 0
		});
	}
	return out.sort((a, b) => Number(b.main) - Number(a.main) || b.at - a.at);
}
async function git(cwd, args, on, timeout) {
	const r = await exec("git", args, {
		cwd,
		on,
		...timeout === void 0 ? {} : { timeout }
	});
	return {
		ok: r.code === 0,
		out: (r.stdout ?? "").trim(),
		err: (r.stderr ?? r.stdout ?? "").trim()
	};
}
async function remoteHome(on) {
	let result;
	try {
		result = await exec("sh", ["-c", "printf %s \"$HOME\""], { on });
	} catch {}
	if (!result || result.code !== 0 || !result.stdout.trim()) result = await exec("powershell.exe", [
		"-NoProfile",
		"-Command",
		"[Console]::Write($HOME)"
	], { on });
	if (result.code !== 0 || !result.stdout.trim()) throw new Error("Could not find the remote home folder.");
	return result.stdout.trim().replace(/\\/g, "/");
}
async function repoOf(folder, on) {
	const top = await git(folder, ["rev-parse", "--show-toplevel"], on);
	const common = await git(folder, [
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir"
	], on);
	if (!top.ok || !common.ok) return null;
	const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
	return {
		top: top.out,
		main,
		common: common.out,
		name: main.split("/").pop() ?? "",
		linked: main !== top.out
	};
}
var Worktree = class extends View {
	initialIdentity;
	on;
	userHome;
	opening;
	switching;
	text;
	list;
	branches;
	current;
	blocker;
	at;
	input;
	inputFocused;
	handle;
	busy;
	error;
	repo;
	folder;
	init(_props, cx) {
		this.initialIdentity = this.identity();
		this.on = this.initialIdentity.on;
		this.userHome = this.on ? null : home();
		this.opening = dialogProps()?.action === ACTION.open;
		this.switching = dialogProps()?.action === ACTION.switch;
		this.text = dialogProps()?.branch ?? "";
		this.list = void 0;
		this.branches = void 0;
		this.current = null;
		this.blocker = "";
		this.at = 0;
		this.input = InputState.new({
			value: this.text,
			placeholder: PLACEHOLDER.get(dialogProps()?.action) ?? "branch name"
		});
		this.input.on("change", (_e, eventCx) => {
			this.text = this.input.value();
			this.error = "";
			this.at = 0;
			eventCx.notify();
		});
		this.input.on("submit", (_e, eventCx) => this.go(eventCx));
		this.inputFocused = true;
		this.input.on("focus", (_e, eventCx) => {
			this.inputFocused = true;
			eventCx.notify();
		});
		this.input.on("blur", (_e, eventCx) => {
			this.inputFocused = false;
			eventCx.notify();
		});
		this.handle = cx.focus_handle();
		this.handle.focus();
		if (dialogProps()?.action !== ACTION.remove) this.input.focus();
		this.busy = false;
		this.error = "";
		this.repo = void 0;
		cx.spawn((taskCx) => this.load(taskCx));
	}
	async load(cx) {
		try {
			if (this.on) this.userHome = await remoteHome(this.on);
			this.folder = this.initialIdentity.folder || this.userHome;
			await this.loadRepo();
			cx.notify();
			this.handle.focus();
			const p = dialogProps() ?? {};
			if (p.action !== ACTION.remove) cx.timer.after(INPUT_FOCUS_DELAY_MS, () => this.input.focus());
			if (p.branch) await this.work(cx);
		} catch (error) {
			this.repo = null;
			this.error = String(error);
			cx.notify();
		}
	}
	async loadRepo() {
		const repo = await repoOf(this.folder, this.on);
		if (repo && (this.opening || this.switching)) this.list = await checkouts(repo, this.on);
		if (repo && this.switching) await this.loadBranches(repo);
		this.repo = repo;
	}
	space() {
		const p = dialogProps() ?? {};
		return spaces().find((s) => s.id === p.space) ?? (p.folder ? {
			folder: p.folder,
			machine: p.machine ?? null,
			name: ""
		} : void 0);
	}
	identity() {
		const p = dialogProps() ?? {}, all = spaces(), s = p.space ? all.find((item) => item.id === p.space) : null;
		const space = {
			folder: s?.folder ?? null,
			machine: s?.machine ?? null
		};
		return {
			spaceId: p.space ?? null,
			folder: p.folder ?? space.folder,
			spaceFolder: space.folder,
			spaceMachine: space.machine,
			on: p.machine ?? space.machine,
			active: all.find((item) => item.active)?.id ?? null
		};
	}
	close() {
		closeOverlay(props().overlay);
	}
	go(cx) {
		if (this.busy || !this.repo || dialogProps()?.action === ACTION.remove) return;
		if (this.switching) return this.act(this.visible()[this.at], cx);
		cx.spawn((taskCx) => this.work(taskCx));
	}
	async work(cx) {
		if (this.busy || !this.repo) return;
		this.busy = true;
		this.error = "";
		cx.notify();
		try {
			this.error = props().action === ACTION.remove ? await this.remove() : await this.create();
		} catch (error) {
			this.error = String(error);
		}
		this.busy = false;
		if (!this.error) this.close();
		cx.notify();
	}
	async create() {
		const branch = this.text.trim();
		if (!branch) return "Type a branch name.";
		if (branch.startsWith("-")) return "Branch names cannot start with -.";
		if (!slug(branch)) return "Branch name must contain a letter or number.";
		const path = `${ROOT(this.userHome)}/${this.repo.name}/${slug(branch)}`;
		const add = (await git(this.repo.main, [
			"show-ref",
			"--verify",
			"--quiet",
			`refs/heads/${branch}`
		], this.on)).ok ? [
			"worktree",
			"add",
			path,
			branch
		] : [
			"worktree",
			"add",
			"-b",
			branch,
			path,
			"HEAD"
		];
		const r = await git(this.repo.top, add, this.on, WORKTREE_ADD_TIMEOUT_MS);
		if (!r.ok) return r.err || "git worktree add failed.";
		const p = props();
		run(RUN.spaceNew, {
			folder: path,
			machine: this.on ?? "",
			tab: p.tab,
			argv: p.argv
		});
		return "";
	}
	shown() {
		const f = this.text.trim().toLowerCase();
		return (this.list ?? []).filter((c) => !f || `${c.branch ?? ""} ${c.path}`.toLowerCase().includes(f));
	}
	branchList() {
		const f = this.text.trim().toLowerCase();
		return (this.branches ?? []).filter((b) => !f || b.branch.toLowerCase().includes(f));
	}
	visible() {
		if (this.opening) return this.shown();
		return this.switching ? this.branchList() : [];
	}
	act(row, cx) {
		if (this.opening) {
			if (isCheckout(row)) this.open(row);
		} else if (this.switching && isBranchRow(row)) this.switchTo(row, cx);
	}
	async loadBranches(repo) {
		const head = await git(this.folder, [
			"symbolic-ref",
			"--quiet",
			"--short",
			"HEAD"
		], this.on);
		const refs = await git(repo.main, BRANCH_REF_ARGS, this.on);
		const list = refs.ok && refs.out ? refs.out.split("\n").map((line) => line.split("	")).map(([branch, at]) => ({
			branch,
			at: Number(at) || 0
		})) : [];
		this.current = head.ok ? head.out : null;
		this.branches = branchRows(list, this.list ?? [], this.current);
		this.blocker = await this.blockerNow();
	}
	async blockerNow() {
		const status = await git(this.folder, ["status", "--porcelain"], this.on);
		const tabs = new Set((this.space()?.tabs ?? []).map((tab) => tab.id));
		const agentWorking = agents().some((a) => tabs.has(a.tab) && (a.status === "working" || a.status === "blocked"));
		const dirtyCount = status.ok ? status.out.split("\n").filter(Boolean).length : 0;
		return switchBlocker({
			agentWorking,
			statusKnown: status.ok,
			dirtyCount
		});
	}
	async switchTo(row, cx) {
		if (!row || row.current || row.held || this.busy) return;
		this.busy = true;
		this.error = "";
		cx.notify();
		const blocker = await this.blockerNow();
		if (blocker) {
			this.busy = false;
			this.blocker = this.error = blocker;
			cx.notify();
			return;
		}
		const r = await git(this.folder, ["switch", row.branch], this.on);
		this.busy = false;
		if (!r.ok) this.error = r.err || "git switch failed.";
		else this.close();
		cx.notify();
	}
	open(c) {
		if (!c) return;
		this.close();
		const s = spaceOf(c.path, this.list, this.on, spaces(), panes());
		if (s) run(RUN.spaceSelect, { id: s.id });
		else run(RUN.spaceNew, {
			folder: c.path,
			machine: this.on ?? ""
		});
	}
	async remove() {
		return removeWorktree();
	}
	key(e, cx) {
		if (e.key === KEY.escape) return this.close();
		if (this.opening || this.switching) {
			const rows = this.visible();
			const n = rows.length;
			if (e.key === KEY.enter) this.act(rows[this.at], cx);
			else if ((e.key === KEY.down || e.key === KEY.up) && n) this.at = (this.at + (e.key === KEY.down ? 1 : n - 1)) % n;
			else return;
			cx.stop_propagation();
			return cx.notify();
		}
		if (e.key === KEY.enter && dialogProps()?.action === ACTION.remove) return this.go(cx);
	}
	dialogFrame(t) {
		return v_flex().id("worktree").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx)).size_full().p(16).gap(10).bg(t.popover).text_size(13);
	}
	filterInput(t) {
		return Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1).border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_color(t.foreground);
	}
	footerRow(t, busy, text) {
		return h_flex().justify_end().text_size(11).text_color(t.dim).gap(6).when(busy, (el) => el.child(div().frames(SPINNER_FRAMES, SPINNER_FRAME_MS))).child(text);
	}
	rowList(t, id, rows, row, emptyText) {
		return div().relative().flex_1().min_h(0).child(v_flex().id(id).size_full().overflow_y_scroll().children(rows.map(row)).when(rows.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child(emptyText)))).child(Scrollbar.vertical(id).absolute().inset_0());
	}
	openRow(t, c, i, there) {
		const on = i === this.at;
		return v_flex().id(`wt-${i}`).flex_none().h(44).px(10).justify_center().rounded(7).cursor_pointer().when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover))).on_click(() => this.open(c)).child(h_flex().gap(8).items_center().child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.branch ?? "detached")).when(c.main, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("main checkout"))).when(Boolean(there), (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child("open"))).when(!there && c.at > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ago(c.at))))).child(div().truncate().text_size(11.5).text_color(t.dim).child(tilde(c.path, this.userHome ?? "")));
	}
	renderOpen(t) {
		const r = this.repo;
		const rows = this.shown();
		const all = this.list ?? [];
		const spaceList = spaces();
		const paneList = panes();
		const row = (c, i) => this.openRow(t, c, i, spaceOf(c.path, all, this.on, spaceList, paneList));
		const count = rows.length === all.length ? `${all.length} checkouts` : `${rows.length}/${all.length} checkouts`;
		return this.dialogFrame(t).child(h_flex().child(div().flex_1().font_semibold().text_color(t.foreground).child(`Open worktree${r ? ` of ${r.name}` : ""}`)).child(div().text_size(11).text_color(t.dim).child(r ? count : ""))).when(r === void 0 || r && this.list === void 0, (el) => el.child(div().text_color(t.muted).child(ELLIPSIS))).when(r === null, (el) => el.child(div().text_color(t.muted).child(notARepo(this.folder, this.userHome ?? "")))).when(Boolean(r && this.list), (el) => el.child(this.filterInput(t)).child(this.rowList(t, "wt-list", rows, row, "No matching worktrees."))).child(h_flex().justify_end().text_size(11).text_color(t.dim).child(`${NAV_HINT}↵ open · ${ESC_CLOSE}`));
	}
	branchTag(b) {
		if (b.current) return "current";
		return b.held ? `in ${b.held.split("/").pop()}` : "";
	}
	switchRow(t, b, i) {
		const on = i === this.at && !this.blocker;
		const disabled = b.current || Boolean(b.held);
		return h_flex().id(`br-${i}`).flex_none().h(32).px(10).gap(8).items_center().rounded(7).when(on && !disabled, (el) => el.bg(t.selected)).when(!on && !disabled, (el) => el.hover((s) => s.bg(t.hover))).when(disabled, (el) => el.opacity(.45)).when(!disabled, (el) => el.cursor_pointer().on_click((_e, cx) => void this.switchTo(b, cx))).child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(b.branch)).child(div().flex_none().text_size(11).text_color(b.current ? t.accent : t.dim).child(this.branchTag(b)));
	}
	switchDetail(r) {
		if (r === void 0) return ELLIPSIS;
		if (r === null) return notARepo(this.folder, this.userHome);
		return this.blocker || `Moves ${tilde(this.folder, this.userHome ?? "")} to the branch you pick.`;
	}
	branchesLoading(r) {
		return r === void 0 || Boolean(r && this.branches === void 0);
	}
	switchTarget(r) {
		return this.space()?.name || r?.name || "this checkout";
	}
	switchFooterText() {
		if (this.busy) return `switching${ELLIPSIS}`;
		return this.blocker ? ESC_CLOSE : `${NAV_HINT}↵ checkout · ${ESC_CLOSE}`;
	}
	renderSwitch(t) {
		const r = this.repo;
		const rows = this.blocker ? [] : this.branchList();
		const all = this.branches ?? [];
		const count = rows.length === all.length ? `${all.length} branches` : `${rows.length}/${all.length} branches`;
		const row = (b, i) => this.switchRow(t, b, i);
		const name = this.switchTarget(r);
		const detail = this.switchDetail(r);
		return this.dialogFrame(t).child(h_flex().child(div().flex_1().font_semibold().text_color(t.foreground).child(`Checkout branch in ${name}`)).child(div().text_size(11).text_color(t.dim).child(this.blocker ? "" : count))).when(this.branchesLoading(r), (el) => el.child(div().text_color(t.muted).child(ELLIPSIS))).when(Boolean(r) && this.branches !== void 0, (el) => el.child(div().text_color(this.blocker ? t.blocked : t.muted).child(detail))).when(Boolean(r && this.branches && !this.blocker), (el) => el.child(this.filterInput(t)).child(this.rowList(t, "br-list", rows, row, "No matching branches."))).when(Boolean(this.error) && this.error !== this.blocker, (el) => el.child(div().text_color(t.blocked).child(this.error))).child(div().flex_1()).child(this.footerRow(t, this.busy, this.switchFooterText()));
	}
	newDetail(remove, r) {
		if (remove) return REMOVE_UNAVAILABLE;
		if (r === void 0) return ELLIPSIS;
		if (r === null) return notARepo(this.folder, this.userHome);
		return `A new space on a checkout in ${tilde(ROOT(this.userHome), this.userHome)}/${r.name}/. A branch that exists is checked out; a new one starts from here.`;
	}
	newFooterText(remove, blocked) {
		if (this.busy) return "working…";
		if (blocked) return ESC_CLOSE;
		return remove ? "↵ remove · esc cancel" : "↵ create · esc cancel";
	}
	render(_cx) {
		const t = worktreeTheme(theme());
		if (this.opening) return this.renderOpen(t);
		if (this.switching) return this.renderSwitch(t);
		const remove = dialogProps()?.action === ACTION.remove;
		const s = this.space();
		const r = this.repo;
		const title = remove ? `Remove worktree ${s?.name ?? ""}?` : `New worktree${r ? ` of ${r.name}` : ""}`;
		const detail = this.newDetail(remove, r);
		const blocked = !r || remove;
		return this.dialogFrame(t).child(div().font_semibold().text_color(t.foreground).child(title)).child(div().text_color(t.muted).child(detail)).when(!remove && !blocked, (el) => el.child(this.filterInput(t))).when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error))).child(div().flex_1()).child(this.footerRow(t, this.busy, this.newFooterText(remove, blocked)));
	}
};

export { checkouts, Worktree as default };
