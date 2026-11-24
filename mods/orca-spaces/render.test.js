// Characterization test: renders card() of the real main.js through recorder stubs
// (scripts/gpui-stub-loader.mjs) and compares with render.snap.json.
// Delete render.snap.json to re-record after an intended view change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register, registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { where } from './worktree-plan.js';

register(new URL('../../scripts/gpui-stub-loader.mjs', import.meta.url));
// Host calls the loader leaves undefined (keys, window, ...) answer from `globalThis.flowHost`; handlers stay recorded as "fn".
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.startsWith('stub:')) return result;
  return { ...result, source: result.source.replace(/export const (\w+) = \(\) => undefined;/g, 'export const $1 = (...args) => globalThis.flowHost?.$1?.(...args);') };
} });
const { default: Spaces } = await import('./main.js');

const t = new Proxy({}, { get: (_t, k) => `#${String(k)}` });
const SNAP = new URL('./render.snap.json', import.meta.url);
const rec = (x) => JSON.parse(JSON.stringify(x?.__node ?? x));

const review = { title: 'Fix it', number: 7, state: 'open', url: 'https://x/7' };
const agent = (i, status = 'working', icon = `i${i}.svg`) => ({ address: `p${i}`, status, title: `a${i}`, app: 'unknown', program: { icon }, tab: 't1' });
const space = (over = {}) => ({ id: 'w', folder: '/a/c', name: 'space', status: 'idle', tabs: [], active: false, ...over });
const git = (over = {}) => ({ branch: 'feat/x', repo: 'o/r', linked: true, count: 2, top: false, ...over });

function owner(state = {}) {
  const o = Object.create(Spaces.prototype);
  Object.assign(o, {
    fs: { modal: false, handles: new Map(), free: [], keyboard: false }, unread: new Set(), expandedAgents: new Set(), laneHot: null, over: null, pressed: null, rowIndex: new Map(),
    reviewOf: (g) => (g?.branch === 'feat/x' && state.review ? review : null),
    toggleAgents() {}, notify() {}, toggleUnread() {}, menu() {}, ...state,
  });
  return o;
}
const cases = {
  plain: [owner(), { w: space(), g: git() }, []],
  folder: [owner(), { w: space({ folder: '/a/b' }), g: null }, []],
  active: [owner(), { w: space({ active: true, status: 'working' }), g: git() }, [agent(1)]],
  named: [owner(), { w: space({ named: true, name: 'Mine' }), g: git() }, []],
  reviewed: [owner({ review: true }), { w: space(), g: git() }, []],
  unread: [owner({ unread: new Set(['w']) }), { w: space({ status: 'done' }), g: git({ top: true }) }, []],
  hover: [owner({ over: 'w', laneHot: 'w' }), { w: space(), g: git() }, [agent(1)]],
  pressed: [owner({ pressed: 'w', over: 'w' }), { w: space(), g: git() }, []],
  merged: [owner(), { w: space({ status: 'blocked' }), g: git(), also: [{ w: space({ id: 'w2', active: true, status: 'done' }) }] }, []],
  unopened: [owner(), { w: space(), g: git(), unopened: true, pos: 3 }, []],
  tabs: [owner(), { w: space({ tabs: [{ id: 't1', name: '1' }, { id: 't2', name: '2' }, { id: 't3', name: '3' }] }), g: git() }, [agent(1)]],
  agentsCollapsed: [owner(), { w: space({ tabs: [{ id: 't1', name: '1' }] }), g: git() }, [agent(1, 'blocked'), agent(2, 'working'), agent(3, 'done'), agent(4, 'idle'), agent(5, 'working', null)]],
  agentsOpen: [owner({ expandedAgents: new Set(['w']) }), { w: space({ tabs: [{ id: 't1', name: '1' }, { id: 't9', name: '9' }] }), g: git() }, [agent(1), agent(2, 'done')]],
  agentOne: [owner({ expandedAgents: new Set(['w']) }), { w: space(), g: git() }, [agent(1)]],
};

test('card renders as recorded', () => {
  const out = {};
  for (const [name, [o, row, mine]] of Object.entries(cases)) out[name] = rec(o.card(row, t, [], mine));
  assert.deepEqual(out, JSON.parse(readFileSync(SNAP, 'utf8')));
  assert.ok(new Set(Object.values(out).map((v) => JSON.stringify(v))).size >= 12);
});

// The other views, recorded once from the code as first written and compared byte for byte.
// They run on a real, initialised view so the state they read has its real shape.
// A digest per view keeps the file small; a failure names the view that changed.
const digests = (views) => Object.fromEntries(Object.entries(views).map(([name, node]) => [name, createHash('sha256').update(JSON.stringify(node)).digest('hex').slice(0, 16)]));
const GOLDEN = new URL('./views.golden.json', import.meta.url);
const palette = new Proxy({ surface: '#101010' }, { get: (target, key) => target[key] ?? `#${String(key)}` });

function liveView(env = {}) {
  const store = new Map(Object.entries(env.storage ?? {}));
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) };
  globalThis.__herdrShared = (key) => (env.shared ?? {})[key];
  globalThis.__herdrProps = () => env.props ?? {};
  globalThis.__herdrTheme = () => palette;
  globalThis.__herdrSpaces = () => env.spaces ?? [];
  globalThis.__herdrMachines = () => env.machines ?? [];
  globalThis.__herdrLayout = () => env.layout;
  globalThis.flowHost = { keys: () => [{ action: 'space.new', keys: 'cmd-n' }], window: () => ({ active: true, platform: 'macos' }), agents: () => [], panes: () => [] };
  const handle = () => ({ focus() {}, is_focused() { return false; } });
  const cx = { focus_handle: handle, spawn() {}, timer: { every() {} }, notify() {}, new() { return { release() {}, set_props() {} }; } };
  const view = new Spaces();
  view.init({}, cx);
  Object.assign(view, env.state ?? {});
  return { view, cx };
}

const gitFor = (s, over = {}) => ({ name: 'repo', top: s.folder, branch: 'main', owner: null, base: 'o/r', head: 'o', repo: JSON.stringify([s.machine ?? null, '/repo/.git']), linked: false, worktrees: [{ path: '/repo', branch: 'main' }, { path: '/repo-wt', branch: 'wt' }], ...over });

function headerCases() {
  const out = {};
  const w = { id: 'h1', name: 'repo', folder: '/repo', machine: null, tabs: [] };
  const rowOf = (g, count = 2) => ({ w, g, count });
  const grouped = { groups: [{ key: gitFor(w).repo, rows: [{ w: { id: 'h1' } }, { w: { id: 'h2' } }] }] };
  const variants = {
    plain: [{}, rowOf(gitFor(w))],
    empty: [{}, rowOf(gitFor(w), 0)],
    folder: [{}, rowOf(null, 1)],
    folded: [{ foldedRepos: new Set([gitFor(w).repo]) }, rowOf(gitFor(w))],
    hovered: [{ hoveredRepo: gitFor(w).repo }, rowOf(gitFor(w))],
    menu: [{ menuKey: gitFor(w).repo }, rowOf(gitFor(w))],
    remote: [{}, { w: { ...w, machine: 'remote' }, g: gitFor({ ...w, machine: 'remote' }, { owner: null }), count: 1 }],
  };
  for (const unified of [false, true]) {
    for (const [name, [state, row]] of Object.entries(variants)) {
      const { view } = liveView({ props: { unified }, spaces: [w], state: { plan: grouped, ...state } });
      out[`header-${unified}-${name}`] = rec(view.header(row, palette, []));
    }
  }
  const keyboard = { shared: { 't3-focus': 'me' }, spaces: [w], state: { plan: grouped } };
  const { view } = liveView(keyboard);
  const focused = { focus() {}, is_focused: () => true };
  view.fs.handles.set('space-head-h1', focused);
  view.fs.keyboard = true;
  out['header-keyboard'] = rec(view.header(rowOf(gitFor(w)), palette, []));
  return out;
}

function machineCases() {
  const out = {};
  const machines = [
    { name: 'up', state: 'connected' }, { name: 'down', state: 'timed_out' }, { name: 'idle' },
    { name: 'moved', state: 'unreachable', why: 'a different core answers there ("abc")' },
    { name: 'broken', state: 'unreachable', why: 'refused' },
  ];
  const reconnecting = { moved: { machine: machines[3], removed: false, error: 'nope' }, gone: { machine: { name: 'gone' }, busy: true } };
  const spaces = [{ id: 'a', machine: 'up', active: true, tabs: [], folder: '/x' }];
  for (const [name, item, state] of [
    ['local', { machine: null, count: 3 }, {}],
    ['local-empty', { machine: null, count: 0 }, { overMachine: 'machine-local' }],
    ['up', { machine: 'up', count: 1 }, { hot: 'machine-add-up', overMachine: 'machine-up' }],
    ['up-folded', { machine: 'up', count: 2 }, { folded: new Set(['up']) }],
    ['down', { machine: 'down', count: 1 }, {}],
    ['idle', { machine: 'idle', count: 1 }, {}],
    ['moved', { machine: 'moved', count: 1 }, {}],
    ['gone', { machine: 'gone', count: 1 }, {}],
    ['broken', { machine: 'broken', count: 0 }, { hot: 'machine-connect-broken' }],
  ]) {
    const { view } = liveView({ spaces, state: { machines, reconnecting, ...state } });
    out[`machine-${name}`] = rec(view.machineHead(item, palette));
  }
  const { view } = liveView({ spaces });
  for (const label of ['', 'Seen', 'Unseen']) out[`status-${label}`] = rec(view.statusHead(label, 4, palette));
  for (const state of ['merged', 'closed', 'draft', 'open', 'weird', undefined]) {
    for (const hot of [null, 'pr-x']) {
      view.hot = hot;
      out[`pr-${state}-${hot}`] = rec(view.prBadge({ state, number: 7 }, palette, 'x'));
    }
  }
  return out;
}

function bodyCases() {
  const out = {};
  const mk = (id, over = {}) => ({ id, name: id, folder: `/${id}`, machine: null, status: 'idle', active: false, tabs: [{ id: `${id}-t` }], ...over });
  const a = mk('a', { active: true, status: 'working' });
  const b = mk('b', { folder: '/repo-wt', status: 'done' });
  const c = mk('c', { folder: '/plain' });
  const spaces = [a, b, c, mk('r', { machine: 'remote', folder: '/r' })];
  const gitCache = { [where(a)]: gitFor(a, { repo: JSON.stringify([null, '/repo/.git']), top: '/repo' }), [where(b)]: gitFor(b, { top: '/repo-wt', linked: true, branch: 'wt' }), [where(c)]: null };
  const storage = (extra = {}) => ({ 'git.cache.v2': JSON.stringify(gitCache), ...extra });
  const base = { spaces, machines: [{ name: 'remote', layout: 'ready' }] };
  for (const unified of [false, true]) {
    for (const [name, env] of Object.entries({
      loaded: { storage: storage() },
      loading: { storage: storage(), state: { loaded: false } },
      refreshing: { storage: storage(), state: { refreshingAll: true, listHover: true } },
      empty: { storage: {}, spaces: [], machines: [], state: { loaded: true } },
      saved: { storage: storage({ 'projects.saved.v1': JSON.stringify(['/a/deep', '/saved/one', '/gone']) }), state: { missingFolders: new Set(['/gone']) } },
      shared: { storage: storage(), shared: { 'spaces.unread.v1': ['a'], 'space.colors': {}, 'projects.count': 1, 'projects.allCollapsed': true } },
      collapsed: { storage: storage({ 'repos.folded': JSON.stringify([gitFor(a).repo]) }) },
      ungrouped: { storage: storage({ 'workspace.options.v1': JSON.stringify({ groupBy: 'workspace-status' }) }) },
      narrow: { storage: storage(), shared: { 'left-sidebar.openPx': 240 }, layout: { id: 'left-sidebar', size: { px: 100 } } },
      newMenu: { storage: storage(), props: { newMenu: true } },
    })) {
      const { view, cx } = liveView({ ...base, ...env, props: { unified, ...env.props }, state: { loaded: true, ...env.state } });
      out[`body-${unified}-${name}`] = rec(view.render(cx));
    }
  }
  return out;
}

test('the header, machine, status, badge and body views render as recorded', () => {
  const out = digests({ ...headerCases(), ...machineCases(), ...bodyCases() });
  assert.deepEqual(out, JSON.parse(readFileSync(GOLDEN, 'utf8')));
  assert.ok(new Set(Object.values(out)).size >= 45);
});

test('a folderless workspace does not hide saved projects or crash the sidebar', () => {
  const { view, cx } = liveView({
    spaces: [{ id: 'folderless', name: 'shell', folder: null, status: 'idle', tabs: [] }],
    storage: { 'projects.saved.v1': JSON.stringify(['/saved/one']) },
    state: { loaded: true },
  });
  assert.match(JSON.stringify(rec(view.render(cx))), /Saved Projects/);
});
