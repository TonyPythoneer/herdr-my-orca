import { it } from "vite-plus/test";
import assert from "node:assert/strict";

type LaunchGlobals = typeof globalThis & {
  __herdrProps?: () => unknown;
  __herdrSpaces?: () => unknown[];
  __herdrFiles?: Map<string, string>;
  __herdrRun?: (command: string) => void;
};

const host = globalThis as LaunchGlobals;
const { default: Flyout } = await import("../../mods/orca-agent-flyout/main.js");
const { SPECS } = await import("../../mods/orca-agent-flyout/agent-flyout.js");

it("OpenCode waits for its variant before opening the tab", async () => {
  host.__herdrProps = () => ({ key: "opencode", argv: ["opencode"] });
  host.__herdrSpaces = () => [];
  host.__herdrFiles = new Map();
  const runs: string[] = [];
  host.__herdrRun = (command: string) => runs.push(command);
  let finish: () => void = () => {};
  let started: () => void = () => {};
  const variantStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const view = Object.assign(Object.create(Flyout.prototype), {
    key: "opencode",
    providerId: "none",
    spec: SPECS.opencode,
    values: { model: "m", effort: "high" },
    models: [{ id: "m" }],
    editors: {},
    hidden: new Set<string>(),
    launching: false,
    rememberVariant: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
        started();
      }),
    remember() {},
  });
  const launch = view.launch({ notify() {} });
  const reachedVariant = await Promise.race([
    variantStarted.then(() => true),
    launch.then(() => false),
  ]);
  assert.equal(
    reachedVariant,
    true,
    "launch should reach variant persistence before opening the tab",
  );
  assert.equal(runs.includes("tab.new"), false);
  finish();
  await launch;
  assert.equal(runs.includes("tab.new"), true);
});
