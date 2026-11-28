type MachineId = unknown;
type Tab = { id: string; changed_at?: number | null; [key: string]: unknown };
type Workspace = {
  id?: string;
  folder?: unknown;
  machine?: MachineId;
  tabs?: Tab[];
  status?: string | null;
  branch?: string | null;
  name?: string;
  named?: boolean;
  active?: boolean;
  [key: string]: unknown;
};
type Worktree = { path: string; branch?: string | null };
type Checkout = { path: unknown; branch?: string | null };
type GitInfo = {
  repo: string;
  top?: unknown;
  name?: string;
  branch?: string | null;
  linked?: boolean;
  worktrees?: Worktree[];
  pr?: unknown;
};
type PlanRow = {
  w: Workspace;
  g?: GitInfo | null;
  i?: number;
  ok?: boolean;
  unopened?: boolean;
  key?: string;
  also?: PlanRow[];
  head?: boolean;
  kids?: number;
  count?: number;
};
type WorkspaceOptions = {
  visibleWorkspaceHostIds?: MachineId[];
  filterRepoIds?: string[];
  hideDefaultBranchWorkspace?: boolean;
  hideDetachedHeadWorkspaces?: boolean;
  groupBy?: string;
  sortBy?: string;
  projectOrderBy?: string;
};
type PlanInput = {
  spaces?: Workspace[];
  panes?: unknown[];
  gitState?: Record<string, GitInfo | null | undefined>;
  foldedRepos?: Set<string>;
  loaded?: boolean;
  whereFn?: ((space: Workspace, panes: unknown[]) => string) | null | false;
  options?: WorkspaceOptions;
};
type WorktreeRowGroup = { key: string; repo: string | null; rows: PlanRow[] };
type WorkspaceGroup = { rows?: { w?: Workspace; also?: { w?: Workspace }[] }[] };
type Agent = { tab: string; [key: string]: unknown };
type RowDescriptor =
  | { kind: "host"; machine: MachineId; count: number }
  | { kind: "status"; label: string; count: number }
  | { kind: "row"; index: number; position: number };

export function parseWorktreeList(output: string): Worktree[] {
  const out = [];
  for (const block of output.trim().split(/\r?\n\r?\n/)) {
    let path = "",
      branch = "",
      bare = false;
    for (const line of block.trim().split(/\r?\n/)) {
      if (line.startsWith("worktree ")) path = line.slice(9);
      else if (line.startsWith("branch ")) branch = line.slice(7).replace(/^refs\/heads\//, "");
      else if (line === "bare" || line.startsWith("prunable")) bare = true;
    }
    if (path && !bare) out.push({ path, branch });
  }
  return out;
}

export function place(s: Workspace | null | undefined, _ps: unknown[] = []): unknown {
  return s?.folder ?? null;
}

export const where = (s: Workspace | null | undefined, ps: unknown[] = []): string =>
  JSON.stringify([s?.machine ?? null, place(s, ps)]);

export function groupSpaceIds(
  group: WorkspaceGroup | null | undefined,
  live: readonly string[] = [],
): string[] {
  const known = new Set(live ?? []);
  const ids: string[] = [];

  let seen: Set<string> | null = null;
  function add(w: Workspace | undefined): void {
    const id = w?.id;
    if (!id || !known.has(id)) return;
    if (seen ? seen.has(id) : ids.includes(id)) return;
    ids.push(id);
    if (seen) seen.add(id);
    else if (ids.length === 32) seen = new Set(ids);
  }
  for (const r of group?.rows ?? []) {
    add(r.w);
    for (const a of r.also ?? []) add(a.w);
  }
  return ids;
}

export function forgetProject(
  cache: Record<string, GitInfo | null | undefined>,
  repo: string | null | undefined,
  liveKeys: readonly string[] = [],
): number {
  if (!repo) return 0;
  const live = new Set(liveKeys);
  let removed = 0;
  for (const key of Object.keys(cache ?? {})) {
    if (cache[key]?.repo !== repo || live.has(key)) continue;
    delete cache[key];
    removed++;
  }
  return removed;
}

export function pruneGitCache(
  cache: Record<string, GitInfo | null | undefined>,
  spaces: Workspace[],
  checked: Record<string, unknown> = {},
): void {
  const active = new Set(spaces.map((s) => where(s)));
  const remove = (key: string): void => {
    delete cache[key];
    delete checked[key];
  };
  for (const key of Object.keys(cache)) {
    if (cache[key] === null && !active.has(key)) remove(key);
  }
}

export const base = (path: unknown): string =>
  typeof path === "string" ? (path.replace(/\/+$/, "").split("/").pop() ?? "") : "";

export const readPair = (s: string): unknown[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export function activeReviewKeys(rows: PlanRow[]): string[] {
  return [
    ...new Set(
      rows
        .filter((r): r is PlanRow & { g: GitInfo } => !r.w.machine && Boolean(r.g?.branch))
        .map((r) => `${readPair(r.g.repo)[1]}::${r.g.branch}`),
    ),
  ];
}

export function foldKey({ w, g }: PlanRow): string {
  return g?.repo ?? `space:${w.id}`;
}

export const STATUS_RANK: Record<string, number> = { blocked: 4, done: 3, working: 2, idle: 1 };

export function planRenderRows(
  rows: PlanRow[],
  groupBy: string,
  repairing: Set<MachineId>,
  folded: Set<MachineId>,
  hidden: Set<MachineId> = repairing,
): RowDescriptor[] {
  const hosts = new Map<MachineId, number[]>();
  rows.forEach((row, index) => {
    const machine = row.w.machine ?? null;
    if (!hosts.has(machine)) hosts.set(machine, []);
    hosts.get(machine)?.push(index);
  });
  const names: MachineId[] = [
    null,
    ...new Set([...rows.map((r) => r.w.machine).filter(Boolean), ...repairing]),
  ].filter((m) => hosts.has(m) || repairing.has(m));
  const result: RowDescriptor[] = [];
  const addRows = (indices: number[]): void => {
    if (groupBy !== "workspace-status") {
      indices.forEach((index, position) => result.push({ kind: "row", index, position }));
      return;
    }
    for (const [status, label] of [
      ["blocked", "Blocked"],
      ["working", "Working"],
      ["done", "Done"],
      ["idle", "Idle"],
    ] as const) {
      const group = indices.filter((index) => rows[index].w.status === status);
      if (group.length) result.push({ kind: "status", label, count: group.length });
      group.forEach((index, position) => result.push({ kind: "row", index, position }));
    }
  };
  if (names.filter((m) => hosts.has(m)).length <= 1 && !names.some((m) => repairing.has(m))) {
    addRows(rows.map((_, i) => i));
  } else
    for (const machine of names) {
      const indices = hosts.get(machine) ?? [];
      result.push({ kind: "host", machine, count: indices.length });
      if (!hidden.has(machine) && !folded.has(machine)) addRows(indices);
    }
  return result;
}

export function agentsByRow(rows: PlanRow[], agents: Agent[]): Map<PlanRow, Agent[]> {
  const result = new Map(rows.map((row) => [row, [] as Agent[]] as const));
  const tabs = new Map<string, PlanRow[]>();
  for (const row of rows) {
    const ids = new Set(
      [row.w, ...(row.also ?? []).map((a) => a.w)].flatMap((w) => (w.tabs ?? []).map((t) => t.id)),
    );
    for (const id of ids) {
      if (!tabs.has(id)) tabs.set(id, []);
      tabs.get(id)?.push(row);
    }
  }
  for (const agent of agents)
    for (const row of tabs.get(agent.tab) ?? []) result.get(row)?.push(agent);
  return result;
}

export function otherTabs(row: PlanRow, agents: Agent[]): Tab[] {
  const withAgent = new Set(agents.map((a) => a.tab));
  const tabs = [row.w, ...(row.also ?? []).map((a) => a.w)].flatMap((w) => w.tabs ?? []);
  return [...new Map(tabs.filter((t) => !withAgent.has(t.id)).map((t) => [t.id, t])).values()];
}

export const otherTabCount = (row: PlanRow, agents: Agent[]): number =>
  otherTabs(row, agents).length;

export function recentOf(r: PlanRow): number {
  return Math.max(0, ...(r.w.tabs ?? []).map((tab) => tab.changed_at ?? 0));
}

export function optionTitle(r: PlanRow): string | undefined {
  const branch = r.g?.branch ?? r.w.branch ?? null;
  return !r.w.named && branch ? branch : r.w.name;
}

export function sortRows(rows: PlanRow[], sortBy: string | undefined): PlanRow[] {
  if (sortBy === "manual") return rows;
  const main = rows.filter((r) => r.g && !r.g.linked);
  const rest = rows.filter((r) => !(r.g && !r.g.linked));
  const comparators: Record<string, (a: PlanRow, b: PlanRow) => number> = {
    name: (a, b) => optionTitle(a)!.localeCompare(optionTitle(b)!),
    smart: (a, b) =>
      (STATUS_RANK[b.w.status ?? ""] ?? 0) - (STATUS_RANK[a.w.status ?? ""] ?? 0) ||
      recentOf(b) - recentOf(a) ||
      optionTitle(a)!.localeCompare(optionTitle(b)!),
    recent: (a, b) => recentOf(b) - recentOf(a) || optionTitle(a)!.localeCompare(optionTitle(b)!),
    repo: (a, b) =>
      (a.g?.name ?? "").localeCompare(b.g?.name ?? "") ||
      optionTitle(a)!.localeCompare(optionTitle(b)!),
  };
  const cmp = sortBy ? comparators[sortBy] : undefined;
  return cmp ? [...main, ...rest.sort(cmp)] : rows;
}

function rowFilter(
  o: WorkspaceOptions,
  hosts: Set<MachineId> | null,
  repos: Set<string> | null,
): (row: PlanRow) => boolean {
  return (r) => {
    if (hosts && !hosts.has(r.w.machine ?? null)) return false;
    if (!r.g) return true;

    if (o.hideDefaultBranchWorkspace && !r.g.linked) return false;
    if (o.hideDetachedHeadWorkspaces && r.g.branch === "(detached)") return false;
    return !repos || repos.has(r.g.repo);
  };
}

function groupWorkspaceBlocks(rows: PlanRow[]): WorktreeRowGroup[] {
  const blocks: WorktreeRowGroup[] = [];
  for (const r of rows) {
    const k = r.g ? `repo:${r.g.repo}` : `space:${r.w.id}`;
    const last = blocks[blocks.length - 1];
    if (last?.key === k) last.rows.push(r);
    else blocks.push({ key: k, repo: r.g?.repo ?? null, rows: [r] });
  }
  return blocks;
}

function orderWorkspaceBlocks(blocks: WorktreeRowGroup[], orderBy: string | undefined): void {
  if (orderBy === "name") {
    const title = (block: WorktreeRowGroup): string | undefined =>
      block.rows[0].g?.name ?? optionTitle(block.rows[0]);
    blocks.sort((a, b) => title(a)!.localeCompare(title(b)!));
  } else if (orderBy === "recent") {
    blocks.sort((a, b) => recentOf(b.rows[0]) - recentOf(a.rows[0]));
  }
}

export function applyWorkspaceOptions(rows: PlanRow[], o: WorkspaceOptions = {}): PlanRow[] {
  const hosts = Array.isArray(o.visibleWorkspaceHostIds)
    ? new Set(o.visibleWorkspaceHostIds)
    : null;
  const repos =
    Array.isArray(o.filterRepoIds) && o.filterRepoIds.length ? new Set(o.filterRepoIds) : null;
  const kept = rows.filter(rowFilter(o, hosts, repos));
  if (o.groupBy !== "repo") return sortRows(kept, o.sortBy);
  const blocks = groupWorkspaceBlocks(kept);
  orderWorkspaceBlocks(blocks, o.projectOrderBy);
  return blocks.flatMap((b) => sortRows(b.rows, o.sortBy).map((r, i) => ({ ...r, head: i === 0 })));
}

function mainCheckout(key: string, g: GitInfo): Checkout | null {
  return (
    g.worktrees?.[0] ?? (g.linked ? null : { path: readPair(key)[1] ?? null, branch: g.branch })
  );
}

function unopenedMainRows(
  gitState: Record<string, GitInfo | null | undefined>,
  open: Set<string>,
): PlanRow[] {
  const anchored = new Set<string>();
  const mainRows: PlanRow[] = [];
  for (const key of Object.keys(gitState)) {
    const g = gitState[key];
    if (!g || anchored.has(g.repo)) continue;
    anchored.add(g.repo);
    const main = mainCheckout(key, g);
    if (!main?.path) continue;
    const [on] = readPair(key);
    const mainKey = JSON.stringify([on ?? null, main.path]);
    if (open.has(mainKey)) continue;
    mainRows.push({
      w: {
        id: `repo:${mainKey}`,
        name: g.name,
        named: false,
        tabs: [],
        active: false,
        status: null,
        machine: on ?? null,
        folder: main.path,
      },
      i: -1,
      g: { ...g, top: main.path, linked: false, branch: main.branch ?? g.branch },
      ok: true,
      unopened: true,
    });
  }
  return mainRows;
}

function mergeWorktreeRows(rows: PlanRow[]): PlanRow[] {
  const seen = new Map<string, PlanRow>();
  const list: PlanRow[] = [];
  for (const r of rows) {
    const key = r.g ? JSON.stringify([r.w.machine ?? null, r.g.top]) : `space:${r.w.id}`;
    if (seen.has(key)) {
      seen.get(key)?.also?.push(r);
      continue;
    }
    const row = { ...r, key, also: [] };
    seen.set(key, row);
    list.push(row);
  }
  return list;
}

function projectSections(list: PlanRow[]): IterableIterator<PlanRow[]> {
  const repoGroups = new Map<string, PlanRow[]>();

  for (const r of list) {
    const key = r.g ? r.g.repo : `space:${r.w.id}`;
    if (!repoGroups.has(key)) {
      repoGroups.set(key, []);
    }
    repoGroups.get(key)?.push(r);
  }
  return repoGroups.values();
}

function orderedRepoRows(items: PlanRow[]): PlanRow[] {
  const mainG = items.find((it) => it.g && !it.g.linked)?.g ?? items[0].g!;
  const mainWorktrees = items.filter((it) => it.g && !it.g.linked);
  const linkedWorktrees = items.filter((it) => it.g && it.g.linked);
  const ordered = [...mainWorktrees, ...linkedWorktrees];

  const openedTops = new Set(ordered.map((it) => it.g?.top));
  for (const wt of (mainG.worktrees ?? []).slice(1)) {
    if (openedTops.has(wt.path)) continue;
    openedTops.add(wt.path);
    const w = {
      id: `wt:${mainG.repo}:${wt.path}`,
      name: wt.branch || wt.path.split("/").pop(),
      named: false,
      tabs: [],
      active: false,
      status: null,
      machine: items[0].w?.machine ?? null,
      folder: wt.path,
    };

    const g = { ...mainG, top: wt.path, branch: wt.branch || "", linked: true, pr: undefined };
    ordered.push({ w, i: -1, g, key: `wt:${wt.path}`, also: [], unopened: true });
  }
  return ordered;
}

function visibleGroups(visibleRows: PlanRow[]): WorktreeRowGroup[] {
  const groupMap = new Map<string, WorktreeRowGroup>();
  const groups: WorktreeRowGroup[] = [];
  for (const r of visibleRows) {
    const k = foldKey(r);
    let g = groupMap.get(k);
    if (!g) {
      g = { key: k, repo: r.g?.repo ?? null, rows: [] };
      groupMap.set(k, g);
      groups.push(g);
    }
    g.rows.push(r);
  }
  return groups;
}

function collectOpenRows(
  sp: Workspace[],
  gitState: Record<string, GitInfo | null | undefined>,
  loaded: boolean,
  getWhere: (space: Workspace) => string,
): { open: Set<string>; rows: PlanRow[] } {
  const open = new Set<string>();
  const rows: PlanRow[] = [];
  for (let i = 0; i < sp.length; i++) {
    if (!(i in sp)) continue;
    const w = sp[i];
    const key = getWhere(w);
    open.add(key);
    const g = gitState[key] ?? null;
    if (g?.linked && g.worktrees && !g.worktrees.some((wt) => wt.path === g.top)) continue;
    rows.push({ w, i, g, ok: loaded || key in gitState });
  }
  return { open, rows };
}

export function projectWorktreePlan({
  spaces: sp = [],
  panes: ps = [],
  gitState = {},
  foldedRepos = new Set(),
  loaded = false,
  whereFn = where,
  options = {},
}: PlanInput = {}): {
  groups: WorktreeRowGroup[];
  list: PlanRow[];
  visibleRows: PlanRow[];
  projectKeys: string[];
  rowIndex: Map<string | undefined, number>;
  out: PlanRow[];
} {
  const getWhere = (w: Workspace): string => (whereFn ? whereFn(w, ps) : where(w, ps));
  const { open, rows } = collectOpenRows(sp, gitState, loaded, getWhere);

  const list = mergeWorktreeRows(unopenedMainRows(gitState, open).concat(rows));
  const out: PlanRow[] = [];
  for (const items of projectSections(list)) {
    const ordered = items[0].g ? orderedRepoRows(items) : items;
    const count = ordered.length - 1;
    ordered.forEach((row, index) => out.push({ ...row, head: index === 0, kids: count, count }));
  }

  const visibleRows = applyWorkspaceOptions(
    out.filter((r) => r.unopened || r.ok),
    options,
  );

  const rowIndex = new Map(visibleRows.map((r, i) => [r.w.id, i]));

  const projectKeys = [...new Set(visibleRows.filter((r) => r.head).map(foldKey))];

  return {
    groups: visibleGroups(visibleRows),
    list,
    visibleRows,
    projectKeys,
    rowIndex,
    out,
  };
}
