// Agent settings rail geometry, kept independent of GPUI for regression tests.
import { viewportHeight, scrolls } from "./list-viewport.js";

export const RAIL = Object.freeze({
  width: 76, row: 60, avatar: 46, indicatorWidth: 4,
  selectedHeight: 40, hoverHeight: 20, switchWidth: 27, switchHeight: 17,
  hitWidth: 34, hitHeight: 27,
});

// Global and agent rows use identical local geometry. Never center relative to a group.
export function railGeometry(selected = false, hovered = false) {
  const idleHeight = hovered ? RAIL.hoverHeight : 0;
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
