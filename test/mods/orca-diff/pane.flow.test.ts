import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vite-plus/test";
import type { AsyncContext, Context } from "gpui-kit";
import type { DiffTarget, Exec } from "../../../src/mods/orca-diff/diff-data.js";
import Diff from "../../../src/mods/orca-diff/main.js";
import { loadDiff } from "../../../src/mods/orca-diff/diff-data.js";
import { fake, nodeOf, resetHost, world, type RecordedNode } from "./host.js";

vi.mock("gpui-kit", async () => (await import("./host.js")).gpuiKit());
vi.mock("gpui-base", async () => (await import("./host.js")).gpuiBase());
vi.mock("herdr", async () => (await import("./host.js")).herdr());

beforeEach(() => {
  resetHost();
});

test("show changes the target, the timer reloads it and a failed load shows its message", async () => {
  const jobs: Array<(cx: AsyncContext) => unknown> = [],
    timers: Array<[number, (cx: AsyncContext) => void]> = [],
    notices: number[] = [];
  const initial: DiffTarget = { root: "/repo", path: "dir/old" },
    target: DiffTarget = { ...initial, path: "dir/new" };
  world.props = initial;
  world.sharedValue = target;
  world.exec = () => ({ code: 0, stdout: "@@ -1 +1 @@\n+new\n", stderr: "" });
  const cx = fake<AsyncContext>({
    spawn(job: (cx: AsyncContext) => unknown) {
      jobs.push(job);
    },
    timer: {
      every(ms: number, fn: (cx: AsyncContext) => void) {
        timers.push([ms, fn]);
      },
    },
    notify: () => notices.push(1),
  });
  const view = new Diff();
  view.init({}, cx);
  await jobs.shift()!(cx);
  assert.equal(view.target, initial);
  world.commands = ["ignore", "show"];
  await assert.rejects(async () => jobs.shift()!(cx), /end of queue/);
  assert.equal(view.target, target);
  await jobs.shift()!(cx);
  assert.equal(view.rows.at(-1)!.text, "new");
  assert.equal(timers[0][0], 10000);
  world.exec = () => {
    throw Error("offline");
  };
  timers[0][1](cx);
  await jobs.shift()!(cx);
  assert.match(view.rows[0].text, /Cannot preview this diff: Error: offline/);
  assert.equal(notices.length, 5);
});

test("pane header uses the exact name, directory and status for each target", () => {
  const view = new Diff();
  view.rows = [];
  view.width = 300;
  for (const [target, name, dir, badge] of [
    [{ all: true }, "All changes", "", "uncommitted"],
    [{ sectionAll: true, section: "staged" }, "Staged Changes", "", "Staged"],
    [{ sectionAll: true }, "Changes", "", "Unstaged + untracked"],
    [{ path: "a/b", status: "U" }, "b", "a", "Untracked"],
    [{ path: "p", section: "staged" }, "p", "", "Staged"],
    [{ path: "p" }, "p", "", "Unstaged"],
  ] as const) {
    view.target = target;
    const tree = nodeOf(view.render(fake<Context>({})));
    const header = nodeOf(tree.c.find(([method]) => method === "child")![1][0]);
    const children = (node: RecordedNode): unknown[] =>
      node.c.filter(([method]) => method === "child").map(([, [child]]) => child);
    const [title, label] = children(header);
    assert.deepEqual(
      children(nodeOf(title)).flatMap((child) => children(nodeOf(child))),
      [name, dir],
    );
    assert.deepEqual(children(nodeOf(label)), [badge]);
  }
});

test("section selection ignores unrelated and conflicted entries, and distinguishes empty previews from errors", async () => {
  const target: DiffTarget = { sectionAll: true, section: "changes", paths: ["a", "b", "c"] };
  const exec: Exec = async (_cmd, args) =>
    args.includes("status")
      ? { code: 0, stdout: " M unrelated\0UU a\0AA b\0?? c\0", stderr: "" }
      : { code: 1, stdout: "", stderr: "" };
  assert.deepEqual(await loadDiff(target, exec), ["Untracked empty file: c"]);
  await assert.rejects(
    loadDiff({ path: "c", status: "U" }, async () => ({
      code: 1,
      stdout: "",
      stderr: " gone ",
    })),
    /gone/,
  );
  await assert.rejects(loadDiff({ ...target, paths: ["a\0b"] }, exec), /Invalid section target/);
});

test("theme tokens pass through unchanged, a missing token renders as undefined", () => {
  const full = world.theme;
  const view = new Diff();
  view.target = { path: "p" };
  world.theme = { ...full, background: "red" };
  assert.match(JSON.stringify(nodeOf(view.render(fake<Context>({})))), /\["bg",\["red"\]\]/);
  world.theme = Object.fromEntries(Object.entries(full).filter(([name]) => name !== "raised"));
  assert.doesNotThrow(() => view.render(fake<Context>({})));
});

test("the font setting passes through as configured", () => {
  const view = new Diff();
  view.target = { path: "p" };
  world.settings = { font_family: 5 };
  assert.match(JSON.stringify(nodeOf(view.render(fake<Context>({})))), /\["font_family",\[5\]\]/);
});

test("init targets props only when their root is truthy, as before", () => {
  const cx = fake<AsyncContext>({ spawn() {}, timer: { every() {} }, notify() {} });
  for (const [props, targeted] of [
    [{ root: 5 }, true],
    [{ root: "/repo" }, true],
    [{ root: "" }, false],
    [{}, false],
  ] as const) {
    world.props = props;
    const view = new Diff();
    view.init({}, cx);
    assert.equal(view.target === null, !targeted, JSON.stringify(props));
    if (targeted) assert.equal(view.target, props);
  }
});

function startDiff(props: Record<string, unknown>, sharedValue: unknown) {
  const jobs: Array<(cx: AsyncContext) => unknown> = [];
  const cx = fake<AsyncContext>({
    spawn(job: (cx: AsyncContext) => unknown) {
      jobs.push(job);
    },
    timer: { every() {} },
    notify() {},
  });
  world.props = props;
  world.commands = ["show"];
  world.sharedValue = sharedValue;
  const view = new Diff();
  view.init({}, cx);
  return { view, cx, loop: jobs.at(-1)! };
}

test("show adopts any non-nullish shared target and keeps the current one when none is shared", async () => {
  const adopted = startDiff({}, "not-an-object");
  await assert.rejects(async () => adopted.loop(adopted.cx), /end of queue/);
  assert.equal(adopted.view.target, "not-an-object");

  const props = { root: "/repo" };
  const kept = startDiff(props, undefined);
  await assert.rejects(async () => kept.loop(kept.cx), /end of queue/);
  assert.equal(kept.view.target, props);
});

test("without settings the diff uses the default mono font", () => {
  world.settings = undefined;
  const view = new Diff();
  view.target = { path: "p" };
  assert.match(JSON.stringify(nodeOf(view.render(fake<Context>({})))), /JetBrains Mono/);
});
