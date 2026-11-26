// Worktree plan projection module: transforms raw git worktrees and Herdr spaces into
// ordered, grouped, and deduplicated worktree rows.
//
// Ports corresponding Orca concepts:
// - `parseWorktreeList`: `src/shared/git/worktrees/git-worktree-porcelain-parser.ts:4`
// - Host-qualified identity & space deduplication: `src/shared/worktree/host-qualified-identity.ts`
// - Catalog hydration & unvisited worktree synthesis: `src/renderer/src/store/slices/worktrees/listing/hydrated-worktree-purge.ts:19-31`
// - Main worktree first ordering: `src/shared/sidebar-list/section-order.ts:3-16` (`orderMainWorktreeFirst`)
// - Repo-based group headers & ordering: `src/shared/sidebar-list/sidebar-row-plan.ts:58,155` (`buildOrderedGroups`)
// - Rendered project collapse keys: `src/renderer/src/components/sidebar/worktree-list/listing/project-collapse-all.ts:4-16` (`getRenderedProjectCollapseKeys`)
// - Discovery gate: `src/renderer/src/startup/startup-worktree-refresh.ts:78-82`, `EmptyState.tsx:14`

/**
 * Parses raw git worktree porcelain output (`git worktree list --porcelain`).
 * Port of Orca's `parseWorktreeList` (`git-worktree-porcelain-parser.ts:4`).
 * The first worktree emitted is the main checkout.
 */
export function parseWorktreeList(output) {
  const out = [];
  for (const block of output.trim().split(/\r?\n\r?\n/)) {
    let path = "", branch = "", bare = false;
    for (const line of block.trim().split(/\r?\n/)) {
      if (line.startsWith("worktree ")) path = line.slice(9);
      else if (line.startsWith("branch ")) branch = line.slice(7).replace(/^refs\/heads\//, "");
      else if (line === "bare" || line.startsWith("prunable")) bare = true;
    }
    if (path && !bare) out.push({ path, branch });
  }
  return out;
}

/**
 * Where a space is: its designated workspace folder (GLOSSARY.md:
 * "The space is the scope; the terminal is only where keystrokes go").
 * Terminal cwd changes inside a space must never change its location key.
 */
export function place(s, _ps = []) {
  return s?.folder ?? null;
}

/**
 * Host-qualified workspace identity key [machine, folder].
 * Port of `getWorktreeHostIdentity` (`host-qualified-identity.ts:48`).
 */
export const where = (s, ps) => JSON.stringify([s?.machine ?? null, place(s, ps)]);

/**
 * The open spaces a sidebar group covers: its rows name them (`r.w`, plus any space merged
 * onto the same checkout), so a project's commands need no git and no path match.
 * Only ids the host knows are returned: a row git lists with no space open gets a made-up
 * id (`repo:` for a main checkout, `wt:` for a sibling) and `space.close` rejects it
 * ("no space \"repo:[null,...]\"").
 */
export function groupSpaceIds(group, live) {
  const known = new Set(live ?? []);
  const ids = [];
  // Small groups avoid allocating a second Set; promote once the linear search is bounded.
  let seen = null;
  function add(w) {
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

/**
 * Forgets a repo's catalog entries (`git.cache.v2`) and returns how many it removed.
 *
 * The sidebar draws every repo the cache has ever read: a main checkout and each worktree
 * stay listed after their spaces close, and only `pruneGitCache` ever drops an entry, one
 * that is `null` and holds no space. A person who no longer wants a project in the list
 * (Orca's "Remove Project") asks for this: the rows go, nothing on disk is touched, and the
 * next space opened there seeds the cache again. A key a live space still sits on is kept,
 * so a group with an open space never loses the row it draws from.
 */
export function forgetProject(cache, repo, liveKeys = []) {
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

export function pruneGitCache(cache, spaces, checked = {}) {
  const active = new Set(spaces.map(s => where(s)));
  const remove = key => { delete cache[key]; delete checked[key]; };
  for (const key of Object.keys(cache)) {
    if (cache[key] === null && !active.has(key)) remove(key);
  }
}

export const base = (path) => typeof path === "string" ? path.replace(/\/+$/, "").split("/").pop() : "";

/**
 * A `[machine, path|repo]` pair written by `where`: anything else reads as [].
 */
export const readPair = (s) => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export function activeReviewKeys(rows) {
  return [...new Set(rows.filter(r => !r.w.machine && r.g?.branch)
    .map(r => `${readPair(r.g.repo)[1]}::${r.g.branch}`))];
}

/**
 * Project group fold key: repo path for repository worktrees, or `space:<id>` for standalone folders.
 * Port of Orca's project section collapse keys (`project-collapse-all.ts:10-12`).
 */
export function foldKey({ w, g }) {
  return g?.repo ?? `space:${w.id}`;
}

/**
 * Attention priority ranking matching Herdr host's rollup (`herdr-app/src/model.rs:92-97`):
 * blocked (4) > done (3) > working (2) > idle (1) > none (0).
 */
export const STATUS_RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

export function planRenderRows(rows, groupBy, repairing, folded, hidden = repairing) {
  const hosts = new Map();
  rows.forEach((row, index) => {
    const machine = row.w.machine ?? null;
    if (!hosts.has(machine)) hosts.set(machine, []);
    hosts.get(machine).push(index);
  });
  const names = [null, ...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...repairing])]
    .filter(m => hosts.has(m) || repairing.has(m));
  const result = [];
  const addRows = (indices) => {
    if (groupBy !== "workspace-status") {
      indices.forEach((index, position) => result.push({ kind: "row", index, position }));
      return;
    }
    for (const [status, label] of [["blocked", "Blocked"], ["working", "Working"], ["done", "Done"], ["idle", "Idle"]]) {
      const group = indices.filter(index => rows[index].w.status === status);
      if (group.length) result.push({ kind: "status", label, count: group.length });
      group.forEach((index, position) => result.push({ kind: "row", index, position }));
    }
  };
  if (names.filter(m => hosts.has(m)).length <= 1 && !names.some(m => repairing.has(m))) {
    addRows(rows.map((_, i) => i));
  } else for (const machine of names) {
    const indices = hosts.get(machine) ?? [];
    result.push({ kind: "host", machine, count: indices.length });
    if (!hidden.has(machine) && !folded.has(machine)) addRows(indices);
  }
  return result;
}

export function agentsByRow(rows, agents) {
  const result = new Map(rows.map(row => [row, []]));
  const tabs = new Map();
  for (const row of rows) {
    const ids = new Set([row.w, ...(row.also ?? []).map(a => a.w)].flatMap(w => (w.tabs ?? []).map(t => t.id)));
    for (const id of ids) {
      if (!tabs.has(id)) tabs.set(id, []);
      tabs.get(id).push(row);
    }
  }
  for (const agent of agents) for (const row of tabs.get(agent.tab) ?? []) result.get(row).push(agent);
  return result;
}

/**
 * Tabs on a card (its own space plus merged ones) that hold no agent: shells, editors, mods.
 * `agents` is the card's own list from `agentsByRow`, so a tab counts once however many agents it has.
 */
export function otherTabs(row, agents) {
  const withAgent = new Set(agents.map(a => a.tab));
  const tabs = [row.w, ...(row.also ?? []).map(a => a.w)].flatMap(w => w.tabs ?? []);
  return [...new Map(tabs.filter(t => !withAgent.has(t.id)).map(t => [t.id, t])).values()];
}

export const otherTabCount = (row, agents) => otherTabs(row, agents).length;

/**
 * Recent = the newest tab change of the card (`smart-sort.ts:31` reads `lastActivityAt`; Herdr's
 * tab carries `changed_at`), so the timestamp the panes already report is the sort key.
 */
export function recentOf(r) {
  return Math.max(0, ...(r.w.tabs ?? []).map((tab) => tab.changed_at ?? 0));
}

export function optionTitle(r) {
  const branch = r.g?.branch ?? r.w.branch ?? null;
  return !r.w.named && branch ? branch : r.w.name;
}

/**
 * `sidebar-row-plan.ts:185` sorts inside a project group and keeps the main worktree first for
 * every sort but manual (`section-order.ts:3-16`).
 */
export function sortRows(rows, sortBy) {
  if (sortBy === "manual") return rows;
  const main = rows.filter((r) => r.g && !r.g.linked);
  const rest = rows.filter((r) => !(r.g && !r.g.linked));
  const cmp = {
    name: (a, b) => optionTitle(a).localeCompare(optionTitle(b)),
    smart: (a, b) => (STATUS_RANK[b.w.status] ?? 0) - (STATUS_RANK[a.w.status] ?? 0)
      || recentOf(b) - recentOf(a) || optionTitle(a).localeCompare(optionTitle(b)),
    recent: (a, b) => recentOf(b) - recentOf(a) || optionTitle(a).localeCompare(optionTitle(b)),
    repo: (a, b) => (a.g?.name ?? "").localeCompare(b.g?.name ?? "") || optionTitle(a).localeCompare(optionTitle(b)),
  }[sortBy];
  return cmp ? [...main, ...rest.sort(cmp)] : rows;
}

/**
 * `buildWorkspaceRowPredicate` (workspace-row-filters.ts:99-130) over the plan's rows. The host
 * scope filters every row; folder workspaces then skip the kind/repo/sleeping filters (:119-121),
 * which is why a project filter never hides a folder workspace.
 */
export function applyWorkspaceOptions(rows, o = {}) {
  const hosts = Array.isArray(o.visibleWorkspaceHostIds) ? new Set(o.visibleWorkspaceHostIds) : null;
  const repos = Array.isArray(o.filterRepoIds) && o.filterRepoIds.length ? new Set(o.filterRepoIds) : null;
  const kept = rows.filter((r) => {
    if (hosts && !hosts.has(r.w.machine ?? null)) return false;
    if (!r.g) return true;
    // Herdr's git cache stores no default-branch name, so "default branch" is the repo's main
    // checkout (`!linked`), the row Orca's scan marks `isMainWorktree`.
    if (o.hideDefaultBranchWorkspace && !r.g.linked) return false;
    if (o.hideDetachedHeadWorkspaces && r.g.branch === "(detached)") return false;
    if (repos && !repos.has(r.g.repo)) return false;
    return true;
  });
  if (o.groupBy !== "repo") return sortRows(kept, o.sortBy);
  // The plan emits one project's rows consecutively, so consecutive runs are the groups.
  const blocks = [];
  for (const r of kept) {
    const k = r.g ? `repo:${r.g.repo}` : `space:${r.w.id}`;
    const last = blocks[blocks.length - 1];
    if (last?.key === k) last.rows.push(r); else blocks.push({ key: k, rows: [r] });
  }
  if (o.projectOrderBy === "name") {
    const title = (block) => block.rows[0].g?.name ?? optionTitle(block.rows[0]);
    blocks.sort((a, b) => title(a).localeCompare(title(b)));
  } else if (o.projectOrderBy === "recent") {
    blocks.sort((a, b) => recentOf(b.rows[0]) - recentOf(a.rows[0]));
  }
  const out = [];
  for (const b of blocks) {
    // Only the block's first row heads it, so filtering the head row promotes the next one.
    sortRows(b.rows, o.sortBy).forEach((r, i) => out.push({ ...r, head: i === 0 }));
  }
  return out;
}

// An older cache entry has no worktree list; a non-linked one is its own main checkout.
function mainCheckout(key, g) {
  return g.worktrees?.[0] ?? (g.linked ? null : { path: readPair(key)[1], branch: g.branch });
}

function unopenedMainRows(gitState, open) {
  // Orca's projects are repos, not sessions (`listRepoWorktrees`): a group exists because the
  // repo is known, and its rows are `git worktree list` — main first
  // (`orderMainWorktreeFirst`, section-order.ts:4-16). What is open must not decide this: all
  // of a repo's spaces can be linked worktrees, and the main checkout still has a card.
  const anchored = new Set();
  const mainRows = [];
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

function mergeWorktreeRows(rows) {
  // A repo worktree is one card: `linked` worktrees and second same-checkout spaces fold
  // into the first space on that top-level folder. Folder spaces merge only with themselves.
  // (host-qualified-identity.ts: getWorktreeHostIdentity)
  const seen = new Map();
  const list = [];
  for (const r of rows) {
    const key = r.g ? JSON.stringify([r.w.machine ?? null, r.g.top]) : `space:${r.w.id}`;
    if (seen.has(key)) {
      seen.get(key).also.push(r);
      continue;
    }
    const row = { ...r, key, also: [] };
    seen.set(key, row);
    list.push(row);
  }
  return list;
}

function projectSections(list) {
  // Group rows into sections: git repos group by repo; folder workspaces stand alone.
  // Port of Orca's `buildProjectSections` (project-section-grouping.ts:58-78,216-231).
  const repoGroups = new Map();

  for (const r of list) {
    const key = r.g ? r.g.repo : `space:${r.w.id}`;
    if (!repoGroups.has(key)) {
      repoGroups.set(key, []);
    }
    repoGroups.get(key).push(r);
  }
  return repoGroups.values();
}

function orderedRepoRows(items) {
  // Git repo group:
  // Partition items so main worktree checkout is first, exactly as Orca's
  // `orderMainWorktreeFirst` (section-order.ts:3-16, sidebar-row-plan.ts:183-186).
  const mainG = items.find((it) => it.g && !it.g.linked)?.g ?? items[0].g;
  const mainWorktrees = items.filter((it) => it.g && !it.g.linked);
  const linkedWorktrees = items.filter((it) => it.g && it.g.linked);
  const ordered = [...mainWorktrees, ...linkedWorktrees];

  // Append unopened worktrees known to git that are not already opened as spaces.
  // Port of Orca's `listRepoWorktrees` (sidebar-row-plan.ts:180-189, section-order.ts:3-16).
  const openedTops = new Set(ordered.map((it) => it.g.top));
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
    // No `...r.g`: a sibling worktree shares the repo but not the review. Orca reads each
    // worktree's own branch, so carrying the main worktree's PR onto this row was the bug.
    // Detached HEAD worktrees have no branch name; they must not fall back to `mainG.branch`.
    const g = { ...mainG, top: wt.path, branch: wt.branch || "", linked: true, pr: undefined };
    ordered.push({ w, i: -1, g, key: `wt:${wt.path}`, also: [], unopened: true });
  }
  return ordered;
}

function visibleGroups(visibleRows) {
  // Grouped structure by project key (repo or space:<id>)
  const groupMap = new Map();
  const groups = [];
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

/** Collect open identities and discoverable rows in one pass, before synthesizing main checkouts. */
function collectOpenRows(sp, gitState, loaded, getWhere) {
  // Orca draws rows only after discovery completes.
  // startup-worktree-refresh.ts:78-82 sets startupWorktreeRefreshCompleted in a finally block,
  // and EmptyState.tsx:14 gates "No workspaces found" on that flag.
  const open = new Set();
  const rows = [];
  for (let i = 0; i < sp.length; i++) {
    if (!(i in sp)) continue;
    const w = sp[i];
    const key = getWhere(w);
    open.add(key);
    const g = gitState[key] ?? null;
    if (g?.linked && g.worktrees && !g.worktrees.some(wt => wt.path === g.top)) continue;
    rows.push({ w, i, g, ok: loaded || key in gitState });
  }
  return { open, rows };
}

/**
 * Projects the worktree plan from active spaces, terminal panes, and cached git state.
 * Pure data transformation: no UI components, timers, or side effects.
 *
 * Port of Orca's `planSidebarRows` (`sidebar-row-plan.ts:64-165`) and `useMemo` row derivation
 * (`use-section-rows.ts:147`).
 *
 * @param {Object} options
 * @param {Array} [options.spaces] Active Herdr spaces
 * @param {Array} [options.panes] Active terminal panes
 * @param {Object} [options.gitState] Cached repository status map keyed by `where()`
 * @param {Set} [options.foldedRepos] Set of collapsed project keys
 * @param {boolean} [options.loaded] Whether startup worktree refresh has completed
 * @param {Function} [options.whereFn] Custom space location resolver (defaults to `where`)
 * @param {Object} [options.options] Workspace view options (filters, sort, grouping)
 * @returns {{ groups: Array, list: Array, visibleRows: Array, projectKeys: string[], rowIndex: Map<string, number>, out: Array }}
 */
export function projectWorktreePlan({
  spaces: sp = [],
  panes: ps = [],
  gitState = {},
  foldedRepos = new Set(),
  loaded = false,
  whereFn = where,
  options = {},
} = {}) {
  const getWhere = (w) => (whereFn ? whereFn(w, ps) : where(w, ps));
  const { open, rows } = collectOpenRows(sp, gitState, loaded, getWhere);

  // The main checkout precedes any linked spaces in its group.
  const list = mergeWorktreeRows(unopenedMainRows(gitState, open).concat(rows));
  const out = [];
  for (const items of projectSections(list)) {
    const ordered = items[0].g ? orderedRepoRows(items) : items;
    const count = ordered.length - 1;
    ordered.forEach((row, index) => out.push({ ...row, head: index === 0, kids: count, count }));
  }

  // Nothing here mutates or dispatches: the order below IS the answer, recomputed each pass.
  // Ordering it in the plan is what keeps the list from rewriting itself while it loads.
  const visibleRows = applyWorkspaceOptions(out.filter((r) => r.unopened || r.ok), options);

  // The drag indicator needs both cards' row positions. `i` is the space index, not the
  // row index (folded groups, merged spaces and unopened worktrees all shift it), so the
  // dragging card's position is looked up here, by its row id.
  // Port of `use-document-drop.ts:72`.
  const rowIndex = new Map(visibleRows.map((r, i) => [r.w.id, i]));

  // Every project key currently rendered, for `setAllProjectsCollapsed`. Orca collects them
  // from the row plan (`getRenderedProjectCollapseKeys`, project-collapse-all.ts:7-13: all rendered headers).
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
