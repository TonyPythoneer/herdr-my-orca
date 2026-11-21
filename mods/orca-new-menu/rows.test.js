import test from "node:test";
import assert from "node:assert/strict";
import { mergeInventory, offeredAgents, showStaticFreebuff } from "./rows.js";

const AGENTS = [
  { key: "claude", name: "Claude", installed: true, run: ["claude"] },
  { key: "freebuff", name: "freebuff", installed: true, run: ["freebuff"] },
  { key: "qoder", name: "Qoder", installed: false, run: ["qodercli"] },
];

test("disabled agents are removed and duplicate keys keep one row", () => {
  assert.deepEqual(offeredAgents(AGENTS, new Set(["qoder"])).map((a) => a.key), ["claude", "freebuff"]);
  assert.deepEqual(offeredAgents([...AGENTS, AGENTS[0]], new Set()).map((a) => a.key), ["claude", "freebuff", "qoder"]);
});

test("the static freebuff row is not duplicated or shown while disabled/unready", () => {
  assert.equal(showStaticFreebuff([], new Set(), true), true);
  assert.equal(showStaticFreebuff(AGENTS, new Set(), true), false);
  assert.equal(showStaticFreebuff([], new Set(["freebuff"]), true), false);
  assert.equal(showStaticFreebuff([], new Set(), false), false);
});

test("a fresh inventory overrides installed and run without replacing identity", () => {
  const fresh = [
    { key: "qoder", installed: true, run: ["/custom/qoder"] },
    { key: "claude", installed: false, run: ["claude"] },
  ];
  assert.deepEqual(mergeInventory(AGENTS, fresh), [
    { key: "claude", name: "Claude", installed: false, run: ["claude"] },
    { key: "freebuff", name: "freebuff", installed: true, run: ["freebuff"] },
    { key: "qoder", name: "Qoder", installed: true, run: ["/custom/qoder"] },
  ]);
  assert.deepEqual(mergeInventory(null, fresh), fresh);
});
