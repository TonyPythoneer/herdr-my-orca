// Flow test: runs the real launch() of the orca-agent-flyout flyout (scripts/gpui-stub-loader.mjs) and
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
const withManagerEnvironment = (argv) => ["env", "HERDR_ENV=1", ...argv];

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
  assert.deepEqual(argvOf(runs), withManagerEnvironment([...CODEX, "-m", "gpt-5.6-sol", "-c", "model_reasoning_effort=high"]));
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
  assert.deepEqual(argvOf(runs), withManagerEnvironment([
    "/bin/sh",
    "-c",
    WRAPPER,
    "--",
    PROVIDERS,
    "omlx",
    "http://127.0.0.1:8000/v1",
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
  ]));
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
  assert.equal(argv[7], "myllm");
  assert.equal(argv[8], other.host);
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

test("the launch remembers the provider model in the provider's own record", async (t) => {
  const file = providersFile({ omlx: record({ selectedModel: {} }) });
  const files = new Map([[PROVIDERS, file]]);
  globalThis.__herdrExec = async (command, args) => {
    if (command === "mktemp") return { code: 0, stdout: `${args.at(-1).replace(/XXXXXX$/, "fixture")}\n` };
    if (command === "python3" && args[0] === "-c") {
      const [, , _lock, target, staged, expectedFile, absent] = args;
      if (absent === "1" ? files.has(target) : files.get(target) !== files.get(expectedFile)) return { code: 1, stdout: "provider file changed" };
      files.set(target, files.get(staged));
    } else if (command === "rm") {
      for (const path of files.keys()) if (path.startsWith(`${args.at(-1)}/`)) files.delete(path);
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  t.after(() => { delete globalThis.__herdrExec; });
  const { view } = flyout({
    providerId: "omlx",
    providers: { omlx: record() },
    model: OMLX_MODEL,
    effort: "",
    files,
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

test("zero providers: the row shows Origin source and still opens, for Add More; on another machine it is greyed out", () => {
  const { view } = flyout({ providers: {} });
  const row = text(view.providerRow(t));
  assert.ok(row.includes("Model source: Codex"));
  assert.ok(row.includes('"Codex"'));
  assert.equal(row.includes('["opacity",[0.5]]'), false);
  assert.ok(row.includes("on_click"));
  const remote = flyout({ providers: {}, machine: "m1" }).view;
  const dim = text(remote.providerRow(t));
  assert.ok(dim.includes('["opacity",[0.5]]'), "the row is dimmed");
  assert.equal(dim.includes("on_click"), false, "a remote space has nothing to choose");
});

test("the provider list ends with Add More, which opens the Model providers page and closes the menu", () => {
  const { view, runs } = flyout({ providers: { omlx: record() } });
  const list = text(view.providerList(t));
  assert.ok(list.includes("Add More") && list.includes("plus--orca-agent-flyout.svg"));
  assert.ok(list.indexOf("oMLX") < list.indexOf("Add More"));
  globalThis.__herdrProps = () => ({ key: "codex", space: "s1", overlay: "o1", menu: "m1" });
  view.openProviders();
  assert.deepEqual(runs.at(-1), ["layout.select", { stack: "main", child: "main-providers" }]);
});

test("a saved provider is selectable, and a model without efforts shows no effort variants", () => {
  const { view } = flyout({ providers: { omlx: record() }, providerId: "omlx", model: OMLX_MODEL, effort: "" });
  assert.ok(text(view.providerRow(t)).includes("oMLX"));
  assert.ok(text(view.providerRow(t)).includes("on_click"));
  // oMLX models have no effort variants, so effort renders as none.
  const args = sectionsOf(SPECS.codex).find((s) => s.title === "HARNESS CLI ARGUMENTS");
  const picker = text(view.sectionBody(args, t));
  assert.ok(picker.includes('"Model"'));
  assert.ok(picker.includes('"Effort"'));
  assert.ok(picker.includes("Fast:"));
});

test("the flyout shows model source on the same layer as model and effort", () => {
  const codex = text(flyout({ providers: {} }).view.render());
  for (const head of ["Model source: Codex", "HARNESS CLI ARGUMENTS", "HARNESS CLI ADVANCED ARGUMENTS"]) assert.ok(codex.includes(head), head);
  // model source sits inside the arguments section, not in its own section above it
  assert.ok(codex.indexOf("HARNESS CLI ARGUMENTS") < codex.indexOf("Model source: Codex"));
  assert.ok(codex.indexOf("Model source: Codex") < codex.indexOf("HARNESS CLI ADVANCED ARGUMENTS"));
  const view = flyout({ providers: {} }).view;
  const input = { value: () => "", set_value() {}, set_soft_wrap() {}, on() {} };
  Object.assign(view, { key: "claude", spec: SPECS.claude, values: { ...defaultValues(SPECS.claude), model: "m", effort: "high" }, styles: ["default"], naming: false, nameError: false, styleInput: input, editors: { agents: { input, dirty: false, error: null }, systemPrompt: { input, dirty: false, error: null } } });
  const claude = text(view.render());
  assert.ok(claude.includes("Model source: Claude"));
  assert.ok(claude.indexOf("HARNESS CLI ARGUMENTS") < claude.indexOf("Model source: Claude"));
  assert.ok(claude.includes("HARNESS CLI ARGUMENTS") && claude.includes("HARNESS CLI ADVANCED ARGUMENTS"));
});

test("settings command preview is the exact existing launch argv and has no launch side effects", async () => {
  const { view, runs } = flyout({providerId:"omlx",providers:{omlx:record()},model:OMLX_MODEL,effort:"",
    files:new Map([[PROVIDERS,providersFile({omlx:record()})]])});
  view.settingsLoaded=true;
  const preview=await view.buildPreview(CODEX);
  assert.ok(preview.argv);
  assert.deepEqual(preview.argv,withManagerEnvironment((await view.buildLaunch({argv:CODEX})).argv));
  assert.ok(!preview.argv.some(part=>part.includes("test-key-value")));
  assert.equal(runs.length,0);
});

test("robot opens the selected local settings page even from a remote workspace", () => {
  const {view,runs}=flyout({machine:"remote"});
  const shared=[], closed=[];
  globalThis.__herdrSetShared=(key,value)=>shared.push([key,value]);
  globalThis.__herdrCloseOverlay=id=>closed.push(id);
  globalThis.__herdrProps=()=>({key:"codex",space:"s1",overlay:"flyout",menu:"menu"});
  view.openAgentSettings();
  assert.deepEqual(shared,[["agent-manager.open-agent",{key:"codex"}],["orca-agent-flyout",null]]);
  assert.deepEqual(runs,[["orca-header.agent-settings",undefined]]);
  assert.deepEqual(closed,["flyout","menu"]);
  delete globalThis.__herdrSetShared;
  delete globalThis.__herdrCloseOverlay;
});

test("stale asynchronous previews cannot replace a newer draft, even after A-B-A", async () => {
  const {view}=flyout();
  const pending=[],tasks=[];
  view.buildPreview=()=>new Promise(resolve=>pending.push(resolve));
  const cx={spawn(fn){tasks.push(fn(cx));},notify(){}};
  view.syncPreview(CODEX,cx);
  view.model="another";
  view.syncPreview(CODEX,cx);
  view.model="gpt-5.6-sol";
  view.syncPreview(CODEX,cx);
  pending[2]({argv:["latest"]});
  await tasks[2];
  pending[0]({argv:["old"]});
  pending[1]({argv:["middle"]});
  await Promise.all(tasks);
  assert.deepEqual(view.previewResult,{argv:["latest"]});
});

test("managed model provider launches use the hidden gateway; native and failed launches never bypass policy", async () => {
  const file = providersFile({ omlx: record() });
  const settings = ["/home/model-gateway.json", '{"enabled":true}'];
  const files = () => new Map([[PROVIDERS, file], settings]);
  let prepares = 0;
  const previousExec = globalThis.__herdrExec;
  globalThis.__herdrExec = async (command, args) => {
    if (command === "python3" && args?.[0]?.endsWith("/litellm_gateway.py")) {
      prepares++;
      assert.deepEqual(args.slice(1), ["/home", "prepare", "omlx", OMLX_MODEL, record().host, "codex"]);
      return { code: 0, stdout: JSON.stringify({ host: "http://127.0.0.1:12345/v1",
        configPath: "/home/litellm-gateway/credentials.json", id: "openai",
        aliases: { [OMLX_MODEL]: "herdr-fixture" }, model: "herdr-fixture" }) };
    }
    return previousExec?.(command, args) ?? { code: 0, stdout: "", stderr: "" };
  };
  try {
    const managed = flyout({ providerId: "omlx", providers: { omlx: record() }, model: OMLX_MODEL, files: files() });
    await managed.view.launch(cx);
    const argv = argvOf(managed.runs);
    assert.ok(argv.includes('model_providers.omlx.base_url="http://127.0.0.1:12345/v1"'));
    assert.ok(argv.includes("herdr-fixture"));
    // The key is read from this file by a shell wrapper, so the path is an argument and the key never is.
    assert.ok(argv.includes("/home/litellm-gateway/credentials.json"));
    assert.equal(managed.view.providerId, "omlx");
    assert.equal(managed.view.model, OMLX_MODEL);
    assert.equal(prepares, 1);

    const native = flyout({ files: files() });
    await native.view.launch(cx);
    assert.deepEqual(argvOf(native.runs), withManagerEnvironment([...CODEX, "-m", "gpt-5.6-sol", "-c", "model_reasoning_effort=high"]));
    assert.equal(prepares, 1);

    globalThis.__herdrExec = async () => ({ code: 1, stdout: '{"error":"Gateway unavailable"}' });
    const failed = flyout({ providerId: "omlx", providers: { omlx: record() }, model: OMLX_MODEL, files: files() });
    await failed.view.launch(cx);
    assert.equal(argvOf(failed.runs), undefined);
    assert.equal(failed.view.error, "Gateway unavailable");
  } finally {
    globalThis.__herdrExec = previousExec;
  }
});
