import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { closePlan } from './close-plan.js';

const space = (id, tabs, folder = `/repo/${id}`) => ({
  id,
  folder,
  tabs: tabs.map((t) => (typeof t === 'string' ? { id: t, settled: false } : t)),
});

test('a space losing every tab gets a fresh one before the closes', () => {
  assert.deepEqual(closePlan([space('a', ['1', '2'])], ['1', '2']), [
    ['tab.new', { space: 'a', folder: '/repo/a', focus: false }],
    ['tab.close', { id: '1' }],
    ['tab.close', { id: '2' }],
  ]);
});

test('a pinned tab left behind keeps the space, so no fresh tab is made', () => {
  const s = space('a', ['1', { id: '2', settled: true }]);
  assert.deepEqual(closePlan([s], ['1']), [['tab.close', { id: '1' }]]);
});

test('closing others (one tab kept) needs no fresh tab', () => {
  assert.deepEqual(closePlan([space('a', ['1', '2', '3'])], ['2', '3']), [
    ['tab.close', { id: '2' }],
    ['tab.close', { id: '3' }],
  ]);
});

test('two emptied spaces each get their own fresh tab, before any close', () => {
  const spaces = [space('a', ['1', '2']), space('b', ['3'])];
  assert.deepEqual(closePlan(spaces, ['1', '2', '3']), [
    ['tab.new', { space: 'a', folder: '/repo/a', focus: false }],
    ['tab.new', { space: 'b', folder: '/repo/b', focus: false }],
    ['tab.close', { id: '1' }],
    ['tab.close', { id: '2' }],
    ['tab.close', { id: '3' }],
  ]);
});

test('a space with no folder omits it', () => {
  const s = { id: 'a', tabs: [{ id: '1', settled: false }] };
  assert.deepEqual(closePlan([s], ['1'])[0], ['tab.new', { space: 'a', focus: false }]);
});

test('an id no space owns is still closed', () => {
  assert.deepEqual(closePlan([space('a', ['1'])], ['gone']), [['tab.close', { id: 'gone' }]]);
});

test('duplicate ids are closed once', () => {
  assert.deepEqual(closePlan([space('a', ['1', '2'])], ['1', '1', '2']), [
    ['tab.new', { space: 'a', folder: '/repo/a', focus: false }],
    ['tab.close', { id: '1' }],
    ['tab.close', { id: '2' }],
  ]);
});

test('an empty list gives no commands', () => {
  assert.deepEqual(closePlan([space('a', ['1'])], []), []);
  assert.deepEqual(closePlan(undefined, undefined), []);
});
