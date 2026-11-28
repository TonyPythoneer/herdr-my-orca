import { copyText } from "./clip.js";
import { buildBoundedSessionTranscript } from "./transcript.js";
import { closeSideTabs } from "./close-sides.js";
import { closeRows } from "./close-space.js";
import { themeColor } from "./theme-color.js";
import { COMMAND, CONFIRM_KIND, KEY, LABEL, MENU, OVERLAY_KIND, STATUS } from "./constants.js";
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, exec, hc, home, keys, openOverlay, panes, props, run, setShared, spaces, terminals, theme } from "herdr";

                                     
function menuProps() {
	return props();
}
function menuTheme() {
	const raw = theme();
	return {
		foreground: themeColor(raw.foreground),
		popover: themeColor(raw.popover),
		selected: themeColor(raw.selected),
		muted: themeColor(raw.muted),
		border: themeColor(raw.border)
	};
}
const _storedCache =                 new Map();
function stored(key, fallback) {
	try {
		const raw = globalThis.localStorage.getItem(key);
		const cached = _storedCache.get(key);
		if (cached && cached.raw === raw) return cached.value;
		const v = JSON.parse(raw ?? "null");
		const value = v && typeof v === "object" ? v : fallback;
		_storedCache.set(key, {
			raw,
			value
		});
		return value;
	} catch {
		return fallback;
	}
}
function place(s) {
	return s?.folder ?? null;
}
async function checkout(folder, on) {
	const top = await exec("git", ["rev-parse", "--show-toplevel"], {
		cwd: folder,
		on
	});
	const common = await exec("git", [
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir"
	], {
		cwd: folder,
		on
	});
	if (top.code !== 0 || common.code !== 0) return null;
	return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}
function tabsOf(space) {
	return space?.tabs ?? [];
}
function owningSpace(tabId) {
	return spaces().find((s) => tabsOf(s).some((x) => x.id === tabId));
}
function panesOfTab(tabId) {
	return panes().filter((x) => x.tab === tabId);
}
const LAYOUT_CHILD = {
	stack: "main",
	child: "main-terminals"
};
function terminalRow(label, command, term, tg) {
	return [
		label,
		command,
		{
			terminal: term.address,
			pane: tg.pane
		}
	];
}
function paneClipboardRows(tg, term, isAgent) {
	return [
		[
			"Copy",
			COMMAND.terminalCopy,
			{}
		],
		...term ? [terminalRow("Copy Terminal Buffer", COMMAND.selectAll, term, tg)] : [],
		[
			"Paste",
			COMMAND.terminalPaste,
			{}
		],
		[
			"Quick Commands",
			COMMAND.appPalette,
			{}
		],
		...term ? [
			...isAgent ? [terminalRow("Hand off to agent", COMMAND.handoff, term, tg)] : [],
			terminalRow("Fork Agent Session…", COMMAND.fork, term, tg),
			terminalRow("Copy Context", COMMAND.copyContext, term, tg)
		] : []
	];
}
function paneSplitRows(tg, term, hasSiblings) {
	return [
		[
			"Split Terminal Right",
			COMMAND.paneSplit,
			{
				direction: "right",
				pane: tg.pane
			}
		],
		[
			"Split Terminal Left",
			COMMAND.splitLeft,
			{ pane: tg.pane }
		],
		[
			"Split Terminal Down",
			COMMAND.paneSplit,
			{
				direction: "down",
				pane: tg.pane
			}
		],
		[
			"Split Terminal Up",
			COMMAND.splitUp,
			{ pane: tg.pane }
		],
		...hasSiblings ? [
			[
				"Move to New Tab",
				COMMAND.unsplitToTab,
				{
					pane: tg.pane,
					terminal: term?.address
				}
			],
			[
				"Swap with Left",
				COMMAND.paneSwap,
				{
					pane: tg.pane,
					direction: "left"
				}
			],
			[
				"Swap with Right",
				COMMAND.paneSwap,
				{
					pane: tg.pane,
					direction: "right"
				}
			],
			[
				"Swap with Above",
				COMMAND.paneSwap,
				{
					pane: tg.pane,
					direction: "up"
				}
			],
			[
				"Swap with Below",
				COMMAND.paneSwap,
				{
					pane: tg.pane,
					direction: "down"
				}
			]
		] : []
	];
}
function paneTitleRows(own, curTab) {
	if (!own?.tab) return [];
	return [[
		LABEL.setTitle,
		COMMAND.tabRename,
		{ id: own.tab }
	], ...curTab?.named ? [[
		LABEL.clearPaneTitle,
		COMMAND.tabRename,
		{
			id: own.tab,
			name: ""
		}
	]] : []];
}
function paneIdentityRows(term, parent, toProgram) {
	if (!term) return [];
	return [
		toProgram ? [
			"Use Herdr right-click menu",
			COMMAND.terminalRightClick,
			{
				terminal: term.address,
				to: "menu"
			}
		] : [
			"Send right-clicks to pane",
			COMMAND.terminalRightClick,
			{
				terminal: term.address,
				to: "program"
			}
		],
		...parent ? [[
			`Send back to ${parent.name || parent.address}`,
			COMMAND.terminalPark,
			{ terminal: term.address }
		]] : [],
		[
			"Copy Terminal ID",
			COMMAND.copyTerminal,
			{ id: term.address }
		]
	];
}
function paneCloseRows(tg, own, alone, curTab) {
	if (alone && curTab?.settled) return [];
	return alone ? [[
		"Close tab",
		COMMAND.tabClose,
		{ id: own?.tab }
	]] : [[
		"Close Pane",
		COMMAND.paneClose,
		{ pane: tg.pane }
	]];
}
function paneTerminal(tg) {
	const all = terminals();
	const term = all.find((t) => t.address === tg.terminal);
	return {
		term,
		parent: term?.parent ? all.find((t) => t.address === term.parent) : void 0,
		toProgram: term?.labels?.[KEY.rightClickLabel] === "program"
	};
}
function isWorking(x) {
	return x?.status === STATUS.working || x?.status === STATUS.blocked;
}
function paneIsAgent(own, term) {
	return Boolean(own?.program?.agent || isWorking(own) || term?.agent);
}
function paneItems(tg) {
	const { term, parent, toProgram } = paneTerminal(tg);
	const own = panes().find((x) => x.pane === tg.pane);
	const paneCount = own ? panesOfTab(own.tab).length : 0;
	const alone = Boolean(own) && paneCount < 2;
	const curTab = spaces().flatMap(tabsOf).find((t) => t.id === own?.tab);
	return [
		...paneClipboardRows(tg, term, paneIsAgent(own, term)),
		...paneSplitRows(tg, term, Boolean(own) && paneCount > 1),
		[
			own?.zoomed ? "Collapse Pane" : "Expand Pane",
			COMMAND.paneZoom,
			{ pane: tg.pane }
		],
		...paneTitleRows(own, curTab),
		...paneIdentityRows(term, parent, toProgram),
		[
			"Copy Pane ID",
			COMMAND.copyPaneId,
			{ id: tg.pane ?? "" }
		],
		...paneCloseRows(tg, own, alone, curTab),
		...term ? [terminalRow("Clear Screen", COMMAND.clearScreen, term, tg), terminalRow("Reset Terminal", COMMAND.resetTerminal, term, tg)] : []
	];
}
function moveTabRows(tg) {
	return [
		"right",
		"left",
		"down",
		"up"
	].map((direction) => [
		`Move Tab to Split ${direction[0].toUpperCase()}${direction.slice(1)}`,
		COMMAND.moveTabSplit,
		{
			id: tg.id,
			direction
		}
	]);
}
function closeSideRows(owner, tg) {
	return [...closeSideTabs(owner, tg.id, "right").length ? [[
		"Close Tabs to the Right",
		COMMAND.closeRight,
		{ id: tg.id }
	]] : [], ...closeSideTabs(owner, tg.id, "left").length ? [[
		"Close Tabs to the Left",
		COMMAND.closeLeft,
		{ id: tg.id }
	]] : []];
}
function tabItems(tg) {
	const owner = owningSpace(tg.id);
	const several = tabsOf(owner).length > 1;
	const tab = tabsOf(owner).find((x) => x.id === tg.id);
	const mine = panesOfTab(tg.id);
	const pane = (mine.find((x) => x.focused) ?? mine[0])?.pane;
	return [
		...several ? moveTabRows(tg) : [],
		...pane ? [[
			"Split terminal right",
			COMMAND.paneSplit,
			{
				direction: "right",
				pane
			}
		], [
			"Split terminal down",
			COMMAND.paneSplit,
			{
				direction: "down",
				pane
			}
		]] : [],
		tab?.settled ? [
			"Unpin Tab",
			COMMAND.tabUnsettle,
			{ id: tg.id }
		] : [
			"Pin Tab",
			COMMAND.tabSettle,
			{ id: tg.id }
		],
		[
			"Copy Tab ID",
			COMMAND.copyTabId,
			{ id: tg.id }
		],
		[
			"Close",
			COMMAND.tabClose,
			{ id: tg.id }
		],
		...several ? [[
			"Close Others",
			COMMAND.closeOthers,
			{ id: tg.id }
		]] : [],
		...closeSideRows(owner, tg),
		...mine.length > 1 ? [[
			"Close split pane",
			COMMAND.closeSplitPanes,
			{ id: tg.id }
		]] : [],
		[
			LABEL.changeTitle,
			COMMAND.tabRename,
			{ id: tg.id }
		]
	];
}
function worktreeArgs(space, folder, machine) {
	return {
		...space ? { space } : {},
		...folder ? { folder } : {},
		...machine ? { machine } : {}
	};
}
function groupItems(tg) {
	const open = spaces().some((s) => s.id === tg.id);
	const inGroup = (s) => s.id === tg.id || Boolean(tg.path && (s.folder === tg.path || s.folder?.startsWith(tg.path + "/")));
	const groupSpaces = spaces().filter(inGroup);
	const groupIds = (tg.spaces?.length ? tg.spaces : groupSpaces.map((s) => s.id)).filter((id) => spaces().some((s) => s.id === id));
	const openSpace = groupSpaces[0];
	const folder = tg.path ?? (openSpace ? place(openSpace) : null);
	const args = worktreeArgs(open ? tg.id : openSpace?.id, folder, tg.machine);
	return [
		[
			"New worktree",
			COMMAND.worktree,
			{
				...args,
				action: "new"
			}
		],
		[
			"Open worktree",
			COMMAND.worktree,
			{
				...args,
				action: "open"
			}
		],
		[
			"Copy Path",
			COMMAND.copyPath,
			{
				path: folder,
				id: tg.id
			}
		],
		...openSpace ? [[
			"Rename workspace",
			COMMAND.spaceRename,
			{ id: openSpace.id }
		]] : [],
		[
			"Delete all tabs",
			COMMAND.deleteAllTabs,
			{
				ids: tg.spaces ?? [],
				disabled: !unpinnedTabs(tg.spaces ?? []).length
			}
		],
		...closeRows(groupIds),
		...tg.repo && groupIds.length === 0 ? [[
			"Remove Project from Sidebar",
			COMMAND.forgetProject,
			{ repo: tg.repo }
		]] : []
	];
}
function worktreeRows(args, repo, linked) {
	return [...repo ? [
		[
			"New worktree",
			COMMAND.worktree,
			{
				...args,
				action: "new"
			}
		],
		[
			"Open worktree",
			COMMAND.worktree,
			{
				...args,
				action: "open"
			}
		],
		[
			"Checkout branch",
			COMMAND.worktree,
			{
				...args,
				action: "switch"
			}
		]
	] : [], ...linked ? [[
		"Remove worktree",
		COMMAND.worktree,
		{
			...args,
			action: "remove"
		}
	]] : []];
}
function worktreeFacts(tg, git) {
	const known = typeof tg.linked === "boolean";
	return {
		linked: known ? Boolean(tg.linked) : git === "linked",
		repo: known || git !== null
	};
}
function spaceItems(tg, git) {
	const open = spaces().some((s) => s.id === tg.id);
	const { linked, repo } = worktreeFacts(tg, git);
	const folder = tg.top || tg.folder || tg.path || null;
	const args = worktreeArgs(open ? tg.id : null, folder, tg.machine);
	return [
		...open ? [[
			"Update",
			COMMAND.spaceRename,
			{ id: tg.id }
		]] : [],
		[
			"Open in Terminal",
			COMMAND.terminalOpen,
			folder ? { folder } : {}
		],
		[
			"Copy Path",
			COMMAND.copyPath,
			{
				path: folder,
				id: tg.id
			}
		],
		[
			"Copy Worktree Name",
			COMMAND.copyName,
			{
				id: tg.id,
				name: tg.branch ?? null,
				folder
			}
		],
		[
			"Mark " + (tg.unread ? "Read" : "Unread"),
			COMMAND.toggleUnread,
			{ id: tg.id }
		],
		...worktreeRows(args, repo, linked),
		[
			"Delete all tabs",
			COMMAND.deleteAllTabs,
			{
				ids: [tg.id],
				disabled: !unpinnedTabs([tg.id]).length
			}
		],
		...open ? closeRows([tg.id], "Close") : [],
		...!open && tg.repo ? [[
			"Remove Project from Sidebar",
			COMMAND.forgetProject,
			{ repo: tg.repo }
		]] : []
	];
}
function globalItems() {
	return [
		[
			"New space",
			COMMAND.spaceNew,
			{}
		],
		[
			"Keybinds",
			COMMAND.appHelp,
			{}
		],
		[
			"Theme: graphite",
			COMMAND.appTheme,
			{ name: "graphite" }
		],
		[
			"Theme: ink",
			COMMAND.appTheme,
			{ name: "ink" }
		],
		[
			"Theme: moss",
			COMMAND.appTheme,
			{ name: "moss" }
		],
		[
			"Theme: atom one dark",
			COMMAND.appTheme,
			{ name: "atom-one-dark" }
		]
	];
}
function items(p, git) {
	const menu = p ?? {};
	const tg = menu.target ?? {};
	switch (menu.tab) {
		case MENU.pane: return paneItems(tg);
		case MENU.tab: return tabItems(tg);
		case MENU.group: return groupItems(tg);
		case MENU.space: return spaceItems(tg, git);
		default: return globalItems();
	}
}
function unpinnedTabs(ids) {
	const all = spaces();
	const out = [];
	const seen =                 new Set();
	for (const id of toList(ids)) {
		const me = all.find((s) => s.id === id);
		if (!me) continue;
		const sameCheckout = all.filter((s) => s.machine === me.machine && place(s) === place(me));
		for (const t of sameCheckout.flatMap(tabsOf)) {
			if (t.settled || seen.has(t.id)) continue;
			seen.add(t.id);
			out.push(t.id);
		}
	}
	return out;
}
function toList(ids) {
	if (Array.isArray(ids)) return ids;
	return ids == null ? [] : [ids];
}
function iconPath(name) {
	return sharedAsset(`mods/orca-context-menu/${name}.svg`);
}
function arrowIcon(args) {
	return `arrow-${args?.direction ?? "right"}`;
}
const WORKTREE_ICONS = {
	new: "git-branch-plus",
	open: "workflow",
	switch: "git-fork"
};
const ICON_BY_COMMAND = new Map([
	[COMMAND.forgetProject, () => "trash"],
	[COMMAND.modOpen, (_label, args) => args?.name === "orca-split-menu" ? "panel-right-close" : void 0],
	[COMMAND.paneSplit, (_label, args) => args?.direction === "down" ? "panel-bottom-close" : "panel-right-close"],
	[COMMAND.splitLeft, () => "arrow-left"],
	[COMMAND.splitUp, () => "arrow-up"],
	[COMMAND.moveTabSplit, (_label, args) => arrowIcon(args)],
	[COMMAND.unsplitToTab, () => "plus"],
	[COMMAND.paneSwap, (_label, args) => arrowIcon(args)],
	[COMMAND.paneZoom, (_label, _args, zoomed) => zoomed ? "minimize-2" : "maximize-2"],
	[COMMAND.worktree, (_label, args) => (args?.action ? WORKTREE_ICONS[args.action] : void 0) ?? "unlink"],
	[COMMAND.tabMove, (label) => label === LABEL.moveLeft ? "arrow-left" : "arrow-right"],
	[COMMAND.closeOthers, () => "x"],
	[COMMAND.deleteAllTabs, () => "x"],
	[COMMAND.closeSplitPanes, () => "x"],
	[COMMAND.tabSettle, () => "pin"],
	[COMMAND.tabUnsettle, () => "pin-off"],
	[COMMAND.handoff, () => "message-square-plus"],
	[COMMAND.fork, () => "git-fork"],
	[COMMAND.copyContext, () => "copy"],
	[COMMAND.selectAll, () => "text-select"],
	[COMMAND.clearScreen, () => "eraser"],
	[COMMAND.resetTerminal, () => "rotate-ccw"],
	[COMMAND.toggleUnread, (label) => label === LABEL.markRead ? "bell-off" : "bell"],
	...[
		COMMAND.copyPath,
		COMMAND.copyName,
		COMMAND.copyTerminal,
		COMMAND.copyPaneId,
		COMMAND.terminalCopy
	].map((command) => [command, () => "copy"]),
	[COMMAND.terminalPaste, () => "clipboard"],
	[COMMAND.terminalOpen, () => "folder-open"],
	[COMMAND.closeGroup, () => "x"],
	[COMMAND.appTheme, () => "settings"]
]);
const ICON_BY_SUFFIX = [
	[".close", "x"],
	[".rename", "pencil"],
	[".new", "plus"]
];
function menuIcon(it, zoomed) {
	const [label, command, args] = it;
	if (label === LABEL.clearPaneTitle) return iconPath("x");
	const named = ICON_BY_COMMAND.get(command)?.(label, args, zoomed);
	return iconPath(named ?? ICON_BY_SUFFIX.find(([suffix]) => command.endsWith(suffix))?.[1] ?? "terminal");
}
const SPLIT_COMMANDS = [
	COMMAND.paneSplit,
	COMMAND.splitLeft,
	COMMAND.splitUp,
	COMMAND.unsplitToTab
];
function isSplitRow(x) {
	return Boolean(x && SPLIT_COMMANDS.includes(x[1]));
}
const TITLE_BLOCK_COMMANDS = [
	COMMAND.tabRename,
	COMMAND.terminalRightClick,
	COMMAND.terminalPark,
	COMMAND.copyTerminal,
	COMMAND.copyPaneId
];
function isTitleRow(x) {
	return Boolean(x && (x[0] === LABEL.setTitle || TITLE_BLOCK_COMMANDS.includes(x[1])));
}
function paneBreak(it, prev) {
	if (isSplitRow(it) && !isSplitRow(prev)) return true;
	if (it[1] === COMMAND.paneSwap && prev[1] !== COMMAND.paneSwap) return true;
	if (it[1] === COMMAND.paneZoom && prev[1] !== COMMAND.paneZoom) return true;
	if (isTitleRow(it) && !isTitleRow(prev)) return true;
	return it[1] === COMMAND.clearScreen;
}
const TAB_BREAK_COMMANDS = [
	COMMAND.tabSettle,
	COMMAND.tabUnsettle,
	COMMAND.closeSplitPanes
];
function tabBreak(it) {
	return TAB_BREAK_COMMANDS.includes(it[1]) || it[0] === LABEL.changeTitle;
}
const SPACE_BREAK_COMMANDS = [
	COMMAND.terminalOpen,
	COMMAND.toggleUnread,
	COMMAND.forgetProject
];
function spaceBreak(it, prev) {
	if (it[1] === COMMAND.worktree) return prev[1] !== COMMAND.worktree;
	return SPACE_BREAK_COMMANDS.includes(it[1]);
}
const GROUP_BREAK_COMMANDS = [
	COMMAND.copyPath,
	COMMAND.spaceRename,
	COMMAND.forgetProject
];
function groupBreak(it) {
	return GROUP_BREAK_COMMANDS.includes(it[1]);
}
function globalBreak(it, prev) {
	return it[1] === COMMAND.appHelp || it[1] === COMMAND.appTheme && prev[1] !== COMMAND.appTheme;
}
const BREAK_BY_MENU = {
	pane: paneBreak,
	tab: tabBreak,
	space: spaceBreak,
	group: groupBreak,
	global: globalBreak
};
function section(p, list, i) {
	const it = list[i], prev = list[i - 1];
	if (!prev) return false;
	if (it[1] === COMMAND.deleteAllTabs) return true;
	if (it[1].endsWith(".close") || it[1] === COMMAND.closeGroup) return prev[1] !== COMMAND.deleteAllTabs;
	const menu = p?.tab || MENU.global;
	return Object.hasOwn(BREAK_BY_MENU, menu) ? BREAK_BY_MENU[menu](it, prev) : false;
}
function destructive() {
	return globalThis.window.appearance() === "dark" ? "#ff6568" : "#e40014";
}
const ALWAYS_DESTRUCTIVE = [
	COMMAND.paneClose,
	COMMAND.closeSplitPanes,
	COMMAND.deleteAllTabs,
	COMMAND.forgetProject
];
function isDestructive(p, it) {
	if (ALWAYS_DESTRUCTIVE.includes(it[1])) return true;
	if (p?.tab === MENU.pane) return it[1] === COMMAND.tabClose;
	return (p?.tab === MENU.space || p?.tab === MENU.group) && (it[1] === COMMAND.spaceClose || it[1] === COMMAND.closeGroup);
}
function shortcut(name, args) {
	const value = args && Object.values(args)[0];
	const k = (keys() ?? []).find((b) => b.action === name || b.action === `${name}:${value}`);
	return k ? k.keys : "";
}
const MODIFIER_GLYPHS = [
	["ctrl", "⌃"],
	["alt", "⌥"],
	["shift", "⇧"],
	["cmd", "⌘"]
];
function keyHint(chord) {
	let rest = String(chord ?? "");
	const held =                 new Set();
	let m = /^(cmd|ctrl|alt|shift)-/.exec(rest);
	while (m) {
		held.add(m[1]);
		rest = rest.slice(m[0].length);
		m = /^(cmd|ctrl|alt|shift)-/.exec(rest);
	}
	if (held.size === 0) return rest;
	return MODIFIER_GLYPHS.filter(([name]) => held.has(name)).map(([, glyph]) => glyph).join("") + rest.toUpperCase();
}
function tabLabel(tab, pane) {
	return tab.named ? tab.name ?? "Terminal" : pane?.title || pane?.program?.name || tab.name || "Terminal";
}
function leadPane(tabId) {
	const mine = panesOfTab(tabId);
	return mine.find((x) => x.program?.agent) ?? mine[0];
}
function contextHeader(p, t) {
	const tg = p?.target ?? {};
	const space = spaces().find((s) => s.id === tg.space) ?? owningSpace(tg.id);
	const tab = tabsOf(space).find((x) => x.id === tg.id);
	if (!tab) return div();
	const label = tabLabel(tab, leadPane(tab.id));
	const where = [space?.name, space?.branch].filter(Boolean).join(" · ");
	return v_flex().px(8).pt(6).pb(8).gap(3).child(h_flex().items_center().gap(7).child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(label)).when(Boolean(tab.settled), (el) => el.child(h_flex().flex_none().items_center().justify_center().p(4).rounded(5).border_1().border_color(t.border).child(svg("mods/orca-assets/pin.svg").size(10).text_color(t.muted))))).when(Boolean(where), (el) => el.child(div().truncate().text_size(10).text_color(t.muted).child(where)));
}
const CLOSE_ROW_COMMANDS = [
	COMMAND.tabClose,
	COMMAND.closeOthers,
	COMMAND.closeRight,
	COMMAND.closeLeft
];
function closeRow(p, it) {
	return p?.tab === MENU.tab && CLOSE_ROW_COMMANDS.includes(it[1]);
}
const INSET_COMMANDS = [
	COMMAND.copyTabId,
	COMMAND.closeOthers,
	COMMAND.closeRight,
	COMMAND.closeLeft
];
const ORCA_PREFIX = "orca-context-menu.";
const CONFIRM_DIALOG = {
	width: 384,
	height: 180
};
const PINNED_CLOSE_DIALOG = {
	width: 384,
	height: 200
};
const AGENT_CLOSE_DIALOG = {
	width: 384,
	height: 240
};
const COMMAND_CLOSE_DIALOG = {
	width: 384,
	height: 208
};
const WORKTREE_PICKER_DIALOG = {
	width: 560,
	height: 480
};
const WORKTREE_CONFIRM_DIALOG = {
	width: 440,
	height: 260
};
const HANDOFF_DIALOG = {
	width: 480,
	height: 380
};
const FORK_DIALOG = {
	width: 480,
	height: 320
};
const CONTEXT_LINES = 1e3;
const BUFFER_LINES = 1e4;
function openConfirmClose(confirmClose, size = CONFIRM_DIALOG) {
	openOverlay({
		mod: "orca-header",
		kind: OVERLAY_KIND.dialog,
		modal: true,
		...size,
		props: { confirmClose }
	});
}
function focusPane(args) {
	if (args?.pane) run(COMMAND.paneFocus, { pane: args.pane });
}
function paneArg(args) {
	return args?.pane ? { pane: args.pane } : {};
}
function targetSpace(p) {
	const target = p?.target ?? {};
	const space = spaces().find((s) => s.id === (target.id ?? ""));
	return {
		target,
		space,
		folder: space ? place(space) : ""
	};
}
function copyPath(args, { p, cx }) {
	const { target, space, folder } = targetSpace(p);
	copyText(args?.path || target.path || target.folder || target.top || folder || (space ? home() : ""), cx);
}
function customName({ target, space }) {
	return space?.named || target.named ? space?.name || target.name || null : null;
}
function folderName(args, { target, space, folder }) {
	return String(args?.folder ?? target.folder ?? target.path ?? folder ?? "").replace(/\/+$/, "").split("/").pop() || space?.name || "";
}
function displayName(args, at) {
	return customName(at) || args?.name || at.target.branch || folderName(args, at);
}
function copyName(args, { p, cx }) {
	copyText(displayName(args, targetSpace(p)), cx);
}
function forgetProject(args) {
	if (!args?.repo) return;
	setShared(KEY.projectsForget, {
		repo: args.repo,
		at: Date.now()
	});
	run(COMMAND.projectsForgetProject);
}
function toggleUnread(args) {
	try {
		const list = stored(KEY.unreadStorage, []);
		const set = new Set(Array.isArray(list) ? list : []);
		if (!set.delete(args.id)) set.add(args.id);
		const updated = [...set];
		globalThis.localStorage.setItem(KEY.unreadStorage, JSON.stringify(updated));
		setShared(KEY.unreadStorage, updated);
	} catch {}
}
function closeOthers(args) {
	const tabIds = tabsOf(owningSpace(args.id)).filter((x) => x.id !== args.id && !x.settled).map((x) => x.id);
	if (tabIds.length > 0) openConfirmClose({
		kind: CONFIRM_KIND.bulk,
		scope: "others",
		tabIds
	});
}
function closeSide(side) {
	return (args) => {
		const tabIds = closeSideTabs(owningSpace(args.id), args.id, side);
		if (tabIds.length > 0) openConfirmClose({
			kind: CONFIRM_KIND.bulk,
			scope: side,
			tabIds
		});
	};
}
function deleteAllTabs(args) {
	const ids = unpinnedTabs(args.ids ?? [args.id]);
	if (ids.length === 0) return;
	const wanted = new Set(ids);
	const owners = new Set(spaces().filter((s) => tabsOf(s).some((t) => wanted.has(t.id))).map((s) => `${s.machine ?? ""}\u0000${place(s)}`));
	const detail = owners.size > 1 ? `${ids.length} tabs in ${owners.size} worktrees` : void 0;
	openConfirmClose({
		kind: CONFIRM_KIND.bulk,
		scope: "all",
		tabIds: ids,
		...detail ? { detail } : {}
	});
}
function closeSplitPanes(args) {
	const mine = panesOfTab(args.id);
	const keep = mine.find((x) => x.focused) ?? mine[0];
	for (const x of mine) if (x !== keep) run(COMMAND.paneClose, { pane: x.pane });
}
function splitThenSwap(direction) {
	return (args) => {
		const pane = args?.pane ?? panes().find((p) => p.focused)?.pane;
		if (!pane) return;
		focusPane({ pane });
		run(COMMAND.paneSplit, {
			direction,
			pane
		});
		run(COMMAND.paneSwap, {
			direction,
			pane
		});
	};
}
function copyContext(args, { cx }) {
	if (!args.terminal) return;
	focusPane(args);
	hc([
		"read",
		"--lines",
		String(CONTEXT_LINES),
		args.terminal
	]).then((r) => {
		if (!r?.stdout) return;
		const clean = buildBoundedSessionTranscript(r.stdout);
		if (clean) copyText(clean, cx);
	}).catch(() => {});
}
function selectAll(args, { cx }) {
	if (!args.terminal) return;
	focusPane(args);
	hc([
		"read",
		"--lines",
		String(BUFFER_LINES),
		args.terminal
	]).then((r) => {
		if (r?.code === 0 && r.stdout.trim()) copyText(r.stdout, cx);
	}).catch(() => {});
}
function writeToTerminal(hcArgs) {
	return (args) => {
		if (!args.terminal) return;
		focusPane(args);
		hc(hcArgs(args.terminal));
	};
}
function terminalDialog(size, action) {
	return (args) => {
		focusPane(args);
		openOverlay({
			mod: "orca-handoff",
			kind: OVERLAY_KIND.dialog,
			...size,
			props: {
				action,
				terminal: args.terminal,
				pane: args.pane
			}
		});
	};
}
function copyId(args, { cx }) {
	copyText(args.id, cx);
}
const ORCA_ACTIONS =                 new Map([
	[COMMAND.copyTabId, (args, { cx }) => copyText(`orcaTabId: ${args.id}`, cx)],
	[COMMAND.copyPath, copyPath],
	[COMMAND.copyName, copyName],
	[COMMAND.closeGroup, (args) => {
		for (const id of args?.ids ?? []) run(COMMAND.spaceClose, {
			id,
			confirmed: true
		});
	}],
	[COMMAND.forgetProject, forgetProject],
	[COMMAND.toggleUnread, toggleUnread],
	[COMMAND.closeOthers, closeOthers],
	[COMMAND.closeRight, closeSide("right")],
	[COMMAND.closeLeft, closeSide("left")],
	[COMMAND.deleteAllTabs, deleteAllTabs],
	[COMMAND.moveTabSplit, (args) => setShared(KEY.headerAction, {
		kind: "move-tab-split",
		tab: args.id,
		direction: args.direction
	})],
	[COMMAND.unsplitToTab, (args) => setShared(KEY.headerAction, {
		kind: "unsplit-to-tab",
		terminal: args.terminal,
		pane: args.pane
	})],
	[COMMAND.closeSplitPanes, closeSplitPanes],
	[COMMAND.splitLeft, splitThenSwap("right")],
	[COMMAND.splitUp, splitThenSwap("down")],
	[COMMAND.copyTerminal, copyId],
	[COMMAND.copyPaneId, copyId],
	[COMMAND.copyContext, copyContext],
	[COMMAND.handoff, terminalDialog(HANDOFF_DIALOG, "handoff")],
	[COMMAND.fork, terminalDialog(FORK_DIALOG, "fork")],
	[COMMAND.selectAll, selectAll],
	[COMMAND.clearScreen, writeToTerminal((terminal) => [
		"keys",
		terminal,
		"ctrl+l"
	])],
	[COMMAND.resetTerminal, writeToTerminal((terminal) => [
		"send",
		terminal,
		"reset"
	])]
]);
function copyOrPaste(args, { p, command }) {
	const tg = p?.target ?? {};
	if (tg.pane || tg.terminal) run(COMMAND.paneFocus, tg.pane ? { pane: tg.pane } : { terminal: tg.terminal });
	run(command, args);
}
function splitPane(args, { p }) {
	const tabId = p?.target?.id;
	if (p?.tab === MENU.tab && tabId) run(COMMAND.tabSelect, { id: tabId });
	focusPane(args);
	run(COMMAND.paneSplit, args);
}
function openTerminalInSpace(args, { p, command }) {
	if (p?.tab !== MENU.space) {
		run(command, args);
		return;
	}
	const tg = p?.target ?? {};
	if (spaces().some((s) => s.id === tg.id)) {
		run(COMMAND.spaceSelect, { id: tg.id });
		run(COMMAND.terminalOpen, args);
	} else {
		const folder = args?.folder || tg.folder || tg.top || tg.path;
		run(COMMAND.spaceNew, worktreeArgs(null, folder, tg.machine));
	}
	run(COMMAND.layoutSelect, { ...LAYOUT_CHILD });
}
function openWorktreeDialog(args) {
	const picker = args.action === "open" || args.action === "switch";
	openOverlay({
		mod: "orca-worktree",
		kind: OVERLAY_KIND.dialog,
		...picker ? WORKTREE_PICKER_DIALOG : WORKTREE_CONFIRM_DIALOG,
		props: args
	});
}
function closeTab(args) {
	const tab = tabsOf(owningSpace(args.id)).find((x) => x.id === args.id);
	if (tab && !confirmCloseTab(tab)) return;
	run(COMMAND.tabClose, args);
}
function confirmCloseTab(tab) {
	const tabPanes = panesOfTab(tab.id);
	const label = tabLabel(tab, tabPanes.find((x) => x.program?.agent) ?? tabPanes[0]);
	if (tab.settled && !storageFlag(KEY.confirmClosePinnedTab, "false")) {
		openConfirmClose({
			kind: CONFIRM_KIND.pinned,
			tabId: tab.id,
			tabLabel: label
		}, PINNED_CLOSE_DIALOG);
		return false;
	}
	const isAgent = tabPanes.some((x) => x.program?.agent || x.status === STATUS.working || x.status === STATUS.blocked) || tab.status === STATUS.working || tab.status === STATUS.blocked;
	const isRunningCommand = tabPanes.some((x) => x.program && !x.program.shell && !x.program.agent);
	if (storageFlag(KEY.skipCloseRunningProcess, "true") || !(isAgent || isRunningCommand)) return true;
	openConfirmClose({
		kind: isAgent ? CONFIRM_KIND.agent : CONFIRM_KIND.command,
		tabId: tab.id,
		tabLabel: label
	}, isAgent ? AGENT_CLOSE_DIALOG : COMMAND_CLOSE_DIALOG);
	return false;
}
function storageFlag(key, value) {
	try {
		return globalThis.localStorage.getItem(key) === value;
	} catch {
		return false;
	}
}
const HOST_ACTIONS =                 new Map([
	[COMMAND.terminalCopy, copyOrPaste],
	[COMMAND.terminalPaste, copyOrPaste],
	[COMMAND.paneSwap, (args) => {
		focusPane(args);
		run(COMMAND.paneSwap, {
			direction: args.direction,
			...paneArg(args)
		});
	}],
	[COMMAND.paneZoom, (args) => {
		focusPane(args);
		run(COMMAND.paneZoom, args);
	}],
	[COMMAND.paneSplit, splitPane],
	[COMMAND.terminalOpen, openTerminalInSpace],
	[COMMAND.worktree, openWorktreeDialog],
	[COMMAND.tabClose, closeTab]
]);
function rowColor(accent, off, { t, bad }) {
	if (accent) return bad;
	return off ? t.muted : t.foreground;
}
function dismiss(p) {
	closeOverlay(p?.overlay);
}
var Menu = class extends View {
	at = 0;
	git = null;
	handle = { focus: () => {} };
	init(_props, cx) {
		this.at = 0;
		this.git = null;
		this.handle = cx.focus_handle();
		this.handle.focus();
		const p = menuProps();
		const tg = p?.target ?? {};
		const space = p?.tab === MENU.space ? spaces().find((s) => s.id === tg.id) : void 0;
		const folder = space ? place(space) : tg.folder ?? tg.top ?? null;
		if (p?.tab === MENU.space && folder && typeof tg.linked !== "boolean") cx.spawn(async (taskCx) => {
			this.git = await checkout(folder, tg.machine ?? space?.machine ?? null).catch(() => null);
			taskCx.notify();
		});
	}
	choose(i, cx) {
		const p = menuProps();
		const it = items(p, this.git)[i];
		if (!it || it[2]?.disabled) return;
		const [, command, args] = it;
		const isOrca = command.startsWith(ORCA_PREFIX);
		const action = (isOrca ? ORCA_ACTIONS : HOST_ACTIONS).get(command);
		if (action) action(args, {
			p,
			cx,
			command
		});
		else if (!isOrca) run(command, args);
		dismiss(p);
	}
	onKey(e, cx, count) {
		if (e.key === "down") this.at = (this.at + 1) % count;
		else if (e.key === "up") this.at = (this.at + count - 1) % count;
		else if (e.key === "home") this.at = 0;
		else if (e.key === "end") this.at = count - 1;
		else if (e.key === "enter" || e.key === "space") this.choose(this.at, cx);
		else if (e.key === "escape") dismiss(menuProps());
		else return;
		cx.notify();
	}
	row(p, list, i, look) {
		const { t, zoomed, bad } = look;
		const it = list[i];
		const off = Boolean(it[2]?.disabled);
		const red = !off && isDestructive(p, it);
		const current = i === this.at && !off;
		const warn = closeRow(p, it) && current;
		const inset = INSET_COMMANDS.includes(it[1]);
		const accent = red || warn;
		return v_flex().when(section(p, list, i), (el) => el.child(div().mx(10).my(5).h(1).bg(t.border))).child(h_flex().id(`mi-${i}`).h(p?.tab === MENU.tab ? 30 : 24).px(10).when(inset, (el) => el.pl(32)).gap(8).rounded(6).items_center().justify_between().line_height("16px").whitespace_nowrap().text_color(rowColor(accent, off, look)).when(current, (el) => el.bg(accent ? `${bad}1a` : t.selected)).on_hover((hovered, cx) => {
			if (hovered && !off && this.at !== i) {
				this.at = i;
				cx.notify();
			}
		}).on_click((_e, cx) => this.choose(i, cx)).when(!inset, (el) => el.child(svg(menuIcon(it, zoomed)).size(14).flex_none().text_color(accent ? bad : t.muted))).child(div().flex_1().min_w(0).truncate().child(it[0])).child(div().pl(16).flex_none().whitespace_nowrap().text_color(t.muted).child(p?.tab === MENU.tab ? keyHint(shortcut(it[1], it[2])) : shortcut(it[1], it[2]))));
	}
	render() {
		const t = menuTheme();
		const p = menuProps();
		const list = items(p, this.git);
		const look = {
			t,
			bad: destructive(),
			zoomed: panes().find((x) => x.pane === p?.target?.pane)?.zoomed
		};
		return v_flex().id("menu").track_focus(this.handle).w_full().min_h(0).p(4).bg(t.popover).text_size(13).on_key_down((e, cx) => this.onKey(e, cx, list.length)).children([
			...p?.tab === MENU.space && p?.multi ? [div().px(10).pt(5).pb(3).text_size(11).font_semibold().text_color(t.muted).child("Workspace")] : [],
			...p?.tab === MENU.tab ? [contextHeader(p, t)] : [],
			...list.map((_it, i) => this.row(p, list, i, look))
		]);
	}
};
const SHARED_ASSET_PATHS = Object.freeze({
	"mods/orca-context-menu/bell.svg": "mods/orca-assets/bell--orca-context-menu.svg",
	"mods/orca-context-menu/git-branch-plus.svg": "mods/orca-assets/git-branch-plus--orca-context-menu.svg",
	"mods/orca-context-menu/minimize-2.svg": "mods/orca-assets/minimize-2--orca-context-menu.svg",
	"mods/orca-context-menu/panel-right-close.svg": "mods/orca-assets/panel-right-close--orca-context-menu.svg",
	"mods/orca-context-menu/pencil.svg": "mods/orca-assets/pencil--orca-context-menu.svg",
	"mods/orca-context-menu/plus.svg": "mods/orca-assets/plus--orca-agent-flyout.svg",
	"mods/orca-context-menu/rotate-ccw.svg": "mods/orca-assets/rotate-ccw--orca-context-menu.svg",
	"mods/orca-context-menu/workflow.svg": "mods/orca-assets/workflow--orca-context-menu.svg",
	"mods/orca-context-menu/x.svg": "mods/orca-assets/x--orca-context-menu.svg"
});
function sharedAsset(path) {
	return SHARED_ASSET_PATHS[path] ?? `mods/orca-assets/${path.slice(path.lastIndexOf("/") + 1)}`;
}

export { closeRow, Menu as default, isDestructive, items, keyHint, menuIcon, section, shortcut, stored, unpinnedTabs };
