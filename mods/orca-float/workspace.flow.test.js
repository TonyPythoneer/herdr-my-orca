import test from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
// The stock recorder leaves the live agent list and command stream empty.
registerHooks({ resolve(name, context, next) {
  const result = next(name, context);
  if (name !== "herdr") return result;
  const source = `export * from ${JSON.stringify(result.url)};
    export const agents = () => globalThis.agentList;
    export const nextCommand = () => globalThis.readCommand();
    export const setShared = (...args) => globalThis.writes.push(args);`;
  return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
} });
const { default: Workspace } = await import("./main.js");

test("toggle publishes immediately and polling only repaints a changed agent list", async () => {
  const workspace = new Workspace();
  let task, tick, notices = 0;
  globalThis.agentList = [];
  globalThis.writes = [];
  const end = new Error("end of command stream");
  const commands = ["unknown", "toggle"];
  globalThis.readCommand = () => { if (commands.length) return commands.shift(); throw end; };
  workspace.init({}, { spawn(fn) { task = fn; }, timer: { every(ms, fn) { assert.equal(ms, 1000); tick = fn; } } });
  const cx = { notify() { notices++; } };
  await assert.rejects(task(cx), error => error === end);
  assert.equal(workspace.open, true);
  assert.equal(notices, 3);
  tick(cx);
  globalThis.agentList = [{ address: "a", status: "blocked" }];
  tick(cx);
  tick(cx);
  assert.equal(notices, 4);
  assert.deepEqual(globalThis.writes, [
    ["orca-float.open", true], ["orca-float.attention", false],
    ["orca-float.open", true], ["orca-float.attention", true],
  ]);
});
