import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { diffRows, diffWidth } from "./diff-rows.js";

test("an older diff load cannot replace a newer result for the same target", async () => {
  const source = readFileSync(new URL("./main.js", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "").replace("export default class Diff", "class Diff");
  const pending = [], jobs = [];
  const scope = { View: class {}, diffRows, diffWidth, exec() {}, loadDiff: () => new Promise((resolve) => pending.push(resolve)) };
  vm.runInNewContext(source + "\nglobalThis.Diff = Diff;", scope);
  const view = new scope.Diff();
  Object.assign(view, { target: { root: "/repo" }, rows: [], width: 300, loadGeneration: 0 });
  const cx = { notify() {}, spawn(fn) { jobs.push(fn(cx)); } };
  view.load(cx); view.load(cx);
  pending[1](["new result"]); await jobs[1];
  pending[0](["old result"]); await jobs[0];
  assert.equal(view.rows[0].text, "new result");
});
