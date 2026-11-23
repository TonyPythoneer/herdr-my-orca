import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { closeSideTabs } from './close-sides.js';

const owner = { tabs: [{ id: 'a' }, { id: 'b' }, { id: 'c', settled: true }, { id: 'd' }] };

test('right closes the tabs after the target, left the ones before it', () => {
  assert.deepEqual(closeSideTabs(owner, 'b', 'right'), ['d']);
  assert.deepEqual(closeSideTabs(owner, 'b', 'left'), ['a']);
});

test('pinned tabs are left open on either side', () => {
  assert.deepEqual(closeSideTabs(owner, 'd', 'left'), ['a', 'b']);
  assert.deepEqual(closeSideTabs(owner, 'a', 'right'), ['b', 'd']);
});

test('the first and last tab have no row on the empty side', () => {
  assert.deepEqual(closeSideTabs(owner, 'a', 'left'), []);
  assert.deepEqual(closeSideTabs(owner, 'd', 'right'), []);
  // Only a pinned tab on that side is the same as nothing to close.
  assert.deepEqual(closeSideTabs({ tabs: [{ id: 'a' }, { id: 'b', settled: true }] }, 'a', 'right'), []);
});

test('a tab that is not in the list closes nothing', () => {
  assert.deepEqual(closeSideTabs(owner, 'gone', 'right'), []);
  assert.deepEqual(closeSideTabs(undefined, 'a', 'right'), []);
});
