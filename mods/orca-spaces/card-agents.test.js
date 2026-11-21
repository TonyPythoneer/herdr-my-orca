import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture() {
  const counts = { factories: 0, images: [] };
  class Node {
    constructor(kind, value) { this.kind = kind; this.value = value; this.nodes = []; }
    child(value) { this.nodes.push(value); return this; }
    children(values) { this.nodes.push(...values); return this; }
    when(condition, build) { if (condition) build(this); return this; }
    static create(kind, value) {
      const target = new Node(kind, value);
      let proxy;
      proxy = new Proxy(target, {
        get(target, key) { return key in target ? target[key] : () => proxy; },
      });
      return proxy;
    }
  }
  const make = kind => (...args) => { counts.factories++; return Node.create(kind, args[0]); };
  const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export default class Spaces', 'class Spaces');
  const scope = {
    View: class {}, div: make('div'), h_flex: make('h'), v_flex: make('v'), svg: make('svg'),
    image(path) { counts.images.push(path); return Node.create('image', path); },
    spaces: () => [], agents: () => [], run() {}, openOverlay() {}, exec() {}, hc() {},
    theme: () => ({}), shared: () => null, setShared() {}, watchFolder() {}, window() {}, props: () => ({}), nextCommand() {},
    repoMark: () => null, tint: () => null, parseRemote: () => null, avatarUrlFor: () => null, ensureAvatar() {}, avatarFile: () => null,
    statusMark: status => Node.create('status', status), agentStateMark: status => Node.create('agent-status', status),
    getFolderWorkspaceRowGeometry: () => ({ surfaceInset: 0, cardContentIndent: 0 }),
    getFlushWorktreeCardPaddingLeft: () => 0, getProjectGroupHeaderPaddingLeft: () => 0,
    WORKTREE_CARD_SURFACE_MARGIN: 0, LEGACY_STATUS_LANE_WIDTH: 16,
    tip() {}, tipMark() {}, stopsInit() {}, stop: (_owner, _theme, _id, node) => node,
    focusRoot: (_owner, node) => node, enter() {}, within: () => false, onStop() {},
    parseWorktreeList() {}, place: w => w.folder, where() {}, base: () => 'repo', readPair() {}, foldKey() {},
    projectWorktreePlan() {}, pruneGitCache() {}, agentsByRow() {}, otherTabs: (row, agents) => (row.w.tabs ?? []).filter(t => !agents.some(a => a.tab === t.id)), activeReviewKeys() {}, planRenderRows() {},
    STATUS_RANK: { blocked: 4, working: 3, done: 2, idle: 1 },
    loadReviewCache() {}, saveReviewCache() {}, isReviewFresh() {}, MAX_INFLIGHT_PR_LOOKUPS: 1, BRANCH_PR_LOOKUP_PAGE_SIZE: 1,
  };
  const cards = readFileSync(new URL('./cards.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '').replace('export function', 'function');
  vm.runInNewContext(cards + source + '\nglobalThis.Spaces = Spaces;', scope);
  const owner = new scope.Spaces();
  Object.assign(owner, {
    expandedAgents: new Set(), unread: new Set(), reviewOf: () => null,
    toggleAgents() {}, notify() {}, toggleUnread() {}, menu() {},
  });
  const render = (mine, tabs = []) => {
    counts.factories = 0;
    counts.images = [];
    const node = owner.card({ w: { id: 'w', name: 'workspace', status: 'idle', tabs }, g: { branch: 'branch', linked: false } },
      { chrome: '#000', foreground: '#fff', muted: '#aaa', dim: '#888', hover: '#333' }, [], mine);
    return { node, factories: counts.factories, images: [...counts.images] };
  };
  return { owner, render };
}

function agent(i, app = 'unknown', icon = null) {
  return { address: `pane-${i}`, status: 'working', title: `agent-${i}`, app, program: icon ? { icon } : {} };
}

function strings(node, result = []) {
  if (typeof node === 'string') result.push(node);
  if (node && typeof node === 'object') for (const child of node.nodes ?? []) strings(child, result);
  return result;
}

function nodesOfKind(node, kind, result = []) {
  if (node?.kind === kind) result.push(node);
  if (node && typeof node === 'object') for (const child of node.nodes ?? []) nodesOfKind(child, kind, result);
  return result;
}

test('collapsed cards bound work by visible icons, even for large agent groups', () => {
  const { render } = fixture();
  const ten = render(Array.from({ length: 10 }, (_, i) => agent(i, 'unknown', `icon-${i}.png`)));
  const thousand = render(Array.from({ length: 1000 }, (_, i) => agent(i, 'unknown', `icon-${i}.png`)));
  assert.equal(thousand.factories, ten.factories);
  assert.deepEqual(thousand.images, ten.images);
  assert.equal(thousand.images.length, 3);
});

test('collapsed clusters choose the first three valid icons and skip agents without icons', () => {
  const { render } = fixture();
  const result = render([
    agent(0), agent(1), agent(2), agent(3, 'unknown', 'first.svg'),
    agent(4, 'unknown', 'second.svg'), agent(5, 'unknown', 'third.svg'), agent(6, 'unknown', 'fourth.svg'),
  ]);
  assert.deepEqual(result.images, ['first.svg', 'second.svg', 'third.svg']);
});

test('mixed-state summary keeps state order, bounds each icon cluster, and counts hidden states without filtering mine', () => {
  const { render } = fixture();
  const mine = [
    agent(0, 'unknown', 'b1.png'), agent(1, 'unknown', 'b2.png'), agent(2, 'unknown', 'b3.png'), agent(3, 'unknown', 'b4.png'),
    agent(4, 'unknown', 'w0.png'), agent(5, 'unknown', 'w1.png'), agent(6, 'unknown', 'w2.png'), agent(7, 'unknown', 'w3.png'),
    agent(8, 'unknown', 'd0.png'), agent(9, 'unknown', 'd1.png'), agent(10, 'unknown', 'd2.png'), agent(11, 'unknown', 'd3.png'),
    agent(12, 'unknown', 'i0.png'), agent(13, 'unknown', 'i1.png'), agent(14, 'unknown', 'i2.png'), agent(15, 'unknown', 'i3.png'),
    agent(16, 'unknown', 'x0.png'), agent(17, 'unknown', 'x1.png'),
  ];
  for (let i = 0; i < 4; i++) mine[i].status = 'blocked';
  for (let i = 4; i < 8; i++) mine[i].status = 'working';
  for (let i = 8; i < 12; i++) mine[i].status = 'done';
  for (let i = 12; i < 16; i++) mine[i].status = 'idle';
  for (let i = 16; i < 18; i++) mine[i].status = 'queued';
  const noFilterMine = new Proxy(mine, {
    get(target, key) {
      if (key === 'filter' || key === 'map') throw new Error('collapsed summary must not map or filter the full agent list');
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const result = render(noFilterMine);
  assert.deepEqual(result.images, [
    'b1.png', 'b2.png', 'b3.png',
    'w0.png', 'w1.png', 'w2.png',
    'd0.png', 'd1.png', 'd2.png',
  ]);
  assert.deepEqual(nodesOfKind(result.node, 'agent-status').map(node => node.value), ['blocked', 'working', 'done']);
  assert.deepEqual(strings(result.node).filter(text => /^\+\d+$/.test(text)), ['+1', '+1', '+1', '+4']);
});

test('expanded list shows every agent row with a singular or plural label', () => {
  const { owner, render } = fixture();
  owner.expandedAgents.add('w');
  const single = strings(render([agent(0)]).node);
  assert.deepEqual(['1 agent', 'agent-0'].filter(x => !single.includes(x)), []);
  owner.expandedAgents.delete('w');

  const mine = Array.from({ length: 5 }, (_, i) => agent(i));
  owner.expandedAgents.add('w');
  const expanded = render(mine);
  assert.ok(strings(expanded.node).includes('5 agents'));
  for (let i = 0; i < mine.length; i++) assert.ok(strings(expanded.node).includes(`agent-${i}`));
});

test('a lone agent is a collapsed list; other tabs are only counted, never listed', () => {
  const { render } = fixture();
  const tab = { id: 't1', name: '1' };
  const lone = strings(render([agent(0)], [tab]).node);
  assert.ok(lone.includes('1 other tab') && !lone.includes('agent-0') && !lone.includes('1'));
  const header = nodesOfKind(render([agent(0)], [tab]).node, 'h').find(n => n.nodes.some(c => c?.kind === 'svg') && strings(n).includes('1 other tab'));
  assert.ok(header, 'the count sits in the same row as the agents header');
  assert.ok(strings(render([], [tab, { id: 't2', name: '2' }]).node).includes('2 other tabs'));
  assert.equal(strings(render([agent(0)], []).node).some(x => x.includes('other tab')), false);
});
