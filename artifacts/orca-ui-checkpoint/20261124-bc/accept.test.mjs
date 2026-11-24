// Hidden acceptance test for the B/C checkpoint. Runtime paths only, no source paths, no new names.
// ACCEPT_ROOT is the tree under test; ACCEPT_BASE is the untouched starting tree.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.ACCEPT_ROOT;
const base = process.env.ACCEPT_BASE;
const load = path => import(pathToFileURL(join(root, path)).href);
register(pathToFileURL(join(root, "scripts/gpui-stub-loader.mjs")));

test("the search reveal keeps its first two steps and ends in a different, new orca-files command", async () => {
  const { viewCommands } = await load("mods/orca-panel-head/panel-views.js");
  const baseViews = await import(pathToFileURL(join(base, "mods/orca-panel-head/panel-views.js")).href);
  const search = viewCommands("search");
  assert.equal(search.length, 3);
  assert.deepEqual(search.slice(0, 2), baseViews.viewCommands("search").slice(0, 2));
  assert.match(search[2].name, /^orca-files\.[\w-]+$/);
  assert.notEqual(search[2].name, "orca-files.search");
  for (const view of ["files", "changes", "ports"]) assert.deepEqual(viewCommands(view), baseViews.viewCommands(view));
  assert.equal(viewCommands("nope"), null);
});

async function filesView() {
  const { default: Files } = await load("mods/orca-files/main.js");
  const state = { focus: 0, notify: 0, rerun: 0, query: "needle" };
  const hits = [{ path: "a" }];
  const view = Object.assign(Object.create(Files.prototype), {
    view: "files", hits, q: { focus: () => state.focus++, value: () => state.query }, rerun: () => state.rerun++,
  });
  return { view, state, hits, cx: { notify: () => state.notify++ } };
}

test("the new command focuses Contents and keeps the query and results without searching again", async () => {
  const { viewCommands } = await load("mods/orca-panel-head/panel-views.js");
  const name = viewCommands("search")[2].name.slice("orca-files.".length);
  const f = await filesView();
  f.view.command(name, f.cx);
  assert.equal(f.view.view, "search");
  assert.equal(f.state.focus, 1);
  assert.ok(f.state.notify >= 1);
  assert.equal(f.state.rerun, 0);
  assert.equal(f.view.hits, f.hits);
  assert.equal(f.state.query, "needle");
});

test("the existing search command still switches, focuses, notifies and reruns only a non-empty query", async () => {
  const f = await filesView();
  f.view.command("search", f.cx);
  assert.deepEqual([f.view.view, f.state.focus, f.state.rerun, f.state.notify], ["search", 1, 1, 1]);
  const empty = await filesView();
  empty.state.query = "  ";
  empty.view.command("search", empty.cx);
  assert.deepEqual([empty.view.view, empty.state.focus, empty.state.rerun, empty.state.notify], ["search", 1, 0, 1]);
});

const COPIES = ["orca-files", "orca-changes", "orca-agents", "orca-panel-gap", "skillshare"];
const at = (open, px, props = { unified: true }) => {
  globalThis.__herdrProps = () => props;
  globalThis.__herdrShared = key => (key === "panel.openPx" ? open : undefined);
  globalThis.__herdrLayout = () => ({ children: [{ id: "panel", size: { px } }] });
  globalThis.__herdrTheme = () => ({ surface: "#171717" });
};

for (const mod of COPIES) {
  test(`${mod}: the panel slides 16px*(1-k), keeps the open width and the cover, and passes through when open`, async () => {
    const { panelFrame } = await load(`mods/${mod}/panel-motion.js`);
    const content = { content: 1 };
    at(350, 175);
    const frame = panelFrame(content).__node;
    const [innerFrame, cover] = frame.c.filter(([n]) => n === "child").map(([, a]) => a[0]);
    const calls = innerFrame.c.map(([n, a]) => [n, a[0]]);
    assert.deepEqual(calls.find(([n]) => n === "w"), ["w", 350]);
    assert.deepEqual(calls.find(([n]) => n === "left"), ["left", -167]);
    assert.deepEqual(cover.c.find(([n]) => n === "bg")[1], ["#17171796"]);
    at(400, 100);
    const wide = panelFrame(content).__node.c.filter(([n]) => n === "child")[0][1][0];
    assert.deepEqual(wide.c.find(([n]) => n === "left"), ["left", [-288]]);
    at(350, 350); assert.equal(panelFrame(content), content);
    at(undefined, 200); assert.equal(panelFrame(content), content);
    at(350, 175, { overlay: true }); assert.equal(panelFrame(content), content);
  });
}

test("keys.json and both layouts are byte-identical to the start", () => {
  for (const f of ["keys.json", "layouts/orca.json", "layouts/orca-unified.json"]) {
    assert.ok(readFileSync(join(root, f)).equals(readFileSync(join(base, f))), f);
  }
});
