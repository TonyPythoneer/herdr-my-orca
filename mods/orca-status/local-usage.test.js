// Tests for the live Claude path in mods/orca-status/local-usage.js.
// Source of the shape: Orca's claude-statusline-rate-limits.ts (see NOTICE).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeStatusLine, formatTokens } from './local-usage.js';

const future = () => Math.floor(Date.now() / 1000) + 3600;

test('parseClaudeStatusLine reads the 5h and weekly windows', () => {
  const resets = future();
  const reading = parseClaudeStatusLine({
    five_hour: { used_percentage: 42.4, resets_at: resets },
    seven_day: { used_percentage: 7, resets_at: resets }
  });
  assert.equal(reading.provider, 'claude');
  assert.equal(reading.status, 'ok');
  assert.deepEqual(reading.buckets.map((b) => b.label), ['5h', 'wk']);
  assert.deepEqual(reading.buckets.map((b) => b.usedPercent), [42, 7]);
  assert.equal(reading.buckets[0].windowMinutes, 300);
  assert.equal(reading.buckets[1].windowMinutes, 10080);
  assert.equal(reading.buckets[0].resetTime, new Date(resets * 1000).toISOString());
});

test('parseClaudeStatusLine accepts utilization, like Orca tolerates schema drift', () => {
  const reading = parseClaudeStatusLine({ five_hour: { utilization: 88 } });
  assert.deepEqual(reading.buckets.map((b) => [b.label, b.usedPercent, b.resetTime]), [['5h', 88, null]]);
});

test('parseClaudeStatusLine keeps one window when the other is absent', () => {
  const reading = parseClaudeStatusLine({ seven_day: { used_percentage: 12, resets_at: future() } });
  assert.deepEqual(reading.buckets.map((b) => b.label), ['wk']);
});

test('parseClaudeStatusLine keeps the reported percentage after a window resets', () => {
  const reading = parseClaudeStatusLine({ five_hour: { used_percentage: 90, resets_at: 1 } });
  assert.equal(reading.buckets[0].usedPercent, 90);
  assert.equal(reading.buckets[0].resetTime, '1970-01-01T00:00:01.000Z');
});

test('parseClaudeStatusLine reads resets_at in seconds, milliseconds or ISO', () => {
  const at = Math.floor((Date.now() + 3600_000) / 1000) * 1000;
  const iso = new Date(at).toISOString();
  for (const resets_at of [at / 1000, at, iso]) {
    const reading = parseClaudeStatusLine({ five_hour: { used_percentage: 5, resets_at } });
    assert.equal(reading.buckets[0].resetTime, iso, String(resets_at));
  }
});

test('parseClaudeStatusLine returns null without usable windows', () => {
  assert.equal(parseClaudeStatusLine(null), null);
  assert.equal(parseClaudeStatusLine({}), null);
  assert.equal(parseClaudeStatusLine({ five_hour: {} }), null);
});

test('parseClaudeStatusLine clamps out-of-range percentages', () => {
  const reading = parseClaudeStatusLine({ five_hour: { used_percentage: 140 } });
  assert.equal(reading.buckets[0].usedPercent, 100);
});

test('formatTokens keeps the bar short', () => {
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(1500), '2k');
  assert.equal(formatTokens(2400000), '2.4M');
});
