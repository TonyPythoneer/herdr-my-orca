// Characterization test for main.js: for several pane layouts it records the rows, the render
// tree, what every key does and what choosing every row asks of the host, and compares them with
// menu.golden.json. Loads the real main.js in a vm, like orca-menu's close-row.test.js. Delete the
// json to re-record after an intended change.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("./main.js", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "").replace("export default class SplitMenu", "class SplitMenu");
const SCRIPT = new vm.Script(`${SOURCE}\n;globalThis.__Menu = SplitMenu;`, { filename: new URL("./main.js", import.meta.url).pathname });
const GOLDEN = new URL("./menu.golden.json", import.meta.url);

const plain = x => JSON.parse(JSON.stringify(x, (_k, v) => typeof v === "function" ? "fn" : v));

// One digest per scenario and section keeps the golden small; a mismatch names the section.
const canon = x => Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x;
const sha = x => createHash("sha1").update(JSON.stringify(canon(x))).digest("hex");
const digest = x => sha(plain(x));
const summary = got => Object.fromEntries(Object.entries(plain(got)).map(([name, sections]) => [name, Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, sha(v)]))]));

// A node is a proxy that logs every chained call; handlers are kept so the test can run them.
function recorder(handlers) {
  const cleanse = a => a?.__node ? a.__node : Array.isArray(a) ? a.map(cleanse) : typeof a === "function" ? "fn"
    : a && typeof a === "object" ? Object.fromEntries(Object.entries(a).map(([k, v]) => [k, cleanse(v)])) : a;
  const node = (name, args) => {
    const rec = { n: name, a: args.map(cleanse), c: [] };
    const proxy = new Proxy(function () {}, {
      get(_t, key) {
        if (key === "__node") return rec;
        if (typeof key === "symbol") return undefined;
        return (...a) => {
          if (key === "when") { if (a[0]) { const r = a[1](proxy); if (r !== proxy) rec.c.push(["when", cleanse(r)]); } return proxy; }
          if (key.startsWith("on_")) handlers.push([key, a[0]]);
          rec.c.push([key, a.map(cleanse)]);
          return proxy;
        };
      },
    });
    return proxy;
  };
  return name => (...args) => node(name, args);
}

const pane = (id, tab, more = {}) => ({ pane: id, tab, ...more });
const SCENARIOS = {
  "two panes, target given": { props: { overlay: "ov", target: { pane: "b" } }, panes: [pane("a", "t", { focused: true }), pane("b", "t")] },
  "two panes, zoomed focus": { props: { overlay: "ov" }, panes: [pane("a", "t", { focused: true, zoomed: true }), pane("b", "t"), pane("c", "u")] },
  "one pane": { props: { overlay: "ov" }, panes: [pane("a", "t", { focused: true })] },
  "unknown target falls back to focus": { props: { overlay: "ov", target: { pane: "zz" } }, panes: [pane("a", "t"), pane("b", "t", { focused: true })], light: true },
  "no focus, no target": { props: undefined, panes: [pane("a", "t"), pane("b", "t")] },
  "no panes": { props: { overlay: "ov" }, panes: [] },
  "panes unavailable": { props: { overlay: "ov" }, panes: undefined, picked: null },
};
const KEYS = [
  { key: "down" }, { key: "up" }, { key: "home" }, { key: "end" }, { key: "enter" }, { key: "space" }, { key: "escape" },
  ...["1", "2", "3", "4", "r", "l", "d", "u", "f", "c", "o", "7", "8", "9", "0", "z", "x", "q"].map(key => ({ key })),
  ...["F", "C", "O"].map(key => ({ key, modifiers: { shift: true } })), { key: "f", modifiers: { shift: true } },
  { key: "C" }, { key: "Z", modifiers: { shift: false } },
];

function start(scn, effects) {
  const handlers = [];
  const log = (name, ...args) => effects.push([name, ...plain(args)]);
  const jobs = [];
  const scope = {
    View: class {}, panes: () => scn.panes, props: () => scn.props, theme: () => ({ appearance: scn.light ? "light" : "dark", foreground: "fg", popover: "pop", selected: "sel", muted: "mu", border: "bd" }),
    run: (...a) => log("run", ...a), closeOverlay: id => log("closeOverlay", id), pickFolder: async o => { log("pickFolder", o); return scn.picked === undefined ? "/picked" : scn.picked; },
    div: recorder(handlers)("div"), svg: recorder(handlers)("svg"), h_flex: recorder(handlers)("h_flex"), v_flex: recorder(handlers)("v_flex"),
  };
  vm.createContext(scope);
  SCRIPT.runInContext(scope);
  const cx = { notify: () => effects.push(["notify"]), spawn: job => jobs.push(job), focus_handle: () => ({ focus() { effects.push(["focus"]); } }) };
  const menu = new scope.__Menu();
  menu.init({}, cx);
  return { menu, cx, handlers, jobs };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
async function settle(jobs, cx) { for (const job of jobs.splice(0)) await job(cx); await flush(); }

async function record(scn) {
  const out = {};
  const { menu, cx, handlers } = start(scn, []);
  const rows = menu.items();
  out.rows = plain(rows);
  out.render = [];
  for (const at of [0, 3, 99]) { menu.at = at; handlers.length = 0; out.render.push([digest(menu.render(cx).__node), menu.at]); }
  out.keys = [];
  for (const press of KEYS) for (const at of [0, rows.length - 1]) {
    const effects = [];
    const w = start(scn, effects);
    w.menu.at = Math.max(at, 0);
    w.handlers.length = 0;
    w.menu.render(w.cx);
    effects.length = 0;
    w.handlers.find(([name]) => name === "on_key_down")[1](press, w.cx);
    await settle(w.jobs, w.cx);
    out.keys.push([press.key, press.modifiers?.shift ?? null, at, w.menu.at, plain(effects)]);
  }
  out.choose = [];
  for (let i = 0; i <= rows.length; i++) {
    const effects = [];
    const w = start(scn, effects);
    effects.length = 0;
    w.menu.choose(i, w.cx);
    await settle(w.jobs, w.cx);
    out.choose.push(plain(effects));
  }
  const effects = [];
  const w = start(scn, effects);
  w.handlers.length = 0; w.menu.render(w.cx); effects.length = 0;
  const hover = w.handlers.filter(([name]) => name === "on_hover").map(([, fn]) => fn);
  const click = w.handlers.filter(([name]) => name === "on_click").map(([, fn]) => fn);
  if (hover.length) { hover[hover.length - 1](false, w.cx); hover[hover.length - 1](true, w.cx); out.hover = [w.menu.at, plain(effects)]; }
  if (click.length) { effects.length = 0; click[0]({}, w.cx); await settle(w.jobs, w.cx); out.click = plain(effects); }
  return out;
}

test("every layout records as before", async () => {
  const got = {};
  for (const [name, scn] of Object.entries(SCENARIOS)) got[name] = await record(scn);
  const now = summary(got);
  if (!existsSync(GOLDEN)) writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`);
  const expected = JSON.parse(readFileSync(GOLDEN, "utf8"));
  const changes = Object.fromEntries(Object.entries(now).flatMap(([scenario, sections]) => {
    const changed = Object.fromEntries(Object.entries(sections).filter(([key, value]) => expected[scenario]?.[key] !== value));
    return Object.keys(changed).length ? [[scenario, changed]] : [];
  }));
  if (Object.keys(changes).length) console.log("GOLDEN_CHANGED " + JSON.stringify(changes));
  assert.deepEqual(now, expected);
});

test("the folder rows split only after a folder is picked", async () => {
  for (const [picked, expected] of [["/p", [["run", "pane.split", { direction: "right", pane: "a", folder: "/p" }]]], [null, []]]) {
    const effects = [];
    const { menu, cx, jobs } = start({ props: { overlay: "ov" }, panes: [pane("a", "t", { focused: true })], picked }, effects);
    menu.choose(menu.items().findIndex(row => row.id === "split-folder-right"), cx);
    effects.length = 0;
    await settle(jobs, cx);
    assert.deepEqual(effects.filter(e => e[0] === "run"), expected);
  }
});

test("left/up swaps address the original target rather than the focused pane", () => {
  for (const [id, direction] of [["split-left", "right"], ["split-up", "down"]]) {
    const effects = [];
    const { menu, cx } = start(SCENARIOS["two panes, target given"], effects);
    menu.choose(menu.items().findIndex(row => row.id === id), cx);
    assert.deepEqual(effects.filter(e => e[0] === "run"), [["run", "pane.split", { direction, pane: "b" }], ["run", "pane.swap", { direction, pane: "b" }]]);
  }
});
