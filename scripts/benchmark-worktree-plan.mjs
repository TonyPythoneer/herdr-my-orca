// Paired CPU-only workspace workload; never interpret this as native UI latency.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import * as candidate from "../mods/orca-spaces/worktree-plan.js";

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

function calculate(implementation, input) {
  const projection = implementation.projectWorktreePlan(input);
  const rendered = implementation.planRenderRows(projection.visibleRows, "repo", new Set(), new Set());
  return { projection, rendered };
}

function percentile(samples, p) {
  return samples.toSorted((a, b) => a - b)[Math.ceil(samples.length * p) - 1];
}

function stats(samples) {
  return { p50_ms: percentile(samples, .5), p95_ms: percentile(samples, .95), raw_ms: samples };
}

function measure(run, before, verify, count, workload) {
  const expected = run(candidate);
  verify(expected);
  if (before) assert.deepEqual(run(before), expected);
  for (let i = 0; i < 20; i++) {
    if (before) run(before);
    run(candidate);
  }
  const afterTimes = [], beforeTimes = [];
  const timed = (implementation, samples) => {
    const start = performance.now();
    const output = run(implementation);
    samples.push(performance.now() - start);
    verify(output);
  };
  for (let i = 0; i < 60; i++) {
    if (before && i % 2 === 0) timed(before, beforeTimes);
    timed(candidate, afterTimes);
    if (before && i % 2 !== 0) timed(before, beforeTimes);
  }
  const after = stats(afterTimes);
  const baseline = before ? stats(beforeTimes) : null;
  const reduction = (key) => baseline && baseline[key] > 0 ? (1 - after[key] / baseline[key]) * 100 : null;
  return { workload, workspaces: count, samples: afterTimes.length, ...after, baseline,
    p50_ms_reduction_pct: reduction("p50_ms"), p95_ms_reduction_pct: reduction("p95_ms"), correctness: "pass" };
}

function projectionCase(count, before) {
  const input = fixture(count);
  return measure(implementation => calculate(implementation, input), before, output => {
    assert.equal(output.projection.visibleRows.length, count);
    assert.equal(output.rendered.filter(r => r.kind === "row").length, count);
  }, count, "projection");
}

function groupCase(count, before) {
  const ids = Array.from({ length: count }, (_, i) => "w" + i);
  const group = { rows: ids.map(id => ({ w: { id }, also: [{ w: { id } }] })) };
  return measure(implementation => implementation.groupSpaceIds(group, ids), before,
    output => assert.deepEqual(output, ids), count, "group-space-ids");
}

function baseRef() {
  if (process.argv[3]) return process.argv[3];
  if (!process.env.GITHUB_EVENT_PATH) return null;
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  return event.pull_request?.base?.sha ?? event.before ?? null;
}

async function baselineModule(sha) {
  if (!sha || sha === "0".repeat(40)) return null;
  assert.match(sha, /^[0-9a-f]{40}$/);
  const path = sha + ":mods/orca-spaces/worktree-plan.js";
  let source;
  try {
    source = execFileSync("git", ["show", path], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    // CI checkout is shallow. Retrieve only the exact comparison commit.
    execFileSync("git", ["fetch", "--no-tags", "--depth=1", "origin", sha], { stdio: ["ignore", "pipe", "pipe"] });
    source = execFileSync("git", ["show", path], { encoding: "utf8" });
  }
  // This pure projection module has no relative imports; keep the base outside the worktree.
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}

const baselineSha = baseRef();
const before = await baselineModule(baselineSha);
const report = {
  schema: 1, scope: "CPU-only workspace projection; not native UI latency",
  baseline_sha: before ? baselineSha : null,
  candidate_sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  comparison: before ? "paired_same_runner_alternating" : "candidate_only",
  node: process.version, platform: process.platform, architecture: process.arch,
  cases: [20, 200, 1000].map(count => projectionCase(count, before)),
  group_cases: [20, 200, 1000].map(count => groupCase(count, before)),
};
const json = JSON.stringify(report, null, 2) + "\n";
if (process.argv[2]) writeFileSync(process.argv[2], json);
console.log(json);
