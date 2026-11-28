import {
  agentConfigRuntime,
  setAgentConfigRuntime,
  type AgentConfigHandler,
} from "../../support/agent-config-runtime.js";
import { recordedElement } from "../../stubs/gpui-recording.js";
import type { Cx } from "../../../src/mods/orca-status-bar/main.js";
import type { UsageBucket, UsageReading } from "../../../src/mods/orca-status-bar/usage.js";

export type ExecResult = { code: number; stdout: string; stderr: string };
export type ExecCall = (command: string, args: string[]) => Promise<ExecResult>;
export type TestTab = { id: string; name?: string; named?: boolean };
export type TestSpace = {
  id: string;
  folder: string;
  machine?: string | null;
  active?: boolean;
  tabs?: TestTab[];
};
export type TestPane = {
  terminal: string | null;
  tab: string | null;
  cwd?: string | null;
  app?: string | null;
  program?: { agent?: boolean; name?: string } | null;
};
export type TestKey = { section: string; keys: string; action: string };
export type HostWorld = {
  checking: boolean;
  theme: Record<string, string>;
  settings: Record<string, unknown>;
  keys: TestKey[];
  panes: TestPane[];
  spaces: TestSpace[];
  shared: Record<string, unknown>;
  runs: [string, Record<string, unknown> | undefined][];
  onRun: ((command: string, args: Record<string, unknown> | undefined) => void) | null;
  notices: Record<string, unknown>[];
  machines: { name: string | null; layout: string }[];
  updates: unknown;
  knownAgents: () => Promise<{ installed: boolean; run: string[] }[]>;
  exec: (command: string, args: string[], options?: unknown) => Promise<ExecResult>;
  hc: (args: string[]) => Promise<ExecResult>;
  hcCalls: number;
  readText: (path: string) => Promise<string | null>;
  watch: (path: string) => Promise<string[]>;
  nextCommand: () => Promise<string>;
};

const THEME: Record<string, string> = {
  surface: "#171717",
  border: "#222222",
  raised: "#333333",
  hover: "#444444",
  foreground: "#f0f0f0",
  muted: "#888888",
  blocked: "#ff0000",
  done: "#00ff00",
};

const neverSettles = (): Promise<string> => new Promise<string>(() => {});

const emptyResult = async (): Promise<ExecResult> => ({ code: 0, stdout: "", stderr: "" });

export const world: HostWorld = {
  checking: false,
  theme: THEME,
  settings: {},
  keys: [],
  panes: [],
  spaces: [],
  shared: {},
  runs: [],
  onRun: null,
  notices: [],
  machines: [],
  updates: { core: {}, app: {} },
  knownAgents: async () => [],
  exec: emptyResult,
  hc: async () => {
    world.hcCalls++;
    return { code: 0, stdout: JSON.stringify({ foreground: { cwd: "/wt" } }), stderr: "" };
  },
  hcCalls: 0,
  readText: async () => null,
  watch: async () => {
    throw new Error("no folder");
  },
  nextCommand: neverSettles,
};

export function resetHost(next: Partial<HostWorld> = {}): HostWorld {
  Object.assign(world, {
    checking: false,
    theme: THEME,
    settings: {},
    keys: [],
    panes: [],
    spaces: [],
    shared: {},
    runs: [],
    onRun: null,
    notices: [],
    machines: [],
    updates: { core: {}, app: {} },
    knownAgents: async () => [],
    exec: emptyResult,
    hcCalls: 0,
    readText: async () => null,
    watch: async () => {
      throw new Error("no folder");
    },
    nextCommand: neverSettles,
  });
  Object.assign(world, next);
  setAgentConfigRuntime({ key: "status", argv: [] });
  const runtime = agentConfigRuntime();
  if (runtime) runtime.handlers.length = 0;
  return world;
}

export function handler(key: string, id?: string): AgentConfigHandler[1] | undefined {
  const handlers = agentConfigRuntime()?.handlers ?? [];
  for (let i = handlers.length - 1; i >= 0; i--) {
    const [name, fn, handlerId] = handlers[i];
    if (name === key && handlerId === id) return fn;
  }
  return undefined;
}

export function treeOf(value: unknown): string {
  return JSON.stringify((value as { __node?: unknown }).__node ?? value);
}

export function gpuiKit() {
  return {
    View: class View {},
    div: () => recordedElement("div"),
    svg: (path: string) => recordedElement("svg", path),
    image: (path: string) => recordedElement("image", path),
  };
}

export function gpuiBase() {
  return {
    h_flex: () => recordedElement("h_flex"),
    v_flex: () => recordedElement("v_flex"),
  };
}

export function herdr() {
  return {
    appHome: () => "/app",
    checking: () => world.checking,
    exec: (command: string, args: string[] = [], options?: unknown) =>
      world.exec(command, args, options),
    hc: (args: string[]) => world.hc(args),
    home: () => "/home",
    keys: () => world.keys,
    knownAgents: () => world.knownAgents(),
    machines: () => world.machines,
    nextCommand: () => world.nextCommand(),
    notify: (notice: Record<string, unknown>) => {
      world.notices.push(notice);
      return "notification-test";
    },
    panes: () => world.panes,
    readTextFile: (path: string) => world.readText(path),
    run: (command: string, args?: Record<string, unknown>) => {
      world.runs.push([command, args]);
      world.onRun?.(command, args);
      return null;
    },
    setShared: (key: string, value: unknown) => {
      world.shared[key] = value;
      return null;
    },
    settings: () => world.settings,
    shared: (key: string) => world.shared[key],
    spaces: () => world.spaces,
    theme: () => world.theme,
    updates: () => world.updates,
    watchFolder: (path: string) => world.watch(path),
  };
}

export function fakeCx(parts: Partial<Cx> = {}): Cx {
  return {
    notify: () => undefined,
    sleep: async () => undefined,
    spawn: () => undefined,
    timer: { every: () => undefined },
    ...parts,
  };
}

export function reading(value: { provider: string } & Partial<UsageReading>): UsageReading {
  return { status: "ok", label: "", buckets: [], ...value };
}

export function bucket(value: Partial<UsageBucket>): UsageBucket {
  return { windowMinutes: 0, usedPercent: 0, ...value };
}
