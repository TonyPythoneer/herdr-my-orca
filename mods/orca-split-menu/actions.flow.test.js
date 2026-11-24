import test from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
registerHooks({ resolve(name, context, next) {
  const result = next(name, context);
  if (name !== "herdr") return result;
  const source = `export * from ${JSON.stringify(result.url)}; export const panes = () => globalThis.splitPanes; export const pickFolder = async () => globalThis.splitPicked;`;
  return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
} });
const { default: SplitMenu } = await import("./main.js");

test("split rows close the overlay and avoid untargeted left/up swaps", async () => {
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
    assert.deepEqual(calls, swap ? ["menu"] : ["menu", ["pane.split", { direction, pane: undefined, ...(mod ? { mod } : {}) }]]);
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

test("real module handles explicit panes, keyboard navigation, folder selection and close commands", async () => {
  const calls = [];
  globalThis.splitPanes = [{ pane: "a", tab: "t", focused: true }, { pane: "b", tab: "t", zoomed: true }, { pane: "c", tab: "other" }];
  globalThis.__herdrProps = () => ({ overlay: "menu", target: { pane: "b" } });
  globalThis.__herdrCloseOverlay = id => calls.push(id);
  globalThis.__herdrRun = (...args) => calls.push(args);
  globalThis.splitPicked = "/selected";
  const menu = new SplitMenu();
  const tasks = [];
  const cx = { notify() {}, focus_handle: () => ({ focus() {} }), spawn: task => tasks.push(task()) };
  menu.init({}, cx);
  const list = menu.items();
  for (const [key, direction] of [["l", "right"], ["u", "down"]]) {
    calls.length = 0;
    menu.onKey({ key }, cx, list);
    assert.deepEqual(calls, ["menu", ["pane.split", { direction, pane: "b" }], ["pane.swap", { direction, pane: "b" }]]);
  }
  for (const key of ["down", "up", "end", "home", "q"]) menu.onKey({ key }, cx, list);
  assert.equal(menu.at, 0);
  calls.length = 0;
  menu.onKey({ key: "F", modifiers: { shift: true } }, cx, list);
  assert.deepEqual(calls, ["menu", ["pane.split", { direction: "down", pane: "b", mod: "orca-files" }]]);
  calls.length = 0;
  menu.onKey({ key: "o" }, cx, list);
  await Promise.all(tasks);
  assert.deepEqual(calls, ["menu", ["pane.split", { direction: "right", pane: "b", folder: "/selected" }]]);
  calls.length = 0;
  menu.onKey({ key: "z" }, cx, list);
  assert.deepEqual(calls, ["menu", ["pane.zoom", { pane: "b" }]]);
  calls.length = 0;
  menu.onKey({ key: "x" }, cx, list);
  assert.deepEqual(calls, ["menu", ["pane.close", { pane: "a" }]]);
  calls.length = 0;
  menu.onKey({ key: "escape" }, cx, list);
  assert.deepEqual(calls, ["menu"]);
  assert.ok(menu.render().__node);
  globalThis.splitPanes = undefined;
  globalThis.splitPicked = undefined;
});
