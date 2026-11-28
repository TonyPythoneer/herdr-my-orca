import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import Status, { type Cx } from "../../../src/mods/orca-status-bar/main.js";
import {
  FOLLOW_STATE_KEY,
  type Checkout,
  type Move,
} from "../../../src/mods/orca-status-bar/wt-follow.js";
import {
  bucket,
  fakeCx,
  handler,
  reading,
  resetHost,
  treeOf,
  world,
  type TestSpace,
} from "./host.js";

vi.mock("gpui-kit", async () => (await import("./host.js")).gpuiKit());
vi.mock("gpui-base", async () => (await import("./host.js")).gpuiBase());
vi.mock("herdr", async () => (await import("./host.js")).herdr());

const checkout = (top: string, linked = false): Checkout => ({
  top,
  gitdir: linked ? "/repo/.git/worktrees/wt" : "/repo/.git",
  common: "/repo/.git",
  branch: "feat",
});

const gitOutput = (path: string) =>
  [path, path === "/wt" ? "/repo/.git/worktrees/wt" : "/repo/.git", "/repo/.git", "feat"].join(
    "\n",
  );

test("refresh command, folder watch and timers use the callback context", async () => {
  resetHost();
  const view = new Status();
  const jobs: Array<(cx: Cx) => unknown> = [];
  const timers: Array<[number, (cx: Cx) => unknown]> = [];
  const refresh: unknown[][] = [];
  const cx = fakeCx({
    spawn: (job) => jobs.push(job),
    timer: { every: (ms, fn) => timers.push([ms, fn]) },
  });
  const event = fakeCx();
  view.refreshUsage = (...args) => {
    refresh.push(args);
  };
  view.init({}, cx);
  let watches = 0;
  world.watch = async () => {
    if (watches++) throw Error("closed");
    return [];
  };
  await jobs[1](event);
  const commands = ["unrelated", "refresh"];
  world.nextCommand = async () => {
    const next = commands.shift();
    if (next === undefined) throw Error("closed");
    return next;
  };
  await assert.rejects(Promise.resolve(jobs[jobs.length - 1](event)), /closed/);
  const fallback = timers.find(([ms]) => ms === 300000);
  assert.ok(fallback);
  fallback[1](event);
  assert.deepEqual(refresh, [[cx], [event], [event, true], [event]]);
});

test("follow poll finds the linked checkout and moves the pane in command order", async () => {
  resetHost();
  const view = new Status();
  const source = { id: "src", active: true, folder: "/repo", tabs: [{ id: "one" }] };
  const target = { id: "dst", folder: "/wt", active: false, tabs: [{ id: "two" }] };
  world.spaces = [source, target];
  const pane = { terminal: "term", tab: "one", program: { agent: true, name: "OMP" } };
  world.panes = [pane];
  world.exec = async (_command, args) => ({ code: 0, stdout: gitOutput(args[1]), stderr: "" });
  world.onRun = (command) => {
    if (command === "space.select") {
      source.active = false;
      target.active = true;
    }
    if (command === "terminal.park") world.panes = [];
    if (command === "terminal.keep") world.panes = [{ ...pane, tab: "two" }];
  };
  const jobs: Array<(cx: Cx) => unknown> = [];
  view.followTick(
    fakeCx({ spawn: (job) => jobs.push(job), sleep: () => assert.fail("unexpected wait") }),
  );
  const [job] = jobs;
  assert.ok(job);
  await job(fakeCx({ sleep: () => assert.fail("unexpected wait") }));
  assert.deepEqual(
    world.runs.map(([command]) => command),
    ["tab.new", "space.select", "terminal.park", "terminal.keep", "tab.rename"],
  );
  assert.equal(view.wtBusy, false);
});

test("status bar formats pending, detail, error and tightest quota chips", () => {
  resetHost();
  const view = new Status();
  view.readings = null;
  assert.match(treeOf(view.render()), /···/);
  view.readings = [
    reading({
      detail: true,
      provider: "codex",
      buckets: [bucket({ usedPercent: 4, label: "5h" })],
    }),
    reading({ detail: true, provider: "opencode", text: "12k tokens" }),
    reading({ provider: "unknown", buckets: [bucket({ usedPercent: 92, windowMinutes: 300 })] }),
    reading({ provider: "omp", status: "error", label: "unavailable" }),
  ];
  const bar = treeOf(view.render());
  for (const label of ["4%", "12k tokens", "92% 5h", "unavailable"])
    assert.ok(bar.includes(label), label);
});

type MoveFixture = ReturnType<typeof moveFixture>;

function moveFixture() {
  resetHost();
  const source = { id: "src", active: true, folder: "/repo", tabs: [{ id: "one" }] };
  const spaces: TestSpace[] = [source];
  world.spaces = spaces;
  const pane = { terminal: "term", tab: "one", program: { agent: true, name: "OMP" } };
  world.panes = [pane];
  const move: Move = {
    terminal: "term",
    app: "OMP",
    to: "/wt",
    branch: "feat",
    from: {
      space: "src",
      folder: "/repo",
      tab: "one",
      active: false,
      tabName: "Named",
      onlyTerminal: true,
    },
  };
  const known = [{ ...source, checkout: checkout("/repo") }];
  return {
    source,
    spaces,
    pane,
    move,
    known,
    cx: fakeCx({ sleep: async () => {} }),
    shared: world.shared,
    runs: world.runs,
    notices: world.notices,
  };
}

test("followMove opens the worktree's space, moves the tab, drops the spare shell and restores the selection", async () => {
  const { source, spaces, pane, move, known, cx, shared, runs, notices }: MoveFixture =
    moveFixture();
  const target = { id: "dst", folder: "/wt", tabs: [{ id: "shell" }] };
  world.onRun = (command, args) => {
    if (command === "space.new") spaces.push(target);
    if (command === "space.select") for (const s of spaces) s.active = s.id === args?.id;
    if (command === "terminal.park") world.panes = [];
    if (command === "terminal.keep") {
      target.tabs.push({ id: "landed" });
      world.panes = [{ ...pane, tab: "landed" }];
    }
  };
  await new Status().followMove(move, known, cx);
  assert.deepEqual(runs, [
    ["space.new", { folder: "/wt", focus: false }],
    ["tab.new", { space: "src", folder: "/repo", focus: false }],
    ["space.select", { id: "dst" }],
    ["terminal.park", { terminal: "term" }],
    ["terminal.keep", { terminal: "term", place: "tab" }],
    ["tab.rename", { id: "landed", name: "Named" }],
    ["tab.close", { id: "shell" }],
    ["space.select", { id: "src" }],
  ]);
  assert.deepEqual(shared[FOLLOW_STATE_KEY], { term: "/wt" });
  assert.deepEqual(notices, [
    { title: "OMP is in feat", body: "Its tab moved to /wt.", level: "success" },
  ]);
  assert.equal(source.active, true);
});

test("followMove keeps a string moved-state as its spread characters, as legacy did", async () => {
  const { spaces, pane, move, known, cx, shared } = moveFixture();
  world.shared[FOLLOW_STATE_KEY] = "ab";
  const target = { id: "dst", folder: "/wt", tabs: [{ id: "landed" }] };
  spaces.push(target);
  world.onRun = (command) => {
    if (command === "terminal.park") world.panes = [];
    if (command === "terminal.keep") world.panes = [{ ...pane, tab: "landed" }];
  };
  await new Status().followMove(
    move,
    [...known, { ...target, checkout: checkout("/wt", true) }],
    cx,
  );
  assert.deepEqual(shared[FOLLOW_STATE_KEY], { 0: "a", 1: "b", term: "/wt" });
});

test("followMove gives up quietly when the space never appears and warns when the pane is lost", async () => {
  const first = moveFixture();
  await new Status().followMove(first.move, first.known, first.cx);
  assert.deepEqual(
    world.runs.map(([command]) => command),
    ["space.new"],
  );
  assert.equal(world.notices.length, 0);

  const lost = moveFixture();
  const target = { id: "dst", folder: "/wt", active: false, tabs: [] };
  lost.known.push({ ...target, checkout: checkout("/wt", true) });
  lost.spaces.push(target);
  world.onRun = (command, args) => {
    if (command === "space.select") for (const s of lost.spaces) s.active = s.id === args?.id;
    if (command === "terminal.park") world.panes = [];
  };
  await new Status().followMove(lost.move, lost.known, lost.cx);
  assert.deepEqual(
    world.runs.map(([command]) => command),
    ["tab.new", "space.select", "terminal.park", "terminal.keep"],
  );
  assert.deepEqual(lost.shared, {});
  assert.equal(world.notices[0].title, "OMP lost its pane");
  assert.equal(world.notices[0].level, "error");
});

test("a usage refresh is throttled, honours force, filters by installed agents and keeps old readings on failure", async () => {
  resetHost();
  const view = new Status();
  const jobs: Array<(cx: Cx) => unknown> = [];
  const scripts: string[] = [];
  let notified = 0;
  const cx = fakeCx({
    notify: () => {
      notified++;
    },
    spawn: (job) => jobs.push(job),
  });
  world.knownAgents = async () => [
    { installed: true, run: ["claude"] },
    { installed: false, run: ["codex"] },
  ];
  world.exec = async (command, args) => {
    if (command === "sh") scripts.push(args[1]);
    return { code: 1, stdout: "", stderr: "" };
  };
  view.isRefreshing = false;
  view.lastRefresh = 0;
  view.refreshUsage(cx);
  assert.equal(view.isRefreshing, true);
  view.refreshUsage(cx, true);
  assert.equal(jobs.length, 1, "a refresh in flight is not doubled");
  await jobs[0](cx);
  assert.equal(view.isRefreshing, false);
  assert.deepEqual(
    view.readings?.map((r) => r.provider),
    ["antigravity"],
  );
  assert.equal(scripts.length, 1, "only the installed agent is probed");
  const before = view.readings;
  view.refreshUsage(cx);
  assert.equal(jobs.length, 1, "events inside the two-second floor are skipped");
  world.knownAgents = () => {
    throw Error("no agent list");
  };
  view.refreshUsage(cx, true);
  await jobs[1](cx);
  assert.equal(view.readings, before);
  assert.equal(view.isRefreshing, false);
  assert.equal(notified, 4);
});

test("the bar draws update, host and floating-workspace segments from the app model", () => {
  resetHost();
  const view = new Status();
  view.readings = [];
  world.machines = [
    { name: "a", layout: "ready" },
    { name: "b", layout: "ready" },
  ];
  world.updates = { core: { updating: true }, app: { ready: true } };
  world.shared = { "orca-float-workspace.attention": true };
  world.keys = [{ section: "", action: "orca-float-workspace.toggle", keys: "cmd-f" }];
  const bar = treeOf(view.render());
  for (const part of [
    "st-core-updating",
    "Update ready",
    "2 hosts",
    "Show Floating Workspace, new activity",
    "Show Floating Workspace (cmd-f)",
    "#f59e0b",
  ])
    assert.ok(bar.includes(part), part);
  world.updates = { core: { error: "x" }, app: {} };
  world.machines = [{ name: "a", layout: "loading" }];
  world.shared = { "orca-float-workspace.open": true };
  world.keys = [];
  const second = treeOf(view.render());
  for (const part of ["1 server update failed", "Minimize Floating Workspace"])
    assert.ok(second.includes(part), part);
  assert.ok(!second.includes("host"));
});

test("reset times read as minutes, hours with minutes, or days with hours", () => {
  resetHost();
  const view = new Status();
  const at = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
  view.readings = [
    reading({
      provider: "claude",
      detail: true,
      buckets: [
        bucket({ usedPercent: 1, label: "5h", resetTime: at(1830) }),
        bucket({ usedPercent: 2, label: "wk", resetTime: at(7230) }),
        bucket({ usedPercent: 3, label: "5h", resetTime: at(90030) }),
        bucket({ usedPercent: 4, label: "wk", resetTime: at(-50) }),
      ],
    }),
  ];
  const bar = treeOf(view.render());
  for (const text of ["30m", "2h 0m", "1d 1h", "0m"]) assert.ok(bar.includes(`["${text}"]`), text);
});

test("an invalid usage reset time does not render NaN", () => {
  resetHost();
  const view = new Status();
  view.readings = [
    reading({
      provider: "claude",
      detail: true,
      buckets: [bucket({ usedPercent: 42, label: "5h", resetTime: "not a date" })],
    }),
  ];
  const bar = treeOf(view.render());
  assert.match(bar, /42%/);
  assert.doesNotMatch(bar, /NaN/);
});

test("agent CWD uses the native pane value and queries core only for missing values", async () => {
  resetHost();
  const result = await new Status().agentCwds([
    { terminal: "native", cwd: "/native" },
    { terminal: "fallback", cwd: null },
  ]);
  assert.deepEqual(result, { native: "/native", fallback: "/wt" });
});

test("a non-string foreground cwd is kept as the legacy ?? null value", async () => {
  resetHost({
    hc: async () => ({ code: 0, stdout: JSON.stringify({ foreground: { cwd: 7 } }), stderr: "" }),
  });
  const result = await new Status().agentCwds([{ terminal: "t", cwd: null }]);
  assert.deepEqual(result, { t: 7 });
});

test("known spaces reuse already probed folders and skip remote folders", async () => {
  resetHost();
  const view = new Status();
  const calls: string[] = [];
  view.wtCheckout = async (folder) => {
    calls.push(folder);
    return checkout(folder);
  };
  const snapshot = [
    { id: "a", folder: "/already" },
    { id: "b", folder: "/new" },
    { id: "c", folder: "/new" },
    { id: "d", folder: "/remote", machine: "remote" },
  ];
  const known = await view.knownSpaces(snapshot, new Map([["/already", checkout("/already")]]));
  assert.deepEqual(calls, ["/new"]);
  assert.deepEqual(
    known.map((s) => s.checkout?.top ?? null),
    ["/already", "/new", "/new", null],
  );
});

test("performance contract: native CWD, subprocess budget and worktree cache hits", async () => {
  resetHost();
  const view = new Status();
  view.wtCheckouts = new Map();
  let subprocesses = 0;
  world.exec = async (_command, args) => {
    subprocesses++;
    const path = args[1];
    return {
      code: 0,
      stdout: [path, path + "/.git", path + "/.git", "main"].join("\n"),
      stderr: "",
    };
  };
  const snapshot = Array.from({ length: 20 }, (_, i) => ({ id: String(i), folder: "/fixture" }));
  await view.knownSpaces(snapshot);
  const cold = subprocesses;
  await view.knownSpaces(snapshot);
  const warm = subprocesses - cold;
  assert.equal(cold, 1);
  assert.equal(warm, 0);
  const panes = Array.from({ length: 20 }, (_, i) => ({ terminal: String(i), cwd: "/fixture" }));
  const hcBefore = world.hcCalls;
  const cwds = await view.agentCwds(panes);
  const cliFallbacks = world.hcCalls - hcBefore;
  assert.equal(Object.keys(cwds).length, 20);
  assert.equal(cliFallbacks, 0);
  console.log(
    "PERF_CONTRACT " +
      JSON.stringify({
        id: "status.refresh",
        scope: "host stub",
        workspaces: 20,
        cold_subprocesses: cold,
        warm_subprocesses: warm,
        cache_lookup_count: 1,
        cache_hit_count: 1,
        cache_hit_rate: 1,
        native_cwd_count: 20,
        cli_fallbacks: cliFallbacks,
      }),
  );
});

test("the refresh button and the segments run their commands when clicked", () => {
  resetHost();
  const view = new Status();
  view.readings = [];
  world.updates = { core: { updating: true }, app: { ready: true } };
  view.render();
  const spawned: Array<(cx: Cx) => unknown> = [];
  const refresh = handler("on_click");
  assert.ok(refresh);
  refresh({}, fakeCx({ spawn: (job) => spawned.push(job) }));
  assert.equal(view.isRefreshing, true);
  assert.equal(spawned.length, 1);

  const updates = handler("on_click", "st-core-updating");
  assert.ok(updates);
  updates();
  assert.deepEqual(world.runs.at(-1), ["app.settings", { section: "updates" }]);

  const float = handler("on_click", "st-float");
  assert.ok(float);
  float();
  assert.deepEqual(world.runs.at(-1), ["orca-float-workspace.toggle", undefined]);
});

test("a theme token is passed through unchanged, and a missing token stays undefined", () => {
  resetHost({
    theme: {
      surface: "red",
      border: "#010101",
      raised: "#020202",
      hover: "#030303",
      foreground: "#040404",
      muted: "#050505",
      blocked: "#060606",
      done: "#070707",
    },
  });
  const view = new Status();
  view.readings = [];
  const bar = treeOf(view.render());
  assert.ok(bar.includes('["bg",["red"]]'));
  assert.ok(bar.includes('["#040404"]'));

  resetHost({ theme: { foreground: "#040404" } });
  const missing = treeOf(new Status().render());
  assert.ok(missing.includes('["bg",[null]]'));
});

test("a detail bucket without a label renders the legacy undefined child", () => {
  resetHost();
  const view = new Status();
  view.readings = [
    reading({ provider: "claude", detail: true, buckets: [bucket({ usedPercent: 5 })] }),
  ];
  assert.ok(treeOf(view.render()).includes('["child",[null]]'));
});

test("the gateway usage reads the event log and draws its request counts", async () => {
  resetHost({
    readText: async (path) =>
      path.endsWith("events.jsonl")
        ? JSON.stringify({
            version: 1,
            kind: "attempt",
            provider: "openai",
            model: "m",
            id: "1",
            timestamp: Date.now(),
          })
        : null,
  });
  const view = new Status();
  const jobs: Array<(cx: Cx) => unknown> = [];
  view.refreshGatewayUsage(fakeCx({ spawn: (job) => jobs.push(job) }));
  const [job] = jobs;
  assert.ok(job);
  await job(fakeCx());
  assert.equal(view.gatewayRefreshing, false);
  assert.ok(treeOf(view.render()).includes("1 req 1h"));
});

test("the gateway job keeps the previous observation when no log exists", async () => {
  resetHost();
  const view = new Status();
  view.gatewayUsage = [reading({ provider: "kept" })];
  const jobs: Array<(cx: Cx) => unknown> = [];
  view.refreshGatewayUsage(fakeCx({ spawn: (job) => jobs.push(job) }));
  const [job] = jobs;
  assert.ok(job);
  await job(fakeCx());
  assert.deepEqual(
    view.gatewayUsage.map((r) => r.provider),
    ["kept"],
  );
});

test("the gateway job swallows a failed read and still clears its in-flight flag", async () => {
  resetHost({
    readText: () => {
      throw Error("disk gone");
    },
  });
  const view = new Status();
  const jobs: Array<(cx: Cx) => unknown> = [];
  view.refreshGatewayUsage(fakeCx({ spawn: (job) => jobs.push(job) }));
  const [job] = jobs;
  assert.ok(job);
  await job(fakeCx());
  assert.equal(view.gatewayRefreshing, false);
});

test("a second gateway refresh while one is in flight does nothing", () => {
  resetHost();
  const view = new Status();
  const jobs: Array<(cx: Cx) => unknown> = [];
  const cx = fakeCx({ spawn: (job) => jobs.push(job) });
  view.refreshGatewayUsage(cx);
  view.refreshGatewayUsage(cx);
  assert.equal(jobs.length, 1);
});

test("follow ticks do nothing without an agent pane or while a poll is in flight", () => {
  resetHost();
  const view = new Status();
  const jobs: Array<(cx: Cx) => unknown> = [];
  const cx = fakeCx({ spawn: (job) => jobs.push(job) });
  world.panes = [{ terminal: "shell", tab: "one", program: { agent: false } }];
  view.followTick(cx);
  assert.equal(jobs.length, 0);
  world.panes = [{ terminal: "t", tab: "one", program: { agent: true, name: "OMP" } }];
  view.followTick(cx);
  view.followTick(cx);
  assert.equal(jobs.length, 1);
});

test("a folder watch that closes or has no folder leaves the timer to refresh", async () => {
  resetHost();
  const view = new Status();
  const jobs: Array<(cx: Cx) => unknown> = [];
  const refreshed: number[] = [];
  view.refreshUsage = () => {
    refreshed.push(1);
  };
  view.watch(fakeCx({ spawn: (job) => jobs.push(job) }));
  assert.equal(jobs.length, 3);
  await jobs[0](fakeCx());
  assert.deepEqual(refreshed, []);
});

test("the Antigravity error chip is hidden and a plain provider gets its letter", () => {
  resetHost();
  const view = new Status();
  view.readings = [
    reading({ provider: "antigravity", status: "error", label: "Refresh failed" }),
    reading({ provider: "zeta", status: "error", label: "boom" }),
  ];
  const bar = treeOf(view.render());
  assert.ok(!bar.includes("Refresh failed"));
  assert.ok(bar.includes('["Z"]'));
  assert.ok(bar.includes("boom"));
});

test("the usage cluster reads Used only when a chip shows a number", () => {
  resetHost();
  const view = new Status();
  view.readings = [];
  assert.ok(!treeOf(view.render()).includes("Used"));
  view.readings = [
    reading({ provider: "claude", buckets: [bucket({ usedPercent: 9, windowMinutes: 300 })] }),
  ];
  assert.ok(treeOf(view.render()).includes("Used"));
});

test("a chip with a tooltip keeps it and a tightest chip without a label has no suffix", () => {
  resetHost();
  const view = new Status();
  view.readings = [
    reading({ provider: "cursor", detail: true, text: "1 req", tooltip: "tip" }),
    reading({ provider: "claude", buckets: [bucket({ usedPercent: 7 })] }),
  ];
  const bar = treeOf(view.render());
  assert.ok(bar.includes('["tooltip",["tip"]]'));
  assert.ok(bar.includes('["7% "]'));
});

test("the chips sort by roster rank and the float toggle shows its plain label when idle", () => {
  resetHost();
  const view = new Status();
  view.readings = [
    reading({ provider: "cursor", buckets: [bucket({ usedPercent: 1, windowMinutes: 300 })] }),
    reading({ provider: "claude", buckets: [bucket({ usedPercent: 2, windowMinutes: 300 })] }),
  ];
  const bar = treeOf(view.render());
  assert.ok(bar.indexOf("2% 5h") < bar.indexOf("1% 5h"));
  assert.ok(bar.includes("Show Floating Workspace"));
  assert.ok(!bar.includes("(cmd"));
});

test("a failed agent list probes every CLI, and the refresh icon spins while a refresh runs", async () => {
  resetHost();
  const view = new Status();
  const jobs: Array<(cx: Cx) => unknown> = [];
  const probed: string[] = [];
  world.knownAgents = async () => {
    throw Error("no agent list");
  };
  world.exec = async (command, args) => {
    if (command === "sh")
      probed.push(
        args[1].includes(".codex") ? "codex" : args[1].includes("opencode") ? "opencode" : "claude",
      );
    return { code: 1, stdout: "", stderr: "" };
  };
  view.refreshUsage(fakeCx({ spawn: (job) => jobs.push(job) }), true);
  await jobs[0](fakeCx());
  assert.deepEqual(probed, ["claude", "codex", "opencode"]);
  assert.equal(view.isRefreshing, false);

  view.isRefreshing = true;
  assert.ok(treeOf(view.render()).includes('["spin",[1000]]'));
});
