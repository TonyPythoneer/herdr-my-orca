// Candidate-only diagnostic comparison; existing ESLint remains authoritative.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import eslintConfig from "../../eslint.config.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const config = eslintConfig[0];
const candidateConfig = new URL("./dist/oxlint-comparison.json", import.meta.url);
writeFileSync(candidateConfig, JSON.stringify({
  categories: { correctness: "off" },
  rules: config.rules,
  ignorePatterns: config.ignores,
}, null, 2));
const paths = ["mods", "scripts", "orca-ui"];
const vp = fileURLToPath(new URL("./node_modules/.bin/vp", import.meta.url));
function run(label, command, args) {
  const start = performance.now();
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const elapsedMs = Math.round(performance.now() - start);
  if (result.error) throw result.error;
  writeFileSync(new URL("./dist/" + label + ".json", import.meta.url), result.stdout);
  writeFileSync(new URL("./dist/" + label + ".log", import.meta.url), result.stderr);
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { parsed = null; }
  return { elapsedMs, exitCode: result.status, parsed };
}
const legacy = run("eslint", "npx", ["--yes", "eslint@9", "-c", "eslint.config.mjs", "--format", "json", ...paths]);
const next = run("oxlint", vp, ["lint", "-c", fileURLToPath(candidateConfig), "--format", "json", ...paths]);
const oldCount = Array.isArray(legacy.parsed) ? legacy.parsed.reduce((n, f) => n + f.messages.length, 0) : null;
const newCount = Array.isArray(next.parsed?.diagnostics) ? next.parsed.diagnostics.length : null;
const summary = { eslint: { elapsedMs: legacy.elapsedMs, exitCode: legacy.exitCode, findings: oldCount }, oxlint: { elapsedMs: next.elapsedMs, exitCode: next.exitCode, findings: newCount }, note: "Includes process startup; ESLint npx may include dependency setup. Inspect raw diagnostics; counts alone are not parity." };
writeFileSync(new URL("./dist/lint-comparison.json", import.meta.url), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
if (oldCount === null || newCount === null || ![0, 1].includes(legacy.exitCode) || ![0, 1].includes(next.exitCode)) process.exitCode = 1;
