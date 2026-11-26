// Specification of orca-ui/shared/agent-flyout.js, imported from the source (not a mod copy):
// how saved settings become option values, and how the opencode catalog is grouped.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROMPT, SPECS, defaultValues, parseModels, readValues } from "../orca-ui/shared/agent-flyout.js";

test("defaultValues: checklists start empty, selects and editors at their default, models and effort unset", () => {
  assert.deepEqual(defaultValues(SPECS.codex), { codexOff: [], fast: false });
  assert.deepEqual(defaultValues(SPECS.pi), { off: [], systemPrompt: "", fast: false });
  const claude = defaultValues(SPECS.claude);
  assert.deepEqual(Object.keys(claude), ["fast", "advisorModel", "outputStyle", "agents", "systemPrompt"]);
  assert.equal(claude.advisorModel, "opus");
  assert.equal(claude.outputStyle, "default");
  assert.equal(claude.systemPrompt, DEFAULT_PROMPT);
});

test("readValues: model and effort come from the top of the record, strings only", () => {
  assert.deepEqual(readValues(SPECS.codex, { model: "m", effort: "low" }), { model: "m", effort: "low", codexOff: [], fast: false });
  assert.deepEqual(readValues(SPECS.codex, { model: 5, effort: null }), { codexOff: [], fast: false });
  assert.deepEqual(readValues(SPECS.codex, { preset: { model: "ignored", effort: "ignored" } }), { codexOff: [], fast: false });
  assert.deepEqual(readValues(SPECS.codex), { codexOff: [], fast: false });
});

test("readValues: a checklist keeps known ids in the saved order and drops the rest", () => {
  assert.deepEqual(readValues(SPECS.codex, { preset: { codexOff: ["mcp", "apps", "nope", 7] } }).codexOff, ["mcp", "apps"]);
  assert.deepEqual(readValues(SPECS.codex, { preset: { codexOff: "apps" } }).codexOff, []);
  assert.deepEqual(readValues(SPECS.pi, { preset: { off: ["offline", "session", "x"] } }).off, ["offline", "session"]);
});

test("readValues: a select keeps a listed choice or any string from a hooked list, else its default", () => {
  const advisor = (preset) => readValues(SPECS.claude, { preset }).advisorModel;
  assert.equal(advisor({ advisorModel: "haiku" }), "haiku");
  assert.equal(advisor({ advisorModel: "bogus" }), "opus");
  assert.equal(advisor({ advisorModel: 3 }), "opus");
  assert.equal(advisor({}), "opus");
  assert.equal(advisor({ advisor: false, advisorModel: "haiku" }), "none", "the old off switch wins");
  assert.equal(advisor({ advisor: true, advisorModel: "haiku" }), "haiku");
  const style = (preset) => readValues(SPECS.claude, { preset }).outputStyle;
  assert.equal(style({ outputStyle: "anything" }), "anything");
  assert.equal(style({ outputStyle: 4 }), "default");
  assert.equal(style({}), "default");
});

test("readValues: the old off switch only touches the advisor", () => {
  assert.equal(readValues(SPECS.claude, { preset: { advisor: false } }).outputStyle, "default");
  assert.equal(readValues(SPECS.codex, { preset: { advisor: false } }).advisorModel, undefined);
});

test("readValues: an editor keeps a saved string, even an empty one", () => {
  const values = readValues(SPECS.claude, { preset: { systemPrompt: "", agents: "{}" } });
  assert.equal(values.systemPrompt, "");
  assert.equal(values.agents, "{}");
  const bad = readValues(SPECS.claude, { preset: { systemPrompt: 5, agents: null } });
  assert.equal(bad.systemPrompt, DEFAULT_PROMPT);
  assert.match(bad.agents, /scout/);
});

test("opencodeCatalog: omlx models, free models (every tier costs nothing) and paid models are grouped", () => {
  const model = (extra) => ({ providerID: "opencode", modelID: "m", ...extra });
  const group = (extra) => parseModels("opencodeCatalog", JSON.stringify({ data: [model(extra)] }))[0].group;
  assert.equal(group({ providerID: "omlx" }), "omlx");
  assert.equal(group({ providerID: "omlx", cost: [{ input: 5 }] }), "omlx", "local models are never paid");
  assert.equal(group({ cost: [{ input: 0, output: 0 }, {}] }), "free");
  assert.equal(group({ cost: [{ input: 0, output: 1 }] }), "paid");
  assert.equal(group({ cost: [{ input: 1 }] }), "paid");
  assert.equal(group({ cost: [] }), "paid", "no cost list is not proof of free");
  assert.equal(group({}), "paid");
  const parsed = parseModels("opencodeCatalog", JSON.stringify({ data: [model({ cost: [{}], variants: [{ id: "high" }] }), { providerID: "other", modelID: "x" }] }));
  assert.deepEqual(parsed, [{ id: "opencode/m", label: "m", group: "free", efforts: ["", "high"], fallbackEffort: "high", free: true }]);
});
