// Pure helpers for the CodeBurn panel: formatting, period windows, and the
// small amount of arithmetic the JSON reports need before they can be drawn.
// No Herdr imports, so every function here is testable with plain Node.

export const PERIODS = [
  { key: "today", label: "Today", short: "Today", days: 1 },
  { key: "week", label: "7 days", short: "7D", days: 7 },
  { key: "30days", label: "30 days", short: "30D", days: 30 },
  { key: "month", label: "This month", short: "Month", days: null },
  { key: "all", label: "All time", short: "All", days: null },
];

export const TAB_KEYS = ["overview", "sessions", "models", "optimize", "plans"];
export const TAB_LABELS = {
  overview: "Overview",
  sessions: "Sessions",
  models: "Models",
  optimize: "Optimize",
  plans: "Plans",
};

// CodeBurn's flame orange, then provider colours that stay legible on both the
// light and dark themes this repo ships.
const BRAND = "#f97316";
const PROVIDER_COLORS = {
  claude: "#d97757",
  anthropic: "#d97757",
  codex: "#10a37f",
  openai: "#10a37f",
  opencode: "#f97316",
  cursor: "#8b5cf6",
  "cursor-agent": "#8b5cf6",
  gemini: "#4285f4",
  copilot: "#8b949e",
  antigravity: "#22c55e",
  kimi: "#06b6d4",
  zai: "#a855f7",
  zcode: "#6366f1",
  grok: "#9ca3af",
  devin: "#ec4899",
  commandcode: "#f59e0b",
  cline: "#3b82f6",
  windsurf: "#0ea5e9",
  warp: "#01a4ff",
  amp: "#e11d48",
  pi: "#a3e635",
};
const CATEGORY_COLORS = {
  coding: "#f97316",
  feature: "#fb923c",
  debugging: "#ef4444",
  testing: "#22c55e",
  exploration: "#3b82f6",
  delegation: "#a855f7",
  conversation: "#06b6d4",
  git: "#eab308",
  refactoring: "#14b8a6",
  general: "#94a3b8",
  brainstorming: "#ec4899",
};

export const brand = () => BRAND;
export const providerColor = (id, fallback) =>
  PROVIDER_COLORS[String(id ?? "").toLowerCase()] ?? fallback ?? BRAND;
export const categoryColor = (id, fallback) =>
  CATEGORY_COLORS[String(id ?? "").toLowerCase()] ?? fallback ?? "#94a3b8";

const trimZero = (s) => s.replace(/\.0$/, "");

export function money(value, options = {}) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  const abs = Math.abs(n);
  if (options.compact) {
    if (abs >= 1_000_000_000) return `$${trimZero((n / 1_000_000_000).toFixed(1))}B`;
    if (abs >= 1_000_000) return `$${trimZero((n / 1_000_000).toFixed(1))}M`;
    if (abs >= 1_000) return `$${trimZero((n / 1_000).toFixed(1))}k`;
  }
  if (options.grouped) {
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${n.toFixed(2)}`;
}

export function tokens(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${trimZero((n / 1_000_000_000).toFixed(1))}B`;
  if (abs >= 1_000_000) return `${trimZero((n / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}

export function count(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

export function percent(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${trimZero(n.toFixed(digits))}%`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function periodByKey(key) {
  return PERIODS.find((p) => p.key === key) ?? PERIODS[1];
}

export function localDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDayKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ""));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function dayLabel(key) {
  const date = parseDayKey(key);
  if (!date) return key ?? "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

export function weekdayLabel(key) {
  const date = parseDayKey(key);
  if (!date) return "";
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
}

export function monthDayLabel(key) {
  const date = parseDayKey(key);
  if (!date) return "";
  return String(date.getDate());
}

export function clockLabel(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const hour = date.getHours() % 12 || 12;
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute} ${date.getHours() >= 12 ? "PM" : "AM"}`;
}

export function dateTimeLabel(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${dayLabel(localDayKey(date))}, ${clockLabel(iso)}`;
}

export function relativeTime(timestamp, now = Date.now()) {
  if (!Number.isFinite(Number(timestamp))) return "—";
  const delta = Math.max(0, Number(now) - Number(timestamp));
  const seconds = Math.round(delta / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function resetIn(iso, now = Date.now()) {
  if (!iso) return "";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const seconds = Math.max(0, Math.round((at - now) / 1000));
  if (seconds <= 0) return "now";
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `in ${days}d ${hours % 24}h`;
}

export function formatDuration(ms) {
  if (ms == null || ms === "") return "—";
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return `${Math.round(n)}ms`;
  const seconds = Math.round(n / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function projectLabel(project) {
  const raw = String(project ?? "").trim();
  if (!raw) return "Unknown project";
  if (raw === "Home" || raw === "~") return "Home";
  const path = raw.replace(/\\/g, "/").replace(/\/+$/, "");
  if (path.includes("/")) {
    const base = path.split("/").filter(Boolean).pop();
    if (base) return base;
  }
  // CodeBurn stores Claude projects as "-Users-name-git-repo"; the last
  // hyphen-separated segment is the folder name the CLI itself displays.
  const parts = path.split("-").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : raw;
}

export function sessionTitle(session) {
  const title = String(session?.title ?? "").trim();
  if (title) return title;
  const id = String(session?.sessionId ?? "");
  return id ? `Session ${id.slice(0, 8)}` : "Untitled session";
}

export function sumTokens(row) {
  return (
    (Number(row?.inputTokens) || 0) +
    (Number(row?.outputTokens) || 0) +
    (Number(row?.cacheReadTokens) || 0) +
    (Number(row?.cacheWriteTokens) || 0)
  );
}

export function modelTokens(row) {
  return (
    (Number(row?.inputTokens) || 0) +
    (Number(row?.outputTokens) || 0) +
    (Number(row?.cacheReadTokens) || 0) +
    (Number(row?.cacheWriteTokens) || 0)
  );
}

/**
 * The days the Overview chart draws. The report only lists days with spend, so
 * the gaps are filled with zeroes: a week with two quiet days should look like
 * a week, not a two-bar chart.
 */
export function dailySeries(report, periodKey, now = new Date()) {
  const period = periodByKey(periodKey);
  const daily = Array.isArray(report?.daily) ? report.daily : [];
  const byDay = new Map(daily.filter((d) => d?.date).map((d) => [d.date, d]));
  const dates = daily
    .map((d) => parseDayKey(d.date))
    .filter(Boolean)
    .sort((a, b) => a - b);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let end = today;
  let start;

  if (period.key === "today") {
    start = end;
  } else if (period.key === "all") {
    end = dates.length && dates[dates.length - 1] > today ? dates[dates.length - 1] : today;
    start = addDays(end, -29);
  } else if (dates.length) {
    // The CLI decides where a period starts; drawing the report's own day
    // range keeps the bars summing to the total on the card above.
    start = dates[0];
    end = dates[dates.length - 1];
    if (end > today) end = today;
  } else if (period.key === "week") {
    start = addDays(end, -6);
  } else if (period.key === "30days") {
    start = addDays(end, -29);
  } else {
    start = new Date(end.getFullYear(), end.getMonth(), 1);
  }

  const days = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const key = localDayKey(date);
    const entry = byDay.get(key);
    days.push({
      date: key,
      cost: Number(entry?.cost) || 0,
      calls: Number(entry?.calls) || 0,
      turns: Number(entry?.turns) || 0,
      editTurns: Number(entry?.editTurns) || 0,
      oneShotRate: entry?.oneShotRate ?? null,
    });
  }

  const visible = days.reduce((sum, d) => sum + d.cost, 0);
  const max = days.reduce((best, d) => Math.max(best, d.cost), 0);
  return {
    days,
    total: visible,
    max,
    average: days.length ? visible / days.length : 0,
    start: days[0]?.date ?? localDayKey(today),
    end: days[days.length - 1]?.date ?? localDayKey(today),
    label:
      period.key === "all"
        ? "Last 30 days of history"
        : period.key === "month"
          ? "Month to date"
          : period.label,
    truncated: period.key === "all" && daily.length > days.length,
    reportTotal: Number(report?.overview?.cost) || 0,
  };
}

export function providerTotals(models) {
  const map = new Map();
  for (const row of Array.isArray(models) ? models : []) {
    const id = String(row?.provider ?? "unknown");
    const acc =
      map.get(id) ??
      {
        id,
        name: row?.providerDisplayName || id.charAt(0).toUpperCase() + id.slice(1),
        cost: 0,
        calls: 0,
        tokens: 0,
        models: 0,
      };
    acc.cost += Number(row?.costUSD) || 0;
    acc.calls += Number(row?.calls) || 0;
    acc.tokens += Number(row?.totalTokens) || modelTokens(row);
    acc.models += 1;
    map.set(id, acc);
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost);
}

/** Model display name -> provider display name, for joining report.models. */
export function modelProviderMap(models) {
  const map = new Map();
  for (const row of Array.isArray(models) ? models : []) {
    const provider = row?.providerDisplayName || row?.provider;
    if (!provider) continue;
    if (row.modelDisplayName) map.set(row.modelDisplayName, provider);
    if (row.model) map.set(row.model, provider);
  }
  return map;
}

export function modelRows(report, models) {
  const providers = modelProviderMap(models);
  return (Array.isArray(report?.models) ? report.models : [])
    .map((row) => ({
      name: row.name ?? row.model ?? "Unknown model",
      provider: providers.get(row.name) ?? "",
      cost: Number(row.cost) || 0,
      savings: Number(row.savings) || 0,
      calls: Number(row.calls) || 0,
      tokens: modelTokens(row),
      input: Number(row.inputTokens) || 0,
      output: Number(row.outputTokens) || 0,
      cacheRead: Number(row.cacheReadTokens) || 0,
      cacheWrite: Number(row.cacheWriteTokens) || 0,
      oneShotRate: row.oneShotRate ?? null,
      editTurns: Number(row.editTurns) || 0,
      oneShotTurns: Number(row.oneShotTurns) || 0,
      costPerEdit: row.costPerEdit ?? null,
      retriesPerEdit: row.retriesPerEdit ?? null,
    }))
    .sort((a, b) => b.cost - a.cost);
}

export function projectRows(report, limit = 8) {
  return (Array.isArray(report?.projects) ? report.projects : [])
    .map((row) => ({
      name: projectLabel(row.path ?? row.name),
      path: row.path ?? "",
      cost: Number(row.cost) || 0,
      sessions: Number(row.sessions) || 0,
      calls: Number(row.calls) || 0,
      avgCostPerSession: row.avgCostPerSession ?? null,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, limit);
}

export function activityRows(report, limit = 8) {
  return (Array.isArray(report?.activities) ? report.activities : [])
    .map((row) => ({
      name: row.category ?? row.rawCategory ?? "Other",
      raw: row.rawCategory ?? "",
      cost: Number(row.cost) || 0,
      turns: Number(row.turns) || 0,
      oneShotRate: row.oneShotRate ?? null,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, limit);
}

export function toolRows(report, limit = 8) {
  return (Array.isArray(report?.tools) ? report.tools : [])
    .map((row) => ({ name: row.name ?? "Unknown", calls: Number(row.calls) || 0 }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, limit);
}

export function recentSessions(report, limit = 6) {
  return (Array.isArray(report?.topSessions) ? report.topSessions : [])
    .map((row) => ({
      sessionId: row.sessionId,
      project: projectLabel(row.project),
      projectKey: row.projectKey,
      provider: row.provider ?? "",
      date: row.date ?? "",
      cost: Number(row.cost) || 0,
      calls: Number(row.calls) || 0,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, limit);
}

export function sortedSessions(sessions) {
  return (Array.isArray(sessions) ? sessions : [])
    .slice()
    .sort((a, b) => (Number(b.cost) || 0) - (Number(a.cost) || 0));
}

export function filterSessions(sessions, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.filter((session) => {
    const haystack = [
      session?.title,
      session?.project,
      session?.provider,
      session?.sessionId,
      ...(Array.isArray(session?.models) ? session.models : []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function quotaRows(quota) {
  const providers = Array.isArray(quota?.providers) ? quota.providers : [];
  const available = providers
    .filter((p) => p?.available)
    .map((p) => ({
      id: String(p.id ?? p.name ?? "unknown"),
      name: p.name ?? p.id ?? "Unknown",
      plan: p.plan ?? "",
      notes: Array.isArray(p.notes) ? p.notes : [],
      windows: (Array.isArray(p.windows) ? p.windows : []).map((w) => ({
        label: w.label ?? "Window",
        short: w.label === "5-hour" ? "5h" : w.label === "Weekly" ? "Week" : w.label,
        usedPct: clamp(w.usedPct, 0, 100),
        resetsAt: w.resetsAt ?? null,
        reset: resetIn(w.resetsAt),
      })),
    }));
  const unavailable = providers
    .filter((p) => !p?.available)
    .map((p) => ({ id: String(p.id ?? p.name ?? "unknown"), name: p.name ?? p.id ?? "Unknown" }));
  return { available, unavailable };
}

export function worstWindow(provider) {
  let worst = null;
  for (const window of provider?.windows ?? []) {
    if (!worst || window.usedPct > worst.usedPct) worst = window;
  }
  return worst;
}

export function extractJson(text) {
  if (typeof text !== "string") return null;
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (!clean) return null;
  const firstObject = clean.indexOf("{");
  const firstArray = clean.indexOf("[");
  const candidates = [firstObject, firstArray].filter((index) => index >= 0);
  if (!candidates.length) return null;
  const start = Math.min(...candidates);
  const candidate = clean.slice(start);
  try {
    return JSON.parse(candidate);
  } catch {}
  const lastObject = candidate.lastIndexOf("}");
  const lastArray = candidate.lastIndexOf("]");
  const end = Math.max(lastObject, lastArray);
  if (end > 0) {
    try {
      return JSON.parse(candidate.slice(0, end + 1));
    } catch {}
  }
  return null;
}

export function parseEngineVersion(stdout) {
  const match = /(\d+\.\d+\.\d+)/.exec(String(stdout ?? ""));
  return match ? match[1] : null;
}

export function healthTone(grade) {
  const letter = String(grade ?? "").toUpperCase();
  if (letter === "A+" || letter === "A") return "done";
  if (letter === "B" || letter === "C") return "working";
  return "blocked";
}

export function severityTone(severity) {
  const value = String(severity ?? "").toLowerCase();
  if (value === "high" || value === "critical") return "blocked";
  if (value === "medium") return "working";
  return "muted";
}

export function shortText(text, words = 28) {
  const parts = String(text ?? "").trim().split(/\s+/);
  if (parts.length <= words) return String(text ?? "");
  return `${parts.slice(0, words).join(" ")}…`;
}

export function sharePct(value, total) {
  const t = Number(total);
  if (!Number.isFinite(t) || t <= 0) return 0;
  return clamp((Number(value) / t) * 100, 0, 100);
}

export function monthProjection(monthCost, now = new Date()) {
  const day = now.getDate();
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const cost = Number(monthCost);
  if (!Number.isFinite(cost) || day <= 0) return null;
  return (cost / day) * days;
}

export function todayStatus(status) {
  return {
    today: Number(status?.today?.cost) || 0,
    todayCalls: Number(status?.today?.calls) || 0,
    month: Number(status?.month?.cost) || 0,
    monthCalls: Number(status?.month?.calls) || 0,
  };
}
