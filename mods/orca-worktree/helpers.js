// Pure path/age helpers for the worktree dialog, factored out for tests.
// Kept dependency-free (no `herdr` panes/spaces) so callers pass lists explicitly.
export const ROOT = (home) => `${home}/.herdr/worktrees`;

// Home as ~ (git says C:/Users/x where Windows says C:\Users\x).
export const tilde = (path, userHome) => {
  const [p, h] = [path, userHome].map((s) => s.replace(/\\/g, "/"));
  return p.startsWith(h) ? `~${p.slice(h.length)}` : path;
};

export const slug = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

// `now` is injectable so the buckets can be tested without freezing the clock.
export const ago = (s, now = Date.now()) => {
  const d = now / 1000 - s;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : d < 86400 * 60 ? `${Math.round(d / 86400)}d` : `${Math.round(d / 86400 / 30)}mo`;
};

// Where a space is now: its first terminal's live folder, else where it was made.
export function place(s, all = []) {
  if (!s) return null;
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

export const inside = (p, dir) => p === dir || p.startsWith(dir + "/");

// The space showing a checkout: its first terminal is in it (the deepest checkout wins).
export function spaceOf(path, all, on, spaceList, paneList) {
  return spaceList.find((s) => (s.machine ?? null) === (on ?? null) && (() => {
    const at = place(s, paneList)?.replace(/\\/g, "/");
    if (!at || !inside(at, path)) return false;
    return !all.some((c) => c.path !== path && c.path.length > path.length && inside(at, c.path));
  })());
}

// Branches a checkout dialog offers, in `BranchPicker` shape: every local branch with its
// newest commit, which one HEAD is on first, then newest commit first. `held` is the other
// worktree that has the branch checked out — Git refuses a second one, so the row says where.
export function branchRows(refs, checkouts = [], current = null) {
  const held = new Map();
  for (const c of checkouts) if (c.branch && c.branch !== current) held.set(c.branch, c.path);
  return refs
    .map((r) => ({ branch: r.branch, at: r.at ?? 0, current: r.branch === current, held: held.get(r.branch) ?? null }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.at - a.at);
}

// Orca's switch blockers in its order (`WorkspaceBranchPicker.tsx:130-176`): a live agent, a
// checkout whose changes could not be read, then uncommitted changes. "" means it may switch.
export function switchBlocker({ agentWorking = false, statusKnown = true, dirtyCount = 0 } = {}) {
  if (agentWorking) return "An agent is working in this workspace. Switch branches after it finishes, or close its tab if it has stopped.";
  if (!statusKnown) return "Couldn't read this checkout's changes, so Git can't promise a safe switch.";
  if (dirtyCount > 0) return dirtyCount === 1
    ? "Commit or discard 1 changed file before switching branches."
    : `Commit or discard ${dirtyCount} changed files before switching branches.`;
  return "";
}
