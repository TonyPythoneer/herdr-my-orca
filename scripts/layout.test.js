import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const layout = JSON.parse(readFileSync(new URL("../layouts/orca.json", import.meta.url), "utf8"));

// Herdr only honours titlebar, traffic_lights and preview on the root; a wrapper row (seen once in
// live) moves them to a child and the system titlebar comes back above the app's own header.
test("orca layout root is the column that carries the window chrome", () => {
  assert.equal(layout.id, "root");
  assert.equal(layout.type, "column");
  assert.equal(layout.titlebar, "none");
  assert.ok(Array.isArray(layout.traffic_lights) && layout.traffic_lights.length === 2);
  assert.ok(layout.terminal_menu, "terminal_menu belongs on the root too");
});

test("every mod the orca layout names exists in this repo", () => {
  const missing = [];
  const walk = (node) => {
    if (node?.content?.mod && !existsSync(new URL(`../mods/${node.content.mod}/main.js`, import.meta.url))) missing.push(node.content.mod);
    for (const child of node?.children ?? []) walk(child);
  };
  walk(layout);
  assert.deepEqual([...new Set(missing)], []);
});
