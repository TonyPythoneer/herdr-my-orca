import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vite-plus/test";

const keys = JSON.parse(
  readFileSync(new URL("../../keys.json", import.meta.url), "utf8"),
) as Record<string, Record<string, string>>;
const orca = keys["layout:orca"];

test("orca layout maps indexes the way Orca does", () => {
  for (let i = 1; i <= 9; i++) {
    assert.equal(orca[`cmd-${i}`], `space.select:${i}`, `cmd-${i} must select workspace ${i}`);
    assert.equal(orca[`ctrl-${i}`], `tab.select:${i}`, `ctrl-${i} must select tab ${i}`);
  }
});

test("pane focus uses the Orca chords", () => {
  assert.equal(orca["cmd-]"], "pane.go:right");
  assert.equal(orca["cmd-["], "pane.go:left");
});

test("right-sidebar view shortcuts reveal through the panel bridge", () => {
  assert.equal(orca["cmd-shift-e"], "orca-right-sidebar-header.files");
  assert.equal(orca["cmd-shift-f"], "orca-right-sidebar-header.search");
  assert.equal(orca["cmd-shift-g"], "orca-right-sidebar-header.changes");
  assert.equal(orca["cmd-shift-i"], "orca-right-sidebar-header.ports");
});

test("no chord is bound twice inside one scope", () => {
  for (const [scope, bindings] of Object.entries(keys)) {
    const seen = new Set<string>();
    for (const chord of Object.keys(bindings)) {
      assert.equal(seen.has(chord), false, `${scope}: ${chord} is bound twice`);
      seen.add(chord);
    }
  }
});

test("aligned chords do not take shell or text-editing keys", () => {
  for (const chord of [
    "ctrl-c",
    "ctrl-d",
    "ctrl-w",
    "ctrl-a",
    "ctrl-e",
    "ctrl-u",
    "ctrl-k",
    "ctrl-z",
  ]) {
    assert.equal(orca[chord], undefined, `${chord} must reach the program`);
  }
});
