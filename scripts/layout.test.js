import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = name => JSON.parse(readFileSync(new URL(`../layouts/${name}.json`, import.meta.url), "utf8"));
const orca = read("orca");
const unified = read("orca-unified");

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
test("both layouts have the column that carries the window chrome on the root", () => {
  for (const [name, layout] of Object.entries({ orca, "orca-unified": unified })) {
    assert.equal(layout.id, "root", name);
    assert.equal(layout.type, "column", name);
    assert.equal(layout.titlebar, "none", name);
    assert.ok(Array.isArray(layout.traffic_lights) && layout.traffic_lights.length === 2, name);
    assert.ok(layout.terminal_menu, `${name}: terminal_menu belongs on the root too`);
  }
});

test("every mod either layout names exists in this repo", () => {
  const missing = [];
  for (const [name, layout] of Object.entries({ orca, "orca-unified": unified })) {
    walk(layout, node => {
      if (!node?.content?.mod) return;
      if (!existsSync(new URL(`../mods/${node.content.mod}/main.js`, import.meta.url))) missing.push(`${name}: ${node.content.mod}`);
    });
  }
  assert.deepEqual([...new Set(missing)], []);
});

// Layout differences are the spec the builder has to reproduce, so each one is asserted rather
// than left to a visual diff. `cloned_from` only applies to the layout Herdr clones it from.
test("unified differs from orca in the declared ways", () => {
  assert.equal(orca.cloned_from?.name, "main");
  assert.equal(unified.cloned_from, undefined, "unified is not a clone of a shipped layout");

  const orcaIds = ids(orca), unifiedIds = ids(unified);
  assert.ok(orcaIds.includes("brand"), "orca keeps the branded sidebar header");
  assert.ok(!unifiedIds.includes("brand"), "unified has no brand row");
  assert.ok(!orcaIds.includes("under"), "orca has no under wrapper");
  assert.ok(unifiedIds.includes("under"), "unified wraps the drawer and work body in under");

  const sidebar = layout => {
    const found = [];
    walk(layout, node => {
      if (node?.id !== "left-sidebar") return;
      found.push({ min: node.min, background: node.background });
    });
    return found;
  };
  assert.ok(sidebar(orca).every(s => s.min === 220 && s.background === "chrome"), "orca sidebar: 220px over chrome");
  assert.ok(sidebar(unified).every(s => s.min === 0 && s.background === "surface"), "unified sidebar: collapses to 0 over surface");

  const tabs = layout => {
    const found = [];
    walk(layout, node => {
      if (node?.content?.mod === "orca-tabs") found.push(node.content.props ?? {});
    });
    return found;
  };
  assert.ok(!tabs(orca).some(props => props.unified), "orca tabs are not unified");
  assert.deepEqual(tabs(unified), [{ unified: true, motion: "native", pinSidebarTerminal: true }]);
});

test("retired Skillshare panel is not mounted or packaged", () => {
  for (const layout of [orca, unified]) {
    assert.ok(!ids(layout).includes("skillshare"));
    walk(layout, node => assert.notEqual(node?.content?.mod, "skillshare"));
  }
  assert.ok(!existsSync(new URL("../mods/skillshare/mod.json", import.meta.url)));
});
