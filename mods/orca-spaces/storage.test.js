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

test('failed tab color persistence does not mutate the cached fallback', async () => {
  const source = await readFile(new URL('../orca-menu/main.js', import.meta.url), 'utf8');
  const helper = source.slice(source.indexOf('const _storedCache ='), source.indexOf('\n// Where a space is:'));
  const method = source.slice(source.indexOf('  setTabColor(tabId, color) {'), source.indexOf('\n  render(cx) {'));
  const storage = { getItem: () => '{"old":"blue"}', setItem: () => { throw Error('disk full'); } };
  const make = new Function('localStorage', 'shared', 'setShared', 'props', 'closeOverlay', `${helper}\nreturn { stored, ${method} };`);
  const view = make(storage, () => null, () => {}, () => ({}), () => {});
  view.setTabColor('new', 'red');
  assert.deepEqual(view.stored('tab.colors.v1', {}), { old: 'blue' });
});
