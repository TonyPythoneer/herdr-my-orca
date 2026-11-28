export type Handler = (...args: unknown[]) => unknown;
export type Rec = { n: string; a: unknown[]; c: unknown[] };
export type Node = { readonly __rec: Rec };
type Links = { fns: Record<string, Handler[]>; kids: Rec[] };

const links = new WeakMap<Rec, Links>();

export type HandlerRecord = { name: string; fn: Handler; idx: number; path: string; rec: Rec };

function marker(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  return Reflect.get(Object(value), "__rec");
}

export function cleanse(value: unknown): unknown {
  const rec = marker(value);
  if (rec) return rec;
  if (typeof value === "function") return "fn";
  if (Array.isArray(value)) return value.map(cleanse);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanse(v)]));
  return value;
}

export function recOf(value: unknown): Rec | undefined {
  const rec = marker(value);
  return rec as Rec | undefined;
}

function recordWhen(proxy: Node, rec: Rec, link: Links, a: unknown[]): Node {
  if (a[0]) {
    const r = (a[1] as (el: Node) => unknown)(proxy);
    if (r !== proxy) {
      rec.c.push(["when", cleanse(r)]);
      const kid = recOf(r);
      if (kid) link.kids.push(kid);
    }
  }
  return proxy;
}

function recordHover(rec: Rec, a: unknown[], proxy: Node): Node {
  const inner = node("hover", []);
  (a[0] as (el: Node) => unknown)(inner);
  rec.c.push(["hover", inner.__rec]);
  return proxy;
}

export function node(name: string, args: unknown[]): Node {
  const rec: Rec = { n: name, a: args.map(cleanse), c: [] };
  const link: Links = { fns: {}, kids: [] };
  links.set(rec, link);
  const proxy: Node = new Proxy({ __rec: rec } as Node, {
    get(_target, key) {
      if (key === "__rec") return rec;
      if (typeof key === "symbol") return undefined;
      return (...a: unknown[]) => {
        if (key === "when") return recordWhen(proxy, rec, link, a);
        if (key === "hover") return recordHover(rec, a, proxy);
        rec.c.push([key, a.map(cleanse)]);
        if (key.startsWith("on_")) (link.fns[key] ??= []).push(a.at(-1) as Handler);
        if (key === "child") {
          const kid = marker(a[0]);
          if (kid) link.kids.push(kid as Rec);
        }
        if (key === "children") {
          for (const k of (a[0] ?? []) as unknown[]) {
            const kid = marker(k);
            if (kid) link.kids.push(kid as Rec);
          }
        }
        return proxy;
      };
    },
  });
  return proxy;
}

export const factory =
  (name: string) =>
  (...args: unknown[]): Node =>
    node(name, args);

export const builder = (name: string) => ({
  new: (...args: unknown[]): Node => node(name, args),
});

export function handlers(
  rec: Rec,
  path: string[] = [],
  out: HandlerRecord[] = [],
): HandlerRecord[] {
  const link = links.get(rec);
  if (!link) return out;
  for (const [name, fns] of Object.entries(link.fns))
    fns.forEach((fn, idx) => out.push({ name, fn, idx, path: path.join("/"), rec }));
  link.kids.forEach((kid, i) => handlers(kid, [...path, `${kid.n}${i}`], out));
  return out;
}

export function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null));
}

export const theme = new Proxy<Record<string, string | boolean>>(
  {},
  {
    get: (_target, key) => (key === "is_dark" ? false : `#${String(key)}`),
  },
);
