import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vite-plus/test";
import { InputState } from "gpui-base";
import NewMenu from "../../../src/mods/orca-tab-dropdown/main.js";
import type { AgentRow } from "../../../src/mods/orca-tab-dropdown/rows.js";

type Calls = [string, unknown[]][];
type Built = { name: string; args: unknown[]; calls: Calls };
type Listener = (...args: unknown[]) => unknown;
type OverlaySpec = {
  mod: string;
  kind: string;
  width: number;
  at: unknown;
  props: Record<string, unknown>;
};
type SpaceRow = { id: string; active: boolean; folder?: string; machine: string | null };
type Globals = typeof globalThis & {
  __herdrShared?: (key: string) => unknown;
  __herdrSetShared?: (key: string, value: unknown) => void;
  __herdrSpaces?: () => SpaceRow[];
  __herdrRun?: (...args: unknown[]) => void;
  __herdrReadTextFile?: (path: string) => Promise<string | null>;
  __herdrChecking?: () => boolean;
  __herdrExec?: (command: string, args?: string[]) => Promise<{ code: number; stdout?: string }>;
  __herdrProps?: () => unknown;
  __herdrOpenOverlay?: (spec: OverlaySpec) => string;
  __herdrCloseOverlay?: (id?: string) => void;
  __herdrWindow?: () => { platform: "linux" | "macos" } | null;
};

const builder = vi.hoisted(() => {
  const calls = new WeakMap<object, [string, unknown[]][]>();
  function make(name: string, ...args: unknown[]) {
    const recorded: [string, unknown[]][] = [];
    const record = { name, args };
    const proxy = new Proxy(record, {
      get(target, key: string | symbol) {
        if (typeof key === "symbol" || key === "toJSON") return undefined;
        if (key in target) return target[key as keyof typeof target];
        return (...values: unknown[]) => {
          if (key === "when") {
            if (values[0]) (values[1] as (value: object) => unknown)(proxy);
          } else if (key === "hover") {
            (values[0] as (value: object) => unknown)(make("hover"));
          } else {
            recorded.push([key, values]);
          }
          return proxy;
        };
      },
    });
    calls.set(proxy, recorded);
    return proxy;
  }
  return { calls, make };
});

const host = vi.hoisted(() => ({
  known: [] as AgentRow[],
  knownError: null as Error | null,
  keys: [] as Array<{ section: string; action: string; keys: string }>,
  text: "",
  inputHandlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock("gpui-kit", () => ({
  View: class {},
  div: () => builder.make("div"),
  svg: (path: string) => builder.make("svg", path),
  image: (path: string) => builder.make("image", path),
}));

vi.mock("gpui-base", () => ({
  v_flex: () => builder.make("v_flex"),
  h_flex: () => builder.make("h_flex"),
  Input: { new: (state: object) => builder.make("Input", state) },
  HoverCard: { new: (id: string) => builder.make("HoverCard", id) },
  InputState: {
    new: () => ({
      value: () => host.text,
      set_value(value: string) {
        host.text = value;
      },
      focus() {},
      on(name: string, handler: (...args: unknown[]) => unknown) {
        host.inputHandlers.set(name, handler);
      },
    }),
  },
}));

vi.mock("herdr", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    knownAgents: async () => {
      if (host.knownError) throw host.knownError;
      return host.known;
    },
    keys: () => host.keys,
  };
});

const globals = globalThis as Globals;
const FLYOUT_KEY = "orca-agent-flyout";
const MODELS_KEY = "new-menu.models.v1";
const T = {} as never;

const claude: AgentRow = { key: "claude", name: "Claude", installed: true, run: ["claude"] };
const gemini: AgentRow = { key: "gemini", name: "Gemini", installed: true, run: ["gemini"] };
const omp: AgentRow = { key: "omp", name: "Omp", installed: true, run: ["omp"] };
const trackEvent = {
  position: { x: 100, y: 50 },
  local_position: { x: 10, y: 5 },
  bounds: { width: 200, height: 40 },
};

const sharedValues = new Map<string, unknown>();
const runs: unknown[][] = [];
const overlays: OverlaySpec[] = [];
const closedOverlays: Array<string | undefined> = [];
let propsValue: unknown = {};
let spaceList: SpaceRow[] = [];
let notifications = 0;

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    failRead: false,
    failWrite: false,
    getItem(key: string): string | null {
      if (this.failRead) throw new Error("storage unavailable");
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (this.failWrite) throw new Error("quota exceeded");
      data.set(key, value);
    },
  };
}
let storage = memoryStorage();

beforeEach(() => {
  host.known = [];
  host.knownError = null;
  host.keys = [];
  host.text = "";
  host.inputHandlers.clear();
  sharedValues.clear();
  runs.length = 0;
  overlays.length = 0;
  closedOverlays.length = 0;
  propsValue = {};
  spaceList = [{ id: "s", active: true, folder: "/repo", machine: null }];
  notifications = 0;
  storage = memoryStorage();
  vi.stubGlobal("localStorage", storage);
  globals.__herdrShared = (key) => sharedValues.get(key);
  globals.__herdrSetShared = (key, value) => {
    sharedValues.set(key, value);
  };
  globals.__herdrSpaces = () => spaceList;
  globals.__herdrRun = (...args) => {
    runs.push(args);
  };
  globals.__herdrReadTextFile = async () => null;
  globals.__herdrChecking = () => true;
  globals.__herdrExec = async () => {
    throw new Error("no program");
  };
  globals.__herdrWindow = () => ({ platform: "linux" });
  globals.__herdrProps = () => propsValue;
  globals.__herdrOpenOverlay = (spec) => {
    overlays.push(spec);
    return `ov-${overlays.length}`;
  };
  globals.__herdrCloseOverlay = (id) => {
    closedOverlays.push(id);
  };
  Reflect.deleteProperty(globalThis, "window");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function context() {
  const jobs: Array<(cx: unknown) => unknown> = [];
  const cx = {
    focus_handle: () => ({ focus() {} }),
    spawn: (job: (cx: unknown) => unknown) => {
      jobs.push(job);
    },
    notify() {
      notifications += 1;
    },
    stop_propagation() {},
    timer: { after: (_ms: number, fn: () => void) => fn() },
  };
  return { cx, jobs };
}

function readyMenu(agents: AgentRow[] | null): NewMenu {
  const menu = new NewMenu();
  menu.agents = agents;
  menu.disabledReady = true;
  menu.herdrEnvReady = true;
  menu.handle = { focus() {} } as never;
  menu.input = InputState.new({ placeholder: "" });
  return menu;
}

function tree(value: unknown): Built[] {
  if (Array.isArray(value)) return value.flatMap((item) => tree(item));
  if (!value || typeof value !== "object") return [];
  const calls = builder.calls.get(value);
  if (!calls) return [];
  const { name, args } = value as { name: string; args: unknown[] };
  return [
    { name, args, calls },
    ...calls.flatMap(([, values]) => values.flatMap((item) => tree(item))),
  ];
}

function palette(menu: NewMenu): Built[] {
  return tree(menu.render());
}

function byId(nodes: Built[], id: string): Built {
  const hit = nodes.find((node) =>
    node.calls.some(([name, args]) => name === "id" && args[0] === id),
  );
  assert.ok(hit, `no element ${id}`);
  return hit;
}

function byLabel(nodes: Built[], label: string): Built {
  const hit = nodes.find((node) =>
    node.calls.some(([name, args]) => name === "accessibility_label" && args[0] === label),
  );
  assert.ok(hit, `no element labelled ${label}`);
  return hit;
}

function listener<T extends Listener>(node: Built, name: string): T {
  const hit = node.calls.find(([key]) => key === name);
  assert.ok(hit, `no ${name} on ${node.name}`);
  return hit[1][0] as T;
}

function opacityOf(node: Built): unknown {
  return node.calls.find(([name]) => name === "opacity")?.[1][0];
}

function labels(menu: NewMenu): string[] {
  return menu.list().map((row) => row.label);
}

function texts(nodes: Built[]): string[] {
  return nodes.flatMap((node) =>
    node.calls
      .filter(([name]) => name === "child")
      .map(([, args]) => args[0])
      .filter((arg): arg is string => typeof arg === "string"),
  );
}

function iconSources(nodes: Built[]): Array<[string, unknown]> {
  return nodes
    .filter((node) => node.name === "svg" || node.name === "image")
    .map((node) => [node.name, node.args[0]]);
}

function probeAnswers(stdout: string): void {
  globals.__herdrExec = async (command) => {
    if (command !== "omp") throw new Error(`missing ${command}`);
    return { code: 0, stdout };
  };
}

function hintFor(keys: string, platform: "linux" | "macos" = "linux"): string {
  host.keys = [{ section: "global", action: "orca-header.new-tab", keys }];
  globals.__herdrWindow = () => ({ platform });
  return new NewMenu().createRows()[0].hint ?? "";
}

test("a corrupt manager file keeps every agent enabled, and a remote machine ignores the local disabled list", async () => {
  const menu = readyMenu([]);
  globals.__herdrReadTextFile = async () => "{nope";
  await menu.loadManager(context().cx as never);
  assert.equal(menu.disabled.size, 0);
  assert.equal(menu.herdrEnv, true);
  assert.equal(menu.disabledReady, true);
  globals.__herdrReadTextFile = async () => '{"disabled":["codex",7],"herdrEnv":false}';
  await menu.loadManager(context().cx as never);
  assert.deepEqual([...menu.disabled], ["codex"]);
  assert.equal(menu.herdrEnv, false);
  menu.machine = "box";
  await menu.loadManager(context().cx as never);
  assert.equal(menu.disabled.size, 0);
});

test("a fresh cached model list skips the probe, a stale one is probed, and an unreadable cache is probed too", async () => {
  const { cx, jobs } = context();
  storage.data.set(
    MODELS_KEY,
    JSON.stringify({ omp: { at: Date.now(), models: [{ id: "a/b", label: "A B" }] } }),
  );
  const fresh = readyMenu([]);
  fresh.pickModel(omp, cx as never);
  assert.deepEqual(fresh.models, [{ id: "a/b", label: "A B" }]);
  assert.equal(jobs.length, 0);
  storage.data.set(
    MODELS_KEY,
    JSON.stringify({ omp: { at: Date.now() - 600_001, models: [{ id: "a/b", label: "A B" }] } }),
  );
  const stale = readyMenu([]);
  stale.pickModel(omp, cx as never);
  assert.equal(stale.models, null);
  assert.equal(jobs.length, 1);
  await jobs[0](cx);
  assert.equal(stale.modelsFailed, true);
  assert.equal(stale.models, null);
  storage.failRead = true;
  const unreadable = readyMenu([]);
  unreadable.pickModel(omp, cx as never);
  assert.equal(unreadable.models, null);
  assert.equal(jobs.length, 2);
});

test("a successful probe fills the picker and is remembered for later, unless the picker has moved on", async () => {
  probeAnswers('{"models":[{"selector":"p/m","name":"P M"}]}');
  storage.data.set(MODELS_KEY, JSON.stringify({ other: { at: Date.now(), models: [] } }));
  const { cx, jobs } = context();
  const menu = readyMenu([]);
  menu.pickModel(omp, cx as never);
  await jobs[0](cx);
  assert.deepEqual(menu.models, [{ id: "p/m", label: "P M" }]);
  assert.equal(menu.modelsFailed, false);
  const saved = JSON.parse(storage.data.get(MODELS_KEY) ?? "{}") as Record<
    string,
    { models: unknown }
  >;
  assert.deepEqual(saved.omp.models, [{ id: "p/m", label: "P M" }]);
  assert.ok(saved.other);
  storage.data.clear();
  const moved = context();
  const away = readyMenu([]);
  away.pickModel(omp, moved.cx as never);
  away.picking = gemini;
  await moved.jobs[0](moved.cx);
  assert.equal(away.models, null);
  assert.equal(away.modelsFailed, false);
  assert.ok(storage.data.has(MODELS_KEY));
});

test("an unreadable or unwritable model cache does not stop a probed list from showing", async () => {
  probeAnswers('{"models":[{"selector":"p/m","name":"P M"}]}');
  storage.failRead = true;
  storage.failWrite = true;
  const { cx, jobs } = context();
  const menu = readyMenu([]);
  menu.pickModel(omp, cx as never);
  assert.equal(jobs.length, 1);
  await jobs[0](cx);
  assert.deepEqual(menu.models, [{ id: "p/m", label: "P M" }]);
});

test("a failed catalog probe marks the active machine failed and keeps its last known agents", async () => {
  host.knownError = new Error("unreachable");
  const { cx } = context();
  const menu = readyMenu(null);
  menu.machine = "box";
  await menu.refreshCatalog(cx as never, {
    machine: "box",
    key: "box",
    inventory: null,
    cached: [claude],
  });
  assert.equal(menu.agentsFailed, true);
  assert.deepEqual(menu.agents, [claude]);
  assert.equal(notifications, 1);
  const elsewhere = readyMenu(null);
  elsewhere.machine = "elsewhere";
  await elsewhere.refreshCatalog(cx as never, {
    machine: "box",
    key: "box",
    inventory: { agents: [gemini] },
    cached: undefined,
  });
  assert.equal(elsewhere.agentsFailed, false);
  assert.equal(elsewhere.agents, null);
  assert.equal(notifications, 1);
});

test("local runs come from programs.json only for agents with a valid override", async () => {
  const menu = readyMenu([]);
  globals.__herdrReadTextFile = async () =>
    '{"programs":{"claude":{"run":["/opt/claude"]},"codex":{"run":["bad",3]}}}';
  assert.deepEqual(
    await menu.withLocalRuns([claude, { key: "codex", run: ["codex"] }, { key: "gemini" }]),
    [{ ...claude, run: ["/opt/claude"] }, { key: "codex", run: ["codex"] }, { key: "gemini" }],
  );
  globals.__herdrReadTextFile = async () => "{broken";
  assert.deepEqual(await menu.withLocalRuns([claude]), [claude]);
  globals.__herdrReadTextFile = async () => null;
  assert.deepEqual(await menu.withLocalRuns(null), []);
});

test("New Terminal opens a tab in the active space, in its folder when it has one", () => {
  const menu = new NewMenu();
  menu.createRows()[0].run?.();
  spaceList = [{ id: "t", active: true, folder: "", machine: null }];
  menu.createRows()[0].run?.();
  spaceList = [];
  menu.createRows()[0].run?.();
  assert.deepEqual(runs, [
    ["tab.new", { space: "s", folder: "/repo" }],
    ["tab.new", { space: "t" }],
    ["tab.new", {}],
  ]);
});

test("the New Terminal hint spells each shortcut for the host platform", () => {
  assert.equal(hintFor("ctrl-shift-t"), "Ctrl+Shift+T");
  assert.equal(hintFor("ctrl-shift-t", "macos"), "⌃⇧T");
  assert.equal(hintFor("secondary-n"), "Ctrl+N");
  assert.equal(hintFor("secondary-n", "macos"), "⌘N");
  assert.equal(hintFor("super-x"), "Super+X");
  assert.equal(hintFor("win-x", "macos"), "⌘X");
  assert.equal(hintFor("ctrl-A"), "Ctrl+Shift+A");
  assert.equal(hintFor("cmd--"), "Super+-");
  assert.equal(hintFor("cmd--", "macos"), "⌘-");
  assert.equal(hintFor("ctrl-enter"), "Ctrl+Enter");
  assert.equal(hintFor("ctrl-k ctrl-j", "macos"), "⌃K ⌃J");
  assert.equal(hintFor("   "), "");
  host.keys = [];
  assert.equal(new NewMenu().createRows()[0].hint, "");
});

test("hovering New Terminal shows its tip with the shortcut as keycaps, and leaving hides it", () => {
  const { cx } = context();
  host.keys = [{ section: "global", action: "orca-header.new-tab", keys: "ctrl-shift-t" }];
  const menu = readyMenu([]);
  listener<Listener>(byId(palette(menu), "new-0"), "on_hover")(true, cx);
  assert.equal(menu.tipHot, "new-terminal");
  const shown = texts(palette(menu));
  assert.ok(shown.includes("New Terminal"));
  assert.ok(shown.includes("Ctrl"));
  assert.ok(shown.includes("Shift"));
  assert.ok(shown.includes("T"));
  globals.__herdrWindow = () => ({ platform: "macos" });
  assert.ok(texts(palette(menu)).includes("⇧"));
  listener<Listener>(byId(palette(menu), "new-0"), "on_hover")(false, cx);
  assert.equal(menu.tipHot, null);
  assert.equal(texts(palette(menu)).includes("New Terminal"), false);
});

test("FreeBuff appears only when detected and launches its configured command, and Agent Settings opens the agents layout", () => {
  const menu = readyMenu([]);
  menu.freebuff = true;
  menu.agents = [{ key: "freebuff", run: ["/opt/freebuff"] }];
  assert.deepEqual(labels(menu), ["New Terminal", "FreeBuff CLI", "Agent Settings"]);
  menu.agentRows()[0].run?.();
  menu.agentRows()[1].run?.();
  assert.deepEqual(runs, [
    ["tab.new", { space: "s", folder: "/repo", argv: ["env", "HERDR_ENV=1", "/opt/freebuff"] }],
    ["layout.select", { stack: "main", child: "main-agents" }],
  ]);
  menu.freebuff = false;
  assert.deepEqual(
    menu.agentRows().map((row) => row.label),
    ["Agent Settings"],
  );
});

test("agent icons: tinted program icons are svg, plain ones images, and each palette button names its own asset", () => {
  const menu = readyMenu([
    { ...claude, icon: "claude.svg", tint: true },
    { ...gemini, icon: "gemini.png" },
  ]);
  menu.freebuff = true;
  assert.deepEqual(iconSources(palette(menu)), [
    ["svg", "mods/orca-assets/square-terminal--orca-agent-flyout.svg"],
    ["svg", "claude.svg"],
    ["image", "gemini.png"],
    ["image", "mods/orca-assets/freebuff--orca-tab-dropdown.png"],
    ["svg", "mods/orca-assets/bot.svg"],
  ]);
});

test("with more agents than fit, the bar pages with its arrows and the wheel, and clamps at both ends", () => {
  const { cx } = context();
  const menu = readyMenu(
    ["claude", "codex", "pi", "opencode", "cursor"].map((key) => ({
      key,
      name: key,
      installed: true,
      run: [key],
    })),
  );
  const bar = tree(menu.agentBar(T));
  const previous = byLabel(bar, "Previous agents");
  const next = byLabel(bar, "More agents");
  assert.equal(opacityOf(previous), 0.35);
  assert.equal(
    previous.calls.some(([name]) => name === "on_click"),
    false,
  );
  listener<Listener>(next, "on_click")({}, cx);
  assert.equal(menu.agentAt, 1);
  listener<Listener>(next, "on_click")({}, cx);
  assert.equal(menu.agentAt, 1);
  assert.equal(opacityOf(byLabel(tree(menu.agentBar(T)), "More agents")), 0.35);
  assert.equal(opacityOf(byLabel(tree(menu.agentBar(T)), "Previous agents")), 1);
  const wheel = listener<Listener>(bar[0], "on_scroll_wheel");
  wheel({ delta: { y: -1 } }, cx);
  assert.equal(menu.agentAt, 0);
  wheel({ delta: { y: 0 } }, cx);
  assert.equal(menu.agentAt, 0);
  wheel({ delta: { y: 1 } }, cx);
  wheel({ delta: { y: 1 } }, cx);
  assert.equal(menu.agentAt, 1);
});

test("hovering an arrow closes an open agent flyout and forgets the hovered agent", () => {
  const { cx } = context();
  const menu = readyMenu([
    claude,
    gemini,
    omp,
    { key: "codex", installed: true },
    { key: "pi", installed: true },
  ]);
  sharedValues.set(FLYOUT_KEY, { id: "ov-3", key: "claude" });
  menu.hoverAgent = claude;
  const next = byLabel(tree(menu.agentBar(T)), "More agents");
  listener<Listener>(next, "on_hover")(false, cx);
  assert.equal(menu.hoverAgent, claude);
  listener<Listener>(next, "on_hover")(true, cx);
  assert.equal(menu.hoverAgent, null);
  assert.deepEqual(closedOverlays, ["ov-3"]);
  assert.equal(sharedValues.get(FLYOUT_KEY), null);
});

test("moving onto a configurable agent opens its flyout beside the bar, and moving onto a plain button closes it", () => {
  const { cx } = context();
  const menu = readyMenu([claude]);
  const bar = tree(menu.agentBar(T));
  listener<Listener>(bar[0], "on_mouse_move")(trackEvent);
  assert.deepEqual(menu.menuEdge, { left: 90, right: 290, bottom: 91 });
  assert.equal(overlays.length, 0);
  listener<Listener>(byId(bar, "new-1"), "on_mouse_move")(
    { local_position: { x: 1, y: 1 }, bounds: { width: 36, height: 36 } },
    cx,
  );
  assert.equal(menu.hoverAgent, claude);
  assert.deepEqual(overlays, [
    {
      mod: "orca-agent-flyout",
      kind: "popup",
      width: 480,
      at: { x: 8, y: 97 },
      props: {
        menu: undefined,
        space: "s",
        name: "Claude",
        key: "claude",
        argv: ["claude"],
        icon: undefined,
        tint: undefined,
        launchNow: false,
      },
    },
  ]);
  assert.deepEqual(sharedValues.get(FLYOUT_KEY), { id: "ov-1", key: "claude" });
  const settings = listener<Listener>(byId(bar, "new-2"), "on_mouse_move");
  settings({}, cx);
  assert.equal(menu.hoverAgent, claude);
  assert.equal(menu.at, 1);
  settings({ local_position: { x: 1, y: 1 }, bounds: { width: 36, height: 36 } }, cx);
  assert.equal(menu.hoverAgent, null);
  assert.deepEqual(closedOverlays, ["ov-1"]);
  assert.equal(sharedValues.get(FLYOUT_KEY), null);
  assert.equal(menu.at, 2);
});

test("pointer moves without geometry leave the menu edge unset", () => {
  const menu = readyMenu([claude]);
  const bar = tree(menu.agentBar(T));
  listener<Listener>(bar[0], "on_mouse_move")({ position: { x: 1, y: 1 }, bounds: undefined });
  listener<Listener>(
    bar[0],
    "on_mouse_move",
  )({
    position: { x: 1, y: 1 },
    local_position: { x: 0, y: 0 },
  });
  assert.equal(menu.menuEdge, null);
});

test("a click on a configurable agent closes the menu and opens its flyout in launch mode, only when it is installed here", () => {
  const { cx } = context();
  propsValue = { overlay: "menu-ov" };
  const menu = readyMenu([claude]);
  listener<Listener>(byId(tree(menu.agentBar(T)), "new-1"), "on_click")({}, cx);
  assert.deepEqual(closedOverlays, ["menu-ov"]);
  assert.equal(overlays.length, 1);
  assert.equal(overlays[0].props.launchNow, true);
  assert.equal(overlays[0].props.key, "claude");
  readyMenu([{ ...claude, installed: false }]).launchConfigured(claude);
  new NewMenu().launchConfigured(claude);
  spaceList = [{ id: "s", active: true, machine: "box", folder: "/repo" }];
  readyMenu([claude]).launchConfigured(claude);
  assert.equal(overlays.length, 1);
});

test("a flyout for the same agent is not reopened on hover, and another agent's flyout replaces it", () => {
  sharedValues.set(FLYOUT_KEY, { id: "ov-7", key: "claude" });
  const menu = readyMenu([claude, gemini]);
  menu.hoverConfig(claude, false);
  menu.hoverConfig(claude, true);
  assert.equal(overlays.length, 0);
  assert.deepEqual(closedOverlays, []);
  menu.hoverConfig(claude, true, true);
  assert.deepEqual(closedOverlays, ["ov-7"]);
  assert.equal(overlays.length, 1);
  assert.equal(overlays[0].props.launchNow, true);
  assert.deepEqual(sharedValues.get(FLYOUT_KEY), { id: "ov-1", key: "claude" });
  menu.hoverConfig(gemini, true);
  assert.deepEqual(closedOverlays, ["ov-7", "ov-1"]);
  assert.equal(overlays.length, 2);
  assert.equal(overlays[1].props.key, "gemini");
  assert.deepEqual(sharedValues.get(FLYOUT_KEY), { id: "ov-2", key: "gemini" });
});

test("closing the flyout or the menu removes their overlays and clears the flyout record", () => {
  propsValue = { overlay: "menu-ov" };
  const menu = readyMenu([]);
  menu.closeFlyout();
  assert.deepEqual(closedOverlays, []);
  assert.equal(sharedValues.has(FLYOUT_KEY), false);
  sharedValues.set(FLYOUT_KEY, { id: "ov-4" });
  menu.closeFlyout();
  assert.deepEqual(closedOverlays, ["ov-4"]);
  assert.equal(sharedValues.get(FLYOUT_KEY), null);
  sharedValues.set(FLYOUT_KEY, { key: "codex" });
  menu.closeMenu();
  assert.deepEqual(closedOverlays, ["ov-4", "menu-ov"]);
  assert.equal(sharedValues.get(FLYOUT_KEY), null);
});

test("the palette's keys and wheel move its highlight, other keys do nothing, and Escape closes the menu", () => {
  const { cx } = context();
  propsValue = { overlay: "menu-ov" };
  const menu = readyMenu([claude, gemini]);
  const root = palette(menu)[0];
  const press = (key: string) => listener<Listener>(root, "on_key_down")({ key }, cx);
  press("down");
  assert.equal(menu.at, 1);
  press("end");
  assert.equal(menu.at, 3);
  press("up");
  assert.equal(menu.at, 2);
  press("home");
  assert.equal(menu.at, 0);
  press("right");
  assert.equal(menu.at, 1);
  press("left");
  assert.equal(menu.at, 0);
  const before = notifications;
  press("q");
  assert.equal(menu.at, 0);
  assert.equal(notifications, before);
  listener<Listener>(root, "on_scroll_wheel")({ delta: { y: 1 } }, cx);
  assert.equal(menu.at, 1);
  listener<Listener>(root, "on_scroll_wheel")({ delta: { y: 0 } }, cx);
  assert.equal(menu.at, 1);
  listener<Listener>(root, "on_scroll_wheel")({ delta: { y: -1 } }, cx);
  assert.equal(menu.at, 0);
  press("escape");
  assert.deepEqual(closedOverlays, ["menu-ov"]);
  assert.equal(menu.picking, null);
});

test("in the model picker, keys move through the models, Enter launches the highlighted one, and Escape goes back", () => {
  const { cx } = context();
  const menu = readyMenu([gemini]);
  menu.at = 2;
  menu.pickModel(gemini, cx as never);
  const picker = palette(menu)[0];
  const press = (key: string) => listener<Listener>(picker, "on_key_down")({ key }, cx);
  press("end");
  assert.equal(menu.at, 4);
  press("down");
  assert.equal(menu.at, 0);
  press("up");
  assert.equal(menu.at, 4);
  press("home");
  assert.equal(menu.at, 0);
  press("down");
  press("enter");
  assert.deepEqual(runs, [
    [
      "tab.new",
      {
        space: "s",
        folder: "/repo",
        argv: ["env", "HERDR_ENV=1", "gemini", "-m", "gemini-3-pro-preview"],
      },
    ],
  ]);
  press("escape");
  assert.equal(menu.picking, null);
  assert.equal(menu.at, 2);
});

test("the model picker lists Default first, filters by label or id, and says why a list is empty", () => {
  const { cx } = context();
  const menu = readyMenu([gemini]);
  menu.pickModel(gemini, cx as never);
  assert.deepEqual(labels(menu), [
    "Default",
    "Gemini 3 Pro Preview",
    "Gemini 3 Flash Preview",
    "Gemini 2.5 Pro",
    "Gemini 2.5 Flash",
  ]);
  menu.filter = " 2.5 ";
  assert.deepEqual(labels(menu), ["Default", "Gemini 2.5 Pro", "Gemini 2.5 Flash"]);
  menu.filter = "zzz";
  assert.deepEqual(labels(menu), ["Default", "No models match"]);
  const probing = readyMenu([omp]);
  probing.pickModel(omp, cx as never);
  assert.deepEqual(labels(probing), ["Default", "Asking the agent…"]);
  probing.modelsFailed = true;
  assert.deepEqual(labels(probing), ["Default", "Could not list its models"]);
  probing.models = [];
  assert.deepEqual(labels(probing), ["Default", "No models listed"]);
  probing.models = [{ id: "x/y", label: "X Y" }];
  assert.deepEqual(labels(probing), ["Default", "X Y"]);
  assert.equal(probing.list()[1].hint, "x/y");
});

test("Enter on a disabled row does nothing, and the highlight never lands on a disabled row", () => {
  const { cx } = context();
  const menu = readyMenu([omp]);
  menu.pickModel(omp, cx as never);
  menu.models = [];
  assert.deepEqual(labels(menu), ["Default", "No models listed"]);
  menu.at = 1;
  listener<Listener>(palette(menu)[0], "on_key_down")({ key: "enter" }, cx);
  assert.deepEqual(runs, []);
  assert.equal(menu.picking?.key, "omp");
  menu.at = 0;
  menu.move(1);
  assert.equal(menu.at, 0);
  menu.edge(true);
  assert.equal(menu.at, 0);
  menu.edge(false);
  assert.equal(menu.at, 0);
});

test("clicking an agent with a fixed model list opens its model picker in place", () => {
  const { cx } = context();
  const menu = readyMenu([claude, gemini]);
  listener<Listener>(byId(tree(menu.agentBar(T)), "new-2"), "on_click")({}, cx);
  assert.equal(menu.picking?.key, "gemini");
  assert.equal(notifications, 1);
  assert.deepEqual(labels(menu), [
    "Default",
    "Gemini 3 Pro Preview",
    "Gemini 3 Flash Preview",
    "Gemini 2.5 Pro",
    "Gemini 2.5 Flash",
  ]);
  assert.deepEqual(runs, []);
});

test("the picker's wheel moves its highlight, hovering a model row highlights it, and its Back row returns", () => {
  const { cx } = context();
  const menu = readyMenu([gemini]);
  menu.pickModel(gemini, cx as never);
  const nodes = palette(menu);
  listener<Listener>(nodes[0], "on_scroll_wheel")({ delta: { y: 1 } }, cx);
  assert.equal(menu.at, 1);
  listener<Listener>(nodes[0], "on_scroll_wheel")({ delta: { y: 0 } }, cx);
  assert.equal(menu.at, 1);
  listener<Listener>(byId(nodes, "new-3"), "on_hover")(true, cx);
  assert.equal(menu.at, 3);
  listener<Listener>(byId(nodes, "new-3"), "on_hover")(true, cx);
  assert.equal(menu.at, 3);
  listener<Listener>(byId(nodes, "new--1"), "on_click")({}, cx);
  assert.equal(menu.picking, null);
  assert.equal(menu.at, 0);
});

test("typing in the search box filters the list and resets the highlight, and Enter runs the highlighted row", async () => {
  const { cx, jobs } = context();
  const menu = new NewMenu();
  menu.init({}, cx as never);
  for (const job of jobs) await job(cx);
  const change = host.inputHandlers.get("change");
  const submit = host.inputHandlers.get("submit");
  assert.ok(change && submit);
  menu.at = 2;
  host.text = "Gem";
  change({}, cx);
  assert.equal(menu.filter, "Gem");
  assert.equal(menu.at, 0);
  submit({}, cx);
  assert.deepEqual(runs, [["tab.new", { space: "s", folder: "/repo" }]]);
});

test("a configured FreeBuff agent is listed without an installed flag, and an unconfigured one still appears", () => {
  const menu = readyMenu([{ key: "freebuff", run: ["/opt/freebuff"] }]);
  menu.freebuff = true;
  assert.deepEqual(
    menu.agentRows().map((row) => row.label),
    ["FreeBuff CLI", "Agent Settings"],
  );
});
