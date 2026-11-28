import { createHash } from "node:crypto";
import type { Context, FocusHandle } from "gpui-kit";

export type Effect = unknown[];
export type Handler = (...args: unknown[]) => void;
export type RecordedNode = { n: string; a: unknown[]; c: [string, unknown][] };
export type RecordedBuilder = { __node: RecordedNode } & ((...args: unknown[]) => unknown);

export type TestHost = {
  props: unknown;
  spaces: unknown[];
  panes: unknown[];
  terminals: unknown[];
  keys: unknown[];
  theme: Record<string, string>;
  effects: unknown[];
  handlers: Array<[string, Handler]>;
  onExec?: (command: string, args: string[]) => Promise<unknown>;
  onHc?: (args: unknown[]) => Promise<unknown>;
  onCopy?: (text: unknown, cx: unknown) => void;
  onRun?: (...args: unknown[]) => void;
  onCloseOverlay?: (id: unknown) => void;
  onOpenOverlay?: (spec: unknown) => void;
};

const DEFAULTS = {
  props: undefined,
  spaces: [],
  panes: [],
  terminals: [],
  keys: [],
  theme: {},
  effects: [],
  handlers: [],
  onExec: undefined,
  onHc: undefined,
  onCopy: undefined,
  onRun: undefined,
  onCloseOverlay: undefined,
  onOpenOverlay: undefined,
} satisfies TestHost;

export const host: TestHost = { ...DEFAULTS };

export function resetHost(next: Partial<TestHost> = {}): void {
  Object.assign(host, { ...DEFAULTS, effects: [], handlers: [] }, next);
}

export function plain<T = unknown>(value: unknown): T {
  return JSON.parse(
    JSON.stringify(value, (key, item: unknown) => {
      if (typeof item === "function") return "fn";
      if (key === "at" && typeof item === "number") return "<now>";
      return item;
    }),
  );
}

export function canon(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canon(Reflect.get(value, key))]),
    );
  }
  return value;
}

export function sha(value: unknown): string {
  return createHash("sha1")
    .update(JSON.stringify(canon(value)))
    .digest("hex");
}

export function digest(value: unknown): string {
  return sha(plain(value));
}

export function summary(got: unknown): Record<string, Record<string, string>> {
  const clean = plain<Record<string, Record<string, unknown>>>(got);
  return Object.fromEntries(
    Object.entries(clean).map(([name, sections]) => [
      name,
      Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, sha(value)])),
    ]),
  );
}

export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function cleanse(value: unknown): unknown {
  const rec =
    value && (typeof value === "object" || typeof value === "function") && "__node" in value
      ? value.__node
      : undefined;
  if (rec) return rec;
  if (Array.isArray(value)) return value.map(cleanse);
  if (typeof value === "function") return "fn";
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanse(item)]));
  }
  return value;
}

function recordedNode(name: string, args: unknown[]): RecordedBuilder {
  const rec: RecordedNode = { n: name, a: args.map(cleanse), c: [] };
  const target = Object.assign(function () {}, { __node: rec });
  const proxy: RecordedBuilder = new Proxy(target, {
    get(_target, key: string | symbol) {
      if (key === "__node") return rec;
      if (typeof key === "symbol") return undefined;
      return (...values: unknown[]) => {
        if (key === "when") {
          if (values[0]) {
            const result = (values[1] as (builder: RecordedBuilder) => unknown)(proxy);
            if (result !== proxy) rec.c.push(["when", cleanse(result)]);
          }
          return proxy;
        }
        if (key.startsWith("on_")) host.handlers.push([key, values[0] as Handler]);
        rec.c.push([key, values.map(cleanse)]);
        return proxy;
      };
    },
  });
  return proxy;
}

export function element(name: string): (...args: unknown[]) => RecordedBuilder {
  return (...args) => recordedNode(name, args);
}

class FocusStub {
  is_focused(): boolean {
    return false;
  }
  release(): boolean {
    return false;
  }
}

export function focusHandle(onFocus: () => void): FocusHandle {
  return Object.assign(new FocusStub(), { focus: onFocus });
}

export function contextOf(members: Partial<Record<keyof Context, unknown>>): Context {
  return members as Context;
}

export function herdrMock(): Record<string, unknown> {
  return {
    run: (...args: unknown[]) => (host.onRun ? host.onRun(...args) : log("run", ...args)),
    props: () => host.props,
    closeOverlay: (id: unknown) =>
      host.onCloseOverlay ? host.onCloseOverlay(id) : log("closeOverlay", id),
    openOverlay: (spec: unknown) =>
      host.onOpenOverlay ? host.onOpenOverlay(spec) : log("openOverlay", spec),
    theme: () => host.theme,
    keys: () => host.keys,
    terminals: () => host.terminals,
    spaces: () => host.spaces,
    panes: () => host.panes,
    exec: (command: string, args: string[]) => host.onExec!(command, args),
    hc: (args: unknown[]) => host.onHc!(args),
    home: () => "/home",
    setShared: (...args: unknown[]) => log("setShared", ...args),
  };
}

export function log(name: string, ...args: unknown[]): void {
  host.effects.push([name, ...plain<unknown[]>(args)]);
}
