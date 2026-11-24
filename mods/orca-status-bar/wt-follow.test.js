import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { isLinked, parseCheckout, planFollow } from './wt-follow.js';

// The two shapes `git rev-parse --path-format=absolute --show-toplevel --git-dir
// --git-common-dir --abbrev-ref HEAD` prints, read off this repo and one of its worktrees.
const main = ['/Users/t/repo', '/Users/t/repo/.git', '/Users/t/repo/.git', 'main'].join('\n');
const linked = ['/Users/t/wt/foo', '/Users/t/repo/.git/worktrees/foo', '/Users/t/repo/.git', 'feature/foo'].join('\n');

const repo = parseCheckout(main);
const wt = parseCheckout(linked);

const space = (id, folder, checkout, { active = true, machine = null, tab = `tab-${id}` } = {}) => ({
  id, folder, checkout, machine, active,
  tabs: [{ id: tab, name: '1', named: false, active }],
});
const agent = (terminal, tab, extra = {}) => ({ terminal, tab, program: { agent: true, name: 'Claude Code' }, ...extra });

test('a main checkout and a linked worktree are told apart', () => {
  assert.deepEqual(repo, { top: '/Users/t/repo', gitdir: '/Users/t/repo/.git', common: '/Users/t/repo/.git', branch: 'main' });
  assert.deepEqual(wt, { top: '/Users/t/wt/foo', gitdir: '/Users/t/repo/.git/worktrees/foo', common: '/Users/t/repo/.git', branch: 'feature/foo' });
  assert.equal(isLinked(repo), false);
  assert.equal(isLinked(wt), true);
  assert.equal(isLinked(null), false);
  assert.equal(parseCheckout(''), null);
  assert.equal(parseCheckout('fatal: not a git repository'), null);
});

test('an agent that moved into a worktree takes its tab there', () => {
  const move = planFollow({
    spaces: [space('s1', '/Users/t/repo', repo)],
    panes: [agent('t1', 'tab-s1')],
    cwds: { t1: '/Users/t/wt/foo' },
    cwdCheckouts: { '/Users/t/wt/foo': wt },
  });
  assert.deepEqual(move, {
    terminal: 't1', app: 'Claude Code', to: '/Users/t/wt/foo', branch: 'feature/foo',
    from: { space: 's1', folder: '/Users/t/repo', tab: 'tab-s1', active: true, tabName: null, onlyTerminal: true },
  });
});

test('a space on a worktree keeps the tab when the agent stays in it', () => {
  assert.equal(planFollow({
    spaces: [space('s2', '/Users/t/wt/foo', wt)],
    panes: [agent('t1', 'tab-s2')],
    cwds: { t1: '/Users/t/wt/foo' },
    cwdCheckouts: { '/Users/t/wt/foo': wt },
  }), null);
});

test('the shell next to the agent, a plain folder, another repo and another machine stay put', () => {
  const other = parseCheckout(['/Users/t/other/wt', '/Users/t/other/.git/worktrees/wt', '/Users/t/other/.git', 'x'].join('\n'));
  const base = { spaces: [space('s1', '/Users/t/repo', repo)], cwds: { t1: '/Users/t/wt/foo' }, cwdCheckouts: { '/Users/t/wt/foo': wt } };
  // a shell (no agent program) is not the tab that follows
  assert.equal(planFollow({ ...base, panes: [{ terminal: 't1', tab: 'tab-s1', program: { agent: false } }] }), null);
  // the agent's program is still in the space's own checkout
  assert.equal(planFollow({ ...base, panes: [agent('t1', 'tab-s1')], cwds: { t1: '/Users/t/repo' }, cwdCheckouts: { '/Users/t/repo': repo } }), null);
  // a worktree of a different repository
  assert.equal(planFollow({ ...base, panes: [agent('t1', 'tab-s1')], cwdCheckouts: { '/Users/t/wt/foo': other } }), null);
  // a space on another machine
  assert.equal(planFollow({ ...base, spaces: [space('s1', '/Users/t/repo', repo, { machine: 'vps' })], panes: [agent('t1', 'tab-s1')] }), null);
  // nothing read yet
  assert.equal(planFollow({ ...base, panes: [agent('t1', 'tab-s1')], cwds: { t1: null }, cwdCheckouts: { null: null } }), null);
});

test('a terminal already sent to that worktree does not move again', () => {
  assert.equal(planFollow({
    spaces: [space('s1', '/Users/t/repo', repo)],
    panes: [agent('t1', 'tab-s1')],
    cwds: { t1: '/Users/t/wt/foo' },
    cwdCheckouts: { '/Users/t/wt/foo': wt },
    moved: { t1: '/Users/t/wt/foo' },
  }), null);
});

test('a named tab keeps its name; a shared tab keeps its space alive', () => {
  const s = space('s1', '/Users/t/repo', repo);
  s.tabs[0].named = true;
  s.tabs[0].name = 'fix login';
  const move = planFollow({
    spaces: [s],
    panes: [agent('t1', 'tab-s1'), agent('t2', 'tab-s1')],
    cwds: { t1: '/Users/t/wt/foo', t2: '/Users/t/repo' },
    cwdCheckouts: { '/Users/t/wt/foo': wt, '/Users/t/repo': repo },
  });
  assert.equal(move.from.tabName, 'fix login');
  // t2 is not in a worktree, but it is in the same tab: parking t1 leaves the tab and its space.
  assert.equal(move.from.onlyTerminal, false);
});
