import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { railRows } from "../../../src/mods/orca-agent-settings/agent-rail.ts";

test("installed first, stable when toggling", () => {
  const rows: Array<{ key: string; installed: boolean; enabled?: boolean }> = [
    { key: "a", installed: false },
    { key: "b", installed: true, enabled: false },
    { key: "c", installed: true, enabled: true },
  ];
  assert.deepEqual(
    railRows(rows).map((row) => row.key),
    ["b", "c", "a"],
  );
  rows[1].enabled = true;
  assert.deepEqual(
    railRows(rows).map((row) => row.key),
    ["b", "c", "a"],
  );
});
