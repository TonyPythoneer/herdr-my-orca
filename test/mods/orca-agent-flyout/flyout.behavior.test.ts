import { afterEach, describe, test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import type { Context } from "gpui-kit";
import Flyout from "../../../src/mods/orca-agent-flyout/main.js";
import { createAgentConfigClass } from "../../../src/shared/agent-config-view.js";
import { AGENT_CONFIG_WORLDS } from "../../support/agent-config-worlds.js";
import {
  clearAgentConfigRuntime,
  setAgentConfigRuntime,
  type AgentConfigWorld,
} from "../../support/agent-config-runtime.js";

vi.mock("herdr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("herdr")>();
  const { agentConfigRuntime } = await import("../../support/agent-config-runtime.js");
  return {
    ...actual,
    readTextFile: (path: string) => Promise.resolve(agentConfigRuntime()?.files.get(path)),
  };
});

vi.mock("gpui-base", async (importOriginal) => {
  const actual = await importOriginal<typeof import("gpui-base")>();
  const { recordedElement } = await import("../../stubs/gpui-recording.js");
  const { agentConfigRuntime } = await import("../../support/agent-config-runtime.js");
  type Field = {
    __v: string;
    fns?: Record<string, unknown>;
    value(): string;
    set_value(next: string): void;
    set_soft_wrap(next: unknown): void;
    on(event: string, handler: unknown): void;
    focus(): void;
  };
  const record = (entry: unknown[]) => {
    agentConfigRuntime()?.log.push(entry);
  };
  const field = (initial: string): Field => {
    const self: Field = {
      __v: initial,
      value: () => self.__v,
      set_value(next) {
        self.__v = next;
        record(["set_value", next]);
      },
      set_soft_wrap: (next) => record(["soft_wrap", next]),
      on(event, handler) {
        (self.fns ??= {})[event] = handler;
      },
      focus: () => record(["focus"]),
    };
    return self;
  };
  return {
    ...actual,
    v_flex: (...args: unknown[]) => recordedElement("v_flex", ...args),
    h_flex: (...args: unknown[]) => recordedElement("h_flex", ...args),
    TextareaState: { new: (options?: { value?: string }) => field(options?.value ?? "") },
    InputState: { new: () => field("") },
    Textarea: { new: (...args: unknown[]) => recordedElement("Textarea.new", ...args) },
    Input: { new: (...args: unknown[]) => recordedElement("Input.new", ...args) },
    Scrollbar: { vertical: (...args: unknown[]) => recordedElement("Scrollbar.vertical", ...args) },
    HoverCard: { new: (...args: unknown[]) => recordedElement("HoverCard.new", ...args) },
  };
});

type Menu = InstanceType<typeof Flyout> | InstanceType<ReturnType<typeof createAgentConfigClass>>;
type Job = (cx: Context) => unknown;
type Handler = [string, (...args: unknown[]) => unknown, string?];
type Harness = {
  menu: Menu;
  cx: Context;
  argv: string[];
  handlers: Handler[];
  jobs: Job[];
  timers: [number, () => void][];
  files: Map<string, string>;
  log: unknown[][];
};
type Field = { fns?: Record<string, (...args: unknown[]) => unknown>; __v: string };

const GOLDEN_STYLE_DIR = "/home/.claude/output-styles";
const SETTINGS = "/home/agent-config.json";
const MODEL_VARIANT = "/home/.local/state/opencode/model.json";
const CODEX_ARGV = [
  "codex",
  "--no-daemon",
  "-m",
  "m3",
  "-c",
  "model_reasoning_effort=low",
  "--disable",
  "apps",
  "-c",
  "mcp_servers.alpha.enabled=false",
  "-c",
  'mcp_servers."quoted name".enabled=false',
];

const world = (name: string): AgentConfigWorld => {
  const found = AGENT_CONFIG_WORLDS[name];
  if (!found) throw new Error(`no world named ${name}`);
  return found;
};

function start(scenario: AgentConfigWorld, log: unknown[][], settingsPage = false): Harness {
  const runtime = setAgentConfigRuntime(scenario, log);
  const jobs: Job[] = [];
  const timers: [number, () => void][] = [];
  const cx = {
    notify: () => {
      log.push(["notify"]);
    },
    spawn: (job: Job) => {
      jobs.push(job);
    },
    timer: {
      after: (ms: number, fn: () => void) => {
        timers.push([ms, fn]);
      },
    },
    stop_propagation: () => {
      log.push(["stop"]);
    },
  } as Context;
  const Standalone = createAgentConfigClass();
  const menu: Menu = settingsPage || scenario.managerCopy ? new Standalone() : new Flyout();
  return {
    menu,
    cx,
    argv: scenario.argv,
    handlers: runtime.handlers,
    jobs,
    timers,
    files: runtime.files,
    log,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function settle(harness: Harness): Promise<void> {
  for (let round = 0; round < 6; round++) {
    for (const job of harness.jobs.splice(0)) await job(harness.cx);
    for (const [, fn] of harness.timers.splice(0)) fn();
    await harness.menu.saving;
    await harness.menu.savingProvider;
    await flush();
  }
}

async function opened(scenario: AgentConfigWorld): Promise<Harness> {
  const harness = start(scenario, []);
  harness.menu.init({}, harness.cx);
  await settle(harness);
  harness.log.length = 0;
  return harness;
}

async function initialized(scenario: AgentConfigWorld): Promise<Harness> {
  const harness = start(scenario, []);
  harness.menu.init({}, harness.cx);
  await settle(harness);
  return harness;
}

function fieldOf(value: unknown): Field {
  return value as Field;
}

function setRaw(field: unknown, text: string): void {
  Object.assign(fieldOf(field), { __v: text });
}

function kinds(log: unknown[][]): unknown[] {
  return log.map((entry) => entry[0]);
}

function runs(log: unknown[][]): unknown[][] {
  return log.filter((entry) => entry[0] === "run");
}

function writesTo(log: unknown[][], path: string): unknown[][] {
  return log.filter((entry) => entry[0] === "write" && entry[1] === path);
}

function parsed(text: string | undefined): Record<string, Record<string, unknown>> {
  return JSON.parse(text ?? "{}") as Record<string, Record<string, unknown>>;
}

afterEach(() => clearAgentConfigRuntime());

describe("codex with saved choices and providers", () => {
  test("launch runs the exact argv, closes the overlay after the terminal opens, and saves the choices", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    await w.menu.launch(w.cx);
    await settle(w);
    assert.deepEqual(runs(w.log), [
      [
        "run",
        "tab.new",
        { space: "s1", folder: "/repo", argv: ["env", "HERDR_ENV=1", ...CODEX_ARGV] },
      ],
    ]);
    assert.deepEqual(kinds(w.log), ["run", "setShared", "closeOverlay", "closeOverlay", "write"]);
    assert.deepEqual(w.log[1], ["setShared", "orca-agent-flyout", null]);
    assert.deepEqual(w.log[2], ["closeOverlay", "ov"]);
    assert.deepEqual(w.log[3], ["closeOverlay", "menu"]);
    assert.equal(w.menu.launching, true);
  });

  test("a second launch while the first is starting opens one terminal", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    await Promise.all([w.menu.launch(w.cx), w.menu.launch(w.cx)]);
    await settle(w);
    assert.equal(runs(w.log).length, 1);
  });

  test("launch without a context still opens the terminal, as legacy does", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    await Reflect.apply(Reflect.get(w.menu, "launch") as (...args: unknown[]) => unknown, w.menu, [
      undefined,
    ]);
    await settle(w);
    assert.equal(runs(w.log).length, 1);
    assert.deepEqual(kinds(w.log).slice(0, 4), [
      "run",
      "setShared",
      "closeOverlay",
      "closeOverlay",
    ]);
  });

  test("buildLaunch returns the argv for the saved codex choices", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    const built = await w.menu.buildLaunch({ argv: ["x"] });
    assert.deepEqual(built, {
      argv: [
        "x",
        "-m",
        "m3",
        "-c",
        "model_reasoning_effort=low",
        "--disable",
        "apps",
        "-c",
        "mcp_servers.alpha.enabled=false",
        "-c",
        'mcp_servers."quoted name".enabled=false',
      ],
    });
  });

  test("a new output style with no style option stores its value under the undefined key, opens its file and keeps the preset clean", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    w.menu.naming = true;
    setRaw(w.menu.styleInput, "fresh");
    w.menu.createStyle(w.cx);
    await settle(w);
    assert.deepEqual(w.menu.values, {
      fast: false,
      codexOff: ["apps", "mcp"],
      model: "m3",
      effort: "low",
      undefined: "fresh",
    });
    assert.equal(w.menu.naming, false);
    assert.equal(fieldOf(w.menu.styleInput).__v, "");
    assert.deepEqual(kinds(w.log), ["set_value", "notify", "run", "write", "exec", "notify"]);
    assert.deepEqual(runs(w.log), [
      ["run", "tab.new", { mod: "orca-files", props: { file: `${GOLDEN_STYLE_DIR}/fresh.md` } }],
    ]);
    const saved = parsed(writesTo(w.log, SETTINGS).at(-1)?.[2] as string | undefined);
    assert.deepEqual(saved.codex?.preset, { fast: false, codexOff: ["apps", "mcp"] });
  });

  test("an empty name cancels naming without writing", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    w.menu.naming = true;
    setRaw(w.menu.styleInput, "");
    w.menu.createStyle(w.cx);
    await settle(w);
    assert.equal(w.menu.naming, false);
    assert.deepEqual(kinds(w.log), ["set_value", "notify"]);
  });

  test("a name with a space is refused and keeps the naming field open", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    w.menu.naming = true;
    setRaw(w.menu.styleInput, "bad name");
    w.menu.createStyle(w.cx);
    await settle(w);
    assert.equal(w.menu.nameError, true);
    assert.equal(w.menu.naming, true);
    assert.deepEqual(kinds(w.log), ["notify"]);
  });

  test("cancelNaming clears the field and closes naming", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    w.menu.naming = true;
    w.menu.cancelNaming(w.cx);
    assert.equal(w.menu.naming, false);
    assert.deepEqual(kinds(w.log), ["set_value", "notify"]);
  });

  test("the new style choice opens naming and focuses its field", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    w.menu.pickChoice("outputStyle", "+ New style…", w.cx);
    await settle(w);
    assert.equal(w.menu.naming, true);
    assert.deepEqual(kinds(w.log), ["notify", "focus"]);
  });

  test("picking a saved output style writes it into the settings file", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    w.menu.pickChoice("outputStyle", "Explanatory", w.cx);
    await settle(w);
    assert.equal(w.menu.values.outputStyle, "Explanatory");
    assert.deepEqual(kinds(w.log), ["notify", "write"]);
  });

  test("setValue on a flyout with no select option stores the value under the undefined key", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    w.menu.setValue(undefined as unknown as string, "haiku", w.cx);
    await settle(w);
    assert.equal(w.menu.values.undefined, "haiku");
    assert.deepEqual(kinds(w.log), ["notify", "write"]);
  });

  test("the choose table keeps the effort when the model supports it and falls back otherwise", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    const rows: unknown[] = [];
    for (const model of [null, ...(w.menu.models ?? [])])
      for (const effort of [undefined, "low", "high", "bogus"]) {
        w.menu.effort = "medium";
        w.menu.choose(model, effort);
        rows.push([model?.id ?? null, effort ?? null, w.menu.model ?? null, w.menu.effort ?? null]);
      }
    assert.deepEqual(rows, [
      [null, null, null, null],
      [null, "low", null, null],
      [null, "high", null, null],
      [null, "bogus", null, null],
      ["m1", null, "m1", "high"],
      ["m1", "low", "m1", "low"],
      ["m1", "high", "m1", "high"],
      ["m1", "bogus", "m1", "high"],
      ["m2", null, "m2", null],
      ["m2", "low", "m2", null],
      ["m2", "high", "m2", null],
      ["m2", "bogus", "m2", null],
      ["m3", null, "m3", "medium"],
      ["m3", "low", "m3", "low"],
      ["m3", "high", "m3", "high"],
      ["m3", "bogus", "m3", "medium"],
    ]);
  });

  test("open providers shows the providers page and closes the overlay", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    w.menu.openProviders();
    assert.deepEqual(kinds(w.log), ["run", "setShared", "closeOverlay", "closeOverlay"]);
    assert.deepEqual(w.log[0], [
      "run",
      "layout.select",
      { stack: "main", child: "main-providers" },
    ]);
  });

  test("open style file opens the named style in an editor tab", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    w.menu.openStyleFile("mine");
    assert.deepEqual(runs(w.log), [
      ["run", "tab.new", { mod: "orca-files", props: { file: `${GOLDEN_STYLE_DIR}/mine.md` } }],
    ]);
  });

  test("an effort that is set to an empty string saves a variant file once, and a null effort saves nothing", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    w.menu.effort = "";
    await w.menu.rememberVariant();
    w.menu.effort = null;
    await w.menu.rememberVariant();
    await settle(w);
    assert.deepEqual(writesTo(w.log, MODEL_VARIANT), [
      ["write", MODEL_VARIANT, '{\n  "variant": {}\n}\n', "<none>"],
    ]);
  });

  test("refresh with no models shows the error and keeps the flyout usable", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    w.menu.listModels = async () => [];
    w.menu.refresh(w.cx);
    await settle(w);
    assert.equal(w.menu.error, "Could not list models: no models available");
    assert.equal(w.menu.refreshing, false);
  });

  test("resetPreset restores the codex preset", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    w.menu.resetPreset(w.cx);
    await settle(w);
    assert.deepEqual(w.menu.values, { fast: false, codexOff: [], model: "m3", effort: "low" });
    assert.deepEqual(kinds(w.log), ["notify", "write"]);
  });

  test("hidden models toggle on and off, and the saved list follows", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    w.menu.toggleHidden("m1");
    w.menu.toggleHidden("m1");
    w.menu.toggleHidden("m1");
    w.menu.remember();
    await settle(w);
    assert.deepEqual([...w.menu.hidden], []);
    assert.deepEqual(parsed(w.files.get(SETTINGS)).codex?.hidden, []);
  });

  test("set provider walks the saved providers and lands on a plain one with its model", async () => {
    const w = await opened(world("codex, fresh cache, providers, saved choices"));
    for (const id of ["omlx", "omlx", "none", "gone", "plain"]) {
      w.menu.setProvider(id, w.cx);
      await settle(w);
    }
    assert.equal(w.menu.providerId, "plain");
    assert.equal(w.menu.values.model, "pm2");
  });
});

describe("codex launch-now flyouts", () => {
  test("launch now with a fresh cache opens the terminal, closes both overlays, then saves", async () => {
    const w = await initialized(world("codex, fresh cache, launch now"));
    const order = kinds(w.log);
    const tab = order.indexOf("run");
    assert.ok(tab >= 0);
    assert.equal(order[tab + 1], "setShared");
    assert.deepEqual(order.slice(tab + 2, tab + 4), ["closeOverlay", "closeOverlay"]);
    assert.deepEqual(w.log[tab + 2], ["closeOverlay", "ov"]);
    assert.deepEqual(w.log[tab + 3], ["closeOverlay", "menu"]);
    assert.equal(order[tab + 4], "write");
  });

  test("launch now in a manager that disables the agent shows the reason and opens nothing", async () => {
    const w = await initialized(world("codex, launch now but disabled in the manager"));
    assert.equal(w.menu.error, "codex is disabled in Agent Settings.");
    assert.equal(w.menu.launching, false);
    assert.equal(runs(w.log).length, 0);
  });

  test("launch now after a catalog change closes the menu overlay", async () => {
    const w = await initialized(world("codex, stale cache, same list, version fails"));
    const closeMenu = w.log.findIndex(
      (entry) => entry[0] === "closeOverlay" && entry[1] === "menu",
    );
    assert.ok(closeMenu >= 0);
  });
});

describe("claude with styles and editors", () => {
  test("a new output style writes the claude preset, opens its file and refreshes the list", async () => {
    const w = await opened(world("claude, styles and editors"));
    w.menu.naming = true;
    setRaw(w.menu.styleInput, "fresh");
    w.menu.createStyle(w.cx);
    await settle(w);
    assert.equal(w.menu.values.outputStyle, "fresh");
    assert.equal(w.menu.naming, false);
    assert.deepEqual(kinds(w.log), ["set_value", "notify", "run", "write", "exec", "notify"]);
    assert.deepEqual(runs(w.log), [
      ["run", "tab.new", { mod: "orca-files", props: { file: `${GOLDEN_STYLE_DIR}/fresh.md` } }],
    ]);
  });

  test("picking a saved style sets it and writes the settings", async () => {
    const w = await opened(world("claude, styles and editors"));
    w.menu.pickChoice("outputStyle", "Explanatory", w.cx);
    await settle(w);
    assert.equal(w.menu.values.outputStyle, "Explanatory");
    assert.deepEqual(kinds(w.log), ["notify", "write"]);
  });

  test("saving an invalid editor keeps the last valid text and reports the error on that editor", async () => {
    const w = await opened(world("claude, styles and editors"));
    for (const [id, editor] of Object.entries(w.menu.editors))
      for (const raw of ['{"a":1}', "{bad", "plain"]) {
        setRaw(editor.input, raw);
        w.menu.saveEditor(id, w.cx);
      }
    await settle(w);
    assert.equal(w.menu.values.agents, '{\n  "a": 1\n}');
    assert.ok(w.menu.editors.agents?.error);
    assert.equal(w.menu.values.systemPrompt, "plain");
    assert.equal(w.menu.editors.systemPrompt?.error, null);
  });

  test("reset preset restores the claude defaults", async () => {
    const w = await opened(world("claude, styles and editors"));
    w.menu.resetPreset(w.cx);
    await settle(w);
    assert.equal(w.menu.values.outputStyle, "default");
    assert.equal(w.menu.values.advisorModel, "opus");
    assert.deepEqual(kinds(w.log).slice(-2), ["notify", "write"]);
  });

  test("launching claude runs the tab, closes both overlays, and saves the choices", async () => {
    const w = await opened(world("claude, styles and editors"));
    await w.menu.launch(w.cx);
    await settle(w);
    assert.deepEqual(kinds(w.log).slice(0, 4), [
      "run",
      "setShared",
      "closeOverlay",
      "closeOverlay",
    ]);
    assert.equal(runs(w.log)[0]?.[1], "tab.new");
  });
});

test("the catalog fallback error is what the person reads when the CLI cannot list models", async () => {
  const w = await initialized(world("codex, old schema, cli fails"));
  assert.equal(w.menu.error, "Could not list models: offline");
});
