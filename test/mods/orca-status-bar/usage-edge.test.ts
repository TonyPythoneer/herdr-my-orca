import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  formatTokens,
  parseClaudeStatusLine,
  probeLocal,
} from "../../../src/mods/orca-status-bar/local-usage.js";
import {
  parseAntigravityOutput,
  parseOmpUsage,
  type ExecFn,
} from "../../../src/mods/orca-status-bar/usage.js";

test("local windows retain legacy labels, model names and custom Codex durations", async () => {
  const limits = [
    { kind: "session" },
    { kind: "weekly_all" },
    { kind: "model", scope: { model: { display_name: "Fable" } } },
    { kind: "other" },
  ];
  const exec: ExecFn = async (_cmd, [, script]) => ({
    code: 0,
    stdout: JSON.stringify(
      script.includes(".codex")
        ? { primary: { window_minutes: 90, used_percent: 2 } }
        : { api: { limits } },
    ),
  });
  const [claude, codex] = await probeLocal(exec, new Set(["claude", "codex"]));
  assert.deepEqual(
    claude.buckets.map((b) => b.label),
    ["5h", "wk", "Fable", "other"],
  );
  assert.equal(codex.buckets[0].label, "90m");
  assert.equal(parseOmpUsage("log: {broken}"), null);
});

test("antigravity parsing skips malformed groups and buckets and clamps the used share", () => {
  const groups = [
    null,
    { name: 3 },
    { name: "no buckets" },
    {
      name: "Claude and GPT models",
      buckets: [
        null,
        { remaining_fraction: "x" },
        { id: "a", name: "N", window: "weekly", remaining_fraction: 0.25, reset_time: "t" },
        { window: "5h", remaining_fraction: 2 },
        { window: "other", remaining_fraction: -1 },
      ],
    },
  ];
  const parsed = parseAntigravityOutput(JSON.stringify({ command: { data: { groups } } }));
  assert.ok(parsed);
  assert.deepEqual(
    parsed.buckets.map((b) => [b.id, b.windowMinutes, b.usedPercent, b.resetTime]),
    [
      ["a", 10080, 75, "t"],
      ["", 300, 0, null],
      ["", 0, 100, null],
    ],
  );
  const bad: unknown[] = [
    undefined,
    "",
    "{",
    "{}",
    JSON.stringify({ command: { data: { groups: [] } } }),
    JSON.stringify({ command: { data: { groups: [{ name: "g", buckets: [{}] }] } } }),
  ];
  for (const value of bad) assert.equal(parseAntigravityOutput(value), null);
});

test("omp usage keeps provider windows, names unmetered providers unavailable and ignores notices", () => {
  const reports = [
    null,
    { provider: 3 },
    { provider: "idle", limits: {} },
    {
      provider: "claude",
      limits: [
        null,
        { amount: { usedFraction: "x" } },
        { amount: { usedFraction: Infinity } },
        {
          id: "i",
          label: "Label",
          amount: { usedFraction: 0.5 },
          window: { label: "5h", durationMs: 18_000_000, resetsAt: "r" },
        },
        { amount: { usedFraction: 1.5 }, window: { durationMs: -1 } },
      ],
    },
  ];
  const readings = parseOmpUsage(`update available\n${JSON.stringify({ reports })}\nbye`);
  assert.ok(readings);
  assert.deepEqual(
    readings.map((r) => [r.provider, r.status]),
    [
      ["idle", "unavailable"],
      ["claude", "ok"],
    ],
  );
  assert.deepEqual(readings[1].buckets, [
    { id: "i", name: "5h", windowMinutes: 300, usedPercent: 50, resetTime: "r" },
    { id: "", name: "", windowMinutes: 0, usedPercent: 100, resetTime: null },
  ]);
  for (const bad of ["{}", "}{", '{"reports": []}', '{"reports": {}}']) {
    assert.equal(parseOmpUsage(bad), null);
  }
});

test("token counts and Claude status line windows format at every threshold", () => {
  assert.deepEqual([0, 999, 1000, 1499, 1500, 999_999, 1e6, 2.55e6].map(formatTokens), [
    "0",
    "999",
    "1k",
    "1k",
    "2k",
    "1000k",
    "1.0M",
    "2.5M",
  ]);
  assert.equal(parseClaudeStatusLine(null), null);
  assert.equal(parseClaudeStatusLine({ five_hour: { used_percentage: "x" } }), null);
  const live = parseClaudeStatusLine({
    five_hour: { used_percentage: 3, resets_at: 4102444800 },
    seven_day: { utilization: 5 },
  });
  assert.ok(live);
  assert.deepEqual(
    live.buckets.map((b) => [b.id, b.label, b.usedPercent]),
    [
      ["5h", "5h", 3],
      ["7d", "wk", 5],
    ],
  );
});
