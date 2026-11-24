import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));

// Supply the host events the shared recorder leaves undefined.
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(name, context, next) {
    const result = await next(name, context);
    if (name !== "herdr") return result;
    const source = 'export * from ' + JSON.stringify(result.url)
      + '; export const updates = () => globalThis.__updates?.() ?? ({ core: {}, app: {} }),'
      + ' panes = () => globalThis.__panes, hc = globalThis.__hc,'
      + ' notify = (...a) => globalThis.__notify?.(...a), setShared = (...a) => globalThis.__setShared?.(...a),'
      + ' knownAgents = () => globalThis.__knownAgents(), keys = () => globalThis.__keys?.() ?? [],'
      + ' watchFolder = (...args) => globalThis.__watch(...args),'
      + ' nextCommand = () => globalThis.__command();';
    return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
  }
`));
globalThis.__hc = async () => ({ code: 0, stdout: JSON.stringify({ foreground: { cwd: "/wt" } }) });
const { default: Status } = await import("./main.js");

test("refresh command, folder watch and timers use the callback context", async () => {
  const view = new Status(), jobs = [], timers = [], refresh = [];
  const cx = { spawn: fn => jobs.push(fn), timer: { every: (ms, fn) => timers.push([ms, fn]) } };
  const event = {};
  view.refreshUsage = (...args) => refresh.push(args);
  view.init({}, cx);
  let watches = 0;
  globalThis.__watch = async () => { if (watches++) throw Error("closed"); };
  await jobs[0](event);
  const commands = ["unrelated", "refresh"];
  globalThis.__command = async () => { if (commands.length) return commands.shift(); throw Error("closed"); };
  await assert.rejects(jobs.at(-1)(event), /closed/);
  timers.find(([ms]) => ms === 300000)[1](event);
  assert.deepEqual(refresh, [[cx], [event], [event, true], [event]]);
});

test("follow poll finds the linked checkout and moves the pane in command order", async () => {
  const view = new Status(), commands = [];
  const source = { id: "src", active: true, folder: "/repo", tabs: [{ id: "one" }] };
  const target = { id: "dst", folder: "/wt", tabs: [{ id: "two" }] };
  globalThis.__herdrSpaces = () => [source, target];
  const pane = { terminal: "term", tab: "one", program: { agent: true, name: "OMP" } };
  globalThis.__panes = [pane];
  globalThis.__herdrExec = async (_cmd, [, path]) => ({ code: 0, stdout: [path, path === "/wt" ? "/repo/.git/worktrees/wt" : "/repo/.git", "/repo/.git", "feat"].join("\n") });
  globalThis.__herdrRun = (cmd, args) => {
    commands.push([cmd, args]);
    if (cmd === "space.select") { source.active = false; target.active = true; }
    if (cmd === "terminal.park") globalThis.__panes = [];
    if (cmd === "terminal.keep") globalThis.__panes = [{ ...pane, tab: "two" }];
  };
  let job;
  const cx = { spawn: fn => { job = fn; }, sleep: () => assert.fail("unexpected wait") };
  view.followTick(cx);
  await job(cx);
  assert.deepEqual(commands.map(([cmd]) => cmd), ["tab.new", "space.select", "terminal.park", "terminal.keep", "tab.rename"]);
  assert.equal(view.wtBusy, false);
});

test("status bar formats pending, detail, error and tightest quota chips", () => {
  const view = new Status();
  view.readings = null;
  assert.match(JSON.stringify(view.render({}).__node), /···/);
  view.readings = [
    { detail: true, status: "ok", provider: "codex", buckets: [{ usedPercent: 4, label: "5h" }] },
    { detail: true, provider: "opencode", text: "12k tokens", buckets: [] },
    { provider: "unknown", status: "ok", buckets: [{ usedPercent: 92, windowMinutes: 300 }] },
    { provider: "omp", status: "error", label: "unavailable" },
  ];
  const bar = JSON.stringify(view.render({}).__node);
  for (const label of ["4%", "12k tokens", "92% 5h", "unavailable"]) assert.ok(bar.includes(label), label);
});

// A tab that follows its agent into a folder with no space yet: the whole move, in command order.
function moveFixture() {
  const source = { id: "src", active: true, folder: "/repo", tabs: [{ id: "one" }] };
  const spaces = [source], runs = [], shared = {}, notices = [];
  const pane = { terminal: "term", tab: "one", program: { agent: true, name: "OMP" } };
  globalThis.__panes = [pane];
  globalThis.__herdrSpaces = () => spaces;
  globalThis.__setShared = (key, value) => { shared[key] = value; };
  globalThis.__herdrShared = key => shared[key];
  globalThis.__notify = notice => notices.push(notice);
  const move = { terminal: "term", app: "OMP", to: "/wt", branch: "feat",
    from: { space: "src", folder: "/repo", tab: "one", active: false, tabName: "Named", onlyTerminal: true } };
  const cx = { sleep: async () => {} };
  const known = [{ ...source, checkout: { top: "/repo" } }];
  return { source, spaces, runs, shared, notices, pane, move, cx, known };
}

test("followMove opens the worktree's space, moves the tab, drops the spare shell and restores the selection", async () => {
  const { source, spaces, runs, shared, notices, pane, move, cx, known } = moveFixture();
  const target = { id: "dst", folder: "/wt", tabs: [{ id: "shell" }] };
  globalThis.__herdrRun = (cmd, args) => {
    runs.push([cmd, args]);
    if (cmd === "space.new") spaces.push(target);
    if (cmd === "space.select") for (const s of spaces) s.active = s.id === args.id;
    if (cmd === "terminal.park") globalThis.__panes = [];
    if (cmd === "terminal.keep") { target.tabs.push({ id: "landed" }); globalThis.__panes = [{ ...pane, tab: "landed" }]; }
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
  assert.deepEqual(shared["wt-follow.moved"], { term: "/wt" });
  assert.deepEqual(notices, [{ title: "OMP is in feat", body: "Its tab moved to /wt.", level: "success" }]);
  assert.equal(source.active, true);
});

test("followMove gives up quietly when the space never appears and warns when the pane is lost", async () => {
  const first = moveFixture();
  globalThis.__herdrRun = (cmd, args) => first.runs.push([cmd, args]);
  await new Status().followMove(first.move, first.known, first.cx);
  assert.deepEqual(first.runs.map(([cmd]) => cmd), ["space.new"]);
  assert.deepEqual(first.notices, []);

  const lost = moveFixture();
  const target = { id: "dst", folder: "/wt", tabs: [] };
  lost.known.push({ ...target, checkout: { top: "/wt" } });
  lost.spaces.push(target);
  globalThis.__herdrRun = (cmd, args) => {
    lost.runs.push([cmd, args]);
    if (cmd === "space.select") for (const s of lost.spaces) s.active = s.id === args.id;
    if (cmd === "terminal.park") globalThis.__panes = [];
  };
  await new Status().followMove(lost.move, lost.known, lost.cx);
  assert.deepEqual(lost.runs.map(([cmd]) => cmd), ["tab.new", "space.select", "terminal.park", "terminal.keep"]);
  assert.deepEqual(lost.shared, {});
  assert.equal(lost.notices[0].title, "OMP lost its pane");
  assert.equal(lost.notices[0].level, "error");
});

test("a usage refresh is throttled, honours force, filters by installed agents and keeps old readings on failure", async () => {
  const view = new Status(), jobs = [], scripts = [];
  let notified = 0;
  const cx = { notify: () => notified++, spawn: fn => jobs.push(fn) };
  globalThis.__knownAgents = async () => [{ installed: true, run: ["claude"] }, { installed: false, run: ["codex"] }];
  globalThis.__herdrExec = async (cmd, args) => {
    if (cmd === "sh") scripts.push(args[1]);
    return { code: 1, stdout: "" };
  };
  view.readings = null;
  view.isRefreshing = false;
  view.lastRefresh = 0;
  view.refreshUsage(cx);
  assert.equal(view.isRefreshing, true);
  view.refreshUsage(cx, true);
  assert.equal(jobs.length, 1, "a refresh in flight is not doubled");
  await jobs[0](cx);
  assert.equal(view.isRefreshing, false);
  assert.deepEqual(view.readings.map(r => r.provider), ["antigravity"]);
  assert.equal(scripts.length, 1, "only the installed agent is probed");
  const before = view.readings;
  view.refreshUsage(cx);
  assert.equal(jobs.length, 1, "events inside the two-second floor are skipped");
  globalThis.__knownAgents = () => { throw Error("no agent list"); };
  view.refreshUsage(cx, true);
  await jobs[1](cx);
  assert.equal(view.readings, before);
  assert.equal(view.isRefreshing, false);
  assert.equal(notified, 4);
});

test("the bar draws update, host and floating-workspace segments from the app model", () => {
  const view = new Status();
  view.readings = [];
  globalThis.__herdrMachines = () => [{ name: "a", layout: "ready" }, { name: "b", layout: "ready" }];
  globalThis.__updates = () => ({ core: { updating: true }, app: { ready: true } });
  globalThis.__herdrShared = key => ({ "orca-float.attention": true })[key];
  globalThis.__keys = () => [{ action: "orca-float.toggle", keys: "cmd-f" }];
  const bar = JSON.stringify(view.render({}).__node);
  for (const part of ["st-core-updating", "Update ready", "2 hosts", "Show Floating Workspace, new activity", "Show Floating Workspace (cmd-f)", "#f59e0b"]) assert.ok(bar.includes(part), part);
  globalThis.__updates = () => ({ core: { error: "x" }, app: {} });
  globalThis.__herdrMachines = () => [{ name: "a", layout: "loading" }];
  globalThis.__herdrShared = key => ({ "orca-float.open": true })[key];
  globalThis.__keys = () => [];
  const second = JSON.stringify(view.render({}).__node);
  for (const part of ["1 server update failed", "Minimize Floating Workspace"]) assert.ok(second.includes(part), part);
  assert.ok(!second.includes("host"));
  delete globalThis.__updates;
  delete globalThis.__herdrMachines;
});

test("reset times read as minutes, hours with minutes, or days with hours", () => {
  const view = new Status(), at = seconds => new Date(Date.now() + seconds * 1000).toISOString();
  view.readings = [{ provider: "claude", status: "ok", detail: true, buckets: [
    { usedPercent: 1, label: "5h", resetTime: at(1830) }, { usedPercent: 2, label: "wk", resetTime: at(7230) },
    { usedPercent: 3, label: "5h", resetTime: at(90030) }, { usedPercent: 4, label: "wk", resetTime: at(-50) }] }];
  const bar = JSON.stringify(view.render({}).__node);
  for (const text of ["30m", "2h 0m", "1d 1h", "0m"]) assert.ok(bar.includes(`["${text}"]`), text);
});

test("an invalid usage reset time does not render NaN", () => {
  const view = new Status();
  view.readings = [{ provider: "claude", status: "ok", detail: true, buckets: [
    { usedPercent: 42, label: "5h", resetTime: "not a date" },
  ] }];
  const bar = JSON.stringify(view.render({}).__node);
  assert.match(bar, /42%/);
  assert.doesNotMatch(bar, /NaN/);
});
