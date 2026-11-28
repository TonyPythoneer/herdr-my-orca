import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatTokens,
  parseClaudeStatusLine,
  probeLocal,
} from "../../../src/mods/orca-status-bar/local-usage.js";
import type { ExecFn, ExecResult, UsageReading } from "../../../src/mods/orca-status-bar/usage.js";

const future = () => Math.floor(Date.now() / 1000) + 3600;

const HOUR = 3_600_000;
const DAY = 86_400_000;
type FreeUsageRow = { at: number; data: unknown; type?: string };
const freeUsage = (at: number, tokens: number): FreeUsageRow => ({
  at,
  data: {
    model: { providerID: "opencode", id: "deepseek-v4.1-flash-free" },
    tokens: { input: tokens, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  },
});
const freeLimit = (at: number, retryAfterMs: number): FreeUsageRow => ({
  at,
  data: { error: { type: "provider.free-limit", retryAfterMs } },
});
const shellExec =
  (home: string): ExecFn =>
  (_c, args) =>
    new Promise<ExecResult>((resolve) =>
      execFile("sh", args, { env: { ...process.env, HOME: home } }, (e, stdout) =>
        resolve({ code: e ? 1 : 0, stdout }),
      ),
    );
const opencodeDb = (rows: FreeUsageRow[]) => {
  const home = mkdtempSync(join(tmpdir(), "herdr-opencode-"));
  mkdirSync(join(home, ".local/share/opencode"), { recursive: true });
  const sql = ["create table session_message (type text, time_created integer, data text);"]
    .concat(
      rows.map(
        ({ at, data, type = "assistant" }) =>
          `insert into session_message values ('${type}', ${Math.round(at)}, '${JSON.stringify(data).replace(/'/g, "''")}');`,
      ),
    )
    .join("\n");
  execFileSync("sqlite3", [join(home, ".local/share/opencode/opencode.db")], { input: sql });
  return {
    home,
    reading: async (): Promise<UsageReading> => {
      const found = (await probeLocal(shellExec(home), new Set(["opencode"]))).find(
        (r) => r.provider === "opencode",
      );
      assert.ok(found);
      return found;
    },
    resetTime: (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString(),
  };
};
const lastNine = (now: number) => {
  const d = new Date(now);
  d.setHours(9, 0, 0, 0);
  return d.getTime() > now ? d.getTime() - DAY : d.getTime();
};

test("parseClaudeStatusLine reads the 5h and weekly windows", () => {
  const resets = future();
  const reading = parseClaudeStatusLine({
    five_hour: { used_percentage: 42.4, resets_at: resets },
    seven_day: { used_percentage: 7, resets_at: resets },
  });
  assert.ok(reading);
  assert.equal(reading.provider, "claude");
  assert.equal(reading.status, "ok");
  assert.deepEqual(
    reading.buckets.map((b) => b.label),
    ["5h", "wk"],
  );
  assert.deepEqual(
    reading.buckets.map((b) => b.usedPercent),
    [42, 7],
  );
  assert.equal(reading.buckets[0].windowMinutes, 300);
  assert.equal(reading.buckets[1].windowMinutes, 10080);
  assert.equal(reading.buckets[0].resetTime, new Date(resets * 1000).toISOString());
});

test("parseClaudeStatusLine accepts utilization, like Orca tolerates schema drift", () => {
  const reading = parseClaudeStatusLine({ five_hour: { utilization: 88 } });
  assert.ok(reading);
  assert.deepEqual(
    reading.buckets.map((b) => [b.label, b.usedPercent, b.resetTime]),
    [["5h", 88, null]],
  );
});

test("parseClaudeStatusLine keeps one window when the other is absent", () => {
  const reading = parseClaudeStatusLine({
    seven_day: { used_percentage: 12, resets_at: future() },
  });
  assert.ok(reading);
  assert.deepEqual(
    reading.buckets.map((b) => b.label),
    ["wk"],
  );
});

test("parseClaudeStatusLine shows an expired window as static 0% / 5h until new data", () => {
  const reading = parseClaudeStatusLine({ five_hour: { used_percentage: 90, resets_at: 1 } });
  assert.ok(reading);
  const [five] = reading.buckets;
  assert.deepEqual([five.usedPercent, five.resetTime, five.idleText], [0, null, "5h"]);
});

test("parseClaudeStatusLine reads resets_at in seconds, milliseconds or ISO", () => {
  const at = Math.floor((Date.now() + 3600_000) / 1000) * 1000;
  const iso = new Date(at).toISOString();
  for (const resets_at of [at / 1000, at, iso]) {
    const reading = parseClaudeStatusLine({ five_hour: { used_percentage: 5, resets_at } });
    assert.ok(reading);
    assert.equal(reading.buckets[0].resetTime, iso, String(resets_at));
  }
});

test("parseClaudeStatusLine returns null without usable windows", () => {
  assert.equal(parseClaudeStatusLine(null), null);
  assert.equal(parseClaudeStatusLine({}), null);
  assert.equal(parseClaudeStatusLine({ five_hour: {} }), null);
});

test("parseClaudeStatusLine clamps out-of-range percentages", () => {
  const reading = parseClaudeStatusLine({ five_hour: { used_percentage: 140 } });
  assert.ok(reading);
  assert.equal(reading.buckets[0].usedPercent, 100);
});

test("formatTokens keeps the bar short", () => {
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1500), "2k");
  assert.equal(formatTokens(2400000), "2.4M");
});

test("probeLocal shows an expired codex window as 0% as static 0% / 5h", async () => {
  const now = Math.floor(Date.now() / 1000);
  const codex = JSON.stringify({
    primary: { window_minutes: 300, used_percent: 34, resets_at: now - 60 },
    secondary: { window_minutes: 10080, used_percent: 68, resets_at: now + 3600 },
  });
  const exec: ExecFn = async (_c, [, script]) => ({
    code: 0,
    stdout: script.includes(".codex") ? codex : "",
  });
  const codexReading = (await probeLocal(exec)).find((r) => r.provider === "codex");
  assert.ok(codexReading);
  const [five, week] = codexReading.buckets;
  assert.equal(five.usedPercent, 0);
  assert.equal(five.resetTime, null);
  assert.equal(five.idleText, "5h");
  assert.equal(week.idleText, undefined);
  assert.equal(week.usedPercent, 68);
});

test("Codex uses an older session until the newest has rate limits", async () => {
  const home = mkdtempSync(join(tmpdir(), "herdr-codex-"));
  try {
    const dir = join(home, ".codex/sessions/2026/11/21");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(home, ".codex/auth.json"), "{}");
    const older = join(dir, "older.jsonl");
    const newer = join(dir, "newer.jsonl");
    const limits = (used: number) =>
      JSON.stringify({ rate_limits: { primary: { window_minutes: 300, used_percent: used } } });
    writeFileSync(older, limits(23) + "\n");
    writeFileSync(newer, "{}\n");
    utimesSync(older, 1, 1);
    const exec = shellExec(home);
    const percentage = async () =>
      (await probeLocal(exec, new Set(["codex"])))[0]?.buckets[0].usedPercent;
    assert.equal(await percentage(), 23);
    writeFileSync(newer, limits(45) + "\n");
    assert.equal(await percentage(), 45);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("opencode counts from the projected reset, not the 9:00 fallback or an extra day", async () => {
  const now = Math.floor(Date.now() / 1000) * 1000;
  const boundary = now - 5 * HOUR - 17 * 60_000;
  const db = opencodeDb([
    freeLimit(boundary - 26 * HOUR, 2 * HOUR),
    freeUsage(boundary - 3 * HOUR, 3000),
    freeUsage(boundary - 1000, 5000),
    freeUsage(boundary, 400),
    freeUsage(boundary + 60_000, 200),
  ]);
  try {
    const reading = await db.reading();
    assert.equal(reading.text, "600 tokens", "only rows at or after the reset count");
    assert.equal(reading.resetTime, db.resetTime(boundary + DAY));
  } finally {
    rmSync(db.home, { recursive: true, force: true });
  }
});

test("opencode steps the newest 429 back when its reset is still ahead", async () => {
  const now = Math.floor(Date.now() / 1000) * 1000;
  const reset = now - 10 * 60_000 + 23 * HOUR + 50 * 60_000;
  const db = opencodeDb([
    freeLimit(now - 10 * 60_000, 23 * HOUR + 50 * 60_000),
    freeUsage(reset - DAY - 60_000, 900),
    freeUsage(reset - DAY + 60_000, 250),
  ]);
  try {
    const reading = await db.reading();
    assert.equal(reading.text, "250 tokens", "the window starts 24h before the announced reset");
    assert.equal(reading.resetTime, db.resetTime(reset), "next reset is the first one after now");
  } finally {
    rmSync(db.home, { recursive: true, force: true });
  }
});

test("opencode falls back to the most recent local 9:00 with no 429 at all", async () => {
  const now = Math.floor(Date.now() / 1000) * 1000;
  const nine = lastNine(now);
  const db = opencodeDb([
    freeUsage(nine - HOUR, 4000),
    freeUsage(nine + Math.floor((now - nine) / 2), 700),
  ]);
  try {
    const reading = await db.reading();
    assert.equal(reading.text, "700 tokens");
    assert.equal(reading.resetTime, db.resetTime(nine + DAY));
  } finally {
    rmSync(db.home, { recursive: true, force: true });
  }
});

test("opencode counts compaction rows but not other row types", async () => {
  const now = Math.floor(Date.now() / 1000) * 1000;
  const boundary = now - 2 * HOUR;
  const db = opencodeDb([
    freeLimit(boundary - DAY, 0),
    freeUsage(boundary + HOUR, 2000),
    { ...freeUsage(boundary + HOUR, 500), type: "compaction" },
    { ...freeUsage(boundary + HOUR, 7000), type: "user" },
  ]);
  try {
    assert.equal((await db.reading()).text, "3k tokens", "2000 + 500 compaction, not the user row");
  } finally {
    rmSync(db.home, { recursive: true, force: true });
  }
});

test("opencode reads inactive only for a reset window with no free-model use", async () => {
  const now = Math.floor(Date.now() / 1000) * 1000;
  const boundary = now - 2 * HOUR;
  const used = opencodeDb([
    freeLimit(boundary - 26 * HOUR, 2 * HOUR),
    freeUsage(boundary + 60_000, 5),
  ]);
  const fresh = opencodeDb([freeLimit(boundary - 26 * HOUR, 2 * HOUR)]);
  const bare = opencodeDb([]);
  try {
    assert.equal((await used.reading()).text, "5 tokens");
    const idle = await fresh.reading();
    assert.equal(idle.text, "inactive");
    assert.equal(
      idle.resetTime,
      fresh.resetTime(boundary + DAY),
      "the countdown still ends the window",
    );
    assert.equal((await bare.reading()).text, "0 tokens", "no 429 ever: the chip keeps its count");
  } finally {
    for (const db of [used, fresh, bare]) rmSync(db.home, { recursive: true, force: true });
  }
});

test("probeLocal skips providers whose CLI is not installed", async () => {
  const ran: string[] = [];
  const exec: ExecFn = async (_c, [, script]) => {
    ran.push(
      script.includes(".codex") ? "codex" : script.includes("opencode") ? "opencode" : "claude",
    );
    return { code: 0, stdout: "" };
  };
  await probeLocal(exec, new Set(["opencode"]));
  assert.deepEqual(ran, ["opencode"]);
});

test("the claude and codex probes print nothing when signed out", async () => {
  const home = mkdtempSync(join(tmpdir(), "herdr-login-"));
  const exec: ExecFn = (_c, args) =>
    new Promise<ExecResult>((resolve) =>
      execFile("sh", args, { env: { HOME: home, PATH: "/usr/bin:/bin" } }, (e, stdout) =>
        resolve({ code: e ? 1 : 0, stdout }),
      ),
    );
  const rows = await probeLocal(exec, new Set(["claude", "codex"]));
  assert.deepEqual(
    rows.map((r) => r.provider),
    [],
  );
});

test("a non-object claude status line keeps the legacy null reading", () => {
  assert.equal(parseClaudeStatusLine("live"), null);
  assert.equal(parseClaudeStatusLine(42), null);
});

test("a claude API snapshot with object-shaped limits adds the per-model windows", async () => {
  const future = 4102444800;
  const stdout = JSON.stringify({
    live: null,
    api: {
      five_hour: { used_percentage: 10, resets_at: future },
      seven_day: { used_percentage: 20, resets_at: future },
      limits: {
        five_hour: { used_percentage: 1 },
        seven_day: { used_percentage: 2 },
        seven_day_fable: { used_percentage: 12, resets_at: future },
        seven_day_: { used_percentage: 3 },
        plain: { used_percentage: "x" },
      },
    },
  });
  const rows = await probeLocal(
    async (_c, [, script]) => ({
      code: 0,
      stdout: script.includes("security") ? stdout : "",
    }),
    new Set(["claude"]),
  );
  assert.deepEqual(
    rows.map((r) => r.buckets.map((b) => [b.id, b.label, b.usedPercent, b.resetTime])),
    [
      [
        ["5h", "5h", 10, "2100-01-01T00:00:00.000Z"],
        ["7d", "wk", 20, "2100-01-01T00:00:00.000Z"],
        ["seven_day_fable", "Fable", 12, "2100-01-01T00:00:00.000Z"],
        ["seven_day_", "wk", 3, null],
      ],
    ],
  );
});

test("live windows keep the API's per-model windows and skip them for bedrock", async () => {
  const future = 4102444800;
  const live = {
    five_hour: { used_percentage: 30, resets_at: future },
    seven_day: { used_percentage: 40, resets_at: future },
  };
  const arrayApi = {
    limits: [
      { kind: "session", percent: 1, resets_at: future },
      { kind: "weekly_all", percent: 2, resets_at: future },
      { kind: "model", percent: 5, resets_at: future, scope: { model: { display_name: "Fable" } } },
    ],
  };
  const objectApi = { limits: { seven_day_fable: { used_percentage: 12, resets_at: future } } };
  const probe = (api: unknown) =>
    probeLocal(
      async (_c, [, script]) => ({
        code: 0,
        stdout: script.includes("security") ? JSON.stringify({ live, api }) : "",
      }),
      new Set(["claude"]),
    );
  const [withArray] = await probe(arrayApi);
  assert.deepEqual(
    withArray.buckets.map((b) => [b.id, b.label, b.usedPercent]),
    [
      ["5h", "5h", 30],
      ["7d", "wk", 40],
      ["model", "Fable", 5],
    ],
  );
  const [withBedrock] = await probe({ bedrock: true, limits: {} });
  assert.deepEqual(
    withBedrock.buckets.map((b) => b.id),
    ["5h", "7d"],
  );
  const [withObject] = await probe(objectApi);
  assert.deepEqual(
    withObject.buckets.map((b) => [b.id, b.label]),
    [
      ["5h", "5h"],
      ["7d", "wk"],
      ["seven_day_fable", "Fable"],
    ],
  );
});

test("a probe that throws or prints broken JSON reads as nothing signed in", async () => {
  const thrown = await probeLocal(
    async () => {
      throw Error("no shell");
    },
    new Set(["claude"]),
  );
  assert.deepEqual(thrown, []);
  const broken = await probeLocal(async () => ({ code: 0, stdout: "{bad" }), new Set(["claude"]));
  assert.deepEqual(broken, []);
});
