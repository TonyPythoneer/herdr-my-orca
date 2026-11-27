// Temporary migration-only parity check against the legacy gate; remove once cutover is verified.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { relative } from "node:path";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { normalizeOxlint } from "../../scripts/metrics.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const paths = ["mods", "scripts", "orca-ui"];
const vp = fileURLToPath(new URL("../../node_modules/.bin/vp", import.meta.url));
function run(label, command, args) {
  const start = performance.now();
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const elapsedMs = Math.round(performance.now() - start);
  if (result.error) throw result.error;
  writeFileSync(new URL("./dist/" + label + ".json", import.meta.url), result.stdout);
  writeFileSync(new URL("./dist/" + label + ".log", import.meta.url), result.stderr);
  assert.ok([0, 1].includes(result.status), result.stderr);
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { throw new Error(`${label}: ${result.stderr || result.stdout || "no diagnostic output"}`); }
  return { elapsedMs, exitCode: result.status, parsed };
}
function keys(files) {
  return files.flatMap(f => f.messages.map(d => `${relative(root, f.filePath)}:${d.line}:${d.ruleId ?? "parse"}`)).sort();
}
const legacy = run("eslint", "npx", ["--yes", "eslint@9", "-c", "eslint.config.mjs", "--format", "json", ...paths]);
const next = run("oxlint", vp, ["lint", "--format", "json", ...paths]);
const a = keys(legacy.parsed), b = keys(normalizeOxlint(next.parsed, root));
const equal = JSON.stringify(a) === JSON.stringify(b);
const summary = { eslint: { elapsedMs: legacy.elapsedMs, exitCode: legacy.exitCode, findings: a.length }, oxlint: { elapsedMs: next.elapsedMs, exitCode: next.exitCode, findings: b.length }, exactRuleFileLineParity: equal, legacyOnly: a.filter(x => !b.includes(x)), oxlintOnly: b.filter(x => !a.includes(x)), note: "Includes process startup; ESLint npx may include dependency setup. Install is measured by a separate CI step." };
writeFileSync(new URL("./dist/lint-comparison.json", import.meta.url), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
assert.deepEqual(b, a, "diagnostic parity must include path, rule, line and multiplicity");
