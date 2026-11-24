import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VIEW_REVEALS, viewCommands } from "./panel-views.js";

test("revealing a view shows the panel and selects its stack child", () => {
  assert.deepEqual(viewCommands("files"), [
    { name: "layout.show", args: { id: "panel" } },
    { name: "layout.select", args: { stack: "panel-body", child: "files" } },
  ]);
  assert.deepEqual(viewCommands("changes").at(-1), {
    name: "layout.select",
    args: { stack: "panel-body", child: "changes" },
  });
  assert.deepEqual(viewCommands("ports").at(-1), {
    name: "layout.select",
    args: { stack: "panel-body", child: "ports" },
  });
});

test("search reveals Explorer and asks orca-files to open its Contents view", () => {
  assert.deepEqual(viewCommands("search"), [
    { name: "layout.show", args: { id: "panel" } },
    { name: "layout.select", args: { stack: "panel-body", child: "files" } },
    { name: "orca-files.search" },
  ]);
});

test("unknown views have no commands", () => {
  assert.equal(viewCommands("vault"), null);
  assert.equal(viewCommands(""), null);
});

test("every bridged key in keys.json names a known reveal", () => {
  const keys = JSON.parse(readFileSync(new URL("../../../../keys.json", import.meta.url), "utf8"));
  const bridged = Object.values(keys["layout:orca"])
    .filter((action) => String(action).startsWith("orca-panel-head."))
    .map((action) => String(action).slice("orca-panel-head.".length));
  assert.ok(bridged.length >= 4);
  for (const view of bridged) assert.ok(VIEW_REVEALS[view], `${view} has no reveal`);
});
