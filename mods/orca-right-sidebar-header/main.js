import { fallbackChild, visibleTools } from "./panel-gating.js";
import { viewCommands } from "./panel-views.js";
import { View, div, svg } from "gpui-kit";
import { Button, h_flex } from "gpui-base";
import { exec, focused, layout, nextCommand, panes, run, spaces, theme } from "herdr";

                                             
function findNode(node, id) {
	if (!node) return null;
	if (node.id === id) return node;
	for (const child of node.children ?? []) {
		const hit = findNode(child, id);
		if (hit) return hit;
	}
	return null;
}
const TINT_ACTIVE = .1;
const TINT_HOVER = .06;
const INACTIVE_ICON = "#acacac99";
function tint(hex, alpha) {
	const alphaHex = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0");
	return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alphaHex}` : hex;
}
const READ = [
	"--no-optional-locks",
	"-c",
	"core.fsmonitor=false",
	"-c",
	"diff.autoRefreshIndex=false"
];
const activeSpace = () => (spaces() ?? []).find((space) => space.active);
const isInside = (path, folder) => path === folder || path.startsWith(`${folder}/`);
function hostOf(focus, space) {
	if (focus?.pane === null) return focus.terminal?.includes("/") ? focus.terminal.split("/")[0] : null;
	return space?.machine ?? null;
}
function scopeToProject(live, project) {
	if (live && project && !isInside(live, project)) return project;
	return live || project;
}
function location() {
	const space = activeSpace();
	const focus = focused();
	const live = (focus?.pane ? (panes() ?? []).find((item) => item.pane === focus.pane) : null)?.cwd || focus?.cwd;
	return {
		cwd: scopeToProject(live, space?.folder || live),
		on: hostOf(focus, space)
	};
}
const PROBE_TTL_MS = 5e3;
const emptyGitCache = (resolved) => ({
	cwd: null,
	on: null,
	at: 0,
	ok: false,
	resolved,
	pending: false
});
let gitCache = emptyGitCache(false);
function refreshRepoState(cx, { cwd, on }) {
	if (!cwd) {
		gitCache = emptyGitCache(true);
		return;
	}
	const isSameTarget = gitCache.cwd === cwd && gitCache.on === on;
	const isExpired = Date.now() - gitCache.at > PROBE_TTL_MS;
	if (isSameTarget && !(isExpired && !gitCache.pending)) return;
	gitCache = {
		cwd,
		on,
		at: Date.now(),
		ok: isSameTarget && gitCache.ok,
		resolved: isSameTarget && gitCache.resolved,
		pending: true
	};
	cx.spawn(async (spawnCx) => {
		const result = await exec("git", [
			...READ,
			"rev-parse",
			"--show-toplevel"
		], {
			cwd,
			on
		}).catch(() => null);
		if (gitCache.cwd !== cwd || gitCache.on !== on) return;
		gitCache.pending = false;
		const ok = result?.code === 0;
		const changed = !gitCache.resolved || gitCache.ok !== ok;
		gitCache.ok = ok;
		gitCache.resolved = true;
		if (changed) spawnCx.notify();
	});
}
const ITEMS = [
	{
		id: "files",
		icon: "files",
		title: "Explorer"
	},
	{
		id: "agent-sessions",
		icon: "agent-session-history",
		title: "Agents"
	},
	{
		id: "workspaces",
		icon: "workflow",
		title: "Attached worktrees",
		gating: "folderOnly"
	},
	{
		id: "pr-checks",
		icon: "list-checks",
		title: "PR Checks",
		gating: "folderOnly"
	},
	{
		id: "changes",
		icon: "git-branch",
		title: "Source Control",
		gating: "gitOnly"
	},
	{
		id: "checks",
		icon: "list-checks",
		title: "Checks",
		gating: "gitOnly"
	},
	{
		id: "ports",
		icon: "plug",
		title: "Ports",
		gating: "sshOnly"
	}
];
function selectFallback(cx, tools, active) {
	const fallback = fallbackChild(tools, active);
	if (fallback && fallback !== active) cx.spawn(() => {
		run("layout.select", {
			stack: "panel-body",
			child: fallback
		});
	});
}
function toolButton(t, { id, icon, title }, isActive) {
	return Button.new(`panel-${id}`).selected(isActive).h(24).flex_1().min_w(0).flex().items_center().justify_center().relative().rounded(6).text_color(isActive ? t.foreground : INACTIVE_ICON).when(isActive, (element) => element.bg(tint(t.foreground, TINT_ACTIVE))).when(!isActive, (element) => element.hover((style) => style.bg(tint(t.foreground, TINT_HOVER)).text_color(t.muted))).role("button").accessibility_label(title).tooltip(title).on_mouse_down("left", (_event, eventCx) => eventCx.stop_propagation()).on_click(() => run("layout.select", {
		stack: "panel-body",
		child: id
	})).child(svg(sharedAsset(`mods/orca-right-sidebar-header/${icon}.svg`)).size(16));
}
function toolGroup(t, tools, active) {
	return div().id("panel-tools").flex_1().min_w(0).flex().items_center().gap(1).p(1).rounded(8).bg(tint(t.foreground, .05)).children(tools.map((tool) => toolButton(t, tool, active === tool.id)));
}
var PanelHead = class extends View {
	init(_props, cx) {
		cx.spawn(async (spawnCx) => {
			for (;;) {
				const command = await nextCommand();
				if (!command) continue;
				const commands = viewCommands(command);
				if (commands) for (const { name, args } of commands) run(name, args);
				spawnCx.notify();
			}
		});
	}
	render(cx) {
		const t = theme();
		const active = findNode(layout(), "panel-body")?.active ?? "files";
		const currentLocation = location();
		refreshRepoState(cx, currentLocation);
		const isFolder = gitCache.resolved && !gitCache.ok;
		const onSshHost = Boolean(currentLocation.on || activeSpace()?.machine);
		const tools = visibleTools(ITEMS, {
			isFolder,
			onSshHost
		});
		selectFallback(cx, tools, active);
		return h_flex().w_full().h_full().items_center().pl(8).pr(4).child(toolGroup(t, tools, active));
	}
};
const SHARED_ASSET_PATHS = Object.freeze({
	"mods/orca-right-sidebar-header/files.svg": "mods/orca-assets/files--orca-right-sidebar-header.svg",
	"mods/orca-right-sidebar-header/git-branch.svg": "mods/orca-assets/git-branch--orca-right-sidebar-header.svg",
	"mods/orca-right-sidebar-header/list-checks.svg": "mods/orca-assets/list-checks--orca-right-sidebar-header.svg",
	"mods/orca-right-sidebar-header/panel-right-close.svg": "mods/orca-assets/panel-right-close--orca-right-sidebar-header.svg",
	"mods/orca-right-sidebar-header/plug.svg": "mods/orca-assets/plug--orca-right-sidebar-header.svg",
	"mods/orca-right-sidebar-header/workflow.svg": "mods/orca-assets/workflow--orca-right-sidebar-header.svg"
});
function sharedAsset(path) {
	return SHARED_ASSET_PATHS[path] ?? `mods/orca-assets/${path.slice(path.lastIndexOf("/") + 1)}`;
}

export { PanelHead as default };
