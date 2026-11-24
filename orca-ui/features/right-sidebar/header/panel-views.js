// Orca's right-sidebar view shortcuts reveal a view: open the sidebar if needed, then
// select that tab (`sidebar.explorer.toggle` -> `showRightSidebarFiles`,
// `sidebar.sourceControl.toggle` -> `revealRightSidebarTab`, app-command-handlers.ts:263-292).
// Herdr needs two commands for that (show + select), plus the target mod for the Search
// view, so keys.json cannot express it directly and calls `<mod>.<command>` instead.
// Kept free of Herdr imports so the mapping is testable without a view.
export const VIEW_REVEALS = {
  files: { child: "files" },
  // `showRightSidebarSearch` opens the Explorer tab on its Contents view
  // (right-sidebar-state.ts:87-110); orca-files switches internally on this command.
  search: { child: "files", mod: "orca-files.search" },
  changes: { child: "changes" },
  ports: { child: "ports" },
};

// Returns the commands to run for a reveal name, or null when it is not a known view.
export function viewCommands(view) {
  const target = VIEW_REVEALS[view];
  if (!target) return null;
  const commands = [
    { name: "layout.show", args: { id: "panel" } },
    { name: "layout.select", args: { stack: "panel-body", child: target.child } },
  ];
  if (target.mod) commands.push({ name: target.mod });
  return commands;
}
