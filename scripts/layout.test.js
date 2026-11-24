import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = name => JSON.parse(readFileSync(new URL(`../layouts/${name}.json`, import.meta.url), "utf8"));
const orca = read("orca");

const walk = (node, visit) => {
  visit(node);
  for (const child of node?.children ?? []) walk(child, visit);
};
const ids = layout => {
  const found = [];
  walk(layout, node => node?.id && found.push(node.id));
  return found;
};

// Herdr only honours titlebar, traffic_lights and preview on the root; a wrapper row (seen once in
// live) moves them to a child and the system titlebar comes back above the app's own header.
test("the layout has the column that carries the window chrome on the root", () => {
  for (const [name, layout] of Object.entries({ orca })) {
    assert.equal(layout.id, "root", name);
    assert.equal(layout.type, "column", name);
    assert.equal(layout.titlebar, "none", name);
    assert.ok(Array.isArray(layout.traffic_lights) && layout.traffic_lights.length === 2, name);
    assert.ok(layout.terminal_menu, `${name}: terminal_menu belongs on the root too`);
  }
});

test("every mod the layout names exists in this repo", () => {
  const missing = [];
  for (const [name, layout] of Object.entries({ orca })) {
    walk(layout, node => {
      if (!node?.content?.mod) return;
      if (!existsSync(new URL(`../mods/${node.content.mod}/main.js`, import.meta.url))) missing.push(`${name}: ${node.content.mod}`);
    });
  }
  assert.deepEqual([...new Set(missing)], []);
});

// The one header spans the sidebar and the work column, so the layout has no brand row, wraps the
// drawer and work body in `under`, and lets the sidebar collapse to 0 over the surface colour.
// `cloned_from` only applies to the layout Herdr clones it from.
test("orca is the single unified-header layout", () => {
  assert.equal(orca.cloned_from?.name, "main");
  const found = ids(orca);
  assert.ok(!found.includes("brand"), "no brand row");
  assert.ok(found.includes("under"), "the drawer and work body sit in under");

  const sidebars = [];
  const tabs = [];
  walk(orca, node => {
    if (node?.id === "left-sidebar") sidebars.push({ min: node.min, background: node.background });
    if (node?.content?.mod === "orca-header") tabs.push(node.content.props ?? {});
  });
  assert.ok(sidebars.every(s => s.min === 0 && s.background === "surface"), "sidebar collapses to 0 over surface");
  assert.deepEqual(tabs, [{ motion: "native", pinSidebarTerminal: true }]);
});

test("retired Skillshare panel is not mounted or packaged", () => {
  assert.ok(!ids(orca).includes("skillshare"));
  walk(orca, node => assert.notEqual(node?.content?.mod, "skillshare"));
  assert.ok(!existsSync(new URL("../mods/skillshare/mod.json", import.meta.url)));
});
