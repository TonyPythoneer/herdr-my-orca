import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as diff from "../mods/orca-diff-breakdown/diff.js";

const source = readFileSync(new URL("../mods/orca-diff-breakdown/main.js", import.meta.url), "utf8")
    .replace(/^import [\s\S]*? from "[^"]+";/gm, "")
    .replace("export default class DiffBreakdown", "class DiffBreakdown");

test("virtual rows resolve by group length with bounded file reads and direct clicks", () => {
  let list;
  const box = new Proxy({}, { get: () => () => box });
  const Panel = vm.runInNewContext(source + "\nDiffBreakdown", {
    View: class {},
    v_flex: () => box,
    Scrollbar: { vertical: () => box },
    v_virtual_list: (_id, count, _height, key, render) => {
      list = { count, key, render };
      return { on_item_click(click) { list.click = click; return box; } };
    }
  });
  const panel = new Panel();
  panel.open = new Set();
  panel.groupRow = group => group.id;
  panel.fileRow = file => file.path;
  const opened = [];
  panel.openFile = path => opened.push(path);
  let reads = 0;
  const rawFiles = Array.from({ length: 10000 }, (_, i) => ({ path: `src/${i}.js`, status: "M" }));
  rawFiles[0].status = "D";
  const files = new Proxy(rawFiles, {
    get(target, property, receiver) {
      if (/^(0|[1-9]\d*)$/.test(String(property))) reads++;
      return Reflect.get(target, property, receiver);
    }
  });
  const tests = new Proxy([{ path: "test/a.js", status: "M" }, { path: "test/z.js", status: "A" }], {
    get(target, property, receiver) {
      if (/^(0|[1-9]\d*)$/.test(String(property))) reads++;
      return Reflect.get(target, property, receiver);
    }
  });
  const snapshot = { groups: [{ id: "runtime", files }, { id: "tests", files: tests }] };
  const cx = { notify() {} };

  panel.groupList(snapshot, {});
  assert.equal(list.count, 2);
  assert.equal(reads, 0);
  list.click(list.key(0), cx);
  panel.groupList(snapshot, {});
  assert.equal(list.count, 10002);
  assert.equal(reads, 0);
  list.click(list.key(10001), cx);
  panel.groupList(snapshot, {});
  assert.equal(list.count, 10004);
  assert.equal(reads, 0);

  const visible = list.render({ start: 9999, end: 10004 });
  assert.deepEqual(Array.from(visible), ["src/9998.js", "src/9999.js", "tests", "test/a.js", "test/z.js"]);
  assert.equal(reads, 4);
  list.click(list.key(1), cx);
  list.click(list.key(10003), cx);
  assert.deepEqual(opened, ["test/z.js"]);
  list.click(list.key(10001), cx);
  panel.groupList(snapshot, {});
  assert.equal(list.count, 10002);
  assert.equal(reads, 6);
});

test("workspace switches paint cached snapshots immediately and ignore late Git results", async () => {
  const space = { id: "a", folder: "/a", machine: "remote", branch: "main", active: true };
  const requests = [];
  const tasks = [];
  const afterPaint = [];
  const labels = [];
  const cx = {
    spawn(fn) { tasks.push(fn(cx)); },
    notify() {},
    timer: { every() {}, after(_delay, fn) { afterPaint.push(fn); } }
  };
  const box = new Proxy({}, { get: (_target, name) => value => {
    if (name === "child" && typeof value === "string") labels.push(value);
    return box;
  } });
  const Panel = vm.runInNewContext(source + "\nDiffBreakdown", {
    ...diff,
    View: class {},
    v_flex: () => box,
    div: () => box,
    theme: () => ({}),
    spaces: () => [space],
    exec: () => new Promise(resolve => requests.push(resolve)),
    readTextFile: async () => null
  });
  const panel = new Panel();
  const result = (root, branch) => ({ code: 0, stdout: `\x1eroot\x1f${root}\x1ebranch\x1f${branch}\x1eend\x1f` });
  panel.init(null, cx);
  Object.assign(space, { id: "b", folder: "/b", branch: "topic" });
  panel.render(cx);
  assert.equal(labels.at(-1), "Loading changes on topic…");
  afterPaint.shift()(cx);
  assert.equal(requests.length, 2);
  requests[1](result("/b", "topic"));
  await tasks[1];
  requests[0](result("/a", "main"));
  await tasks[0];
  assert.equal(panel.snapshot.branch, "topic");

  space.branch = "other";
  panel.render(cx);
  assert.equal(labels.at(-1), "Loading changes on other…");
  afterPaint.shift()(cx);
  space.branch = "topic";
  labels.length = 0;
  panel.render(cx);
  assert.ok(labels.includes("No changes on topic"));
  assert.equal(requests.length, 3);
  afterPaint.shift()(cx);
  assert.equal(requests.length, 4);
  assert.equal(panel.snapshot.branch, "topic");
  requests[2](result("/b", "other"));
  requests[3](result("/b", "topic"));
  await Promise.all(tasks);
  assert.equal(panel.snapshot.branch, "topic");
});

test("worktree and shared Git events invalidate the right caches and coalesce refreshes", async () => {
  const space = { id: "wt", folder: "/wt", machine: null, branch: "topic", active: true };
  const watches = new Map();
  const timers = [];
  const cx = {
    spawn(fn) { return fn(cx); },
    timer: { after(_delay, fn) { timers.push(fn); } }
  };
  const Panel = vm.runInNewContext(source + "\nDiffBreakdown", {
    View: class {},
    spaces: () => [space],
    watchFolder(folder) {
      let emit;
      const wait = new Promise(resolve => { emit = resolve; });
      wait.cancel = () => emit([]);
      watches.set(folder, emit);
      return wait;
    }
  });
  const panel = new Panel();
  const repo = { root: "/wt", gitDir: "/repo/.git/worktrees/wt", commonDir: "/repo/.git", on: null };
  const peer = { ...repo, root: "/repo" };
  const other = { ...repo, root: "/other", commonDir: "/other/.git" };
  const remote = { ...repo, on: "remote" };
  const context = JSON.stringify({ cwd: "/wt", on: null, space: "wt", branch: "topic" });
  const inflight = { dirty: false };
  panel.pending = new Map([[context, inflight]]);
  panel.snapshots = new Map([["wt", repo], ["peer", peer], ["other", other], ["remote", remote]]);
  const flushEvents = () => new Promise(resolve => setImmediate(resolve));
  let refreshes = 0;
  panel.refresh = () => { refreshes++; };
  panel.watch(repo, context, cx);

  watches.get(repo.commonDir)(["/repo/.git/objects/ab/cd"]);
  await flushEvents();
  assert.equal(timers.length, 0);

  watches.get(repo.root)(["/wt/already-modified.js"]);
  await flushEvents();
  assert.deepEqual(Array.from(panel.snapshots.keys()), ["peer", "other", "remote"]);
  assert.ok(inflight.dirty);
  assert.equal(timers.length, 1);

  watches.get(repo.gitDir)([`${repo.gitDir}/index`]);
  watches.get(repo.commonDir)(["/repo/.git/refs/heads/main"]);
  await flushEvents();
  assert.deepEqual(Array.from(panel.snapshots.keys()), ["other", "remote"]);
  assert.equal(timers.length, 1);
  timers.shift()(cx);
  assert.equal(refreshes, 1);

  watches.get(repo.root)(["/wt"]);
  await flushEvents();
  panel.stopWatching();
  timers.shift()(cx);
  assert.equal(refreshes, 1);
});
