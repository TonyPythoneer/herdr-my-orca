import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { base, parseWorktreeList, readPair, where } from './worktree-plan.js';

const source = await readFile(new URL('./main.js', import.meta.url), 'utf8');
const method = source.slice(source.indexOf('  async check(key, cx) {'), source.indexOf('\n  watch(repo, cx) {'));
const key = JSON.stringify(['offline', '/repo']);
const snapshot = { repo: JSON.stringify(['offline', '/repo/.git']), top: '/repo', name: 'repo', branch: 'main', worktrees: [{ path: '/repo' }, { path: '/linked' }] };

async function probe(failAt, stderr = 'connection unavailable') {
  const exec = async (_program, args) => {
    const operation = args.includes('status') ? 'status' : args.includes('--show-toplevel') ? 'top' : args.includes('--git-common-dir') ? 'common' : args[0] === 'worktree' ? 'worktrees' : 'remote';
    if (operation === failAt) return { code: 1, stdout: '', stderr };
    const stdout = { status: '# branch.head main', top: '/repo\n', common: '/repo/.git\n', worktrees: 'worktree /repo\nbranch refs/heads/main\n' }[operation] ?? '';
    return { code: operation === 'remote' ? 1 : 0, stdout, stderr: '' };
  };
  const view = { git: { [key]: snapshot }, checked: {}, unsure: new Set(), watch() {}, lookupPRByBranch() {} };
  const check = new Function('exec', 'base', 'parseWorktreeList', 'parseRemote', 'readPair', `return ({ ${method} }).check`)(exec, base, parseWorktreeList, () => null, readPair);
  await check.call(view, key, {});
  return view;
}

for (const operation of ['status', 'top', 'common', 'worktrees']) {
  test(`git ${operation} failure preserves the offline project snapshot`, async () => {
    const view = await probe(operation);
    assert.equal(view.git[key], snapshot);
    assert.ok(view.unsure.has(key));
  });
}

test('definitive non-repository result clears the old snapshot', async () => {
  const view = await probe('status', 'fatal: not a git repository (or any parent)');
  assert.equal(view.git[key], null);
  assert.equal(view.unsure.has(key), false);
});

test('successful git refresh replaces the snapshot and worktree list', async () => {
  const view = await probe(null);
  assert.notEqual(view.git[key], snapshot);
  assert.equal(view.git[key].repo, snapshot.repo);
  assert.deepEqual(view.git[key].worktrees, [{ path: '/repo', branch: 'main' }]);
  assert.equal(view.unsure.has(key), false);
});

test('a refresh updates the worktree catalog cached for sibling spaces', async () => {
  const siblingKey = JSON.stringify(['offline', '/linked']);
  const sibling = { ...snapshot, top: '/linked', worktrees: [{ path: '/repo', branch: 'old' }] };
  const exec = async (_program, args) => {
    const operation = args.includes('status') ? 'status' : args.includes('--show-toplevel') ? 'top' : args.includes('--git-common-dir') ? 'common' : args[0] === 'worktree' ? 'worktrees' : 'remote';
    return { code: operation === 'remote' ? 1 : 0, stderr: '', stdout: { status: '# branch.head main', top: '/repo', common: '/repo/.git', worktrees: 'worktree /repo\nbranch refs/heads/main\n' }[operation] ?? '' };
  };
  const view = { git: { [siblingKey]: sibling }, checked: {}, unsure: new Set(), watch() {}, lookupPRByBranch() {} };
  const check = new Function('exec', 'base', 'parseWorktreeList', 'parseRemote', 'readPair', `return ({ ${method} }).check`)(exec, base, parseWorktreeList, () => null, readPair);
  await check.call(view, key, {});
  assert.deepEqual(view.git[siblingKey].worktrees, [{ path: '/repo', branch: 'main' }]);
});

test('a missing linked checkout refreshes its catalog through the common git directory', async () => {
  const linked = { ...snapshot, top: '/linked', linked: true, worktrees: [{ path: '/repo' }, { path: '/linked' }] };
  const view = { git: { [key]: linked }, checked: {}, unsure: new Set(), watch() {}, lookupPRByBranch() {} };
  const exec = async (_program, args, options) => {
    if (!args.includes('--git-dir')) throw new Error('working directory missing');
    assert.equal(options.cwd, undefined);
    assert.equal(args[1], '/repo/.git');
    return { code: 0, stdout: 'worktree /repo\nbranch refs/heads/main\n' };
  };
  const check = new Function('exec', 'base', 'parseWorktreeList', 'parseRemote', 'readPair', `return ({ ${method} }).check`)(exec, base, parseWorktreeList, () => null, readPair);
  await check.call(view, key, {});
  assert.deepEqual(view.git[key].worktrees, [{ path: '/repo', branch: 'main' }]);
  assert.ok(view.unsure.has(key));
});

test('known non-repositories and failed lookups respect retry pacing', () => {
  const dueMethod = source.slice(source.indexOf('  due(now, sp, ps) {'), source.indexOf('\n  // `key` and the other places', source.indexOf('  due(now, sp, ps) {')));
  const due = new Function('where', 'readPair', 'machines', 'window', 'FALLBACK', `return ({ ${dueMethod} }).due`)(where, readPair, () => [], () => ({ active: true }), 60000);
  const space = { id: 'folder', folder: '/folder', tabs: [] };
  const folderKey = where(space);
  const view = { git: { [folderKey]: null }, checked: { [folderKey]: 1000 }, unsure: new Set(), at: {}, busy: {}, ready: {}, folded: new Set() };
  assert.equal(due.call(view, 1250, [space], []).size, 0);
  assert.equal(due.call(view, 61001, [space], []).has(folderKey), true);
  view.unsure.add(folderKey);
  assert.equal(due.call(view, 1250, [space], []).size, 0);
  assert.equal(due.call(view, 61001, [space], []).has(folderKey), true);
  view.git[folderKey] = { repo: 'legacy' };
  assert.equal(due.call(view, 1250, [space], []).has(folderKey), true);
});

test('an offline host becoming ready forces a retry before the fallback interval', () => {
  const dueMethod = source.slice(source.indexOf('  due(now, sp, ps) {'), source.indexOf('\n  // `key` and the other places', source.indexOf('  due(now, sp, ps) {')));
  const due = new Function('where', 'readPair', 'machines', 'window', 'FALLBACK', `return ({ ${dueMethod} }).due`)(where, readPair, () => [{ name: 'remote', layout: 'ready' }], () => ({ active: false }), 60000);
  const space = { id: 'remote/work', machine: 'remote', folder: '/repo', tabs: [] };
  const key = where(space);
  const view = { git: { [key]: null }, checked: { [key]: 1000 }, unsure: new Set([key]), at: {}, busy: {}, ready: { remote: false }, folded: new Set() };
  assert.equal(due.call(view, 1250, [space], []).has(key), true);
  assert.equal(due.call(view, 1500, [space], []).has(key), false);
});

test('a transient first status failure records an uncertain negative for paced retry', async () => {
  const view = await probe('status');
  delete view.git[key];
  const exec = async () => ({ code: 1, stdout: '', stderr: 'connection unavailable' });
  const check = new Function('exec', 'base', 'parseWorktreeList', 'parseRemote', 'readPair', `return ({ ${method} }).check`)(exec, base, parseWorktreeList, () => null, readPair);
  await check.call(view, key, {});
  assert.equal(view.git[key], null);
  assert.equal(view.unsure.has(key), true);
});

test('the workspace options Refresh asks git again for every project it knows', () => {
  const method = source.slice(source.indexOf('  refreshAll(cx) {'), source.indexOf('\n  // Runs git checks concurrently'));
  const open = { id: 'here', folder: '/repo', machine: null, tabs: [] };
  const closed = where({ folder: '/closed' });
  const view = {
    git: { [where(open)]: { repo: 'r' }, [closed]: { repo: 'r' } },
    refreshed: null,
    notified: 0,
    notify() { this.notified++; },
    refreshGit(keys) { this.refreshed = [...keys].sort(); },
  };
  const refreshAll = new Function('spaces', 'panes', 'where', `return ({ ${method} }).refreshAll`)(() => [open], () => [], where);
  refreshAll.call(view, {});
  // A closed project still re-reads, because its cached place can rebuild its worktree list.
  assert.deepEqual(view.refreshed, [closed, where(open)].sort());
  assert.equal(view.refreshingAll, true);
  assert.equal(view.notified, 1);
});

test('a manual refresh ends its loading row when the git pass commits', async () => {
  const method = source.slice(source.indexOf('  refreshGit(keys, cx) {'), source.indexOf('\n  // One place\'s git'));
  const view = {
    pending: new Set(), refreshing: false, refreshingAll: true, loaded: false, git: {}, watching: new Set(),
    notified: 0,
    notify() { this.notified++; },
    async check() {},
  };
  let pass;
  const cx = { spawn(task) { pass = task(cx); } };
  const refreshGit = new Function('readPair', 'pruneGitCache', 'spaces', 'localStorage', `return ({ ${method} }).refreshGit`)(readPair, () => {}, () => [], { setItem() {} });
  refreshGit.call(view, ['k'], cx);
  await pass;
  assert.equal(view.refreshingAll, false);
  assert.equal(view.loaded, true);
  assert.equal(view.notified, 1);
});
