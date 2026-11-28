import type { Status } from "herdr";

export const STATUS = {
  blocked: "blocked",
  working: "working",
  done: "done",
  idle: "idle",
} as const satisfies Record<Status, Status>;

export const STATUS_ORDER = [STATUS.blocked, STATUS.working, STATUS.done, STATUS.idle] as const;

export type CrewStatus = (typeof STATUS_ORDER)[number];

const LIVE_STATE = "live";

export type TerminalInfo = {
  address: string;
  parent?: string | null;
  state?: string | null;
  status?: string | null;
  title?: string | null;
  report?: { app?: string | null } | null;
  program?: { name?: string | null; icon?: string | null; tint?: boolean } | null;
};

export type Crew = { managing: TerminalInfo[]; managedBy: TerminalInfo | null };
export type CrewGroup = { status: CrewStatus; members: TerminalInfo[] };

export function crewOf(all: readonly TerminalInfo[], address: string | null | undefined): Crew {
  if (!address) return { managing: [], managedBy: null };
  const managing = all.filter((t) => t.parent === address && t.state === LIVE_STATE && t.status);
  const parentAddr = all.find((t) => t.address === address)?.parent ?? null;
  const managedBy = parentAddr ? anyAgent(all, parentAddr) : null;
  return { managing, managedBy };
}

function anyAgent(all: readonly TerminalInfo[], address: string): TerminalInfo | null {
  return all.find((t) => t.address === address && t.status) ?? null;
}

export function crewMembers(crew: Crew): TerminalInfo[] {
  const seen = new Set<string>();
  const members: TerminalInfo[] = [];
  for (const t of [...crew.managing, ...(crew.managedBy ? [crew.managedBy] : [])]) {
    if (seen.has(t.address)) continue;
    seen.add(t.address);
    members.push(t);
  }
  return members;
}

export function crewGroups(crew: Crew): CrewGroup[] {
  const members = crewMembers(crew);
  const byStatus = new Map<string, TerminalInfo[]>();
  for (const t of members) {
    const status = t.status;
    if (!status) continue;
    const list = byStatus.get(status);
    if (list) list.push(t);
    else byStatus.set(status, [t]);
  }
  const groups: CrewGroup[] = [];
  for (const status of STATUS_ORDER) {
    const ms = byStatus.get(status);
    if (ms && ms.length) groups.push({ status, members: ms });
  }
  return groups;
}

export function crewSignature(crew: Crew): string {
  return crewMembers(crew)
    .map((t) => `${t.address}:${t.status}`)
    .join(",");
}
