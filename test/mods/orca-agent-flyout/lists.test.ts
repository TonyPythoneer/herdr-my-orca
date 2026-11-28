import { afterEach, test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { SPECS, defaultValues, sectionsOf } from "../../../src/shared/agent-flyout.js";
import {
  FULL_ROWS,
  ROW,
  VISIBLE_ROWS,
  scrolls,
  viewportHeight,
} from "../../../src/shared/list-viewport.js";
import { flyoutView, installHost, resetHost, textOf, THEME, type FlyoutKey } from "./host.js";

vi.mock("gpui-kit", async () => {
  const { recordedElement } = await import("../../stubs/gpui-recording.js");
  return {
    View: class {},
    div: () => recordedElement("div"),
    svg: (path: string) => recordedElement("svg", path),
    image: (path: string) => recordedElement("image", path),
  };
});
vi.mock("gpui-base", async (importOriginal) => {
  const actual = await importOriginal<typeof import("gpui-base")>();
  const { recordedElement } = await import("../../stubs/gpui-recording.js");
  return {
    ...actual,
    v_flex: () => recordedElement("v_flex"),
    h_flex: () => recordedElement("h_flex"),
    Scrollbar: { vertical: (...args: unknown[]) => recordedElement("Scrollbar.vertical", ...args) },
    HoverCard: { new: (...args: unknown[]) => recordedElement("HoverCard.new", ...args) },
    Textarea: { new: (...args: unknown[]) => recordedElement("Textarea.new", ...args) },
    Input: { new: (...args: unknown[]) => recordedElement("Input.new", ...args) },
  };
});

type Rec = { n: string; a: unknown[]; c: [string, unknown[]][] };

const t = THEME;
const text = textOf;
const n = (count: number): number[] => Array.from({ length: count }, (_value, i) => i);
const hasScroll = (node: unknown): boolean =>
  text(node).includes("overflow_y_scroll") && text(node).includes("Scrollbar");

function flyout(key: FlyoutKey, over: Record<string, unknown> = {}) {
  installHost({ props: () => ({ key, space: "s1" }) });
  return flyoutView(key, {
    values: { ...defaultValues(SPECS[key]), model: "m0", effort: "" },
    editors: {},
    models: [],
    hidden: new Set(),
    providerId: "none",
    providers: {},
    open: null,
    modelGroup: null,
    groupOpen: false,
    showHidden: false,
    styles: ["default"],
    ...over,
  });
}

afterEach(() => resetHost());

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && "c" in value && Array.isArray(value.c);
}

function rowsIn(node: unknown): Rec[] {
  const found: Rec[] = [];
  const walk = (x: unknown): void => {
    if (typeof x !== "object" || x === null) return;
    if (isRec(x)) {
      const ops = x.c.map(([op]) => op);
      if (ops.includes("cursor_pointer") && ops.includes("hover") && ops.includes("h"))
        found.push(x);
    }
    for (const value of Object.values(x)) walk(value);
  };
  walk(JSON.parse(text(node)));
  return found;
}

const metric = (row: Rec, op: string): string =>
  JSON.stringify(row.c.find(([name]) => name === op)?.[1]);

test("the rule: exact up to five rows, then five rows, five gaps and half a row", () => {
  assert.equal(FULL_ROWS, 5);
  assert.equal(VISIBLE_ROWS, 5.5);
  assert.equal(viewportHeight(0, 30, 2), 0);
  assert.equal(viewportHeight(1, 30, 2), 30);
  assert.equal(viewportHeight(5, 30, 2), 158);
  assert.equal(viewportHeight(6, 30, 2), 175);
  assert.equal(viewportHeight(500, 30, 2), 175);
  assert.equal(viewportHeight(6, 24, 2), 142);
  assert.equal(viewportHeight(6, 28), 154);
  assert.equal(viewportHeight(6, 56), 308);
  assert.equal(scrolls(5), false);
  assert.equal(scrolls(6), true);
});

test("the model list", () => {
  const rows = (count: number) =>
    n(count).map((i) => ({ id: `m${i}`, label: `M${i}`, efforts: [], fallbackEffort: "" }));
  const five = flyout("codex", { models: rows(5) });
  assert.equal(hasScroll(five.modelList(t)), false);
  const six = flyout("codex", { models: rows(6) });
  assert.equal(hasScroll(six.modelList(t)), true);
  assert.ok(text(six.modelList(t)).includes('["h",[175]]'));
  const hidden = flyout("codex", { models: rows(6), hidden: new Set(["m5"]) });
  assert.ok(text(hidden.modelList(t)).includes('["h",[175]]'));
});

test("the effort list", () => {
  const levels = (count: number) => [
    { id: "m0", label: "M", efforts: n(count).map((i) => `e${i}`), fallbackEffort: "e0" },
  ];
  assert.equal(hasScroll(flyout("pi", { models: levels(5) }).effortList(t)), false);
  const six = flyout("pi", { models: levels(6) }).effortList(t);
  assert.equal(hasScroll(six), true);
  assert.ok(text(six).includes('["h",[175]]'));
});

test("a choice list, such as the output styles", () => {
  const view = flyout("claude");
  const names = (count: number) => n(count).map((i) => `s${i}`);
  assert.equal(hasScroll(view.optionList("outputStyle", names(5), "s0", () => {}, t)), false);
  const six = view.optionList("outputStyle", names(6), "s0", () => {}, t);
  assert.equal(hasScroll(six), true);
  assert.ok(text(six).includes('["h",[175]]'));
});

test("the provider list counts None and Add More as rows", () => {
  const record = (name: string) => ({ name, host: "http://h/v1", models: ["x"], iconPath: "" });
  const providers = (count: number) =>
    Object.fromEntries(n(count).map((i) => [`p${i}`, record(`P${i}`)]));
  assert.equal(hasScroll(flyout("codex", { providers: providers(3) }).providerList(t)), false);
  const six = flyout("codex", { providers: providers(4) }).providerList(t);
  assert.equal(hasScroll(six), true);
  assert.ok(text(six).includes('["h",[175]]'));
});

test("a checklist scrolls when it has more than five items", () => {
  const codex = flyout("codex", { values: { ...defaultValues(SPECS.codex), codexOff: [] } });
  assert.ok(text(codex.checklist("codexOff", t)).includes('["h",[175]]'), "twelve items");
  const pi = flyout("pi", { values: { ...defaultValues(SPECS.pi), off: [] } });
  assert.ok(text(pi.checklist("off", t)).includes('["h",[175]]'), "eight items");
  assert.equal(
    "list" in SPECS.codex.options.codexOff,
    false,
    "the row count is not a spec field any more",
  );
});

test("the OpenCode group list has four entries, so it is as tall as its rows", () => {
  const view = flyout("opencode", {
    models: [{ id: "m0", label: "M", efforts: [], fallbackEffort: "" }],
    modelGroup: "free",
    groupOpen: true,
  });
  assert.equal(hasScroll(view.modelList(t)), false);
  assert.ok(sectionsOf(SPECS.opencode).length > 0);
});

test("a chosen row is marked by its check only: no list gives it a background, so hover is the only highlight", () => {
  const bgs = (node: unknown) => (text(node).match(/\["bg",/g) ?? []).length;
  const record = { name: "P", host: "http://h/v1", models: ["x"], iconPath: "" };
  const providers = { p0: record };
  assert.equal(
    bgs(flyout("codex", { providers, providerId: "none" }).providerList(t)),
    bgs(flyout("codex", { providers, providerId: "p0" }).providerList(t)),
  );
  const models = [{ id: "m0", label: "M", efforts: ["a", "b"], fallbackEffort: "a" }];
  const chosen = (effort: string) =>
    flyout("pi", {
      models,
      values: { ...defaultValues(SPECS.pi), model: "m0", effort },
    }).effortList(t);
  assert.equal(bgs(chosen("a")), bgs(chosen("b")));
  const view = flyout("claude");
  const choice = (current: string) =>
    view.optionList("outputStyle", ["s0", "s1"], current, () => {}, t);
  assert.equal(bgs(choice("s0")), bgs(choice("s1")));
  const rows = (id: string) =>
    flyout("codex", {
      models: [
        { id: "m0", label: "M", efforts: [], fallbackEffort: "" },
        { id: "m1", label: "N", efforts: [], fallbackEffort: "" },
      ],
      values: { ...defaultValues(SPECS.codex), model: id, effort: "" },
    }).modelList(t);
  assert.equal(bgs(rows("m0")), bgs(rows("m1")));
});

test("every list row has the same look, whichever list it is in", () => {
  const record = { name: "P", host: "http://h/v1", models: ["x"], iconPath: "" };
  const models = [
    { id: "m0", label: "M", efforts: ["a", "b"], fallbackEffort: "a" },
    { id: "m1", label: "N", efforts: [], fallbackEffort: "" },
  ];
  const lists = {
    model: flyout("codex", { models }).modelList(t),
    effort: flyout("pi", {
      models,
      values: { ...defaultValues(SPECS.pi), model: "m0", effort: "a" },
    }).effortList(t),
    choice: flyout("claude").optionList("outputStyle", ["default", "eli5"], "default", () => {}, t),
    provider: flyout("codex", { providers: { p0: record } }).providerList(t),
    checklist: flyout("codex").checklist("codexOff", t),
    group: flyout("opencode", { models, modelGroup: "free", groupOpen: true }).modelList(t),
  };
  for (const [kind, node] of Object.entries(lists)) {
    const rows = rowsIn(node);
    assert.ok(rows.length >= 2, `${kind} has rows`);
    for (const row of rows) {
      assert.equal(metric(row, "h"), JSON.stringify([ROW.height]), `${kind} height`);
      assert.equal(metric(row, "rounded"), JSON.stringify([ROW.radius]), `${kind} radius`);
      assert.equal(metric(row, "px"), JSON.stringify([ROW.padX]), `${kind} padding`);
      assert.equal(metric(row, "gap"), JSON.stringify([ROW.innerGap]), `${kind} gap`);
      assert.equal(metric(row, "text_size"), JSON.stringify([ROW.text]), `${kind} text size`);
    }
  }
});
