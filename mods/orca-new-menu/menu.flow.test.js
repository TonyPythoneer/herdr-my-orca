import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: Menu } = await import("./main.js");

test("local inventory is ready after probes, managed commands launch only while enabled", async () => {
  const agent = { key: "kimi", installed: true, name: "Kimi", run: ["kimi", "--local"] };
  const inventory = { at: Date.now(), agents: [agent], disabled: [], freebuff: false };
  globalThis.__herdrShared = key => key === "agent-manager.inventory" ? inventory : null;
  globalThis.__herdrSpaces = () => [{ active: true, id: "s", folder: "/repo" }];
  globalThis.__herdrFiles = new Map([["/home/agent-manager.json", '{"disabled":["codex"]}']]);
  const calls = [];
  globalThis.__herdrRun = (...args) => calls.push(args);
  const menu = new Menu();
  const tasks = [];
  const cx = { focus_handle: () => ({ focus() {} }), spawn: task => tasks.push(task), notify() {} };
  menu.init({}, cx);
  assert.deepEqual(menu.agentRows(), []);
  for (const task of tasks) await task(cx);
  assert.ok(menu.disabled.has("codex"));
  assert.deepEqual(menu.agentRows().map(row => row.label), ["Kimi", "FreeBuff CLI", "Agent Settings"]);
  const row = menu.agentRows()[0];
  row.run();
  inventory.disabled.push("kimi");
  row.run();
  assert.deepEqual(calls, [["tab.new", { space: "s", folder: "/repo", argv: ["env", "HERDR_ENV=1", ...agent.run] }]]);
  globalThis.__herdrFiles.set("/home/programs.json", '{"programs":{"kimi":{"run":["override"]}}}');
  assert.deepEqual(await menu.withLocalRuns([agent]), [{ ...agent, run: ["override"] }]);
});

test("flyout centers under the menu, then clamps to the viewport", () => {
  const menu = new Menu();
  const agent = { key: "codex" };
  assert.equal(menu.flyoutAt(agent), "pointer");
  for (const [width, left, right, bottom, x, y] of [
    [1200, 400, 600, 60, 200, 66],
    [900, 100, 200, 80, 8, 86],
    [700, 380, 480, 90, 92, 96],
    [350, 30, 140, 100, 8, 106],
  ]) {
    globalThis.window = { viewport_size: () => ({ width, height: 600 }) };
    menu.rowEdge = { key: agent.key, left, right, bottom };
    assert.deepEqual(menu.flyoutAt(agent), { x, y });
  }
});
