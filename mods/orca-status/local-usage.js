// Claude, Codex and opencode for the bar, from files on this computer (no network):
//   Claude    Anthropic's oauth/usage (has per-model windows such as Fable; token from the macOS
//             keychain, never written anywhere), kept 5 minutes in ~/.cache/herdr-usage/claude-oauth.json
//   Codex     the last rate_limits in its newest session file
//   opencode  no limits: the last 24 hours' tokens from its database
// Same reading shape as usage.js; `text` is a chip with no percentage.
import { clampUsedPercent } from './usage.js';

const CLAUDE = `d="$HOME/.cache/herdr-usage"; mkdir -p "$d"; c="$d/claude-oauth.json"
if [ -z "$(find "$c" -mmin -5 2>/dev/null)" ]; then
  tok=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null)
  [ -n "$tok" ] && curl -sSf -m 10 https://api.anthropic.com/api/oauth/usage -H "Authorization: Bearer $tok" -H "anthropic-beta: oauth-2025-04-20" > "$c.tmp" 2>/dev/null && mv "$c.tmp" "$c" || rm -f "$c.tmp" "$c"
fi
cat "$c" 2>/dev/null`;
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

// oauth/usage's limits: the session, the week, and a per-model week such as Fable.
const fromUsageApi = (limits) => limits.map((l) => bucket(
  l.kind, l.kind === 'session' ? 300 : 10080, l.percent, Date.parse(l.resets_at) / 1000,
  l.kind === 'session' ? '5h' : l.kind === 'weekly_all' ? 'wk' : l.scope?.model?.display_name ?? l.kind));

// Windows Claude Code reports besides 5h and the week (e.g. a per-model one): "seven_day_fable" is "Fable".
const extraClaude = (limits) => Object.entries(limits ?? {})
  .filter(([k, v]) => k !== 'five_hour' && k !== 'seven_day' && typeof v?.used_percentage === 'number')
  .map(([k, v]) => bucket(k, 10080, v.used_percentage, v.resets_at, k.replace(/^seven_day_?/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) || 'wk'));

export async function probeLocal(execFn) {
  const [c, x, o] = await Promise.all([CLAUDE, CODEX, OPENCODE].map((s) => sh(execFn, s)));
  const claude = json(c), codex = json(x);
  const [tokens, resetAt] = o.split('|').map(Number);
  const out = [
    claude && Array.isArray(claude.limits) && claude.limits[0]?.kind && reading('claude', fromUsageApi(claude.limits)),
    claude && !claude.limits?.[0]?.kind && !claude.api && !claude.bedrock && reading('claude', [
      claude.five_hour && bucket('5h', 300, claude.five_hour.used_percentage, claude.five_hour.resets_at, '5h'),
      claude.seven_day && bucket('7d', 10080, claude.seven_day.used_percentage, claude.seven_day.resets_at, 'wk'),
      ...extraClaude(claude.limits)
    ].filter(Boolean)),
    // Codex reports the windows its plan has: both for Plus and Pro, so both are shown.
    codex && reading('codex', [codex.primary, codex.secondary].filter(Boolean)
      .map((w) => bucket(String(w.window_minutes), w.window_minutes, w.used_percent, w.resets_at, w.window_minutes === 300 ? '5h' : w.window_minutes === 10080 ? 'wk' : `${w.window_minutes}m`))),
    Number.isFinite(tokens) && Number.isFinite(resetAt) && {
      provider: 'opencode', status: 'ok', label: '', buckets: [], text: `${formatTokens(tokens)} tokens`, resetTime: new Date(resetAt * 1000).toISOString()
    }
  ];
  return out.filter(Boolean).map((r) => ({ ...r, detail: true }));
}
