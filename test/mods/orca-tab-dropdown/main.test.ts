import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vite-plus/test";
import NewMenu from "../../../src/mods/orca-tab-dropdown/main.ts";
import type { AgentRow } from "../../../src/mods/orca-tab-dropdown/rows.ts";

type Call = [string, unknown[]];
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
      value: () => "",
      set_value() {},
      focus() {},
      on() {
        return true;
      },
    }),
  },
}));
function collect(node: unknown): Call[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((item) => collect(item));
  const out = [...(builder.calls.get(node) ?? [])];
  for (const [, args] of builder.calls.get(node) ?? [])
    for (const arg of args) out.push(...collect(arg));
  return out;
}

const host = vi.hoisted(() => ({ known: [] as AgentRow[], keys: [] }));
vi.mock("herdr", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    knownAgents: async () => host.known,
    keys: () => host.keys,
    appHome: () => "/home",
    window: () => ({ platform: "linux" }),
  };
});

type TestHost = typeof globalThis & {
  __herdrShared?: (key: string) => unknown;
  __herdrSetShared?: (key: string, value: unknown) => void;
  __herdrSpaces?: () => unknown[];
  __herdrRun?: (...args: unknown[]) => void;
  __herdrReadTextFile?: (path: string) => Promise<string | null>;
  __herdrChecking?: () => boolean;
  __herdrExec?: (command: string) => Promise<{ code: number }>;
  window?: { viewport_size: () => { width: number; height: number } };
};
const globals = globalThis as TestHost;

beforeEach(() => {
  host.known = [];
  host.keys = [];
  globals.__herdrShared = undefined;
  globals.__herdrSetShared = undefined;
  globals.__herdrSpaces = () => [{ id: "s", active: true, folder: "/repo", machine: null }];
  globals.__herdrRun = undefined;
  globals.__herdrReadTextFile = undefined;
  globals.__herdrChecking = () => true;
  globals.__herdrExec = undefined;
});

function context() {
  const jobs: Array<(cx: unknown) => unknown> = [];
  const cx = {
    focus_handle: () => ({ focus() {} }),
    spawn: (job: (cx: unknown) => unknown) => {
      jobs.push(job);
    },
    notify() {},
    timer: { after: (_ms: number, fn: () => void) => fn() },
  };
  return { cx, jobs };
}

test("local inventory is ready after probes, managed commands launch only while enabled", async () => {
  const agent: AgentRow = { key: "kimi", installed: true, name: "Kimi", run: ["kimi", "--local"] };
  const inventory = { at: Date.now(), agents: [agent], disabled: [] as string[], freebuff: false };
  const shared = new Map<string, unknown>([["agent-manager.inventory", inventory]]);
  globals.__herdrShared = (key) => shared.get(key);
  globals.__herdrSpaces = () => [{ id: "s", active: true, folder: "/repo" }];
  globals.__herdrReadTextFile = async (path) =>
    path === "/home/agent-manager.json" ? '{"disabled":["codex"]}' : null;
  const calls: unknown[][] = [];
  globals.__herdrRun = (...args) => {
    calls.push(args);
  };
  globals.__herdrChecking = () => false;
  globals.__herdrExec = async (command) => ({ code: command === "zsh" ? 0 : 1 });
  host.known = [{ ...agent, installed: true }];
  const menu = new NewMenu();
  const { cx, jobs } = context();
  menu.init({}, cx as never);
  assert.deepEqual(menu.agentRows(), []);
  for (const task of jobs) await task(cx);
  assert.ok(menu.disabled.has("codex"));
  assert.deepEqual(
    menu.agentRows().map((row) => row.label),
    ["Kimi", "FreeBuff CLI", "Agent Settings"],
  );
  assert.match(
    JSON.stringify(collect(menu.render())),
    /orca-tab-dropdown[\s\S]*New Terminal[\s\S]*Agent Settings/,
  );
  const row = menu.agentRows()[0];
  row.run?.();
  inventory.disabled.push("kimi");
  row.run?.();
  assert.deepEqual(calls, [
    [
      "tab.new",
      { space: "s", folder: "/repo", argv: ["env", "HERDR_ENV=1", ...(agent.run ?? [])] },
    ],
  ]);
  globals.__herdrReadTextFile = async (path) =>
    path === "/home/programs.json" ? '{"programs":{"kimi":{"run":["override"]}}}' : null;
  assert.deepEqual(await menu.withLocalRuns([agent]), [{ ...agent, run: ["override"] }]);
});

test("flyout centers under the menu, then clamps to the viewport", () => {
  const menu = new NewMenu();
  const agent: AgentRow = { key: "codex" };
  assert.equal(menu.flyoutAt(agent), "pointer");
  for (const [width, left, right, bottom, x, y] of [
    [1200, 400, 600, 60, 260, 66],
    [900, 100, 200, 80, 8, 86],
    [700, 380, 480, 90, 190, 96],
    [350, 30, 140, 100, 8, 106],
  ]) {
    globals.window = { viewport_size: () => ({ width, height: 600 }) };
    menu.rowEdge = { key: "codex", left, right, bottom };
    assert.deepEqual(menu.flyoutAt(agent), { x, y });
  }
});
test("a stale local inventory drops back to the family catalog, and a fresh one supplies local run overrides", async () => {
  const known: AgentRow = { key: "codex", installed: false, run: ["codex"] };
  const fresh: AgentRow = { key: "codex", installed: true, run: ["/custom/codex"] };
  const inventory = { at: Date.now() - 121000, agents: [fresh], disabled: [] };
  globals.__herdrShared = (key) => (key === "agent-manager.inventory" ? inventory : undefined);
  globals.__herdrReadTextFile = async () => null;
  host.known = [known];
  const menu = new NewMenu();
  const { cx, jobs } = context();
  menu.init({}, cx as never);
  for (const job of jobs) await job(cx);
  assert.deepEqual(menu.currentState().agents, [known]);
  inventory.at = Date.now();
  assert.deepEqual(menu.currentState().agents, [
    { ...known, installed: true, run: ["/custom/codex"] },
  ]);
});

test("the picker lists model rows with a search filter and a Back row", () => {
  const menu = new NewMenu();
  menu.picking = { key: "gemini", name: "Gemini" };
  menu.filter = "flash";
  const rendered = JSON.stringify(collect(menu.render()));
  assert.match(rendered, /Gemini[\s\S]*Default[\s\S]*Gemini 3 Flash Preview[\s\S]*Back/);
  assert.doesNotMatch(rendered, /Gemini 3 Pro Preview/);
  menu.filter = "zzz";
  assert.match(JSON.stringify(collect(menu.render())), /No models match/);
});
