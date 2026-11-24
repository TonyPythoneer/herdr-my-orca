// Flow tests for the landing page's two buttons.
import test from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
// Keep real handlers on the recorded tree so tests can dispatch clicks.
registerHooks({
  load(url, context, next) {
    const result = next(url, context);
    if (!url.startsWith("stub:gpui-")) return result;
    return { ...result, source: result.source.replace('return "fn";', 'return a;') };
  },
  resolve(name, context, next) {
    const result = next(name, context);
    if (name !== "herdr") return result;
    const source = `export * from ${JSON.stringify(result.url)};
      export const openOverlay = (spec) => globalThis.opened.push(spec);`;
    return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
  },
});
const { default: Landing } = await import("./main.js");

function nodes(root) {
  const children = root.c.flatMap(([method, args]) => {
    if (method === "child") return args;
    if (method === "children") return args[0];
    return [];
  });
  return [root, ...children.filter((child) => child?.c).flatMap(nodes)];
}
const byId = (tree, id) => nodes(tree).find((n) => n.c.some(([key, args]) => key === "id" && args[0] === id));
const click = (node) => node.c.find(([key]) => key === "on_click")[1].at(-1)();

test("Add project opens the space dialog and Create workspace opens the new menu", () => {
  const runs = [];
  globalThis.opened = [];
  globalThis.__herdrRun = (...args) => runs.push(args);
  const tree = new Landing().render().__node;
  click(byId(tree, "landing-add"));
  click(byId(tree, "landing-create"));
  assert.deepEqual(runs, [["space.new", undefined]]);
  assert.deepEqual(globalThis.opened, [{ mod: "orca-new-menu", kind: "popup", width: 288, height: 512 }]);
  delete globalThis.__herdrRun;
  delete globalThis.opened;
});
