import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { resolveTreeKey } from "../../../mods/orca-files/tree-nav.js";

function fixture() {
  const space = { active: true, folder: "/repo", machine: null, id: "space" };
  const source = readFileSync(new URL("../../../mods/orca-files/main.js", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "").replace("export default class Files", "class Files");
  const overlays = [], copied = [];
  const scope = {
    View: class {}, div: () => ({}), h_flex: () => ({}), v_flex: () => ({}), svg: () => ({}),
    spaces: () => [space], window: () => ({ platform: "macos" }), theme: () => ({}),
    exec: async () => null, readTextFile: async () => "", writeTextFile: async () => {},
    watchFolder: async () => {}, settings: () => ({}), props: () => null,
    run() {}, openOverlay: (value) => overlays.push(value), closeOverlay() {},
    shared: () => null, setShared() {}, nextCommand: async () => null, appHome: () => "/tmp",
    copyText: (text) => copied.push(text), reveal() {}, deleteTarget: async () => {},
    mutateFile: async () => {}, queueSave: async () => {}, canEditPath: async () => true,
    writeEditorFile: async () => {}, resolveTreeKey,
  };
  vm.runInNewContext(source + "\nglobalThis.Files = Files;", scope);
  const view = new scope.Files();
  const notify = [];
  const cx = { notify() { notify.push(1); }, stop_propagation() {}, spawn() {} };
  Object.assign(view, {
    view: "files", file: null, prompt: null, root: "/repo", selected: null,
    folders: new Set(["a"]), nfCollapsed: new Set(),
    context: { key: JSON.stringify({ cwd: "/repo", on: null, space: "space" }) },
    treeFocus: { is_focused: () => true },
    treeScroll: { scroll_to_item(index) { view.scrolled = index; } },
    name: { value: () => "", trim: () => "" },
    input: { set_value(value) { view.inputValue = value; }, set_selected_range() {}, focus() {} },
    visible: [
      { path: "a", name: "a", dir: true, depth: 0, open: true },
      { path: "a/x", name: "x", dir: false, depth: 1, open: false },
      { path: "b", name: "b", dir: false, depth: 0, open: false },
    ],
  });
  return { view, cx, overlays, copied, notify };
}

const key = (k, modifiers = {}) => ({ key: k, modifiers });

test("arrow keys move and scroll the selection", () => {
  const f = fixture();
  f.view.treeKey(key("arrowdown"), f.cx);
  assert.equal(f.view.selected, "a");
  assert.equal(f.view.scrolled, 0);
  f.view.treeKey(key("arrowdown"), f.cx);
  assert.equal(f.view.selected, "a/x");
  assert.equal(f.view.scrolled, 1);
  f.view.treeKey(key("arrowup"), f.cx);
  assert.equal(f.view.selected, "a");
  f.view.treeKey(key("end"), f.cx);
  assert.equal(f.view.selected, "b");
});

test("right expands a closed folder through the normal toggle path", () => {
  const f = fixture();
  f.view.selected = "a";
  f.view.folders = new Set();
  f.view.visible[0].open = false;
  let toggled = null;
  f.view.toggle = (path) => { toggled = path; };
  f.view.treeKey(key("arrowright"), f.cx);
  assert.equal(toggled, "a");
});

test("filtered folder navigation uses the visible open state", () => {
  const f = fixture();
  f.view.selected = "a";
  f.view.name = { value: () => "a" };
  f.view.visible[0].open = false;
  let toggled = null;
  f.view.nameToggle = (path) => { toggled = path; };
  f.view.treeKey(key("arrowright"), f.cx);
  assert.equal(toggled, "a");
});

test("Enter starts a rename captured to this workspace", () => {
  const f = fixture();
  f.view.selected = "a/x";
  f.view.treeKey(key("enter"), f.cx);
  assert.equal(f.view.prompt.mode, "mv");
  assert.equal(f.view.prompt.full, "/repo/a/x");
  assert.equal(f.view.prompt.value, "x");
  assert.equal(f.view.inputValue, "x");
});

test("Delete opens a confirmation bound to the captured target", () => {
  const f = fixture();
  f.view.selected = "b";
  f.view.treeKey(key("delete"), f.cx);
  assert.equal(f.overlays.length, 1);
  assert.equal(f.overlays[0].mod, "orca-confirm");
  assert.equal(f.overlays[0].props.confirmShared.value.path, "/repo/b");
  assert.equal(f.overlays[0].props.command.name.startsWith("orca-files.remove-"), true);
});

test("Command Backspace opens the same delete confirmation", () => {
  const f = fixture();
  f.view.selected = "b";
  f.view.treeKey(key("backspace", { platform: true }), f.cx);
  assert.equal(f.overlays[0].props.confirmShared.value.path, "/repo/b");
});

test("copy shortcuts put the full or relative path on the clipboard", () => {
  const f = fixture();
  f.view.selected = "a/x";
  f.view.treeKey(key("c", { platform: true, alt: true }), f.cx);
  f.view.treeKey(key("c", { platform: true, alt: true, shift: true }), f.cx);
  assert.deepEqual(f.copied, ["/repo/a/x", "a/x"]);
});

test("keys do nothing when the tree is not focused or the view is not files", () => {
  const f = fixture();
  f.view.treeFocus = { is_focused: () => false };
  f.view.treeKey(key("arrowdown"), f.cx);
  assert.equal(f.view.selected, null);
  f.view.treeFocus = { is_focused: () => true };
  f.view.view = "search";
  f.view.treeKey(key("arrowdown"), f.cx);
  assert.equal(f.view.selected, null);
});
