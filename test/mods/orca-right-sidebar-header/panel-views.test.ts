import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { viewCommands } from "../../../src/mods/orca-right-sidebar-header/panel-views.ts";

test("revealing each panel view shows the panel and selects its child", () => {
  for (const [view, child] of [
    ["files", "files"],
    ["changes", "changes"],
    ["ports", "ports"],
  ]) {
    assert.deepEqual(viewCommands(view), [
      { name: "layout.show", args: { id: "panel" } },
      { name: "layout.select", args: { stack: "panel-body", child } },
    ]);
  }
});

test("search reveals Explorer and forwards its search command", () => {
  assert.deepEqual(viewCommands("search"), [
    { name: "layout.show", args: { id: "panel" } },
    { name: "layout.select", args: { stack: "panel-body", child: "files" } },
    { name: "orca-files.search" },
  ]);
});

test("unknown views produce no commands", () => {
  assert.equal(viewCommands("agent-sessions"), null);
  assert.equal(viewCommands(""), null);
});
