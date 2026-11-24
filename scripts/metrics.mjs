#!/usr/bin/env node
// Collect the repo's quality numbers into one report that an AI (report.json) and a person
// (report.md) can both read, compare it with the committed baseline and say pass or fail.
//
// Usage: node scripts/metrics.mjs --out <dir> [--baseline <file>] [--update-baseline] [--skip-tests]
//   --out              folder for report.json and report.md (created)
//   --baseline         metrics/baseline.json by default; deltas and gates are computed against it
//   --update-baseline  write the new numbers to the baseline file (a deliberate, reviewed change)
//   --skip-tests       reuse nothing: only lint, size and the drift check (fast local look)
// Env: ESLINT_BIN picks the eslint binary (default `npx --yes eslint@9`).
// Exit 0 when every gate holds, 1 when a gate fails, 2 on a usage error.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = 1;
// A gate fails when the number moves the wrong way by more than its slack.
const GATES = { coverageDropPoints: 1, lintIncrease: 0, failedTests: 0 };
const MOD_COVERAGE_WARN_POINTS = 5;

// ---- parsing (pure, tested) ----

// `node --test --experimental-test-coverage` prints an indented table of directories and files.
export function parseCoverage(text) {
  const rows = [];
  const stack = [];
  for (const raw of text.split("\n")) {
    const m = raw.match(/^ℹ( +)([^|]+?)\s*\|\s*([\d.]*)\s*\|\s*([\d.]*)\s*\|\s*([\d.]*)\s*\|/);
    if (!m || m[2] === "file" || m[2].startsWith("start of") || m[2].startsWith("end of") || m[2] === "all files") continue;
    const depth = Math.floor((m[1].length - 1) / 1);
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if (m[3] === "") { stack.push({ depth, name: m[2] }); continue; }
    rows.push({ file: [...stack.map(s => s.name), m[2]].join("/"), line: Number(m[3]), branch: Number(m[4]), funcs: Number(m[5]) });
  }
  return rows;
}

export function parseTestSummary(text) {
  const n = key => Number(text.match(new RegExp(`^ℹ ${key} (\\d+)`, "m"))?.[1] ?? 0);
  return { tests: n("tests"), pass: n("pass"), fail: n("fail"), skipped: n("skipped"), durationMs: Math.round(Number(text.match(/^ℹ duration_ms ([\d.]+)/m)?.[1] ?? 0)) };
}

// eslint --format json -> counts by rule and by area, plus the worst complexity numbers.
export function summarizeLint(results, root = ROOT) {
  const byRule = {};
  const byArea = {};
  const worst = [];
  for (const file of results) {
    const rel = relative(root, file.filePath);
    const area = rel.startsWith("mods/") ? rel.split("/").slice(0, 2).join("/") : rel.split("/")[0];
    for (const m of file.messages) {
      byRule[m.ruleId ?? "parse"] = (byRule[m.ruleId ?? "parse"] ?? 0) + 1;
      byArea[area] = (byArea[area] ?? 0) + 1;
      const score = m.ruleId === "complexity" ? Number(m.message.match(/complexity of (\d+)/)?.[1]) : null;
      if (score) worst.push({ where: `${rel}:${m.line}`, complexity: score });
    }
  }
  return { total: Object.values(byRule).reduce((a, b) => a + b, 0), byRule, byArea, worstComplexity: worst.sort((a, b) => b.complexity - a.complexity).slice(0, 8) };
}

// Average a list of coverage rows by mod, so a mod with one bad file stands out.
export function coverageByMod(rows) {
  const groups = {};
  for (const r of rows) {
    const key = r.file.startsWith("mods/") ? r.file.split("/").slice(0, 2).join("/") : r.file.split("/")[0];
    (groups[key] ??= []).push(r);
  }
  const mean = (list, k) => Math.round((list.reduce((s, r) => s + r[k], 0) / list.length) * 100) / 100;
  return Object.fromEntries(Object.entries(groups).map(([k, list]) => [k, { files: list.length, line: mean(list, "line"), branch: mean(list, "branch"), funcs: mean(list, "funcs") }]));
}

// What got worse than the baseline: hard failures and softer warnings.
function againstBaseline(current, baseline) {
  const failures = [];
  const warnings = [];
  const lintDelta = current.lint.total - baseline.lint.total;
  if (lintDelta > GATES.lintIncrease) failures.push(`lint findings rose by ${lintDelta} (${baseline.lint.total} -> ${current.lint.total})`);
  const dropped = baseline.coverage.overall.line - current.coverage.overall.line;
  if (dropped > GATES.coverageDropPoints) failures.push(`line coverage fell ${dropped.toFixed(2)} points`);
  for (const [mod, now] of Object.entries(current.coverage.byMod)) {
    const was = baseline.coverage.byMod[mod];
    if (was && was.line - now.line > MOD_COVERAGE_WARN_POINTS) warnings.push(`${mod}: line coverage ${was.line} -> ${now.line}`);
  }
  for (const [area, n] of Object.entries(current.lint.byArea)) {
    if (n > (baseline.lint.byArea[area] ?? 0)) warnings.push(`${area}: lint ${baseline.lint.byArea[area] ?? 0} -> ${n}`);
  }
  return { failures, warnings };
}

// Compare numbers with a baseline and list what moved the wrong way.
export function judge(current, baseline) {
  const failures = [];
  if (current.tests.fail > GATES.failedTests) failures.push(`${current.tests.fail} test(s) fail`);
  if (current.drift.exitCode !== 0) failures.push("build-orca-ui --check reports drift");
  const compared = baseline ? againstBaseline(current, baseline) : { failures: [], warnings: [] };
  failures.push(...compared.failures);
  return { ok: failures.length === 0, failures, warnings: compared.warnings };
}

// What the next iteration of the improvement loop should look at, worst first.
export function nextActions(report) {
  const actions = [];
  for (const [area, n] of Object.entries(report.lint.byArea).sort((a, b) => b[1] - a[1]).slice(0, 3)) actions.push(`Lint: ${area} has ${n} finding(s); run eslint on it and fix the largest complexity first.`);
  for (const w of report.lint.worstComplexity.slice(0, 3)) actions.push(`Complexity ${w.complexity} at ${w.where}: extract functions.`);
  const low = Object.entries(report.coverage.byMod).filter(([, c]) => c.line < 80).sort((a, b) => a[1].line - b[1].line).slice(0, 3);
  for (const [mod, c] of low) actions.push(`Coverage: ${mod} is at ${c.line}% lines; write characterization tests before refactoring it.`);
  return actions.length ? actions : ["Nothing over threshold: tighten a gate in scripts/metrics.mjs or in eslint.config.mjs."];
}

export function toMarkdown(report, verdict, baseline) {
  const d = (now, was, digits = 0) => (was === undefined ? "" : ` (${now - was >= 0 ? "+" : ""}${(now - was).toFixed(digits)})`);
  const lines = [
    "<!-- orca-metrics -->",
    `## Quality report: ${verdict.ok ? "PASS" : "FAIL"}`,
    "",
    `Commit \`${report.commit}\` · generated ${report.generatedAt} · schema ${report.schemaVersion}`,
    "",
    "| Metric | Now |", "|---|---|",
    `| Tests | ${report.tests.pass}/${report.tests.tests} pass, ${report.tests.fail} fail, ${report.tests.durationMs} ms |`,
    `| Line coverage | ${report.coverage.overall.line}%${d(report.coverage.overall.line, baseline?.coverage.overall.line, 2)} · branch ${report.coverage.overall.branch}% · functions ${report.coverage.overall.funcs}% |`,
    `| Lint findings | ${report.lint.total}${d(report.lint.total, baseline?.lint.total)} |`,
    `| Source size | ${report.size.sourceLines} lines in ${report.size.sourceFiles} files; ${report.size.testLines} lines of tests |`,
    `| Drift check | ${report.drift.exitCode === 0 ? "clean" : "DRIFT"} |`,
    "",
  ];
  if (verdict.failures.length) lines.push("**Failures**", ...verdict.failures.map(f => `- ${f}`), "");
  if (verdict.warnings.length) lines.push("**Warnings**", ...verdict.warnings.map(w => `- ${w}`), "");
  lines.push("**Next actions for the improvement loop**", ...report.nextActions.map(a => `- ${a}`), "", "_Full numbers: `report.json` in the workflow artifact._");
  return lines.join("\n") + "\n";
}

// ---- collection (shells out) ----

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28, ...options });
}

function sizes() {
  let sourceFiles = 0, sourceLines = 0, testLines = 0;
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (name === "node_modules" || name.startsWith(".")) continue;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.m?js$/.test(name)) {
        const n = readFileSync(path, "utf8").split("\n").length;
        if (/\.test\.m?js$/.test(name)) testLines += n; else { sourceFiles++; sourceLines += n; }
      }
    }
  };
  for (const top of ["mods", "orca-ui", "scripts"]) walk(join(ROOT, top));
  return { sourceFiles, sourceLines, testLines };
}

function collect({ skipTests }) {
  let tests = { tests: 0, pass: 0, fail: 0, skipped: 0, durationMs: 0 };
  let rows = [];
  if (!skipTests) {
    const out = run(process.execPath, ["--test", "--experimental-test-coverage", "--test-coverage-exclude=**/*.test.*", "mods", "scripts", "orca-ui/features"]);
    const text = out.stdout + out.stderr;
    tests = parseTestSummary(text);
    rows = parseCoverage(text);
  }
  const overallRow = rows.length ? { line: 0, branch: 0, funcs: 0 } : { line: 0, branch: 0, funcs: 0 };
  for (const k of ["line", "branch", "funcs"]) overallRow[k] = rows.length ? Math.round((rows.reduce((s, r) => s + r[k], 0) / rows.length) * 100) / 100 : 0;
  const eslint = process.env.ESLINT_BIN ? [process.env.ESLINT_BIN] : ["npx", "--yes", "eslint@9"];
  const lintRun = run(eslint[0], [...eslint.slice(1), "-c", "eslint.config.mjs", "--format", "json", "mods", "scripts", "orca-ui"]);
  let lint;
  try { lint = summarizeLint(JSON.parse(lintRun.stdout)); } catch { lint = { total: -1, byRule: {}, byArea: {}, worstComplexity: [], error: (lintRun.stderr || "eslint produced no JSON").slice(0, 300) }; }
  const drift = run(process.execPath, ["scripts/build-orca-ui.mjs", "--check", "--out", "."]);
  const commit = run("git", ["rev-parse", "--short", "HEAD"]).stdout.trim() || "unknown";
  return {
    schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(), commit, tests,
    coverage: { overall: overallRow, byMod: coverageByMod(rows) }, lint, size: sizes(),
    drift: { exitCode: drift.status, lastLine: drift.stdout.trim().split("\n").pop() },
  };
}

function parseArgs(argv) {
  const opts = { out: null, baseline: join(ROOT, "metrics", "baseline.json"), update: false, skipTests: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = resolve(argv[++i] ?? "");
    else if (a === "--baseline") opts.baseline = resolve(argv[++i] ?? "");
    else if (a === "--update-baseline") opts.update = true;
    else if (a === "--skip-tests") opts.skipTests = true;
    else { console.error(`unknown argument ${a}`); process.exit(2); }
  }
  if (!opts.out) { console.error("--out is required"); process.exit(2); }
  return opts;
}

// The baseline keeps the numbers only, not the verdict, the advice or the clock.
function stableCopy(report) {
  const copy = { ...report };
  for (const key of ["verdict", "nextActions", "generatedAt"]) delete copy[key];
  return copy;
}

function main(argv) {
  const opts = parseArgs(argv);
  const report = collect(opts);
  const baseline = existsSync(opts.baseline) ? JSON.parse(readFileSync(opts.baseline, "utf8")) : null;
  report.nextActions = nextActions(report);
  const verdict = judge(report, opts.skipTests ? null : baseline);
  report.verdict = verdict;
  mkdirSync(opts.out, { recursive: true });
  writeFileSync(join(opts.out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(opts.out, "report.md"), toMarkdown(report, verdict, baseline));
  if (opts.update) {
    mkdirSync(dirname(opts.baseline), { recursive: true });
    writeFileSync(opts.baseline, JSON.stringify(stableCopy(report), null, 2) + "\n");
  }
  console.log(readFileSync(join(opts.out, "report.md"), "utf8"));
  process.exit(verdict.ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
