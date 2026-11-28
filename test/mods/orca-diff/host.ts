import {
  agentConfigRuntime,
  setAgentConfigRuntime,
  type AgentConfigHandler,
} from "../../support/agent-config-runtime.js";
import { recordedElement } from "../../stubs/gpui-recording.js";

export type TestRange = { start: number; end: number };
export type TestExecResult = { code: number; stdout: string; stderr: string };
export type TestExecOptions = { cwd?: string; on?: string | null };
export type TestExec = (
  command: string,
  args: string[],
  options?: TestExecOptions,
) => TestExecResult | Promise<TestExecResult>;
export type RecordedNode = { n: string; a: unknown[]; c: [string, unknown[]][] };
export type HostWorld = {
  props: Record<string, unknown>;
  theme: Record<string, string>;
  settings: Record<string, unknown> | undefined;
  panes: unknown[];
  focused: unknown;
  runs: unknown[][];
  notifies: number;
  jobs: Promise<unknown>[];
  exec: TestExec;
  virtual: ((range: TestRange) => unknown[]) | null;
  sharedValue: unknown;
  commands: string[];
  waitForCommand: boolean;
};

const THEME = Object.fromEntries(
  [
    "background",
    "foreground",
    "raised",
    "selected",
    "border",
    "muted",
    "dim",
    "hover",
    "ansi1",
    "ansi2",
  ].map((name, i) => [name, `#${(i + 16).toString(16)}3355`]),
);

export const world: HostWorld = {
  props: {},
  theme: THEME,
  settings: {},
  panes: [],
  focused: { tab: 1 },
  runs: [],
  notifies: 0,
  jobs: [],
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  virtual: null,
  sharedValue: undefined,
  commands: [],
  waitForCommand: false,
};

export function resetHost(next: Partial<HostWorld> = {}): HostWorld {
  world.props = {};
  world.theme = THEME;
  world.settings = {};
  world.panes = [];
  world.focused = { tab: 1 };
  world.runs = [];
  world.notifies = 0;
  world.jobs = [];
  world.exec = async () => ({ code: 0, stdout: "", stderr: "" });
  world.virtual = null;
  world.sharedValue = undefined;
  world.commands = [];
  world.waitForCommand = false;
  Object.assign(world, next);
  setAgentConfigRuntime({ key: "diff", argv: [] });
  const runtime = agentConfigRuntime();
  if (runtime) runtime.handlers.length = 0;
  return world;
}

export function handler(id: string | undefined, key: string): AgentConfigHandler[1] | undefined {
  const handlers = agentConfigRuntime()?.handlers ?? [];
  for (let i = handlers.length - 1; i >= 0; i--) {
    const [name, fn, handlerId] = handlers[i];
    if (name === key && (id === undefined || handlerId === id)) return fn;
  }
  return undefined;
}

const isRecordedNode = (value: unknown): value is RecordedNode =>
  typeof value === "object" && value !== null && "n" in value && "a" in value && "c" in value;

export function nodeOrValue(value: unknown): unknown {
  const node: unknown =
    typeof value === "object" && value !== null ? Reflect.get(value, "__node") : undefined;
  return node ?? value;
}

export function nodeOf(value: unknown): RecordedNode {
  const node = nodeOrValue(value);
  if (isRecordedNode(node)) return node;
  throw new TypeError("Value is not a recorded element");
}

export function fake<T>(parts: Record<string, unknown>): T {
  return parts as T;
}

export function gpuiKit() {
  return {
    View: class View {},
    div: () => recordedElement("div"),
    svg: (path: string) => recordedElement("svg", path),
  };
}

export function gpuiBase() {
  return {
    v_flex: () => recordedElement("v_flex"),
    h_flex: () => recordedElement("h_flex"),
    Scrollbar: {
      vertical: (id: string | number) => recordedElement("Scrollbar.vertical", id),
    },
    v_virtual_list: (
      id: string | number,
      count: number,
      size: number | number[],
      key: (index: number) => string,
      render: (range: TestRange) => unknown[],
    ) => {
      world.virtual = render;
      return recordedElement("v_virtual_list", id, count, size, key, render);
    },
  };
}

export function herdr() {
  return {
    theme: () => world.theme,
    props: () => world.props,
    shared: (key: string) => (key === "orca-diff.target" ? world.sharedValue : undefined),
    exec: async (command: string, args: string[], options?: TestExecOptions) =>
      world.exec(command, args, options),
    nextCommand: () => {
      const command = world.commands.shift();
      if (command === undefined) {
        if (world.waitForCommand) return new Promise<string>(() => {});
        throw new Error("end of queue");
      }
      return Promise.resolve(command);
    },
    panes: () => world.panes,
    focused: () => world.focused,
    run: (command: string, args?: unknown) => {
      world.runs.push([command, args]);
    },
    settings: () => world.settings,
  };
}
