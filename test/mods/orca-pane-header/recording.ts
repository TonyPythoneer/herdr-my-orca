export type RecordedNode = { n: string; a: unknown[]; c: [string, unknown][] };
export type RecordedBuilder = { readonly __node: RecordedNode } & ((...args: unknown[]) => unknown);
export type ElementFactory = (...args: unknown[]) => RecordedBuilder;
type BuilderHandler = (builder: RecordedBuilder) => unknown;

export class View {}

const isObjectLike = (value: unknown): value is object =>
  (typeof value === "object" || typeof value === "function") && value !== null;
const isRecordedNode = (value: unknown): value is RecordedNode =>
  typeof value === "object" && value !== null && "n" in value;
const isBuilderHandler = (value: unknown): value is BuilderHandler => typeof value === "function";

function handlerOf(value: unknown): BuilderHandler {
  if (isBuilderHandler(value)) return value;
  throw new TypeError("expected a builder handler");
}

export function nodeOf(value: unknown): RecordedNode {
  const node: unknown = isObjectLike(value) ? Reflect.get(value, "__node") : undefined;
  if (!isRecordedNode(node)) throw new TypeError("not a recorded element");
  return node;
}

function cleanse(value: unknown, keepFunctions: boolean): unknown {
  if (isObjectLike(value)) {
    const recorded: unknown = Reflect.get(value, "__node");
    if (isRecordedNode(recorded)) return recorded;
  }
  if (typeof value === "function") return keepFunctions ? value : "fn";
  if (Array.isArray(value)) return value.map((item) => cleanse(item, keepFunctions));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cleanse(item, keepFunctions)]),
    );
  }
  return value;
}

function recordedNode(name: string, args: unknown[], keepFunctions: boolean): RecordedBuilder {
  const rec: RecordedNode = { n: name, a: args.map((arg) => cleanse(arg, keepFunctions)), c: [] };
  const target = Object.assign(function () {}, { __node: rec });
  const proxy: RecordedBuilder = new Proxy(target, {
    get(_target, key) {
      if (key === "__node") return rec;
      if (typeof key === "symbol") return undefined;
      return (...values: unknown[]) => {
        if (key === "when") {
          if (values[0]) {
            const result = handlerOf(values[1])(proxy);
            if (result !== proxy) rec.c.push(["when", cleanse(result, keepFunctions)]);
          }
          return proxy;
        }
        if (key === "hover") {
          const inner = recordedNode("hover", [], keepFunctions);
          handlerOf(values[0])(inner);
          rec.c.push(["hover", inner.__node]);
          return proxy;
        }
        rec.c.push([String(key), values.map((value) => cleanse(value, keepFunctions))]);
        return proxy;
      };
    },
  });
  return proxy;
}

export function element(name: string, keepFunctions = false): ElementFactory {
  const target: ElementFactory = (...args) => recordedNode(name, args, keepFunctions);
  return new Proxy(target, {
    apply: (_target, _this, args: unknown[]) => recordedNode(name, args, keepFunctions),
    get:
      (_target, key) =>
      (...args: unknown[]) =>
        recordedNode(`${name}.${String(key)}`, args, keepFunctions),
  });
}
