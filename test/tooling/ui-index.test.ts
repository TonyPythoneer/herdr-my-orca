import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  audit,
  buildIndex,
  findEntity,
  parseComponents,
  searchIndex,
  textMap,
  SHARED_CONTROLS,
} from "../../src/tooling/ui-index.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const index = await buildIndex(ROOT);

it("every reading-map mod is indexed with its files", () => {
  for (const name of ["orca-agent-settings", "orca-sidebar-projects", "orca-files"]) {
    assert.ok(index.mods[name], `${name} missing`);
    assert.ok(index.mods[name].files.length > 0, `${name} has no files`);
  }
  assert.ok(index.mods.shared, "shared helpers are a mod-like entry");
});

it("a stable id resolves to its real source line and label", () => {
  const hit = findEntity(index, "am-back");
  assert.equal(hit.file, "src/mods/orca-agent-settings/parts.ts");
  assert.equal(hit.label, "Back to terminals");
  const line = readFileSync(`${ROOT}/${hit.file}`, "utf8").split(/\r?\n/)[hit.line - 1];
  assert.match(line, /export function backButton/, "index line is not the declaration");
});

it("an IconButton's tooltip option is indexed", () => {
  const back = index.components.find((item) => item.name === "backButton");
  assert.ok(back.tooltips.includes("Back to terminals"), "tooltip option not indexed");
});

it("audit skips the IconButton helper but still counts other shared controls", () => {
  const report = audit(index);
  assert.ok(report.missingIds.every((item) => item.name !== "IconButton"));
  assert.ok(report.missingLabels.every((item) => item.name !== "IconButton"));
  assert.ok(
    report.missingIds.some((item) => item.mod === "shared"),
    "shared controls must still be audited",
  );
  assert.ok(
    report.missingIds.every(
      (item) =>
        !item.file.startsWith("src/primitives/icon-button.ts") &&
        !item.file.startsWith("src/primitives/dialog-button.ts"),
    ),
    "helper internals are not screen controls",
  );
});

it("a DialogButton call site names its id and label for the index", () => {
  const hit = findEntity(index, "close-cancel");
  assert.equal(hit.file, "src/mods/orca-header/close-dialog.ts");
  assert.equal(hit.label, "Cancel");
  assert.equal(hit.role, "button");

  assert.equal(findEntity(index, "close-confirm").label, "");
});

it("the shared control names are one list, used by both the reader and the audit", () => {
  assert.deepEqual(SHARED_CONTROLS, ["IconButton", "DialogButton"]);
});

it("the removed new-workspace IconButton is absent from the index", () => {
  assert.equal(findEntity(index, "proj-new"), null);
});

it("each component points at a declaration with its name", () => {
  for (const item of index.components.filter((entry) => entry.kind !== "data")) {
    const lines = readFileSync(`${ROOT}/${item.file}`, "utf8").split(/\r?\n/);
    const short = item.name.split(".").at(-1);
    assert.ok(
      lines[item.line - 1]?.includes(short),
      `${item.file}:${item.line} does not declare ${item.name}`,
    );
  }
});

it("a migrated feature mod points at registered TypeScript sources and tests", () => {
  const header = index.components.find(
    (item) => item.mod === "orca-right-sidebar-header" && item.kind === "control",
  );
  assert.equal(header.file, "src/mods/orca-right-sidebar-header/main.ts");
  assert.deepEqual(index.mods["orca-right-sidebar-header"].files, [
    "src/mods/orca-right-sidebar-header/main.ts",
    "src/mods/orca-right-sidebar-header/panel-gating.ts",
    "src/mods/orca-right-sidebar-header/panel-views.ts",
  ]);
  assert.deepEqual(index.mods["orca-right-sidebar-header"].tests, [
    "test/mods/orca-right-sidebar-header/main.test.ts",
    "test/mods/orca-right-sidebar-header/panel-gating.test.ts",
    "test/mods/orca-right-sidebar-header/panel-views.test.ts",
  ]);
});

it("keeps declared feature paths rooted at their source folder beside Pack sources", async () => {
  const root = mkdtempSync(join(tmpdir(), "ui-index-feature-sources-"));
  const write = (path: string, text: string): void => {
    const file = join(root, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
  };
  try {
    write(
      "orca-ui/app.mjs",
      'export const inPlace = []; export const features = [{ manifest: { mod: "demo", source: "orca-ui/features/demo", files: ["helper.js"], tests: [] } }];',
    );
    write("mods/demo/mod.json", "{}");
    write(
      "orca-ui/features/demo/helper.js",
      'export function featureHelper() { return div().id("feature-helper"); }',
    );
    write(
      "src/mods/demo/main.ts",
      'export function typedMain() { return div().id("typed-main"); }',
    );
    write(
      "src/build-entries.json",
      JSON.stringify({
        entries: [
          { id: "demo-main", source: "src/mods/demo/main.ts", output: "mods/demo/main.js" },
        ],
      }),
    );
    const built = await buildIndex(root);
    assert.equal(findEntity(built, "feature-helper").file, "orca-ui/features/demo/helper.js");
    assert.equal(findEntity(built, "typed-main").file, "src/mods/demo/main.ts");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("layout pages name the mod they mount", () => {
  const agents = index.pages.find((page) => page.node === "main-agents");
  assert.deepEqual(
    { mod: agents.mod, stack: agents.stack },
    { mod: "orca-agent-settings", stack: "main" },
  );
  const terminals = index.pages.find((page) => page.node === "main-terminals");
  assert.deepEqual({ mod: terminals.mod, stack: terminals.stack }, { mod: null, stack: "main" });
});

it("search finds a component by its accessible label", () => {
  const hits = searchIndex(index, "Back to terminals", 5);
  assert.equal(hits[0].name, "backButton");
});

it("a builder's ids, labels and control kind come from its body", () => {
  const source = [
    "export function openButton(t, onOpen) {",
    '  return div().id("x-open").role("button").accessibility_label("Open").on_click(onOpen);',
    "}",
    "",
    "export function helper() { return 1; }",
  ].join("\n");
  const found = parseComponents(source, "demo", "mods/demo/view.js");
  const button = found.find((item) => item.name === "openButton");
  assert.equal(button.kind, "control");
  assert.deepEqual(button.ids, ["x-open"]);
  assert.deepEqual(button.labels, ["Open"]);
  assert.equal(button.description, "");
  assert.equal(found.find((item) => item.name === "helper").kind, "logic");
});

it("audit reports a literal id reused by two builders but not a template id", () => {
  const item = (file, line, ids) => ({
    kind: "control",
    mod: "demo",
    name: file,
    file,
    line,
    ids,
    labels: [],
  });
  const report = audit({
    components: [item("a.js", 1, ["shared", "row-${i}"]), item("b.js", 2, ["shared", "row-${i}"])],
  });
  assert.deepEqual(
    report.duplicateIds.map((entry) => entry.id),
    ["shared"],
  );
});

it("visible child text maps to the builder that draws it", () => {
  const map = textMap({
    components: [
      {
        ids: ["x-open"],
        labels: ["Open file"],
        texts: ["Open"],
        mod: "demo",
        name: "openButton",
        file: "a.js",
        line: 1,
      },
    ],
  });
  assert.equal(map.get("open")[0].name, "openButton");
  assert.equal(map.get("open file")[0].ids[0], "x-open");
});

it("class methods are indexed as components under the class", () => {
  const source = [
    "export default class Page extends View {",
    '  render() { return div().id("page"); }',
    "  row(item) { return v_flex().child(item.name); }",
    "}",
  ].join("\n");
  const found = parseComponents(source, "demo", "mods/demo/main.js");
  assert.deepEqual(
    found.filter((item) => item.kind !== "class").map((item) => item.name),
    ["Page.render", "Page.row"],
  );
  assert.deepEqual(found.find((item) => item.name === "Page.render").ids, ["page"]);
});

it("the canonical TypeScript mod source is indexed instead of its generated copy", () => {
  const source = index.components.find(
    (item) =>
      item.mod === "orca-sidebar-projects" &&
      item.file === "src/mods/orca-sidebar-projects/worktree-plan.ts",
  );
  assert.ok(source);
  assert.equal(
    index.components.some(
      (item) =>
        item.mod === "orca-sidebar-projects" &&
        item.file === "mods/orca-sidebar-projects/worktree-plan.js",
    ),
    false,
  );
});

it("a partially migrated mod keeps its remaining delivered components", () => {
  const hit = findEntity(index, "space-list");
  assert.equal(hit.file, "mods/orca-sidebar-projects/main.js");
  assert.ok(
    index.mods["orca-sidebar-projects"].files.includes("mods/orca-sidebar-projects/main.js"),
  );
});

it("a partially migrated mod excludes exact generated outputs and keeps same-named handwritten files", async () => {
  const root = mkdtempSync(join(tmpdir(), "ui-index-generated-"));
  const write = (path: string, text: string): void => {
    const file = join(root, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
  };
  try {
    write(
      "orca-ui/app.mjs",
      'export const inPlace = [{ mod: "demo" }, { mod: "legacy" }]; export const features = [];',
    );
    write("mods/demo/mod.json", "{}");
    write("mods/legacy/mod.json", "{}");
    write(
      "mods/legacy/shared/main.js",
      'export function generatedLegacyShared() { return div().id("generated-legacy-shared"); }',
    );
    write(
      "mods/demo/main.js",
      'export function handwrittenMain() { return div().id("handwritten-main"); }',
    );
    write(
      "mods/demo/generated/page.js",
      'export function generatedPage() { return div().id("generated-page"); }',
    );
    write(
      "mods/demo/handwritten/page.js",
      'export function handwrittenPage() { return div().id("handwritten-page"); }',
    );
    write(
      "mods/demo/shared/main.js",
      'export function generatedShared() { return div().id("generated-shared"); }',
    );
    write(
      "src/mods/demo/main.ts",
      'export function canonicalMain() { return div().id("canonical-main"); }',
    );
    write(
      "src/mods/demo/nested/page.ts",
      'export function canonicalPage() { return div().id("canonical-page"); }',
    );
    write(
      "src/shared/helper.ts",
      'export function sharedHelper() { return div().id("shared-helper"); }',
    );
    write(
      "src/build-entries.json",
      JSON.stringify({ entries: [{ output: "mods/demo/generated/page.js" }] }),
    );
    write(
      "orca-ui/shared/manifest.json",
      JSON.stringify({
        files: [
          {
            source: "src/shared/helper.ts",
            outputs: ["mods/demo/shared/main.js", "mods/legacy/shared/main.js"],
          },
        ],
      }),
    );

    const built = await buildIndex(root);
    assert.equal(findEntity(built, "handwritten-main").file, "mods/demo/main.js");
    assert.equal(findEntity(built, "handwritten-page").file, "mods/demo/handwritten/page.js");
    assert.equal(findEntity(built, "generated-page"), null);
    assert.equal(findEntity(built, "generated-shared"), null);
    assert.equal(findEntity(built, "generated-legacy-shared"), null);
    assert.equal(findEntity(built, "canonical-page").file, "src/mods/demo/nested/page.ts");
    assert.ok(built.mods.demo.files.includes("mods/demo/main.js"));
    assert.ok(built.mods.demo.files.includes("mods/demo/handwritten/page.js"));
    assert.ok(!built.mods.demo.files.includes("mods/demo/generated/page.js"));
    assert.ok(!built.mods.demo.files.includes("mods/demo/shared/main.js"));
    assert.ok(!built.mods.legacy.files.includes("mods/legacy/shared/main.js"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
