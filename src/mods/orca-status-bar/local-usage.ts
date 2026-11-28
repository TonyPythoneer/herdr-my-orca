import {
  clampUsedPercent,
  isRecord,
  type ExecFn,
  type UsageBucket,
  type UsageReading,
} from "./usage.js";

const LIVE_FRESH_MINUTES = 5;
const OAUTH_FRESH_MINUTES = 15;
const SESSION_MINUTES = 300;
const WEEK_MINUTES = 10080;
const SCRIPT_TIMEOUT_MS = 20000;
const EPOCH_MS_FLOOR = 1e10;

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

type RawWindow = { used_percentage?: unknown; utilization?: unknown; resets_at?: unknown };
type RateLimits = { five_hour?: RawWindow | null; seven_day?: RawWindow | null };
type LimitRow = {
  kind: string;
  percent?: unknown;
  resets_at?: unknown;
  scope?: { model?: { display_name?: string } };
};
type ApiSnapshot = {
  api?: unknown;
  bedrock?: unknown;
  limits?: unknown;
  five_hour?: RawWindow | null;
  seven_day?: RawWindow | null;
};
type ClaudeSnapshot = { live?: RateLimits | null; api?: ApiSnapshot | null };
type CodexWindow = { window_minutes: number; used_percent?: unknown; resets_at?: unknown };
type CodexSnapshot = { primary?: CodexWindow | null; secondary?: CodexWindow | null };

const present = <T>(value: T | null | undefined | false): value is T => Boolean(value);

const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

export const formatTokens = (n: number): string => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return `${n}`;
};

const sh = async (execFn: ExecFn, script: string): Promise<string> => {
  try {
    const r = await execFn("sh", ["-c", script], { timeout: SCRIPT_TIMEOUT_MS });
    return r.code === 0 ? r.stdout.trim() : "";
  } catch {
    return "";
  }
};

const json = <T>(text: string): T | null => {
  try {
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
};

const toSeconds = (epoch: number): number => (epoch > EPOCH_MS_FLOOR ? epoch / 1000 : epoch);

const resetSeconds = (value: unknown): number | null => {
  if (typeof value === "string") {
    const numeric = Number(value);
    if (value.trim() !== "" && Number.isFinite(numeric)) return toSeconds(numeric);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed / 1000 : null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return toSeconds(value);
};

const bucket = (
  id: string,
  windowMinutes: number,
  usedPercent: unknown,
  resetsAt: unknown,
  label: string,
): UsageBucket => {
  const at = resetSeconds(resetsAt);
  const over = at !== null && at <= Date.now() / 1000;
  return {
    id,
    name: "",
    label,
    windowMinutes,
    usedPercent: over ? 0 : clampUsedPercent(usedPercent),
    resetTime: at === null || over ? null : new Date(at * 1000).toISOString(),
    ...(over
      ? {
          idleText:
            windowMinutes >= WEEK_MINUTES ? `${windowMinutes / 1440}d` : `${windowMinutes / 60}h`,
        }
      : {}),
  };
};

const reading = (provider: string, buckets: UsageBucket[]): UsageReading | null =>
  buckets.length ? { provider, status: "ok", label: "", buckets } : null;

const limitLabel = (limit: LimitRow): string => {
  if (limit.kind === "session") return "5h";
  if (limit.kind === "weekly_all") return "wk";
  return limit.scope?.model?.display_name ?? limit.kind;
};

const fromUsageApi = (limits: LimitRow[]): UsageBucket[] =>
  limits.map((l) =>
    bucket(
      l.kind,
      l.kind === "session" ? SESSION_MINUTES : WEEK_MINUTES,
      l.percent,
      l.resets_at,
      limitLabel(l),
    ),
  );

const isLimitList = (value: unknown): value is LimitRow[] =>
  Array.isArray(value) && Boolean(value[0]?.kind);

const extraLabel = (key: string): string =>
  key
    .replace(/^seven_day_?/, "")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase()) || "wk";

const extraClaude = (limits: unknown): UsageBucket[] =>
  (typeof limits === "object" && limits !== null ? Object.entries(limits) : [])
    .filter(
      ([k, v]) =>
        k !== "five_hour" && k !== "seven_day" && typeof field(v, "used_percentage") === "number",
    )
    .map(([k, v]) =>
      bucket(k, WEEK_MINUTES, field(v, "used_percentage"), field(v, "resets_at"), extraLabel(k)),
    );

const fromApiSnapshot = (api: ApiSnapshot | null | undefined): UsageReading | null => {
  if (!api || api.api || api.bedrock) return null;
  if (isLimitList(api.limits)) return reading("claude", fromUsageApi(api.limits));
  return reading(
    "claude",
    [
      api.five_hour &&
        bucket("5h", SESSION_MINUTES, api.five_hour.used_percentage, api.five_hour.resets_at, "5h"),
      api.seven_day &&
        bucket("7d", WEEK_MINUTES, api.seven_day.used_percentage, api.seven_day.resets_at, "wk"),
      ...extraClaude(api.limits),
    ].filter(present),
  );
};

const apiExtras = (api: ApiSnapshot | null | undefined): UsageBucket[] => {
  if (!api || api.api || api.bedrock) return [];
  if (isLimitList(api.limits)) {
    return fromUsageApi(api.limits).filter((b) => b.id !== "session" && b.id !== "weekly_all");
  }
  return extraClaude(api.limits);
};

export function parseClaudeStatusLine(rateLimits: unknown): UsageReading | null {
  if (!rateLimits || typeof rateLimits !== "object") return null;
  const limits = rateLimits as RateLimits;
  const window = (
    id: string,
    minutes: number,
    label: string,
    w: RawWindow | null | undefined,
  ): UsageBucket | null => {
    if (!w || typeof w !== "object") return null;
    const pct = [w.used_percentage, w.utilization].find((v) => typeof v === "number") ?? null;
    if (pct === null) return null;
    return bucket(id, minutes, pct, w.resets_at, label);
  };
  const buckets = [
    window("5h", SESSION_MINUTES, "5h", limits.five_hour),
    window("7d", WEEK_MINUTES, "wk", limits.seven_day),
  ].filter(present);
  return buckets.length ? reading("claude", buckets) : null;
}

const codexWindowLabel = (minutes: number): string => {
  if (minutes === SESSION_MINUTES) return "5h";
  if (minutes === WEEK_MINUTES) return "wk";
  return `${minutes}m`;
};

export async function probeLocal(
  execFn: ExecFn,
  installed: Set<string> | null = null,
): Promise<UsageReading[]> {
  const [c, x, o] = await Promise.all(
    [
      ["claude", CLAUDE],
      ["codex", CODEX],
      ["opencode", OPENCODE],
    ].map(([name, script]) => (!installed || installed.has(name) ? sh(execFn, script) : "")),
  );
  const claude = json<ClaudeSnapshot>(c);
  const codex = json<CodexSnapshot>(x);
  const live = parseClaudeStatusLine(claude?.live);
  const claudeReading = live
    ? { ...live, buckets: [...live.buckets, ...apiExtras(claude?.api)] }
    : fromApiSnapshot(claude?.api);
  const [tokens, resetAt, fresh] = o.split("|").map(Number);
  const opencode: UsageReading | null =
    Number.isFinite(tokens) && Number.isFinite(resetAt)
      ? {
          provider: "opencode",
          status: "ok",
          label: "",
          buckets: [],
          text: fresh && !tokens ? "inactive" : `${formatTokens(tokens)} tokens`,
          resetTime: new Date(resetAt * 1000).toISOString(),
        }
      : null;
  const out = [
    claudeReading,
    codex &&
      reading(
        "codex",
        [codex.primary, codex.secondary]
          .filter(present)
          .map((w) =>
            bucket(
              String(w.window_minutes),
              w.window_minutes,
              w.used_percent,
              w.resets_at,
              codexWindowLabel(w.window_minutes),
            ),
          ),
      ),
    opencode,
  ];
  return out.filter(present).map((r) => ({ ...r, detail: true }));
}
