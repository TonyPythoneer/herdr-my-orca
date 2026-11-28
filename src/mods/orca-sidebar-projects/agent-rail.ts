import { viewportHeight, scrolls } from "../../shared/list-viewport.js";

export const RAIL = Object.freeze({
  width: 76,
  row: 60,
  avatar: 46,
  avatarRadius: 13,
  indicatorWidth: 5,
  idleHeight: 10,
  selectedHeight: 40,
  hoverHeight: 20,
  switchWidth: 27,
  switchHeight: 17,
  groupLeft: 9,
  groupWidth: 58,
  groupRadius: 16,
  groupGap: 8,
});

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
  const idleHeight = hovered ? RAIL.hoverHeight : RAIL.idleHeight;
  const height = selected ? RAIL.selectedHeight : idleHeight;
  return {
    avatarLeft: (RAIL.width - RAIL.avatar) / 2,
    avatarTop: (RAIL.row - RAIL.avatar) / 2,
    indicatorLeft: 0,
    indicatorTop: (RAIL.row - height) / 2,
    indicatorHeight: height,
  };
}

export function railViewport(count: number): RailViewport {
  return { height: viewportHeight(count, RAIL.row), scroll: scrolls(count) };
}

export function railRows<T extends { installed?: boolean }>(rows: T[]): T[] {
  return [...rows.filter((row) => row.installed), ...rows.filter((row) => !row.installed)];
}

export function railControl(row: { installed?: boolean; enabled?: boolean }): RailControl {
  return row.installed ? { kind: "switch", checked: Boolean(row.enabled) } : { kind: "install" };
}
