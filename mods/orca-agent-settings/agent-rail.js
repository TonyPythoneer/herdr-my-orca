// Agent order shared by the settings page's keyboard navigation and the left sidebar's agent list.

// Stable partition. Availability changes do not reorder installed agents; input is catalog order.
export function railRows(rows) {
  return [...rows.filter(row => row.installed), ...rows.filter(row => !row.installed)];
}
