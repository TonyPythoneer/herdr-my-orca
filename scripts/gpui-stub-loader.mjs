// Test-only module hooks: `gpui-kit`, `gpui-base` and `herdr` resolve to recorders, so a mod's real
// main.js can be imported in node and its render output compared with a stored snapshot.
// Each import list is read from the importing file, so no export list has to be kept here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const STUBS = new Set(["gpui-kit", "gpui-base", "herdr"]);
const HERDR = { appHome: "() => '/home'", settings: "() => ({})", knownAgents: "() => []", props: "() => ({})", theme: "() => ({})", terminals: "() => []", checking: "() => false",
  // File IO goes through `globalThis.__herdrFiles` so a flow test can run a mod's real handlers.
  readTextFile: "async (path) => globalThis.__herdrFiles?.get(path)",
  writeTextFile: "async (path, text) => { await globalThis.__herdrFiles?.set(path, text); }",
  setShared: "() => {}",
  exec: "async () => ({ code: 0, stdout: '', stderr: '' })" };

export async function resolve(specifier, context, next) {
  if (!STUBS.has(specifier)) return next(specifier, context);
  const source = readFileSync(fileURLToPath(context.parentURL), "utf8");
  const names = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)].filter((m) => m[2] === specifier).flatMap((m) => m[1].split(",").map((n) => n.trim()).filter(Boolean));
  return { url: `stub:${specifier}?names=${[...new Set(names)].join(",")}&parent=${encodeURIComponent(context.parentURL)}`, shortCircuit: true };
}

export async function load(url, context, next) {
  if (!url.startsWith("stub:")) return next(url, context);
  const { pathname, searchParams } = new URL(url);
  const names = searchParams.get("names").split(",").filter(Boolean);
  const body = pathname === "herdr"
    ? names.map((n) => `export const ${n} = ${HERDR[n] ?? "() => undefined"};`).join("\n")
    : names.map((n) => n === "View" ? "export class View {}" : `export const ${n} = recorder(${JSON.stringify(n)});`).join("\n");
  return { format: "module", shortCircuit: true, source: `${RECORDER}\n${body}` };
}

// A node is a proxy that logs every chained call. Function arguments are run (`when`, `hover`) so
// both branches of the real code show up; `on_*` handlers are logged by name only.
const RECORDER = `
export function snapshot(x) { return x?.__node ? x.__node : x; }
function cleanse(a) {
  if (a?.__node) return a.__node;
  if (typeof a === "function") return "fn";
  if (Array.isArray(a)) return a.map(cleanse);
  if (a && typeof a === "object") return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, cleanse(v)]));
  return a;
}
function node(name, args) {
  const rec = { n: name, a: args.map(cleanse), c: [] };
  const proxy = new Proxy(function () {}, {
    get(_t, key) {
      if (key === "__node") return rec;
      if (typeof key === "symbol") return undefined;
      return (...a) => {
        if (key === "when") {
          if (a[0]) { const r = a[1](proxy); if (r !== proxy) rec.c.push(["when", cleanse(r)]); } return proxy;
        }
        if (key === "hover") { const inner = node("hover", []); a[0](inner); rec.c.push(["hover", inner.__node]); return proxy; }
        rec.c.push([key, a.map(cleanse)]); return proxy;
      };
    },
  });
  return proxy;
}
function recorder(name) {
  return new Proxy(function () {}, {
    apply: (_t, _this, args) => node(name, args),
    get: (_t, key) => (...args) => node(name + "." + String(key), args),
  });
}
`;
