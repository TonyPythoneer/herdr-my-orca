import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { loadDiff } from "./diff-data.js";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
// The stub forwards nextCommand() to this global, so a test can feed the command loop.
globalThis.__herdrNextCommand = () => globalThis.command();
const { default: Diff } = await import("./main.js");

test("show changes the target, the timer reloads it and a failed load shows its message", async () => {
  const jobs = [], timers = [], notices = [];
  const initial = { root: "/repo", path: "dir/old" }, target = { ...initial, path: "dir/new" };
  globalThis.__herdrProps = () => initial;
  globalThis.__herdrShared = key => key === "orca-diff.target" ? target : undefined;
  globalThis.__herdrExec = () => ({ code: 0, stdout: "@@ -1 +1 @@\n+new\n" });
  const cx = { spawn: job => jobs.push(job), timer: { every: (...args) => timers.push(args) }, notify: () => notices.push(1) };
  const view = new Diff();
  view.init({}, cx);
  await jobs.shift()(cx);
  assert.equal(view.target, initial);
  const commands = ["ignore", "show"];
  globalThis.command = () => { if (!commands.length) throw Error("end of queue"); return commands.shift(); };
  await assert.rejects(jobs.shift()(cx), /end of queue/);
  assert.equal(view.target, target);
  await jobs.shift()(cx);
  assert.equal(view.rows.at(-1).text, "new");
  assert.equal(timers[0][0], 10000);
  globalThis.__herdrExec = () => { throw Error("offline"); };
  timers[0][1](cx); await jobs.shift()(cx);
  assert.match(view.rows[0].text, /Cannot preview this diff: Error: offline/);
  assert.equal(notices.length, 5);
});

test("pane header uses the exact name, directory and status for each target", () => {
  const view = new Diff();
  view.rows = []; view.width = 300;
  for (const [target, name, dir, badge] of [
    [{ all: true }, "All changes", "", "uncommitted"],
    [{ sectionAll: true, section: "staged" }, "Staged Changes", "", "Staged"],
    [{ sectionAll: true }, "Changes", "", "Unstaged + untracked"],
    [{ path: "a/b", status: "U" }, "b", "a", "Untracked"],
    [{ path: "p", section: "staged" }, "p", "", "Staged"],
    [{ path: "p" }, "p", "", "Unstaged"],
  ]) {
    view.target = target;
    const header = view.render({}).__node.c.find(([method]) => method === "child")[1][0];
    const children = node => node.c.filter(([method]) => method === "child").map(([, [child]]) => child);
    const [title, label] = children(header);
    assert.deepEqual(children(title).flatMap(children), [name, dir]);
    assert.deepEqual(children(label), [badge]);
  }
});

test("section selection ignores unrelated and conflicted entries, and distinguishes empty previews from errors", async () => {
  const target = { sectionAll: true, section: "changes", paths: ["a", "b", "c"] };
  const exec = (_cmd, args) => args.includes("status")
    ? { code: 0, stdout: " M unrelated\0UU a\0AA b\0?? c\0" }
    : { code: 1, stdout: "", stderr: "" };
  assert.deepEqual(await loadDiff(target, exec), ["Untracked empty file: c"]);
  await assert.rejects(loadDiff({ path: "c", status: "U" }, () => ({ code: 1, stdout: "", stderr: " gone " })), /gone/);
  await assert.rejects(loadDiff({ ...target, paths: ["a\0b"] }, exec), /Invalid section target/);
});
