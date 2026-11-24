import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import './flow-host.mjs';
const { default: Spaces } = await import('./main.js');
const { div } = await import('./flow-nodes.mjs');
const { stopsInit, stop, focusRoot, enter, within, onStop, menuJump } = await import('./focus.js');
const { tip, tipMark } = await import('./tip.js');
import { readFileSync } from 'node:fs';
import { where } from './worktree-plan.js';
import { control, event } from './flow-host.mjs';

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
  globalThis.__herdrExec = exec;
  await Spaces.prototype.check.call(Object.setPrototypeOf(view, Spaces.prototype), key, {});
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
  globalThis.__herdrExec = exec;
  await Spaces.prototype.check.call(Object.setPrototypeOf(view, Spaces.prototype), key, {});
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
  globalThis.__herdrExec = exec;
  await Spaces.prototype.check.call(Object.setPrototypeOf(view, Spaces.prototype), key, {});
  assert.deepEqual(view.git[key].worktrees, [{ path: '/repo', branch: 'main' }]);
  assert.ok(view.unsure.has(key));
});

test('known non-repositories and failed lookups respect retry pacing', () => {
  globalThis.__herdrMachines = () => [];
  globalThis.flowHost = { window: () => ({ active: true }) };
  const due = Spaces.prototype.due;
  const space = { id: 'folder', folder: '/folder', tabs: [] };
  const folderKey = where(space);
  const view = { git: { [folderKey]: null }, checked: { [folderKey]: 1000 }, unsure: new Set(), at: {}, busy: {}, ready: {}, folded: new Set() };
  assert.equal(due.call(Object.setPrototypeOf(view, Spaces.prototype), 1250, [space], []).size, 0);
  assert.equal(due.call(Object.setPrototypeOf(view, Spaces.prototype), 61001, [space], []).has(folderKey), true);
  view.unsure.add(folderKey);
  assert.equal(due.call(Object.setPrototypeOf(view, Spaces.prototype), 1250, [space], []).size, 0);
  assert.equal(due.call(Object.setPrototypeOf(view, Spaces.prototype), 61001, [space], []).has(folderKey), true);
  view.git[folderKey] = { repo: 'legacy' };
  assert.equal(due.call(Object.setPrototypeOf(view, Spaces.prototype), 1250, [space], []).has(folderKey), true);
});

test('an offline host becoming ready forces a retry before the fallback interval', () => {
  globalThis.__herdrMachines = () => [{ name: 'remote', layout: 'ready' }];
  globalThis.flowHost = { window: () => ({ active: false }) };
  const due = Spaces.prototype.due;
  const space = { id: 'remote/work', machine: 'remote', folder: '/repo', tabs: [] };
  const key = where(space);
  const view = { git: { [key]: null }, checked: { [key]: 1000 }, unsure: new Set([key]), at: {}, busy: {}, ready: { remote: false }, folded: new Set() };
  assert.equal(due.call(Object.setPrototypeOf(view, Spaces.prototype), 1250, [space], []).has(key), true);
  assert.equal(due.call(Object.setPrototypeOf(view, Spaces.prototype), 1500, [space], []).has(key), false);
});

test('a transient first status failure records an uncertain negative for paced retry', async () => {
  const view = await probe('status');
  delete view.git[key];
  const exec = async () => ({ code: 1, stdout: '', stderr: 'connection unavailable' });
  globalThis.__herdrExec = exec;
  await Spaces.prototype.check.call(Object.setPrototypeOf(view, Spaces.prototype), key, {});
  assert.equal(view.git[key], null);
  assert.equal(view.unsure.has(key), true);
});

test('the workspace options Refresh asks git again for every project it knows', () => {
  const open = { id: 'here', folder: '/repo', machine: null, tabs: [] };
  const closed = where({ folder: '/closed' });
  const view = {
    git: { [where(open)]: { repo: 'r' }, [closed]: { repo: 'r' } },
    refreshed: null,
    notified: 0,
    notify() { this.notified++; },
    refreshGit(keys) { this.refreshed = [...keys].sort(); },
  };
  globalThis.__herdrSpaces = () => [open];
  globalThis.flowHost = { panes: () => [] };
  Spaces.prototype.refreshAll.call(view, {});
  // A closed project still re-reads, because its cached place can rebuild its worktree list.
  assert.deepEqual(view.refreshed, [closed, where(open)].sort());
  assert.equal(view.refreshingAll, true);
  assert.equal(view.notified, 1);
});

test('a manual refresh ends its loading row when the git pass commits', async () => {
  const view = {
    pending: new Set(), refreshing: false, refreshingAll: true, loaded: false, git: {}, watching: new Map(),
    notified: 0,
    notify() { this.notified++; },
    async check() {},
  };
  let pass;
  const cx = { spawn(task) { pass = task(cx); } };
  globalThis.__herdrSpaces = () => [];
  globalThis.localStorage = { setItem() {} };
  Spaces.prototype.refreshGit.call(view, ['k'], cx);
  await pass;
  assert.equal(view.refreshingAll, false);
  assert.equal(view.loaded, true);
  assert.equal(view.notified, 1);
});

// ---- Flow specs: the behaviour the git, review, header and card code must keep. Outputs that are
// long are recorded once from the code as first written (flow.golden.json), then compared exactly.
const FLOW = new URL('./flow.golden.json', import.meta.url);
const recorded = JSON.parse(readFileSync(FLOW, 'utf8'));
function golden(name, value) {
  const plain = JSON.parse(JSON.stringify(value ?? null));
  assert.deepEqual(plain, recorded[name], name);
}

const palette = new Proxy({}, { get: (_t, k) => `#${String(k)}` });
const settle = () => new Promise((resolve) => setImmediate(resolve));

function live(env = {}) {
  const store = new Map(Object.entries(env.storage ?? {}));
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const sharedValues = { ...env.shared };
  globalThis.__herdrShared = (k) => sharedValues[k];
  globalThis.__herdrProps = () => env.props ?? {};
  globalThis.__herdrTheme = () => palette;
  globalThis.__herdrSpaces = () => env.spaces ?? [];
  globalThis.__herdrMachines = () => env.machines ?? [];
  const calls = [];
  globalThis.__herdrRun = (name, args) => calls.push([name, args]);
  globalThis.__herdrExec = env.exec;
  const spawned = [];
  let loop = null; // init's endless command loop: tests that want it run it themselves
  globalThis.flowHost = {
    window: () => ({ active: true, platform: 'linux' }), keys: () => [], agents: () => env.agents ?? [], panes: () => env.panes ?? [],
    openOverlay: (o) => calls.push(['overlay', o]), setShared: (k, v) => { sharedValues[k] = v; calls.push(['setShared', k, v]); },
    nextCommand: env.nextCommand ?? (() => new Promise(() => {})), hc: env.hc, watchFolder: env.watchFolder, ...env.host,
  };
  const handle = () => ({ focus() {}, is_focused: () => false });
  const cx = {
    focus_handle: handle, spawn(task) { if (loop) spawned.push(task); else loop = task; }, timer: { every() {} }, notified: 0, notify() { this.notified++; },
    stop_propagation() { calls.push(['stop']); }, new() { return { release() {}, set_props() {} }; },
  };
  const view = new Spaces();
  view.init({}, cx);
  Object.assign(view, env.state);
  return { view, cx, calls, store, sharedValues, spawned, loop };
}

// -- due(): which places git must be asked about again.
test('due names moved places, finished commands, returning hosts and stale fallbacks', () => {
  const a = { id: 'a', folder: '/a', machine: null, tabs: [{ id: 'ta' }] };
  const b = { id: 'b', folder: '/b', machine: 'far', tabs: [{ id: 'tb' }] };
  const repoKey = JSON.stringify([null, '/r/.git']);
  const keyA = where(a), keyB = where(b);
  const git = { [keyA]: { repo: repoKey, owner: 'o' }, [keyB]: { repo: JSON.stringify(['far', '/r/.git']), owner: 'o' } };
  const ask = (state, sp, ps, now = 1000, host = { active: false }) => {
    globalThis.flowHost = { window: () => host };
    globalThis.__herdrMachines = () => state.machinesNow ?? [];
    const view = Object.setPrototypeOf({ git, at: {}, busy: {}, ready: {}, unsure: new Set(), checked: {}, folded: new Set(), ...state }, Spaces.prototype);
    return [[...view.due(now, sp, ps)].sort(), view];
  };
  assert.deepEqual(ask({ git: {} }, [a], [])[0], [keyA]);
  assert.deepEqual(ask({ git: { [keyA]: { repo: repoKey } } }, [a], [])[0], [keyA]);
  assert.deepEqual(ask({}, [a], [])[0], []);
  const [moved, movedView] = ask({ at: { a: where({ id: 'a', folder: '/old' }) } }, [a], []);
  assert.deepEqual(moved, [keyA]);
  assert.equal(movedView.at.a, keyA);
  const pane = (status, over = {}) => ({ pane: 'p1', tab: 'ta', terminal: true, status, program: { shell: true }, ...over });
  assert.deepEqual(ask({ busy: { p1: true } }, [a], [pane('idle')])[0], [keyA]);
  assert.deepEqual(ask({ busy: { p1: false } }, [a], [pane('idle')])[0], []);
  const [busyNow, busyView] = ask({ busy: {} }, [a], [pane('working'), pane('idle', { pane: 'p2', tab: 'none' }), pane('idle', { pane: 'p3', terminal: false }), pane('idle', { pane: 'p4', program: {} })]);
  assert.deepEqual([busyNow, busyView.busy], [[], { p1: true, p4: true }]);
  const sibling = { git: { ...git, [JSON.stringify([null, '/s'])]: { repo: repoKey, owner: 'o' } } };
  assert.equal(ask({ ...sibling, busy: { p1: true } }, [a], [pane('idle')])[0].length, 1);
  assert.deepEqual(ask({ machinesNow: [{ name: 'far', layout: 'ready' }], ready: { far: false } }, [a, b], [])[0], [keyB]);
  assert.deepEqual(ask({ checked: { [keyA]: 0, [keyB]: 0 } }, [a, b], [], 60001, { active: true })[0], [keyA, keyB].sort());
  assert.deepEqual(ask({ checked: { [keyA]: 0, [keyB]: 0 }, folded: new Set(['far']) }, [a, b], [], 60001, { active: true })[0], [keyA]);
  assert.deepEqual(ask({ checked: { [keyA]: 0 } }, [a], [], 60000, { active: true })[0], []);
  assert.deepEqual(ask({ git: {}, unsure: new Set([keyA]), checked: { [keyA]: 0 } }, [a], [], 60001, { active: true })[0], [keyA]);
});

// -- check(): the commands one git read runs, in order, and what it records.
const remoteOf = (url) => ({ code: 0, stdout: `${url}\n`, stderr: '' });
async function runCheck(name, { cached, scripted, on, cwd = '/repo' }) {
  const calls = [], lookups = [], watches = [];
  const exec = async (program, args, options) => {
    calls.push([program, args.slice(args[0] === '--git-dir' ? 2 : 0), options?.on ?? null]);
    const pick = scripted(program, args);
    if (pick instanceof Error) throw pick;
    return pick ?? { code: 1, stdout: '', stderr: '' };
  };
  const view = Object.setPrototypeOf({
    git: { [JSON.stringify([on ?? null, cwd])]: cached, other: cached && { repo: cached.repo }, none: null }, checked: {}, unsure: new Set(),
    lookupPRByBranch: (key, ref, dir, task) => lookups.push([key, ref.base, ref.head, ref.branch, dir, task]), watch: (...args) => watches.push(args[0]),
  }, Spaces.prototype);
  globalThis.__herdrExec = exec;
  const key = JSON.stringify([on ?? null, cwd]);
  await view.check(key, {});
  const record = { git: view.git[key], other: view.git.other, unsure: [...view.unsure], lookups, watches, calls: calls.map(([p, a, o]) => [p, a.join(' '), o]) };
  golden(`check-${name}`, record);
  return record;
}
const STATUS = '# branch.oid abc\n# branch.head feat/x\n# branch.upstream origin/feat/x\n';
function scriptOf(extra = {}) {
  return (program, args) => {
    const line = args.join(' ');
    if (extra[line] !== undefined) return extra[line];
    if (line.includes('status --porcelain')) return { code: 0, stdout: STATUS };
    if (line === 'rev-parse --show-toplevel') return { code: 0, stdout: '/repo\n' };
    if (line.includes('--git-common-dir')) return { code: 0, stdout: '/repo/.git\n' };
    if (line.startsWith('worktree list')) return { code: 0, stdout: 'worktree /repo\nbranch refs/heads/main\n\nworktree /wt\nbranch refs/heads/feat/x\n' };
    return undefined;
  };
}
const ORIGIN = 'remote get-url origin', UPSTREAM = 'remote get-url upstream';
const GH_VIEW = 'repo view me/proj --json isFork,parent';

test('check records the repo identity and asks for the review once, for each remote layout', async () => {
  const plain = await runCheck('no-remote', { scripted: scriptOf() });
  assert.equal(plain.git.branch, 'feat/x');
  assert.deepEqual(plain.lookups.map((l) => l[0]), ['/repo/.git::feat/x']);
  assert.deepEqual(plain.watches, ['/repo/.git']);
  const origin = { [ORIGIN]: remoteOf('git@github.com:me/proj.git'), [GH_VIEW]: { code: 0, stdout: '{"isFork":false}' } };
  const plainOrigin = await runCheck('origin', { scripted: scriptOf(origin) });
  assert.equal(plainOrigin.git.base, 'me/proj');
  await runCheck('upstream', { scripted: scriptOf({ [ORIGIN]: remoteOf('https://github.com/me/proj'), [UPSTREAM]: remoteOf('https://github.com/up/proj') }) });
  await runCheck('upstream-same', { scripted: scriptOf({ [ORIGIN]: remoteOf('https://github.com/me/proj'), [UPSTREAM]: remoteOf('https://github.com/me/proj'), [GH_VIEW]: { code: 1 } }) });
  await runCheck('upstream-broken', { scripted: scriptOf({ [ORIGIN]: remoteOf('https://github.com/me/proj'), [UPSTREAM]: new Error('boom'), [GH_VIEW]: { code: 0, stdout: '{"isFork":true,"parent":{"owner":{"login":"par"},"name":"proj"}}' } }) });
  await runCheck('fork', { scripted: scriptOf({ [ORIGIN]: remoteOf('https://github.com/me/proj'), [GH_VIEW]: { code: 0, stdout: '{"isFork":true,"parent":{"owner":{"login":"par"},"name":"other"}}' } }) });
  await runCheck('fork-incomplete', { scripted: scriptOf({ [ORIGIN]: remoteOf('https://github.com/me/proj'), [GH_VIEW]: { code: 0, stdout: '{"isFork":true,"parent":{}}' } }) });
  const brokenGh = await runCheck('gh-garbage', { scripted: scriptOf({ [ORIGIN]: remoteOf('https://github.com/me/proj'), [GH_VIEW]: { code: 0, stdout: 'not json' } }) });
  assert.equal(brokenGh.git.owner, null);
  assert.equal(brokenGh.git.head, 'me');
  assert.equal(brokenGh.git.base, 'me/proj');
  await runCheck('gh-throws', { scripted: scriptOf({ [ORIGIN]: remoteOf('https://github.com/me/proj'), [GH_VIEW]: new Error('gh missing') }) });
  await runCheck('origin-unparsed', { scripted: scriptOf({ [ORIGIN]: remoteOf('file:///srv/repo') }) });
  await runCheck('origin-throws', { scripted: scriptOf({ [ORIGIN]: new Error('no remote') }) });
  await runCheck('machine', { on: 'far', scripted: scriptOf({ [ORIGIN]: remoteOf('https://github.com/me/proj') }) });
  await runCheck('bare-repo-name', { scripted: scriptOf({ 'rev-parse --path-format=absolute --git-common-dir': { code: 0, stdout: '/srv/proj.git\n' } }) });
  await runCheck('linked', { scripted: scriptOf({ 'rev-parse --show-toplevel': { code: 0, stdout: '/wt\n' } }), cwd: '/wt' });
  await runCheck('detached', { scripted: scriptOf({ 'status --porcelain=v2 --branch': undefined, [`--no-optional-locks -c core.fsmonitor=false status --porcelain=v2 --branch --untracked-files=no`]: { code: 0, stdout: '# branch.head (detached)\n' } }) });
  await runCheck('no-branch-line', { scripted: scriptOf({ '--no-optional-locks -c core.fsmonitor=false status --porcelain=v2 --branch --untracked-files=no': { code: 0, stdout: '' } }) });
});

test('check keeps what it knew, or remembers "not a repo", when git cannot answer', async () => {
  const cached = { repo: JSON.stringify([null, '/repo/.git']), linked: true, worktrees: [{ path: 'old' }], branch: 'b', top: '/repo' };
  const statusLine = '--no-optional-locks -c core.fsmonitor=false status --porcelain=v2 --branch --untracked-files=no';
  await runCheck('not-a-repo', { scripted: scriptOf({ [statusLine]: { code: 128, stderr: 'fatal: not a git repository' } }) });
  await runCheck('not-a-repo-cached', { cached, scripted: scriptOf({ [statusLine]: { code: 128, stderr: 'Not a git repository (or any parent)' } }) });
  await runCheck('away', { scripted: scriptOf({ [statusLine]: { code: 255, stderr: 'ssh: connect timed out' } }) });
  await runCheck('away-cached', { cached, scripted: scriptOf({ [statusLine]: { code: 255, stderr: 'ssh: connect timed out' } }) });
  await runCheck('away-catalog', { cached, scripted: scriptOf({ [statusLine]: { code: 255, stderr: 'x' }, 'worktree list --porcelain': { code: 0, stdout: 'worktree /repo\nbranch refs/heads/main\n' } }) });
  await runCheck('away-catalog-throws', { cached, scripted: scriptOf({ [statusLine]: { code: 255, stderr: 'x' }, 'worktree list --porcelain': new Error('x') }) });
  await runCheck('top-empty', { cached, scripted: scriptOf({ 'rev-parse --show-toplevel': { code: 0, stdout: '\n' } }) });
  await runCheck('top-failed', { cached, scripted: scriptOf({ 'rev-parse --show-toplevel': { code: 1, stdout: '/repo' } }) });
  await runCheck('throws', { scripted: scriptOf({ [statusLine]: new Error('exec failed') }) });
  await runCheck('catalog-failed', { cached, scripted: scriptOf({ 'worktree list --porcelain': { code: 1 } }) });
});

// -- lookupPRByBranch(): REST first, the head owner must match, a draft or merged PR is named.
async function lookup(name, { list, code = 0, stdout, cache = {}, asking = [], base = 'me/proj', head = 'Me', branch = 'feat/x', throws = false, host = {} }) {
  const calls = [];
  const exec = async (program, args, options) => {
    calls.push([program, args, options]);
    if (throws) throw new Error('gh failed');
    return { code, stdout: stdout ?? JSON.stringify(list ?? []), stderr: '' };
  };
  const { view, spawned, cx } = live({ exec, ...host });
  spawned.length = 0; // init's own machine refresh is not under test
  view.prCache = { ...cache };
  view.prAsking = new Set(asking);
  view.notify = () => calls.push(['notified']);
  view.lookupPRByBranch('k', { base, head, branch }, '/cwd', cx);
  for (const task of spawned.splice(0)) await task(cx);
  await settle();
  const result = { cache: Object.fromEntries(Object.entries(view.prCache).map(([key, v]) => [key, v && { data: v.data, timed: typeof v.at }])), asking: [...view.prAsking], calls };
  golden(`pr-${name}`, result);
  return result;
}
const pr = (over = {}) => ({ number: 7, title: 'T', state: 'open', head: { repo: { owner: { login: 'me' } } }, ...over });

test('a branch review is read from REST, filtered to the origin owner and mapped to a state', async () => {
  assert.equal((await lookup('open', { list: [pr()] })).cache.k.data.state, 'open');
  assert.equal((await lookup('prefers-open', { list: [pr({ state: 'closed', number: 9 }), pr()] })).cache.k.data.number, 7);
  assert.equal((await lookup('first-when-none-open', { list: [pr({ state: 'closed', number: 9 }), pr({ state: 'closed', number: 8 })] })).cache.k.data.number, 9);
  assert.equal((await lookup('merged', { list: [pr({ state: 'closed', merged_at: '2020' })] })).cache.k.data.state, 'merged');
  assert.equal((await lookup('draft', { list: [pr({ draft: true })] })).cache.k.data.state, 'draft');
  assert.equal((await lookup('other-owner', { list: [pr({ head: { repo: { owner: { login: 'other' } } } })] })).cache.k.data, null);
  assert.equal((await lookup('deleted-fork', { list: [pr({ head: { repo: null, user: { login: 'ME' } } })] })).cache.k.data.number, 7);
  assert.equal((await lookup('author-fallback', { list: [pr({ head: null, user: { login: 'me' } })] })).cache.k.data.number, 7);
  assert.equal((await lookup('state-missing', { list: [pr({ state: undefined })] })).cache.k.data.state, '');
  assert.equal((await lookup('numberless', { list: [pr({ number: 0 })] })).cache.k.data, null);
  assert.equal((await lookup('empty-body', { stdout: '' })).cache.k.data, null);
  assert.equal((await lookup('gh-failed', { code: 1, stdout: 'x' })).cache.k.data, null);
  assert.equal((await lookup('garbage', { stdout: '{' })).cache.k.data, null);
  assert.equal((await lookup('throws', { throws: true })).asking.length, 0);
});

test('a branch review lookup is skipped while fresh, in flight, over the limit, or unanswerable', async () => {
  const freshAt = { data: { number: 1, title: 'x' }, at: Date.now() };
  assert.equal((await lookup('fresh', { cache: { k: freshAt } })).calls.length, 0);
  assert.equal((await lookup('inflight', { asking: ['k'] })).calls.length, 0);
  assert.equal((await lookup('limit', { asking: ['x', 'y'] })).calls.length, 0);
  for (const [name, over] of [['no-base', { base: null }], ['no-head', { head: null }], ['no-branch', { branch: '' }]]) {
    const result = await lookup(name, over);
    assert.equal(result.calls.length, 0);
    assert.equal(result.cache.k.data, null);
  }
});

// -- the command loop and the small commands.
test('the command loop focuses, folds, refreshes and forgets on request', async () => {
  const commands = ['focus', 'collapse-all', 'expand-all', 'options-changed', 'refresh', 'forget-project', 'ignored'];
  const entered = [];
  const env = {
    nextCommand: () => (commands.length ? Promise.resolve(commands.shift()) : new Promise(() => {})),
    spaces: [{ id: 's', folder: '/s', machine: null, tabs: [] }], shared: { 'orca-sidebar-projects.forget': { repo: 'gone' } },
    exec: async () => ({ code: 1, stdout: '', stderr: 'not a git repository' }),
  };
  const { view, cx, loop, store } = live(env);
  const trace = [];
  Object.assign(view, {
    plan: { projectKeys: ['k1', 'k2'] }, ordered: () => [{ head: true, w: { id: 'first' } }], notify() { trace.push('notify'); },
    refreshAll() { trace.push('refreshAll'); }, forgetProject() { trace.push('forgetProject'); },
  });
  view.fs.free = [{ focus() { entered.push('focus'); }, is_focused: () => false }];
  void loop(cx);
  for (let i = 0; i < 10; i++) await settle();
  assert.deepEqual(trace.filter((step) => step !== 'notify'), ['refreshAll', 'forgetProject']);
  golden('loop', { trace, folded: [...view.foldedRepos], stored: store.get('repos.folded'), entered, menuKey: view.menuKey });
});

test('menu, toggles, reconnect, saved-folder checks and forgetting a project do what they say', async () => {
  const hcCalls = [];
  const hc = async (args) => { hcCalls.push(args); return { code: 0, stdout: JSON.stringify({ machines: [{ name: 'm', temporary: false }, { name: 't', temporary: true }] }), stderr: '' }; };
  const execs = [];
  const exec = async (program, args) => { execs.push([program, ...args]); return { code: args[1] === '/gone' ? 1 : 0, stdout: '', stderr: '' }; };
  const space = { id: 'w1', folder: '/w', machine: null, tabs: [], active: true };
  const { view, cx, calls, store, sharedValues, spawned } = live({ hc, exec, spaces: [space], storage: { 'projects.saved.v1': JSON.stringify(['/gone', '/here']) }, shared: { 'orca-sidebar-projects.forget': { repo: 'r' } } });
  view.notify = () => calls.push(['notify']);
  view.menu({ id: 'w1', folder: '/w', named: true, name: 'N' }, { top: '/top', branch: 'b', linked: 1, repo: 'r' });
  view.menu({ id: 'nospace', folder: '/f', machine: 'm' }, null);
  view.toggleAgents('a', cx); view.toggleAgents('a', cx); view.toggleAgents('b', cx);
  view.toggleUnread('u', cx); view.toggleUnread('v', cx); view.toggleUnread('u', cx);
  view.toggleRepo('r1', cx); view.toggleRepo('r2', null); view.toggleRepo('r1', cx);
  await view.checkSaved(cx); await view.checkSaved(cx);
  view.git = { [where({ folder: '/x' })]: { repo: 'r', top: '/x' } };
  view.checked = { [where({ folder: '/x' })]: 1, keep: 2 };
  view.git.keep = null;
  view.forgetProject(cx);
  view.refreshMachines(cx);
  for (const task of spawned.splice(0)) await task(cx);
  await settle();
  const glow = view.glow('g'); glow(true, cx); glow(false, cx); glow(true, cx); const hotAfterOn = view.hot; glow(false, cx);
  golden('small-commands', {
    calls, stored: Object.fromEntries(store), shared: sharedValues, execs, hcCalls, machines: view.machines, hotAfterOn, hot: view.hot,
    missing: [...view.missingFolders], git: view.git, checked: view.checked, keys: view.projectKeys(), rebuilt: [view.rebuilt({ state: 'unreachable', why: 'a different core answers there ("x")' }), view.rebuilt({ state: 'connected' }), view.rebuilt(null)],
  });
});

test('reconnect removes the machine once, adds it back with its options and reports failures', async () => {
  const script = [];
  const hcCalls = [];
  const hc = async (args) => { hcCalls.push(args); return script.shift() ?? { code: 0, stdout: '', stderr: '' }; };
  const { view, cx, calls, store, spawned } = live({ hc });
  spawned.length = 0; // init's own machine refresh is not under test
  view.notify = () => calls.push(['notify']);
  const machine = { name: 'm', target: 'host', via: 'ssh', session: 's', temporary: true };
  const run = async (m = machine) => { view.reconnect(m, cx); for (const task of spawned.splice(0)) await task(cx); await settle(); };
  view.reconnect(null, cx);
  await run();
  script.push({ code: 1, stdout: JSON.stringify({ error: { message: 'denied' } }), stderr: '' });
  view.folded.add('m');
  await run();
  script.push({ code: 0 }, { code: 2, stdout: '', stderr: 'boom' });
  await run();
  script.push({ code: 3, stdout: '', stderr: '' });
  await run({ name: 'n', target: 'plain' });
  view.reconnecting.busy = { busy: true };
  view.reconnect({ name: 'busy' }, cx);
  golden('reconnect', { hcCalls, calls, stored: Object.fromEntries(store), state: view.reconnecting, folded: [...view.folded] });
});

// -- handlers on the views.
function handlers(node, found = new Map()) {
  const id = node?.c?.find(([call]) => call === 'id')?.[1][0];
  if (id !== undefined && !found.has(id)) found.set(id, node);
  // A control with no id of its own (the header's buttons) is found by its accessibility label.
  const label = node?.c?.find(([call]) => call === 'accessibility_label')?.[1][0];
  if (label !== undefined && !found.has(`label:${label}`)) found.set(`label:${label}`, node);
  for (const [call, args] of node?.c ?? []) {
    if (!['child', 'children', 'trigger', 'content', 'when'].includes(call)) continue;
    for (const child of [args].flat(2)) handlers(child, found);
  }
  return found;
}
const fire = (node, name, ...args) => {
  const button = args[0] === 'left' || args[0] === 'right' ? args.shift() : undefined;
  return event(node, name, button)(...args);
};

test('a card selects, renames, drags, opens, toggles unread and expands its agents through its handlers', () => {
  const w = { id: 'c1', name: 'card', folder: '/c', machine: null, tabs: [], status: 'working' };
  const other = { id: 'c2', name: 'o', folder: '/o', machine: null, tabs: [] };
  const far = { id: 'c3', name: 'f', folder: '/f', machine: 'far', tabs: [] };
  const agent = { address: 'p1', status: 'working', title: 'a', app: 'unknown', program: {}, tab: 't' };
  const { view, cx, calls } = live({ spaces: [other, w, far], agents: [agent] });
  view.notify = () => calls.push(['notify']);
  const g = { branch: 'b', top: '/c', linked: false };
  const card = (row = { w, g, pos: 1 }, mine = [agent]) => view.card(row, palette, [], mine).__node;
  const reset = () => { calls.length = 0; view.pressed = null; view.over = null; };
  const ev = { click_count: 1 };
  let node = card();
  fire(node, 'on_mouse_down', 'left'); // not by name: the first left press
  assert.deepEqual([view.pressed, view.over], ['c1', 'c1']);
  reset();
  fire(node, 'on_mouse_up', 'left', ev, cx);
  golden('card-release-plain', calls);
  reset(); view.pressed = 'c1';
  fire(node, 'on_mouse_up', 'left', ev, cx);
  golden('card-release-select', calls);
  reset(); view.pressed = 'c2'; view.over = 'c1';
  fire(node, 'on_mouse_up', 'left', ev, cx);
  golden('card-release-move', calls);
  reset(); view.pressed = 'c1';
  fire(node, 'on_mouse_up', 'left', { click_count: 2 }, cx);
  golden('card-release-rename', [calls, view.pressed]);
  reset(); view.pressed = 'c2';
  fire(node, 'on_mouse_move', {}, cx); fire(node, 'on_mouse_move', {}, cx);
  golden('card-move-same-host', [calls, view.over]);
  reset(); view.pressed = 'c3'; view.over = 'c1';
  fire(node, 'on_mouse_move', {}, cx);
  golden('card-move-other-host', [calls, view.over]);
  reset(); view.pressed = null;
  fire(node, 'on_mouse_move', {}, cx);
  golden('card-move-idle', calls);
  reset();
  fire(node, 'on_mouse_down', 'right');
  golden('card-menu', calls);
  const unopened = card({ w: { ...w, id: 'u1' }, g, unopened: true, pos: 0 });
  reset();
  fire(unopened, 'on_mouse_down', 'left');
  fire(unopened, 'on_mouse_up', 'left', ev, cx);
  golden('card-unopened', [calls, view.pressed]);
  const bell = handlers(node).get('space-unread-c1');
  reset();
  fire(bell, 'on_hover', true, cx); fire(bell, 'on_hover', true, cx); fire(bell, 'on_hover', false, cx);
  fire(bell, 'on_click', {}, cx); fire(bell, 'on_mouse_down', 'left', {}, cx); fire(bell, 'on_mouse_up', 'left', {}, cx);
  golden('card-bell', [calls, view.laneHot]);
  const parts = handlers(node);
  reset();
  const pill = parts.get('space-agents-c1');
  fire(pill, 'on_click', {}, cx); fire(pill, 'on_mouse_down', 'left', {}, cx); fire(pill, 'on_mouse_up', 'left', {}, cx);
  golden('card-pill', calls);
  view.expandedAgents.add('c1');
  const open = card();
  const rows = [...(function collect(n, found = []) { for (const [call, args] of n?.c ?? []) { if (call === 'on_click' && !n.c.some(([c]) => c === 'id')) found.push(n); if (['child', 'children', 'when'].includes(call)) for (const c of [args].flat(2)) collect(c, found); } return found; })(open)];
  reset();
  for (const row of rows) { fire(row, 'on_click', {}, cx); fire(row, 'on_mouse_down', 'left', {}, cx); fire(row, 'on_mouse_up', 'left', {}, cx); }
  view.agents = [];
  globalThis.flowHost.agents = () => [];
  for (const row of rows) fire(row, 'on_click', {}, cx);
  golden('card-agent-rows', [rows.length, calls]);
  const sharedKeys = { shared: { 't3-focus': 'me' }, spaces: [w] };
  const keyboard = live(sharedKeys);
  const focus = { focus() {}, is_focused: () => true };
  keyboard.view.fs.handles.set('space-c1', focus);
  keyboard.view.notify = () => keyboard.calls.push(['notify']);
  const kn = keyboard.view.card({ w, g, pos: 0 }, palette, [], []).__node;
  const enterKey = event(kn, 'on_key_down');
  enterKey({ keystroke: 'enter' }, keyboard.cx);
  keyboard.view.card({ w: { ...w }, g, unopened: true, pos: 0 }, palette, [], []);
  golden('card-keyboard', keyboard.calls);
});

test('a project header opens its menus and folds, and a machine header folds, reconnects and adds', () => {
  const w = { id: 'h1', name: 'repo', folder: '/repo', machine: null, tabs: [] };
  const g = { name: 'repo', top: '/repo', repo: JSON.stringify([null, '/repo/.git']) };
  const machine = { name: 'far', state: 'unreachable', why: 'a different core answers there ("abc")' };
  const { view, cx, calls } = live({ spaces: [w, { id: 'x', machine: 'far', active: false, tabs: [] }], hc: async () => ({ code: 0, stdout: '{}' }) });
  view.notify = () => calls.push(['notify']);
  view.plan = { groups: [{ key: g.repo, rows: [{ w: { id: 'h1' } }] }] };
  const head = view.header({ w, g, count: 2 }, palette, []).__node;
  const ids = handlers(head);
  const reset = () => { calls.length = 0; };
  fire(head, 'on_mouse_down', 'right');
  fire(head, 'on_click', {}, cx);
  fire(head, 'on_hover', true, cx); fire(head, 'on_hover', false, cx); fire(head, 'on_hover', false, cx);
  golden('header-head', [calls, [...view.foldedRepos], view.hoveredRepo]);
  reset();
  for (const id of ['label:Collapse group', 'label:Group menu', 'label:New space']) fire(ids.get(id), 'on_click', {}, cx);
  golden('header-buttons', [calls, view.menuKey, [...view.foldedRepos]]);
  const keyboard = live({ shared: { 't3-focus': 'me' }, spaces: [w] });
  keyboard.view.plan = view.plan;
  keyboard.view.notify = () => keyboard.calls.push(['notify']);
  keyboard.view.fs.free.forEach((h) => { h.is_focused = () => true; });
  const kh = keyboard.view.header({ w, g, count: 2 }, palette, []).__node;
  const actions = [];
  for (const [call, args] of kh.c) if (call === 'on_key_down') actions.push(args.length);
  event(kh, 'on_key_down')({ keystroke: 'enter' }, keyboard.cx);
  for (const id of ['label:Collapse group', 'label:Group menu', 'label:New space']) event(handlers(kh).get(id), 'on_key_down')({ keystroke: 'space' }, keyboard.cx);
  golden('header-keys', [keyboard.calls, [...keyboard.view.foldedRepos], keyboard.view.menuKey]);
  view.machines = [machine];
  view.reconnecting = { far: { machine, error: 'bad' } };
  const mh = view.machineHead({ machine: 'far', count: 1 }, palette).__node;
  reset();
  fire(mh, 'on_hover', true, cx); fire(mh, 'on_hover', false, cx); fire(mh, 'on_click', {}, cx); fire(mh, 'on_click', {}, cx);
  fire(handlers(mh).get('machine-connect-far'), 'on_hover', true, cx);
  fire(handlers(mh).get('machine-connect-far'), 'on_click', {}, cx);
  golden('machine-head', [calls, [...view.folded], view.overMachine]);
  view.machines = [{ name: 'far', state: 'connected' }]; view.reconnecting = {};
  const up = view.machineHead({ machine: 'far', count: 1 }, palette).__node;
  reset();
  fire(handlers(up).get('machine-add-far'), 'on_click', {}, cx);
  fire(handlers(up).get('machine-add-far'), 'on_hover', true, cx);
  const local = view.machineHead({ machine: null, count: 1 }, palette).__node;
  fire(handlers(local).get('machine-add-local'), 'on_click', {}, cx);
  golden('machine-add', calls);
  assert.ok(control(up, 'machine-far'));
});

test('the list tracks the pointer, and saved projects open and remove themselves', async () => {
  const storage = { 'projects.saved.v1': JSON.stringify(['/saved/a', '/saved/b']) };
  const { view, cx, calls, store } = live({ storage, state: { loaded: true } });
  view.notify = () => calls.push(['notify']);
  const body = view.render(cx).__node;
  const ids = handlers(body);
  const list = ids.get('space-list');
  fire(list, 'on_mouse_up', 'left', {}, cx);
  view.pressed = 'x'; view.over = 'y';
  fire(list, 'on_hover', true, cx); fire(list, 'on_hover', false, cx); fire(list, 'on_hover', false, cx);
  view.pressed = null; fire(list, 'on_hover', true, cx);
  const row = ids.get('saved-/saved/a');
  fire(row, 'on_click', {}, cx);
  const tasks = [];
  const spawner = { spawn: (task) => tasks.push(task), stop_propagation() {}, notify() {} };
  fire(row, 'on_click', {}, spawner);
  for (const task of tasks) await task();
  fire(ids.get('saved-remove-/saved/a'), 'on_click', {}, cx);
  golden('list-and-saved', [calls, view.listHover, [view.pressed, view.over], store.get('projects.saved.v1')]);
});

// -- focus.js: Tab stops, the keyboard mode and menu type-ahead.
function stopView(over = {}) {
  const handles = [];
  const mk = (focused = false) => { const h = { focused, focus() { this.focused = true; handles.push('focus'); }, is_focused() { return this.focused; } }; return h; };
  const cx = { focus_handle: () => mk(), notified: 0, notify() { this.notified++; }, timers: [], timer: { every(ms, fn) { const t = { ms, fn, cancelled: false, cancel() { this.cancelled = true; } }; cx.timers.push(t); return t; } }, stop_propagation() { handles.push('stop'); } };
  const sharedValues = { ...over.shared };
  globalThis.__herdrShared = (k) => sharedValues[k];
  globalThis.flowHost = { setShared: (k, v) => { sharedValues[k] = v; } };
  const view = { notified: 0, notify() { this.notified++; } };
  stopsInit(view, cx, over.kind ?? 'entry');
  return { view, cx, mk, sharedValues, handles };
}

test('stopsInit, onStop and within describe which control holds the keyboard', () => {
  const { view, mk } = stopView({ shared: { 't3-focus': 'old' } });
  assert.equal(onStop(view), null);
  view.fs.keyboard = true;
  view.fs.handles.set('a', mk(false)); view.fs.handles.set('b', mk(true));
  assert.equal(onStop(view), 'b');
  assert.equal(within(view, ['a', 'b']), true);
  assert.equal(within(view, ['a']), false);
  assert.equal(stopView({ kind: 'modal' }).view.fs.modal, true);
});

test('stop adds a tab stop with a ring only in keyboard mode, and Enter or Space runs its action', () => {
  const { view, cx, mk, handles } = stopView({ kind: 'modal' });
  const acted = [];
  const el = () => stop(view, palette, 'row', recordedNode(), { radius: 6, enter: () => acted.push('act') });
  const plain = stopView({ kind: 'entry' });
  assert.equal(stop(plain.view, palette, 'x', 'el'), 'el');
  const node = el().__node;
  const keyDown = event(node, 'on_key_down');
  view.fs.handles.get('row').focused = false;
  keyDown({ keystroke: 'enter' }, cx);
  view.fs.handles.get('row').focused = true;
  keyDown({ keystroke: 'tab' }, cx); keyDown({ keystroke: 'enter' }, cx); keyDown({ keystroke: 'space' }, cx);
  const given = mk(true);
  stop(view, palette, 'own', recordedNode(), { radius: 6, handle: given });
  view.fs.free.length = 0;
  assert.equal(stop(view, palette, 'overflow', 'el2'), 'el2');
  view.fs.keyboard = true;
  const ringed = stop(view, palette, 'row', recordedNode()).__node;
  golden('focus-stop', { acted, handles, notified: view.notified, node: node.c.map(([call]) => call), ringed: ringed.c, same: view.fs.handles.get('own') === given });
});
function recordedNode() {
  return div();
}

test('focusRoot hears Tab, ends the ring on a press and hands handles back when the mode ends', () => {
  const { view, cx, mk, sharedValues } = stopView({ kind: 'entry' });
  const root = () => focusRoot(view, recordedNode());
  const bare = recordedNode();
  assert.equal(focusRoot(view, bare), bare);
  view.fs.handles.set('a', mk(false));
  const spare = view.fs.free.length;
  assert.equal(focusRoot(view, 'plain'), 'plain');
  assert.equal(view.fs.free.length, spare + 1);
  sharedValues['t3-focus'] = 'me';
  const node = root().__node;
  const up = event(node, 'on_key_up'), down = event(node, 'on_mouse_down', 'left');
  up({ key: 'a' }, cx);
  const before = [view.fs.keyboard, view.notified];
  up({ key: 'tab' }, cx);
  const none = [view.fs.keyboard, view.notified];
  view.fs.handles.set('a', mk(true));
  view.fs.keyboard = false;
  view.fs.free.length = 0;
  up({ key: 'tab' }, cx);
  const landed = { keyboard: view.fs.keyboard, last: view.fs.last, pool: view.fs.free.length, timers: cx.timers.length, notified: view.notified };
  down({}, cx);
  golden('focus-root', { before, none, landed, afterPress: view.fs.keyboard });
});

test('enter lands on the last stop and the watch timer ends the mode once the keyboard is gone', () => {
  const { view, cx, handles } = stopView({ kind: 'entry' });
  enter(view, cx, 'first');
  const first = [view.fs.keyboard, [...view.fs.handles.keys()], handles.slice()];
  view.fs.last = 'first';
  enter(view, cx, 'other');
  assert.equal(cx.timers.length, 1);
  const tick = cx.timers[0].fn;
  view.fs.handles.get('first').focused = false;
  const log = [];
  for (let i = 0; i < 5 && !cx.timers[0].cancelled; i++) { tick(cx); log.push([view.fs.keyboard, view.fs.watch === null, view.notified]); }
  view.fs.keyboard = true; view.fs.watch = {}; view.fs.hold = () => true;
  const held = cx.timers[0];
  held.fn(cx);
  view.fs.hold = null;
  view.fs.handles.get('first').focused = true;
  held.fn(cx);
  golden('focus-enter', { first, log, held: [view.fs.last, view.fs.keyboard] });
});

test('menuJump answers Home, End and type-ahead that steps through rows sharing a letter', () => {
  const labels = ['Alpha', 'Beta', 'Bravo', 'Brown', 'Charlie'];
  const view = {};
  const key = (k, extra = {}) => ({ key: k, key_char: k.length === 1 ? k : undefined, ...extra });
  const realNow = Date.now;
  let clock = 1000;
  Date.now = () => clock;
  try {
    const results = [
      menuJump(view, key('home'), labels, 2), menuJump(view, key('end'), labels, 2),
      menuJump(view, key('enter'), labels, 0), menuJump(view, key(' ', { key_char: ' ' }), labels, 0),
      menuJump(view, key('b', { modifiers: { control: true } }), labels, 0), menuJump(view, key('b', { modifiers: { platform: true } }), labels, 0), menuJump(view, key('b', { modifiers: { alt: true } }), labels, 0),
      menuJump(view, key('b'), labels, 0), menuJump(view, key('b'), labels, 1), menuJump(view, key('b'), labels, 2), menuJump(view, key('b'), labels, 3),
    ];
    clock += 100;
    results.push(menuJump(view, key('b'), labels, 3), menuJump(view, key('r'), labels, 3), menuJump(view, key('a'), labels, 3));
    clock += 2000;
    results.push(menuJump(view, key('z'), labels, 3), menuJump(view, key('C'), labels, -5));
    golden('menu-jump', results);
  } finally { Date.now = realNow; }
});

// -- tip.js
test('tip labels its trigger with the bound key and shows the card only while lit', () => {
  const trigger = div().id('t');
  const out = {};
  for (const [name, platform, bindings] of [['mac', 'macos', [{ action: 'a', keys: 'cmd-shift-O' }]], ['linux', 'linux', [{ action: 'a', keys: 'secondary-ctrl-K alt-fn-x' }]], ['dash', 'macos', [{ action: 'a', keys: 'ctrl--' }]], ['blank', 'linux', [{ action: 'a', keys: '  ' }]], ['none', 'linux', []]]) {
    globalThis.flowHost = { keys: () => bindings, window: () => ({ platform }) };
    for (const options of [{ action: 'a' }, { action: 'a', hint: 'More', below: true, delay: 0 }, {}]) for (const hot of ['x', 'other']) out[`${name}-${JSON.stringify(options)}-${hot}`] = tip({ hot, t: palette, id: 'x', label: 'Label', trigger, ...options }).__node;
  }
  const view = { hot: null };
  globalThis.flowHost = { keys: () => [], window: () => ({}) };
  const mark = div();
  const plain = tipMark(view, palette, { id: 'm', label: '', mark });
  const lit = tipMark(view, palette, { id: 'm', label: 'Name', mark, below: true });
  const hover = control(lit.__node, 'm') ?? lit.__node;
  const calls = [];
  const trig = lit.__node.c.find(([c]) => c === 'trigger')[1][0];
  const onHover = event(trig, 'on_hover');
  onHover(true, { notify: () => calls.push(view.hot) }); onHover(false, { notify: () => calls.push(view.hot) });
  view.hot = 'other'; onHover(false, { notify: () => calls.push(view.hot) });
  golden('tip', { out, same: plain === mark, hovered: hover === lit.__node, calls });
});

// -- the tick and the watcher.
test('a tick asks git about due places, publishes review keys and repaints only on a real change', async () => {
  const a = { id: 'a', folder: '/a', machine: null, status: 'idle', tabs: [] };
  const exec = async () => ({ code: 1, stdout: '', stderr: 'not a git repository' });
  const host = { agents: () => [{ address: 'p1', status: 'working' }] };
  const { view, cx, calls, spawned } = live({ spaces: [a], exec, host });
  spawned.length = 0;
  view.notify = () => calls.push(['notify']);
  const trace = [];
  const realRefresh = view.refreshGit.bind(view);
  view.refreshGit = (keys, c) => { trace.push(['refreshGit', [...keys]]); realRefresh(keys, c); };
  view.loaded = false;
  view.checkNew(cx);
  for (const task of spawned.splice(0)) await task(cx);
  await settle();
  view.checkNew(cx);
  view.checkNew(cx);
  host.agents = () => [];
  globalThis.flowHost.agents = () => [{ address: 'p1', status: 'idle' }];
  view.refreshing = true;
  view.checkNew(cx);
  view.refreshing = false;
  view.loaded = false;
  view.retainedPending = new Map([['k', { signature: 's' }]]);
  view.retainedSynced = null;
  view.checkNew(cx);
  golden('tick', { trace, calls: calls.filter(([n]) => n !== 'notify').concat([['notifies', calls.filter(([n]) => n === 'notify').length]]), loaded: view.loaded, seen: view.statusSeen, cxNotified: cx.notified });
});

test('settleRows asks for the reviews of rows no space covers, within the in-flight limit', () => {
  const repo = JSON.stringify([null, '/r/.git']);
  const row = (id, over = {}, g = {}) => ({ w: { id, machine: null, ...over }, g: { repo, branch: `b-${id}`, base: 'o/r', head: 'o', top: `/${id}`, ...g } });
  const rows = [row('1'), row('2', { machine: 'far' }), row('3', {}, { branch: null }), row('4'), row('5'), row('6')];
  const { view, cx, sharedValues } = live({});
  const asked = [];
  view.ordered = () => rows;
  view.lookupPRByBranch = (key, ref) => { asked.push([key, ref.base, ref.head, ref.branch]); view.prAsking.add(key); };
  view.prCache = { [`/r/.git::b-4`]: { data: { title: 't' }, at: Date.now() } };
  view.settleRows(cx);
  view.settleRows(cx);
  golden('settle', { asked, active: sharedValues['pr.active.v1'], asking: [...view.prAsking] });
});

test('the repo watcher refreshes the places of its repo until it is dropped or fails', async () => {
  const mine = JSON.stringify([null, '/r']);
  let wakes = 0;
  const { view, cx, spawned } = live({ host: { watchFolder: async () => { if (++wakes === 3) throw new Error('gone'); } } });
  spawned.length = 0;
  view.git = { a: { repo: mine }, b: { repo: 'other' } };
  const refreshed = [];
  view.refreshGit = (keys) => refreshed.push(keys);
  view.watch('/r', cx);
  view.watch('/r', cx);
  for (const task of spawned.splice(0)) await task(cx);
  golden('watch', { refreshed, watching: [...view.watching], wakes });
});

test('initialization schedules machine and folder polling before the git tick', () => {
  const { view, cx } = live();
  const calls = [], timers = [];
  cx.timer.every = (delay, tick) => timers.push([delay, tick]);
  for (const name of ['refreshMachines', 'checkSaved', 'checkNew']) view[name] = context => calls.push([name, context]);
  view.init({}, cx);
  const tickCx = {};
  for (const [, tick] of timers) tick(tickCx);
  assert.deepEqual(timers.map(([delay]) => delay), [15000, 15000, 250]);
  assert.deepEqual(calls, [['refreshMachines', cx], ['refreshMachines', tickCx], ['checkSaved', tickCx], ['checkNew', tickCx]]);
});

test('dragging over a different card positions the indicator toward the source', () => {
  const { view } = live();
  const w = { id: 'target', name: 'card', tabs: [], folder: '/repo' };
  Object.assign(view, { pressed: 'source', over: w.id, rowIndex: new Map() });
  for (const [index, edge] of [[0, 'bottom'], [2, 'top'], [undefined, 'top']]) {
    view.rowIndex.set('source', index);
    const card = view.card({ w, pos: 1 }, palette, [], []).__node;
    const indicator = card.c.filter(([op]) => op === 'child').map(([, [node]]) => node)
      .find(node => node?.c?.some(([op]) => op === 'absolute'));
    assert.deepEqual(indicator.c.filter(([op]) => op === 'top' || op === 'bottom'), [[edge, [-6]]]);
  }
});
const { ensureAvatar, avatarFile } = await import('./project.js');

test('an avatar is attempted once and published only after the file is ready', async () => {
  for (const [mode, commands, ready] of [
    ['cached', ['mkdir', 'test'], true],
    ['converted', ['mkdir', 'test', 'curl', 'convert', 'rm'], true],
    ['unconverted', ['mkdir', 'test', 'curl', 'convert', 'mv'], true],
    ['offline', ['mkdir', 'test', 'curl'], false],
    ['error', ['mkdir'], false],
  ]) {
    const url = `https://example.test/${mode}.png`;
    const calls = [];
    globalThis.__herdrExec = async (cmd, args) => {
      calls.push(cmd);
      if (mode === 'error') throw Error('unavailable');
      if (cmd === 'curl') assert.deepEqual(args.slice(0, 4), ['-sfL', '--max-time', '10', url]);
      const failed = (cmd === 'test' && mode !== 'cached') ||
        (cmd === 'curl' && mode === 'offline') || (cmd === 'convert' && mode === 'unconverted');
      return { code: Number(failed) };
    };
    const tasks = [];
    const renderCx = { spawn: task => tasks.push(task) };
    ensureAvatar(url, renderCx);
    ensureAvatar(url, renderCx);
    assert.equal(tasks.length, 1);
    assert.equal(avatarFile(url), null);
    let notifications = 0;
    await tasks[0]({ notify() { notifications++; } });
    assert.deepEqual(calls, commands);
    assert.equal(notifications, Number(ready));
    assert.equal(avatarFile(url), ready ? `avatars/https_example.test_${mode}.png.png` : null);
    ensureAvatar(url, renderCx);
    assert.equal(tasks.length, 1);
  }
});


test('native folder watch cancellation does not affect a replacement', async () => {
  const pending = [], tasks = [], cancelled = [];
  const repo = '/r';
  const { view } = live({ host: { watchFolder: () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    promise.cancel = () => { cancelled.push(promise); resolve([]); };
    pending.push(promise);
    return promise;
  } } });
  view.git = { a: { repo: JSON.stringify([null, repo]) } };
  view.refreshGit = () => assert.fail('cancelled watch refreshed');
  const cx = { spawn: fn => tasks.push(fn) };
  view.watch(repo, cx);
  view.stopWatch(repo);
  view.watch(repo, cx);
  await tasks[0](cx);
  assert.equal(view.watching.get(repo), pending[1]);
  assert.deepEqual(cancelled, [pending[0]]);
  view.stopWatch(repo);
  await tasks[1](cx);
  assert.equal(view.watching.size, 0);
});


test('forgetting a project cancels its watcher and invalidates queued and in-flight checks', async () => {
  const dir = '/removed/.git', repo = JSON.stringify([null, dir]);
  const key = where({ folder: '/removed' });
  let finishStatus, cancelled = 0;
  const promise = new Promise(() => {});
  promise.cancel = () => { cancelled++; };
  const { view, cx } = live({
    shared: { 'orca-sidebar-projects.forget': { repo } },
    exec: () => new Promise(resolve => { finishStatus = resolve; }),
    host: { watchFolder: () => promise },
  });
  view.notify = () => {};
  view.git = { [key]: { repo } };
  view.watch(dir, cx);
  view.pending.add(key);
  const check = view.check(key, cx);
  view.forgetProject(cx);
  assert.equal(cancelled, 1);
  assert.equal(view.watching.size, 0);
  assert.equal(view.pending.has(key), false);
  finishStatus({ code: 0, stdout: '# branch.head main', stderr: '' });
  await check;
  assert.equal(key in view.git, false);
  assert.equal(view.watching.size, 0);
});

test('forgetting a cached sibling retains the watcher for an open project', () => {
  const dir = '/r/.git', repo = JSON.stringify([null, dir]);
  const space = { id: 'live', folder: '/r', tabs: [] };
  const open = where(space), closed = where({ folder: '/other' });
  let cancelled = 0;
  const promise = new Promise(() => {});
  promise.cancel = () => { cancelled++; };
  const { view, cx } = live({ spaces: [space], shared: { 'orca-sidebar-projects.forget': { repo } }, host: { watchFolder: () => promise } });
  view.notify = () => {};
  view.git = { [open]: { repo }, [closed]: { repo } };
  view.watch(dir, cx);
  view.forgetProject(cx);
  assert.equal(closed in view.git, false);
  assert.equal(open in view.git, true);
  assert.equal(view.watching.get(dir), promise);
  assert.equal(cancelled, 0);
  view.close();
  assert.equal(cancelled, 1);
});

test('closing a view cancels every native watch and blocks future refreshes and watches', () => {
  let cancelled = 0, opened = 0;
  const { view, cx } = live({ host: { watchFolder: () => {
    opened++;
    const promise = new Promise(() => {});
    promise.cancel = () => { cancelled++; };
    return promise;
  } } });
  view.watch('/a', cx);
  view.watch('/b', cx);
  view.pending.add('queued');
  view.close();
  view.close();
  view.watch('/c', cx);
  view.refreshGit(['after-close'], cx);
  assert.equal(opened, 2);
  assert.equal(cancelled, 2);
  assert.equal(view.watching.size, 0);
  assert.equal(view.pending.size, 0);
});

test('performance contract: 100 watcher mount and cancel cycles leave no live handles', async () => {
  let created = 0, cancelled = 0, peak = 0;
  const tasks = [], handles = new Set();
  const { view } = live({ host: { watchFolder: () => {
    let resolve;
    const p = new Promise(r => { resolve = r; });
    created++;
    handles.add(p);
    peak = Math.max(peak, handles.size);
    p.cancel = () => { assert.ok(handles.delete(p)); cancelled++; resolve([]); };
    return p;
  } } });
  const cx = { spawn: fn => tasks.push(fn) };
  view.refreshGit = () => assert.fail('stale watcher refreshed');
  for (let i = 0; i < 100; i++) {
    view.watch('/r', cx);
    view.watch('/r', cx);
    view.stopWatch('/r');
    await tasks.shift()(cx);
  }
  assert.equal(created, 100);
  assert.equal(cancelled, 100);
  assert.equal(peak, 1);
  assert.equal(handles.size, 0);
  assert.equal(view.watching.size, 0);
  console.log('PERF_CONTRACT ' + JSON.stringify({ id: 'spaces.watchers', scope: 'native handle stub',
    cycles: 100, created, cancelled, peak, active_after: handles.size }));
});
