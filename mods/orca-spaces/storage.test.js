import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

test('spaces instances do not share mutable cached state', async () => {
  const source = await readFile(new URL('./main.js', import.meta.url), 'utf8');
  const git = source.match(/    this\.git = [^\n]+;/)[0];
  const reconnecting = source.match(/    this\.reconnecting = [^\n]+;\n    for \(const state[^\n]+/)[0];
  const cache = { 'git.cache.v2': { a: null }, 'machines.reconnecting': { remote: { busy: true } } };
  const initialize = new Function('stored', `${git}\n${reconnecting}`);
  const first = {}, second = {};
  initialize.call(first, key => cache[key]);
  initialize.call(second, key => cache[key]);
  first.git.a = { repo: 'new' };
  first.reconnecting.remote.busy = true;
  assert.equal(second.git.a, null);
  assert.equal(second.reconnecting.remote.busy, false);
});

test('stored reads and workspace options invalidate when another mod writes', async () => {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null };
  const view = await import('./storage.js');
  const initial = view.workspaceOptions();
  assert.equal(view.workspaceOptions(), initial);
  values.set('workspace.options.v1', '{"groupBy":"none"}');
  assert.equal(view.workspaceOptions().groupBy, 'none');
  assert.notEqual(view.workspaceOptions(), initial);
  values.set('projects.saved.v1', '["/one"]');
  assert.deepEqual(view.stored('projects.saved.v1', []), ['/one']);
  values.set('projects.saved.v1', '["/two"]');
  assert.deepEqual(view.stored('projects.saved.v1', []), ['/two']);
  values.delete('workspace.options.v1');
  assert.equal(view.workspaceOptions().groupBy, 'repo');
});
