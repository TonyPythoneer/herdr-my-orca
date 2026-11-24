import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: Config } = await import("./main.js");

test("a fresh catalog restores the selection without probing, and explicit refresh replaces it", async () => {
  const models = [{ id: "saved", label: "Saved", efforts: ["low", "high"], fallbackEffort: "low" }];
  globalThis.__herdrProps = () => ({ key: "codex" });
  globalThis.__herdrFiles = new Map([["/home/agent-config.json", JSON.stringify({
    codex: { model: "saved", effort: "high" }, catalog: { codex: { models, checkedAt: Date.now(), schema: 3 } },
  })]]);
  const probes = [];
  globalThis.__herdrExec = command => { probes.push(command); return { stdout: "v1" }; };
  const menu = new Config();
  const jobs = [];
  const cx = { notify() {}, spawn: task => jobs.push(task) };
  menu.init({}, cx);
  for (const job of jobs.splice(0)) await job(cx);
  assert.deepEqual([menu.model, menu.effort, probes], ["saved", "high", []]);
  menu.choose(models[0], "invalid");
  assert.equal(menu.effort, "high");
  menu.listModels = async () => [{ ...models[0], id: "next" }];
  menu.refresh(cx);
  for (const job of jobs) await job(cx);
  await menu.saving;
  assert.deepEqual([menu.model, menu.refreshing, probes], ["next", false, ["zsh"]]);
});
