import test from "node:test";
import assert from "node:assert/strict";
import { coverageByMod, judge, nextActions, parseCoverage, parseTestSummary, summarizeLint, toMarkdown, trackedTestFiles } from "./metrics.mjs";

const COVERAGE = `ℹ start of coverage report
ℹ ------------------------------------------------------------
ℹ file               | line % | branch % | funcs % | uncovered lines
ℹ ------------------------------------------------------------
ℹ mods               |        |          |         |
ℹ  orca-files        |        |          |         |
ℹ   main.js          |  80.00 |    70.00 |   60.00 | 1-3
ℹ   util.js          | 100.00 |   100.00 |  100.00 |
ℹ  orca-tabs         |        |          |         |
ℹ   main.js          |  50.00 |    40.00 |   30.00 | 9
ℹ scripts            |        |          |         |
ℹ  build.mjs         |  90.00 |    80.00 |   70.00 |
ℹ ------------------------------------------------------------
ℹ all files          |  80.00 |    70.00 |   65.00 |
ℹ end of coverage report`;

test("the coverage table becomes one row per file with its directory path", () => {
  const rows = parseCoverage(COVERAGE);
  assert.deepEqual(rows.map(r => r.file), ["mods/orca-files/main.js", "mods/orca-files/util.js", "mods/orca-tabs/main.js", "scripts/build.mjs"]);
  assert.deepEqual(rows[0], { file: "mods/orca-files/main.js", line: 80, branch: 70, funcs: 60 });
  const byMod = coverageByMod(rows);
  assert.deepEqual(byMod["mods/orca-files"], { files: 2, line: 90, branch: 85, funcs: 80 });
  assert.equal(byMod.scripts.line, 90);
});

test("the test summary reads tests, pass, fail and duration", () => {
  assert.deepEqual(parseTestSummary("ℹ tests 10\nℹ pass 9\nℹ fail 1\nℹ skipped 0\nℹ duration_ms 1234.6"), { tests: 10, pass: 9, fail: 1, skipped: 0, durationMs: 1235 });
});

test("lint results are counted by rule and area and the worst complexity is listed", () => {
  const root = "/r";
  const out = summarizeLint([
    { filePath: "/r/mods/a/main.js", messages: [{ ruleId: "complexity", message: "Function 'f' has a complexity of 20.", line: 3 }, { ruleId: "no-shadow", message: "x", line: 4 }] },
    { filePath: "/r/scripts/x.mjs", messages: [{ ruleId: "no-shadow", message: "y", line: 1 }] },
  ], root);
  assert.equal(out.total, 3);
  assert.deepEqual(out.byRule, { complexity: 1, "no-shadow": 2 });
  assert.deepEqual(out.byArea, { "mods/a": 2, scripts: 1 });
  assert.deepEqual(out.worstComplexity, [{ where: "mods/a/main.js:3", complexity: 20 }]);
});

const report = (over = {}) => ({
  schemaVersion: 1, generatedAt: "t", commit: "abc",
  tests: { tests: 10, pass: 10, fail: 0, skipped: 0, durationMs: 5 },
  coverage: { overall: { line: 80, branch: 70, funcs: 60 }, byMod: { "mods/a": { files: 1, line: 70, branch: 0, funcs: 0 } } },
  lint: { total: 5, byRule: {}, byArea: { "mods/a": 5 }, worstComplexity: [{ where: "mods/a/main.js:3", complexity: 20 }] },
  size: { sourceFiles: 1, sourceLines: 10, testLines: 5 }, drift: { exitCode: 0, lastLine: "ok" }, ...over,
});

test("judge fails on failing tests, drift, more lint and a coverage drop, and only warns on small moves", () => {
  const base = report();
  assert.deepEqual(judge(report(), base), { ok: true, failures: [], warnings: [] });
  assert.equal(judge(report({ tests: { ...base.tests, fail: 1 } }), base).ok, false);
  assert.equal(judge(report({ drift: { exitCode: 1 } }), base).ok, false);
  assert.match(judge(report({ lint: { ...base.lint, total: 6, byArea: { "mods/a": 6 } } }), base).failures[0], /lint findings rose by 1/);
  assert.match(judge(report({ coverage: { ...base.coverage, overall: { ...base.coverage.overall, line: 78 } } }), base).failures[0], /coverage fell 2\.00/);
  const small = judge(report({ coverage: { ...base.coverage, byMod: { "mods/a": { files: 1, line: 60, branch: 0, funcs: 0 } } } }), base);
  assert.equal(small.ok, true);
  assert.match(small.warnings[0], /mods\/a: line coverage 70 -> 60/);
  assert.equal(judge(report(), null).ok, true);
});

test("next actions name the worst area, the worst function and the weakest mod", () => {
  const actions = nextActions(report());
  assert.match(actions[0], /mods\/a has 5 finding/);
  assert.match(actions[1], /Complexity 20 at mods\/a\/main\.js:3/);
  assert.match(actions[2], /mods\/a is at 70% lines/);
  assert.match(nextActions(report({ lint: { total: 0, byRule: {}, byArea: {}, worstComplexity: [] }, coverage: { overall: {}, byMod: {} } }))[0], /Nothing over threshold/);
});

test("the markdown starts with the marker the PR comment looks for and shows deltas", () => {
  const r = report();
  r.nextActions = nextActions(r);
  const md = toMarkdown(r, { ok: false, failures: ["x"], warnings: [] }, report({ lint: { total: 9, byRule: {}, byArea: {}, worstComplexity: [] } }));
  assert.ok(md.startsWith("<!-- orca-metrics -->\n## Quality report: FAIL"));
  assert.match(md, /Lint findings \| 5 \(-4\)/);
  assert.match(md, /\*\*Failures\*\*\n- x/);
});

test("tracked test discovery covers mods, scripts and nested managed features", () => {
  assert.deepEqual(trackedTestFiles(["mods/a/a.test.js", "scripts/a.test.mjs", "orca-ui/features/panel/head/a.test.cjs", "mods/a/main.js", "artifacts/x.test.js", ""].join("\0")), ["mods/a/a.test.js", "scripts/a.test.mjs", "orca-ui/features/panel/head/a.test.cjs"]);
});

test("quality rejects incomplete test execution and missing lint output", () => {
  const base = report();
  assert.equal(judge(report({ tests: { ...base.tests, executionError: "runner failed" } }), base).ok, false);
  assert.equal(judge(report({ lint: { ...base.lint, total: -1 } }), base).ok, false);
});
