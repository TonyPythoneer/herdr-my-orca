// Characterization test: the flyout's render tree per agent, recorded before it moved to a data
// spec and compared with render.snap.json, so a spec-driven render cannot move a pixel.
// Delete render.snap.json to re-record after an intended change.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: Flyout } = await import("./main.js");
const { SPECS, defaultValues } = await import("./agent-flyout.js");

const SNAP = new URL("./render.snap.json", import.meta.url);
const input = (value = "") => ({ value: () => value });
const MODELS = [
  { id: "m1", label: "Model One", efforts: ["low", "high"], fallbackEffort: "high", group: "free", free: true },
  { id: "m2", label: "Model Two", efforts: [], fallbackEffort: "high", group: "paid" },
];

function view(key, state = {}) {
  globalThis.__herdrFiles = new Map();
  globalThis.__herdrProps = () => ({ key, space: "s1", name: key, argv: [key] });
  globalThis.__herdrSpaces = () => [{ id: "s1", active: true, machine: null }];
  const v = Object.create(Flyout.prototype);
  const spec = SPECS[key];
  const editors = Object.fromEntries(Object.entries(spec.options).filter(([, o]) => o.type === "editor").map(([id]) => [id, { input: input(id === "agents" ? "{}" : "hello"), dirty: false, error: null }]));
  const { open = null, ...rest } = state;
  Object.assign(v, {
    key, spec, values: { ...defaultValues(spec), model: "m1", effort: "high", codexOff: key === "codex" ? ["apps"] : [], advisorModel: "opus" }, editors,
    models: MODELS, hidden: new Set(["m2"]), showHidden: false, error: "",
    providerId: "none", providers: { omlx: { name: "oMLX", host: "http://h/v1", models: ["x"], iconPath: "" } }, open,
    styles: ["default", "Explanatory"], naming: false, nameError: false, styleInput: input(),
    modelGroup: spec.options.model.group ?? null, groupOpen: false, ...rest,
  });
  return v;
}

const CASES = {
  codex: () => view("codex"),
  "codex, provider list open": () => view("codex", { open: "provider" }),
  "codex, model list open": () => view("codex", { open: "model" }),
  claude: () => view("claude"),
  "claude, effort list open": () => view("claude", { open: "effort" }),
  pi: () => view("pi", { values: { ...defaultValues(SPECS.pi), model: "m1", effort: "high", off: ["session"] } }),
  "pi, thinking list open": () => view("pi", { open: "effort", values: { ...defaultValues(SPECS.pi), model: "m1", effort: "high" } }),
  opencode: () => view("opencode"),
  "opencode, model list open": () => view("opencode", { open: "model" }),
  "opencode, group list open": () => view("opencode", { open: "model", groupOpen: true }),
};

test("each flyout renders as recorded", () => {
  const got = Object.fromEntries(Object.entries(CASES).map(([name, make]) => {
    const tree = make().render();
    return [name, JSON.parse(JSON.stringify(tree?.__node ?? tree))];
  }));
  if (!existsSync(SNAP)) writeFileSync(SNAP, `${JSON.stringify(got, null, 1)}\n`);
  assert.deepEqual(got, JSON.parse(readFileSync(SNAP, "utf8")));
});
