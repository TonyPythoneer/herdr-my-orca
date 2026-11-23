import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { closeRows } from './close-space.js';

test('one space closes with confirmed, which the host requires', () => {
  assert.deepEqual(closeRows(['w1']), [['Close workspace', 'space.close', { id: 'w1', confirmed: true }]]);
});

test('the card menu label is Close', () => {
  assert.deepEqual(closeRows(['w1'], 'Close'), [['Close', 'space.close', { id: 'w1', confirmed: true }]]);
});

test('several spaces close as a group in one command', () => {
  const rows = closeRows(['w1', 'w2']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1], 'orca-menu.close-group');
  assert.deepEqual(rows[0][2], { ids: ['w1', 'w2'] });
});

test('no space draws no row', () => {
  assert.deepEqual(closeRows([]), []);
  assert.deepEqual(closeRows(undefined), []);
  assert.deepEqual(closeRows([null]), []);
});

test('a repeated id closes once', () => {
  assert.deepEqual(closeRows(['w1', 'w1']), [['Close workspace', 'space.close', { id: 'w1', confirmed: true }]]);
});
