import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as worktreePlan from "../mods/orca-sidebar-projects/worktree-plan";

type ProjectionInput = NonNullable<Parameters<typeof worktreePlan.projectWorktreePlan>[0]>;
type Workspace = NonNullable<ProjectionInput["spaces"]>[number];
type GitState = NonNullable<ProjectionInput["gitState"]>;
type GroupInput = Parameters<typeof worktreePlan.groupSpaceIds>[0];
export type RowGroup = NonNullable<GroupInput>;

export type Implementation = Pick<
  typeof worktreePlan,
  "projectWorktreePlan" | "planRenderRows" | "groupSpaceIds"
>;
export type GitRunner = (args: string[]) => string;
export type ModuleLoader = (source: string, sha: string) => Promise<Implementation>;
export type Clock = () => number;
export type ProjectionOutput = {
  projection: ReturnType<Implementation["projectWorktreePlan"]>;
  rendered: ReturnType<Implementation["planRenderRows"]>;
};
export type SampleStats = { p50_ms: number; p95_ms: number; raw_ms: number[] };
export type Measurement = SampleStats & {
  workload: string;
  workspaces: number;
  samples: number;
  iterations_per_sample: number;
  baseline: SampleStats | null;
  p50_ms_reduction_pct: number | null;
  p95_ms_reduction_pct: number | null;
  correctness: "pass";
};
export type BenchmarkReport = {
  schema: 1;
  scope: string;
  baseline_sha: string | null;
  candidate_sha: string;
  comparison: "paired_same_runner_alternating" | "candidate_only";
  node: string;
  platform: string;
  architecture: string;
  cases: Measurement[];
  group_cases: Measurement[];
};

export const BASELINE_PATH = "mods/orca-sidebar-projects/worktree-plan.js";
export const SCOPE = "CPU-only workspace projection; not native UI latency";

export function fixture(count: number): ProjectionInput {
  const spaces: Workspace[] = [];
  const gitState: GitState = {};
  for (let i = 0; i < count; i++) {
    const folder = "/fixture/project-" + i;
    const repo = JSON.stringify([null, folder + "/.git"]);
    spaces.push({
      id: String(i),
      folder,
      tabs: [],
      name: "project-" + i,
      status: "idle",
      machine: null,
    });
    gitState[JSON.stringify([null, folder])] = {
      repo,
      top: folder,
      name: "project-" + i,
      branch: "main",
      linked: false,
      worktrees: [{ path: folder, branch: "main" }],
    };
  }
  return { spaces, gitState, loaded: true };
}

export function groupWorkload(count: number): { group: RowGroup; ids: string[] } {
  const ids = Array.from({ length: count }, (_, i) => "w" + i);
  return { group: { rows: ids.map((id) => ({ w: { id }, also: [{ w: { id } }] })) }, ids };
}

export function calculate(
  implementation: Implementation,
  input: ProjectionInput,
): ProjectionOutput {
  const projection = implementation.projectWorktreePlan(input);
  const rendered = implementation.planRenderRows(
    projection.visibleRows,
    "repo",
    new Set(),
    new Set(),
  );
  return { projection, rendered };
}

export function percentile(samples: readonly number[], p: number): number {
  if (!samples.length) throw new Error("percentile needs at least one sample");
  return samples.slice().sort((a, b) => a - b)[Math.ceil(samples.length * p) - 1];
}

export function stats(samples: readonly number[]): SampleStats {
  return {
    p50_ms: percentile(samples, 0.5),
    p95_ms: percentile(samples, 0.95),
    raw_ms: [...samples],
  };
}

export function reduction(
  baseline: SampleStats | null,
  after: SampleStats,
  key: "p50_ms" | "p95_ms",
): number | null {
  if (!baseline || baseline[key] <= 0) return null;
  return (1 - after[key] / baseline[key]) * 100;
}

type MeasureInput<Output> = {
  candidate: Implementation;
  before: Implementation | null;
  run: (implementation: Implementation) => Output;
  verify: (output: Output) => void;
  count: number;
  workload: string;
  clock?: Clock;
  samples?: number;
  warmup?: number;
  iterationsFor?: (count: number) => number;
};

type SampleInput<Output> = {
  candidate: Implementation;
  before: Implementation | null;
  run: (implementation: Implementation) => Output;
  verify: (output: Output) => void;
  clock: Clock;
  iterations: number;
  samples: number;
};

function sampleTimes<Output>({
  candidate,
  before,
  run,
  verify,
  clock,
  iterations,
  samples,
}: SampleInput<Output>): { after: number[]; before: number[] } {
  const after: number[] = [];
  const baseline: number[] = [];
  const timed = (implementation: Implementation, sink: number[]): void => {
    const start = clock();
    let output: Output | undefined;
    for (let i = 0; i < iterations; i++) output = run(implementation);
    sink.push((clock() - start) / iterations);
    verify(output as Output);
  };
  for (let i = 0; i < samples; i++) {
    if (before && i % 2 === 0) timed(before, baseline);
    timed(candidate, after);
    if (before && i % 2 !== 0) timed(before, baseline);
  }
  return { after, before: baseline };
}

export function measure<Output>(options: MeasureInput<Output>): Measurement {
  const {
    candidate,
    before,
    run,
    verify,
    count,
    workload,
    samples = 60,
    iterationsFor = defaultIterations,
  } = options;
  const clock = options.clock ?? performance.now.bind(performance);
  const warmup = options.warmup ?? Math.max(100, defaultIterations(count) * 10);
  const iterations = iterationsFor(count);
  const expected = run(candidate);
  verify(expected);
  if (before) assert.deepEqual(run(before), expected);
  for (let i = 0; i < warmup; i++) {
    if (before) run(before);
    run(candidate);
  }
  const times = sampleTimes({ candidate, before, run, verify, clock, iterations, samples });
  const after = stats(times.after);
  const baseline = times.before.length ? stats(times.before) : null;
  return {
    workload,
    workspaces: count,
    samples: after.raw_ms.length,
    iterations_per_sample: iterations,
    ...after,
    baseline,
    p50_ms_reduction_pct: reduction(baseline, after, "p50_ms"),
    p95_ms_reduction_pct: reduction(baseline, after, "p95_ms"),
    correctness: "pass",
  };
}

export function buildReport({
  candidate,
  before,
  candidateSha,
  baselineSha,
  clock = performance.now.bind(performance),
  counts = [20, 200, 1000],
  samples,
  warmup,
  iterationsFor,
}: {
  candidate: Implementation;
  before: Implementation | null;
  candidateSha: string;
  baselineSha: string | null;
  clock?: Clock;
  counts?: number[];
  samples?: number;
  warmup?: number;
  iterationsFor?: (count: number) => number;
}): BenchmarkReport {
  const shared = { candidate, before, clock, samples, warmup, iterationsFor };
  return {
    schema: 1,
    scope: SCOPE,
    baseline_sha: before ? baselineSha : null,
    candidate_sha: candidateSha,
    comparison: before ? "paired_same_runner_alternating" : "candidate_only",
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cases: counts.map((count) => {
      const input = fixture(count);
      return measure({
        ...shared,
        count,
        workload: "projection",
        run: (implementation) => calculate(implementation, input),
        verify: (output) => verifyProjection(output, count),
      });
    }),
    group_cases: counts.map((count) => {
      const { group, ids } = groupWorkload(count);
      return measure({
        ...shared,
        count,
        workload: "group-space-ids",
        run: (implementation) => implementation.groupSpaceIds(group, ids),
        verify: (output) => assert.deepEqual(output, ids),
      });
    }),
  };
}

function verifyProjection(output: ProjectionOutput, count: number): void {
  assert.equal(output.projection.visibleRows.length, count);
  assert.equal(output.rendered.filter((row) => row.kind === "row").length, count);
}

function defaultIterations(count: number): number {
  if (count <= 20) return 64;
  if (count <= 200) return 8;
  return 1;
}

export function resolveBaseRef(
  argv: string[],
  env: Record<string, string | undefined>,
  readText: (path: string) => string,
): string | null {
  const explicit = argv[3];
  if (explicit) return explicit;
  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  const event = JSON.parse(readText(eventPath)) as {
    pull_request?: { base?: { sha?: string } };
    before?: string;
  };
  return event.pull_request?.base?.sha ?? event.before ?? null;
}

export async function baselineModule(
  sha: string | null,
  git: GitRunner,
  load: ModuleLoader,
): Promise<Implementation | null> {
  if (!sha || sha === "0".repeat(40)) return null;
  assert.match(
    sha,
    /^[0-9a-f]{40}$/,
    `baseline sha must be 40 lowercase hex characters, received ${sha}`,
  );
  const object = `${sha}:${BASELINE_PATH}`;
  let source: string;
  try {
    source = git(["show", object]);
  } catch {
    git(["fetch", "--no-tags", "--depth=1", "origin", sha]);
    source = git(["show", object]);
  }
  return load(source, sha);
}

export async function loadModule(source: string): Promise<Implementation> {
  return (await import(
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  )) as Implementation;
}

const runGit: GitRunner = (args) => execFileSync("git", args, { encoding: "utf8" });
const readText = (path: string): string => readFileSync(path, "utf8");

export async function cliMain({
  argv,
  env,
  git = runGit,
  clock,
  read = readText,
  load = loadModule,
  candidateSha,
  write = writeFileSync,
  print = (text: string) => console.log(text),
  counts,
  samples,
  warmup,
  iterationsFor,
}: {
  argv: string[];
  env: Record<string, string | undefined>;
  git?: GitRunner;
  clock?: Clock;
  read?: (path: string) => string;
  load?: ModuleLoader;
  candidateSha?: string;
  write?: (path: string, text: string) => void;
  print?: (text: string) => void;
  counts?: number[];
  samples?: number;
  warmup?: number;
  iterationsFor?: (count: number) => number;
}): Promise<BenchmarkReport> {
  const baselineSha = resolveBaseRef(argv, env, read);
  const before = await baselineModule(baselineSha, git, load);
  const report = buildReport({
    candidate: worktreePlan,
    before,
    candidateSha: candidateSha ?? git(["rev-parse", "HEAD"]).trim(),
    baselineSha,
    clock,
    counts,
    samples,
    warmup,
    iterationsFor,
  });
  const json = JSON.stringify(report, null, 2) + "\n";
  print(json);
  if (argv[2]) write(argv[2], json);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await cliMain({ argv: process.argv, env: process.env });
}
