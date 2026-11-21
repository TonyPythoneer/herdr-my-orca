// Characterization test: renders card() of the real main.js through recorder stubs
// (scripts/gpui-stub-loader.mjs) and compares with render.snap.json.
// Delete render.snap.json to re-record after an intended view change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

register(new URL('../../scripts/gpui-stub-loader.mjs', import.meta.url));
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
  if (!existsSync(SNAP)) writeFileSync(SNAP, JSON.stringify(out, null, 1) + '\n');
  assert.deepEqual(out, JSON.parse(readFileSync(SNAP, 'utf8')));
  assert.ok(new Set(Object.values(out).map((v) => JSON.stringify(v))).size >= 12);
});
