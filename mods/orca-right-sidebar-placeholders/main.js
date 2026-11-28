import { panelFrame } from "./panel-motion.js";
import { themeColor } from "./theme-color.js";
import { View, div, svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { props, theme } from "herdr";

                                                   
const MOD_NAME = "orca-right-sidebar-placeholders";
const ASSET_DIR = "mods/orca-assets";
const DEFAULT_TAB = "checks";
const TEXT_SIZE = 14;
const GAPS = {
	workspaces: {
		icon: "workflow",
		title: "Attached worktrees",
		body: "Herdr has no folder-workspace model, so there are no attached worktrees to list. Spaces and their checkouts are in the left sidebar."
	},
	"pr-checks": {
		icon: "list-checks",
		title: "PR Checks",
		body: "PR Checks read Orca's hosted-review cache. Herdr has no GitHub or GitLab integration."
	},
	checks: {
		icon: "list-checks",
		title: "Checks",
		body: "Checks read Orca's hosted-review data. Herdr has no GitHub or GitLab integration."
	},
	ports: {
		icon: "plug",
		title: "Ports",
		body: "Ports need Orca's port detection and SSH forwarding. Herdr exposes no port API."
	}
};
const ICON_ASSETS = {
	workflow: `${ASSET_DIR}/workflow--${MOD_NAME}.svg`,
	"list-checks": `${ASSET_DIR}/list-checks--${MOD_NAME}.svg`,
	plug: `${ASSET_DIR}/plug--${MOD_NAME}.svg`
};
function gapFor(tab) {
	return GAPS[String(tab)] ?? GAPS[DEFAULT_TAB];
}
function iconAsset(icon) {
	return ICON_ASSETS[icon] ?? `${ASSET_DIR}/${icon}.svg`;
}
var PanelGap = class extends View {
	render() {
		return panelFrame(this.renderBody());
	}
	renderBody() {
		const t = theme();
		const tab = props()?.tab;
		const gap = gapFor(tab);
		return v_flex().id(`gap-${tab ?? DEFAULT_TAB}`).size_full().items_center().justify_center().px(16).text_color(themeColor(t.muted)).child(div().mb(12).opacity(.5).child(svg(iconAsset(gap.icon)).size(32))).child(div().text_size(TEXT_SIZE).font_medium().text_color(themeColor(t.foreground)).child(gap.title)).child(div().mt(4).max_w(260).text_size(TEXT_SIZE).text_center().child(gap.body));
	}
};

export { PanelGap as default };
