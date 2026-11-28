import { agentConfigRuntime, type AgentConfigHandler } from "../support/agent-config-runtime.js";

type RecordedNode = { n: string; a: unknown[]; c: unknown[] };
export type Builder = { __node: RecordedNode; name: string; args: unknown[] } & Record<
  string,
  (...args: unknown[]) => Builder
>;

function clean(value: unknown): unknown {
  if (value && typeof value === "object") {
    const node = (value as Partial<Builder>).__node;
    if (node) return node;
  }
  if (Array.isArray(value)) return value.map(clean);
  if (typeof value === "function") return "fn";
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  return value;
}

export function recordedElement(name: string, ...args: unknown[]): Builder {
  const node: RecordedNode = { n: name, a: args.map(clean), c: [] };
  let id: string | undefined;
  const proxy = new Proxy({ name, args } as Builder, {
    get(target, key: string | symbol) {
      if (key === "__node") return node;
      if (typeof key === "symbol") return undefined;
      if (key in target) return target[key as keyof Builder];
      return (...values: unknown[]) => {
        if (key === "when") {
          if (values[0]) {
            const result = (values[1] as (builder: Builder) => unknown)(proxy);
            if (result !== proxy) node.c.push(["when", clean(result)]);
          }
          return proxy;
        }
        if (key === "hover") {
          const inner = recordedElement("hover");
          (values[0] as (builder: Builder) => unknown)(inner);
          node.c.push(["hover", inner.__node]);
          return proxy;
        }
        if (key === "id" && typeof values[0] === "string") id = values[0];
        if (key.startsWith("on_")) {
          const handler = values[0];
          if (typeof handler === "function")
            agentConfigRuntime()?.handlers.push([key, handler as AgentConfigHandler[1], id]);
        }
        node.c.push([key, values.map(clean)]);
        return proxy;
      };
    },
  });
  return proxy;
}
