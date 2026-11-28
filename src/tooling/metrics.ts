import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { loadManifests } from "./orca-ui-manifests.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA_VERSION = 3;

const GATES = { lintIncrease: 0, failedTests: 0 };
const MOD_COVERAGE_WARN_POINTS = 5;

export interface Counts {
  covered: number;
  total: number;
}

export interface ViteMetrics {
  lines: Counts;
  branches: Counts;
  functions: Counts;
}

export interface SummaryRow {
  file: string;
  line: number;
  branch: number;
  funcs: number;
}

export interface CoverageRow {
  file: string;
  line: Counts;
  branch: Counts;
  funcs: Counts;
}

export interface SummaryInput {
  line?: number;
  lineCovered?: number;
  lineTotal?: number;
  branch?: number;
  branchCovered?: number;
  branchTotal?: number;
  funcs?: number;
  funcsCovered?: number;
  funcsTotal?: number;
  files?: number;
}

export interface Summary {
  line: number;
  lineCovered: number;
  lineTotal: number;
  branch: number;
  branchCovered: number;
  branchTotal: number;
  funcs: number;
  funcsCovered: number;
  funcsTotal: number;
}

export interface ModSummary extends Summary {
  files: number;
}

export interface TestsInput {
  tests?: number;
  pass?: number;
  fail: number;
  skipped?: number;
  durationMs?: number;
  executionError?: string;
}

export interface TypedTestTotals {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
}

export function mergeTestCounts(
  typed: TypedTestTotals,
  legacy: TestsInput,
  wrapperPassed: boolean,
): TestsInput {
  return {
    tests: (legacy.tests ?? 0) + Math.max(0, typed.numTotalTests - 1),
    pass: (legacy.pass ?? 0) + Math.max(0, typed.numPassedTests - Number(wrapperPassed)),
    fail: (legacy.fail ?? 0) + Math.max(0, typed.numFailedTests - Number(!wrapperPassed)),
    skipped: (legacy.skipped ?? 0) + typed.numPendingTests,
    durationMs: legacy.durationMs,
  };
}

export interface LintMessage {
  ruleId: string;
  message: string;
  line: number;
}

export interface LintFile {
  filePath: string;
  messages: LintMessage[];
}

export interface WorstComplexity {
  where: string;
  complexity: number;
}

export interface LintInput {
  total: number;
  byRule?: Record<string, number>;
  byArea: Record<string, number>;
  worstComplexity?: WorstComplexity[];
  error?: string;
}

export interface CoverageInput {
  definition?: string;
  overall: SummaryInput;
  byMod: Record<string, SummaryInput>;
  byFile?: Record<string, SummaryInput>;
}

export interface DriftInput {
  exitCode: number | null;
  lastLine?: string;
}

export interface SizeInput {
  sourceFiles: number;
  sourceLines: number;
  testLines: number;
}

export interface Verdict {
  ok: boolean;
  failures: string[];
  warnings: string[];
}

export interface ReportInput {
  schemaVersion?: number;
  generatedAt?: string;
  commit?: string;
  tests: TestsInput;
  coverage: CoverageInput;
  lint: LintInput;
  size?: SizeInput;
  drift: DriftInput;
  nextActions?: string[];
  verdict?: Verdict;
}

export interface Report extends ReportInput {
  schemaVersion: number;
  generatedAt: string;
  commit: string;
  size: SizeInput;
}

export interface Options {
  out: string | null;
  baseline: string;
  update: boolean;
  skipTests: boolean;
}

export interface OxlintLabel {
  span?: { line?: number };
}

export interface OxlintDiagnostic {
  filename?: string;
  code?: string;
  message?: string;
  labels?: OxlintLabel[];
}

export interface OxlintReport {
  diagnostics?: OxlintDiagnostic[];
  number_of_files?: number;
}

export function parseCoverage(text: string): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const stack: { depth: number; name: string }[] = [];
  for (const raw of text.split("\n")) {
    const m = raw.match(/^ℹ( +)([^|]+?)\s*\|\s*([\d.]*)\s*\|\s*([\d.]*)\s*\|\s*([\d.]*)\s*\|/);
    if (
      !m ||
      m[2] === "file" ||
      m[2].startsWith("start of") ||
      m[2].startsWith("end of") ||
      m[2] === "all files"
    )
      continue;
    const depth = Math.floor((m[1].length - 1) / 1);
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if (m[3] === "") {
      stack.push({ depth, name: m[2] });
      continue;
    }
    rows.push({
      file: [...stack.map((s) => s.name), m[2]].join("/"),
      line: Number(m[3]),
      branch: Number(m[4]),
      funcs: Number(m[5]),
    });
  }
  return rows;
}

export function parseTestSummary(text: string): TestsInput {
  const n = (key: string) => Number(text.match(new RegExp(`^ℹ ${key} (\\d+)`, "m"))?.[1] ?? 0);
  return {
    tests: n("tests"),
    pass: n("pass"),
    fail: n("fail"),
    skipped: n("skipped"),
    durationMs: Math.round(Number(text.match(/^ℹ duration_ms ([\d.]+)/m)?.[1] ?? 0)),
  };
}

export function parseViteCoverage(
  summary: Record<string, ViteMetrics>,
  root = ROOT,
): CoverageRow[] {
  return Object.entries(summary)
    .filter(([file]) => file !== "total")
    .map(([file, metrics]) => ({
      file: relative(root, file).split("\\").join("/"),
      line: { covered: Number(metrics.lines.covered), total: Number(metrics.lines.total) },
      branch: { covered: Number(metrics.branches.covered), total: Number(metrics.branches.total) },
      funcs: { covered: Number(metrics.functions.covered), total: Number(metrics.functions.total) },
    }));
}

function percent(covered: number, total: number): number {
  return total ? Math.round((covered / total) * 10000) / 100 : 100;
}

function sumCounts(rows: CoverageRow[], key: "line" | "branch" | "funcs"): Counts {
  return rows.reduce(
    (sum, row) => ({ covered: sum.covered + row[key].covered, total: sum.total + row[key].total }),
    { covered: 0, total: 0 },
  );
}

function coverageSummary(rows: CoverageRow[]): Summary {
  const line = sumCounts(rows, "line");
  const branch = sumCounts(rows, "branch");
  const funcs = sumCounts(rows, "funcs");
  return {
    line: percent(line.covered, line.total),
    lineCovered: line.covered,
    lineTotal: line.total,
    branch: percent(branch.covered, branch.total),
    branchCovered: branch.covered,
    branchTotal: branch.total,
    funcs: percent(funcs.covered, funcs.total),
    funcsCovered: funcs.covered,
    funcsTotal: funcs.total,
  };
}

function validateCoverageCounts(row: CoverageRow): void {
  for (const key of ["line", "branch", "funcs"] as const) {
    const { covered, total } = row[key];
    if (Number.isInteger(covered) && Number.isInteger(total) && covered >= 0 && total >= covered)
      continue;
    throw new Error(`invalid ${key} coverage counts for ${row.file}: ${covered}/${total}`);
  }
}

export function validateCoverageInventory(rows: CoverageRow[], expected: string[]): CoverageRow[] {
  const actual = rows.map((row) => row.file);
  const actualSet = new Set(actual);
  if (actualSet.size !== actual.length) throw new Error("duplicate canonical coverage rows");
  const wanted = new Set(expected);
  const unexpected = actual.filter((path) => !wanted.has(path));
  const missing = expected.filter((path) => !actualSet.has(path));
  if (unexpected.length || missing.length) {
    throw new Error(
      `coverage inventory mismatch; missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}`,
    );
  }
  rows.forEach(validateCoverageCounts);
  return rows;
}

function validateOxlintReport(report: OxlintReport): void {
  if (
    !Array.isArray(report?.diagnostics) ||
    typeof report.number_of_files !== "number" ||
    !Number.isInteger(report.number_of_files) ||
    report.number_of_files < 1
  ) {
    throw new Error("Oxlint did not report a nonempty file scope");
  }
}

function diagnosticLine(d: OxlintDiagnostic): number {
  const line = d.labels?.[0]?.span?.line;
  if (typeof line !== "number" || !Number.isInteger(line))
    throw new Error("Malformed Oxlint diagnostic");
  return line;
}

function diagnosticRuleId(code: string | undefined): string {
  return code?.match(/^eslint\(([^)]+)\)$/)?.[1] ?? code?.replace(/^eslint\//, "") ?? "parse";
}

function normalizeDiagnostic(d: OxlintDiagnostic, root: string): LintFile {
  if (typeof d.filename !== "string" || typeof d.message !== "string")
    throw new Error("Malformed Oxlint diagnostic");
  return {
    filePath: resolve(root, d.filename),
    messages: [{ ruleId: diagnosticRuleId(d.code), message: d.message, line: diagnosticLine(d) }],
  };
}

export function normalizeOxlint(report: OxlintReport, root = ROOT): LintFile[] {
  validateOxlintReport(report);
  const files = new Map<string, LintFile>();
  for (const d of report.diagnostics ?? []) {
    const normalized = normalizeDiagnostic(d, root);
    const current = files.get(normalized.filePath);
    if (current) current.messages.push(...normalized.messages);
    else files.set(normalized.filePath, normalized);
  }
  return [...files.values()];
}

export function summarizeLint(results: LintFile[], root = ROOT): LintInput {
  const byRule: Record<string, number> = {};
  const byArea: Record<string, number> = {};
  const worst: WorstComplexity[] = [];
  for (const file of results) {
    const rel = relative(root, file.filePath);
    const area = rel.startsWith("mods/") ? rel.split("/").slice(0, 2).join("/") : rel.split("/")[0];
    for (const m of file.messages) {
      byRule[m.ruleId ?? "parse"] = (byRule[m.ruleId ?? "parse"] ?? 0) + 1;
      byArea[area] = (byArea[area] ?? 0) + 1;
      const score =
        m.ruleId === "complexity" ? Number(m.message.match(/complexity of (\d+)/)?.[1]) : null;
      if (score) worst.push({ where: `${rel}:${m.line}`, complexity: score });
    }
  }
  return {
    total: Object.values(byRule).reduce((a, b) => a + b, 0),
    byRule,
    byArea,
    worstComplexity: worst
      .sort((a, b) => b.complexity - a.complexity || a.where.localeCompare(b.where))
      .slice(0, 8),
  };
}

export function coverageByMod(rows: CoverageRow[]): Record<string, ModSummary> {
  const groups: Record<string, CoverageRow[]> = {};
  for (const r of rows) {
    const key = r.file.startsWith("mods/")
      ? r.file.split("/").slice(0, 2).join("/")
      : r.file.split("/")[0];
    (groups[key] ??= []).push(r);
  }
  return Object.fromEntries(
    Object.entries(groups).map(([key, list]) => [
      key,
      { files: list.length, ...coverageSummary(list) },
    ]),
  );
}

export function coverageByFile(rows: CoverageRow[]): Record<string, Summary> {
  return Object.fromEntries(
    [...rows]
      .sort((a, b) => a.file.localeCompare(b.file))
      .map((row) => [row.file, coverageSummary([row])]),
  );
}

function lintFailures(current: ReportInput, baseline: ReportInput): string[] {
  const increase = current.lint.total - baseline.lint.total;
  return increase > GATES.lintIncrease
    ? [`lint findings rose by ${increase} (${baseline.lint.total} -> ${current.lint.total})`]
    : [];
}

function modCoverageWarnings(current: ReportInput, baseline: ReportInput): string[] {
  const warnings: string[] = [];
  if (baseline.coverage.definition !== current.coverage.definition) return warnings;
  for (const [mod, now] of Object.entries(current.coverage.byMod)) {
    const was = baseline.coverage.byMod[mod];
    if (was && (was.line ?? 0) - (now.line ?? 0) > MOD_COVERAGE_WARN_POINTS)
      warnings.push(`${mod}: line coverage ${was.line} -> ${now.line}`);
  }
  return warnings;
}

function areaLintWarnings(current: ReportInput, baseline: ReportInput): string[] {
  const warnings: string[] = [];
  for (const [area, n] of Object.entries(current.lint.byArea)) {
    if (n > (baseline.lint.byArea[area] ?? 0))
      warnings.push(`${area}: lint ${baseline.lint.byArea[area] ?? 0} -> ${n}`);
  }
  return warnings;
}

function againstBaseline(
  current: ReportInput,
  baseline: ReportInput,
): { failures: string[]; warnings: string[] } {
  return {
    failures: lintFailures(current, baseline),
    warnings: [...modCoverageWarnings(current, baseline), ...areaLintWarnings(current, baseline)],
  };
}

function currentQualityFailures(current: ReportInput): string[] {
  const failures: string[] = [];
  if (current.tests.fail > GATES.failedTests) failures.push(`${current.tests.fail} test(s) fail`);
  if (current.tests.executionError) failures.push(current.tests.executionError);
  if (current.lint.total < 0 || current.lint.error)
    failures.push("Oxlint did not produce a valid report");
  if (current.drift.exitCode !== 0) failures.push("build-orca-ui --check reports drift");
  return failures;
}

export function judge(current: ReportInput, baseline: ReportInput | null): Verdict {
  const failures = currentQualityFailures(current);
  const compared = baseline ? againstBaseline(current, baseline) : { failures: [], warnings: [] };
  failures.push(...compared.failures);
  return { ok: failures.length === 0, failures, warnings: compared.warnings };
}

export function nextActions(report: ReportInput): string[] {
  const actions: string[] = [];
  for (const [area, n] of Object.entries(report.lint.byArea)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3))
    actions.push(
      `Lint: ${area} has ${n} finding(s); run vp lint on it and fix the largest complexity first.`,
    );
  for (const w of (report.lint.worstComplexity ?? []).slice(0, 3))
    actions.push(`Complexity ${w.complexity} at ${w.where}: extract functions.`);
  const files = Object.entries(report.coverage.byFile ?? {})
    .filter(([, c]) => (c.line ?? 0) < 80)
    .sort((a, b) => (a[1].line ?? 0) - (b[1].line ?? 0))
    .slice(0, 3);
  const low = files.length
    ? files
    : Object.entries(report.coverage.byMod)
        .filter(([, c]) => (c.line ?? 0) < 80)
        .sort((a, b) => (a[1].line ?? 0) - (b[1].line ?? 0))
        .slice(0, 3);
  for (const [path, c] of low)
    actions.push(
      `Coverage: ${path} is at ${c.line}% lines; add behavior tests for its untested cases.`,
    );
  return actions.length
    ? actions
    : ["Nothing over threshold: tighten a gate in src/tooling/metrics.ts or in vite.config.ts."];
}

function run(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    ...options,
  }) as SpawnSyncReturns<string>;
}

function sizes(): SizeInput {
  let sourceFiles = 0,
    sourceLines = 0,
    testLines = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (name === "node_modules" || name.startsWith(".")) continue;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.d\.[cm]?ts$/.test(name)) continue;
      else if (/\.[cm]?[jt]s$/.test(name)) {
        const n = readFileSync(path, "utf8").split("\n").length;
        if (/\.test\.[cm]?[jt]s$/.test(name)) testLines += n;
        else {
          sourceFiles++;
          sourceLines += n;
        }
      }
    }
  };
  for (const top of ["mods", "orca-ui", "scripts", "src", "test"])
    if (existsSync(join(ROOT, top))) walk(join(ROOT, top));
  return { sourceFiles, sourceLines, testLines };
}

export function trackedTestFiles(text: string): string[] {
  return text
    .split("\0")
    .filter(
      (path) =>
        (/^(mods|scripts|orca-ui\/features)\//.test(path) && /\.test\.[cm]?js$/.test(path)) ||
        (/^test\//.test(path) && /\.test\.ts$/.test(path)),
    );
}

function readTestResults(
  reportPath: string,
  legacyPath: string,
  coverageDir: string,
  listed: string,
  result: SpawnSyncReturns<string>,
): { tests: TestsInput; rows: CoverageRow[] } {
  const typed = JSON.parse(readFileSync(reportPath, "utf8")) as {
    numTotalTests: number;
    numPassedTests: number;
    numFailedTests: number;
    numPendingTests: number;
  };
  const legacyResult = (
    existsSync(legacyPath)
      ? JSON.parse(readFileSync(legacyPath, "utf8"))
      : { stdout: "", stderr: "", status: 0 }
  ) as {
    stdout: string;
    stderr: string;
    status: number;
  };
  const legacy = parseTestSummary(`${legacyResult.stdout}\n${legacyResult.stderr}`);
  const coverageSummaryJson = JSON.parse(
    readFileSync(join(coverageDir, "coverage-summary.json"), "utf8"),
  ) as Record<string, ViteMetrics>;
  const rows = validateCoverageInventory(
    parseViteCoverage(coverageSummaryJson),
    canonicalSourceFiles(listed),
  );
  const wrapperPassed = legacyResult.status === 0;
  const tests = mergeTestCounts(typed, legacy, wrapperPassed);
  const errors: string[] = [];
  if (existsSync(legacyPath) && (!legacy.tests || legacyResult.status !== 0))
    errors.push(`legacy Node tests failed or emitted no summary (exit ${legacyResult.status})`);
  if (result.status !== 0) errors.push(`Vite+ tests/coverage failed (exit ${result.status})`);
  if (typed.numFailedTests > Number(!wrapperPassed))
    errors.push(`${typed.numFailedTests - Number(!wrapperPassed)} TypeScript test(s) failed`);
  return { tests: errors.length ? { ...tests, executionError: errors.join("; ") } : tests, rows };
}

function runViteCoverage(vp: string, reportPath: string, legacyPath: string, coverageDir: string) {
  return run(
    vp,
    [
      "test",
      "run",
      "test",
      "--coverage",
      "--coverage.autoAttachSubprocess",
      "--coverage.reporter=json-summary",
      `--coverage.reportsDirectory=${coverageDir}`,
      "--reporter=json",
      `--outputFile=${reportPath}`,
    ],
    {
      env: { ...process.env, ORCA_COVERAGE_MODE: "metrics", ORCA_LEGACY_REPORT: legacyPath },
    },
  );
}

function collectTests(): { tests: TestsInput; rows: CoverageRow[] } {
  const listed = run("git", [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    "mods",
    "scripts",
    "orca-ui",
    "src",
    "tools",
    "test",
  ]);
  if (listed.status !== 0) throw new Error("Cannot enumerate tracked tests: " + listed.stderr);
  const reportPath = join(tmpdir(), `herdr-tests-${process.pid}.json`);
  const legacyPath = join(tmpdir(), `herdr-legacy-tests-${process.pid}.json`);
  const coverageDir = join(tmpdir(), `herdr-v8-coverage-${process.pid}`);
  rmSync(reportPath, { force: true });
  rmSync(legacyPath, { force: true });
  rmSync(coverageDir, { recursive: true, force: true });
  const vp = process.env.VP_BIN ?? join(ROOT, "node_modules", ".bin", "vp");
  const result = runViteCoverage(vp, reportPath, legacyPath, coverageDir);
  try {
    return readTestResults(reportPath, legacyPath, coverageDir, listed.stdout, result);
  } catch (error) {
    return {
      tests: {
        tests: 0,
        pass: 0,
        fail: 1,
        skipped: 0,
        durationMs: 0,
        executionError: `Combined Vite+ coverage failed (exit ${result.status}): ${error instanceof Error ? error.message : String(error)}`,
      },
      rows: [],
    };
  } finally {
    rmSync(reportPath, { force: true });
    rmSync(legacyPath, { force: true });
    rmSync(coverageDir, { recursive: true, force: true });
  }
}

function canonicalSourceFiles(listed: string): string[] {
  const generated = new Set([...loadManifests().table.keys()]);
  return [
    ...new Set(
      listed
        .split("\0")
        .filter(
          (path) =>
            existsSync(join(ROOT, path)) &&
            /\.(?:js|mjs|cjs|ts|mts|cts)$/.test(path) &&
            !path.startsWith("test/") &&
            !/\.d\.ts$/.test(path) &&
            !/\.test\.[^/]+$/.test(path) &&
            !/(?:^|\/)(?:flow-harness|golden)\.(?:mjs|cjs|js)$/.test(path) &&
            !path.includes("/dist/") &&
            !generated.has(path),
        ),
    ),
  ].sort();
}

function collectLint(): LintInput {
  const vp = process.env.VP_BIN ?? join(ROOT, "node_modules", ".bin", "vp");
  const lintRun = run(vp, [
    "lint",
    "--format",
    "json",
    "mods",
    "scripts",
    "orca-ui",
    "src",
    "test",
  ]);
  try {
    if (lintRun.status !== 0 && lintRun.status !== 1) throw new Error("Oxlint execution failed");
    return summarizeLint(normalizeOxlint(JSON.parse(lintRun.stdout) as OxlintReport));
  } catch {
    return {
      total: -1,
      byRule: {},
      byArea: {},
      worstComplexity: [],
      error: (lintRun.stderr || "Oxlint produced no valid JSON").slice(0, 300),
    };
  }
}

function collect(options: { skipTests: boolean }): Report {
  let tests: TestsInput = { tests: 0, pass: 0, fail: 0, skipped: 0, durationMs: 0 };
  let rows: CoverageRow[] = [];
  if (!options.skipTests) ({ tests, rows } = collectTests());
  const lint = collectLint();
  const vpx = process.env.VPX_BIN ?? join(ROOT, "node_modules", ".bin", "vpx");
  const drift = run(vpx, ["src/tooling/build-orca-ui.ts", "--check", "--out", "."]);
  const commit = run("git", ["rev-parse", "--short", "HEAD"]).stdout.trim() || "unknown";
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    commit,
    tests,
    coverage: {
      definition: "canonical-source-counts-v1",
      overall: coverageSummary(rows),
      byMod: coverageByMod(rows),
      byFile: coverageByFile(rows),
    },
    lint,
    size: sizes(),
    drift: { exitCode: drift.status, lastLine: drift.stdout.trim().split("\n").pop() },
  };
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    out: null,
    baseline: join(ROOT, "metrics", "baseline.json"),
    update: false,
    skipTests: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = resolve(argv[++i] ?? "");
    else if (a === "--baseline") opts.baseline = resolve(argv[++i] ?? "");
    else if (a === "--update-baseline") opts.update = true;
    else if (a === "--skip-tests") opts.skipTests = true;
    else {
      console.error(`unknown argument ${a}`);
      process.exit(2);
    }
  }
  if (!opts.out) {
    console.error("--out is required");
    process.exit(2);
  }
  return opts;
}

function stableCopy(report: Report): Omit<Report, "verdict" | "nextActions" | "generatedAt"> {
  const copy: Record<string, unknown> = { ...report };
  for (const key of ["verdict", "nextActions", "generatedAt"]) delete copy[key];
  return copy as Omit<Report, "verdict" | "nextActions" | "generatedAt">;
}

function main(argv: string[]): void {
  const opts = parseArgs(argv);
  const report = collect(opts);
  const baseline = existsSync(opts.baseline)
    ? (JSON.parse(readFileSync(opts.baseline, "utf8")) as ReportInput)
    : null;
  report.nextActions = nextActions(report);
  const verdict = judge(report, opts.skipTests ? null : baseline);
  report.verdict = verdict;
  mkdirSync(opts.out as string, { recursive: true });
  writeFileSync(join(opts.out as string, "report.json"), JSON.stringify(report, null, 2) + "\n");
  if (opts.update) {
    mkdirSync(dirname(opts.baseline), { recursive: true });
    writeFileSync(opts.baseline, JSON.stringify(stableCopy(report), null, 2) + "\n");
  }
  console.log(JSON.stringify(report));
  process.exit(verdict.ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
