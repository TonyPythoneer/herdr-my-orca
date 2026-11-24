import test from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
registerHooks({ resolve(name, context, next) {
  const result = next(name, context);
  if (name !== "herdr") return result;
  const source = `export * from ${JSON.stringify(result.url)};
    export const keys = () => [{ action: "space.new", keys: "Ctrl + Shift + N" }];`;
  return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
} });
const { default: Landing } = await import("./main.js");

test("renders shortcut caps in binding order, separated by plus signs", () => {
  const tree = new Landing().render().__node;
  const labels = [];
  function visit(node) {
    for (const [method, args] of node.c) {
      if (method !== "child") continue;
      if (typeof args[0] === "string") labels.push(args[0]);
      else visit(args[0]);
    }
  }
  visit(tree);
  assert.deepEqual(labels.slice(labels.lastIndexOf("Create workspace")), [
    "Create workspace", "Ctrl", "+", "Shift", "+", "N", "Move up workspace", "Move down workspace",
  ]);
});
