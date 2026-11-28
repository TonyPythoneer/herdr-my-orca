import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifests } from "./orca-ui-manifests.js";

export interface MigrationInventoryBaseline {
  sources: string[];
  tests: string[];
}

export interface MigrationInventory {
  sources: string[];
  tests: string[];
  unexpected: string[];
}

const LEGACY_EXTENSION = /\.(?:js|mjs|cjs)$/;
const TEST_FILE = /(?:^|\/)[^/]+\.(?:test|spec)\.(?:js|mjs|cjs)$/;
const MOD_TEST_FILE = /(?:^|\/)(?:golden|flow-harness)\.mjs$/;

export function inspectMigrationInventory(
  paths: string[],
  generatedPaths: Iterable<string>,
  baseline: MigrationInventoryBaseline,
): MigrationInventory {
  const generated = new Set(generatedPaths);
  const current = [
    ...new Set(paths.filter((path) => LEGACY_EXTENSION.test(path) && !generated.has(path))),
  ].sort();
  const tests = current.filter(
    (path) => TEST_FILE.test(path) || (path.startsWith("mods/") && MOD_TEST_FILE.test(path)),
  );
  const testSet = new Set(tests);
  const sources = current.filter((path) => !testSet.has(path));
  const allowed = new Set([...baseline.sources, ...baseline.tests]);
  const unexpected = current.filter((path) => !allowed.has(path));
  return { sources, tests, unexpected };
}

function main(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const baseline = JSON.parse(
    readFileSync(resolve(root, "metrics/migration-inventory.json"), "utf8"),
  ) as MigrationInventoryBaseline;
  const paths = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter((path) => path && existsSync(resolve(root, path)));
  const generated = loadManifests({ root }).table.keys();
  const inventory = inspectMigrationInventory(paths, generated, baseline);
  console.log(
    `Legacy authored sources: ${inventory.sources.length}; tests: ${inventory.tests.length}`,
  );
  if (inventory.unexpected.length) {
    console.error(
      `New legacy JavaScript paths need migration or an explicit baseline update:\n${inventory.unexpected.join("\n")}`,
    );
    process.exitCode = 1;
  }
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) main();
