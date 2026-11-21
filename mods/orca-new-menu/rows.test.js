import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyAgentState,
  freebuffRun,
  freebuffVisible,
  installedEnabledAgents,
  mergeInventory,
} from "./rows.js";
import { detectFreebuff, FREEBUFF_RUN, freebuffProbeArgs } from "./freebuff.js";

const AGENTS = [
  { key: "claude", name: "Claude", installed: true, run: ["claude"] },
  { key: "codex", name: "Codex", installed: true, run: ["codex"] },
  { key: "qoder", name: "Qoder", installed: false, run: ["qodercli"] },
  { key: "freebuff", name: "freebuff", installed: true, run: ["freebuff"] },
];

test("only installed and enabled official agents become rows", () => {
  assert.deepEqual(installedEnabledAgents(AGENTS, new Set()).map((a) => a.key), ["claude", "codex"]);
  assert.deepEqual(installedEnabledAgents(AGENTS, new Set(["codex"])).map((a) => a.key), ["claude"]);
  assert.deepEqual(installedEnabledAgents([...AGENTS, AGENTS[0]], new Set()).map((a) => a.key), ["claude", "codex"]);
});

test("FreeBuff is conditional and uses the existing launch integration", () => {
  assert.equal(freebuffVisible(true, []), true);
  assert.equal(freebuffVisible(false, []), false);
  assert.equal(freebuffVisible(false, AGENTS), true);
  assert.deepEqual(freebuffRun([]), FREEBUFF_RUN);
  assert.deepEqual(freebuffRun([{ key: "freebuff", installed: true, run: ["/custom/freebuff"] }]), ["/custom/freebuff"]);
  assert.deepEqual(freebuffProbeArgs(), ["-lic", "command -v -- freebuff >/dev/null 2>&1"]);
});

test("FreeBuff detection uses zsh's login environment and the same probe as launch", async () => {
  const calls = [];
  const found = await detectFreebuff(async (...args) => {
    calls.push(args);
    return { code: 0 };
  }, "remote");
  assert.equal(found, true);
  assert.deepEqual(calls, [["zsh", freebuffProbeArgs(), { timeout: 10000, on: "remote" }]]);
  assert.equal(await detectFreebuff(async () => ({ code: 1 })), false);
  assert.equal(await detectFreebuff(async () => { throw new Error("no zsh"); }), false);
});

test("the empty state is one Agent Settings action only when no official agent or FreeBuff is available", () => {
  assert.equal(emptyAgentState(0, false), true);
  assert.equal(emptyAgentState(0, true), false);
  assert.equal(emptyAgentState(2, false), false);
});

test("a fresh inventory overrides installed and run without replacing identity", () => {
  const fresh = [
    { key: "qoder", installed: true, run: ["/custom/qoder"] },
    { key: "claude", installed: false, run: ["claude"] },
  ];
  assert.deepEqual(mergeInventory(AGENTS, fresh), [
    { key: "claude", name: "Claude", installed: false, run: ["claude"] },
    { key: "codex", name: "Codex", installed: true, run: ["codex"] },
    { key: "qoder", name: "Qoder", installed: true, run: ["/custom/qoder"] },
    { key: "freebuff", name: "freebuff", installed: true, run: ["freebuff"] },
  ]);
  assert.deepEqual(mergeInventory(null, fresh), fresh);
});
