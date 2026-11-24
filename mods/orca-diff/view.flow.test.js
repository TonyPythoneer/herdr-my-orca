import { register } from "node:module";
import { goldenSuite } from "./golden.mjs";

// The recorder tree plus the real handlers: every function a chained call receives is kept with its element id.
const loader = new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`
  import { load as record } from ${JSON.stringify(loader)};
  export { resolve } from ${JSON.stringify(loader)};
  export async function load(url, ctx, next) {
    const result = await record(url, ctx, next);
    if (!url.startsWith("stub:")) return result;
    const source = result.source
      .replace(/^export const (panes|focused|settings|nextCommand) = .*$/gm, (line, name) => "export const " + name + " = (...a) => globalThis.__diff." + name + "(...a);")
      .replace("rec.c.push([key, a.map(cleanse)]); return proxy;", "for (const x of a) if (typeof x === 'function') globalThis.__fns.push({ id: rec.c.find(([k]) => k === 'id')?.[1][0], key, fn: x }); rec.c.push([key, a.map(cleanse)]); return proxy;")
      .replace("const rec = { n: name, a: args.map(cleanse), c: [] };", "const rec = { n: name, a: args.map(cleanse), c: [] }; for (const x of args) if (typeof x === 'function') globalThis.__fns.push({ id: name, key: 'arg', fn: x });");
    return { ...result, source };
  }`));

globalThis.__fns = [];
const world = { panes: [], focused: { tab: 1 }, settings: {}, runs: [], notifies: 0, jobs: [] };
globalThis.__diff = { panes: () => world.panes, focused: () => world.focused, settings: () => world.settings, nextCommand: () => new Promise(() => {}) };
globalThis.__herdrRun = (command, args) => world.runs.push([command, args]);
globalThis.__herdrTheme = () => Object.fromEntries(["background", "foreground", "raised", "selected", "border", "muted", "dim", "hover", "ansi1", "ansi2"].map((name, i) => [name, `#${(i + 16).toString(16)}3355`]));
globalThis.__herdrExec = async () => ({ code: 0, stdout: "@@ -1 +1 @@\n+x\n", stderr: "" });
const { default: Diff } = await import("./main.js");
const { diffBody } = await import("./diff.js");

const node = (x) => x?.__node ?? x;
const handler = (id, key) => globalThis.__fns.findLast((h) => h.key === key && (id === undefined || h.id === id))?.fn;
const cx = { notify() { world.notifies++; }, spawn(body) { const job = Promise.resolve(body(cx)); world.jobs.push(job); return job; }, timer: { every() {} } };
const view = (target, rows = [], props = {}) => {
  globalThis.__herdrProps = () => props;
  const v = new Diff(); v.target = target; v.rows = rows; v.width = 300; v.loadGeneration = 0; return v;
};
const ROWS = [{ kind: "F", text: "file" }, { kind: "@", text: "@@ -1 +1 @@" }, { kind: " ", number: 1, text: "ctx" }, { kind: "-", number: 2, text: "old" }, { kind: "+", number: 2, text: "new" }, { kind: "+", number: 3, text: "new2" }, { kind: "", text: "plain" }];

goldenSuite("diff-view", {
  "the pane renders an empty prompt, and each target with its counts and badge": async () => {
    const out = { empty: node(view(null).render({})) };
    for (const [name, target] of Object.entries({ all: { all: true }, staged: { sectionAll: true, section: "staged" }, changes: { sectionAll: true }, untracked: { path: "a/b/c.txt", status: "U" }, stagedFile: { path: "d/e", section: "staged" }, plain: { path: "top" } })) {
      out[name] = node(view(target, name === "plain" ? [] : ROWS).render({}));
    }
    world.settings = { font_family: "Fira" }; out.font = node(view({ path: "p" }, ROWS).render({})); world.settings = {};
    return out;
  },
  "the diff body draws each row kind through a virtual list": async () => {
    const out = { body: node(diffBody({ background: "#111111", raised: "#222222", dim: "#333333", selected: "#444444", foreground: "#555555", ansi1: "#aa0000", ansi2: "#00aa00" }, "Mono", ROWS, 640)) };
    const renderRows = globalThis.__fns.findLast((h) => h.key === "arg" && String(h.fn).includes("slice")).fn;
    out.rows = renderRows({ start: 0, end: ROWS.length }).map(node);
    out.window = renderRows({ start: 2, end: 4 }).map(node);
    return out;
  },
  "closing the diff pane closes only this tab's single diff pane": async () => {
    const out = {};
    const close = (panes, focused) => { world.panes = panes; world.focused = focused; world.runs.length = 0; const v = view({ path: "p" }, ROWS); v.render({}); handler("orca-diff-close", "on_click")(); return world.runs.slice(); };
    out.one = close([{ mod: "orca-diff", tab: 1, pane: "p1" }, { mod: "term", tab: 1, pane: "p2" }, { mod: "orca-diff", tab: 2, pane: "p3" }], { tab: 1 });
    out.two = close([{ mod: "orca-diff", tab: 1, pane: "p1" }, { mod: "orca-diff", tab: 1, pane: "p4" }], { tab: 1 });
    out.none = close([{ mod: "term", tab: 1, pane: "p2" }], { tab: 1 });
    out.noFocus = close([{ mod: "orca-diff", tab: undefined, pane: "p1" }], null);
    return out;
  },
  "the pane loads its target on init, ignores a stale result and keeps the newest rows": async () => {
    const out = {};
    const exec = (...a) => globalThis.__herdrExec(...a);
    const timers = [];
    const c = { notify() { world.notifies++; }, spawn(body) { const job = Promise.resolve(body(c)); world.jobs.push(job); return job; }, timer: { every: (ms, fn) => timers.push([ms, fn]) } };
    globalThis.__herdrProps = () => ({ root: "/r", path: "a" });
    let release;
    globalThis.__herdrExec = () => new Promise((resolve) => { release = () => resolve({ code: 0, stdout: "@@ -1 +1 @@\n+first\n", stderr: "" }); });
    const v = new Diff(); v.init({}, c);
    const stale = release;
    globalThis.__herdrExec = async () => ({ code: 0, stdout: "@@ -1 +1 @@\n+second\n", stderr: "" });
    v.load(c); await new Promise((resolve) => setImmediate(resolve));
    stale(); await new Promise((resolve) => setImmediate(resolve));
    out.rows = v.rows.map((r) => r.text); out.width = v.width; out.timer = timers.map(([ms]) => ms);
    v.target = null; v.load(c);
    out.noTarget = v.rows.length;
    globalThis.__herdrProps = () => ({}); const bare = new Diff(); bare.init({}, c); out.bare = bare.target;
    globalThis.__herdrExec = exec;
    return out;
  },
}, import.meta.url);
