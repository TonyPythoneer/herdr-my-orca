// The host stub has no panes() or keys() inventory. Supply them as in close-row.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { closeRows } from "./close-space.js";
import { closeSideTabs } from "./close-sides.js";

function fixture(tab) {
  const events = [];
  const state = { tab, overlay: "popup", target: { id: "a", pane: "p", terminal: "term", linked: true, path: "/repo" } };
  const scope = {
    View: class {}, closeRows, closeSideTabs, props: () => state,
    spaces: () => [{ id: "a", folder: "/repo", tabs: [{ id: "a", named: true }, { id: "b" }] }],
    panes: () => [{ pane: "p", tab: "a", focused: true }], terminals: () => [{ address: "term", agent: true }],
    run: (...args) => events.push(args), closeOverlay: id => events.push(id),
    openOverlay: args => events.push(args),
  };
  const source = readFileSync(new URL("./main.js", import.meta.url), "utf8").replace(/^import .*;$/gm, "").replace("export default class Menu", "class Menu");
  const { menu, rows, icons, breaks } = vm.runInNewContext(source + `
    ;(() => { const rows = items(props(), null); return {
      menu: new Menu(), rows, icons: rows.map(row => menuIcon(row, false)),
      breaks: rows.filter((row, index) => section(props(), rows, index)).map(row => row[0]),
    }; })()`, scope);
  return { menu, rows, icons, breaks, events };
}

test("context rows keep command-specific icons and separators", () => {
  for (const [tab, descriptions] of Object.entries({
    pane: [["Copy", "copy"], ["Paste", "clipboard"], ["Split Terminal Right", "panel-right-close", true], ["Split Terminal Down", "panel-bottom-close"], ["Clear Pane Title", "x"], ["Expand Pane", "maximize-2", true]],
    tab: [["Move Tab to Split Left", "arrow-left"], ["Pin Tab", "pin", true], ["Change Title", "pencil", true]],
    group: [["New worktree", "git-branch-plus"], ["Open worktree", "workflow"], ["Copy Path", "copy", true]],
    space: [["Checkout branch", "git-fork"], ["Remove worktree", "unlink"], ["Mark Unread", "bell", true]],
    global: [["New space", "plus"], ["Keybinds", "terminal", true], ["Theme: graphite", "settings", true]],
  })) {
    const { rows, icons, breaks } = fixture(tab);
    for (const [label, icon, separator] of descriptions) {
      assert.equal(icons[rows.findIndex(row => row[0] === label)], 'mods/orca-context-menu/' + icon + '.svg', label);
      if (separator) assert.ok(breaks.includes(label), label);
    }
  }
});

test("copy focuses its target and bulk deletion confirms before closing the overlay", () => {
  const pane = fixture("pane");
  pane.menu.choose(0, {});
  assert.deepEqual(JSON.parse(JSON.stringify(pane.events)), [["pane.focus", { pane: "p" }], ["terminal.copy", {}], "popup"]);
  const group = fixture("space");
  group.menu.choose(group.rows.findIndex(row => row[0] === "Delete all tabs"), {});
  assert.deepEqual(JSON.parse(JSON.stringify(group.events[0].props.confirmClose)), { kind: "bulk", scope: "all", tabIds: ["a", "b"] });
  assert.equal(group.events[1], "popup");
});

test("left/up context splits swap the original target explicitly", () => {
  for (const [label, direction] of [["Split Terminal Left", "right"], ["Split Terminal Up", "down"]]) {
    const { menu, rows, events } = fixture("pane");
    menu.choose(rows.findIndex(row => row[0] === label), {});
    assert.deepEqual(JSON.parse(JSON.stringify(events)), [["pane.focus", { pane: "p" }], ["pane.split", { direction, pane: "p" }], ["pane.swap", { direction, pane: "p" }], "popup"]);
  }
});
