import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { selectTabPanes } from './tab-panes.js';

test('each tab uses its first agent pane, or its first pane when no agent exists', () => {
  const panes = [
    { tab: 'a', id: 1, program: { shell: true } },
    { tab: 'a', id: 2, program: { agent: true } },
    { tab: 'a', id: 3, program: { agent: true } },
    { tab: 'b', id: 4 },
    { tab: 'b', id: 5 },
  ];
  const selected = selectTabPanes(panes);
  assert.equal(selected.get('a').id, 2);
  assert.equal(selected.get('b').id, 4);
  assert.equal(selected.get('missing'), undefined);
});
