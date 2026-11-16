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
    statusMark: () => Node.create('status'), agentStateMark: () => Node.create('agent-status'),
    getFolderWorkspaceRowGeometry: () => ({ surfaceInset: 0, cardContentIndent: 0 }),
    getFlushWorktreeCardPaddingLeft: () => 0, getProjectGroupHeaderPaddingLeft: () => 0,
    WORKTREE_CARD_SURFACE_MARGIN: 0, LEGACY_STATUS_LANE_WIDTH: 16,
    tip() {}, tipMark() {}, stopsInit() {}, stop: (_owner, _theme, _id, node) => node,
    focusRoot: (_owner, node) => node, enter() {}, within: () => false, onStop() {},
    parseWorktreeList() {}, place: w => w.folder, where() {}, base: () => 'repo', readPair() {}, foldKey() {},
    projectWorktreePlan() {}, pruneGitCache() {}, agentsByRow() {}, activeReviewKeys() {}, planRenderRows() {},
    STATUS_RANK: { blocked: 4, working: 3, done: 2, idle: 1 },
    loadReviewCache() {}, saveReviewCache() {}, isReviewFresh() {}, MAX_INFLIGHT_PR_LOOKUPS: 1, BRANCH_PR_LOOKUP_PAGE_SIZE: 1,
  };
  vm.runInNewContext(source + '\nglobalThis.Spaces = Spaces;', scope);
  const owner = new scope.Spaces();
  Object.assign(owner, {
    expandedAgents: new Set(), unread: new Set(), reviewOf: () => null,
    toggleAgents() {}, notify() {}, toggleUnread() {}, menu() {},
  });
  const render = mine => {
    counts.factories = 0;
    counts.images = [];
    const node = owner.card({ w: { id: 'w', name: 'workspace', status: 'idle', tabs: [] }, g: { branch: 'branch', linked: false } },
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

test('single agent uses its row and expanded summary includes every agent row', () => {
  const { owner, render } = fixture();
  const single = render([agent(0)]);
  assert.ok(strings(single.node).includes('agent-0'));
  assert.ok(!strings(single.node).includes('1 agents'));

  const mine = Array.from({ length: 5 }, (_, i) => agent(i));
  owner.expandedAgents.add('w');
  const expanded = render(mine);
  assert.ok(strings(expanded.node).includes('5 agents'));
  for (let i = 0; i < mine.length; i++) assert.ok(strings(expanded.node).includes(`agent-${i}`));
});
