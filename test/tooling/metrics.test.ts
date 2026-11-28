import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  coverageByFile,
  coverageByMod,
  judge,
  mergeTestCounts,
  nextActions,
  normalizeOxlint,
  parseCoverage,
  parseTestSummary,
  parseViteCoverage,
  summarizeLint,
  trackedTestFiles,
  validateCoverageInventory,
  type CoverageRow,
  type ReportInput,
} from "../../src/tooling/metrics.ts";

const COVERAGE = `ℹ start of coverage report
ℹ ------------------------------------------------------------
ℹ file               | line % | branch % | funcs % | uncovered lines
ℹ ------------------------------------------------------------
ℹ mods               |        |          |         |
ℹ  orca-files        |        |          |         |
ℹ   main.js          |  80.00 |    70.00 |   60.00 | 1-3
ℹ   util.js          | 100.00 |   100.00 |  100.00 |
ℹ  orca-header         |        |          |         |
ℹ   main.js          |  50.00 |    40.00 |   30.00 | 9
ℹ scripts            |        |          |         |
ℹ  build.mjs         |  90.00 |    80.00 |   70.00 |
ℹ ------------------------------------------------------------
ℹ all files          |  80.00 |    70.00 |   65.00 |
ℹ end of coverage report`;

it("the coverage table becomes one row per file with its directory path", () => {
  const rows = parseCoverage(COVERAGE);
  assert.deepEqual(
    rows.map((r) => r.file),
    [
      "mods/orca-files/main.js",
      "mods/orca-files/util.js",
      "mods/orca-header/main.js",
      "scripts/build.mjs",
    ],
  );
  assert.deepEqual(rows[0], { file: "mods/orca-files/main.js", line: 80, branch: 70, funcs: 60 });
});

it("the test summary reads tests, pass, fail and duration", () => {
  assert.deepEqual(
    parseTestSummary("ℹ tests 10\nℹ pass 9\nℹ fail 1\nℹ skipped 0\nℹ duration_ms 1234.6"),
    { tests: 10, pass: 9, fail: 1, skipped: 0, durationMs: 1235 },
  );
});

it("counts real skipped TypeScript tests without counting the legacy wrapper", () => {
  assert.deepEqual(
    mergeTestCounts(
      { numTotalTests: 5, numPassedTests: 4, numFailedTests: 0, numPendingTests: 1 },
      { tests: 10, pass: 9, fail: 1, skipped: 2, durationMs: 5 },
      true,
    ),
    { tests: 14, pass: 12, fail: 1, skipped: 3, durationMs: 5 },
  );
});

it("Vite coverage summaries map typed sources into the shared coverage report", () => {
  const rows = parseViteCoverage(
    {
      total: {
        lines: { covered: 1, total: 2 },
        branches: { covered: 1, total: 2 },
        functions: { covered: 1, total: 2 },
      },
      "/repo/src/shared/a.ts": {
        lines: { covered: 4, total: 4 },
        branches: { covered: 3, total: 4 },
        functions: { covered: 2, total: 2 },
      },
    },
    "/repo",
  );
  assert.deepEqual(rows, [
    {
      file: "src/shared/a.ts",
      line: { covered: 4, total: 4 },
      branch: { covered: 3, total: 4 },
      funcs: { covered: 2, total: 2 },
    },
  ]);
});

it("coverage inventory requires one valid row for every canonical source", () => {
  const row: CoverageRow = {
    file: "src/shared/a.ts",
    line: { covered: 0, total: 1 },
    branch: { covered: 0, total: 0 },
    funcs: { covered: 0, total: 0 },
  };
  assert.deepEqual(validateCoverageInventory([row], ["src/shared/a.ts"]), [row]);
  assert.throws(
    () => validateCoverageInventory([], ["src/shared/a.ts"]),
    /missing: src\/shared\/a\.ts/,
  );
  assert.throws(
    () => validateCoverageInventory([row, row], ["src/shared/a.ts"]),
    /duplicate canonical/,
  );
  assert.throws(
    () =>
      validateCoverageInventory([{ ...row, line: { covered: 2, total: 1 } }], ["src/shared/a.ts"]),
    /invalid line coverage counts/,
  );
});

it("coverage totals weight executable counts and include uncovered sources", () => {
  const rows: CoverageRow[] = [
    {
      file: "src/a.ts",
      line: { covered: 100, total: 100 },
      branch: { covered: 0, total: 0 },
      funcs: { covered: 0, total: 0 },
    },
    {
      file: "mods/b/main.js",
      line: { covered: 950, total: 1000 },
      branch: { covered: 0, total: 0 },
      funcs: { covered: 0, total: 0 },
    },
    {
      file: "src/unimported.ts",
      line: { covered: 0, total: 1 },
      branch: { covered: 0, total: 0 },
      funcs: { covered: 0, total: 0 },
    },
  ];
  assert.deepEqual(coverageByMod(rows).src, {
    files: 2,
    line: 99.01,
    lineCovered: 100,
    lineTotal: 101,
    branch: 100,
    branchCovered: 0,
    branchTotal: 0,
    funcs: 100,
    funcsCovered: 0,
    funcsTotal: 0,
  });
  assert.equal(coverageByMod(rows)["mods/b"].line, 95);
  assert.equal(
    judge(
      report({
        coverage: {
          definition: "canonical-source-counts-v1",
          overall: { line: 95.45, lineCovered: 1050, lineTotal: 1100 },
          byMod: {},
        },
      }),
      null,
    ).ok,
    true,
  );
  assert.equal(
    judge(
      report({
        coverage: {
          definition: "canonical-source-counts-v1",
          overall: { line: 97.5, lineCovered: 97499, lineTotal: 100000 },
          byMod: {},
        },
      }),
      null,
    ).ok,
    true,
  );
  assert.equal(
    judge(
      report({
        coverage: {
          definition: "canonical-source-counts-v1",
          overall: { line: 97.5, lineCovered: 39, lineTotal: 40 },
          byMod: {},
        },
      }),
      null,
    ).ok,
    true,
  );
});

it("coverage file summaries retain canonical paths and exact counts", () => {
  const rows: CoverageRow[] = [
    {
      file: "src/z.ts",
      line: { covered: 0, total: 2 },
      branch: { covered: 0, total: 1 },
      funcs: { covered: 0, total: 1 },
    },
    {
      file: "src/a.ts",
      line: { covered: 1, total: 1 },
      branch: { covered: 0, total: 0 },
      funcs: { covered: 1, total: 1 },
    },
  ];
  assert.deepEqual(Object.keys(coverageByFile(rows)), ["src/a.ts", "src/z.ts"]);
  assert.equal(coverageByFile(rows)["src/z.ts"].lineTotal, 2);
  assert.equal(coverageByFile(rows)["src/z.ts"].lineCovered, 0);
});

it("lint results are counted by rule and area and the worst complexity is listed", () => {
  const root = "/r";
  const out = summarizeLint(
    [
      {
        filePath: "/r/mods/a/main.js",
        messages: [
          { ruleId: "complexity", message: "Function 'f' has a complexity of 20.", line: 3 },
          { ruleId: "no-shadow", message: "x", line: 4 },
        ],
      },
      { filePath: "/r/scripts/x.mjs", messages: [{ ruleId: "no-shadow", message: "y", line: 1 }] },
    ],
    root,
  );
  assert.equal(out.total, 3);
  assert.deepEqual(out.byRule, { complexity: 1, "no-shadow": 2 });
  assert.deepEqual(out.byArea, { "mods/a": 2, scripts: 1 });
  assert.deepEqual(out.worstComplexity, [{ where: "mods/a/main.js:3", complexity: 20 }]);
});

it("Oxlint diagnostics preserve stable report keys and reject invalid file scopes", () => {
  const normalized = normalizeOxlint(
    {
      number_of_files: 2,
      diagnostics: [
        {
          filename: "mods/a/main.js",
          code: "eslint(complexity)",
          message: "function f has a complexity of 20. Maximum allowed is 12.",
          labels: [{ span: { line: 3 } }],
        },
        {
          filename: "mods/a/main.js",
          code: "eslint(no-shadow)",
          message: "shadow",
          labels: [{ span: { line: 4 } }],
        },
        {
          filename: "scripts/x.mjs",
          code: "eslint(no-shadow)",
          message: "shadow",
          labels: [{ span: { line: 1 } }],
        },
      ],
    },
    "/r",
  );
  const out = summarizeLint(normalized, "/r");
  assert.deepEqual(out, {
    total: 3,
    byRule: { complexity: 1, "no-shadow": 2 },
    byArea: { "mods/a": 2, scripts: 1 },
    worstComplexity: [{ where: "mods/a/main.js:3", complexity: 20 }],
  });
  assert.throws(() => normalizeOxlint({ diagnostics: [], number_of_files: 0 }, "/r"));
  assert.throws(() =>
    normalizeOxlint({ diagnostics: [{ filename: "a.js" }], number_of_files: 1 }, "/r"),
  );
});

const report = (over: Partial<ReportInput> = {}): ReportInput => ({
  schemaVersion: 1,
  generatedAt: "t",
  commit: "abc",
  tests: { tests: 10, pass: 10, fail: 0, skipped: 0, durationMs: 5 },
  coverage: {
    definition: "canonical-source-counts-v1",
    overall: {
      line: 98,
      lineCovered: 98,
      lineTotal: 100,
      branch: 90,
      branchCovered: 9,
      branchTotal: 10,
      funcs: 95,
      funcsCovered: 19,
      funcsTotal: 20,
    },
    byMod: {
      "mods/a": {
        files: 1,
        line: 98,
        lineCovered: 98,
        lineTotal: 100,
        branch: 90,
        branchCovered: 9,
        branchTotal: 10,
        funcs: 95,
        funcsCovered: 19,
        funcsTotal: 20,
      },
    },
  },
  lint: {
    total: 5,
    byRule: {},
    byArea: { "mods/a": 5 },
    worstComplexity: [{ where: "mods/a/main.js:3", complexity: 20 }],
  },
  size: { sourceFiles: 1, sourceLines: 10, testLines: 5 },
  drift: { exitCode: 0, lastLine: "ok" },
  ...over,
});

it("judge fails on failing tests, drift and more lint, and never gates on coverage", () => {
  const base = report({
    coverage: {
      ...report().coverage,
      byMod: {
        "mods/a": {
          files: 1,
          line: 70,
          lineCovered: 70,
          lineTotal: 100,
          branch: 70,
          branchCovered: 7,
          branchTotal: 10,
          funcs: 70,
          funcsCovered: 7,
          funcsTotal: 10,
        },
      },
    },
  });
  assert.deepEqual(judge(report(), base), { ok: true, failures: [], warnings: [] });
  assert.equal(judge(report({ tests: { ...base.tests, fail: 1 } }), base).ok, false);
  assert.equal(judge(report({ drift: { exitCode: 1 } }), base).ok, false);
  assert.match(
    judge(report({ lint: { ...base.lint, total: 6, byArea: { "mods/a": 6 } } }), base).failures[0],
    /lint findings rose by 1/,
  );
  assert.equal(
    judge(
      report({
        coverage: {
          ...base.coverage,
          overall: { ...base.coverage.overall, line: 96, lineCovered: 96, lineTotal: 100 },
        },
      }),
      base,
    ).ok,
    true,
  );
  const small = judge(
    report({
      coverage: {
        ...base.coverage,
        byMod: { "mods/a": { files: 1, line: 60, branch: 0, funcs: 0 } },
      },
    }),
    base,
  );
  assert.equal(small.ok, true);
  assert.match(small.warnings[0], /mods\/a: line coverage 70 -> 60/);
  assert.equal(judge(report(), null).ok, true);
});

it("next actions name the worst area, the worst function and the weakest mod", () => {
  const actions = nextActions(
    report({
      coverage: {
        ...report().coverage,
        byMod: {
          "mods/a": {
            files: 1,
            line: 70,
            lineCovered: 70,
            lineTotal: 100,
            branch: 0,
            branchCovered: 0,
            branchTotal: 1,
            funcs: 0,
            funcsCovered: 0,
            funcsTotal: 1,
          },
        },
      },
    }),
  );
  assert.match(actions[0], /mods\/a has 5 finding/);
  assert.match(actions[1], /Complexity 20 at mods\/a\/main\.js:3/);
  assert.match(actions[2], /mods\/a is at 70% lines/);
  assert.match(
    nextActions(
      report({
        lint: { total: 0, byRule: {}, byArea: {}, worstComplexity: [] },
        coverage: { overall: {}, byMod: {} },
      }),
    )[0],
    /Nothing over threshold/,
  );
});

it("tracked test discovery covers legacy and TypeScript tests", () => {
  assert.deepEqual(
    trackedTestFiles(
      [
        "mods/a/a.test.js",
        "scripts/a.test.mjs",
        "orca-ui/features/right-sidebar/header/a.test.cjs",
        "test/shared/a.test.ts",
        "mods/a/main.js",
        "artifacts/x.test.js",
        "",
      ].join("\0"),
    ),
    [
      "mods/a/a.test.js",
      "scripts/a.test.mjs",
      "orca-ui/features/right-sidebar/header/a.test.cjs",
      "test/shared/a.test.ts",
    ],
  );
});

it("quality rejects incomplete test execution and missing lint output", () => {
  const base = report();
  assert.equal(
    judge(report({ tests: { ...base.tests, executionError: "runner failed" } }), base).ok,
    false,
  );
  assert.equal(judge(report({ lint: { ...base.lint, total: -1 } }), base).ok, false);
});
