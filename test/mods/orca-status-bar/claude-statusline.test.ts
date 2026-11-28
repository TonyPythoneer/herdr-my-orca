import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type Window = { used_percentage: number; resets_at: number };
type Cache = { five_hour: Window; seven_day: Window };

const script = fileURLToPath(
  new URL("../../../mods/orca-status-bar/claude-statusline.sh", import.meta.url),
);

const run = (cache: string, session: string, rateLimits: unknown) =>
  execFileSync("sh", [script], {
    input: JSON.stringify({ session_id: session, rate_limits: rateLimits }),
    env: { ...process.env, HERDR_USAGE_CACHE: cache, HERDR_STATUSLINE: "true" },
    stdio: ["pipe", "ignore", "ignore"],
  });

const cacheOf = (cache: string): Cache =>
  JSON.parse(readFileSync(join(cache, "claude-statusline.json"), "utf8")) as Cache;

const fresh = () => mkdtempSync(join(tmpdir(), "herdr-statusline-"));

test("a quiet session cannot lower the windows another session reported", () => {
  const cache = fresh();
  try {
    run(cache, "active", {
      five_hour: { used_percentage: 100, resets_at: 1_794_802_200 },
      seven_day: { used_percentage: 57, resets_at: 1_795_237_200 },
    });
    run(cache, "quiet", { seven_day: { used_percentage: 0, resets_at: 1_795_237_200 } });

    const windows = cacheOf(cache);
    assert.equal(windows.five_hour.used_percentage, 100);
    assert.equal(windows.seven_day.used_percentage, 57);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

test("a window that reset replaces the old one even with a smaller number", () => {
  const cache = fresh();
  try {
    run(cache, "active", { five_hour: { used_percentage: 100, resets_at: 1_794_802_200 } });
    run(cache, "next", { five_hour: { used_percentage: 0, resets_at: 1_794_816_000 } });

    assert.deepEqual(cacheOf(cache).five_hour, { used_percentage: 0, resets_at: 1_794_816_000 });
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

test("a payload without rate_limits writes nothing", () => {
  const cache = fresh();
  try {
    execFileSync("sh", [script], {
      input: JSON.stringify({ session_id: "no-limits" }),
      env: { ...process.env, HERDR_USAGE_CACHE: cache, HERDR_STATUSLINE: "true" },
      stdio: ["pipe", "ignore", "ignore"],
    });
    assert.throws(() => readFileSync(join(cache, "claude-statusline.json")));
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

test("a payload without rate_limits still draws the status line", () => {
  const cache = fresh();
  try {
    const out = execFileSync("sh", [script], {
      input: JSON.stringify({ session_id: "no-limits" }),
      env: { ...process.env, HERDR_USAGE_CACHE: cache, HERDR_STATUSLINE: "echo DRAWN" },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    assert.equal(out.trim(), "DRAWN");
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});
