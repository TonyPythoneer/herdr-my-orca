import { afterEach, test } from "vite-plus/test";
import assert from "node:assert/strict";
import type { Context } from "gpui-kit";
import Config from "../../../src/mods/orca-agent-flyout/main.js";
import { installHost, resetHost } from "./host.js";

afterEach(() => resetHost());

test("a fresh catalog restores the selection without probing, and explicit refresh replaces it", async () => {
  const models = [{ id: "saved", label: "Saved", efforts: ["low", "high"], fallbackEffort: "low" }];
  const files = new Map([
    [
      "/home/agent-config.json",
      JSON.stringify({
        codex: { model: "saved", effort: "high" },
        catalog: { codex: { models, checkedAt: Date.now(), schema: 4 } },
      }),
    ],
  ]);
  const probes: string[] = [];
  installHost({
    files,
    props: () => ({ key: "codex" }),
    exec: (command) => {
      probes.push(command);
      return { code: 0, stdout: "v1" };
    },
  });
  const menu = new Config();
  const jobs: ((context: Context) => unknown)[] = [];
  const cx = {
    notify() {},
    spawn(task: (context: Context) => unknown) {
      jobs.push(task);
    },
  } as Context;
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
