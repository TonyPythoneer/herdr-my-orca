import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import * as worktreePlan from "../../src/mods/orca-sidebar-projects/worktree-plan";
import {
  BASELINE_PATH,
  SCOPE,
  baselineModule,
  buildReport,
  calculate,
  cliMain,
  fixture,
  groupWorkload,
  loadModule,
  measure,
  percentile,
  reduction,
  resolveBaseRef,
  stats,
  type Clock,
  type Implementation,
  type ModuleLoader,
} from "../../src/tooling/benchmark-worktree-plan";

const SHA = "a".repeat(40);

function stub(
  cost: number,
  label: string,
  order: string[],
  time: { value: number },
): Implementation {
  const run = (): { label: string } => {
    order.push(label);
    time.value += cost;
    return { label: "workload" };
  };
  return {
    projectWorktreePlan: run as unknown as Implementation["projectWorktreePlan"],
    planRenderRows: run as unknown as Implementation["planRenderRows"],
    groupSpaceIds: run as unknown as Implementation["groupSpaceIds"],
  };
}

function fakeClock(): { time: { value: number }; clock: Clock } {
  const time = { value: 0 };
  return { time, clock: () => time.value };
}

it("percentile picks the nearest-rank sample for p50 and p95", () => {
  assert.equal(percentile([4, 1, 3, 2], 0.5), 2);
  assert.equal(percentile([4, 1, 3, 2], 0.95), 4);
  assert.equal(percentile([7], 0.95), 7);
  assert.equal(percentile([5, 5, 5], 0.5), 5);
});

it("percentile rejects an empty sample set", () => {
  assert.throws(() => percentile([], 0.5), /at least one sample/);
});

it("stats keeps raw samples and derives both percentiles", () => {
  assert.deepEqual(stats([3, 1, 2]), { p50_ms: 2, p95_ms: 3, raw_ms: [3, 1, 2] });
});

it("reduction is a percentage of the paired baseline and null without one", () => {
  assert.equal(
    reduction({ p50_ms: 4, p95_ms: 8, raw_ms: [] }, { p50_ms: 1, p95_ms: 2, raw_ms: [] }, "p50_ms"),
    75,
  );
  assert.equal(
    reduction({ p50_ms: 0, p95_ms: 0, raw_ms: [] }, { p50_ms: 1, p95_ms: 2, raw_ms: [] }, "p95_ms"),
    null,
  );
  assert.equal(reduction(null, { p50_ms: 1, p95_ms: 2, raw_ms: [] }, "p50_ms"), null);
});

it("measure warms up with alternating implementations and pairs every sample", () => {
  const order: string[] = [];
  const { time, clock } = fakeClock();
  const candidate = stub(1, "candidate", order, time);
  const before = stub(4, "before", order, time);
  const measurement = measure({
    candidate,
    before,
    run: (implementation) =>
      (
        implementation as unknown as { projectWorktreePlan: () => { label: string } }
      ).projectWorktreePlan(),
    verify: (output) => assert.equal(output.label, "workload"),
    count: 20,
    workload: "projection",
    clock,
    samples: 2,
    warmup: 3,
    iterationsFor: () => 2,
  });
  assert.deepEqual(order, [
    "candidate",
    "before",
    "before",
    "candidate",
    "before",
    "candidate",
    "before",
    "candidate",
    "before",
    "before",
    "candidate",
    "candidate",
    "candidate",
    "candidate",
    "before",
    "before",
  ]);
  assert.equal(measurement.iterations_per_sample, 2);
  assert.equal(measurement.samples, 2);
  assert.deepEqual(measurement.raw_ms, [1, 1]);
  assert.deepEqual(measurement.baseline?.raw_ms, [4, 4]);
  assert.equal(measurement.p50_ms_reduction_pct, 75);
  assert.equal(measurement.p95_ms_reduction_pct, 75);
  assert.equal(measurement.correctness, "pass");
});

it("measure reports candidate-only numbers without a baseline", () => {
  const order: string[] = [];
  const { time, clock } = fakeClock();
  const candidate = stub(2, "candidate", order, time);
  const measurement = measure({
    candidate,
    before: null,
    run: (implementation) =>
      (implementation as unknown as { groupSpaceIds: () => { label: string } }).groupSpaceIds(),
    verify: (output) => assert.equal(output.label, "workload"),
    count: 200,
    workload: "group-space-ids",
    clock,
    samples: 1,
    warmup: 0,
    iterationsFor: () => 3,
  });
  assert.equal(measurement.baseline, null);
  assert.equal(measurement.p50_ms_reduction_pct, null);
  assert.equal(measurement.p95_ms_reduction_pct, null);
  assert.deepEqual(measurement.raw_ms, [2]);
});

it("measure rejects a candidate that fails its own verification", () => {
  const time = { value: 0 };
  assert.throws(
    () =>
      measure({
        candidate: stub(1, "candidate", [], time),
        before: null,
        run: () => ({ value: 1 }),
        verify: () => assert.fail("invalid output"),
        count: 20,
        workload: "projection",
        warmup: 0,
        samples: 1,
        iterationsFor: () => 1,
      }),
    /invalid output/,
  );
});

it("measure rejects a baseline whose output differs from the candidate", () => {
  const time = { value: 0 };
  const candidate = stub(1, "candidate", [], time);
  const before = stub(1, "before", [], time);
  let calls = 0;
  assert.throws(
    () =>
      measure({
        candidate,
        before,
        run: () => ({ value: calls++ }),
        verify: () => undefined,
        count: 20,
        workload: "projection",
        warmup: 0,
        samples: 1,
        iterationsFor: () => 1,
      }),
    /Expected values to be strictly deep-equal/,
  );
});

it("fixture builds visible workspace rows and resolvable git state", () => {
  const input = fixture(3);
  assert.equal(input.spaces?.length, 3);
  assert.equal(Object.keys(input.gitState ?? {}).length, 3);
  const output = calculate(worktreePlan, input);
  assert.equal(output.projection.visibleRows.length, 3);
  assert.equal(output.rendered.filter((row) => row.kind === "row").length, 3);
});

it("groupWorkload keeps every id in input order", () => {
  const { group, ids } = groupWorkload(3);
  assert.deepEqual(ids, ["w0", "w1", "w2"]);
  assert.deepEqual(worktreePlan.groupSpaceIds(group, ids), ids);
});

it("resolveBaseRef prefers the explicit CLI argument over the event payload", () => {
  const argv = ["node", "bench", "out.json", SHA];
  const read = () => assert.fail("event must not be read");
  assert.equal(resolveBaseRef(argv, { GITHUB_EVENT_PATH: "/event.json" }, read), SHA);
});

it("resolveBaseRef falls back to the pull request base sha and then the push before sha", () => {
  const pullRequest = JSON.stringify({ pull_request: { base: { sha: SHA } } });
  assert.equal(
    resolveBaseRef(["node", "bench"], { GITHUB_EVENT_PATH: "/event.json" }, () => pullRequest),
    SHA,
  );
  const push = JSON.stringify({ before: SHA });
  assert.equal(
    resolveBaseRef(["node", "bench"], { GITHUB_EVENT_PATH: "/event.json" }, () => push),
    SHA,
  );
  assert.equal(
    resolveBaseRef(["node", "bench"], { GITHUB_EVENT_PATH: "/event.json" }, () => "{}"),
    null,
  );
});

it("resolveBaseRef returns null without an event path and rejects malformed events", () => {
  assert.equal(
    resolveBaseRef(["node", "bench"], {}, () => assert.fail("no read")),
    null,
  );
  assert.throws(
    () => resolveBaseRef(["node", "bench"], { GITHUB_EVENT_PATH: "/event.json" }, () => "{"),
    /JSON/,
  );
});

it("baselineModule skips absent, zero and empty shas without touching git", async () => {
  const git = () => assert.fail("git must not run");
  const load = async () => assert.fail("load must not run");
  assert.equal(await baselineModule(null, git, load), null);
  assert.equal(await baselineModule("", git, load), null);
  assert.equal(await baselineModule("0".repeat(40), git, load), null);
});

it("baselineModule rejects an invalid sha before running git", async () => {
  const git = () => assert.fail("git must not run");
  await assert.rejects(
    baselineModule("not-a-sha", git, async () => worktreePlan),
    /40 lowercase hex/,
  );
});

it("baselineModule loads the deployed module from the requested commit", async () => {
  const calls: string[][] = [];
  const loads: [string, string][] = [];
  const git = (args: string[]) => {
    calls.push(args);
    return "module source";
  };
  const load: ModuleLoader = async (source, sha) => {
    loads.push([source, sha]);
    return worktreePlan;
  };
  assert.equal(await baselineModule(SHA, git, load), worktreePlan);
  assert.deepEqual(calls, [["show", `${SHA}:${BASELINE_PATH}`]]);
  assert.deepEqual(loads, [["module source", SHA]]);
});

it("baselineModule fetches the missing object once and rereads it", async () => {
  const calls: string[][] = [];
  const git = (args: string[]) => {
    calls.push(args);
    if (args[0] === "show" && calls.filter((call) => call[0] === "show").length === 1)
      throw new Error("missing object");
    if (args[0] === "fetch") return "";
    return "fetched source";
  };
  const loads: string[] = [];
  const result = await baselineModule(SHA, git, async (source) => {
    loads.push(source);
    return worktreePlan;
  });
  assert.equal(result, worktreePlan);
  assert.deepEqual(calls, [
    ["show", `${SHA}:${BASELINE_PATH}`],
    ["fetch", "--no-tags", "--depth=1", "origin", SHA],
    ["show", `${SHA}:${BASELINE_PATH}`],
  ]);
  assert.deepEqual(loads, ["fetched source"]);
});

it("baselineModule propagates a failed fetch or a failed reread", async () => {
  const showFails = (args: string[]) => {
    if (args[0] === "fetch") throw new Error("fetch failed");
    throw new Error("missing object");
  };
  await assert.rejects(
    baselineModule(SHA, showFails, async () => worktreePlan),
    /fetch failed/,
  );
  const rereadFails = (args: string[]) => {
    if (args[0] === "fetch") return "";
    throw new Error("still missing");
  };
  const loads: string[] = [];
  await assert.rejects(
    baselineModule(SHA, rereadFails, async (source) => {
      loads.push(source);
      return worktreePlan;
    }),
    /still missing/,
  );
  assert.deepEqual(loads, []);
});

it("loadModule evaluates baseline source through a data URL", async () => {
  const source =
    "export function projectWorktreePlan(){return {visibleRows:[]}};export function planRenderRows(){return []};export function groupSpaceIds(){return ['loaded']}";
  const module = await loadModule(source);
  assert.deepEqual(module.groupSpaceIds(null, ["loaded"]), ["loaded"]);
});

it("buildReport records the candidate-only schema without a baseline", () => {
  const { clock } = fakeClock();
  const report = buildReport({
    candidate: worktreePlan,
    before: null,
    candidateSha: "candidate",
    baselineSha: null,
    counts: [2],
    clock,
    samples: 1,
    warmup: 0,
    iterationsFor: () => 1,
  });
  assert.equal(report.schema, 1);
  assert.equal(report.scope, SCOPE);
  assert.equal(report.comparison, "candidate_only");
  assert.equal(report.baseline_sha, null);
  assert.equal(report.candidate_sha, "candidate");
  assert.equal(report.cases.length, 1);
  assert.equal(report.cases[0].workload, "projection");
  assert.equal(report.cases[0].workspaces, 2);
  assert.equal(report.group_cases[0].workload, "group-space-ids");
  assert.equal(report.cases[0].correctness, "pass");
  assert.equal(typeof report.node, "string");
  assert.equal(typeof report.platform, "string");
  assert.equal(typeof report.architecture, "string");
});

it("buildReport reuses one projection fixture throughout timed runs", () => {
  const inputs: unknown[] = [];
  const candidate: Implementation = {
    ...worktreePlan,
    projectWorktreePlan(input) {
      inputs.push(input);
      return worktreePlan.projectWorktreePlan(input);
    },
  };
  const { clock } = fakeClock();
  buildReport({
    candidate,
    before: null,
    candidateSha: "candidate",
    baselineSha: null,
    counts: [2],
    clock,
    samples: 2,
    warmup: 0,
    iterationsFor: () => 3,
  });
  assert.equal(inputs.length, 7);
  assert.ok(inputs.every((input) => input === inputs[0]));
});

it("buildReport pairs the candidate with the baseline commit", () => {
  const { clock } = fakeClock();
  const report = buildReport({
    candidate: worktreePlan,
    before: worktreePlan,
    candidateSha: "candidate",
    baselineSha: SHA,
    counts: [3],
    clock,
    samples: 2,
    warmup: 0,
    iterationsFor: () => 1,
  });
  assert.equal(report.comparison, "paired_same_runner_alternating");
  assert.equal(report.baseline_sha, SHA);
  assert.equal(report.cases[0].baseline?.raw_ms.length, 2);
  assert.equal(report.cases[0].samples, 2);
  assert.equal(report.group_cases[0].baseline?.raw_ms.length, 2);
});

it("cliMain prints the report and resolves the candidate sha from git", async () => {
  const prints: string[] = [];
  const report = await cliMain({
    argv: ["node", "bench"],
    env: {},
    git: (args) => {
      assert.deepEqual(args, ["rev-parse", "HEAD"]);
      return "headsha\n";
    },
    counts: [2],
    samples: 1,
    warmup: 0,
    iterationsFor: () => 1,
    print: (text) => prints.push(text),
  });
  assert.equal(report.candidate_sha, "headsha");
  assert.equal(prints.length, 1);
  assert.deepEqual(JSON.parse(prints[0]), report);
});

it("cliMain writes the same artifact it prints when a path is given", async () => {
  const writes: [string, string][] = [];
  const prints: string[] = [];
  const event = JSON.stringify({ pull_request: { base: { sha: SHA } } });
  const report = await cliMain({
    argv: ["node", "bench", "/tmp/out.json"],
    env: { GITHUB_EVENT_PATH: "/event.json" },
    read: () => event,
    git: (args) => {
      assert.deepEqual(args, ["show", `${SHA}:${BASELINE_PATH}`]);
      return "source";
    },
    load: async () => worktreePlan,
    candidateSha: "headsha",
    counts: [2],
    samples: 1,
    warmup: 0,
    iterationsFor: () => 1,
    print: (text) => prints.push(text),
    write: (path, text) => writes.push([path, text]),
  });
  assert.equal(report.baseline_sha, SHA);
  assert.equal(report.comparison, "paired_same_runner_alternating");
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "/tmp/out.json");
  assert.equal(writes[0][1], prints[0]);
});
