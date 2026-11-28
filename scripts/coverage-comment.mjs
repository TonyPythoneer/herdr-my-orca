#!/usr/bin/env node
// Render the PR coverage table from Vitest's json-summary. Informational only: it never fails.
// Usage: node scripts/coverage-comment.mjs <current-summary.json> [baseline-summary.json]
import { existsSync, readFileSync } from "node:fs";

const [currentPath, baselinePath] = process.argv.slice(2);
const METRICS = [
  ["Statements", "statements"],
  ["Branches", "branches"],
  ["Functions", "functions"],
  ["Lines", "lines"],
];
const current = JSON.parse(readFileSync(currentPath, "utf8")).total;
const baseline =
  baselinePath && existsSync(baselinePath)
    ? JSON.parse(readFileSync(baselinePath, "utf8")).total
    : null;
const pct = (value) => `${value.toFixed(2)}%`;
const signed = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)} pts`;

const out = [
  "<!-- herdr-coverage-report -->",
  "## Coverage (informational, never fails CI)",
  "",
  "| Metric | Previous | Current | Delta |",
  "|---|---:|---:|---:|",
];
for (const [label, key] of METRICS) {
  const now = current[key].pct;
  const before = baseline?.[key]?.pct;
  out.push(
    before === undefined
      ? `| ${label} | no baseline | ${pct(now)} | — |`
      : `| ${label} | ${pct(before)} | ${pct(now)} | ${signed(now - before)} |`,
  );
}
out.push(
  "",
  baseline
    ? "Previous: latest successful `main` run (`coverage-summary` artifact)."
    : "No baseline: no successful `main` run with a `coverage-summary` artifact was found.",
);
process.stdout.write(`${out.join("\n")}\n`);
