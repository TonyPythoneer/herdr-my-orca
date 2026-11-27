import { register } from 'node:module';
register(new URL('../../scripts/gpui-stub-loader.mjs', import.meta.url));
const { stored, workspaceOptions } = await import('./storage.js');
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture() {
  const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export default class Spaces', 'class Spaces');
  let sharedReads = 0;
  const scope = {
    View: class {}, foldKey: r => `space:${r.w.id}`, shared: () => { sharedReads++; return null; },
    onStop: v => v.focused, avatarFile: () => null, stored, workspaceOptions,
  };
  vm.runInNewContext(source + '\nglobalThis.Spaces = Spaces;', scope);
  const owner = new scope.Spaces();
  Object.assign(owner, {
    retainedRows: new Map(), retainedPending: new Map(), foldedRepos: new Set(), watching: new Map(),
    expandedAgents: new Set(), unread: new Set(), fs: { keyboard: false },
    rowIndex: new Map(), reviewOf: () => null, direct: 0,
    rowElements(data) { this.direct++; return [data.r]; },
  });
  const calls = { creates: 0, updates: 0, releases: 0 };
  const cx = { new() {
    calls.creates++;
    return { set_props() { calls.updates++; }, release() { calls.releases++; } };
  } };
  const draw = (id, name = id, pos = 0) => owner.retainedRow({ w: { id, name }, pos }, {}, [], [], 'repo');
  return { owner, calls, cx, draw, sharedReads: () => sharedReads, keyboard(on) { scope.shared = () => { sharedReads++; return on ? 'keyboard' : null; }; } };
}

test('changed rows paint fresh immediately, then retain; stable rows avoid element construction', () => {
  const { owner, calls, cx, draw } = fixture();
  draw('a'); draw('b');
  assert.equal(owner.direct, 2);
  assert.equal(owner.syncRetained(cx), true);
  assert.equal(calls.creates, 2);
  owner.retainedPending = new Map();
  assert.equal(draw('a')[0], owner.retainedRows.get('a').entity);
  assert.equal(draw('b')[0], owner.retainedRows.get('b').entity);
  assert.equal(owner.direct, 2);
  assert.equal(owner.syncRetained(cx), false);
  owner.retainedPending = new Map();
  assert.equal(draw('a', 'renamed', 1)[0].w.name, 'renamed');
  assert.equal(draw('b')[0], owner.retainedRows.get('b').entity);
  assert.equal(owner.syncRetained(cx), true);
  assert.equal(calls.updates, 1);
  assert.equal(owner.direct, 3);
});

test('hover affects one row; removed entities release and remount fresh', () => {
  const { owner, calls, cx, draw } = fixture();
  draw('a'); draw('b'); owner.syncRetained(cx);
  owner.retainedPending = new Map();
  owner.laneHot = 'a';
  assert.equal(draw('a')[0].w.id, 'a');
  assert.equal(draw('b')[0], owner.retainedRows.get('b').entity);
  owner.syncRetained(cx);
  assert.equal(calls.updates, 1);
  owner.retainedPending = new Map(); draw('a'); owner.syncRetained(cx);
  assert.equal(calls.releases, 1);
  assert.equal(owner.retainedRows.has('b'), false);
  owner.retainedPending = new Map(); draw('a'); draw('b'); owner.syncRetained(cx);
  assert.equal(calls.creates, 3);
  owner.close();
  assert.equal(calls.releases, 3);
});

test('owner events update affected retained children before parent renders, retaining focus paths', () => {
  const { owner, calls, cx, draw } = fixture();
  draw('a'); draw('b'); owner.syncRetained(cx);
  let rootNotifications = 0;
  owner.ownerCx = { ...cx, notify() { rootNotifications++; } };
  owner.hoveredRepo = 'space:a';
  owner.notify({ notify() { throw new Error('must notify owner'); } });
  assert.equal(rootNotifications, 1);
  assert.equal(calls.updates, 1);
  owner.retainedPending = new Map();
  assert.equal(draw('a')[0], owner.retainedRows.get('a').entity);
  assert.equal(draw('b')[0], owner.retainedRows.get('b').entity);
  assert.equal(owner.direct, 2);
});


test('a row signature excludes the sibling catalog already projected into rows', () => {
  const { owner } = fixture();
  const row = { w: { id: 'a', name: 'a', tabs: [] }, g: { repo: 'repo', top: '/a', worktrees: [] }, also: [{ w: { id: 'merged', tabs: [] }, g: { worktrees: [] } }], head: true, count: 2, pos: 0 };
  const data = { r: row, t: {}, ps: [], mine: [], groupBy: 'repo' };
  const before = owner.rowSignature(data);
  row.g.worktrees = Array.from({ length: 2000 }, (_,i)=>({path:`/sibling-${i}`}));
  row.also[0].g.worktrees = row.g.worktrees;
  assert.equal(owner.rowSignature(data), before);
  row.count++;
  assert.notEqual(owner.rowSignature(data), before);
});


test('keyboard mode bypasses retention even beyond the initial focus pool', () => {
  const { owner, cx, draw, keyboard } = fixture();
  for (let i = 0; i < 80; i++) draw(String(i));
  while (owner.syncRetained(cx)) {}
  owner.retainedPending = new Map();
  for (let i = 0; i < 80; i++) draw(String(i));
  assert.equal(owner.direct, 80);
  keyboard(true);
  for (let pass = 0; pass < 2; pass++) {
    owner.retainedPending = new Map();
    for (let i = 0; i < 80; i++) assert.equal(draw(String(i))[0].w.id, String(i));
  }
  assert.equal(owner.direct, 240);
});

test('event signature refresh scans focus handles once for all rows', () => {
  const { owner, draw } = fixture();
  for (let i = 0; i < 80; i++) draw(String(i));
  let scans = 0;
  Object.defineProperty(owner, 'focused', { get() { scans++; return 'row:79'; } });
  owner.refreshRetained();
  assert.equal(scans, 1);
  assert.equal(owner.retainedPending.get('79').signature, owner.rowSignature(owner.retainedPending.get('79'), 'row:79'));
});

test('render signature batches reuse one focus snapshot, including no focused stop', () => {
  const { owner, draw } = fixture();
  Object.defineProperty(owner, 'focused', { get() { throw new Error('per-row focus scan'); } });
  for (const focused of [null, 'row:79']) {
    owner.retainedFocus = focused;
    owner.retainedPending = new Map();
    for (let i = 0; i < 80; i++) draw(String(i));
    for (const data of owner.retainedPending.values()) {
      assert.equal(data.signature, owner.rowSignature(data, focused));
    }
  }
});

test('retained adoption stays bounded and progresses across fresh render snapshots', () => {
  const { owner, calls, cx, draw } = fixture();
  const render = name => {
    owner.retainedPending = new Map();
    for (let i = 0; i < 80; i++) draw(String(i), `${name}-${i}`);
  };
  for (const phase of ['initial', 'renamed']) {
    for (let batch = 0; batch < 5; batch++) {
      render(phase);
      const before = calls.creates + calls.updates + calls.releases;
      assert.equal(owner.syncRetained(cx), true);
      assert.equal(calls.creates + calls.updates + calls.releases - before, 16);
    }
    assert.equal(owner.syncRetained(cx), false);
  }
  assert.equal(calls.creates, 80);
  assert.equal(calls.updates, 80);
  owner.retainedPending = new Map();
  for (let batch = 0; batch < 5; batch++) {
    const before = calls.releases;
    assert.equal(owner.syncRetained(cx), true);
    assert.equal(calls.releases - before, 16);
  }
  assert.equal(owner.syncRetained(cx), false);
  assert.equal(owner.retainedRows.size, 0);
});

test('replacement rows share the same native operation budget with removals', () => {
  const { owner, calls, cx, draw } = fixture();
  for (let i = 0; i < 10; i++) draw(`old-${i}`);
  owner.syncRetained(cx);
  owner.retainedPending = new Map();
  for (let i = 0; i < 10; i++) draw(`new-${i}`);
  owner.syncRetained(cx);
  assert.equal(calls.releases, 10);
  assert.equal(calls.creates, 16);
  owner.syncRetained(cx);
  assert.equal(calls.creates, 20);
  assert.equal(owner.retainedRows.size, 10);
});

test('row batches reuse one keyboard-mode snapshot and invalidate on mode changes', () => {
  const { owner, draw, keyboard, sharedReads } = fixture();
  owner.retainedKeyboardMode = false;
  for (let i = 0; i < 80; i++) draw(String(i));
  assert.equal(sharedReads(), 0);
  const before = owner.retainedPending.get('0').signature;
  keyboard(true);
  owner.refreshRetained();
  assert.equal(sharedReads(), 1);
  assert.equal(owner.retainedKeyboardMode, true);
  assert.notEqual(owner.retainedPending.get('0').signature, before);
  for (let i = 0; i < 80; i++) draw(String(i));
  assert.equal(sharedReads(), 1);
  keyboard(false);
  owner.refreshRetained();
  assert.equal(sharedReads(), 2);
  assert.equal(owner.retainedPending.get('0').signature, before);
});

test('performance contract: stable rows reuse retained views across 100 interactions', () => {
  const { owner, calls, cx, draw } = fixture();
  const count = 10, interactions = 100;
  for (let i = 0; i < count; i++) draw(String(i));
  owner.syncRetained(cx);
  const directBefore = owner.direct;
  for (let n = 0; n < interactions; n++) {
    owner.retainedPending = new Map();
    for (let i = 0; i < count; i++) assert.equal(draw(String(i))[0], owner.retainedRows.get(String(i)).entity);
    assert.equal(owner.syncRetained(cx), false);
  }
  const rebuilds = owner.direct - directBefore;
  assert.equal(rebuilds, 0);
  assert.equal(calls.creates, count);
  owner.close();
  assert.equal(calls.releases, count);
  console.log('PERF_CONTRACT ' + JSON.stringify({ id: 'spaces.retained', scope: 'view fixture', interactions,
    row_requests: count * interactions, row_rebuilds: rebuilds, reuse_rate: 1 - rebuilds / (count * interactions),
    created: calls.creates, released: calls.releases, live_after_close: owner.retainedRows.size }));
});
