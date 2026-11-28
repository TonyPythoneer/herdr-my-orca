import type { AsyncContext } from "gpui-kit";
import { recordedElement } from "../../stubs/gpui-recording.js";

type RawNode = { n: string; a: unknown[]; c: [string, unknown][] };

type Raw = { __node: RawNode } & { [method: string]: (...args: unknown[]) => Raw };

function rawClean(value: unknown): unknown {
  if (value && typeof value === "object") {
    const node = (value as { __node?: RawNode }).__node;
    if (node) return node;
  }
  if (Array.isArray(value)) return value.map(rawClean);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rawClean(v)]));
  return value;
}

export function rawElement(name: string, ...args: unknown[]): Raw {
  const node: RawNode = { n: name, a: args.map(rawClean), c: [] };
  const proxy: Raw = new Proxy({} as Raw, {
    get(_target, key: string | symbol) {
      if (key === "__node") return node;
      if (typeof key === "symbol") return undefined;
      return (...values: unknown[]) => {
        if (key === "when") {
          if (values[0]) {
            const result = (values[1] as (el: Raw) => unknown)(proxy);
            if (result !== proxy) node.c.push(["when", rawClean(result)]);
          }
          return proxy;
        }
        if (key === "hover") {
          const inner = rawElement("hover");
          (values[0] as (el: Raw) => unknown)(inner);
          node.c.push(["hover", inner.__node]);
          return proxy;
        }
        node.c.push([key, values.map(rawClean)]);
        return proxy;
      };
    },
  });
  return proxy;
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

export function flowGpuiKit() {
  return {
    View: class View {},
    div: () => rawElement("div"),
    svg: (path: string) => rawElement("svg", path),
    image: (path: string) => rawElement("image", path),
  };
}

export function flowGpuiBase() {
  return {
    h_flex: () => rawElement("h_flex"),
    v_flex: () => rawElement("v_flex"),
  };
}

export type HostState = {
  props: () => unknown;
  theme: () => unknown;
  settings: () => unknown;
  panes: () => unknown;
  terminals: () => unknown;
  window: () => unknown;
  spaces: () => unknown;
  layout: () => unknown;
  shared: (key: string) => unknown;
  run: (command: string, args?: unknown) => unknown;
  setShared: (key: string, value: unknown) => unknown;
  openOverlay: (spec: unknown) => string;
  closeOverlay: (id?: string) => unknown;
  writeTextFile: (path: string, text: string, expected: unknown) => Promise<unknown>;
  nextCommand: () => Promise<string>;
};

const unset = (): unknown => undefined;

function defaultHostState(): HostState {
  return {
    props: () => ({}),
    theme: () => ({}),
    settings: () => ({}),
    panes: () => [],
    terminals: () => [],
    window: unset,
    spaces: () => [],
    layout: unset,
    shared: unset,
    run: unset,
    setShared: unset,
    openOverlay: () => "overlay-test",
    closeOverlay: unset,
    writeTextFile: async () => null,
    nextCommand: () => new Promise<string>(() => {}),
  };
}

export const hostState: HostState = defaultHostState();

export function resetHostState(): void {
  Object.assign(hostState, defaultHostState());
}

export type TaskFn = (cx: AsyncContext) => unknown;

export function cxOf(tasks: TaskFn[]): AsyncContext {
  return {
    spawn: (fn: TaskFn) => {
      tasks.push(fn);
    },
    sleep: async () => {},
    notify() {},
  } as AsyncContext;
}

export function herdr() {
  return {
    props: () => hostState.props(),
    theme: () => hostState.theme(),
    settings: () => hostState.settings(),
    panes: () => hostState.panes(),
    terminals: () => hostState.terminals(),
    window: () => hostState.window(),
    spaces: () => hostState.spaces(),
    layout: () => hostState.layout(),
    shared: (key: string) => hostState.shared(key),
    run: (command: string, args?: unknown) => hostState.run(command, args),
    setShared: (key: string, value: unknown) => hostState.setShared(key, value),
    openOverlay: (spec: unknown) => hostState.openOverlay(spec),
    closeOverlay: (id?: string) => hostState.closeOverlay(id),
    writeTextFile: (path: string, text: string, expected: unknown) =>
      hostState.writeTextFile(path, text, expected),
    nextCommand: () => hostState.nextCommand(),
  };
}

export function nodeOf(value: unknown): RawNode {
  return (value as { __node: RawNode }).__node;
}
