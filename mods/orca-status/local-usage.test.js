// Tests for the live Claude path in mods/orca-status/local-usage.js.
// Source of the shape: Orca's claude-statusline-rate-limits.ts (see NOTICE).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeStatusLine, formatTokens, probeLocal } from './local-usage.js';

const future = () => Math.floor(Date.now() / 1000) + 3600;

// A throwaway opencode.db under a temp HOME, seeded the way opencode writes it (ms epoch in
// time_created, JSON in data), and `reading()`: the opencode chip probeLocal draws from it.
const HOUR = 3_600_000, DAY = 86_400_000;
const freeUsage = (at, tokens) => ({ at, data: { model: { providerID: 'opencode', id: 'deepseek-v4.1-flash-free' }, tokens: { input: tokens, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } } });
const freeLimit = (at, retryAfterMs) => ({ at, data: { error: { type: 'provider.free-limit', retryAfterMs } } });
const opencodeDb = async (rows) => {
  const { execFile, execFileSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const home = mkdtempSync(join(tmpdir(), 'herdr-opencode-'));
  mkdirSync(join(home, '.local/share/opencode'), { recursive: true });
  const sql = ['create table session_message (type text, time_created integer, data text);']
    .concat(rows.map(({ at, data, type = 'assistant' }) => `insert into session_message values ('${type}', ${Math.round(at)}, '${JSON.stringify(data).replace(/'/g, "''")}');`))
    .join('\n');
  execFileSync('sqlite3', [join(home, '.local/share/opencode/opencode.db')], { input: sql });
  const exec = (_c, args) => new Promise((resolve) => execFile('sh', args, { env: { ...process.env, HOME: home } }, (e, stdout) => resolve({ code: e ? 1 : 0, stdout })));
  return {
    home,
    reading: async () => (await probeLocal(exec, new Set(['opencode']))).find((r) => r.provider === 'opencode'),
    // The probe reports whole seconds (ms are dropped by the /1000), so expectations are too.
    resetTime: (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString()
  };
};
// The most recent local 9:00 at or before `now`, the fallback window start.
const lastNine = (now) => { const d = new Date(now); d.setHours(9, 0, 0, 0); return d.getTime() > now ? d.getTime() - DAY : d.getTime(); };

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

test('parseClaudeStatusLine shows an expired window as static 0% / 5h until new data', () => {
  const reading = parseClaudeStatusLine({ five_hour: { used_percentage: 90, resets_at: 1 } });
  const [five] = reading.buckets;
  assert.deepEqual([five.usedPercent, five.resetTime, five.idleText], [0, null, '5h']);
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

test('probeLocal shows an expired codex window as 0% as static 0% / 5h', async () => {
  const now = Math.floor(Date.now() / 1000);
  const codex = JSON.stringify({
    primary: { window_minutes: 300, used_percent: 34, resets_at: now - 60 },
    secondary: { window_minutes: 10080, used_percent: 68, resets_at: now + 3600 }
  });
  const exec = async (_c, [, script]) => ({ code: 0, stdout: script.includes('.codex') ? codex : '' });
  const codexReading = (await probeLocal(exec)).find((r) => r.provider === 'codex');
  const [five, week] = codexReading.buckets;
  assert.equal(five.usedPercent, 0);
  assert.equal(five.resetTime, null);
  assert.equal(five.idleText, '5h');
  assert.equal(week.idleText, undefined);
  assert.equal(week.usedPercent, 68);
});

test('Codex uses an older session until the newest has rate limits', async () => {
  const { execFile } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const home = mkdtempSync(join(tmpdir(), 'herdr-codex-'));
  try {
    const dir = join(home, '.codex/sessions/2026/11/21');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(home, '.codex/auth.json'), '{}');
    const older = join(dir, 'older.jsonl'), newer = join(dir, 'newer.jsonl');
    const limits = (used) => JSON.stringify({ rate_limits: { primary: { window_minutes: 300, used_percent: used } } });
    writeFileSync(older, limits(23) + '\n');
    writeFileSync(newer, '{}\n');
    utimesSync(older, 1, 1);
    const exec = (_c, args) => new Promise((resolve) => execFile('sh', args, { env: { ...process.env, HOME: home } }, (e, stdout) => resolve({ code: e ? 1 : 0, stdout })));
    const percentage = async () => (await probeLocal(exec, new Set(['codex'])))[0]?.buckets[0].usedPercent;
    assert.equal(await percentage(), 23);
    writeFileSync(newer, limits(45) + '\n');
    assert.equal(await percentage(), 45);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('opencode counts from the projected reset, not the 9:00 fallback or an extra day', async () => {
  const now = Math.floor(Date.now() / 1000) * 1000;
  // The cycle resets daily; this boundary passed 5h17m ago. The only 429 is 26h old, so its own
  // reset (boundary - 24h) is past the old 24h window and 9:00-local would win instead.
  const boundary = now - 5 * HOUR - 17 * 60_000;
  const db = await opencodeDb([
    freeLimit(boundary - 26 * HOUR, 2 * HOUR),
    freeUsage(boundary - 3 * HOUR, 3000),
    freeUsage(boundary - 1000, 5000),
    freeUsage(boundary, 400),
    freeUsage(boundary + 60_000, 200)
  ]);
  try {
    const reading = await db.reading();
    assert.equal(reading.text, '600 tokens', 'only rows at or after the reset count');
    assert.equal(reading.resetTime, db.resetTime(boundary + DAY));
  } finally {
    (await import('node:fs')).rmSync(db.home, { recursive: true, force: true });
  }
});

test('opencode steps the newest 429 back when its reset is still ahead', async () => {
  // Real shape: a 429 ten minutes ago whose retry lands on tomorrow's boundary.
  const now = Math.floor(Date.now() / 1000) * 1000;
  const reset = now - 10 * 60_000 + 23 * HOUR + 50 * 60_000;
  const db = await opencodeDb([
    freeLimit(now - 10 * 60_000, 23 * HOUR + 50 * 60_000),
    freeUsage(reset - DAY - 60_000, 900),
    freeUsage(reset - DAY + 60_000, 250)
  ]);
  try {
    const reading = await db.reading();
    assert.equal(reading.text, '250 tokens', 'the window starts 24h before the announced reset');
    assert.equal(reading.resetTime, db.resetTime(reset), 'next reset is the first one after now');
  } finally {
    (await import('node:fs')).rmSync(db.home, { recursive: true, force: true });
  }
});

test('opencode falls back to the most recent local 9:00 with no 429 at all', async () => {
  const now = Math.floor(Date.now() / 1000) * 1000;
  const nine = lastNine(now);
  const db = await opencodeDb([
    freeUsage(nine - HOUR, 4000),
    freeUsage(nine + Math.floor((now - nine) / 2), 700)
  ]);
  try {
    const reading = await db.reading();
    assert.equal(reading.text, '700 tokens');
    assert.equal(reading.resetTime, db.resetTime(nine + DAY));
  } finally {
    (await import('node:fs')).rmSync(db.home, { recursive: true, force: true });
  }
});

test('opencode counts compaction rows but not other row types', async () => {
  const now = Math.floor(Date.now() / 1000) * 1000;
  const boundary = now - 2 * HOUR;
  const db = await opencodeDb([
    freeLimit(boundary - DAY, 0),
    freeUsage(boundary + HOUR, 2000),
    { ...freeUsage(boundary + HOUR, 500), type: 'compaction' },
    { ...freeUsage(boundary + HOUR, 7000), type: 'user' }
  ]);
  try {
    assert.equal((await db.reading()).text, '3k tokens', '2000 + 500 compaction, not the user row');
  } finally {
    (await import('node:fs')).rmSync(db.home, { recursive: true, force: true });
  }
});

test('opencode reads inactive only for a reset window with no free-model use', async () => {
  const now = Math.floor(Date.now() / 1000) * 1000;
  const boundary = now - 2 * HOUR;
  const used = await opencodeDb([freeLimit(boundary - 26 * HOUR, 2 * HOUR), freeUsage(boundary + 60_000, 5)]);
  const fresh = await opencodeDb([freeLimit(boundary - 26 * HOUR, 2 * HOUR)]);
  const bare = await opencodeDb([]);
  try {
    assert.equal((await used.reading()).text, '5 tokens');
    const idle = await fresh.reading();
    assert.equal(idle.text, 'inactive');
    assert.equal(idle.resetTime, fresh.resetTime(boundary + DAY), 'the countdown still ends the window');
    // No 429 ever: no reset evidence, so the chip keeps its (0) count instead of claiming idle.
    assert.equal((await bare.reading()).text, '0 tokens');
  } finally {
    for (const db of [used, fresh, bare]) (await import('node:fs')).rmSync(db.home, { recursive: true, force: true });
  }
});

test('probeLocal skips providers whose CLI is not installed', async () => {
  const ran = [];
  const exec = async (_c, [, script]) => { ran.push(script.includes('.codex') ? 'codex' : script.includes('opencode') ? 'opencode' : 'claude'); return { code: 0, stdout: '' }; };
  await probeLocal(exec, new Set(['opencode']));
  assert.deepEqual(ran, ['opencode']);
});

test('the claude and codex probes print nothing when signed out', async () => {
  const { execFile } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const home = mkdtempSync(join(tmpdir(), 'herdr-login-'));
  const exec = (_c, args) => new Promise((resolve) => execFile('sh', args, { env: { HOME: home, PATH: '/usr/bin:/bin' } }, (e, stdout) => resolve({ code: e ? 1 : 0, stdout })));
  const rows = await probeLocal(exec, new Set(['claude', 'codex']));
  assert.deepEqual(rows.map((r) => r.provider), []);
});
