export const ROOT = (home: string): string => `${home}/.herdr/worktrees`;

export const tilde = (path: string, userHome: string): string => {
  const [p, h] = [path, userHome].map((s) => s.replace(/\\/g, "/"));
  return p.startsWith(h) ? `~${p.slice(h.length)}` : path;
};

export const slug = (branch: string): string =>
  branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

const HOUR = 3600,
  DAY = 86400,
  DAYS_PER_MONTH = 30,
  MONTH_THRESHOLD_DAYS = 60;
export const ago = (s: number, now = Date.now()): string => {
  const d = now / 1000 - s;
  if (d < HOUR) return `${Math.max(1, Math.round(d / 60))}m`;
  if (d < DAY) return `${Math.round(d / HOUR)}h`;
  if (d < DAY * MONTH_THRESHOLD_DAYS) return `${Math.round(d / DAY)}d`;
  return `${Math.round(d / DAY / DAYS_PER_MONTH)}mo`;
};

export type TabRef = { id: string };
export type SpaceRef = {
  id?: string;
  folder?: string | null;
  machine?: string | null;
  name?: string;
  active?: boolean;
  tabs?: TabRef[];
};
export type PaneRef = { tab?: string | null; cwd?: string | null };
export type BranchRef = { branch: string; at?: number };
export type Checkout = { path: string; branch?: string | null; main?: boolean; at?: number };
export type BranchRow = { branch: string; at: number; current: boolean; held: string | null };

export function place(s: SpaceRef | null | undefined, all: PaneRef[] = []): string | null {
  if (!s) return null;
  const tabs = new Set<string | null | undefined>((s.tabs ?? []).map((c) => c.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

export const inside = (p: string, dir: string): boolean => p === dir || p.startsWith(dir + "/");

export function spaceOf(
  path: string,
  all: Checkout[],
  on: string | null | undefined,
  spaceList: SpaceRef[],
  paneList: PaneRef[],
): SpaceRef | undefined {
  return spaceList.find(
    (s) =>
      (s.machine ?? null) === (on ?? null) &&
      (() => {
        const at = place(s, paneList)?.replace(/\\/g, "/");
        if (!at || !inside(at, path)) return false;
        return !all.some(
          (c) => c.path !== path && c.path.length > path.length && inside(at, c.path),
        );
      })(),
  );
}

export function branchRows(
  refs: BranchRef[],
  checkouts: Checkout[] = [],
  current: string | null = null,
): BranchRow[] {
  const held = new Map<string, string>();
  for (const c of checkouts) if (c.branch && c.branch !== current) held.set(c.branch, c.path);
  return refs
    .map((r) => ({
      branch: r.branch,
      at: r.at ?? 0,
      current: r.branch === current,
      held: held.get(r.branch) ?? null,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.at - a.at);
}

export function switchBlocker({
  agentWorking = false,
  statusKnown = true,
  dirtyCount = 0,
}: { agentWorking?: boolean; statusKnown?: boolean; dirtyCount?: number } = {}): string {
  if (agentWorking)
    return "An agent is working in this workspace. Switch branches after it finishes, or close its tab if it has stopped.";
  if (!statusKnown)
    return "Couldn't read this checkout's changes, so Git can't promise a safe switch.";
  if (dirtyCount > 0)
    return dirtyCount === 1
      ? "Commit or discard 1 changed file before switching branches."
      : `Commit or discard ${dirtyCount} changed files before switching branches.`;
  return "";
}
