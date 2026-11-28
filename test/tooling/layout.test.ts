import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

type LayoutNode = {
  id?: string;
  type?: string;
  titlebar?: string;
  traffic_lights?: unknown[];
  terminal_menu?: unknown;
  cloned_from?: { name?: string };
  min?: number;
  background?: string;
  children?: LayoutNode[];
  content?: { mod?: string; props?: Record<string, unknown> };
};

const read = (name: string): LayoutNode =>
  JSON.parse(
    readFileSync(new URL(`../../layouts/${name}.json`, import.meta.url), "utf8"),
  ) as LayoutNode;
const orca = read("orca");

const walk = (node: LayoutNode | undefined, visit: (node: LayoutNode) => void): void => {
  if (!node) return;
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
};
const ids = (layout: LayoutNode): string[] => {
  const found: string[] = [];
  walk(layout, (node) => {
    if (node.id) found.push(node.id);
  });
  return found;
};

it("the layout has the column that carries the window chrome on the root", () => {
  for (const [name, layout] of Object.entries({ orca })) {
    assert.equal(layout.id, "root", name);
    assert.equal(layout.type, "column", name);
    assert.equal(layout.titlebar, "none", name);
    assert.ok(Array.isArray(layout.traffic_lights) && layout.traffic_lights.length === 2, name);
    assert.ok(layout.terminal_menu, `${name}: terminal_menu belongs on the root too`);
  }
});

it("every mod the layout names exists in this repo", () => {
  const missing: string[] = [];
  for (const [name, layout] of Object.entries({ orca })) {
    walk(layout, (node) => {
      if (!node.content?.mod) return;
      if (!existsSync(new URL(`../../mods/${node.content.mod}/main.js`, import.meta.url)))
        missing.push(`${name}: ${node.content.mod}`);
    });
  }
  assert.deepEqual([...new Set(missing)], []);
});

it("orca is the single unified-header layout", () => {
  assert.equal(orca.cloned_from?.name, "main");
  const found = ids(orca);
  assert.ok(!found.includes("brand"), "no brand row");
  assert.ok(found.includes("under"), "the drawer and work body sit in under");

  const sidebars: Array<{ min?: number; background?: string }> = [];
  const tabs: Array<Record<string, unknown>> = [];
  walk(orca, (node) => {
    if (node.id === "left-sidebar") sidebars.push({ min: node.min, background: node.background });
    if (node.content?.mod === "orca-header") tabs.push(node.content.props ?? {});
  });
  assert.ok(
    sidebars.every((s) => s.min === 0 && s.background === "surface"),
    "sidebar collapses to 0 over surface",
  );
  assert.deepEqual(tabs, [{ motion: "native", pinSidebarTerminal: true }]);
});

it("retired Skillshare panel is not mounted or packaged", () => {
  assert.ok(!ids(orca).includes("skillshare"));
  walk(orca, (node) => assert.notEqual(node.content?.mod, "skillshare"));
  assert.ok(!existsSync(new URL("../../mods/skillshare/mod.json", import.meta.url)));
});
