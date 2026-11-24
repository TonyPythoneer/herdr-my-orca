import { register } from "node:module";

// Keep the shared recorder's exact tree. Also retain the actual listeners for flow assertions.
// Herdr APIs absent from the generic test host are supplied only in this test process.
const stub = new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url);
register(new URL("data:text/javascript," + encodeURIComponent(`
  export { resolve } from "${stub}";
  import { load as base } from "${stub}";
  export async function load(url, context, next) {
    const result = await base(url, context, next);
    if (!url.startsWith("stub:")) return result;
    let source = result.source.replace("rec.c.push([key, a.map(cleanse)])",
      "globalThis.recordListener?.(rec, key, a); rec.c.push([key, a.map(cleanse)])");
    for (const name of ["agents", "nextCommand", "hc", "setShared", "openOverlay"]) {
      source = source.replace(new RegExp("export const " + name + " = [^;]+;"),
        "export const " + name + " = (...args) => globalThis.host." + name + "(...args);");
    }
    return { ...result, source };
  }
`)));
const { default: Skillshare } = await import("./main.js");

export function host(t, props = {}) {
  const tasks = [], timers = new Map(), listeners = new Map(), shared = new Map(), calls = [];
  const state = { props, hidden: false, agents: [] };
  let notifications = 0;
  const cx = {
    focus_handle: () => ({ focus() {} }), notify: () => ++notifications, stop_propagation() {},
    spawn: (fn) => tasks.push(fn), sleep: async () => {}, timer: { every: (ms, fn) => timers.set(ms, fn) },
  };
  globalThis.__herdrProps = () => state.props;
  globalThis.__herdrLayout = () => ({ children: [{ id: "skillshare-panel", hidden: state.hidden }] });
  globalThis.__herdrShared = (key) => shared.get(key);
  globalThis.__herdrTheme = () => new Proxy({}, { get: (_, key) => String(key) });
  globalThis.__herdrSpaces = () => [{ id: "space", active: true, folder: "/repo", machine: "desk" }];
  globalThis.__herdrRun = (...args) => calls.push(args);
  globalThis.host = { agents: () => state.agents, openOverlay: () => {}, setShared: (k, v) => shared.set(k, v), hc: async () => ({ code: 0 }) };
  globalThis.recordListener = (rec, key, args) => {
    if (!key.startsWith("on_") && key !== "on") return;
    const id = rec.c.find(([method]) => method === "id")?.[1][0] ?? rec.n;
    listeners.set([id, key, key === "on" ? args[0] : ""].join("/"), args.at(-1));
  };
  t.after(() => {
    for (const key of ["__herdrProps", "__herdrLayout", "__herdrShared", "__herdrTheme", "__herdrSpaces", "__herdrRun", "__herdrExec", "__herdrFiles", "recordListener", "host"]) delete globalThis[key];
  });
  const view = new Skillshare();
  view.init({}, cx);
  const click = (id) => listeners.get(id + "/on_click/")({}, cx);
  const render = () => view.render(cx).__node;
  return { view, cx, shared, calls, state, tasks, timers, listeners, click, render, notifications: () => notifications };
}
