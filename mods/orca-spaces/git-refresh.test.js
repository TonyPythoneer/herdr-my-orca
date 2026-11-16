import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { base, parseWorktreeList, readPair } from './worktree-plan.js';

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
