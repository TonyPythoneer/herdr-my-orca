import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { stripLeadingAgentTitleDecoration as strip } from './tab-title.js';

test('drops a leading status glyph', () => {
  assert.equal(strip('✳ fix bug'), 'fix bug');
  assert.equal(strip('⠋ working'), 'working');
  assert.equal(strip('* note'), 'note');
});
test('keeps glyph-only and plain titles', () => {
  assert.equal(strip('✳'), '✳');
  assert.equal(strip('plain'), 'plain');
  assert.equal(strip(undefined), undefined);
});
