import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Orca's own defaults (src/shared/keybindings/definitions-core-*.ts at Orca 30d56bd):
// workspace.selectByIndex Mod+1..9, tab.selectByIndex Ctrl+1..9 on macOS.
test("orca layout maps indexes the way Orca does", () => {
  const keys = JSON.parse(readFileSync(new URL("../keys.json", import.meta.url), "utf8"));
  const orca = keys["layout:orca"];
  for (let i = 1; i <= 9; i++) {
    assert.equal(orca[`cmd-${i}`], `space.select:${i}`, `cmd-${i} must select workspace ${i}`);
    assert.equal(orca[`ctrl-${i}`], `tab.select:${i}`, `ctrl-${i} must select tab ${i}`);
  }
});

// definitions-core-4: terminal.focusNextPane / focusPreviousPane are Mod+] and Mod+[.
test("pane focus uses the Orca chords", () => {
  const keys = JSON.parse(readFileSync(new URL("../keys.json", import.meta.url), "utf8"));
  assert.equal(keys["layout:orca"]["cmd-]"], "pane.go:right");
  assert.equal(keys["layout:orca"]["cmd-["], "pane.go:left");
});

// definitions-core-1: sidebar.explorer.toggle Mod+Shift+E, sidebar.search.toggle Mod+Shift+F,
// sidebar.sourceControl.toggle Mod+Shift+G, sidebar.ports.toggle Mod+Shift+I.
test("right-sidebar view shortcuts reveal through the panel bridge", () => {
  const keys = JSON.parse(readFileSync(new URL("../keys.json", import.meta.url), "utf8"));
  const orca = keys["layout:orca"];
  assert.equal(orca["cmd-shift-e"], "orca-panel-head.files");
  assert.equal(orca["cmd-shift-f"], "orca-panel-head.search");
  assert.equal(orca["cmd-shift-g"], "orca-panel-head.changes");
  assert.equal(orca["cmd-shift-i"], "orca-panel-head.ports");
});

test("no chord is bound twice inside one scope", () => {
  const keys = JSON.parse(readFileSync(new URL("../keys.json", import.meta.url), "utf8"));
  for (const [scope, bindings] of Object.entries(keys)) {
    const seen = new Set();
    for (const chord of Object.keys(bindings)) {
      assert.equal(seen.has(chord), false, `${scope}: ${chord} is bound twice`);
      seen.add(chord);
    }
  }
});

// Text editing depends on these staying with the terminal program (AGENTS.md, keys.json).
test("aligned chords do not take shell or text-editing keys", () => {
  const keys = JSON.parse(readFileSync(new URL("../keys.json", import.meta.url), "utf8"));
  for (const chord of ["ctrl-c", "ctrl-d", "ctrl-w", "ctrl-a", "ctrl-e", "ctrl-u", "ctrl-k", "ctrl-z"]) {
    assert.equal(keys["layout:orca"][chord], undefined, `${chord} must reach the program`);
  }
});

test("skillshare is a right-sidebar view", () => {
  const root = JSON.parse(readFileSync(new URL("../layouts/orca.json", import.meta.url), "utf8"));
  const body = root.children.find((node) => node.id === "body");
  const panel = body.children.find((node) => node.id === "panel");
  const stack = panel.children.find((node) => node.id === "panel-body");
  assert.equal(stack.children.find((node) => node.id === "skillshare").content.mod, "skillshare");
});
