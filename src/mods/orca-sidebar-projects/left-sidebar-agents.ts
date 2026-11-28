import { v_flex, ScrollHandle } from "gpui-base";
import { shared, setShared, layout } from "herdr";
import { railView, type ProviderRow, type RailOwner, type RailTheme } from "./agent-rail-view.js";
import type { RailRow } from "./agent-rail.js";
import type { NativeElement } from "gpui-kit";

type LayoutNode = { id?: string; hidden?: boolean; active?: string; children?: LayoutNode[] };
type Inventory = { agents?: RailRow[]; unofficial?: RailRow[] } | null | undefined;

const find = (node: LayoutNode | null | undefined, id: string): LayoutNode | null => {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
};

const listOf = <T>(value: unknown): T[] => (Array.isArray(value) ? value : []);

export function agentSettingsOpen(): boolean {
  const root = layout() as LayoutNode | undefined;
  const nav = find(root, "nav-top");
  return find(root, "main")?.active === "main-agents" && (!nav || Boolean(nav.hidden));
}

export function agentRailOwner(): RailOwner {
  return {
    railHover: null,
    officialRailScroll: ScrollHandle.new(),
    unofficialRailScroll: ScrollHandle.new(),
    providerRailScroll: ScrollHandle.new(),
    providerRailOpen: true,
    get litellmEnabled() {
      return shared("agent-manager.litellm-enabled") === true;
    },
    get railSelection() {
      return (
        (shared("agent-manager.selected") as { key?: string } | null | undefined)?.key ?? "global"
      );
    },
    selectRail: (key) => setShared("agent-manager.open-agent", { key }),
    toggleEnabled: (row) => setShared("agent-manager.toggle-agent", { key: row.key }),
  };
}

export function leftSidebarAgentRail(host: { agentRail: RailOwner }, t: RailTheme): NativeElement {
  const inventory = shared("agent-manager.inventory") as Inventory;
  return v_flex()
    .size_full()
    .min_h(0)
    .items_start()
    .child(
      railView(
        host.agentRail,
        listOf<RailRow>(inventory?.agents),
        listOf<RailRow>(inventory?.unofficial),
        listOf<ProviderRow>(shared("agent-manager.providers")),
        t,
      ).h_full(),
    );
}
