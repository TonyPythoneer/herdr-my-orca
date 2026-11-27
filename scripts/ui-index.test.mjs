// Invariants of the generated UI index: the CLI's answers must point at real code.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { audit, buildIndex, findEntity, parseComponents, searchIndex, textMap } from "./ui-index.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const index = await buildIndex(ROOT);

test("every reading-map mod is indexed with its files", () => {
  for (const name of ["orca-agent-settings", "orca-sidebar-projects", "orca-files"]) {
    assert.ok(index.mods[name], `${name} missing`);
    assert.ok(index.mods[name].files.length > 0, `${name} has no files`);
  }
  assert.ok(index.mods.shared, "shared helpers are a mod-like entry");
});

test("a stable id resolves to its real source line and label", () => {
  const hit = findEntity(index, "am-back");
  assert.equal(hit.file, "mods/orca-agent-settings/parts.js");
  assert.equal(hit.label, "Back to terminals");
  const line = readFileSync(`${ROOT}/${hit.file}`, "utf8").split(/\r?\n/)[hit.line - 1];
  assert.match(line, /export function backButton/, "index line is not the declaration");
});

test("an IconButton's tooltip option is indexed", () => {
  const back = index.components.find((item) => item.name === "backButton");
  assert.ok(back.tooltips.includes("Back to terminals"), "tooltip option not indexed");
});

test("audit skips the IconButton helper but still counts other shared controls", () => {
  const report = audit(index);
  assert.ok(report.missingIds.every((item) => item.name !== "IconButton"));
  assert.ok(report.missingLabels.every((item) => item.name !== "IconButton"));
  assert.ok(report.missingIds.some((item) => item.mod === "shared"), "shared controls must still be audited");
});

test("a DialogButton call site names its id and label for the index", () => {
  const hit = findEntity(index, "close-cancel");
  assert.equal(hit.file, "mods/orca-header/close-dialog.js");
  assert.equal(hit.label, "Cancel");
  assert.equal(hit.role, "button");
  // A dynamic label is not borrowed from a sibling button in the same builder.
  assert.equal(findEntity(index, "close-confirm").label, "");
});

test("the shared control names are one list, used by both the reader and the audit", async () => {
  const { SHARED_CONTROLS } = await import("./ui-index.mjs");
  assert.deepEqual(SHARED_CONTROLS, ["IconButton", "DialogButton"]);
});

test("an IconButton call site names its id, label and role for the index", () => {
  const hit = findEntity(index, "proj-new");
  assert.equal(hit.file, "mods/orca-sidebar-top/main.js");
  assert.equal(hit.label, "New workspace");
  assert.equal(hit.role, "button");
  assert.match(readFileSync(`${ROOT}/${hit.file}`, "utf8").split(/\r?\n/)[hit.line - 1], /function newWorkspaceButton/);
});

test("each component points at a declaration with its name", () => {
  for (const item of index.components.filter((entry) => entry.kind !== "data")) {
    const lines = readFileSync(`${ROOT}/${item.file}`, "utf8").split(/\r?\n/);
    const short = item.name.split(".").at(-1);
    assert.ok(lines[item.line - 1]?.includes(short), `${item.file}:${item.line} does not declare ${item.name}`);
  }
});

test("a manifest mod points at its feature source, not the delivered copy", () => {
  const header = index.components.find((item) => item.mod === "orca-right-sidebar-header" && item.kind === "control");
  assert.match(header.file, /^orca-ui\/features\/right-sidebar\/header\//);
  assert.ok(index.mods["orca-right-sidebar-header"].files.every((file) => file.startsWith("orca-ui/features/")));
});

test("layout pages name the mod they mount", () => {
  const agents = index.pages.find((page) => page.node === "main-agents");
  assert.deepEqual({ mod: agents.mod, stack: agents.stack }, { mod: "orca-agent-settings", stack: "main" });
  const terminals = index.pages.find((page) => page.node === "main-terminals");
  assert.deepEqual({ mod: terminals.mod, stack: terminals.stack }, { mod: null, stack: "main" });
});

test("search finds a component by its accessible label", () => {
  const hits = searchIndex(index, "Back to terminals", 5);
  assert.equal(hits[0].name, "backButton");
});

test("a builder's ids, labels and control kind come from its body", () => {
  const source = [
    "// Open the thing.",
    "export function openButton(t, onOpen) {",
    "  return div().id(\"x-open\").role(\"button\").accessibility_label(\"Open\").on_click(onOpen);",
    "}",
    "",
    "export function helper() { return 1; }",
  ].join("\n");
  const found = parseComponents(source, "demo", "mods/demo/view.js");
  const button = found.find((item) => item.name === "openButton");
  assert.equal(button.kind, "control");
  assert.deepEqual(button.ids, ["x-open"]);
  assert.deepEqual(button.labels, ["Open"]);
  assert.equal(button.description, "Open the thing.");
  assert.equal(found.find((item) => item.name === "helper").kind, "logic");
});

test("audit reports a literal id reused by two builders but not a template id", () => {
  const item = (file, line, ids) => ({ kind: "control", mod: "demo", name: file, file, line, ids, labels: [] });
  const report = audit({ components: [item("a.js", 1, ["shared", "row-${i}"]), item("b.js", 2, ["shared", "row-${i}"])] });
  assert.deepEqual(report.duplicateIds.map((entry) => entry.id), ["shared"]);
});

test("visible child text maps to the builder that draws it", () => {
  const map = textMap({ components: [{ ids: ["x-open"], labels: ["Open file"], texts: ["Open"], mod: "demo", name: "openButton", file: "a.js", line: 1 }] });
  assert.equal(map.get("open")[0].name, "openButton");
  assert.equal(map.get("open file")[0].ids[0], "x-open");
});

test("class methods are indexed as components under the class", () => {
  const source = [
    "export default class Page extends View {",
    "  render() { return div().id(\"page\"); }",
    "  row(item) { return v_flex().child(item.name); }",
    "}",
  ].join("\n");
  const found = parseComponents(source, "demo", "mods/demo/main.js");
  assert.deepEqual(found.filter((item) => item.kind !== "class").map((item) => item.name), ["Page.render", "Page.row"]);
  assert.deepEqual(found.find((item) => item.name === "Page.render").ids, ["page"]);
});
