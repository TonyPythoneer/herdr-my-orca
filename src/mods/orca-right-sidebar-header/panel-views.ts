type ViewTarget = { child: string; mod?: string };
type ViewCommand = { name: string; args?: Record<string, string> };

export const VIEW_REVEALS: Record<string, ViewTarget> = {
  files: { child: "files" },
  search: { child: "files", mod: "orca-files.search" },
  changes: { child: "changes" },
  ports: { child: "ports" },
};

export function viewCommands(view: string): ViewCommand[] | null {
  const target = VIEW_REVEALS[view];
  if (!target) return null;
  const commands: ViewCommand[] = [
    { name: "layout.show", args: { id: "panel" } },
    { name: "layout.select", args: { stack: "panel-body", child: target.child } },
  ];
  if (target.mod) commands.push({ name: target.mod });
  return commands;
}
