// The Close rows as the menu builds them. Loads the real main.js in a vm (the same way
// orca-files' flow test does) so `items()` is the one the window draws, and checks that
// the space row carries `confirmed` — without it the host refuses `space.close` and the
// row does nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { closeRows } from "./close-space.js";
import { closeSideTabs } from "./close-sides.js";

function fixture(spaces) {
  const source = readFileSync(new URL("./main.js", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "").replace("export default class Menu", "class Menu");
  const scope = {
    View: class {}, div: () => ({}), svg: () => ({}), h_flex: () => ({}), v_flex: () => ({}),
    run() {}, props: () => null, closeOverlay() {}, openOverlay() {}, theme: () => ({}),
    keys: () => [], terminals: () => [], spaces: () => spaces, panes: () => [],
    exec: async () => ({ code: 0, stdout: "" }), hc: async () => ({ code: 0 }), home: () => "/home",
    shared: () => null, setShared() {}, copyText() {}, buildBoundedSessionTranscript: () => "",
    closeSideTabs, closeRows,
  };
  vm.runInNewContext(source + "\nglobalThis.items = items;", scope);
  return scope.items;
}

const space = (id, folder = "/repo") => ({ id, folder, name: id, tabs: [{ id: `${id}-tab` }], machine: null });

function closeRow(items, label) {
  return items.find((it) => it[0] === label);
}

test("the card menu closes its space with confirmed", () => {
  const items = fixture([space("w1")]);
  assert.deepEqual(closeRow(items({ tab: "space", target: { id: "w1", linked: false } }, "main"), "Close"),
    ["Close", "space.close", { id: "w1", confirmed: true }]);
});

test("a group with one open space closes it with confirmed", () => {
  const items = fixture([space("w1")]);
  assert.deepEqual(closeRow(items({ tab: "group", target: { id: "w1", path: "/repo", spaces: ["w1"] } }, null), "Close workspace"),
    ["Close workspace", "space.close", { id: "w1", confirmed: true }]);
});

test("a group closes every space its plan names, linked worktrees included", () => {
  // The linked worktree lives outside the project folder, so only `spaces` finds it.
  const items = fixture([space("w1"), space("w2", "/elsewhere/wt")]);
  const row = closeRow(items({ tab: "group", target: { id: "w1", path: "/repo", spaces: ["w1", "w2"] } }, null), "Close workspace");
  assert.equal(row[1], "orca-menu.close-group");
  assert.deepEqual(row[2], { ids: ["w1", "w2"] });
});

test("a group with no open space has no Close row", () => {
  const items = fixture([]);
  assert.equal(closeRow(items({ tab: "group", target: { id: "w1", path: "/repo" } }, null), "Close workspace"), undefined);
});

test("a made-up row id never reaches space.close", () => {
  // The sidebar also lists worktrees no space opens; their ids are `repo:`/`wt:` strings the
  // host does not know. Only the live space is closed (and named by the group).
  const items = fixture([space("w1")]);
  const row = closeRow(items({ tab: "group", target: { id: "w1", path: "/repo", spaces: ['repo:[null,"/repo"]', "w1"] } }, null), "Close workspace");
  assert.deepEqual(row, ["Close workspace", "space.close", { id: "w1", confirmed: true }]);
});

test("a group whose every row is an unopened worktree has no Close row", () => {
  const items = fixture([]);
  assert.equal(closeRow(items({ tab: "group", target: { id: 'repo:[null,"/repo"]', path: "/repo", spaces: ['repo:[null,"/repo"]', "wt:/repo/.git:/repo/wt-x"] } }, null), "Close workspace"), undefined);
});
