// The Workspace options popup is orca-nav's overlay, but the git it shows belongs to orca-spaces,
// which is the only mod that may read it. So the Refresh row's whole job is one command (plus
// closing itself so the sidebar repaints); this checks that wiring, not orca-spaces' git pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { register, registerHooks } from 'node:module';

register(new URL('../../scripts/gpui-stub-loader.mjs', import.meta.url));
// Keep the registered handlers callable, including callbacks inside the menu row.
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.startsWith('stub:')) return result;
  return { ...result, source: result.source.replace('return "fn"', 'return a')
    .replace(/export const (\w+) = \(\) => undefined;/g, 'export const $1 = (...args) => globalThis.flowHost?.$1?.(...args);') };
} });
const { default: Nav } = await import('./main.js');
globalThis.flowHost = { window: () => ({ active: true }) };

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
};
globalThis.__herdrSpaces = () => [{ id: 's1', folder: '/repo', machine: null, tabs: [] }];
globalThis.__herdrMachines = () => [];
globalThis.__herdrProps = () => ({ navMenu: 'workspace-options', overlay: 'overlay-1' });

test('the options popup asks orca-spaces to re-read git and closes itself', () => {
  const nav = Object.create(Nav.prototype);
  const row = nav.rootRows().find((r) => r.kind === 'action');
  assert.equal(row.label, 'Refresh branches');
  const ran = [];
  const closed = [];
  globalThis.__herdrRun = (command) => ran.push(command);
  globalThis.__herdrCloseOverlay = (id) => closed.push(id);
  nav.act(row, { notify() {} });
  assert.deepEqual(ran, ['orca-spaces.refresh']);
  assert.deepEqual(closed, ['overlay-1']);
});

test('Refresh branches is the first row a keyboard lands on, after the title', () => {
  const nav = Object.create(Nav.prototype);
  const rows = nav.rootRows();
  const navRows = rows.filter((r) => !['separator', 'label', 'heading', 'gap', 'groupby'].includes(r.kind));
  assert.equal(navRows[0], rows.find((r) => r.kind === 'action'));
});

function fixture() {
  globalThis.flowHost = { window: () => ({ active: true }) };
  const store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) };
  globalThis.__herdrSpaces = () => [{ machine: null }, { machine: 'remote' }];
  globalThis.__herdrProps = () => ({});
  globalThis.__herdrShared = key => key === 'projects.count' ? 2 : undefined;
  const cx = { calls: 0, notify() { this.calls++; } };
  return { nav: new Nav(), cx, saved: () => JSON.parse(store.get('workspace.options.v1')) };
}

function children(node) {
  return node.c.filter(([call]) => call === 'child' || call === 'children').flatMap(([, args]) => args.flat());
}
function handler(node, event) { return node.c.find(([call]) => call === event)[1][0]; }

test('menu actions persist options, preserve the final host and notify only on a change request', () => {
  const { nav, cx, saved } = fixture();
  for (const [row, key, value] of [
    [{ kind: 'toggle', key: 'hideDetachedHeadWorkspaces' }, 'hideDetachedHeadWorkspaces', true],
    [{ kind: 'radio', key: 'sortBy', value: 'name' }, 'sortBy', 'name'],
    [{ kind: 'groupby', value: 'none' }, 'groupBy', 'none'],
    [{ kind: 'project', project: 'r' }, 'filterRepoIds', ['r']],
    [{ kind: 'project', project: 'r' }, 'filterRepoIds', []],
    [{ kind: 'projectClear' }, 'filterRepoIds', []],
    [{ kind: 'host', host: 'remote' }, 'visibleWorkspaceHostIds', [null]],
  ]) {
    nav.act(row, cx);
    assert.deepEqual(saved()[key], value);
  }
  for (const row of [{ kind: 'host', host: null }, { kind: 'gap' }, { kind: 'other' }]) nav.act(row, cx);
  assert.equal(cx.calls, 7);
  nav.act({ kind: 'host', host: 'remote' }, cx);
  assert.equal(saved().visibleWorkspaceHostIds, null);
  nav.act({ kind: 'hostAll' }, cx);
  assert.equal(cx.calls, 9);
});

test('click, hover and keyboard operate on the same popup pages', () => {
  const { nav, cx, saved } = fixture();
  globalThis.__herdrProps = () => ({ navMenu: 'workspace-options' });
  nav.init({}, { focus_handle: () => ({ focus() {} }) });
  const root = nav.render(cx).__node;
  const rows = nav.rootRows();
  const sortIndex = rows.findIndex(r => r.page === 'sort');
  const row = children(root)[sortIndex];
  handler(row, 'on_hover')(true, cx);
  assert.equal(nav.at, sortIndex);
  handler(row, 'on_click')({}, cx);
  assert.deepEqual([nav.page, nav.at], ['sort', -1]);
  const key = handler(nav.render(cx).__node, 'on_key_down');
  key({ key: 'down' }, cx);
  key({ key: 'enter' }, cx);
  assert.equal(saved().sortBy, 'name');
  key({ key: 'home' }, cx);
  key({ key: 'space' }, cx);
  assert.deepEqual([nav.page, nav.at], [null, -1]);
});

test('placed header reveals collapse on hover and dispatches the published direction', () => {
  const { nav, cx } = fixture();
  const calls = [];
  globalThis.__herdrRun = name => calls.push(name);
  globalThis.__herdrLayout = () => ({ children: [{ id: 'main' }] });
  const [search, header] = children(nav.render(cx).__node);
  handler(search, 'on_click')();
  handler(header, 'on_hover')(true, cx);
  const collapse = children(children(children(nav.render(cx).__node)[1])[0])[1];
  handler(collapse, 'on_click')();
  assert.deepEqual(calls, ['mod.open', 'orca-spaces.collapse-all']);
  assert.equal(cx.calls, 1);
});

function byId(node, id) {
  if (node?.c?.some(([call, args]) => call === 'id' && args[0] === id)) return node;
  for (const [call, args] of node?.c ?? []) {
    if (call !== 'child' && call !== 'children') continue;
    for (const child of args.flat()) { const found = byId(child, id); if (found) return found; }
  }
}

test('the add-project button saves a picked folder once and opens a space on it', async () => {
  const { nav, cx } = fixture();
  const calls = [];
  globalThis.__herdrRun = (name, args) => calls.push([name, args]);
  const picks = ['/a', null, '/a'];
  globalThis.flowHost = { window: () => ({ active: true }), pickFolder: async () => picks.shift() };
  const add = byId(nav.render(cx).__node, 'proj-add-repo');
  for (let i = 0; i < 3; i++) { handler(add, 'on_click')(); await new Promise(r => setImmediate(r)); }
  assert.deepEqual(JSON.parse(localStorage.getItem('projects.saved.v1')), ['/a']);
  assert.deepEqual(calls, [['space.new', { folder: '/a' }], ['space.new', { folder: '/a' }]]);
});

test('the options and new-workspace buttons open their popups', () => {
  const { nav, cx } = fixture();
  const opened = [];
  globalThis.flowHost = { window: () => ({ active: true }), openOverlay: o => opened.push(o) };
  const root = nav.render(cx).__node;
  handler(byId(root, 'proj-options'), 'on_click')();
  handler(byId(root, 'proj-new'), 'on_click')();
  assert.deepEqual(opened, [
    { mod: 'orca-nav', kind: 'popup', width: 288, height: 560, props: { navMenu: 'workspace-options' } },
    { mod: 'orca-new-menu', kind: 'popup', width: 288, height: 512 },
  ]);
});

test('the popup keyboard wraps, jumps to the ends and closes on escape', () => {
  const { nav, cx } = fixture();
  const closed = [];
  globalThis.__herdrProps = () => ({ navMenu: 'workspace-options', overlay: 'o1' });
  globalThis.__herdrCloseOverlay = id => closed.push(id);
  nav.init({}, { focus_handle: () => ({ focus() {} }) });
  const rows = nav.rootRows();
  const stops = rows.filter(r => !['separator', 'label', 'heading', 'gap', 'groupby'].includes(r.kind));
  const key = name => { handler(nav.render(cx).__node, 'on_key_down')({ key: name }, cx); return rows[nav.at]; };
  assert.equal(key('end'), stops.at(-1));
  assert.equal(key('down'), stops[0]);
  assert.equal(key('up'), stops.at(-1));
  assert.equal(key('home'), stops[0]);
  const before = cx.calls;
  handler(nav.render(cx).__node, 'on_key_down')({ key: 'x' }, cx);
  assert.equal(cx.calls, before);
  key('escape');
  assert.deepEqual(closed, ['o1']);
});

test('every page lists its rows with the stored choices marked', () => {
  const { nav, saved } = fixture();
  globalThis.__herdrMachines = () => [{ name: 'remote' }];
  const store = { 'git.cache.v2': JSON.stringify({ a: { repo: 'r1', name: 'One' }, b: { repo: 'r2' }, c: null }) };
  const real = globalThis.localStorage;
  globalThis.localStorage = { getItem: k => store[k] ?? real.getItem(k), setItem: (k, v) => { store[k] = v; real.setItem(k, v); } };
  nav.act({ kind: 'host', host: 'remote' }, { notify() {} });
  nav.act({ kind: 'project', project: 'r2' }, { notify() {} });
  assert.deepEqual(saved().visibleWorkspaceHostIds, [null]);
  const pick = page => nav.pageRows(page).map(r => [r.kind, r.label, r.checked, r.disabled]);
  assert.deepEqual(pick('hosts'), [['back', 'Back'], ['hostAll', 'All hosts', false], ['host', 'This computer', true], ['host', 'remote', false]].map(r => [r[0], r[1], r[2], undefined]));
  assert.deepEqual(pick('projects'), [['back', 'Back'], ['projectClear', 'Clear', undefined, false], ['project', 'One', false], ['project', 'r2', true]].map(r => [r[0], r[1], r[2], r[3]]));
  assert.deepEqual(pick('sort').filter(r => r[2]), [['radio', 'Manual', true, undefined]]);
  assert.deepEqual(nav.rootRows().filter(r => r.kind === 'page').map(r => [r.page, r.value]),
    [['hosts', '1 hosts'], ['projects', '1 projects'], ['sort', 'Manual'], ['projectOrder', 'Manual']]);
});

// Every view is recorded once from the code as first written, then compared byte for byte.
// A digest per view keeps the file small; a failure names the view that changed.
const digests = (views) => Object.fromEntries(Object.entries(views).map(([name, node]) => [name, createHash('sha256').update(JSON.stringify(node)).digest('hex').slice(0, 16)]));
const GOLDEN = new URL('./views.golden.json', import.meta.url);
const palette = new Proxy({}, { get: (_t, k) => `#${String(k)}` });
const rec = x => JSON.parse(JSON.stringify(x?.__node ?? x));

function views() {
  const out = {};
  globalThis.__herdrTheme = () => palette;
  globalThis.flowHost = { window: () => ({ active: true }) };
  const sharedValues = {};
  globalThis.__herdrShared = key => sharedValues[key];
  const layoutTree = { children: [{ id: 'main', active: 'page-tasks' }, { id: 'sidebar', size: { px: 120 } }] };
  globalThis.__herdrLayout = () => layoutTree;
  const store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  globalThis.__herdrSpaces = () => [{ machine: null }, { machine: 'remote' }];
  globalThis.__herdrMachines = () => [{ name: 'remote' }, { name: 'other' }];
  store.set('git.cache.v2', JSON.stringify({ a: { repo: 'r1', name: 'One' }, b: { repo: 'r2' } }));
  const cx = { notify() {} };
  for (const unified of [false, true]) {
    for (const [name, shared, hover, options] of [
      ['plain', {}, false, {}],
      ['hover', { 'projects.count': 3, 'projects.allCollapsed': true }, true, { hideDefaultBranchWorkspace: true }],
      ['filters', { 'projects.count': 2, 'sidebar.openPx': 240 }, true, { hideSleepingWorkspaces: true, alwaysShowDefaultBranchWorkspace: false, hideDetachedHeadWorkspaces: true, visibleWorkspaceHostIds: [null], filterRepoIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }],
      ['narrow', { 'sidebar.openPx': 240 }, false, {}],
      ['badcolor', { 'sidebar.openPx': 240 }, false, {}],
    ]) {
      Object.keys(sharedValues).forEach(k => delete sharedValues[k]);
      Object.assign(sharedValues, shared);
      store.set('workspace.options.v1', JSON.stringify(options));
      globalThis.__herdrProps = () => ({ unified });
      globalThis.__herdrTheme = name === 'badcolor' ? () => ({ ...palette, surface: 'red', chrome: 'red' }) : () => new Proxy({ surface: '#101010' }, { get: (t, k) => t[k] ?? `#${String(k)}` });
      const nav = new Nav();
      nav.headerHover = hover;
      out[`nav-${unified}-${name}`] = rec(nav.render(cx));
    }
  }
  globalThis.__herdrTheme = () => palette;
  const nav = new Nav();
  for (const [page, at, options] of [
    [null, -1, {}], [null, 3, { groupBy: 'none' }], ['hosts', 1, { visibleWorkspaceHostIds: [null] }], ['projects', 2, { filterRepoIds: ['r1'] }],
    ['sort', 0, { sortBy: 'name' }], ['projectOrder', -1, { projectOrderBy: 'recent' }],
  ]) {
    store.set('workspace.options.v1', JSON.stringify(options));
    globalThis.__herdrProps = () => ({ navMenu: 'workspace-options' });
    Object.assign(nav, { page, at, handle: { id: 'h' } });
    out[`options-${page}-${at}`] = rec(nav.optionsView(cx));
  }
  const rows = [{ kind: 'separator' }, { kind: 'label', text: 'L' }, { kind: 'heading', text: 'H' }, { kind: 'groupby' },
    { kind: 'gap', label: 'G', note: 'because' }, { kind: 'action', label: 'A', value: 'v' }, { kind: 'page', label: 'P', value: 'pv' },
    { kind: 'toggle', label: 'T', checked: true }, { kind: 'toggle', label: 'T', checked: false }, { kind: 'radio', label: 'R', checked: true }, { kind: 'radio', label: 'R', checked: false },
    { kind: 'host', label: 'Ho', checked: true }, { kind: 'hostAll', label: 'Ha', checked: false }, { kind: 'project', label: 'Pr', checked: true },
    { kind: 'projectClear', label: 'C', disabled: true }, { kind: 'projectClear', label: 'C' }, { kind: 'back', label: 'Back' }];
  rows.forEach((row, i) => { for (const at of [i, -1]) { nav.at = at; out[`row-${i}-${row.kind}-${at}`] = rec(nav.menuRow(row, i, palette, cx)); } });
  return out;
}

test('every nav view renders as recorded', () => {
  const out = digests(views());
  assert.deepEqual(out, JSON.parse(readFileSync(GOLDEN, 'utf8')));
  assert.ok(new Set(Object.values(out)).size >= 30);
});

test('unknown row kinds render an empty value and leave options alone', () => {
  const { nav, cx } = fixture();
  for (const kind of ['other', 'constructor', 'toString', '__proto__']) {
    const row = { kind, label: 'Unknown' };
    const rendered = children(nav.menuRow(row, 0, palette, cx).__node);
    assert.deepEqual(rendered.at(-1).c.at(-1), ['child', ['']]);
    nav.act(row, cx);
  }
  assert.equal(cx.calls, 0);
  assert.equal(localStorage.getItem('workspace.options.v1'), undefined);
});

test('adding a project recovers invalid JSON and non-array saved values', async () => {
  for (const invalid of ['{broken', 'null', '{}', '"string"']) {
    const { nav, cx } = fixture();
    localStorage.setItem('projects.saved.v1', invalid);
    const calls = [];
    globalThis.__herdrRun = (name, args) => calls.push([name, args]);
    globalThis.flowHost = { window: () => ({ active: true }), pickFolder: async () => '/new' };
    handler(byId(nav.render(cx).__node, 'proj-add-repo'), 'on_click')();
    await new Promise(r => setImmediate(r));
    assert.deepEqual(JSON.parse(localStorage.getItem('projects.saved.v1')), ['/new']);
    assert.deepEqual(calls, [['space.new', { folder: '/new' }]]);
  }
});
