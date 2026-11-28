type Tool = { id: string; gating?: string };
type GateState = { isFolder: boolean; onSshHost: boolean };

const GATES: Record<string, (state: GateState) => boolean> = {
  gitOnly: ({ isFolder }) => !isFolder,
  folderOnly: ({ isFolder }) => isFolder,
  sshOnly: ({ onSshHost }) => onSshHost,
};

export function visibleTools<T extends Tool>(items: T[], state: GateState): T[] {
  return items.filter(
    ({ gating }) => !Object.hasOwn(GATES, gating ?? "") || GATES[gating ?? ""](state),
  );
}

export function fallbackChild(visible: Tool[], active: string): string | null {
  if (!visible.length) return null;
  return visible.some((tool) => tool.id === active) ? active : visible[0].id;
}
