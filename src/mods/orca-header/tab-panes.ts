import type { PaneInfo } from "herdr";

export function selectTabPanes(panes: PaneInfo[]): Map<string, PaneInfo> {
  const selected = new Map<string, PaneInfo>();
  for (const pane of panes) {
    const current = selected.get(pane.tab);
    if (!current || (!current.program?.agent && pane.program?.agent)) selected.set(pane.tab, pane);
  }
  return selected;
}
