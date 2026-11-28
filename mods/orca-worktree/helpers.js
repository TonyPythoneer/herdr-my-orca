const ROOT = (home) => `${home}/.herdr/worktrees`;
const tilde = (path, userHome) => {
	const [p, h] = [path, userHome].map((s) => s.replace(/\\/g, "/"));
	return p.startsWith(h) ? `~${p.slice(h.length)}` : path;
};
const slug = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const HOUR = 3600;
const DAY = 86400;
const DAYS_PER_MONTH = 30;
const MONTH_THRESHOLD_DAYS = 60;
const ago = (s, now = Date.now()) => {
	const d = now / 1e3 - s;
	if (d < HOUR) return `${Math.max(1, Math.round(d / 60))}m`;
	if (d < DAY) return `${Math.round(d / HOUR)}h`;
	if (d < DAY * MONTH_THRESHOLD_DAYS) return `${Math.round(d / DAY)}d`;
	return `${Math.round(d / DAY / DAYS_PER_MONTH)}mo`;
};
function place(s, all = []) {
	if (!s) return null;
	const tabs = new Set((s.tabs ?? []).map((c) => c.id));
	return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}
const inside = (p, dir) => p === dir || p.startsWith(dir + "/");
function spaceOf(path, all, on, spaceList, paneList) {
	return spaceList.find((s) => (s.machine ?? null) === (on ?? null) && (() => {
		const at = place(s, paneList)?.replace(/\\/g, "/");
		if (!at || !inside(at, path)) return false;
		return !all.some((c) => c.path !== path && c.path.length > path.length && inside(at, c.path));
	})());
}
function branchRows(refs, checkouts = [], current = null) {
	const held =                 new Map();
	for (const c of checkouts) if (c.branch && c.branch !== current) held.set(c.branch, c.path);
	return refs.map((r) => ({
		branch: r.branch,
		at: r.at ?? 0,
		current: r.branch === current,
		held: held.get(r.branch) ?? null
	})).sort((a, b) => Number(b.current) - Number(a.current) || b.at - a.at);
}
function switchBlocker({ agentWorking = false, statusKnown = true, dirtyCount = 0 } = {}) {
	if (agentWorking) return "An agent is working in this workspace. Switch branches after it finishes, or close its tab if it has stopped.";
	if (!statusKnown) return "Couldn't read this checkout's changes, so Git can't promise a safe switch.";
	if (dirtyCount > 0) return dirtyCount === 1 ? "Commit or discard 1 changed file before switching branches." : `Commit or discard ${dirtyCount} changed files before switching branches.`;
	return "";
}

export { ROOT, ago, branchRows, inside, place, slug, spaceOf, switchBlocker, tilde };
