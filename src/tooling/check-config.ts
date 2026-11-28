import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "./check-config-core.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const trackedPaths = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
export const result = validateConfig({
  trackedPaths,
  readText: (path) => readFileSync(resolve(root, path), "utf8"),
});

export function reportResult(
  validation: typeof result,
  { onError = console.error, onSuccess = console.log } = {},
): void {
  if (validation.errors.length) {
    for (const error of validation.errors) onError(error);
  } else {
    onSuccess(
      `Validated ${validation.parsedCount} JSON files, ${validation.modCount} mod manifests and ${validation.layoutCount} layouts.`,
    );
  }
}

export function updateExitCode(
  validation: typeof result,
  target: { exitCode?: number | string | null } = process,
): void {
  if (validation.errors.length) target.exitCode = 1;
}

reportResult(result);
updateExitCode(result);
