// The left sidebar's agent rail: the rail the agent settings page used to carry, shown in place of
// Projects while that page is open. orca-agent-settings owns the data and every write. The rail reads
// its shared values and answers with one-shot requests (`open-agent`, `toggle-agent`), so the
// switch keeps the manager's conflict handling.
import { v_flex, ScrollHandle } from "gpui-base";
import { shared, setShared, layout } from "herdr";
import { railView } from "./agent-rail-view.js";

const find = (n, id) => { if (n?.id === id) return n; for (const c of n?.children ?? []) { const r = find(c, id); if (r) return r; } return null; };

export function agentSettingsOpen() {
  const root = layout();
  const nav = find(root, "nav-top");
  return find(root, "main")?.active === "main-agents" && (!nav || Boolean(nav.hidden));
}

// What the rail needs from its owner, backed by shared values instead of the page's own state.
// Call from the view's init(): a ScrollHandle cannot be created during render.
export function agentRailOwner() {
  return {
    railHover: null,
    officialRailScroll: ScrollHandle.new(),
    unofficialRailScroll: ScrollHandle.new(),
    get railSelection() { return shared("agent-manager.selected")?.key ?? "global"; },
    selectRail: (key) => setShared("agent-manager.open-agent", { key }),
    toggleEnabled: (row) => setShared("agent-manager.toggle-agent", { key: row.key }),
  };
}

// `host` is the Spaces view; `host.agentRail` (from agentRailOwner) keeps the rail's hover and scroll state.
export function leftSidebarAgentRail(host, t) {
  const inventory = shared("agent-manager.inventory");
  // Until the manager publishes, the rail shows Global alone, as the page did before its first scan.
  const official = Array.isArray(inventory?.agents) ? inventory.agents : [];
  const unofficial = Array.isArray(inventory?.unofficial) ? inventory.unofficial : [];
  return v_flex().size_full().min_h(0).items_start().child(railView(host.agentRail, official, unofficial, t).h_full());
}
