function parseWorktreeList(output) {
	const out = [];
	for (const block of output.trim().split(/\r?\n\r?\n/)) {
		let path = "", branch = "", bare = false;
		for (const line of block.trim().split(/\r?\n/)) if (line.startsWith("worktree ")) path = line.slice(9);
		else if (line.startsWith("branch ")) branch = line.slice(7).replace(/^refs\/heads\//, "");
		else if (line === "bare" || line.startsWith("prunable")) bare = true;
		if (path && !bare) out.push({
			path,
			branch
		});
	}
	return out;
}
function place(s, _ps = []) {
	return s?.folder ?? null;
}
const where = (s, ps = []) => JSON.stringify([s?.machine ?? null, place(s, ps)]);
function groupSpaceIds(group, live = []) {
	const known = new Set(live ?? []);
	const ids = [];
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
function forgetProject(cache, repo, liveKeys = []) {
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
function pruneGitCache(cache, spaces, checked = {}) {
	const active = new Set(spaces.map((s) => where(s)));
	const remove = (key) => {
		delete cache[key];
		delete checked[key];
	};
	for (const key of Object.keys(cache)) if (cache[key] === null && !active.has(key)) remove(key);
}
const base = (path) => typeof path === "string" ? path.replace(/\/+$/, "").split("/").pop() ?? "" : "";
const readPair = (s) => {
	try {
		const v = JSON.parse(s);
		return Array.isArray(v) ? v : [];
	} catch {
		return [];
	}
};
function activeReviewKeys(rows) {
	return [...new Set(rows.filter((r) => !r.w.machine && Boolean(r.g?.branch)).map((r) => `${readPair(r.g.repo)[1]}::${r.g.branch}`))];
}
function foldKey({ w, g }) {
	return g?.repo ?? `space:${w.id}`;
}
const STATUS_RANK = {
	blocked: 4,
	done: 3,
	working: 2,
	idle: 1
};
function planRenderRows(rows, groupBy, repairing, folded, hidden = repairing) {
	const hosts =                 new Map();
	rows.forEach((row, index) => {
		const machine = row.w.machine ?? null;
		if (!hosts.has(machine)) hosts.set(machine, []);
		hosts.get(machine)?.push(index);
	});
	const names = [null, ...                new Set([...rows.map((r) => r.w.machine).filter(Boolean), ...repairing])].filter((m) => hosts.has(m) || repairing.has(m));
	const result = [];
	const addRows = (indices) => {
		if (groupBy !== "workspace-status") {
			indices.forEach((index, position) => result.push({
				kind: "row",
				index,
				position
			}));
			return;
		}
		for (const [status, label] of [
			["blocked", "Blocked"],
			["working", "Working"],
			["done", "Done"],
			["idle", "Idle"]
		]) {
			const group = indices.filter((index) => rows[index].w.status === status);
			if (group.length) result.push({
				kind: "status",
				label,
				count: group.length
			});
			group.forEach((index, position) => result.push({
				kind: "row",
				index,
				position
			}));
		}
	};
	if (names.filter((m) => hosts.has(m)).length <= 1 && !names.some((m) => repairing.has(m))) addRows(rows.map((_, i) => i));
	else for (const machine of names) {
		const indices = hosts.get(machine) ?? [];
		result.push({
			kind: "host",
			machine,
			count: indices.length
		});
		if (!hidden.has(machine) && !folded.has(machine)) addRows(indices);
	}
	return result;
}
function agentsByRow(rows, agents) {
	const result = new Map(rows.map((row) => [row, []]));
	const tabs =                 new Map();
	for (const row of rows) {
		const ids = new Set([row.w, ...(row.also ?? []).map((a) => a.w)].flatMap((w) => (w.tabs ?? []).map((t) => t.id)));
		for (const id of ids) {
			if (!tabs.has(id)) tabs.set(id, []);
			tabs.get(id)?.push(row);
		}
	}
	for (const agent of agents) for (const row of tabs.get(agent.tab) ?? []) result.get(row)?.push(agent);
	return result;
}
function otherTabs(row, agents) {
	const withAgent = new Set(agents.map((a) => a.tab));
	const tabs = [row.w, ...(row.also ?? []).map((a) => a.w)].flatMap((w) => w.tabs ?? []);
	return [...new Map(tabs.filter((t) => !withAgent.has(t.id)).map((t) => [t.id, t])).values()];
}
const otherTabCount = (row, agents) => otherTabs(row, agents).length;
function recentOf(r) {
	return Math.max(0, ...(r.w.tabs ?? []).map((tab) => tab.changed_at ?? 0));
}
function optionTitle(r) {
	const branch = r.g?.branch ?? r.w.branch ?? null;
	return !r.w.named && branch ? branch : r.w.name;
}
function sortRows(rows, sortBy) {
	if (sortBy === "manual") return rows;
	const main = rows.filter((r) => r.g && !r.g.linked);
	const rest = rows.filter((r) => !(r.g && !r.g.linked));
	const cmp = sortBy ? {
		name: (a, b) => optionTitle(a).localeCompare(optionTitle(b)),
		smart: (a, b) => (STATUS_RANK[b.w.status ?? ""] ?? 0) - (STATUS_RANK[a.w.status ?? ""] ?? 0) || recentOf(b) - recentOf(a) || optionTitle(a).localeCompare(optionTitle(b)),
		recent: (a, b) => recentOf(b) - recentOf(a) || optionTitle(a).localeCompare(optionTitle(b)),
		repo: (a, b) => (a.g?.name ?? "").localeCompare(b.g?.name ?? "") || optionTitle(a).localeCompare(optionTitle(b))
	}[sortBy] : void 0;
	return cmp ? [...main, ...rest.sort(cmp)] : rows;
}
function rowFilter(o, hosts, repos) {
	return (r) => {
		if (hosts && !hosts.has(r.w.machine ?? null)) return false;
		if (!r.g) return true;
		if (o.hideDefaultBranchWorkspace && !r.g.linked) return false;
		if (o.hideDetachedHeadWorkspaces && r.g.branch === "(detached)") return false;
		return !repos || repos.has(r.g.repo);
	};
}
function groupWorkspaceBlocks(rows) {
	const blocks = [];
	for (const r of rows) {
		const k = r.g ? `repo:${r.g.repo}` : `space:${r.w.id}`;
		const last = blocks[blocks.length - 1];
		if (last?.key === k) last.rows.push(r);
		else blocks.push({
			key: k,
			repo: r.g?.repo ?? null,
			rows: [r]
		});
	}
	return blocks;
}
function orderWorkspaceBlocks(blocks, orderBy) {
	if (orderBy === "name") {
		const title = (block) => block.rows[0].g?.name ?? optionTitle(block.rows[0]);
		blocks.sort((a, b) => title(a).localeCompare(title(b)));
	} else if (orderBy === "recent") blocks.sort((a, b) => recentOf(b.rows[0]) - recentOf(a.rows[0]));
}
function applyWorkspaceOptions(rows, o = {}) {
	const hosts = Array.isArray(o.visibleWorkspaceHostIds) ? new Set(o.visibleWorkspaceHostIds) : null;
	const repos = Array.isArray(o.filterRepoIds) && o.filterRepoIds.length ? new Set(o.filterRepoIds) : null;
	const kept = rows.filter(rowFilter(o, hosts, repos));
	if (o.groupBy !== "repo") return sortRows(kept, o.sortBy);
	const blocks = groupWorkspaceBlocks(kept);
	orderWorkspaceBlocks(blocks, o.projectOrderBy);
	return blocks.flatMap((b) => sortRows(b.rows, o.sortBy).map((r, i) => ({
		...r,
		head: i === 0
	})));
}
function mainCheckout(key, g) {
	return g.worktrees?.[0] ?? (g.linked ? null : {
		path: readPair(key)[1] ?? null,
		branch: g.branch
	});
}
function unopenedMainRows(gitState, open) {
	const anchored =                 new Set();
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
				folder: main.path
			},
			i: -1,
			g: {
				...g,
				top: main.path,
				linked: false,
				branch: main.branch ?? g.branch
			},
			ok: true,
			unopened: true
		});
	}
	return mainRows;
}
function mergeWorktreeRows(rows) {
	const seen =                 new Map();
	const list = [];
	for (const r of rows) {
		const key = r.g ? JSON.stringify([r.w.machine ?? null, r.g.top]) : `space:${r.w.id}`;
		if (seen.has(key)) {
			seen.get(key)?.also?.push(r);
			continue;
		}
		const row = {
			...r,
			key,
			also: []
		};
		seen.set(key, row);
		list.push(row);
	}
	return list;
}
function projectSections(list) {
	const repoGroups =                 new Map();
	for (const r of list) {
		const key = r.g ? r.g.repo : `space:${r.w.id}`;
		if (!repoGroups.has(key)) repoGroups.set(key, []);
		repoGroups.get(key)?.push(r);
	}
	return repoGroups.values();
}
function orderedRepoRows(items) {
	const mainG = items.find((it) => it.g && !it.g.linked)?.g ?? items[0].g;
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
			folder: wt.path
		};
		const g = {
			...mainG,
			top: wt.path,
			branch: wt.branch || "",
			linked: true,
			pr: void 0
		};
		ordered.push({
			w,
			i: -1,
			g,
			key: `wt:${wt.path}`,
			also: [],
			unopened: true
		});
	}
	return ordered;
}
function visibleGroups(visibleRows) {
	const groupMap =                 new Map();
	const groups = [];
	for (const r of visibleRows) {
		const k = foldKey(r);
		let g = groupMap.get(k);
		if (!g) {
			g = {
				key: k,
				repo: r.g?.repo ?? null,
				rows: []
			};
			groupMap.set(k, g);
			groups.push(g);
		}
		g.rows.push(r);
	}
	return groups;
}
function collectOpenRows(sp, gitState, loaded, getWhere) {
	const open =                 new Set();
	const rows = [];
	for (let i = 0; i < sp.length; i++) {
		if (!(i in sp)) continue;
		const w = sp[i];
		const key = getWhere(w);
		open.add(key);
		const g = gitState[key] ?? null;
		if (g?.linked && g.worktrees && !g.worktrees.some((wt) => wt.path === g.top)) continue;
		rows.push({
			w,
			i,
			g,
			ok: loaded || key in gitState
		});
	}
	return {
		open,
		rows
	};
}
function projectWorktreePlan({ spaces: sp = [], panes: ps = [], gitState = {}, foldedRepos =                 new Set(), loaded = false, whereFn = where, options = {} } = {}) {
	const getWhere = (w) => whereFn ? whereFn(w, ps) : where(w, ps);
	const { open, rows } = collectOpenRows(sp, gitState, loaded, getWhere);
	const list = mergeWorktreeRows(unopenedMainRows(gitState, open).concat(rows));
	const out = [];
	for (const items of projectSections(list)) {
		const ordered = items[0].g ? orderedRepoRows(items) : items;
		const count = ordered.length - 1;
		ordered.forEach((row, index) => out.push({
			...row,
			head: index === 0,
			kids: count,
			count
		}));
	}
	const visibleRows = applyWorkspaceOptions(out.filter((r) => r.unopened || r.ok), options);
	const rowIndex = new Map(visibleRows.map((r, i) => [r.w.id, i]));
	const projectKeys = [...new Set(visibleRows.filter((r) => r.head).map(foldKey))];
	return {
		groups: visibleGroups(visibleRows),
		list,
		visibleRows,
		projectKeys,
		rowIndex,
		out
	};
}

export { STATUS_RANK, activeReviewKeys, agentsByRow, applyWorkspaceOptions, base, foldKey, forgetProject, groupSpaceIds, optionTitle, otherTabCount, otherTabs, parseWorktreeList, place, planRenderRows, projectWorktreePlan, pruneGitCache, readPair, recentOf, sortRows, where };
