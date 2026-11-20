// Claude, Codex and opencode for the bar, from files on this computer (no network except
// Claude's fallback):
//   Claude    the live feed first: Claude Code's `rate_limits` for the 5h/weekly windows,
//             written per turn by claude-statusline.sh (Orca's live-session path). While a
//             session is quiet, Anthropic's oauth/usage fills in (and adds per-model windows
//             such as Fable); its token comes from the macOS keychain and is never written
//             anywhere. Both live in ~/.cache/herdr-usage/.
//   Codex     the last rate_limits in its newest session file (each turn appends one)
//   opencode  no limits: free-model tokens (replies and compactions, cache included) since its daily reset
// Same reading shape as usage.js; `text` is a chip with no percentage.
import { clampUsedPercent } from './usage.js';

// Orca's freshness split (rate-limits/service.ts): live windows gate the OAuth poll for
// MIN_REFETCH_MS = 5 minutes; the poll itself runs every 15 minutes (DEFAULT_POLL_MS).
const LIVE_FRESH_MINUTES = 5;
const OAUTH_FRESH_MINUTES = 15;

const CLAUDE = `d="$HOME/.cache/herdr-usage"; mkdir -p "$d"
s="$d/claude-statusline.json"; c="$d/claude-oauth.json"
live=null
if [ -n "$(find "$s" -mmin -${LIVE_FRESH_MINUTES} 2>/dev/null)" ]; then
  v=$(cat "$s" 2>/dev/null); [ -n "$v" ] && live=$v
fi
if [ "$live" = "null" ] && [ -z "$(find "$c" -mmin -${OAUTH_FRESH_MINUTES} 2>/dev/null)" ]; then
  tok=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null)
  [ -n "$tok" ] && curl -sSf -m 10 https://api.anthropic.com/api/oauth/usage -H "Authorization: Bearer $tok" -H "anthropic-beta: oauth-2025-04-20" > "$c.tmp" 2>/dev/null && mv "$c.tmp" "$c" || rm -f "$c.tmp" "$c"
fi
api=$(cat "$c" 2>/dev/null)
printf '{"live":%s,"api":%s}' "$live" "\${api:-null}"`;
const CODEX = `f=$(ls -t "$HOME"/.codex/sessions/*/*/*/*.jsonl 2>/dev/null | head -n 1); [ -n "$f" ] || exit 0
grep '"primary":{' "$f" | tail -n 1 | jq -c '.. | objects | select(has("rate_limits")) | .rate_limits | select(.primary) | {primary, secondary}' 2>/dev/null`;
// opencode's free-model tokens (cache included, as Claude and Codex are billed) since its last
// reset. A 429 carries the server's own reset (time + retryAfterMs): the newest one past is the
// window start while under 24h old, else 9:00 local; the next reset is a future one, else
// start + 24h. Inside that 24h it counts from 0 tokens; past it, with no use since, it is "inactive".
// shortcut: the reset drifts ~30 min a day, so the next reset is an estimate.
const OPENCODE_RESET_HOUR = 9;
const OPENCODE = `sqlite3 -readonly "$HOME/.local/share/opencode/opencode.db" "
with x(r) as (select time_created+json_extract(data,'$.error.retryAfterMs') from session_message
    where type='assistant' and json_extract(data,'$.error.type')='provider.free-limit'),
n(t) as (select strftime('%s','now')*1000),
w(s) as (select coalesce((select max(r) from x where r<=(select t from n) and r>(select t from n)-86400000),
    strftime('%s', datetime('now','localtime','-${OPENCODE_RESET_HOUR} hours','start of day','+${OPENCODE_RESET_HOUR} hours','utc'))*1000) from n)
select coalesce(sum(json_extract(data,'$.tokens.input')+json_extract(data,'$.tokens.output')+json_extract(data,'$.tokens.reasoning')
    +coalesce(json_extract(data,'$.tokens.cache.read'),0)+coalesce(json_extract(data,'$.tokens.cache.write'),0)),0),
  coalesce((select min(r) from x where r>(select t from n)), s+86400000)/1000,
  exists(select 1 from x where r<=(select t from n) and r>(select t from n)-86400000)
from session_message, w where type in ('assistant','compaction') and time_created >= s
  and json_extract(data,'$.model.providerID')='opencode' and json_extract(data,'$.model.id') like '%-free'" 2>/dev/null`;

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

// A window's reset time in epoch seconds. Orca's parseClaudeUsageResetTimestamp: 1e10 sits
// between any plausible seconds epoch (<2286) and any milliseconds one (>2001), so both
// units and an ISO string are accepted. A reset time never decides the percentage.
const resetSeconds = (value) => {
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (value.trim() !== '' && Number.isFinite(numeric)) return numeric > 1e10 ? numeric / 1000 : numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed / 1000 : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value > 1e10 ? value / 1000 : value;
};

const bucket = (id, windowMinutes, usedPercent, resetsAt, label) => {
  const at = resetSeconds(resetsAt);
  return {
    id, name: '', label, windowMinutes,
    usedPercent: clampUsedPercent(usedPercent),
    resetTime: at === null ? null : new Date(at * 1000).toISOString()
  };
};
const reading = (provider, buckets) => buckets.length
  ? { provider, status: 'ok', label: '', buckets } : null;

// oauth/usage's limits: the session, the week, and a per-model week such as Fable.
const fromUsageApi = (limits) => limits.map((l) => bucket(
  l.kind, l.kind === 'session' ? 300 : 10080, l.percent, l.resets_at,
  l.kind === 'session' ? '5h' : l.kind === 'weekly_all' ? 'wk' : l.scope?.model?.display_name ?? l.kind));

// Windows Claude Code reports besides 5h and the week (e.g. a per-model one): "seven_day_fable" is "Fable".
const extraClaude = (limits) => Object.entries(limits ?? {})
  .filter(([k, v]) => k !== 'five_hour' && k !== 'seven_day' && typeof v?.used_percentage === 'number')
  .map(([k, v]) => bucket(k, 10080, v.used_percentage, v.resets_at, k.replace(/^seven_day_?/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) || 'wk'));

// The API snapshot as a reading: array-shaped `limits` today, the older five_hour/seven_day
// object shape still accepted (`api`/`bedrock` snapshots carry no subscription windows).
const fromApiSnapshot = (api) => {
  if (!api || api.api || api.bedrock) return null;
  if (Array.isArray(api.limits) && api.limits[0]?.kind) return reading('claude', fromUsageApi(api.limits));
  return reading('claude', [
    api.five_hour && bucket('5h', 300, api.five_hour.used_percentage, api.five_hour.resets_at, '5h'),
    api.seven_day && bucket('7d', 10080, api.seven_day.used_percentage, api.seven_day.resets_at, 'wk'),
    ...extraClaude(api.limits)
  ].filter(Boolean));
};

// Per-model windows the status line does not carry (Fable); Orca keeps the last API-provided
// ones visible while live posts stream (service.ts:1515-1517), so they ride along here.
const apiExtras = (api) => {
  if (!api || api.api || api.bedrock) return [];
  if (Array.isArray(api.limits) && api.limits[0]?.kind) {
    return fromUsageApi(api.limits).filter((b) => b.id !== 'session' && b.id !== 'weekly_all');
  }
  return extraClaude(api.limits);
};

/**
 * Claude Code's statusLine `rate_limits` as a reading — Orca's live-session source
 * (claude-statusline-rate-limits.ts:55-93). `rate_limits` windows use `used_percentage`
 * and `resets_at` (epoch seconds); `utilization` is tolerated the way Orca tolerates it.
 */
export function parseClaudeStatusLine(rateLimits) {
  if (!rateLimits || typeof rateLimits !== 'object') return null;
  const window = (id, minutes, label, w) => {
    if (!w || typeof w !== 'object') return null;
    const pct = typeof w.used_percentage === 'number' ? w.used_percentage
      : typeof w.utilization === 'number' ? w.utilization : null;
    if (pct === null) return null;
    return bucket(id, minutes, pct, w.resets_at, label);
  };
  const buckets = [
    window('5h', 300, '5h', rateLimits.five_hour),
    window('7d', 10080, 'wk', rateLimits.seven_day)
  ].filter(Boolean);
  return buckets.length ? reading('claude', buckets) : null;
}

export async function probeLocal(execFn) {
  const [c, x, o] = await Promise.all([CLAUDE, CODEX, OPENCODE].map((s) => sh(execFn, s)));
  const claude = json(c), codex = json(x);
  // Live windows win while a session is active; the API snapshot only adds its extra pools
  // (or stands in entirely once the session has been quiet past the freshness window).
  const live = parseClaudeStatusLine(claude?.live);
  const claudeReading = live
    ? { ...live, buckets: [...live.buckets, ...apiExtras(claude.api)] }
    : fromApiSnapshot(claude?.api);
  const [tokens, resetAt, fresh] = o.split('|').map(Number);
  const out = [
    claudeReading,
    // Codex reports the windows its plan has: both for Plus and Pro, so both are shown.
    codex && reading('codex', [codex.primary, codex.secondary].filter(Boolean)
      .map((w) => {
        // A window past its reset has nothing used. It stays 0% with its full length as static
        // text (no countdown) until a newer rollout reports.
        const at = resetSeconds(w.resets_at);
        const over = at !== null && at <= Date.now() / 1000;
        const b = bucket(String(w.window_minutes), w.window_minutes, over ? 0 : w.used_percent, over ? null : w.resets_at, w.window_minutes === 300 ? '5h' : w.window_minutes === 10080 ? 'wk' : `${w.window_minutes}m`);
        return over ? { ...b, idleText: w.window_minutes >= 10080 ? `${w.window_minutes / 1440}d` : `${w.window_minutes / 60}h` } : b;
      })),
    Number.isFinite(tokens) && Number.isFinite(resetAt) && {
      provider: 'opencode', status: 'ok', label: '', buckets: [], ...(tokens || fresh
        ? { text: `${formatTokens(tokens)} tokens`, resetTime: new Date(resetAt * 1000).toISOString() }
        : { text: 'inactive', resetTime: null })
    }
  ];
  return out.filter(Boolean).map((r) => ({ ...r, detail: true }));
}
