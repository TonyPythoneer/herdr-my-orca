// Agent rail geometry (moved from orca-agent-settings with the rail), kept independent of GPUI for regression tests.
import { viewportHeight, scrolls } from "./list-viewport.js";

// Discord's server rail: each icon is a rounded square; a pill on the rail's left edge marks every
// clickable row (a small dot at rest, taller on hover, tallest when selected); a group is a rounded box.
export const RAIL = Object.freeze({
  width: 76, row: 60, avatar: 46, avatarRadius: 13, indicatorWidth: 5,
  idleHeight: 10, selectedHeight: 40, hoverHeight: 20, switchWidth: 27, switchHeight: 17,
  hitWidth: 34, hitHeight: 27,
  groupLeft: 9, groupWidth: 58, groupRadius: 16, groupGap: 8,
});

// Global and agent rows use identical local geometry. Never center relative to a group.
export function railGeometry(selected = false, hovered = false) {
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

export function railViewport(count) {
  return { height: viewportHeight(count, RAIL.row), scroll: scrolls(count) };
}

// Stable partition. Availability changes do not reorder installed agents; input is catalog order.
export function railRows(rows) {
  return [...rows.filter(row => row.installed), ...rows.filter(row => !row.installed)];
}

export function railControl(row) {
  return row.installed ? { kind: "switch", checked: Boolean(row.enabled) } : { kind: "install" };
}
