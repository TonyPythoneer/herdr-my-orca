export function selectTabPanes(panes) {
  const selected = new Map();
  for (const pane of panes) {
    const current = selected.get(pane.tab);
    if (!current || (!current.program?.agent && pane.program?.agent)) selected.set(pane.tab, pane);
  }
  return selected;
}
