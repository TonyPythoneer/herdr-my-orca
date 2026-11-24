// Reproducible CPU-only projection workload; does not measure native rendering.
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { projectWorktreePlan, planRenderRows } from "../mods/orca-spaces/worktree-plan.js";

function fixture(count) {
  const spaces = [], gitState = {};
  for (let i = 0; i < count; i++) {
    const folder = "/fixture/project-" + i;
    const repo = JSON.stringify([null, folder + "/.git"]);
    spaces.push({ id: String(i), folder, tabs: [], name: "project-" + i, status: "idle", machine: null });
    gitState[JSON.stringify([null, folder])] = { repo, top: folder, name: "project-" + i, branch: "main", linked: false, worktrees: [{ path: folder, branch: "main" }] };
  }
  return { spaces, gitState, loaded: true };
}

function calculate(input) {
  const projection = projectWorktreePlan(input);
  const rendered = planRenderRows(projection.visibleRows, "repo", new Set(), new Set());
  return { rows: projection.visibleRows.length, rendered: rendered.filter(r => r.kind === "row").length };
}

function percentile(samples, p) {
  return samples.toSorted((a, b) => a - b)[Math.ceil(samples.length * p) - 1];
}

function measure(count) {
  const input = fixture(count);
  for (let i = 0; i < 10; i++) calculate(input);
  const samples = [];
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    const output = calculate(input);
    samples.push(performance.now() - start);
    assert.deepEqual(output, { rows: count, rendered: count });
  }
  return { workspaces: count, samples: samples.length, p50_ms: percentile(samples, .5), p95_ms: percentile(samples, .95), raw_ms: samples, correctness: "pass" };
}

const report = {
  schema: 1, scope: "CPU-only workspace projection; not native UI latency",
  node: process.version, platform: process.platform, architecture: process.arch,
  cases: [20, 200, 1000].map(measure),
};
const json = JSON.stringify(report, null, 2) + "\n";
if (process.argv[2]) writeFileSync(process.argv[2], json);
console.log(json);
