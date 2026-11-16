import { test } from "node:test";
import assert from "node:assert/strict";
import { lights, inspectorRows, parseJson, statusLine, planningNote } from "./model.js";

const state = (over = {}) => ({
  run_id: "r1", stage: "development", status: "working",
  planning: { closed: null },
  tasks: [
    { id: "T-01", kind: "dev", title: "one", state: "accepted", attempts: [], test: "test -f a" },
    { id: "T-02", kind: "dev", title: "two", state: "pending", attempts: [{ reason: "x" }], test: "test -f b" },
  ],
  acceptance: [{ id: "AC-1", text: "a", verify: "test -f a" }, { id: "AC-2", text: "manual", manual: true }],
  reviews: [], rework: { cycles: 0 }, dispatch: null, ...over,
});

test("parseJson tolerates absence and rejects garbage", () => {
  assert.equal(parseJson(null), null);
  assert.equal(parseJson('{"a":1}').a, 1);
  assert.throws(() => parseJson("not json"));
});

test("lights show counts and gate states", () => {
  const l = lights(state());
  assert.deepEqual(l.map((x) => [x.label, x.accepted, x.total, x.state]), [
    ["Plan", 1, 1, "complete"],
    ["Dev", 1, 2, "working"],
    ["Tune", 0, 2, "working"],
    ["Ready", 0, 1, "pending"],
  ]);
  const done = state({ stage: "ready_for_review", status: "completed", reviews: [{ verdict: "pass", criteria: [{ id: "AC-1", pass: true }, { id: "AC-2", pass: true }] }] });
  assert.deepEqual(lights(done).map((x) => x.state), ["complete", "complete", "complete", "complete"]);
});

test("needs_user marks the stage that is stuck", () => {
  assert.equal(lights(state({ status: "needs_user" }))[1].state, "needs_user");
  assert.equal(lights(state({ status: "needs_user", stage: "tuning" }))[2].state, "needs_user");
  assert.equal(lights(state({ status: "needs_user", stage: "ready_for_review" }))[3].state, "needs_user");
  assert.equal(lights(state({ status: "failed" }))[1].state, "failed");
});

test("planning is the 1/1 gate once a run exists", () => {
  assert.deepEqual([lights(state())[0].accepted, lights(state())[0].state], [1, "complete"]);
  assert.equal(lights(state({ planning: { closed: "skipped:last_tab" } }))[0].state, "complete");
});

test("inspector rows expose tasks, attempts, acceptance and a live worker", () => {
  const s = state({ dispatch: { id: "d1", kind: "dev", task: "T-02" } });
  const rows = inspectorRows(s, [{ address: "t7", labels: { "orca.dispatch": "d1" }, status: "working" }]);
  assert.deepEqual([rows.tasks[1].id, rows.tasks[1].attempts, rows.tasks[1].terminal], ["T-02", 1, { address: "t7", status: "working" }]);
  assert.equal(rows.acceptance[0].pass, null);
  assert.equal(rows.acceptance[1].manual, true);
  assert.equal(rows.dispatch.id, "d1");
});

test("inspector maps the latest non-stale review's criteria onto acceptance", () => {
  const s = state({ reviews: [
    { verdict: "rework", stale: true, criteria: [{ id: "AC-1", pass: false }] },
    { verdict: "pass", criteria: [{ id: "AC-1", pass: true, evidence: "ok" }] },
  ] });
  const rows = inspectorRows(s);
  assert.equal(rows.acceptance[0].pass, true);
  assert.equal(rows.acceptance[0].evidence, "ok");
});

test("statusLine is a clean empty state before a run", () => {
  assert.equal(statusLine(null), "No workflow in this worktree · run /herdr-planning");
  assert.match(statusLine(state()), /Development/);
  assert.match(statusLine(state({ status: "needs_user", needs_user: { code: "unpushed" } })), /unpushed/);
  assert.equal(statusLine(state({ stage: "ready_for_review" })), "Ready for review");
});

test("planningNote explains every skipped reason", () => {
  assert.equal(planningNote(state()), null);
  assert.match(planningNote(state({ planning: { closed: "skipped:disabled" } })), /close_planning_tab/);
  assert.match(planningNote(state({ planning: { closed: "skipped:last_tab" } })), /last tab/);
  assert.match(planningNote(state({ planning: { closed: "skipped:other_work" } })), /other work/);
});
