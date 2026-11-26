// Flow tests for the floating panel's controls: each button runs the real handler.
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
      export const agents = () => globalThis.host.agents;
      export const keys = () => globalThis.host.keys;
      export const openOverlay = (spec) => globalThis.host.log.push(["open", spec]);
      export const setShared = (key, value) => globalThis.host.log.push(["setShared", key, value]);`;
    return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
  },
});
const { default: Workspace } = await import("./main.js");

function nodes(root) {
  const children = root.c.flatMap(([method, args]) => {
    if (method === "child") return args;
    if (method === "children") return args[0];
    return [];
  });
  return [root, ...children.filter((child) => child?.c).flatMap(nodes)];
}
const byId = (tree, id) => nodes(tree).find((n) => n.c.some(([key, args]) => key === "id" && args[0] === id));
const click = (node, cx) => node.c.find(([key]) => key === "on_click")[1].at(-1)({}, cx);

function setup(spaces = []) {
  const log = [];
  globalThis.host = { agents: [], keys: [], log };
  globalThis.window = { viewport_size: () => ({ width: 1400, height: 900 }) };
  globalThis.__herdrTheme = () => ({});
  globalThis.__herdrSpaces = () => spaces;
  globalThis.__herdrRun = (...args) => log.push(["run", ...args]);
  const cx = { notify: () => log.push(["notify"]), spawn() {}, timer: { every() {} } };
  const view = new Workspace();
  view.init({}, cx);
  return { view, cx, log };
}

test("every control of an open panel does its one job and hides the panel where it should", () => {
  const { view, cx, log } = setup([{ id: "s1", active: true, folder: "/proj" }]);
  view.open = true;
  const empty = view.render().__node;
  click(byId(empty, "orca-float-new"), cx);
  assert.deepEqual(log.splice(0), [["run", "tab.new", { space: "s1", folder: "/proj" }], ["setShared", "orca-float-workspace.open", false], ["setShared", "orca-float-workspace.attention", false], ["notify"]]);
  view.open = true;
  log.length = 0;
  click(byId(view.render().__node, "orca-float-minimize"), cx);
  assert.equal(view.open, false);
  view.open = true;
  log.length = 0;
  click(byId(view.render().__node, "orca-float-close"), cx);
  assert.equal(view.open, false);
  view.open = true;
  log.length = 0;
  click(byId(view.render().__node, "orca-float-start-agent"), cx);
  assert.deepEqual(log, [["open", { mod: "orca-new-menu", kind: "popup", width: 288 }]]);
  assert.equal(view.open, true, "starting an agent leaves the panel up");
});

test("New Terminal opens a bare tab when no space is active or the space has no folder", () => {
  const none = setup([]);
  none.view.open = true;
  click(byId(none.view.render().__node, "orca-float-new"), none.cx);
  assert.deepEqual(none.log[0], ["run", "tab.new", {}]);
  const bare = setup([{ id: "s2", active: true }]);
  bare.view.open = true;
  click(byId(bare.view.render().__node, "orca-float-new"), bare.cx);
  assert.deepEqual(bare.log[0], ["run", "tab.new", { space: "s2" }]);
});

test("an agent row focuses that agent and a closed panel draws nothing", () => {
  const { view, cx, log } = setup();
  assert.deepEqual(view.render().__node.c, []);
  view.open = true;
  globalThis.host.agents = [{ address: "t1", status: "idle", app: "codex" }];
  click(byId(view.render().__node, "float-agent-t1"), cx);
  assert.deepEqual(log.at(-1), ["run", "agent.focus", { terminal: "t1" }]);
  view.setOpen(true, cx);
  assert.equal(log.filter(([kind]) => kind === "notify").length, 0, "opening an open panel changes nothing");
  view.setOpen(false);
  assert.equal(view.open, false);
});

test("publishing writes only a change in visibility or in what needs attention", () => {
  const { view, log } = setup();
  view.publish();
  assert.deepEqual(log.splice(0), [["setShared", "orca-float-workspace.open", false], ["setShared", "orca-float-workspace.attention", false]]);
  view.publish();
  assert.deepEqual(log, []);
  globalThis.host.agents = [{ address: "a", status: "blocked" }];
  view.publish();
  assert.deepEqual(log, [["setShared", "orca-float-workspace.open", false], ["setShared", "orca-float-workspace.attention", true]]);
});
