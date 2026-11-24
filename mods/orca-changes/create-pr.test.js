import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareCreatePr, createPr } from './create-pr.js';

function fixture() {
  const state = { branch: 'feature/a', oid: 'abc123', url: 'git@github.com:owner/repo.git', head: 'abc123', base: 'main', calls: [] };
  const git = async (args) => {
    let stdout;
    if (args[0] === 'symbolic-ref') stdout = `refs/heads/${state.branch}\n`;
    else if (args[0] === 'rev-parse') stdout = `${state.oid}\n`;
    else if (args[0] === 'config' && args.at(-1).endsWith('.remote')) stdout = 'origin\0';
    else if (args[0] === 'config') stdout = `refs/heads/${state.branch}\0`;
    else if (args[0] === 'remote') stdout = `${state.url}\n`;
    else throw Error(`unexpected git: ${args}`);
    return { code: 0, stdout };
  };
  const gh = async (args) => {
    state.calls.push(args);
    const query = args.find(x => x.startsWith('query='));
    const data = query.includes('mutation(')
      ? { createPullRequest: { pullRequest: { number: 42, url: 'https://github.com/owner/repo/pull/42' } } }
      : { repository: { id: 'node-id', nameWithOwner: 'owner/repo', isArchived: false, isFork: false,
        defaultBranchRef: { name: state.base, target: { oid: 'baseoid' } }, ref: { name: state.branch, prefix: 'refs/heads/', target: { oid: state.head } } } };
    return { code: 0, stdout: JSON.stringify({ data }) };
  };
  return { state, git, gh };
}

test('creates an already-pushed branch PR in the captured repository without invoking push', async () => {
  const f = fixture(), snapshot = await prepareCreatePr(f.git, f.gh);
  const pr = await createPr({ snapshot, git: f.git, gh: f.gh, current: () => true, title: 'A title', body: 'body', draft: true });
  assert.equal(pr.number, 42);
  const mutation = f.state.calls.at(-1);
  assert.ok(mutation.includes('repo=node-id')); assert.ok(mutation.includes('head=feature/a'));
  assert.ok(mutation.includes('base=main')); assert.ok(mutation.includes('draft=true'));
});

test('refuses unpushed branches, changed context, changed target and unsafe remote URLs', async () => {
  const f = fixture(), snapshot = await prepareCreatePr(f.git, f.gh);
  await assert.rejects(createPr({ snapshot, git: f.git, gh: f.gh, current: () => false, title: 'x', body: '', draft: false }), /Workspace changed/);
  f.state.head = 'other';
  await assert.rejects(createPr({ snapshot, git: f.git, gh: f.gh, current: () => true, title: 'x', body: '', draft: false }), /Push the current commit/);
  f.state.head = f.state.oid; f.state.base = 'other';
  await assert.rejects(createPr({ snapshot, git: f.git, gh: f.gh, current: () => true, title: 'x', body: '', draft: false }), /changed/);
  f.state.url = 'https://token@github.com/owner/repo';
  await assert.rejects(prepareCreatePr(f.git, f.gh), /without credentials/);
  assert.equal(f.state.calls.filter(args => args.some(x => x.includes('mutation('))).length, 0);
});
