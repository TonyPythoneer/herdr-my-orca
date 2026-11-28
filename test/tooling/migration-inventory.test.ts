import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import { inspectMigrationInventory } from "../../src/tooling/migration-inventory.ts";

it("separates authored source and tests while excluding generated delivery files", () => {
  const inventory = inspectMigrationInventory(
    [
      "scripts/legacy.mjs",
      "scripts/legacy.test.js",
      "mods/orca-demo/main.js",
      "mods/orca-demo/flow-harness.mjs",
      "mods/orca-demo/generated.js",
    ],
    ["mods/orca-demo/main.js", "mods/orca-demo/generated.js"],
    {
      sources: ["scripts/legacy.mjs", "mods/orca-demo/main.js"],
      tests: ["scripts/legacy.test.js", "mods/orca-demo/flow-harness.mjs"],
    },
  );
  assert.deepEqual(inventory, {
    sources: ["scripts/legacy.mjs"],
    tests: ["mods/orca-demo/flow-harness.mjs", "scripts/legacy.test.js"],
    unexpected: [],
  });
});

it("rejects newly introduced legacy sources or tests but allows removed legacy paths", () => {
  const inventory = inspectMigrationInventory(
    ["scripts/legacy.mjs", "scripts/new-tool.js", "test/new-test.test.mjs"],
    [],
    {
      sources: ["scripts/legacy.mjs", "scripts/removed-tool.js"],
      tests: [],
    },
  );
  assert.deepEqual(inventory.unexpected, ["scripts/new-tool.js", "test/new-test.test.mjs"]);
  assert.deepEqual(inventory.sources, ["scripts/legacy.mjs", "scripts/new-tool.js"]);
  assert.deepEqual(inventory.tests, ["test/new-test.test.mjs"]);
});
