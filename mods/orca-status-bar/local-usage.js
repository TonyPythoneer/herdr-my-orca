// Claude, Codex and opencode for the bar, from files on this computer (no network except
// Claude's fallback):
//   Claude    the live feed first: Claude Code's `rate_limits` for the 5h/weekly windows,
//             written per turn by claude-statusline.sh (Orca's live-session path). While a
//             session is quiet, Anthropic's oauth/usage fills in (and adds per-model windows
//             such as Fable); its token comes from the macOS keychain and is never written
//             anywhere. Both live in ~/.cache/herdr-usage/.
//   Codex     the last rate_limits in the newest session file that has them
//   opencode  no limits: free-model tokens (replies and compactions, cache included) since its daily reset
// Same reading shape as usage.js; `text` is a chip with no percentage.
import { clampUsedPercent } from './usage.js';

// Orca's freshness split (rate-limits/service.ts): live windows gate the OAuth poll for
// MIN_REFETCH_MS = 5 minutes; the poll itself runs every 15 minutes (DEFAULT_POLL_MS).
const LIVE_FRESH_MINUTES = 5;
const OAUTH_FRESH_MINUTES = 15;
// The two windows every quota source here reports, in minutes.
const SESSION_MINUTES = 300;
const WEEK_MINUTES = 10080;
const SCRIPT_TIMEOUT_MS = 20000;
// Epoch values above this are milliseconds (see resetSeconds).
const EPOCH_MS_FLOOR = 1e10;

// A provider is drawn only when its CLI is installed (the create menu's knownAgents) and signed
// in: each script below prints nothing without its credential, so a logged-out CLI leaves no chip.
const CLAUDE = `{ security find-generic-password -s "Claude Code-credentials" >/dev/null 2>&1 || [ -s "$HOME/.claude/.credentials.json" ]; } || exit 0
d="$HOME/.cache/herdr-usage"; mkdir -p "$d"
s="$d/claude-statusline.json"; c="$d/claude-oauth.json"
live=null
if [ -n "$(find "$s" -mmin -${LIVE_FRESH_MINUTES} 2>/dev/null)" ]; then
  v=$(cat "$s" 2>/dev/null); [ -n "$v" ] && live=$v
fi
if [ "$live" = "null" ] && [ -z "$(find "$c" -mmin -${OAUTH_FRESH_MINUTES} 2>/dev/null)" ]; then
  tok=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null)
  [ -n "$tok" ] && printf 'Authorization: Bearer %s\\n' "$tok" | curl -q -sSf -m 10 https://api.anthropic.com/api/oauth/usage -H @- -H "anthropic-beta: oauth-2025-04-20" > "$c.tmp" 2>/dev/null && mv "$c.tmp" "$c" || rm -f "$c.tmp" "$c"
fi
api=$(cat "$c" 2>/dev/null)
printf '{"live":%s,"api":%s}' "$live" "\${api:-null}"`;
const CODEX = `[ -s "$HOME/.codex/auth.json" ] || exit 0
ls -t "$HOME"/.codex/sessions/*/*/*/*.jsonl 2>/dev/null | while IFS= read -r f; do
  v=$(grep '"primary":{' "$f" | tail -n 1 | jq -c '.. | objects | select(has("rate_limits")) | .rate_limits | select(.primary) | {primary, secondary}' 2>/dev/null)
  if [ -n "$v" ]; then printf '%s\n' "$v"; break; fi
done`;
// opencode's free-model tokens (cache included, as Claude and Codex are billed) since its last
// reset. A 429 carries the server's own reset (time + retryAfterMs) and those resets are a fixed
// daily cycle, so the window holding now is the newest one stepped forward in whole 24h cycles
// until it straddles now (`s <= now < s + 86400000`): the last 429 may be minutes or days old and
// the answer is the same. Only with no 429 at all does the window fall back to the most recent
// 9:00 local. The next reset is that window's end, so it is always in the future, and rows at or
// before the window start are never counted. "inactive" means the window came from that cycle and
// no free model has run since the reset; without reset evidence the chip shows its count instead.
// shortcut: the server's cycle drifts ~30 min a day, so its next reset is an estimate.
const OPENCODE_RESET_HOUR = 9;
const OPENCODE = `sqlite3 -readonly "$HOME/.local/share/opencode/opencode.db" "
with x(r) as (select time_created+json_extract(data,'$.error.retryAfterMs') from session_message
    where type='assistant' and json_extract(data,'$.error.type')='provider.free-limit'),
n(t) as (select strftime('%s','now')*1000),
b(r) as (select max(r) from x),
w(s) as (select coalesce(
    (select r+(case when r<=(select t from n) then ((select t from n)-r)/86400000
      else -(((r-(select t from n))+86399999)/86400000) end)*86400000 from b),
    strftime('%s', datetime('now','localtime','-${OPENCODE_RESET_HOUR} hours','start of day','+${OPENCODE_RESET_HOUR} hours','utc'))*1000) from n)
select coalesce(sum(json_extract(data,'$.tokens.input')+json_extract(data,'$.tokens.output')+json_extract(data,'$.tokens.reasoning')
    +coalesce(json_extract(data,'$.tokens.cache.read'),0)+coalesce(json_extract(data,'$.tokens.cache.write'),0)),0),
  (s+86400000)/1000,
  (select r is not null from b)
from session_message, w where type in ('assistant','compaction') and time_created >= s
  and json_extract(data,'$.model.providerID')='opencode' and json_extract(data,'$.model.id') like '%-free'" 2>/dev/null`;

export const formatTokens = (n) => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return `${n}`;
};

const sh = async (execFn, script) => {
  try {
    const r = await execFn('sh', ['-c', script], { timeout: SCRIPT_TIMEOUT_MS });
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
const toSeconds = (epoch) => (epoch > EPOCH_MS_FLOOR ? epoch / 1000 : epoch);
const resetSeconds = (value) => {
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (value.trim() !== '' && Number.isFinite(numeric)) return toSeconds(numeric);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed / 1000 : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return toSeconds(value);
};

// A window past its reset has nothing used. It stays 0% with its full length as static text
// (no countdown) until a newer report arrives (Codex rollouts and Claude statusLine alike).
const bucket = (id, windowMinutes, usedPercent, resetsAt, label) => {
  const at = resetSeconds(resetsAt);
  const over = at !== null && at <= Date.now() / 1000;
  return {
    id, name: '', label, windowMinutes,
    usedPercent: over ? 0 : clampUsedPercent(usedPercent),
    resetTime: at === null || over ? null : new Date(at * 1000).toISOString(),
    ...(over && { idleText: windowMinutes >= WEEK_MINUTES ? `${windowMinutes / 1440}d` : `${windowMinutes / 60}h` })
  };
};
const reading = (provider, buckets) => buckets.length
  ? { provider, status: 'ok', label: '', buckets } : null;

// oauth/usage's limits: the session, the week, and a per-model week such as Fable.
const limitLabel = (limit) => {
  if (limit.kind === 'session') return '5h';
  if (limit.kind === 'weekly_all') return 'wk';
  return limit.scope?.model?.display_name ?? limit.kind;
};
const fromUsageApi = (limits) => limits.map((l) => bucket(
  l.kind, l.kind === 'session' ? SESSION_MINUTES : WEEK_MINUTES, l.percent, l.resets_at, limitLabel(l)));

// Windows Claude Code reports besides 5h and the week (e.g. a per-model one): "seven_day_fable" is "Fable".
const extraClaude = (limits) => Object.entries(limits ?? {})
  .filter(([k, v]) => k !== 'five_hour' && k !== 'seven_day' && typeof v?.used_percentage === 'number')
  .map(([k, v]) => bucket(k, WEEK_MINUTES, v.used_percentage, v.resets_at, k.replace(/^seven_day_?/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) || 'wk'));

// The API snapshot as a reading: array-shaped `limits` today, the older five_hour/seven_day
// object shape still accepted (`api`/`bedrock` snapshots carry no subscription windows).
const fromApiSnapshot = (api) => {
  if (!api || api.api || api.bedrock) return null;
  if (Array.isArray(api.limits) && api.limits[0]?.kind) return reading('claude', fromUsageApi(api.limits));
  return reading('claude', [
    api.five_hour && bucket('5h', SESSION_MINUTES, api.five_hour.used_percentage, api.five_hour.resets_at, '5h'),
    api.seven_day && bucket('7d', WEEK_MINUTES, api.seven_day.used_percentage, api.seven_day.resets_at, 'wk'),
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
    const pct = [w.used_percentage, w.utilization].find((v) => typeof v === 'number') ?? null;
    if (pct === null) return null;
    return bucket(id, minutes, pct, w.resets_at, label);
  };
  const buckets = [
    window('5h', SESSION_MINUTES, '5h', rateLimits.five_hour),
    window('7d', WEEK_MINUTES, 'wk', rateLimits.seven_day)
  ].filter(Boolean);
  return buckets.length ? reading('claude', buckets) : null;
}

const codexWindowLabel = (minutes) => {
  if (minutes === SESSION_MINUTES) return '5h';
  if (minutes === WEEK_MINUTES) return 'wk';
  return `${minutes}m`;
};

/** `installed`: the CLI names `knownAgents()` found; null (not known) skips that check. opencode needs no login: its free tokens count either way. */
export async function probeLocal(execFn, installed = null) {
  const [c, x, o] = await Promise.all([['claude', CLAUDE], ['codex', CODEX], ['opencode', OPENCODE]]
    .map(([name, script]) => !installed || installed.has(name) ? sh(execFn, script) : ''));
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
      .map((w) => bucket(String(w.window_minutes), w.window_minutes, w.used_percent, w.resets_at, codexWindowLabel(w.window_minutes)))),
    Number.isFinite(tokens) && Number.isFinite(resetAt) && {
      provider: 'opencode', status: 'ok', label: '', buckets: [],
      // A window the server's own cycle set and nothing has used since is "inactive"; any other
      // window reads as its token count, 0 included, with the reset that ends it.
      text: fresh && !tokens ? 'inactive' : `${formatTokens(tokens)} tokens`,
      resetTime: new Date(resetAt * 1000).toISOString()
    }
  ];
  return out.filter(Boolean).map((r) => ({ ...r, detail: true }));
}
