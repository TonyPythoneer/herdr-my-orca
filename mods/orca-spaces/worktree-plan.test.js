import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseWorktreeList, projectWorktreePlan, where, groupSpaceIds } from './worktree-plan.js';

test('deleted worktrees disappear from the sidebar without closing their tabs', () => {
  const repo = JSON.stringify([null, '/repo/.git']);
  const space = { id: 'deleted', folder: '/deleted', tabs: [{ id: 'tab' }] };
  const catalog = parseWorktreeList('worktree /repo\nbranch refs/heads/main\n\nworktree /deleted\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n');
  const gitState = { [where(space)]: { repo, top: '/deleted', name: 'repo', linked: true, branch: 'old', worktrees: catalog } };
  const plan = projectWorktreePlan({ spaces: [space], gitState, loaded: true });
  assert.equal(plan.visibleRows.some(r => r.w.id === 'deleted'), false);
  assert.deepEqual(space.tabs, [{ id: 'tab' }]);
  assert.deepEqual(catalog, [{ path: '/repo', branch: 'main' }]);
});

test('duplicate worktree spaces stay attached to the first row in order', () => {
  const spaces = [
    { id: 'first', folder: '/repo', tabs: [] },
    { id: 'other', folder: '/other', tabs: [] },
    { id: 'second', folder: '/repo', tabs: [] },
    { id: 'third', folder: '/repo', tabs: [] },
  ];
  const gitState = Object.fromEntries(spaces.map(w => [where(w), {
    repo: w.folder, top: w.folder, name: w.folder, linked: false,
    worktrees: [{ path: w.folder }],
  }]));
  const plan = projectWorktreePlan({ spaces, gitState, loaded: true });
  assert.deepEqual(plan.list.map(r => r.w.id), ['first', 'other']);
  assert.deepEqual(plan.list[0].also.map(r => r.w.id), ['second', 'third']);
});

test('agents are grouped by card while preserving agent order and merged tabs', async () => {
  const { agentsByRow } = await import('./worktree-plan.js');
  const rows = [
    { w: { tabs: [{ id: 'a' }, { id: 'a' }] }, also: [{ w: { tabs: [{ id: 'b' }] } }] },
    { w: { tabs: [{ id: 'c' }] } },
    { w: { tabs: [{ id: 'a' }] } },
  ];
  const agents = [{ tab: 'b', id: 1 }, { tab: 'c', id: 2 }, { tab: 'a', id: 3 }, { tab: 'none', id: 4 }];
  const grouped = agentsByRow(rows, agents);
  assert.deepEqual(rows.map(row => grouped.get(row).map(a => a.id)), [[1, 3], [2], [3]]);
});

test('other tabs counts tabs without an agent once, across merged spaces', async () => {
  const { otherTabCount } = await import('./worktree-plan.js');
  const row = { w: { tabs: [{ id: 'a' }, { id: 'b' }, { id: 'b' }] }, also: [{ w: { tabs: [{ id: 'c' }, { id: 'd' }] } }] };
  assert.equal(otherTabCount(row, [{ tab: 'a' }, { tab: 'a' }, { tab: 'd' }]), 2);
  assert.equal(otherTabCount({ w: {} }, []), 0);
  const { otherTabs } = await import('./worktree-plan.js');
  assert.deepEqual(otherTabs(row, [{ tab: 'a' }, { tab: 'd' }]).map(t => t.id), ['b', 'c']);
});

test('pruning git cache drops only inactive negative entries and preserves projects', async () => {
  const { pruneGitCache } = await import('./worktree-plan.js');
  const active = { id: 'open', folder: '/open' };
  const cache = { [where(active)]: null, [where({ folder: '/old' })]: null, repo: { repo: 'known' } };
  pruneGitCache(cache, [active]);
  assert.deepEqual(cache, { [where(active)]: null, repo: { repo: 'known' } });
});

test('render row planning preserves host, status, fold and repair order', async () => {
  const { planRenderRows } = await import('./worktree-plan.js');
  const rows = [
    { w: { machine: null, status: 'idle' } },
    { w: { machine: 'remote', status: 'working' } },
    { w: { machine: 'remote', status: 'blocked' } },
  ];
  assert.deepEqual(planRenderRows(rows, 'workspace-status', new Set(['offline']), new Set(['remote'])), [
    { kind: 'host', machine: null, count: 1 },
    { kind: 'status', label: 'Idle', count: 1 },
    { kind: 'row', index: 0, position: 0 },
    { kind: 'host', machine: 'remote', count: 2 },
    { kind: 'host', machine: 'offline', count: 0 },
  ]);
  assert.deepEqual(planRenderRows(rows.slice(0, 1), 'repo', new Set(), new Set()), [
    { kind: 'row', index: 0, position: 0 },
  ]);
  assert.deepEqual(planRenderRows(rows, 'workspace-status', new Set(), new Set()).map(x => x.kind === 'row' ? x.index : x.kind), [
    'host', 'status', 0, 'host', 'status', 2, 'status', 1,
  ]);
});

test('a listed repair entry without a usable repair state does not hide its rows', async () => {
  const { planRenderRows } = await import('./worktree-plan.js');
  const rows = [{ w: { machine: 'remote', status: 'idle' } }];
  assert.deepEqual(planRenderRows(rows, 'repo', new Set(['remote']), new Set(), new Set()), [
    { kind: 'host', machine: 'remote', count: 1 },
    { kind: 'row', index: 0, position: 0 },
  ]);
});

test('render descriptors use current row positions after a same-shape reorder', async () => {
  const { planRenderRows } = await import('./worktree-plan.js');
  const first = [{ w: { id: 'a', status: 'idle' } }, { w: { id: 'b', status: 'idle' } }];
  const descriptors = planRenderRows(first, 'repo', new Set(), new Set());
  const reordered = [first[1], first[0]];
  assert.deepEqual(descriptors.map(d => reordered[d.index].w.id), ['b', 'a']);
});

test('active review keys cover each visible local branch once', async () => {
  const { activeReviewKeys } = await import('./worktree-plan.js');
  const repo = JSON.stringify([null, '/repo/.git']);
  const rows = [
    { w: {}, g: { repo, branch: 'main' } },
    { w: {}, g: { repo, branch: 'main' } },
    { w: {}, g: { repo, branch: 'feature' } },
    { w: { machine: 'remote' }, g: { repo, branch: 'remote' } },
    { w: {}, g: { repo, branch: '' } },
  ];
  assert.deepEqual(activeReviewKeys(rows), ['/repo/.git::main', '/repo/.git::feature']);
});


test('catalog pruning preserves unopened and disconnected projects across restart', async () => {
  const { pruneGitCache } = await import('./worktree-plan.js');
  const local = { folder: '/local' };
  const remote = { machine: 'offline', folder: '/remote/linked' };
  const git = Object.fromEntries([local, remote].map(w => [where(w), {
    repo: JSON.stringify([w.machine ?? null, `${w.folder}/.git`]),
    top: w.folder, name: w.folder, linked: false,
    worktrees: [{ path: w.folder }, { path: `${w.folder}/sibling`, branch: 'feature' }],
  }]));
  git[where({ folder: '/old-negative' })] = null;
  const checked = Object.fromEntries(Object.keys(git).map(k => [k, 1]));
  pruneGitCache(git, [], checked);
  const restarted = JSON.parse(JSON.stringify(git));
  assert.equal(Object.keys(restarted).length, 2);
  assert.deepEqual(Object.keys(checked), Object.keys(restarted));
  const plan = projectWorktreePlan({ spaces: [], gitState: restarted, loaded: true });
  assert.deepEqual(new Set(plan.visibleRows.map(r => r.w.folder)), new Set([
    '/local', '/local/sibling', '/remote/linked', '/remote/linked/sibling',
  ]));
});

test('a group hands over only the spaces the host knows', () => {
  // Project rows: a space opened on the main checkout, a space on a linked worktree, and — as
  // in the sidebar — a `repo:` row and a `wt:` row that no space opens. Those two ids are
  // made up by the plan, so `space.close` on one fails with `no space "repo:[...]"`.
  const group = {
    rows: [
      { w: { id: 'w1' }, also: [{ w: { id: 'w1b' } }] },
      { w: { id: 'repo:[null,"/repo"]' }, unopened: true },
      { w: { id: 'wt:/repo/.git:/repo/wt-x' }, unopened: true },
      { w: { id: 'w2' }, also: [] },
    ],
  };
  assert.deepEqual(groupSpaceIds(group, ['w1', 'w1b', 'w2']), ['w1', 'w1b', 'w2']);
  // Nothing live: no row names an open space.
  assert.deepEqual(groupSpaceIds(group, []), []);
  assert.deepEqual(groupSpaceIds(undefined, ['w1']), []);
  // A repeated id arrives once.
  assert.deepEqual(groupSpaceIds({ rows: [{ w: { id: 'w1' } }, { w: { id: 'w1' } }] }, ['w1']), ['w1']);
});

test('the plan gives an unopened main checkout a made-up id, never a space id', () => {
  const linked = { id: 'w1', folder: '/repo/wt-x', tabs: [] };
  const gitState = {
    [where(linked)]: {
      repo: JSON.stringify([null, '/repo/.git']), top: '/repo/wt-x', name: 'repo', linked: true,
      branch: 'feature', worktrees: [{ path: '/repo', branch: 'main' }, { path: '/repo/wt-x', branch: 'feature' }],
    },
  };
  const plan = projectWorktreePlan({ spaces: [linked], gitState, loaded: true });
  const group = plan.groups.find((g) => g.rows.some((r) => r.w.id === 'w1'));
  assert.equal(group.rows.some((r) => r.unopened && r.w.id.startsWith('repo:')), true);
  assert.deepEqual(groupSpaceIds(group, ['w1']), ['w1']);
});
