import { afterEach, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { div, type Context, type Element, type ViewClass } from "gpui-kit";
import type { spaces } from "herdr";
import { createAgentConfigClass } from "../../src/shared/agent-config-view.js";
import { SPECS } from "../../src/shared/agent-flyout.js";
import {
  clearAgentConfigRuntime,
  setAgentConfigRuntime,
  type AgentConfigContext,
  type AgentConfigRuntime,
  type AgentConfigWorld,
} from "../support/agent-config-runtime.js";
import { AGENT_CONFIG_WORLDS } from "../support/agent-config-worlds.js";

type TestGlobal = typeof globalThis & {
  __herdrChecking?: () => boolean;
  __herdrProps?: () => unknown;
  __herdrReadTextFile?: (path: string) => Promise<string | null>;
  __herdrWriteTextFile?: (path: string, text: string, expected?: string | null) => Promise<null>;
  __herdrExec?: (command: string, args?: string[]) => Promise<{ code: number; stdout?: string }>;
  __herdrTheme?: () => Record<string, string>;
  __herdrSpaces?: () => unknown[];
};

const host: TestGlobal = globalThis;
const asContext = (cx: unknown): Context => cx as Context;
const asViewClass = (value: unknown): ViewClass => value as ViewClass;

type Handler = (...args: unknown[]) => unknown;
type HandlerMap = Record<string, Handler | undefined>;
const isHandlerMap = (value: unknown): value is HandlerMap =>
  typeof value === "object" &&
  value !== null &&
  Object.values(value).every((item) => item === undefined || typeof item === "function");
const handlersOf = (state: object): HandlerMap => {
  const fns: unknown = Reflect.get(state, "fns");
  if (!isHandlerMap(fns)) throw new TypeError("state has no handler map");
  return fns;
};
const setMockValue = (state: object, value: string): void => {
  Object.assign(state, { __v: value });
};

const nodeOf = (element: Element): unknown => Reflect.get(element, "__node");
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const errorName = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : String(error);

type ThemeFixture = Parameters<AgentConfigMenu["modelList"]>[0];
const themeFixture = (): ThemeFixture =>
  new Proxy({ accent: "#808080", surface: "#808080", hover: "#808080" } as const, {
    get: (_target, key) => `#${String(key)}`,
  });

type LaunchSpace = ReturnType<typeof spaces>[number];
const spaceFixture = (id: string, machine: string | null): LaunchSpace => ({
  id,
  index: 0,
  name: id,
  named: false,
  folder: "/repo",
  machine,
  branch: null,
  active: true,
  status: null,
  tabs: [],
});

const context = asContext({ notify() {} });

function subjectFor(key = "claude") {
  host.__herdrChecking = () => true;
  host.__herdrProps = () => ({ key });
  host.__herdrTheme = () =>
    Object.fromEntries(
      [
        "accent",
        "surface",
        "hover",
        "foreground",
        "muted",
        "raised",
        "ring",
        "input",
        "border",
        "popover",
        "dim",
        "working",
        "done",
        "blocked",
        "accent_foreground",
        "background",
      ].map((name) => [name, "#808080"]),
    );
  const Config = createAgentConfigClass();
  const subject = new Config();
  subject.init(undefined, context);
  return subject;
}

afterEach(() => {
  clearAgentConfigRuntime();
  delete host.__herdrChecking;
  delete host.__herdrProps;
  delete host.__herdrReadTextFile;
  delete host.__herdrWriteTextFile;
  delete host.__herdrExec;
  delete host.__herdrTheme;
  delete host.__herdrSpaces;
});

it("installs core methods while preserving both Herdr view and standalone base prototypes", () => {
  class ViewBase {
    render(_cx: Context): Element {
      return div();
    }
  }

  const ViewConfig = createAgentConfigClass(ViewBase);
  const view = new ViewConfig();
  const standalone = subjectFor();

  assert.ok(view instanceof ViewBase);
  assert.equal(typeof view.loadSaved, "function");
  assert.equal(
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(view), "render")?.value instanceof
      Function,
    true,
  );
  assert.equal(standalone.key, "claude");
  assert.ok(standalone.render());
});

it("rejects malformed persisted settings without throwing out of the view loader", async () => {
  host.__herdrReadTextFile = async (path) => (path.endsWith("agent-config.json") ? "{" : null);
  const subject = subjectFor();

  await subject.loadSaved(context);

  assert.match(subject.error, /Could not list models/);
  assert.equal(subject.models, null);
});

it("blocks a launch preview when an editor contains malformed JSON and records its line", () => {
  const subject = subjectFor();
  subject.editors.agents.input.set_value('{"broken": }');

  assert.equal(subject.readEditors({ ...subject.values }), true);
  assert.equal(subject.editors.agents.error?.line, 1);
  assert.equal(subject.editors.agents.dirty, true);
});

it("rejects a concurrent settings write when this agent changed on disk", async () => {
  const subject = subjectFor();
  subject.settingsContext = { key: "claude" };
  subject.snapshot = JSON.stringify({ claude: { model: "old-model" } });
  host.__herdrReadTextFile = async () => JSON.stringify({ claude: { model: "new-model" } });

  await assert.rejects(subject.settingsWriteBase(), /changed on disk/);
});

it("clears a selected provider when its persisted provider file is malformed", async () => {
  const subject = subjectFor();
  subject.providerId = "missing-provider";
  host.__herdrReadTextFile = async () => "{";

  assert.deepEqual(await subject.loadProviders(), {});
  assert.equal(subject.providerId, "none");
});

it("omits effort when switching to a model that has no supported effort values", async () => {
  const subject = subjectFor("codex");
  subject.models = [
    { id: "supported", label: "Supported", efforts: ["high"], fallbackEffort: "high" },
    { id: "plain", label: "Plain", efforts: [] },
  ];
  subject.values = { ...subject.values, model: "supported", effort: "high" };
  subject.snapshot = JSON.stringify({ codex: { model: "supported", effort: "high" } });
  const writes: string[] = [];
  host.__herdrWriteTextFile = async (_path, text) => {
    writes.push(text);
    return null;
  };

  subject.choose(subject.models[1]);
  subject.remember();
  await subject.saving;

  assert.equal(subject.effort, undefined);
  assert.equal(JSON.parse(writes[0]).codex.effort, undefined);
});

it("returns a clear gateway error when the route command returns invalid data", async () => {
  const subject = subjectFor();
  host.__herdrExec = async () => ({ code: 0, stdout: "not-json" });

  assert.deepEqual(
    await subject.prepareGatewayRoute("local", "model-a", { host: "http://localhost:8000" }),
    {
      error: "LiteLLM is unavailable or the selected model is not configured.",
    },
  );
});

it("keeps settings launches blocked without a local space and names a disabled agent", async () => {
  const subject = subjectFor();
  subject.models = [{ id: "m", label: "M", efforts: [], fallbackEffort: "" }];
  subject.values.model = "m";
  subject.settingsContext = { key: "claude" };
  host.__herdrSpaces = () => [];
  await subject.launch(context);
  assert.equal(subject.launching, false);
  assert.equal(subject.error, "");

  subject.settingsContext = undefined;
  host.__herdrSpaces = () => [spaceFixture("local", null)];
  host.__herdrReadTextFile = async (path) =>
    path.endsWith("agent-manager.json") ? JSON.stringify({ disabled: ["claude"] }) : null;
  await subject.launch(context);
  assert.equal(subject.error, "claude is disabled in Agent Settings.");
  assert.equal(subject.launching, false);
});

it("starts every agent's values with effort null, even when its spec has no effort option", () => {
  for (const key of Object.keys(SPECS)) {
    const subject = subjectFor(key);
    assert.equal("effort" in subject.values, true, key);
    assert.equal(subject.values.effort, null, key);
  }
});

it("opens the Claude spec when the view names no agent key", () => {
  host.__herdrChecking = () => true;
  host.__herdrProps = () => ({});
  const Config = createAgentConfigClass();
  const subject = new Config();
  subject.init(undefined, context);
  assert.equal(subject.key, "claude");
});

it("creates a style for a spec without a style option under the legacy undefined key", async () => {
  const harness = await openedWorld(
    AGENT_CONFIG_WORLDS["codex, fresh cache, providers, saved choices"],
  );
  setMockValue(harness.menu.styleInput, "fresh");
  harness.menu.createStyle(asContext(harness.cx));
  await settle(harness);
  assert.equal(harness.menu.values["undefined"], "fresh");
});

it("closes the flyout overlay and menu after the terminal opens, passing missing ids through", async () => {
  const subject = subjectFor();
  const log: unknown[][] = [];
  setAgentConfigRuntime({ key: "claude", argv: [] }, log);
  await subject.startTerminal({}, undefined, ["claude"], context);
  const order = log
    .map(([kind]) => kind)
    .filter((kind) => kind === "run" || kind === "setShared" || kind === "closeOverlay");
  assert.deepEqual(order, ["run", "setShared", "closeOverlay", "closeOverlay"]);
  assert.deepEqual(
    log.filter(([kind]) => kind === "closeOverlay"),
    [
      ["closeOverlay", undefined],
      ["closeOverlay", undefined],
    ],
  );
});

it("passes theme colors through unchanged instead of substituting a fallback", () => {
  const subject = subjectFor();
  const previous = host.__herdrTheme;
  host.__herdrTheme = () => ({ ...previous?.(), popover: "theme-popover-token" });
  setAgentConfigRuntime({ key: "claude", argv: [] });
  assert.match(JSON.stringify(plain(nodeOf(subject.render()))), /theme-popover-token/);
});

it("throws when all items are requested for an option that has no item list", () => {
  const subject = subjectFor();
  assert.throws(() => subject.setAllItems("model", true, context), TypeError);
});

type AgentConfigMenu = InstanceType<ReturnType<typeof createAgentConfigClass>>;
type AgentConfigHarness = {
  menu: AgentConfigMenu;
  cx: AgentConfigContext;
  runtime: AgentConfigRuntime;
};
const stamp = (text: string): string => text.replace(/"(checkedAt|at)": \d{10,}/g, '"$1": "<now>"');
const plain = (value: unknown): unknown =>
  value === undefined
    ? null
    : JSON.parse(
        JSON.stringify(value, (key, item) =>
          typeof item === "function"
            ? "fn"
            : (key === "checkedAt" || key === "at") && typeof item === "number" && item > 1e12
              ? "<now>"
              : item,
        ),
      );

function startWorld(
  world: AgentConfigWorld,
  log: unknown[][] = [],
  settingsPage = false,
): AgentConfigHarness {
  const runtime = setAgentConfigRuntime(world, log);
  const cx: AgentConfigContext = {
    notify: () => log.push(["notify"]),
    spawn: (job) => runtime.jobs.push(job),
    timer: { after: (ms, callback) => runtime.timers.push([ms, callback]) },
    stop_propagation: () => log.push(["stop"]),
  };
  class ViewBase {}
  const menu =
    settingsPage || world.managerCopy
      ? new (createAgentConfigClass())()
      : new (createAgentConfigClass(asViewClass(ViewBase)))();
  if (settingsPage)
    menu.settingsContext = { key: world.key, name: world.key, argv: world.argv, space: "s1" };
  return { menu, cx, runtime };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function settle(harness: AgentConfigHarness): Promise<void> {
  for (let round = 0; round < 6; round++) {
    for (const job of harness.runtime.jobs.splice(0)) await job(harness.cx);
    for (const [, callback] of harness.runtime.timers.splice(0)) callback();
    await harness.menu.saving;
    await harness.menu.savingProvider;
    await flush();
  }
}

async function openedWorld(world: AgentConfigWorld): Promise<AgentConfigHarness> {
  const harness = startWorld(world);
  harness.menu.init({}, asContext(harness.cx));
  await settle(harness);
  harness.runtime.log.length = 0;
  return harness;
}

const stateOf = (menu: AgentConfigMenu, harness: AgentConfigHarness): unknown =>
  plain({
    key: menu.key,
    values: menu.values,
    models: menu.models,
    error: menu.error,
    hidden: [...menu.hidden],
    modelGroup: menu.modelGroup,
    groupOpen: menu.groupOpen,
    showHidden: menu.showHidden,
    open: menu.open,
    providers: Object.keys(menu.providers ?? {}),
    providerId: menu.providerId,
    cliModel: menu.cliModel,
    styles: menu.styles,
    naming: menu.naming,
    nameError: menu.nameError,
    editors: Object.fromEntries(
      Object.entries(menu.editors).map(([id, editor]) => [
        id,
        { v: editor.input.value(), dirty: editor.dirty, error: editor.error },
      ]),
    ),
    launching: menu.launching,
    launched: menu.launched,
    refreshing: menu.refreshing,
    files: [...harness.runtime.files].map(([path, text]) => [path, stamp(text)]),
  });

function viewOf(harness: AgentConfigHarness): unknown {
  harness.runtime.handlers.length = 0;
  harness.menu.showSettingsShortcut = () => false;
  return plain(nodeOf(harness.menu.render()));
}

const KEY_EVENTS = ["escape", "x"];

const OPERATIONS: Record<string, (menu: AgentConfigMenu, harness: AgentConfigHarness) => unknown> =
  {
    launch: (menu, harness) => menu.launch(asContext(harness.cx)),
    "launch blocked json": async (menu, harness) => {
      for (const editor of Object.values(menu.editors)) setMockValue(editor.input, "{bad\nline");
      await menu.launch(asContext(harness.cx));
    },
    "launch valid json": async (menu, harness) => {
      for (const editor of Object.values(menu.editors)) setMockValue(editor.input, '{"ok":true}');
      await menu.launch(asContext(harness.cx));
    },
    "launch via provider": async (menu, harness) => {
      menu.providerId = "omlx";
      menu.providers = {
        omlx: {
          name: "oMLX",
          host: "http://127.0.0.1:8000/v1",
          apiKey: "k",
          models: ["pm1", "pm2"],
        },
      };
      menu.model = "pm1";
      await menu.launch(asContext(harness.cx));
    },
    "launch via missing provider": (menu, harness) => {
      menu.providerId = "ghost";
      return menu.launch(asContext(harness.cx));
    },
    "launch via bad host": (menu, harness) => {
      menu.providerId = "bad";
      return menu.launch(asContext(harness.cx));
    },
    "launch twice": (menu, harness) =>
      Promise.all([menu.launch(asContext(harness.cx)), menu.launch(asContext(harness.cx))]),
    "launch without cx": (menu) => menu.launch(asContext(undefined)),
    refresh: (menu, harness) => {
      menu.refresh(asContext(harness.cx));
      menu.refresh(asContext(harness.cx));
    },
    "refresh fails": (menu, harness) => {
      menu.listModels = async () => [];
      menu.refresh(asContext(harness.cx));
    },
    "list models": (menu) =>
      menu.listModels().then(plain, (error) => `error: ${errorMessage(error)}`),
    "set value": (menu, harness) =>
      menu.setValue(
        Object.keys(menu.spec.options).find((id) => menu.spec.options[id].type === "select") ?? "",
        "haiku",
        asContext(harness.cx),
      ),
    "pick new style": (menu, harness) =>
      menu.pickChoice("outputStyle", "+ New style…", asContext(harness.cx)),
    "pick style": (menu, harness) =>
      menu.pickChoice("outputStyle", "Explanatory", asContext(harness.cx)),
    "create style: empty": (menu, harness) => {
      menu.naming = true;
      setMockValue(menu.styleInput, "");
      menu.createStyle(asContext(harness.cx));
    },
    "create style: bad name": (menu, harness) => {
      menu.naming = true;
      setMockValue(menu.styleInput, "bad name");
      menu.createStyle(asContext(harness.cx));
    },
    "create style: new name": (menu, harness) => {
      menu.naming = true;
      setMockValue(menu.styleInput, "fresh");
      menu.createStyle(asContext(harness.cx));
    },
    "create style: existing name": (menu, harness) => {
      menu.naming = true;
      setMockValue(menu.styleInput, "mine");
      menu.createStyle(asContext(harness.cx));
    },
    "cancel naming": (menu, harness) => {
      menu.naming = true;
      menu.cancelNaming(asContext(harness.cx));
      menu.cancelNaming(asContext(harness.cx));
    },
    "blur and change": (menu, harness) => {
      const handlers = handlersOf(menu.styleInput);
      handlers.focus?.();
      handlers.change?.({}, asContext(harness.cx));
      menu.naming = true;
      handlers.blur?.({}, asContext(harness.cx));
    },
    "save editors": (menu, harness) => {
      for (const [id, editor] of Object.entries(menu.editors))
        for (const raw of ['{"a":1}', "{bad", "plain"]) {
          setMockValue(editor.input, raw);
          menu.saveEditor(id, asContext(harness.cx));
        }
    },
    "editor change": (menu, harness) => {
      for (const editor of Object.values(menu.editors)) {
        setMockValue(editor.input, "changed");
        handlersOf(editor).change?.({}, asContext(harness.cx));
      }
    },
    "reset preset": (menu, harness) => menu.resetPreset(asContext(harness.cx)),
    "all items": (menu, harness) => {
      for (const [id, option] of Object.entries(menu.spec.options))
        if (option.items?.length) {
          menu.setAllItems(id, true, asContext(harness.cx));
          menu.toggleItem(id, option.items[0].id, asContext(harness.cx));
          menu.setAllItems(id, false, asContext(harness.cx));
        }
    },
    "toggle hidden": (menu) => {
      menu.toggleHidden("m1");
      menu.toggleHidden("m1");
      menu.toggleHidden(menu.models?.[0]?.id ?? "");
      menu.remember();
      menu.rememberGroup();
    },
    "set provider": async (menu, harness) => {
      for (const id of ["omlx", "omlx", "none", "gone", "plain"]) {
        menu.setProvider(id, asContext(harness.cx));
        await settle(harness);
      }
    },
    choose: (menu) => {
      const rows = [];
      for (const model of [null, ...(menu.models ?? [])])
        for (const effort of [undefined, "low", "high", "bogus"]) {
          menu.effort = "medium";
          menu.choose(model, effort);
          rows.push([model?.id, effort, menu.model, menu.effort]);
        }
      return rows;
    },
    "open providers": (menu) => menu.openProviders(),
    "open style file": (menu) => menu.openStyleFile("mine"),
    variant: (menu) => {
      menu.effort = "";
      return menu.rememberVariant().then(() => {
        menu.effort = null;
        return menu.rememberVariant();
      });
    },
    "load providers": async (menu) => plain(await menu.loadProviders()),
    "build launch": async (menu) => plain(await menu.buildLaunch({ argv: ["x"] })),
    "toggle select": (menu, harness) => {
      menu.open = "model";
      menu.toggle("model", asContext(harness.cx));
      menu.toggle("model", asContext(harness.cx));
    },
  };

async function recordWorld(world: AgentConfigWorld): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const initLog: unknown[][] = [];
  const initial = startWorld(world, initLog);
  initial.menu.init({}, asContext(initial.cx));
  await settle(initial);
  out.init = {
    log: plain(initLog),
    state: stateOf(initial.menu, initial),
    render: viewOf(initial),
  };
  const renders: unknown[][] = [];
  out.render = renders;
  for (const open of [null, "model", "effort", "provider", "outputStyle", "advisorModel"]) {
    const harness = await openedWorld(world);
    harness.menu.open = open;
    for (const extra of [
      {},
      { groupOpen: true },
      { showHidden: true },
      { naming: true },
      { naming: true, nameError: true },
    ]) {
      Object.assign(harness.menu, extra);
      renders.push([open, Object.keys(extra).join(), viewOf(harness)]);
    }
  }
  const handlersWorld = await openedWorld(world);
  viewOf(handlersWorld);
  out.handlers = handlersWorld.runtime.handlers.map(([name]) => name);
  const clicks: unknown[][] = [];
  out.clicks = clicks;
  for (let index = 0; index < handlersWorld.runtime.handlers.length; index++) {
    const name = handlersWorld.runtime.handlers[index][0];
    const events: Array<{ key?: string }> =
      name === "on_key_down" ? KEY_EVENTS.map((key) => ({ key })) : [{}];
    for (const event of events) {
      const harness = await openedWorld(world);
      viewOf(harness);
      const handler = harness.runtime.handlers[index][1];
      harness.runtime.log.length = 0;
      await handler(...(name === "on_hover" ? [true, harness.cx] : [event, harness.cx]));
      await settle(harness);
      clicks.push([
        index,
        name,
        event.key ?? null,
        plain(harness.runtime.log),
        stateOf(harness.menu, harness),
      ]);
    }
  }
  const ops: Record<string, unknown> = {};
  out.ops = ops;
  for (const [name, operation] of Object.entries(OPERATIONS)) {
    const harness = await openedWorld(world);
    if (name.startsWith("create style") && !harness.menu.hasSource("claudeOutputStyles")) continue;
    harness.runtime.log.length = 0;
    let result: unknown = null;
    let failure: string | null = null;
    try {
      result = await operation(harness.menu, harness);
      await settle(harness);
    } catch (error) {
      failure = errorName(error);
    }
    ops[name] = {
      result: plain(result),
      failure,
      log: plain(harness.runtime.log),
      state: stateOf(harness.menu, harness),
    };
  }
  return out;
}

it("runs every flyout world against the canonical TypeScript source", async () => {
  const worlds: Record<string, Record<string, unknown>> = {};
  for (const [name, world] of Object.entries(AGENT_CONFIG_WORLDS))
    worlds[name] = await recordWorld(world);
  const codex = worlds["codex, fresh cache, providers, saved choices"] as {
    init: {
      state: { models: Array<{ id: string }>; values: Record<string, unknown>; hidden: string[] };
    };
    ops: Record<string, { log: unknown[][] }>;
  };
  assert.deepEqual(
    codex.init.state.models.map((model) => model.id),
    ["m1", "m2", "m3"],
  );
  assert.equal(codex.init.state.values.model, "m3");
  assert.equal(codex.init.state.values.effort, "low");
  assert.deepEqual(codex.init.state.hidden, ["m1"]);
  assert.ok(codex.ops.launch.log.some(([kind]) => kind === "run"));

  const offline = worlds["codex, old schema, cli fails"] as {
    init: { state: { models: unknown; error: string } };
  };
  assert.equal(offline.init.state.models, null);
  assert.equal(offline.init.state.error, "Could not list models: offline");

  const claude = worlds["claude, styles and editors"] as {
    init: { state: { styles: string[] } };
    ops: Record<string, { log: unknown[][]; state: { nameError: boolean } }>;
  };
  assert.deepEqual(claude.init.state.styles, ["default", "Explanatory", "Learning", "mine"]);
  assert.equal(
    claude.ops["launch blocked json"].log.some(([kind]) => kind === "run"),
    false,
  );
  assert.ok(claude.ops["launch valid json"].log.some(([kind]) => kind === "run"));
  assert.equal(claude.ops["create style: bad name"].state.nameError, true);

  const remote = worlds["codex, remote machine"] as { ops: Record<string, { log: unknown[][] }> };
  assert.ok(remote.ops.launch.log.some(([kind]) => kind === "run"));
  assert.equal(Object.keys(worlds).length, Object.keys(AGENT_CONFIG_WORLDS).length);
}, 60_000);

it("renders settings previews for valid commands and reports malformed JSON and save conflicts", async () => {
  const harness = startWorld(
    AGENT_CONFIG_WORLDS["codex, fresh cache, providers, saved choices"],
    [],
    true,
  );
  harness.menu.init({}, asContext(harness.cx));
  await settle(harness);
  harness.menu.settingsLoaded = true;
  harness.menu.model = "m3";
  harness.menu.settingsContext = { key: "codex", argv: ["codex"], herdrEnv: false };

  const preview = await harness.menu.buildPreview(["codex"]);
  assert.ok("argv" in preview);
  assert.ok(preview.argv);
  assert.equal(preview.argv.includes("HERDR_ENV=1"), false);
  let copied = 0;
  const renderCodexSettings = () =>
    harness.menu.renderSettings(themeFixture(), asContext(harness.cx), {
      argv: ["codex"],
      format: (argv) => argv.join(" "),
      copy: () => {
        copied++;
      },
      enabled: true,
    });
  renderCodexSettings();
  await settle(harness);
  renderCodexSettings();
  const copyHandler = harness.runtime.handlers.find(([, , id]) => id === "am-copy-command");
  const launchHandler = harness.runtime.handlers.find(
    ([, , id]) => id === "am-launch-from-settings",
  );
  assert.ok(copyHandler);
  assert.ok(launchHandler);
  await copyHandler[1]({}, harness.cx);
  assert.equal(copied, 1);
  await launchHandler[1]({}, harness.cx);
  await settle(harness);
  assert.ok(harness.runtime.log.some(([kind]) => kind === "run"));

  const claude = startWorld(AGENT_CONFIG_WORLDS["claude, styles and editors"], [], true);
  claude.menu.init({}, asContext(claude.cx));
  await settle(claude);
  claude.menu.settingsLoaded = true;
  claude.menu.model = "haiku";
  claude.menu.editors.agents.input.set_value("{bad");
  const invalid = await claude.menu.buildPreview(["claude"]);
  assert.deepEqual(invalid, { error: "Fix invalid JSON to preview the command." });
  claude.menu.settingsSaveError = "This agent changed on disk.";
  const renderSettings = () =>
    nodeOf(
      claude.menu.renderSettings(themeFixture(), asContext(claude.cx), {
        argv: ["claude"],
        format: (argv) => argv.join(" "),
        copy: () => {},
        enabled: true,
      }),
    );
  renderSettings();
  await settle(claude);
  const tree = JSON.stringify(plain(renderSettings()));
  assert.match(tree, /Could not save: This agent changed on disk\./);
  assert.match(tree, /Fix invalid JSON to preview the command\./);
});

it("builds provider commands through direct and aliased gateway routes and rejects unsupported Pi models", async () => {
  const info = {
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedFeatures: ["tools"],
    contextWindow: 32768,
    maxTokens: 4096,
  };
  const provider = {
    name: "oMLX",
    host: "http://127.0.0.1:8000/v1",
    apiKey: "secret",
    models: ["provider-model"],
    modelInfo: { "provider-model": info },
  };
  const providerFile = JSON.stringify({ omlx: provider });
  const directWorld: AgentConfigWorld = {
    key: "codex",
    argv: ["codex"],
    checking: true,
    files: { "/home/model-providers.json": providerFile },
    exec: { gateway: '{"direct":true}' },
  };
  const direct = startWorld(directWorld);
  direct.menu.init({}, asContext(direct.cx));
  direct.menu.providerId = "omlx";
  direct.menu.providers = { omlx: provider };
  direct.menu.model = "provider-model";

  const directLaunch = await direct.menu.buildLaunch({ argv: ["codex"] });
  assert.ok("argv" in directLaunch);
  assert.ok(directLaunch.argv);
  if ("argv" in directLaunch) assert.ok(directLaunch.argv.includes("provider-model"));

  directWorld.exec = {
    gateway: JSON.stringify({
      host: "https://gateway.example/v1",
      model: "alias-model",
      aliases: { "provider-model": "alias-model" },
      configPath: "/tmp/gateway.json",
      id: "gateway",
    }),
  };
  const mapped = startWorld(directWorld);
  mapped.menu.init({}, asContext(mapped.cx));
  mapped.menu.providerId = "omlx";
  mapped.menu.providers = { omlx: provider };
  mapped.menu.model = "provider-model";
  const mappedLaunch = await mapped.menu.buildLaunch({ argv: ["codex"] });
  assert.ok("argv" in mappedLaunch);
  assert.ok(mappedLaunch.argv);
  if ("argv" in mappedLaunch) {
    assert.ok(mappedLaunch.argv.includes("alias-model"));
    assert.ok(mappedLaunch.argv.some((argument) => argument.includes("gateway.example")));
  }

  const invalidRoute = startWorld({ ...directWorld, exec: { gateway: "{" } });
  invalidRoute.menu.init({}, asContext(invalidRoute.cx));
  invalidRoute.menu.providerId = "omlx";
  invalidRoute.menu.providers = { omlx: provider };
  invalidRoute.menu.model = "provider-model";
  assert.deepEqual(await invalidRoute.menu.buildLaunch({ argv: ["codex"] }), {
    error: "LiteLLM is unavailable or the selected model is not configured.",
  });

  const pi = startWorld({ key: "pi", argv: ["pi"], checking: true });
  pi.menu.init({}, asContext(pi.cx));
  const piProvider: Parameters<AgentConfigMenu["providerLaunchArgv"]>[0] = {
    configPath: "/tmp/providers.json",
    host: provider.host,
    id: "omlx",
    models: ["provider-model"],
    modelInfo: { "provider-model": info },
  };
  const piLaunch = pi.menu.providerLaunchArgv(piProvider, "provider-model", ["pi"]);
  assert.ok("argv" in piLaunch);
  assert.ok(piLaunch.argv);
  if ("argv" in piLaunch)
    assert.equal(piLaunch.argv.at(-1), "/home/mods/orca-agent-flyout/pi-provider.js");
  assert.deepEqual(
    pi.menu.providerLaunchArgv(
      {
        ...piProvider,
        modelInfo: { "provider-model": { ...info, supportedFeatures: ["vision"] } },
      },
      "provider-model",
      ["pi"],
    ),
    { error: "Pi needs a text model with tool support." },
  );
  assert.deepEqual(
    pi.menu.providerLaunchArgv(
      { ...piProvider, modelInfo: { "provider-model": { ...info, contextWindow: 12000 } } },
      "provider-model",
      ["pi"],
    ),
    {
      error: "Pi needs a known context limit above 16,384 tokens and an output limit that fits it.",
    },
  );
});

it("renders long model lists with scroll handling, hover tips, and provider status", async () => {
  const harness = startWorld({ key: "codex", argv: ["codex"], checking: true });
  harness.menu.init({}, asContext(harness.cx));
  harness.menu.models = Array.from({ length: 40 }, (_, index) => ({
    id: `model-${index}`,
    label: `Model ${index}`,
    efforts: index === 0 ? ["low", "high"] : [],
    fallbackEffort: "high",
    fast: index === 0,
  }));
  harness.menu.model = "model-0";
  harness.menu.providers = {
    local: {
      name: "Local",
      host: "http://127.0.0.1:8000/v1",
      iconPath: "/home/mods/icons/local.png",
    },
    remote: { name: "Remote", host: "http://127.0.0.1:8000/v1", iconPath: "/outside/remote.png" },
  };
  harness.menu.litellmEnabled = true;
  harness.menu.hidden = new Set(["model-1"]);
  viewOf(harness);

  const wheel = harness.runtime.handlers.find(([name]) => name === "on_scroll_wheel");
  assert.ok(wheel);
  await wheel[1]({}, harness.cx);
  assert.ok(harness.runtime.log.some(([event]) => event === "stop"));

  const hover = harness.runtime.handlers.find(
    ([name, , id]) => name === "on_hover" && id === "cfg-hot-model-model-0",
  );
  assert.ok(hover);
  await hover[1](true, harness.cx);
  const withTip = JSON.stringify(viewOf(harness));
  assert.match(withTip, /Model 0/);

  harness.menu.open = "provider";
  viewOf(harness);
  const providerText = JSON.stringify(plain(nodeOf(harness.menu.providerList(themeFixture()))));
  const providerIconText = JSON.stringify(
    plain(nodeOf(harness.menu.providerIcon(harness.menu.providers.local, themeFixture()))),
  );
  assert.match(providerText, /Add More/);
  assert.match(providerIconText, /litellm_favicon_light_32/);
});

it("drops a preview job whose signature changed before it resolved", async () => {
  const harness = await openedWorld(
    AGENT_CONFIG_WORLDS["codex, fresh cache, providers, saved choices"],
  );
  harness.menu.settingsLoaded = true;
  harness.menu.settingsContext = { key: "codex", argv: ["codex"] };
  harness.menu.refresh(asContext(harness.cx));
  assert.equal(harness.menu.previewKey, null);
  harness.runtime.jobs.length = 0;

  harness.menu.syncPreview(["codex"], asContext(harness.cx));
  const stale = harness.runtime.jobs.shift();
  assert.ok(stale);
  harness.menu.values = { ...harness.menu.values, model: "m1" };
  harness.menu.syncPreview(["codex"], asContext(harness.cx));
  const fresh = harness.runtime.jobs.shift();
  assert.ok(fresh);
  harness.menu.previewResult = { error: "sentinel" };
  await stale(harness.cx);
  assert.deepEqual(harness.menu.previewResult, { error: "sentinel" });
  await fresh(harness.cx);
  assert.ok(harness.menu.previewResult && "argv" in harness.menu.previewResult);
  assert.ok(harness.runtime.log.some(([kind]) => kind === "notify"));
});

it("records a preview build failure and prefixes HERDR_ENV=1 by default", async () => {
  const harness = await openedWorld(
    AGENT_CONFIG_WORLDS["codex, fresh cache, providers, saved choices"],
  );
  assert.deepEqual(await harness.menu.buildPreview(["codex"]), {
    error: "Choose an available model before previewing the command.",
  });
  harness.menu.settingsLoaded = true;
  harness.menu.model = "m3";
  harness.menu.settingsContext = { key: "codex", argv: ["codex"] };
  const preview = await harness.menu.buildPreview(["codex"]);
  assert.ok("argv" in preview);
  assert.ok(preview.argv);
  assert.deepEqual(preview.argv.slice(0, 2), ["env", "HERDR_ENV=1"]);

  harness.menu.buildPreview = async () => {
    throw new Error("preview exploded");
  };
  harness.menu.syncPreview(["codex"], asContext(harness.cx));
  const job = harness.runtime.jobs.shift();
  assert.ok(job);
  await job(harness.cx);
  assert.deepEqual(harness.menu.previewResult, { error: "preview exploded" });
});

it("reports save conflicts and write failures and clears the error after a successful save", async () => {
  const subject = subjectFor();
  subject.settingsContext = { key: "claude" };
  subject.snapshot = JSON.stringify({ claude: { model: "old-model" } });
  host.__herdrReadTextFile = async () => JSON.stringify({ claude: { model: "new-model" } });
  subject.remember();
  await subject.saving;
  assert.match(subject.settingsSaveError ?? "", /changed on disk/);

  host.__herdrReadTextFile = async () => subject.snapshot;
  host.__herdrWriteTextFile = async () => {
    throw new Error("disk full");
  };
  subject.remember();
  await subject.saving;
  assert.equal(subject.settingsSaveError, "disk full");

  host.__herdrWriteTextFile = async () => null;
  subject.remember();
  await subject.saving;
  assert.equal(subject.settingsSaveError, null);

  const standalone = subjectFor();
  standalone.snapshot = "{}";
  host.__herdrWriteTextFile = async () => {
    throw new Error("read-only");
  };
  standalone.remember();
  await standalone.saving;
  assert.equal(standalone.settingsSaveError, undefined);
});

it("validates style names and cancels naming from the selector and the Escape key", async () => {
  const harness = await openedWorld(AGENT_CONFIG_WORLDS["claude, styles and editors"]);
  const menu = harness.menu;
  menu.styleInput.set_value("bad name");
  menu.naming = true;
  handlersOf(menu.styleInput).submit?.({}, asContext(harness.cx));
  assert.equal(menu.nameError, true);
  assert.equal(menu.choiceLabel(menu.spec.options.outputStyle, true), "LETTERS, DIGITS, - _ ONLY");

  const theme = themeFixture();
  const clickFrom = harness.runtime.handlers.length;
  menu.choiceSelect("outputStyle", menu.spec.options.outputStyle, theme);
  const toggle = harness.runtime.handlers
    .slice(clickFrom)
    .find(([name, , id]) => name === "on_click" && id === "outputStyle-select");
  assert.ok(toggle);
  menu.open = null;
  await toggle[1]({}, harness.cx);
  assert.equal(menu.open, null);
  menu.naming = false;
  await toggle[1]({}, harness.cx);
  assert.equal(menu.open, "outputStyle");

  const keyFrom = harness.runtime.handlers.length;
  menu.naming = true;
  menu.nameEntry();
  const escape = harness.runtime.handlers
    .slice(keyFrom)
    .filter(([name]) => name === "on_key_down")
    .at(-1);
  assert.ok(escape);
  await escape[1]({ key: "escape" }, harness.cx);
  assert.equal(menu.naming, false);
  assert.ok(harness.runtime.log.some(([kind]) => kind === "stop"));
});

it("renders selector, checklist, grouped-model, and mixed editor controls", () => {
  const t = themeFixture();
  const codex = startWorld({ key: "codex", argv: ["codex"], checking: true });
  codex.menu.init({}, asContext(codex.cx));
  codex.menu.models = [
    { id: "fast-model", label: "Fast model", efforts: ["low", "high"], fast: true },
    { id: "plain-model", label: "Plain model", efforts: [] },
  ];
  codex.menu.model = "fast-model";
  codex.menu.values.codexOff = ["apps"];
  assert.ok(codex.menu.selectControl("model", t));
  assert.ok(codex.menu.selectControl("effort", t));
  assert.ok(codex.menu.selectControl("fast", t));
  codex.menu.model = "plain-model";
  assert.equal(codex.menu.selectControl("effort", t), null);
  codex.menu.model = "fast-model";
  assert.ok(codex.menu.selectRow(["model", "effort", "fast"], t).length > 0);
  const checklist = codex.menu.checklist("codexOff", t);
  assert.match(JSON.stringify(plain(nodeOf(checklist))), /codexOff-all/);
  assert.ok(
    codex.menu.sectionBody({ title: "OTHER", options: Object.keys(codex.menu.spec.options) }, t),
  );
  assert.ok(codex.menu.listFor("model", t));
  assert.ok(codex.menu.listFor("effort", t));
  assert.ok(codex.menu.listFor("fast", t));

  const opencode = startWorld({ key: "opencode", argv: ["opencode"], checking: true });
  opencode.menu.init({}, asContext(opencode.cx));
  opencode.menu.models = [
    { id: "opencode/free", label: "Free", group: "free", efforts: ["low"] },
    { id: "opencode/paid", label: "Paid", group: "paid", efforts: ["high"] },
  ];
  opencode.menu.modelGroup = "paid";
  opencode.menu.groupOpen = true;
  assert.ok(opencode.menu.groupSelect(t));
  assert.ok(opencode.menu.withGroupFilter(div(), t));
  assert.equal(
    opencode.menu
      .shownModels()
      .map((model) => model.id)
      .join(),
    "opencode/paid",
  );

  const claude = startWorld({ key: "claude", argv: ["claude"], checking: true });
  claude.menu.init({}, asContext(claude.cx));
  assert.equal(claude.menu.editorElements("agents", t).length, 2);
  assert.equal(claude.menu.editorElements("systemPrompt", t).length, 2);
  assert.ok(claude.menu.selectControl("advisorModel", t));
  assert.ok(claude.menu.selectControl("outputStyle", t));
  assert.ok(claude.menu.listFor("advisorModel", t));
});

const handlerNamed = (harness: AgentConfigHarness, id: string, event = "on_click"): Handler => {
  const found = harness.runtime.handlers.find(
    ([name, , elementId]) => name === event && elementId === id,
  );
  assert.ok(found, `no ${event} handler for ${id}`);
  return found[1];
};
const clicksSince = (harness: AgentConfigHarness, from: number): Handler[] =>
  harness.runtime.handlers
    .slice(from)
    .filter(([name]) => name === "on_click")
    .map(([, handler]) => handler);
const treeText = (nodes: Element[]): string => JSON.stringify(plain(nodes.map(nodeOf)));
const renderSettingsOf = (harness: AgentConfigHarness, argv: string[]): Element =>
  harness.menu.renderSettings(themeFixture(), asContext(harness.cx), {
    argv,
    format: (parts) => parts.join(" "),
    copy: () => {},
    enabled: true,
  });
const FAST_MODELS = [
  {
    id: "fast-model",
    label: "Fast model",
    efforts: ["low", "high"],
    fallbackEffort: "high",
    fast: true,
  },
  { id: "plain-model", label: "Plain model", efforts: [], fallbackEffort: "high" },
];
const omlxProvider = () => ({
  name: "oMLX",
  host: "http://127.0.0.1:8000/v1",
  apiKey: "secret",
  models: ["provider-model"],
  modelInfo: { "provider-model": { contextWindow: 32768, maxTokens: 4096 } },
});

it("expands the Codex MCP switch from config.toml and to nothing when the file is absent", async () => {
  const absent = startWorld({ key: "codex", argv: ["codex"], checking: true });
  absent.menu.init({}, asContext(absent.cx));
  absent.menu.values.codexOff = ["mcp"];
  const withoutFile = await absent.menu.buildLaunch({ argv: ["codex"] });

  const present = startWorld({
    key: "codex",
    argv: ["codex"],
    checking: true,
    files: { "/home/.codex/config.toml": '[mcp_servers.alpha]\n[mcp_servers."quoted name"]\n' },
  });
  present.menu.init({}, asContext(present.cx));
  present.menu.values.codexOff = ["mcp"];
  const withFile = await present.menu.buildLaunch({ argv: ["codex"] });

  assert.ok("argv" in withoutFile);
  assert.ok("argv" in withFile);
  assert.equal(
    withoutFile.argv?.some((argument) => argument.startsWith("mcp_servers.")),
    false,
  );
  assert.ok(withFile.argv?.includes("mcp_servers.alpha.enabled=false"));
  assert.ok(withFile.argv?.includes('mcp_servers."quoted name".enabled=false'));
});

it("reads a malformed agent-manager.json as no disabled agents with HERDR_ENV on", async () => {
  const malformed = startWorld({
    key: "codex",
    argv: ["codex"],
    checking: true,
    files: { "/home/agent-manager.json": "{" },
  });
  assert.deepEqual(await malformed.menu.readManagerSettings(), {
    disabled: new Set(),
    herdrEnv: true,
  });

  const saved = startWorld({
    key: "codex",
    argv: ["codex"],
    checking: true,
    files: { "/home/agent-manager.json": '{"disabled":["pi",4],"herdrEnv":false}' },
  });
  assert.deepEqual(await saved.menu.readManagerSettings(), {
    disabled: new Set(["pi"]),
    herdrEnv: false,
  });
});

it("refuses to save when agent-config.json is valid JSON but not an object", async () => {
  const subject = subjectFor();
  subject.settingsContext = { key: "claude" };
  subject.snapshot = "{}";
  for (const text of ["[]", "null"]) {
    host.__herdrReadTextFile = async () => text;
    await assert.rejects(subject.settingsWriteBase(), /Invalid agent-config.json/);
  }
  host.__herdrReadTextFile = async () => "[]";
  subject.remember();
  await subject.saving;
  assert.equal(subject.settingsSaveError, "Invalid agent-config.json");
});

it("adds a checklist item that is off and keeps the items already on", async () => {
  const harness = await openedWorld(
    AGENT_CONFIG_WORLDS["codex, fresh cache, providers, saved choices"],
  );
  harness.menu.values.codexOff = ["apps"];
  harness.menu.toggleItem("codexOff", "mcp", asContext(harness.cx));
  assert.deepEqual(harness.menu.values.codexOff, ["apps", "mcp"]);
  harness.menu.toggleItem("codexOff", "apps", asContext(harness.cx));
  assert.deepEqual(harness.menu.values.codexOff, ["mcp"]);
  await settle(harness);
  const saved = JSON.parse(harness.runtime.files.get("/home/agent-config.json") ?? "{}");
  assert.deepEqual(saved.codex.preset.codexOff, ["mcp"]);
});

it("sets the checklist from its all and clear links and toggles one row from its label", async () => {
  const harness = await openedWorld(
    AGENT_CONFIG_WORLDS["codex, fresh cache, providers, saved choices"],
  );
  const menu = harness.menu;
  const everyItem = (menu.spec.options.codexOff.items ?? []).map((item) => item.id);
  harness.runtime.handlers.length = 0;
  menu.checklist("codexOff", themeFixture());

  handlerNamed(harness, "codexOff-all")({}, asContext(harness.cx));
  assert.deepEqual(menu.values.codexOff, everyItem);
  handlerNamed(harness, "codexOff-clear")({}, asContext(harness.cx));
  assert.deepEqual(menu.values.codexOff, []);
  handlerNamed(harness, "codexOff-apps")({}, asContext(harness.cx));
  assert.deepEqual(menu.values.codexOff, ["apps"]);
  await settle(harness);
  const saved = JSON.parse(harness.runtime.files.get("/home/agent-config.json") ?? "{}");
  assert.deepEqual(saved.codex.preset.codexOff, ["apps"]);
});

it("selects a provider from the source list and opens provider settings from Add More", async () => {
  const harness = await openedWorld(
    AGENT_CONFIG_WORLDS["codex, fresh cache, providers, saved choices"],
  );
  const menu = harness.menu;
  menu.open = "provider";
  harness.runtime.handlers.length = 0;
  menu.providerList(themeFixture());

  handlerNamed(harness, "provider-omlx")({}, asContext(harness.cx));
  await settle(harness);
  assert.equal(menu.providerId, "omlx");
  assert.equal(menu.open, null);
  assert.equal(menu.model, "pm2");

  harness.runtime.log.length = 0;
  handlerNamed(harness, "provider-add")({}, asContext(harness.cx));
  assert.deepEqual(harness.runtime.log, [
    ["run", "layout.select", { stack: "main", child: "main-providers" }],
    ["setShared", "orca-agent-flyout", null],
    ["closeOverlay", "ov"],
    ["closeOverlay", "menu"],
  ]);
});

it("picks an output style from its list and starts a new style from the same list", async () => {
  const harness = await openedWorld(AGENT_CONFIG_WORLDS["claude, styles and editors"]);
  const menu = harness.menu;
  harness.runtime.handlers.length = 0;
  menu.listFor("outputStyle", themeFixture());

  handlerNamed(harness, "outputStyle-Explanatory")({}, asContext(harness.cx));
  assert.equal(menu.values.outputStyle, "Explanatory");
  assert.equal(menu.open, null);

  handlerNamed(harness, "outputStyle-+ New style…")({}, asContext(harness.cx));
  assert.equal(menu.naming, true);
  assert.equal(harness.runtime.timers.length, 1);
});

it("opens and closes the model and effort selectors from their boxes", () => {
  const harness = startWorld({ key: "codex", argv: ["codex"], checking: true });
  harness.menu.init({}, asContext(harness.cx));
  harness.menu.models = FAST_MODELS;
  harness.menu.model = "fast-model";
  harness.runtime.handlers.length = 0;
  harness.menu.selectControl("model", themeFixture());
  harness.menu.selectControl("effort", themeFixture());

  const modelBox = handlerNamed(harness, "model-select");
  modelBox({}, asContext(harness.cx));
  assert.equal(harness.menu.open, "model");
  modelBox({}, asContext(harness.cx));
  assert.equal(harness.menu.open, null);
  handlerNamed(harness, "effort-select")({}, asContext(harness.cx));
  assert.equal(harness.menu.open, "effort");
});

it("shows the open selector list under its row of controls", () => {
  const harness = startWorld({ key: "codex", argv: ["codex"], checking: true });
  harness.menu.init({}, asContext(harness.cx));
  harness.menu.models = FAST_MODELS;
  harness.menu.model = "fast-model";

  harness.menu.open = "model";
  const modelRows = harness.menu.selectRow(["model", "effort"], themeFixture());
  assert.equal(modelRows.length, 2);
  assert.match(treeText([modelRows[1]]), /Plain model/);

  harness.menu.open = "effort";
  const effortRows = harness.menu.selectRow(["model", "effort"], themeFixture());
  assert.equal(effortRows.length, 2);
  assert.match(treeText([effortRows[1]]), /High/);
  assert.doesNotMatch(treeText([effortRows[1]]), /Plain model/);
});

it("saves a JSON editor as formatted JSON and records the parse error on a failed save", async () => {
  const harness = await openedWorld(AGENT_CONFIG_WORLDS["claude, styles and editors"]);
  const menu = harness.menu;
  harness.runtime.handlers.length = 0;
  menu.editorElements("agents", themeFixture());
  const save = handlerNamed(harness, "save-agents");

  menu.editors.agents.input.set_value("{bad");
  save({}, asContext(harness.cx));
  assert.equal(menu.editors.agents.error?.line, 1);
  assert.equal(menu.editors.agents.dirty, true);

  menu.editors.agents.input.set_value('{"b":2}');
  save({}, asContext(harness.cx));
  assert.equal(menu.values.agents, '{\n  "b": 2\n}');
  assert.equal(menu.editors.agents.dirty, false);
  assert.equal(menu.editors.agents.error, null);
});

it("labels the JSON editor badge as an error, unsaved changes, or valid JSON", async () => {
  const harness = await openedWorld(AGENT_CONFIG_WORLDS["claude, styles and editors"]);
  const menu = harness.menu;
  const badge = () => treeText(menu.editorElements("agents", themeFixture()));

  menu.editors.agents.error = { message: "Expected value", line: 3 };
  assert.match(badge(), /Invalid JSON · line 3/);
  menu.editors.agents.error = null;
  menu.editors.agents.dirty = true;
  assert.match(badge(), /Unsaved changes/);
  menu.editors.agents.dirty = false;
  assert.match(badge(), /Valid JSON/);
});

it("renders an editor option that is not part of a paired row as its own editor", async () => {
  const harness = await openedWorld(AGENT_CONFIG_WORLDS["claude, styles and editors"]);
  const body = harness.menu.sectionBody(
    { title: "ADVANCED", options: ["systemPrompt"] },
    themeFixture(),
  );
  assert.match(treeText([body]), /Append system prompt/);
  assert.match(treeText([body]), /save-systemPrompt/);
});

it("clears a hover tip only when the pointer leaves the tip that is showing", async () => {
  const harness = startWorld({ key: "codex", argv: ["codex"], checking: true });
  harness.menu.init({}, asContext(harness.cx));
  harness.menu.tip("probe", "Probe", div());
  const hover = handlerNamed(harness, "cfg-hot-probe", "on_hover");

  await hover(true, harness.cx);
  assert.equal(harness.menu.hotTip, "probe");
  harness.menu.hotTip = "other";
  await hover(false, harness.cx);
  assert.equal(harness.menu.hotTip, "other");
  harness.menu.hotTip = "probe";
  await hover(false, harness.cx);
  assert.equal(harness.menu.hotTip, null);
});

it("opens full agent settings from the header and closes the flyout", () => {
  const harness = startWorld({ key: "codex", argv: ["codex"], checking: true });
  harness.menu.init({}, asContext(harness.cx));
  harness.menu.header(themeFixture());
  handlerNamed(harness, "agent-full-settings")({}, harness.cx);
  assert.deepEqual(harness.runtime.log, [
    ["stop"],
    ["setShared", "agent-manager.open-agent", { key: "codex" }],
    ["run", "orca-header.agent-settings"],
    ["setShared", "orca-agent-flyout", null],
    ["closeOverlay", "ov"],
    ["closeOverlay", "menu"],
  ]);
});

it("shows a loading line until models arrive and the load error once they fail", () => {
  const harness = startWorld({ key: "claude", argv: ["claude"], checking: true });
  harness.menu.init({}, asContext(harness.cx));

  const loading = treeText([renderSettingsOf(harness, ["claude"])]);
  assert.match(loading, /Loading models…/);
  assert.match(loading, /Building command…/);

  harness.menu.error = "Could not list models: offline";
  const failed = treeText([renderSettingsOf(harness, ["claude"])]);
  assert.match(failed, /Could not list models: offline/);
  assert.match(failed, /Command preview unavailable\./);
  assert.doesNotMatch(failed, /Loading models…/);
});

it("notes that OpenCode effort is stored as a model variant in the settings preview", async () => {
  const harness = startWorld({ key: "opencode", argv: ["opencode"], checking: true }, [], true);
  harness.menu.init({}, asContext(harness.cx));
  harness.menu.models = [{ id: "opencode/free", label: "Free", efforts: [], fallbackEffort: "" }];
  harness.menu.model = "opencode/free";
  harness.menu.settingsLoaded = true;

  renderSettingsOf(harness, ["opencode"]);
  await settle(harness);
  const tree = treeText([renderSettingsOf(harness, ["opencode"])]);
  assert.match(tree, /OpenCode effort is stored separately as its model variant/);
  assert.match(tree, /HERDR_ENV=1/);
});

it("reports an unavailable gateway when the LiteLLM route helper cannot run", async () => {
  const harness = startWorld({
    key: "codex",
    argv: ["codex"],
    checking: true,
    files: { "/home/model-providers.json": JSON.stringify({ omlx: omlxProvider() }) },
    exec: { gateway: new Error("spawn python3 ENOENT") },
  });
  harness.menu.init({}, asContext(harness.cx));
  harness.menu.providerId = "omlx";
  harness.menu.providers = { omlx: omlxProvider() };
  harness.menu.model = "provider-model";

  assert.deepEqual(await harness.menu.buildLaunch({ argv: ["codex"] }), {
    error: "LiteLLM is unavailable or the selected model is not configured.",
  });
});

it("accepts an OpenCode model with tool support and rejects one without", () => {
  const harness = startWorld({ key: "opencode", argv: ["opencode"], checking: true });
  harness.menu.init({}, asContext(harness.cx));
  const provider: Parameters<AgentConfigMenu["providerLaunchArgv"]>[0] = {
    configPath: "/tmp/providers.json",
    host: "http://127.0.0.1:8000/v1",
    id: "omlx",
    models: ["om1"],
    modelInfo: { om1: { supportedFeatures: ["vision"] } },
  };
  assert.deepEqual(harness.menu.providerLaunchArgv(provider, "om1", ["opencode"]), {
    error: "OpenCode needs a text model with tool support.",
  });

  const capable = harness.menu.providerLaunchArgv(
    { ...provider, modelInfo: { om1: { supportedFeatures: ["tools"] } } },
    "om1",
    ["opencode"],
  );
  assert.ok("argv" in capable);
  assert.ok(capable.argv?.join(" ").includes("herdr/model-1"));
});

it("sets the model group from its dropdown row and saves the choice", async () => {
  const harness = await openedWorld(
    AGENT_CONFIG_WORLDS["opencode, groups, hidden models, variant file"],
  );
  const menu = harness.menu;
  assert.equal(menu.modelGroup, "paid");
  menu.groupOpen = true;
  harness.runtime.handlers.length = 0;
  menu.withGroupFilter(div(), themeFixture());

  handlerNamed(harness, "group-omlx")({}, asContext(harness.cx));
  await settle(harness);
  assert.equal(menu.modelGroup, "omlx");
  assert.equal(menu.groupOpen, false);
  const saved = JSON.parse(harness.runtime.files.get("/home/agent-config.json") ?? "{}");
  assert.equal(saved.opencode.group, "omlx");
});

it("toggles Fast only while the current model supports it", async () => {
  const t = themeFixture();
  const harness = startWorld({ key: "codex", argv: ["codex"], checking: true });
  harness.menu.init({}, asContext(harness.cx));
  harness.menu.models = FAST_MODELS;
  harness.menu.model = "fast-model";

  let from = harness.runtime.handlers.length;
  harness.menu.fastControl(t);
  const [fastButton] = clicksSince(harness, from);
  assert.ok(fastButton);
  await fastButton({}, harness.cx);
  assert.equal(harness.menu.values.fast, true);

  from = harness.runtime.handlers.length;
  harness.menu.fastControl(t);
  const [fastOff] = clicksSince(harness, from);
  assert.ok(fastOff);
  await fastOff({}, harness.cx);
  assert.equal(harness.menu.values.fast, false);

  from = harness.runtime.handlers.length;
  harness.menu.selectControl("fast", t);
  const [toggle] = clicksSince(harness, from);
  assert.ok(toggle);
  await toggle({}, harness.cx);
  assert.equal(harness.menu.values.fast, true);

  harness.menu.model = "plain-model";
  from = harness.runtime.handlers.length;
  harness.menu.selectControl("fast", t);
  harness.menu.fastControl(t);
  assert.equal(clicksSince(harness, from).length, 0);
  assert.equal(harness.menu.values.fast, true);
});
