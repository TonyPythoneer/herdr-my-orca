// The list rule (list-viewport.js) as the flyout draws it: every capped list is as tall as its rows
// up to five, then five and a half rows with a scrollbar. Each kind of list is rendered with five
// rows and with six, and the height is read off the render tree.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: Flyout } = await import("./main.js");
const { SPECS, defaultValues, sectionsOf } = await import("./agent-flyout.js");
const { viewportHeight, scrolls, FULL_ROWS, VISIBLE_ROWS, ROW } = await import("./list-viewport.js");

const t = new Proxy({}, { get: (_t, key) => `#${String(key)}` });
const text = (node) => JSON.stringify(node.__node ?? node);
const hasScroll = (node) => text(node).includes("overflow_y_scroll") && text(node).includes("Scrollbar");
const n = (count) => Array.from({ length: count }, (_v, i) => i);

function flyout(key = "codex", over = {}) {
  globalThis.__herdrProps = () => ({ key, space: "s1" });
  globalThis.__herdrSpaces = () => [];
  const view = Object.create(Flyout.prototype);
  Object.assign(view, {
    key, spec: SPECS[key], values: { ...defaultValues(SPECS[key]), model: "m0", effort: "" }, editors: {}, models: [], hidden: new Set(),
    providerId: "none", providers: {}, open: null, modelGroup: null, groupOpen: false, showHidden: false, styles: ["default"], ...over,
  });
  return view;
}

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
  const rows = (count) => n(count).map((i) => ({ id: `m${i}`, label: `M${i}`, efforts: [], fallbackEffort: "" }));
  const five = flyout("codex", { models: rows(5) });
  assert.equal(hasScroll(five.modelList(t)), false);
  const six = flyout("codex", { models: rows(6) });
  assert.equal(hasScroll(six.modelList(t)), true);
  assert.ok(text(six.modelList(t)).includes('["h",[175]]'));
  // The hidden heading is a row too, so five models and one hidden make six.
  const hidden = flyout("codex", { models: rows(6), hidden: new Set(["m5"]) });
  assert.ok(text(hidden.modelList(t)).includes('["h",[175]]'));
});

test("the effort list", () => {
  const levels = (count) => [{ id: "m0", label: "M", efforts: n(count).map((i) => `e${i}`), fallbackEffort: "e0" }];
  assert.equal(hasScroll(flyout("pi", { models: levels(5) }).effortList(t)), false);
  const six = flyout("pi", { models: levels(6) }).effortList(t);
  assert.equal(hasScroll(six), true);
  assert.ok(text(six).includes('["h",[175]]'));
});

test("a choice list, such as the output styles", () => {
  const view = flyout("claude");
  const names = (count) => n(count).map((i) => `s${i}`);
  assert.equal(hasScroll(view.optionList("outputStyle", names(5), "s0", () => {}, t)), false);
  const six = view.optionList("outputStyle", names(6), "s0", () => {}, t);
  assert.equal(hasScroll(six), true);
  assert.ok(text(six).includes('["h",[175]]'));
});

test("the provider list counts None and Add More as rows", () => {
  const record = (name) => ({ name, host: "http://h/v1", models: ["x"], iconPath: "" });
  const providers = (count) => Object.fromEntries(n(count).map((i) => [`p${i}`, record(`P${i}`)]));
  assert.equal(hasScroll(flyout("codex", { providers: providers(3) }).providerList(t)), false); // None + 3 + Add More = 5
  const six = flyout("codex", { providers: providers(4) }).providerList(t);
  assert.equal(hasScroll(six), true);
  assert.ok(text(six).includes('["h",[175]]'));
});

test("a checklist scrolls when it has more than five items", () => {
  const codex = flyout("codex", { values: { ...defaultValues(SPECS.codex), codexOff: [] } });
  assert.ok(text(codex.checklist("codexOff", t)).includes('["h",[175]]'), "twelve items");
  const pi = flyout("pi", { values: { ...defaultValues(SPECS.pi), off: [] } });
  assert.ok(text(pi.checklist("off", t)).includes('["h",[175]]'), "eight items");
  assert.equal(SPECS.codex.options.codexOff.list, undefined, "the row count is not a spec field any more");
});

test("the OpenCode group list has four entries, so it is as tall as its rows", () => {
  const view = flyout("opencode", { models: [{ id: "m0", label: "M", efforts: [], fallbackEffort: "" }], modelGroup: "free", groupOpen: true });
  assert.equal(hasScroll(view.modelList(t)), false);
  assert.ok(sectionsOf(SPECS.opencode).length > 0);
});

test("a chosen row is marked by its check only: no list gives it a background, so hover is the only highlight", () => {
  const bgs = (node) => (text(node).match(/\["bg",/g) ?? []).length;
  const record = { name: "P", host: "http://h/v1", models: ["x"], iconPath: "" };
  const providers = { p0: record };
  assert.equal(bgs(flyout("codex", { providers, providerId: "none" }).providerList(t)), bgs(flyout("codex", { providers, providerId: "p0" }).providerList(t)));
  const models = [{ id: "m0", label: "M", efforts: ["a", "b"], fallbackEffort: "a" }];
  const chosen = (effort) => flyout("pi", { models, values: { ...defaultValues(SPECS.pi), model: "m0", effort } }).effortList(t);
  assert.equal(bgs(chosen("a")), bgs(chosen("b")));
  const view = flyout("claude");
  const choice = (current) => view.optionList("outputStyle", ["s0", "s1"], current, () => {}, t);
  assert.equal(bgs(choice("s0")), bgs(choice("s1")));
  const rows = (id) => flyout("codex", { models: [{ id: "m0", label: "M", efforts: [], fallbackEffort: "" }, { id: "m1", label: "N", efforts: [], fallbackEffort: "" }], values: { ...defaultValues(SPECS.codex), model: id, effort: "" } }).modelList(t);
  assert.equal(bgs(rows("m0")), bgs(rows("m1")));
});

// Every row of every list has the same height, radius, side padding, gap, text size and hover.
const rowsIn = (node) => {
  const found = [];
  const walk = (x) => {
    if (x && typeof x === "object") {
      if (Array.isArray(x.c) && x.c.some(([op]) => op === "cursor_pointer") && x.c.some(([op]) => op === "hover") && x.c.some(([op]) => op === "h")) found.push(x);
      for (const value of Array.isArray(x) ? x : Object.values(x)) walk(value);
    }
  };
  walk(JSON.parse(text(node)));
  return found;
};
const metric = (row, op) => JSON.stringify(row.c.find(([name]) => name === op)?.[1]);

test("every list row has the same look, whichever list it is in", () => {
  const record = { name: "P", host: "http://h/v1", models: ["x"], iconPath: "" };
  const models = [{ id: "m0", label: "M", efforts: ["a", "b"], fallbackEffort: "a" }, { id: "m1", label: "N", efforts: [], fallbackEffort: "" }];
  const lists = {
    model: flyout("codex", { models }).modelList(t),
    effort: flyout("pi", { models, values: { ...defaultValues(SPECS.pi), model: "m0", effort: "a" } }).effortList(t),
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
