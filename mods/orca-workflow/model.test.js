import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMPLE, parseDoc, stageCards } from "./model.js";

test("parseDoc reads a json fence in markdown or bare json", () => {
  assert.equal(parseDoc("# Workflow\n\n```json\n{\"run_id\":\"a\"}\n```\n").run_id, "a");
  assert.equal(parseDoc("{\"run_id\":\"b\"}").run_id, "b");
  assert.equal(parseDoc(null), null); // an absent file
  assert.throws(() => parseDoc("not json"));
});

test("cards carry progress, subtitle and numbered order", () => {
  const [plan, impl] = stageCards(SAMPLE);
  assert.equal(plan.number, "01");
  assert.equal(plan.fraction, 1);
  assert.equal(impl.fraction, 7 / 12);
  assert.equal(impl.subtitle, "Coding · Unit / Integration Tests");
});

test("agents resolve live by address, else offline", () => {
  const cards = stageCards(SAMPLE, [{ address: "t2", status: "working", program: { name: "OpenCode" } }]);
  assert.deepEqual(cards[1].agents[0], { address: "t2", name: "OpenCode", task: "Implement API handlers", state: "working" });
  assert.equal(cards[1].agents[1].state, "offline");
});

test("bad numbers and unknown status do not break a card", () => {
  const [c] = stageCards({ stages: [{ id: "x", status: "weird", completed: 9, total: "3" }] });
  assert.equal(c.status, "queued");
  assert.equal(c.completed, 3);
  assert.deepEqual(stageCards(null), []);
});
