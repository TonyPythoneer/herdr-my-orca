// Herdr's own rows, not an Orca port: Orca's SortableTabContextMenu (TSX:213) has Close Others
// only, so "Close Tabs to the Right" and "Close Tabs to the Left" are ours. Given the space that
// holds the tab and the tab's id, this is the ids on that side of it. Pinned tabs (Herdr's
// `settled`) stay open, and a side with nothing left to close returns no ids, which is how the
// row stays out of the menu (Close Others uses `tabCount <= 1` the same way).
export function closeSideTabs(owner, id, side) {
  const list = owner?.tabs ?? [];
  const at = list.findIndex((x) => x.id === id);
  if (at < 0) return [];
  const range = side === "left" ? [0, at] : [at + 1];
  return list.slice(...range).filter((x) => !x.settled).map((x) => x.id);
}
