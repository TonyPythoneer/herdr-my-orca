// Pure helpers behind the CodeBurn panel. Run with:
//   node --test mods/orca-stats/data.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  dailySeries,
  dayLabel,
  extractJson,
  filterSessions,
  formatDuration,
  modelRows,
  money,
  monthProjection,
  parseEngineVersion,
  percent,
  providerTotals,
  quotaRows,
  recentSessions,
  sessionTitle,
  sharePct,
  tokens,
  weekdayLabel,
  worstWindow,
} from "./data.js";

test("money formats exact, grouped and compact amounts", () => {
  assert.equal(money(267.539), "$267.54");
  assert.equal(money(1234.5, { grouped: true }), "$1,234.50");
  assert.equal(money(1234.5, { compact: true }), "$1.2k");
  assert.equal(money(2_500_000, { compact: true }), "$2.5M");
  assert.equal(money(null), "—");
});

test("tokens and percent stay compact and deterministic", () => {
  assert.equal(tokens(987), "987");
  assert.equal(tokens(12_345), "12k");
  assert.equal(tokens(1_234_567), "1.2M");
  assert.equal(tokens(1_200_000_000), "1.2B");
  assert.equal(percent(97.75), "97.8%");
  assert.equal(percent(100, 0), "100%");
  assert.equal(sharePct(25, 100), 25);
  assert.equal(sharePct(25, 0), 0);
});

test("date labels do not depend on the host locale", () => {
  assert.equal(dayLabel("2026-11-16"), "Nov 16");
  assert.equal(weekdayLabel("2026-11-16"), "Mon");
  assert.equal(dayLabel("bad"), "bad");
});

test("dailySeries draws the report's day range and fills quiet days", () => {
  const report = {
    overview: { cost: 30 },
    daily: [
      { date: "2026-11-15", cost: 20, calls: 2, turns: 3 },
      { date: "2026-11-17", cost: 10, calls: 1, turns: 1 },
    ],
  };
  const series = dailySeries(report, "week", new Date(2026, 10, 22));
  assert.deepEqual(series.days.map((day) => day.date), ["2026-11-15", "2026-11-16", "2026-11-17"]);
  assert.deepEqual(series.days.map((day) => day.cost), [20, 0, 10]);
  assert.equal(series.total, 30);
  assert.equal(series.max, 20);
  assert.equal(series.average, 10);
});

test("dailySeries keeps one bar for today and caps all-time to 30 days", () => {
  const today = dailySeries({ daily: [{ date: "2026-11-22", cost: 4 }] }, "today", new Date(2026, 10, 22));
  assert.equal(today.days.length, 1);
  assert.equal(today.days[0].date, "2026-11-22");
  const all = dailySeries({ daily: [{ date: "2026-11-22", cost: 4 }] }, "all", new Date(2026, 10, 22));
  assert.equal(all.days.length, 30);
  assert.equal(all.truncated, false);
});

test("providerTotals folds models into one row per provider", () => {
  const totals = providerTotals([
    { provider: "claude", providerDisplayName: "Claude", costUSD: 5, calls: 10, totalTokens: 100 },
    { provider: "claude", providerDisplayName: "Claude", costUSD: 5, calls: 5, totalTokens: 50 },
    { provider: "codex", providerDisplayName: "Codex", costUSD: 20, calls: 7, totalTokens: 200 },
  ]);
  assert.deepEqual(
    totals.map((row) => [row.id, row.cost, row.calls, row.tokens, row.models]),
    [
      ["codex", 20, 7, 200, 1],
      ["claude", 10, 15, 150, 2],
    ],
  );
});

test("modelRows joins provider display names and keeps efficiency data", () => {
  const report = {
    models: [
      {
        name: "Sonnet 5.5",
        cost: 10,
        calls: 20,
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
        oneShotRate: 92.3,
        editTurns: 10,
        oneShotTurns: 9,
        costPerEdit: 0.43,
      },
    ],
  };
  const rows = modelRows(report, [{ modelDisplayName: "Sonnet 5.5", providerDisplayName: "Claude" }]);
  assert.equal(rows[0].provider, "Claude");
  assert.equal(rows[0].tokens, 10);
  assert.equal(rows[0].input, 1);
  assert.equal(rows[0].output, 2);
  assert.equal(rows[0].cacheRead, 3);
  assert.equal(rows[0].cacheWrite, 4);
  assert.equal(rows[0].oneShotRate, 92.3);
  assert.equal(rows[0].editTurns, 10);
  assert.equal(rows[0].oneShotTurns, 9);
  assert.equal(rows[0].costPerEdit, 0.43);
});

test("quotaRows separates connected plans and finds the tightest window", () => {
  const rows = quotaRows({
    providers: [
      {
        id: "codex",
        name: "Codex",
        available: true,
        plan: "Plus",
        windows: [
          { label: "5-hour", usedPct: 12, resetsAt: "2026-11-22T06:00:00.000Z" },
          { label: "Weekly", usedPct: 100, resetsAt: "2026-11-22T12:00:00.000Z" },
        ],
      },
      { id: "gemini", name: "Gemini", available: false, windows: [] },
    ],
  });
  assert.equal(rows.available.length, 1);
  assert.equal(rows.available[0].windows[1].short, "Week");
  assert.equal(worstWindow(rows.available[0]).usedPct, 100);
  assert.deepEqual(rows.unavailable.map((provider) => provider.name), ["Gemini"]);
});

test("filterSessions searches title, project, provider and model", () => {
  const sessions = [
    { title: "Fix login", project: "app", provider: "claude", models: ["Sonnet"], sessionId: "abc" },
    { title: "Tune query", project: "api", provider: "codex", models: ["GPT"], sessionId: "def" },
  ];
  assert.equal(filterSessions(sessions, "login").length, 1);
  assert.equal(filterSessions(sessions, "CODEX")[0].project, "api");
  assert.equal(filterSessions(sessions, "gpt")[0].project, "api");
  assert.equal(filterSessions(sessions, "").length, 2);
});

test("extractJson survives warnings before and messages after the payload", () => {
  assert.deepEqual(extractJson('warning: hi\n{"a":1}\nbye'), { a: 1 });
  assert.deepEqual(extractJson("noise\n[1,2]\nnoise"), [1, 2]);
  assert.equal(extractJson("not json"), null);
  assert.equal(extractJson(""), null);
});

test("engine versions, durations and projections are stable", () => {
  assert.equal(parseEngineVersion("0.9.28\n"), "0.9.28");
  assert.equal(parseEngineVersion("v10.2.3 extra"), "10.2.3");
  assert.equal(parseEngineVersion("nothing"), null);
  assert.equal(formatDuration(23_811), "24s");
  assert.equal(formatDuration(3_600_000), "1h 0m");
  assert.equal(formatDuration(null), "—");
  assert.equal(monthProjection(300, new Date(2026, 10, 10)), 900);
  assert.equal(monthProjection(300, new Date(2026, 10, 30)), 300);
});

test("sessionTitle falls back to a short id", () => {
  assert.equal(sessionTitle({ title: "  Hello  " }), "Hello");
  assert.equal(sessionTitle({ sessionId: "08428e29-d4fa" }), "Session 08428e29");
  assert.equal(sessionTitle({}), "Untitled session");
});

test("recentSessions orders the report's top sessions by spend", () => {
  const rows = recentSessions(
    {
      topSessions: [
        { sessionId: "older", project: "a", date: "2026-11-20", cost: 100 },
        { sessionId: "newer-cheap", project: "b", date: "2026-11-22", cost: 5 },
        { sessionId: "newer-costly", project: "c", date: "2026-11-22", cost: 20 },
      ],
    },
    3,
  );
  assert.deepEqual(rows.map((row) => row.sessionId), ["older", "newer-costly", "newer-cheap"]);
});
