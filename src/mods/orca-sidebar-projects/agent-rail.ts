import { viewportHeight, scrolls } from "../../primitives/list-viewport.js";

import * as SidebarUI from "../../config/ui-settings/agent-settings/sidebar.js";

export type RailRow = {
  key: string;
  name?: string;
  installed?: boolean;
  enabled?: boolean;
  icon?: string;
  tint?: boolean;
  homepage?: string;
};

export type RailGeometry = {
  avatarLeft: number;
  avatarTop: number;
  indicatorLeft: number;
  indicatorTop: number;
  indicatorHeight: number;
};

export type RailViewport = { height: number; scroll: boolean };

export type RailControl = { kind: "switch"; checked: boolean } | { kind: "install" };

export function railGeometry(selected = false, hovered = false): RailGeometry {
  const idleHeight = hovered ? SidebarUI.SELECTION_INDICATOR__HOVER_HEIGHT_PX : SidebarUI.SELECTION_INDICATOR__IDLE_HEIGHT_PX;
  const height = selected ? SidebarUI.SELECTION_INDICATOR__SELECTED_HEIGHT_PX : idleHeight;
  return {
    avatarLeft: (SidebarUI.SIDEBAR__WIDTH_PX - SidebarUI.AVATAR__SIZE_PX) / 2,
    avatarTop: (SidebarUI.ROW__HEIGHT_PX - SidebarUI.AVATAR__SIZE_PX) / 2,
    indicatorLeft: 0,
    indicatorTop: (SidebarUI.ROW__HEIGHT_PX - height) / 2,
    indicatorHeight: height,
  };
}

export function railViewport(count: number): RailViewport {
  return { height: viewportHeight(count, SidebarUI.ROW__HEIGHT_PX), scroll: scrolls(count) };
}

export function railRows<T extends { installed?: boolean }>(rows: T[]): T[] {
  return [...rows.filter((row) => row.installed), ...rows.filter((row) => !row.installed)];
}

export function railControl(row: { installed?: boolean; enabled?: boolean }): RailControl {
  return row.installed ? { kind: "switch", checked: Boolean(row.enabled) } : { kind: "install" };
}
