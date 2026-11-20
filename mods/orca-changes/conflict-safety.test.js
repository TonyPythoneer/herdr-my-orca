import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { GIT_OPTIONS } from "./git-options.js";
import { sameOperationTarget } from "./operation-target.js";

function fixture(exec) {
  let active = { active: true, folder: "/repo", machine: "host", id: "space" };
  const source = readFileSync(new URL("./main.js", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "").replace("export default class Changes", "class Changes");
  const scope = { View: class {}, spaces: () => [active], exec, READ: GIT_OPTIONS, sameOperationTarget,
    run() {}, mainChangesView: null };
  vm.runInNewContext(source + "\nglobalThis.Changes = Changes;", scope);
  const view = new scope.Changes();
  Object.assign(view, { root: "/repo", on: "host", context: JSON.stringify({ cwd: "/repo", on: "host", space: "space" }),
    busy: false, refresh() {} });
  return { view, setActive(value) { active = value; } };
}

const target = { root: "/repo", on: "host", context: JSON.stringify({ cwd: "/repo", on: "host", space: "space" }) };
const conflict = { path: "conflict.txt", xy: "UU" };
const cx = { notify() {}, spawn(fn) { this.task = fn(this); } };

test("workspace or host changes during status prevent conflict staging", async () => {
  let releaseStatus;
  let statusStarted;
  const started = new Promise((resolve) => { statusStarted = resolve; });
  const calls = [];
  const f = fixture(async (bin, args) => {
    calls.push([bin, Array.from(args)]);
    statusStarted();
    return new Promise((resolve) => { releaseStatus = resolve; });
  });
  f.view.resolveConflict(conflict, "mark_resolved", cx, target);
  await started;
  f.setActive({ active: true, folder: "/other", machine: "other-host", id: "other" });
  releaseStatus({ code: 0, stdout: "u UU N... 100644 100644 100644 100644 a b c conflict.txt\0" });
  await cx.task;
  assert.equal(calls.length, 1);
  assert.ok(calls[0][1].includes("status"));
  assert.equal(calls[0][1].at(-1), "conflict.txt");
  assert.equal(calls[0][1].includes("add"), false);
  assert.equal(calls[0][1].includes("rm"), false);
});

test("keep-deletion never invokes git", () => {
  const calls = [];
  const f = fixture(async (...args) => calls.push(args));
  f.view.resolveConflict(conflict, "keep_deletion", cx, target);
  assert.deepEqual(calls, []);
});
