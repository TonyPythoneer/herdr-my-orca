type Call = [string, unknown[]];
type Builder = { name: string; args: unknown[] } & Record<string, (...args: unknown[]) => Builder>;
const callsByElement = new WeakMap<object, Call[]>();
import { agentConfigRuntime } from "../support/agent-config-runtime.js";
import { recordedElement } from "./gpui-recording.js";

function element(name: string, ...args: unknown[]): Builder {
  if (agentConfigRuntime()) return recordedElement(name, ...args) as unknown as Builder;
  const calls: Call[] = [];
  const record = { name, args };
  const proxy: Builder = new Proxy(record as Builder, {
    get(target, key: string) {
      if (key in target) return target[key];
      return (...values: unknown[]) => {
        if (key === "when" && values[0]) (values[1] as (builder: Builder) => unknown)(proxy);
        else if (key !== "when") calls.push([key, values]);
        return proxy;
      };
    },
  });
  callsByElement.set(proxy, calls);
  return proxy;
}

export const div = (): Builder => element("div");
export const svg = (path: string): Builder => element("svg", path);
export const image = (path: string): Builder => element("image", path);
export const callsOf = (value: object): Call[] => callsByElement.get(value) ?? [];
export class View {}
