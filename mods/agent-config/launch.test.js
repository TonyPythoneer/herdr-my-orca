// Flow test: runs the real launch() of the agent-config flyout (scripts/gpui-stub-loader.mjs) and
// reads the argv it hands to `tab.new`, so the Codex launch is checked without the app.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: Flyout } = await import("./main.js");
const { WRAPPER } = await import("./codex-provider.js");
const { SPECS, defaultValues, sectionsOf } = await import("./agent-flyout.js");

const SETTINGS = "/home/agent-config.json";
const PROVIDERS = "/home/model-providers.json";
// programs.json's command for Codex: today's argv, before and after this feature.
const CODEX = ["codex", "--no-daemon", "-c", "disable_paste_burst=true"];
const MODELS = [{ id: "gpt-5.6-sol", label: "GPT-5.6-Sol", efforts: ["low", "high"], fallbackEffort: "high" }];
const OMLX_MODEL = "mlx-community--LFM2-VL-450M-4bit";

const record = (over = {}) => ({
  name: "oMLX",
  host: "http://127.0.0.1:8000/v1",
  apiKey: "test-key-value",
  githubOwner: "",
  iconPath: "",
  verifiedAt: "2026-11-22T10:00:00.000Z",
  models: [OMLX_MODEL],
  selectedModel: { codex: OMLX_MODEL },
  ...over,
});
const providersFile = (records) => `${JSON.stringify(records, null, 2)}\n`;

function flyout({ providerId = "none", providers = {}, model = "gpt-5.6-sol", effort = "high", files = new Map(), machine = null } = {}) {
  globalThis.__herdrFiles = files;
  globalThis.__herdrProps = () => ({ key: "codex", space: "s1", name: "Codex", argv: [...CODEX] });
  globalThis.__herdrSpaces = () => [{ id: "s1", active: true, machine }];
  const runs = [];
  globalThis.__herdrRun = (command, args) => runs.push([command, args]);
  const view = Object.create(Flyout.prototype);
  Object.assign(view, {
    key: "codex",
    spec: SPECS.codex,
    values: { ...defaultValues(SPECS.codex), model, effort },
    editors: {},
    models: MODELS,
    hidden: new Set(),
    providerId,
    providers,
    open: null,
    cliModel: null,
    launching: false,
    error: "",
    snapshot: null,
  });
  return { view, runs };
}

const argvOf = (runs) => runs.find((call) => call[0] === "tab.new")?.[1]?.argv;
const cx = { notify() {} };

test("None launches Codex with exactly today's argv", async () => {
  const { view, runs } = flyout();
  await view.launch(cx);
  assert.deepEqual(argvOf(runs), [...CODEX, "-m", "gpt-5.6-sol", "-c", "model_reasoning_effort=high"]);
});

test("oMLX launches through the wrapper, without the key in argv and without an effort flag", async () => {
  const { view, runs } = flyout({
    providerId: "omlx",
    providers: { omlx: record() },
    model: OMLX_MODEL,
    effort: "",
    files: new Map([[PROVIDERS, providersFile({ omlx: record() })]]),
  });
  await view.launch(cx);
  assert.deepEqual(argvOf(runs), [
    "/bin/sh",
    "-c",
    WRAPPER,
    "--",
    PROVIDERS,
    "omlx",
    "codex",
    "--disable",
    "shell_snapshot",
    "--no-daemon",
    "-c",
    "disable_paste_burst=true",
    "-m",
    OMLX_MODEL,
    "-c",
    'model_provider="omlx"',
    "-c",
    'model_providers.omlx.name="oMLX"',
    "-c",
    'model_providers.omlx.base_url="http://127.0.0.1:8000/v1"',
    "-c",
    'model_providers.omlx.env_key="OMLX_API_KEY"',
  ]);
  // The key stays in the file: no argument carries it, and only the wrapper mentions where it is.
  const argv = argvOf(runs);
  assert.equal(argv.some((part) => part.includes("test-key-value")), false);
  assert.equal(argv.filter((part) => part !== WRAPPER).some((part) => part.includes("apiKey")), false);
  // The effort flag belongs to OpenAI models only.
  assert.equal(argvOf(runs).some((part) => part.startsWith("model_reasoning_effort")), false);
});

test("a record chosen by its own id gets its own host and its own key", async () => {
  const other = record({ host: "http://127.0.0.1:9000/v1", apiKey: "other-key" });
  const file = providersFile({ omlx: record(), myllm: other });
  const { view, runs } = flyout({
    providerId: "myllm",
    providers: { omlx: record(), myllm: other },
    model: OMLX_MODEL,
    effort: "",
    files: new Map([[PROVIDERS, file]]),
  });
  await view.launch(cx);
  const argv = argvOf(runs);
  // The wrapper reads the key of this record, so oMLX's key never goes to the other host.
  assert.equal(argv[5], "myllm");
  assert.ok(argv.includes('model_providers.omlx.base_url="http://127.0.0.1:9000/v1"'));
  assert.equal(argv.some((part) => part.includes("other-key") || part.includes("test-key-value")), false);
});

test("a provider deleted while the flyout was open blocks the launch", async () => {
  const { view, runs } = flyout({ providerId: "omlx", providers: { omlx: record() }, model: OMLX_MODEL, effort: "" });
  await view.launch(cx);
  assert.equal(runs.length, 0);
  assert.equal(view.providerId, "none");
  assert.equal(view.launching, false);
  assert.equal(view.error, "Model provider is no longer set up.");
});

test("the launch remembers the provider model in the provider's own record", async () => {
  const file = providersFile({ omlx: record({ selectedModel: {} }) });
  const { view } = flyout({
    providerId: "omlx",
    providers: { omlx: record() },
    model: OMLX_MODEL,
    effort: "",
    files: new Map([[PROVIDERS, file]]),
  });
  await view.launch(cx);
  await view.saving;
  await view.savingProvider;
  assert.equal(JSON.parse(globalThis.__herdrFiles.get(PROVIDERS)).omlx.selectedModel.codex, OMLX_MODEL);
  // The Codex model kept for None is untouched, so going back does not pick an oMLX name.
  const saved = JSON.parse(globalThis.__herdrFiles.get(SETTINGS) ?? "{}");
  assert.equal(saved.codex?.model, undefined);
});

// The flyout rows, read through the recorder stubs: what a person sees, without the window.
const t = new Proxy({}, { get: (_t, key) => `#${String(key)}` });
const text = (node) => JSON.stringify(node.__node ?? node);

test("zero providers: the Model provider row is greyed out and shows None", () => {
  const { view } = flyout({ providers: {} });
  const row = text(view.providerRow(t));
  assert.ok(row.includes("MODEL PROVIDER"));
  assert.ok(row.includes('"None"'));
  assert.ok(row.includes('["opacity",[0.5]]'), "the row is dimmed");
  assert.equal(row.includes("on_click"), false, "nothing to choose: the row must not open");
});

test("a saved provider is selectable, and its models hide the EFFORT select", () => {
  const { view } = flyout({ providers: { omlx: record() }, providerId: "omlx", model: OMLX_MODEL, effort: "" });
  assert.ok(text(view.providerRow(t)).includes("oMLX"));
  assert.ok(text(view.providerRow(t)).includes("on_click"));
  // oMLX models have no effort variants, so the picker is MODEL alone.
  const picker = text(view.sectionBody(sectionsOf(SPECS.codex)[1], t));
  assert.ok(picker.includes("MODEL"));
  assert.equal(picker.includes("EFFORT"), false);
});

test("the flyout is split into sections: Codex has a model source, Claude does not", () => {
  const codex = text(flyout({ providers: {} }).view.render());
  for (const head of ["MODEL SOURCE", "HARNESS CLI ARGUMENTS", "HARNESS CLI ADVANCED ARGUMENTS"]) assert.ok(codex.includes(head), head);
  assert.ok(codex.indexOf("MODEL SOURCE") < codex.indexOf("HARNESS CLI ARGUMENTS"));
  assert.ok(codex.indexOf("HARNESS CLI ARGUMENTS") < codex.indexOf("HARNESS CLI ADVANCED ARGUMENTS"));
  const view = flyout({ providers: {} }).view;
  const input = { value: () => "", set_value() {}, set_soft_wrap() {}, on() {} };
  Object.assign(view, { key: "claude", spec: SPECS.claude, values: { ...defaultValues(SPECS.claude), model: "m", effort: "high" }, styles: ["default"], naming: false, nameError: false, styleInput: input, editors: { agents: { input, dirty: false, error: null }, systemPrompt: { input, dirty: false, error: null } } });
  const claude = text(view.render());
  assert.equal(claude.includes("MODEL SOURCE"), false);
  assert.ok(claude.includes("HARNESS CLI ARGUMENTS") && claude.includes("HARNESS CLI ADVANCED ARGUMENTS"));
});
