import { afterEach, test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import type { Context } from "gpui-kit";
import { WRAPPER } from "../../../src/shared/codex-provider.js";
import { SPECS, defaultValues, sectionsOf } from "../../../src/shared/agent-flyout.js";
import {
  cx,
  flyoutView,
  input,
  installHost,
  resetHost,
  textOf,
  THEME,
  type HostOptions,
  type PreviewResult,
} from "./host.js";

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

type Run = [string, unknown];
type Record_ = {
  name: string;
  host: string;
  apiKey: string;
  githubOwner: string;
  iconPath: string;
  verifiedAt: string;
  models: string[];
  selectedModel: Record<string, string>;
};

const SETTINGS = "/home/agent-config.json";
const PROVIDERS = "/home/model-providers.json";
const CODEX = ["codex", "--no-daemon", "-c", "disable_paste_burst=true"];
const MODELS = [
  { id: "gpt-5.6-sol", label: "GPT-5.6-Sol", efforts: ["low", "high"], fallbackEffort: "high" },
];
const OMLX_MODEL = "mlx-community--LFM2-VL-450M-4bit";
const withManagerEnvironment = (argv: string[]) => ["env", "HERDR_ENV=1", ...argv];

const record = (over: Partial<Record_> = {}): Record_ => ({
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
const providersFile = (records: Record<string, Record_>) => `${JSON.stringify(records, null, 2)}\n`;

type FlyoutOptions = Pick<HostOptions, "exec" | "machine" | "props" | "shared" | "closeOverlay"> & {
  providerId?: string;
  providers?: Record<string, Record_>;
  model?: string;
  effort?: string;
  files?: Map<string, string>;
};

function flyout({
  providerId = "none",
  providers = {},
  model = "gpt-5.6-sol",
  effort = "high",
  files = new Map<string, string>(),
  machine = null,
  exec,
  props = () => ({ key: "codex", space: "s1", name: "Codex", argv: [...CODEX] }),
  shared,
  closeOverlay,
}: FlyoutOptions = {}) {
  const host = installHost({ files, machine, exec, props, shared, closeOverlay });
  const view = flyoutView("codex", {
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
  return { view, runs: host.runs, files };
}

function argvOf(runs: Run[]): string[] | undefined {
  const call = runs.find(([command]) => command === "tab.new");
  const payload = call?.[1];
  return typeof payload === "object" && payload !== null && "argv" in payload
    ? (payload.argv as string[])
    : undefined;
}

afterEach(() => resetHost());

test("None launches Codex with exactly today's argv", async () => {
  const { view, runs } = flyout();
  await view.launch(cx);
  assert.deepEqual(
    argvOf(runs),
    withManagerEnvironment([...CODEX, "-m", "gpt-5.6-sol", "-c", "model_reasoning_effort=high"]),
  );
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
  const argv = argvOf(runs);
  assert.deepEqual(
    argv,
    withManagerEnvironment([
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
    ]),
  );
  assert.equal(
    argv?.some((part) => part.includes("test-key-value")),
    false,
  );
  assert.equal(
    argv?.filter((part) => part !== WRAPPER).some((part) => part.includes("apiKey")),
    false,
  );
  assert.equal(
    argv?.some((part) => part.startsWith("model_reasoning_effort")),
    false,
  );
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
  const argv = argvOf(runs) ?? [];
  assert.equal(argv[7], "myllm");
  assert.equal(argv[8], other.host);
  assert.ok(argv.includes('model_providers.omlx.base_url="http://127.0.0.1:9000/v1"'));
  assert.equal(
    argv.some((part) => part.includes("other-key") || part.includes("test-key-value")),
    false,
  );
});

test("a provider deleted while the flyout was open blocks the launch", async () => {
  const { view, runs } = flyout({
    providerId: "omlx",
    providers: { omlx: record() },
    model: OMLX_MODEL,
    effort: "",
  });
  await view.launch(cx);
  assert.equal(runs.length, 0);
  assert.equal(view.providerId, "none");
  assert.equal(view.launching, false);
  assert.equal(view.error, "Model provider is no longer set up.");
});

test("the launch remembers the provider model in the provider's own record", async () => {
  const file = providersFile({ omlx: record({ selectedModel: {} }) });
  const files = new Map([[PROVIDERS, file]]);
  const gateway = async (command: string, args: string[]) => {
    if (command === "mktemp")
      return { code: 0, stdout: `${args.at(-1)?.replace(/XXXXXX$/, "fixture")}\n` };
    if (command === "python3" && args[0] === "-c") {
      const [, , , target, staged, expectedFile, absent] = args;
      if (absent === "1" ? files.has(target) : files.get(target) !== files.get(expectedFile))
        return { code: 1, stdout: "provider file changed" };
      files.set(target, files.get(staged) ?? "");
    } else if (command === "rm") {
      for (const path of files.keys()) if (path.startsWith(`${args.at(-1)}/`)) files.delete(path);
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const { view } = flyout({
    providerId: "omlx",
    providers: { omlx: record() },
    model: OMLX_MODEL,
    effort: "",
    files,
    exec: gateway,
  });
  await view.launch(cx);
  await view.saving;
  await view.savingProvider;
  assert.equal(JSON.parse(files.get(PROVIDERS) ?? "{}").omlx.selectedModel.codex, OMLX_MODEL);
  const saved = JSON.parse(files.get(SETTINGS) ?? "{}");
  assert.equal(saved.codex?.model, undefined);
});

const text = textOf;
const t = THEME;

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
  view.openProviders();
  assert.deepEqual(runs.at(-1), ["layout.select", { stack: "main", child: "main-providers" }]);
});

test("a saved provider is selectable, and a model without efforts shows no effort variants", () => {
  const { view } = flyout({
    providers: { omlx: record() },
    providerId: "omlx",
    model: OMLX_MODEL,
    effort: "",
  });
  assert.ok(text(view.providerRow(t)).includes("oMLX"));
  assert.ok(text(view.providerRow(t)).includes("on_click"));
  const args = sectionsOf(SPECS.codex).find((section) => section.title === "HARNESS CLI ARGUMENTS");
  assert.ok(args);
  const picker = text(view.sectionBody(args, t));
  assert.ok(picker.includes('"Model"'));
  assert.ok(picker.includes('"Effort"'));
  assert.ok(picker.includes("Fast:"));
});

test("the flyout shows model source on the same layer as model and effort", () => {
  const codex = text(flyout({ providers: {} }).view.render());
  for (const head of [
    "Model source: Codex",
    "HARNESS CLI ARGUMENTS",
    "HARNESS CLI ADVANCED ARGUMENTS",
  ])
    assert.ok(codex.includes(head), head);
  assert.ok(codex.indexOf("HARNESS CLI ARGUMENTS") < codex.indexOf("Model source: Codex"));
  assert.ok(codex.indexOf("Model source: Codex") < codex.indexOf("HARNESS CLI ADVANCED ARGUMENTS"));
  const view = flyout({ providers: {} }).view;
  const field = input();
  Object.assign(view, {
    key: "claude",
    spec: SPECS.claude,
    values: { ...defaultValues(SPECS.claude), model: "m", effort: "high" },
    styles: ["default"],
    naming: false,
    nameError: false,
    styleInput: field,
    editors: {
      agents: { input: field, dirty: false, error: null },
      systemPrompt: { input: field, dirty: false, error: null },
    },
  });
  const claude = text(view.render());
  assert.ok(claude.includes("Model source: Claude"));
  assert.ok(claude.indexOf("HARNESS CLI ARGUMENTS") < claude.indexOf("Model source: Claude"));
  assert.ok(
    claude.includes("HARNESS CLI ARGUMENTS") && claude.includes("HARNESS CLI ADVANCED ARGUMENTS"),
  );
});

test("settings command preview is the exact existing launch argv and has no launch side effects", async () => {
  const { view, runs } = flyout({
    providerId: "omlx",
    providers: { omlx: record() },
    model: OMLX_MODEL,
    effort: "",
    files: new Map([[PROVIDERS, providersFile({ omlx: record() })]]),
  });
  view.settingsLoaded = true;
  const preview = await view.buildPreview(CODEX);
  assert.ok("argv" in preview);
  const built = await view.buildLaunch({ argv: CODEX });
  assert.ok("argv" in built);
  assert.deepEqual(preview.argv, withManagerEnvironment(built.argv));
  assert.ok(!preview.argv.some((part) => part.includes("test-key-value")));
  assert.equal(runs.length, 0);
});

test("robot opens the selected local settings page even from a remote workspace", () => {
  const shared: [string, unknown][] = [];
  const closed: (string | undefined)[] = [];
  const { view, runs } = flyout({
    machine: "remote",
    props: () => ({ key: "codex", space: "s1", overlay: "flyout", menu: "menu" }),
    shared: (key, value) => shared.push([key, value]),
    closeOverlay: (id) => closed.push(id),
  });
  view.openAgentSettings();
  assert.deepEqual(shared, [
    ["agent-manager.open-agent", { key: "codex" }],
    ["orca-agent-flyout", null],
  ]);
  assert.deepEqual(runs, [["orca-header.agent-settings", undefined]]);
  assert.deepEqual(closed, ["flyout", "menu"]);
});

test("stale asynchronous previews cannot replace a newer draft, even after A-B-A", async () => {
  const { view } = flyout();
  const pending: ((value: PreviewResult) => void)[] = [];
  const tasks: Promise<unknown>[] = [];
  view.buildPreview = () => new Promise((resolve) => pending.push(resolve));
  const spawner = {
    spawn(job: (context: Context) => unknown) {
      tasks.push(Promise.resolve(job(spawner as Context)));
    },
    notify() {},
  } as Context;
  view.syncPreview(CODEX, spawner);
  view.model = "another";
  view.syncPreview(CODEX, spawner);
  view.model = "gpt-5.6-sol";
  view.syncPreview(CODEX, spawner);
  pending[2]({ argv: ["latest"] });
  await tasks[2];
  pending[0]({ argv: ["old"] });
  pending[1]({ argv: ["middle"] });
  await Promise.all(tasks);
  assert.deepEqual(view.previewResult, { argv: ["latest"] });
});

test("managed model provider launches use the hidden gateway; native and failed launches never bypass policy", async () => {
  const file = providersFile({ omlx: record() });
  const files = () =>
    new Map([
      [PROVIDERS, file],
      ["/home/model-gateway.json", '{"enabled":true}'],
    ]);
  let prepares = 0;
  const gateway = async (command: string, args: string[]) => {
    if (command === "python3" && args[0]?.endsWith("/litellm_gateway.py")) {
      prepares++;
      assert.deepEqual(args.slice(1), [
        "/home",
        "prepare",
        "omlx",
        OMLX_MODEL,
        record().host,
        "codex",
      ]);
      return {
        code: 0,
        stdout: JSON.stringify({
          host: "http://127.0.0.1:12345/v1",
          configPath: "/home/litellm-gateway/credentials.json",
          id: "openai",
          aliases: { [OMLX_MODEL]: "herdr-fixture" },
          model: "herdr-fixture",
        }),
        stderr: "",
      };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const managed = flyout({
    providerId: "omlx",
    providers: { omlx: record() },
    model: OMLX_MODEL,
    files: files(),
    exec: gateway,
  });
  await managed.view.launch(cx);
  const argv = argvOf(managed.runs) ?? [];
  assert.ok(argv.includes('model_providers.omlx.base_url="http://127.0.0.1:12345/v1"'));
  assert.ok(argv.includes("herdr-fixture"));
  assert.ok(argv.includes("/home/litellm-gateway/credentials.json"));
  assert.equal(managed.view.providerId, "omlx");
  assert.equal(managed.view.model, OMLX_MODEL);
  assert.equal(prepares, 1);

  const native = flyout({ files: files(), exec: gateway });
  await native.view.launch(cx);
  assert.deepEqual(
    argvOf(native.runs),
    withManagerEnvironment([...CODEX, "-m", "gpt-5.6-sol", "-c", "model_reasoning_effort=high"]),
  );
  assert.equal(prepares, 1);

  const failed = flyout({
    providerId: "omlx",
    providers: { omlx: record() },
    model: OMLX_MODEL,
    files: files(),
    exec: async () => ({ code: 1, stdout: '{"error":"Gateway unavailable"}', stderr: "" }),
  });
  await failed.view.launch(cx);
  assert.equal(argvOf(failed.runs), undefined);
  assert.equal(failed.view.error, "Gateway unavailable");
});
