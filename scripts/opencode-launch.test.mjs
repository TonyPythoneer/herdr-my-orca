import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./gpui-stub-loader.mjs", import.meta.url));
const { default: Flyout } = await import("../mods/agent-config/main.js");
const { SPECS } = await import("../shared/agent-flyout.js");

test("OpenCode waits for its variant before opening the tab", async () => {
  globalThis.__herdrProps = () => ({ key: "opencode", argv: ["opencode"] });
  globalThis.__herdrSpaces = () => [];
  globalThis.__herdrFiles = new Map();
  const runs = [];
  globalThis.__herdrRun = (command) => runs.push(command);
  let finish;
  const view = Object.assign(Object.create(Flyout.prototype), {
    key: "opencode", spec: SPECS.opencode, values: { model: "m", effort: "high" },
    models: [{ id: "m" }], editors: {}, hidden: new Set(), launching: false,
    rememberVariant: () => new Promise((resolve) => { finish = resolve; }),
    remember() {},
  });
  const launch = view.launch({ notify() {} });
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs.includes("tab.new"), false);
  finish();
  await launch;
  assert.equal(runs.includes("tab.new"), true);
});
