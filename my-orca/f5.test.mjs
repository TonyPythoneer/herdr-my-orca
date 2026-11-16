// F5: init records planning.core_id (planningFromTerminal), so close_planning_tab can actually close.
// closePlanningTab also leaves an already-closed Planning tab alone.
import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as orca from "./my-orca.mjs";

// What `hc get` returns for the Planning terminal, as cmdInit sees it.
const labels = { "herdr.tab": "tab9", "herdr.space": "sp1" };
const initTerm = { address: "t1", created_ms: 1, turn: 0, labels, foreground: { pid: 42 } };

async function closeWith(planning) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "f5-"));
  let tabClosed = false;
  const hc = {
    coreId: () => "c1",
    get: () => (tabClosed ? null : { address: "t1", state: "live", status: { state: "idle" }, turn: 1, created_ms: 1, labels, foreground: { pid: 42 } }),
  };
  const calls = [];
  const app = (args) => {
    calls.push(args);
    if (args[0] === "ls") return { status: 0, stdout: JSON.stringify({ spaces: [{ id: "sp1", tabs: [{ id: "tab9", terminals: [{}] }, { id: "tab1", terminals: [{}] }] }] }) };
    if (args[1] === "tab.close") tabClosed = true;
    return { status: 0, stdout: "" };
  };
  const config = orca.resolveConfig({ close_planning_tab: true }).config;
  const ctx = orca.makeRunnerContext({ stateDir: dir, state: { run_id: "r1", planning }, hc, git: {}, config, event: async () => {}, sleep: async () => {}, clock: () => 0 });
  const result = await orca.closePlanningTab(ctx, { app, wait: false });
  return { result, calls, planning: ctx.state.planning };
}

test("F5: planningFromTerminal records the core id", () => {
  assert.equal(orca.planningFromTerminal(initTerm, "c1").core_id, "c1");
});

test("F5: a Planning tab recorded by init is closed when close_planning_tab is on", async () => {
  const r = await closeWith(orca.planningFromTerminal(initTerm, "c1"));
  assert.equal(r.result, "closed");
  assert.ok(r.calls.some((a) => a.includes("tab.close")), "tab.close was called");
});

test("F5: an already-closed Planning tab is not closed again", async () => {
  const r = await closeWith({ address: "t1", core_id: "c1", created_ms: 1, tab: "tab9", space: "sp1", agent_pid: 42, turn: 0, closed: "closed" });
  assert.equal(r.result, "closed");
  assert.equal(r.calls.length, 0);
});
