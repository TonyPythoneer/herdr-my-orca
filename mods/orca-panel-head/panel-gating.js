// Pure gating for the right-sidebar activity bar (Orca `use-right-sidebar-activity-items.ts`).
// Kept separate from the View so the Git/folder/SSH rules and the gated-active fallback
// can be tested without a render pass.
export function visibleTools(items, { isFolder, onSshHost }) {
  return items.filter(({ gating }) =>
    gating === "gitOnly" ? !isFolder
    : gating === "folderOnly" ? isFolder
    : gating === "sshOnly" ? onSshHost
    : true);
}

// Orca falls back to the first visible item when the active tab is gated out
// (`right-sidebar-effective-tab.ts:28-32`).
export function fallbackChild(visible, active) {
  if (!visible.length) return null;
  return visible.some((tool) => tool.id === active) ? active : visible[0].id;
}
