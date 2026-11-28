import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { gatewayReadings } from "../../../src/mods/orca-status-bar/gateway-usage.js";

test("gateway events count attempts in the last hour, skipping duplicates, future and malformed rows", () => {
  const now = 1_000_000_000_000;
  const lines = [
    JSON.stringify({
      version: 1,
      kind: "attempt",
      provider: "p",
      model: "m",
      id: "1",
      timestamp: now + 99_999,
    }),
    JSON.stringify({
      version: 2,
      kind: "attempt",
      provider: "p",
      model: "m",
      id: "2",
      timestamp: now,
    }),
    JSON.stringify({
      version: 1,
      kind: "attempt",
      provider: "p",
      model: "m",
      id: "3",
      timestamp: now,
    }),
    JSON.stringify({
      version: 1,
      kind: "attempt",
      provider: "p",
      model: "m",
      id: "3",
      timestamp: now,
    }),
    "not json",
    "null",
  ].join("\n");
  assert.deepEqual(gatewayReadings([lines, null], now), [
    {
      provider: "p",
      gatewayKey: "gateway:p",
      status: "ok",
      label: "",
      detail: true,
      buckets: [],
      text: "1 req 1h",
      tooltip: "Local gateway deployment attempts in the last 60 minutes.",
    },
  ]);
});
