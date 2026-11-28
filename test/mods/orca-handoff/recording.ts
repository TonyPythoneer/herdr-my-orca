export type Handler = (event: unknown, cx: unknown) => unknown;

export type Rec = {
  n: string;
  a: unknown[];
  c: unknown[][];
  fns?: Record<string, Handler[]>;
  kids?: Rec[];
};

export type Recorder = { __rec: Rec };

export type HandlerRecord = { name: string; fn: Handler; path: string };

export function asRecorder(value: unknown): Rec | null {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return null;
  const rec = (value as { __rec?: unknown }).__rec;
  return rec && typeof rec === "object" ? (rec as Rec) : null;
}

export function cleanse(value: unknown): unknown {
  const rec = asRecorder(value);
  if (rec) return rec;
  if (typeof value === "function") return "fn";
  if (Array.isArray(value)) return value.map(cleanse);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanse(v)]));
  }
  return value;
}

type Links = { fns: Record<string, Handler[]>; kids: Rec[] };

export function node(name: string, args: unknown[]): Recorder {
  const links: Links = { fns: {}, kids: [] };
  const rec: Rec = { n: name, a: args.map(cleanse), c: [] };
  Object.defineProperty(rec, "fns", { value: links.fns });
  Object.defineProperty(rec, "kids", { value: links.kids });
  const proxy: Recorder = new Proxy(function () {}, {
    get(_target, key) {
      if (key === "__rec") return rec;
      if (typeof key === "symbol") return undefined;
      return (...a: unknown[]) => {
        if (key === "when") return applyWhen(rec, proxy, links, a);
        if (key === "hover") return applyHover(rec, proxy, a);
        return applyCall(rec, proxy, links, key, a);
      };
    },
  }) as unknown as Recorder;
  return proxy;
}

function applyWhen(rec: Rec, proxy: Recorder, links: Links, args: unknown[]): Recorder {
  if (args[0]) {
    const result = (args[1] as (value: Recorder) => unknown)(proxy);
    if (result !== proxy) {
      rec.c.push(["when", cleanse(result)]);
      const kid = asRecorder(result);
      if (kid) links.kids.push(kid);
    }
  }
  return proxy;
}

function applyHover(rec: Rec, proxy: Recorder, args: unknown[]): Recorder {
  const inner = node("hover", []);
  (args[0] as (value: Recorder) => unknown)(inner);
  rec.c.push(["hover", inner.__rec]);
  return proxy;
}

function applyCall(
  rec: Rec,
  proxy: Recorder,
  links: Links,
  key: string,
  args: unknown[],
): Recorder {
  rec.c.push([key, args.map(cleanse)]);
  if (key.startsWith("on_")) (links.fns[key] ??= []).push(args.at(-1) as Handler);
  if (key === "child") {
    const kid = asRecorder(args[0]);
    if (kid) links.kids.push(kid);
  }
  if (key === "children") {
    for (const value of (args[0] as unknown[] | undefined) ?? []) {
      const kid = asRecorder(value);
      if (kid) links.kids.push(kid);
    }
  }
  return proxy;
}

export const element =
  (name: string) =>
  (...args: unknown[]) =>
    node(name, args);

export const theme = new Proxy(
  {},
  {
    get: (_target, key) => `#${String(key)}`,
  },
) as Record<string, string>;

export function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null)) as unknown;
}

export function handlers(
  rec: Rec,
  path: string[] = [],
  out: HandlerRecord[] = [],
): HandlerRecord[] {
  for (const [name, fns] of Object.entries(rec.fns ?? {})) {
    for (const fn of fns) out.push({ name, fn, path: path.join("/") });
  }
  (rec.kids ?? []).forEach((kid, i) => handlers(kid, [...path, `${kid.n}${i}`], out));
  return out;
}
