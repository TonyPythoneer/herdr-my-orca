// Check the visible model controls and settings shortcut across the flyout's supported states.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: Flyout } = await import("./main.js");
const { SPECS, defaultValues } = await import("./agent-flyout.js");

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
  "codex, model list open": () => view("codex", { open: "model", showHidden: true }),
  claude: () => view("claude"),
  "claude, effort list open": () => view("claude", { open: "effort" }),
  pi: () => view("pi", { values: { ...defaultValues(SPECS.pi), model: "m1", effort: "high", off: ["session"] } }),
  "pi, thinking list open": () => view("pi", { open: "effort", values: { ...defaultValues(SPECS.pi), model: "m1", effort: "high" } }),
  opencode: () => view("opencode"),
  "opencode, model list open": () => view("opencode", { open: "model" }),
  "opencode, paid model list open": () => view("opencode", { open: "model", modelGroup: "paid", showHidden: true }),
  "opencode, group list open": () => view("opencode", { open: "model", groupOpen: true }),
};

test("each flyout renders its model controls and settings shortcut", () => {
  for (const [name, make] of Object.entries(CASES)) {
    const tree = make().render();
    const recorded = JSON.parse(JSON.stringify(tree?.__node ?? tree));
    const text = JSON.stringify(recorded);
    let botCount = 0;
    function stripRobot(node) {
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          const call = node[i];
          const child = Array.isArray(call) && call[0] === "child" ? call[1]?.[0] : null;
          const bot = child?.c?.some(method => method[0] === "id" && method[1]?.[0] === "agent-full-settings");
          if (bot) { assert.ok(JSON.stringify(child).includes("mods/orca-assets/bot.svg")); botCount++; node.splice(i, 1); }
          else stripRobot(call);
        }
      } else if (node && typeof node === "object") Object.values(node).forEach(stripRobot);
    }
    stripRobot(recorded);
    assert.equal(botCount, 1, name + " has exactly one robot shortcut");
    assert.ok(text.includes('"Model"'), name + " renders its model control");
    if (name === "codex, provider list open") assert.ok(text.includes("oMLX"), "provider list renders the saved provider");
    if (name === "codex, model list open") {
      assert.ok(text.includes("Model One") && text.includes("Model Two"), name + " renders model choices");
    }
    if (name === "opencode, model list open") {
      assert.ok(text.includes("Model One") && !text.includes("Model Two"), "OpenCode's Free filter excludes Paid models");
    }
    if (name === "opencode, paid model list open") assert.ok(text.includes("Model Two"), "OpenCode's Paid filter renders paid models");
    if (name === "claude, effort list open" || name === "pi, thinking list open") {
      assert.ok(text.includes("low") && text.includes("high"), name + " renders effort choices");
    }
    if (name === "opencode, group list open") assert.ok(text.includes("free") && text.includes("paid"), "OpenCode renders model groups");
  }
});
