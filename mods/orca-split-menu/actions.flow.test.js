import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: SplitMenu } = await import("./main.js");

test("split rows close the overlay before splitting and swap only for left and up", async () => {
  const calls = [];
  globalThis.__herdrProps = () => ({ overlay: "menu" });
  globalThis.__herdrCloseOverlay = id => calls.push(id);
  globalThis.__herdrRun = (...args) => calls.push(args);
  const menu = new SplitMenu();
  const expected = [
    ["split-right", "right"], ["split-left", "right", "left"],
    ["split-down", "down"], ["split-up", "down", "up"],
    ["split-right-files", "right", null, "orca-files"], ["split-down-files", "down", null, "orca-files"],
    ["split-right-changes", "right", null, "orca-changes"], ["split-down-changes", "down", null, "orca-changes"],
  ];
  assert.deepEqual(menu.items().map(row => row.id), [...expected.map(([id]) => id), "split-folder-right", "split-folder-down"]);
  for (const [index, [, direction, swap, mod]] of expected.entries()) {
    calls.length = 0;
    menu.choose(index, {});
    assert.deepEqual(calls, ["menu", ["pane.split", { direction, pane: undefined, ...(mod ? { mod } : {}) }],
      ...(swap ? [["pane.swap", { direction: swap }]] : [])]);
  }
  for (const i of [8, 9]) {
    calls.length = 0;
    let job;
    menu.choose(i, { spawn: task => { job = task(); } });
    await job;
    assert.deepEqual(calls, ["menu"]);
  }
  menu.at = 99;
  assert.ok(menu.render().__node);
  assert.equal(menu.at, 9);
});
