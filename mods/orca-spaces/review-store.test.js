import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

for (const mod of ['orca-spaces']) {
  test(`${mod} review cache keeps the 200 most recently refreshed entries`, async () => {
    const source = await readFile(new URL(`../${mod}/review-store.js`, import.meta.url), 'utf8');
    let sharedValue;
    let activeKeys = [];
    const saved = new Map();
    globalThis.__reviewTest = {
      shared: key => key === 'pr.active.v1' ? activeKeys : sharedValue,
      setShared: (_key, value) => { sharedValue = value; },
    };
    globalThis.localStorage = {
      getItem: key => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
    };
    try {
      const code = source.replace('import { shared, setShared } from "herdr";', 'const { shared, setShared } = globalThis.__reviewTest;');
      const store = await import(`data:text/javascript;base64,${Buffer.from(code + `\n// ${mod}`).toString('base64')}`);
      const cache = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [String(i), { at: i, data: null }]));
      store.saveReviewCache(cache);
      assert.equal(Object.keys(cache).length, 200);
      assert.equal(cache['4'], undefined);
      assert.equal(cache['5'].at, 5);
      assert.deepEqual(JSON.parse(saved.get('pr.cache.v2')), cache);
      assert.equal(sharedValue, cache);
      assert.equal(store.isReviewFresh({ at: 100, data: null }, 101), true);
      const busy = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`active-${i}`, { at: i, data: null }]));
      busy.stale = { at: -1, data: null };
      activeKeys = Object.keys(busy).filter(k => k !== 'stale');
      store.saveReviewCache(busy);
      assert.equal(Object.keys(busy).length, 205);
      assert.ok(activeKeys.every(k => k in busy));
      assert.equal(busy.stale, undefined);
      activeKeys = [];
      for (const entry of Object.values(busy)) entry.at = Date.now();
      store.saveReviewCache(busy);
      assert.equal(Object.keys(busy).length, 205);
      for (const entry of Object.values(busy)) entry.at = 0;
      store.saveReviewCache(busy);
      assert.equal(Object.keys(busy).length, 200);
    } finally {
      delete globalThis.__reviewTest;
      delete globalThis.localStorage;
    }
  });
}

test('spaces adopts shared invalidations and evictions without restoring old entries', async () => {
  const source = await readFile(new URL('./main.js', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('  reviewCache() {'), source.indexOf('\n  // `readWorkspaceReviewPR`'));
  let sharedValue = { retained: { at: 2 } };
  const view = { prCache: { retained: { at: 1 }, removed: { at: 1 } }, lastSharedPrCache: null };
  const sync = new Function('shared', `return ({ ${method} }).reviewCache`)(() => sharedValue);
  assert.deepEqual(sync.call(view), sharedValue);
  assert.equal('removed' in view.prCache, false);
});

test('spaces merges a completed lookup into the latest shared cache', async () => {
  const source = await readFile(new URL('./main.js', import.meta.url), 'utf8');
  const syncMethod = source.slice(source.indexOf('  reviewCache() {'), source.indexOf('\n  // `readWorkspaceReviewPR`'));
  const writeMethod = source.slice(source.indexOf('  setPr(key, data) {'), source.indexOf('\n  menu(w, g) {'));
  const sharedValue = { other: { at: 1, data: null } };
  let saved;
  const view = new Function('shared', 'saveReviewCache', `return { ${syncMethod}, ${writeMethod} }`)(() => sharedValue, cache => { saved = cache; });
  view.prCache = {};
  view.lastSharedPrCache = null;
  view.setPr('new', null);
  assert.ok(saved.other);
  assert.equal(saved.new.data, null);
});

test('more than 200 visible branches retain their cooldown across repeated ticks', async () => {
  const source = await readFile(new URL('./main.js', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('  settleRows(cx) {'), source.indexOf('\n  // `worktree-card-agents-expansion-state', source.indexOf('  settleRows(cx) {')));
  const { activeReviewKeys, readPair } = await import('./worktree-plan.js');
  const state = new Map();
  globalThis.__reviewTest = { shared: key => state.get(key), setShared: (key, value) => state.set(key, value) };
  globalThis.localStorage = { setItem() {} };
  try {
    const storeSource = await readFile(new URL('./review-store.js', import.meta.url), 'utf8');
    const code = storeSource.replace('import { shared, setShared } from "herdr";', 'const { shared, setShared } = globalThis.__reviewTest;');
    const store = await import(`data:text/javascript;base64,${Buffer.from(code + '\n// pacing-test').toString('base64')}`);
    const repo = JSON.stringify([null, '/repo/.git']);
    const rows = Array.from({ length: 205 }, (_, i) => ({ w: {}, g: { repo, branch: `b${i}` } }));
    const cache = Object.fromEntries(rows.map(r => [`/repo/.git::${r.g.branch}`, { at: Date.now(), data: null }]));
    let lookups = 0;
    const view = { ordered: () => rows, prAsking: new Set(), reviewCache: () => cache, lookupPRByBranch: () => { lookups++; } };
    const tick = new Function('activeReviewKeys', 'setShared', 'readPair', 'isReviewFresh', 'MAX_INFLIGHT_PR_LOOKUPS', `return ({ ${method} }).settleRows`)(activeReviewKeys, globalThis.__reviewTest.setShared, readPair, store.isReviewFresh, 2);
    tick.call(view, {});
    store.saveReviewCache(cache);
    tick.call(view, {});
    assert.equal(Object.keys(cache).length, 205);
    assert.equal(lookups, 0);
  } finally {
    delete globalThis.__reviewTest;
    delete globalThis.localStorage;
  }
});
