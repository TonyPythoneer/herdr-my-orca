import { startTaskRunner } from "./scheduler.js";
import { IconButton } from "./icon-button.js";
import { themeColor } from "./theme-color.js";
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, run, theme } from "herdr";

                                      
const FOOTER_ICON_DIR = "mods/orca-status-footer";
const SHARED_ASSET_DIR = "mods/orca-assets";
const MAIN_STACK = "main";
const AGENTS_PAGE = "main-agents";
const TASKS_PAGE = "main-tasks";
const COMMAND = {
	selectLayout: "layout.select",
	agentSettings: "orca-header.agent-settings",
	settings: "app.settings",
	palette: "app.palette"
};
const SPACE_PX = 8;
const RADIUS_PX = 8;
const ICON_PX = 14;
const BUTTON_PX = 18;
const TEXT_PX = 12;
const DIVIDER_PX = 12;
const SHARED_ASSET_PATHS = Object.freeze({});
function find(node, id) {
	if (node?.id === id) return node;
	for (const child of node?.children ?? []) {
		const found = find(child, id);
		if (found) return found;
	}
	return null;
}
function tint(hex, alpha) {
	const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0");
	return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${a}` : hex;
}
function sharedAsset(path) {
	return SHARED_ASSET_PATHS[path] ?? `${SHARED_ASSET_DIR}/${path.slice(path.lastIndexOf("/") + 1)}`;
}
var WorkspaceChrome = class extends View {
	init(_props, cx) {
		startTaskRunner(cx);
	}
	footer(t) {
		const row = (id, icon, label, action, active = false) => IconButton(id, label, svg(sharedAsset(`${FOOTER_ICON_DIR}/${icon}.svg`)).size(ICON_PX), {
			t,
			size: BUTTON_PX,
			radius: RADIUS_PX,
			tooltip: label,
			active,
			onClick: action
		});
		const onAgents = find(layout(), MAIN_STACK)?.active === AGENTS_PAGE;
		return h_flex().size_full().items_center().bg(themeColor(t.surface)).border_t(1).border_color(themeColor(t.border)).pl(SPACE_PX).pr(SPACE_PX).text_size(TEXT_PX).child(h_flex().flex_1().items_center().justify_end().gap(SPACE_PX).child(row("agents", "bot", "Agents", () => run(COMMAND.agentSettings), onAgents)).child(row("tasks", "clock", "Tasks", () => run(COMMAND.selectLayout, {
			stack: MAIN_STACK,
			child: TASKS_PAGE
		}))).child(row("settings", "settings", "Settings", () => run(COMMAND.settings))).child(row("help", "circle-help", "Help", () => run(COMMAND.palette))).child(div().w(1).h(DIVIDER_PX).flex_none().bg(tint(themeColor(t.muted), .5))));
	}
	render() {
		return this.footer(theme());
	}
};

export { WorkspaceChrome as default };
