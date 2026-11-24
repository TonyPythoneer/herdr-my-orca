import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Keep the recorder's tree, and retain the real button/key callbacks for dispatch.
const loader = new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
  import { load as record } from ${JSON.stringify(loader)};
  export { resolve } from ${JSON.stringify(loader)};
  export async function load(url, ctx, next) {
    const result = await record(url, ctx, next);
    if (!url.startsWith("stub:")) return result;
    return { ...result, source: result.source.replace('return "fn"', 'return globalThis.handlers.push(a) - 1')
      .replace("export const setShared = () => {}", "export const setShared = (...args) => globalThis.publish(...args)") };
  }`));
const { default: Confirm } = await import("./main.js");

test("dialog focuses, confirms in order, cancels, and consumes only Enter and Escape", () => {
  const calls = [];
  globalThis.handlers = [];
  globalThis.publish = (...args) => calls.push(["publish", ...args]);
  globalThis.__herdrProps = () => ({ overlay: "dialog", command: { name: "delete" }, confirmShared: { key: "target", value: "a" } });
  globalThis.__herdrCloseOverlay = id => calls.push(["close", id]);
  globalThis.__herdrRun = (...args) => calls.push(["run", ...args]);
  const view = new Confirm();
  view.init({}, { focus_handle: () => ({ focus: () => calls.push("focus") }) });
  assert.deepEqual(calls.splice(0), ["focus"]);
  const root = view.render({}).__node;
  const keyDown = handlers[root.c.find(([name]) => name === "on_key_down")[1][0]];
  const press = key => keyDown({ key }, { stop_propagation: () => calls.push("stop") });
  press("a"); assert.deepEqual(calls, []);
  press("escape"); assert.deepEqual(calls.splice(0), [["close", "dialog"], "stop"]);
  const confirmed = [["publish", "target", "a"], ["close", "dialog"], ["run", "delete", {}]];
  press("enter"); assert.deepEqual(calls.splice(0), [...confirmed, "stop"]);
  const actions = root.c.filter(([name]) => name === "child").at(-1)[1][0];
  const clicks = actions.c.filter(([name]) => name === "child").map(([, [button]]) =>
    handlers[button.c.find(([name]) => name === "on_click")[1][0]]);
  clicks[0](); assert.deepEqual(calls.splice(0), [["close", "dialog"]]);
  clicks[1](); assert.deepEqual(calls, confirmed);
});
