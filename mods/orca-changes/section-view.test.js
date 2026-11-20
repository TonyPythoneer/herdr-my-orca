import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function fixture() {
  let active = { active: true, folder: "/repo", machine: "host", id: "space" };
  class Node {
    constructor() { this.nodes = []; }
    child(value) { this.nodes.push(value); return this.proxy; }
    children(values) { this.nodes.push(...values); return this.proxy; }
    when(condition, fn) { return condition ? fn(this.proxy) : this.proxy; }
    id(value) { this.nodeId = value; return this.proxy; }
    role(value) { this.nodeRole = value; return this.proxy; }
    accessibility_label(value) { this.label = value; return this.proxy; }
    tab_index(value) { this.tabIndex = value; return this.proxy; }
    on_click(fn) { this.click = fn; return this.proxy; }
    on_key_down(fn) { this.keydown = fn; return this.proxy; }
    static make() {
      const node = new Node();
      node.proxy = new Proxy(node, { get(target, key) { return key in target ? target[key] : () => node.proxy; } });
      return node.proxy;
    }
  }
  const source = readFileSync(new URL("./main.js", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "").replace("export default class Changes", "class Changes");
  const scope = { View: class {}, div: Node.make, h_flex: Node.make, v_flex: Node.make, svg: Node.make, spaces: () => [active] };
  vm.runInNewContext(source + "\nglobalThis.Changes = Changes;", scope);
  const view = new scope.Changes(), actions = [];
  const handle = { is_focused: () => true };
  Object.assign(view, { root: "/repo", on: "host", context: JSON.stringify({ cwd: "/repo", on: "host", space: "space" }),
    files: [{ section: "changes", path: "unstaged" }, { section: "changes", path: "new", fresh: true }, { section: "staged", path: "staged" }, { section: "conflicts", path: "conflict" }],
    collapsed: {}, sectionViewFocus: { changes: handle, staged: handle }, actionButton: Node.make, fileRow: Node.make,
    openDiff: (...args) => actions.push(args) });
  const find = (node, id) => node?.nodeId === id ? node : node?.nodes?.map((child) => find(child, id)).find(Boolean);
  return { view, actions, find, setActive(value) { active = value; } };
}

test("section View all opens only its own paths with mouse and keyboard", () => {
  const f = fixture(), cx = { notify() {}, stop_propagation() {} };
  const button = f.find(f.view.section("changes", "Changes", {}, cx), "view-all-changes");
  assert.equal(button.nodeRole, "button"); assert.equal(button.label, "View all Changes"); assert.equal(button.tabIndex, 0);
  button.click({}, cx); button.keydown({ key: "enter", modifiers: {} }, cx);
  button.keydown({ key: "enter", modifiers: { platform: true } }, cx);
  assert.equal(f.actions.length, 2);
  assert.deepEqual(Array.from(f.actions[0][0].paths), ["unstaged", "new"]);
  assert.equal(f.actions[0][0].section, "changes"); assert.equal(f.actions[0][1], "/repo"); assert.equal(f.actions[0][2], "host");
  const staged = f.find(f.view.section("staged", "Staged Changes", {}, cx), "view-all-staged");
  staged.keydown({ key: "space", modifiers: {} }, cx);
  assert.deepEqual(Array.from(f.actions[2][0].paths), ["staged"]);
  assert.equal(f.find(f.view.section("conflicts", "Conflicts", {}, cx), "view-all-conflicts"), undefined);
  f.setActive({ active: true, folder: "/other", machine: "host", id: "other" });
  button.click({}, cx);
  assert.equal(f.actions.length, 3); assert.match(f.view.note, /changed/);
});
