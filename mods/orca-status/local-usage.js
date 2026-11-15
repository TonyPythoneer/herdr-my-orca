// Codex and opencode for the bar, from files on this computer (no network):
//   Codex     the last rate_limits in its newest session file
//   opencode  no limits: the last 24 hours' tokens from its database
// Same reading shape as usage.js; `text` is a chip with no percentage.
import { clampUsedPercent } from './usage.js';

const CODEX = `f=$(ls -t "$HOME"/.codex/sessions/*/*/*/*.jsonl 2>/dev/null | head -n 1); [ -n "$f" ] || exit 0
grep '"primary":{' "$f" | tail -n 1 | jq -c '.. | objects | select(has("rate_limits")) | .rate_limits | select(.primary) | {primary, secondary}' 2>/dev/null`;
// opencode's tokens since its last reset, which it says is about 8:47 AM; 9:00 local is ours.
const OPENCODE_RESET_HOUR = 9;
const OPENCODE = `sqlite3 -readonly "$HOME/.local/share/opencode/opencode.db" "
with w(s) as (select strftime('%s', datetime('now','localtime','-${OPENCODE_RESET_HOUR} hours','start of day','+${OPENCODE_RESET_HOUR} hours','utc')))
select coalesce(sum(json_extract(data,'$.tokens.input')+json_extract(data,'$.tokens.output')+json_extract(data,'$.tokens.reasoning')),0), s+86400
from session_message, w where type='assistant' and time_created >= s*1000" 2>/dev/null`;

export const formatTokens = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`;

const sh = async (execFn, script) => {
  try {
    const r = await execFn('sh', ['-c', script], { timeout: 20000 });
    return r?.code === 0 ? r.stdout.trim() : '';
  } catch {
    return '';
  }
};
const json = (text) => {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
};

// A window whose reset has passed shows 0, as the saved number is from before it.
const bucket = (id, windowMinutes, usedPercent, resetsAtSec, label) => ({
  id, name: '', label, windowMinutes,
  usedPercent: resetsAtSec && resetsAtSec * 1000 <= Date.now() ? 0 : clampUsedPercent(usedPercent),
  resetTime: resetsAtSec ? new Date(resetsAtSec * 1000).toISOString() : null
});
const reading = (provider, buckets) => buckets.length
  ? { provider, status: 'ok', label: '', buckets } : null;

export async function probeLocal(execFn) {
  const [x, o] = await Promise.all([CODEX, OPENCODE].map((s) => sh(execFn, s)));
  const codex = json(x);
  const [tokens, resetAt] = o.split('|').map(Number);
  const out = [
    // Codex reports the windows its plan has: both for Plus and Pro, so both are shown.
    codex && reading('codex', [codex.primary, codex.secondary].filter(Boolean)
      .map((w) => bucket(String(w.window_minutes), w.window_minutes, w.used_percent, w.resets_at, w.window_minutes === 300 ? '5h' : w.window_minutes === 10080 ? 'wk' : `${w.window_minutes}m`))),
    Number.isFinite(tokens) && Number.isFinite(resetAt) && {
      provider: 'opencode', status: 'ok', label: '', buckets: [], text: `${formatTokens(tokens)} tokens`, resetTime: new Date(resetAt * 1000).toISOString()
    }
  ];
  return out.filter(Boolean).map((r) => ({ ...r, detail: true }));
}
