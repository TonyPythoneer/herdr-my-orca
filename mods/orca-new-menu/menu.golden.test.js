// Characterization test for main.js: for several hosts (local with a fresh inventory, probes only,
// nothing installed, a failing catalog, a remote machine) it records the rows, the render tree, what
// every key, click, hover and row asks of the host, and the model picker, and compares them with
// menu.golden.json. Loads the real main.js in a vm, like inventory.test.js. Delete the json to
// re-record after an intended change.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { register } from "node:module";
import vm from "node:vm";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { MODELS } = await import("./models.js");
const rowsApi = await import("./rows.js");
const { detectFreebuff } = await import("./freebuff.js");

const SOURCE = readFileSync(new URL("./main.js", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "").replace("export default class NewMenu", "class NewMenu");
const SCRIPT = new vm.Script(`${SOURCE}\n;globalThis.__Menu = NewMenu;`, { filename: new URL("./main.js", import.meta.url).pathname });
const GOLDEN = new URL("./menu.golden.json", import.meta.url);

const plain = x => JSON.parse(JSON.stringify(x, (k, v) => typeof v === "function" ? "fn" : k === "at" && typeof v === "number" && v > 1e12 ? "<now>" : v));

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
          if (key === "hover") { const inner = node("hover", []); a[0](inner); rec.c.push(["hover", inner.__node]); return proxy; }
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

const NOW = Date.now();
const agent = (key, more = {}) => ({ key, name: key[0].toUpperCase() + key.slice(1), installed: true, run: [key], icon: `/i/${key}.svg`, ...more });
const ALL = ["claude", "codex", "gemini", "grok", "omp", "antigravity", "kimi", "pi", "opencode", "notofficial"].map(k => agent(k, k === "kimi" ? { tint: true } : {}));
const KEYS_LIST = [{ section: "global", action: "orca-header.new-tab", keys: "ctrl-shift-t" }];
const space = (more = {}) => ({ id: "s1", active: true, folder: "/repo", machine: null, ...more });
const OMP = JSON.stringify({ models: [{ selector: "p/a", name: "A" }, { provider: "q", id: "b" }, { id: "default" }, null, { name: "x" }] });
const AGY = "fetching\nslug-a\tLabel A\nslug-b\t \n\nslug-c\tLabel C\n";

const HOSTS = {
  "local, fresh inventory, freebuff on": {
    spaces: [space()], panes: [{ pane: "p1", focused: true, cwd: "/repo/sub" }], known: ALL.map(a => ({ ...a, installed: a.key !== "grok" })),
    shared: { "agent-manager.inventory": { at: NOW, agents: ALL.map(a => ({ ...a, run: a.key === "claude" ? ["/c/claude", "--x"] : a.run })), disabled: ["pi"], freebuff: true } },
    exec: { omp: OMP, agy: AGY, freebuff: true }, mac: true,
    viewports: [{ width: 1200, height: 800 }, { width: 700, height: 600 }, { width: 330, height: 300 }],
  },
  "local, probes only, manager file and overrides": {
    spaces: [space({ folder: undefined })], panes: [], known: ALL.slice(0, 7).map((a, i) => ({ ...a, installed: i !== 2 })), shared: {},
    files: { "/home/app/agent-manager.json": '{"disabled":["codex",3]}', "/home/app/programs.json": JSON.stringify({ programs: { claude: { run: ["claude", "--prog"] }, codex: { run: [] }, kimi: { run: [1] } } }) },
    exec: { omp: "no json", agy: new Error("missing"), freebuff: true },
  },
  "local, programs.json is not json": {
    spaces: [space()], panes: [{ pane: "p1", cwd: "/w" }], known: ALL.slice(0, 3), shared: {}, files: { "/home/app/programs.json": "{", "/home/app/agent-manager.json": "{" }, exec: { freebuff: "throws" },
    ls: { "new-menu.models.v1": JSON.stringify({ omp: { at: NOW, models: [{ id: "cached", label: "Cached" }] }, antigravity: { at: 1, models: [{ id: "old", label: "Old" }] } }) },
  },
  "local, nothing installed, no freebuff": { spaces: [space()], panes: [], known: ALL.map(a => ({ ...a, installed: false })), shared: {}, exec: { freebuff: false } },
  "local, catalog fails": { spaces: [space()], panes: [], known: new Error("down"), shared: {}, exec: { freebuff: false }, files: { "/home/app/agent-manager.json": new Error("denied") } },
  "local, catalog fails after an inventory": {
    spaces: [space()], panes: [], known: new Error("down"), shared: { "agent-manager.inventory": { at: NOW, agents: [agent("claude")], disabled: [], freebuff: false } }, exec: { freebuff: false },
  },
  "remote machine": { spaces: [space({ machine: "m1" })], panes: [{ pane: "p1", focused: true }], known: ALL.slice(0, 4), shared: { "agent-manager.inventory": { at: NOW, agents: ALL, disabled: ["claude"], freebuff: true } }, exec: { freebuff: true }, mac: false },
  "checking, no space": { spaces: [], panes: [], known: ALL.slice(0, 2), shared: {}, exec: {}, checking: true },
  "inventory says freebuff but manager disabled it": {
    spaces: [space()], panes: [], known: [], shared: { "agent-manager.inventory": { at: NOW, agents: [agent("claude")], disabled: ["freebuff"], freebuff: true } }, exec: { freebuff: true },
  },
};

const KEY_PRESSES = ["down", "up", "home", "end", "enter", "space", "escape", "x"].map(key => ({ key }));

function start(host, effects) {
  const handlers = [];
  const jobs = [];
  const timers = [];
  const inputHandlers = {};
  const log = (name, ...args) => effects.push([name, ...plain(args)]);
  const fail = value => { if (value instanceof Error) throw value; return value; };
  const files = host.files ?? {};
  const ls = new Map(Object.entries(host.ls ?? {}));
  const shared = new Map(Object.entries(host.shared ?? {}));
  let opened = 0;
  globalThis.__herdrExec = async (cmd, args) => {
    log("exec", cmd, args);
    const spec = host.exec ?? {};
    if (cmd === "zsh") { if (spec.freebuff === "throws") throw new Error("no zsh"); return { code: spec.freebuff ? 0 : 1, stdout: "" }; }
    const out = fail(spec[cmd]);
    return { code: 0, stdout: out ?? "" };
  };
  const input = {
    on: (event, fn) => { inputHandlers[event] = fn; }, value: () => host.typed ?? "", set_value: v => log("input.set_value", v), focus: () => log("input.focus"),
  };
  const scope = {
    View: class {}, MODELS, ...rowsApi, detectFreebuff,
    div: recorder(handlers)("div"), svg: recorder(handlers)("svg"), image: recorder(handlers)("image"),
    v_flex: recorder(handlers)("v_flex"), h_flex: recorder(handlers)("h_flex"),
    InputState: { new: () => input }, Input: { new: (...a) => recorder(handlers)("Input.new")(...a) },
    checking: () => Boolean(host.checking), theme: () => ({ popover: "pop", foreground: "fg", selected: "sel", muted: "mu", dim: "dim", border: "bd", ring: "rg", input: "in", hover: "hv" }),
    spaces: () => host.spaces, panes: () => host.panes, appHome: () => "/home/app",
    knownAgents: async opts => { log("knownAgents", opts); return fail(host.known); },
    run: (...a) => log("run", ...a), props: () => ({ overlay: "menu" }), closeOverlay: id => log("closeOverlay", id),
    openOverlay: a => { log("openOverlay", a); return `pop${++opened}`; },
    pickFolder: async o => { log("pickFolder", o); return host.picked === undefined ? "/picked" : host.picked; },
    keys: () => KEYS_LIST, appWindow: () => ({ platform: host.mac ? "macos" : "linux" }),
    shared: key => shared.get(key), setShared: (key, value) => { shared.set(key, value); log("setShared", key, value); },
    readTextFile: async path => fail(files[path]), exec: async (cmd, args, opts) => globalThis.__herdrExec(cmd, args, opts),
    window: { viewport_size: () => host.viewport ?? { width: 1000, height: 700 } },
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, v); log("localStorage.setItem", k, v.replace(/"at":\d+/g, '"at":"<now>"')); } },
  };
  vm.createContext(scope);
  SCRIPT.runInContext(scope);
  const cx = {
    notify: () => effects.push(["notify"]), spawn: job => jobs.push(job), focus_handle: () => ({ focus() { effects.push(["focus"]); } }),
    timer: { after: (ms, fn) => timers.push([ms, fn]) },
  };
  const menu = new scope.__Menu();
  return { menu, cx, handlers, jobs, timers, inputHandlers, shared, input, scope };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
async function settle(w) {
  for (let round = 0; round < 4; round++) {
    for (const job of w.jobs.splice(0)) await job(w.cx);
    for (const [, fn] of w.timers.splice(0)) fn();
    await flush();
  }
}
async function opened(host, effects = []) {
  const w = start(host, effects);
  w.menu.init({}, w.cx);
  await settle(w);
  return w;
}

const state = menu => ({
  at: menu.at, backAt: menu.backAt, picking: menu.picking?.key ?? null, models: menu.models, modelsFailed: menu.modelsFailed, filter: menu.filter, machine: menu.machine,
  agents: menu.agents?.map(a => `${a.key}${a.installed ? "+" : "-"}${a.run?.join(" ")}`) ?? null, agentsFailed: menu.agentsFailed,
  disabled: [...menu.disabled].sort(), disabledReady: menu.disabledReady, freebuff: menu.freebuff,
});
const listOf = menu => menu.list().map(r => ({
  label: r.label, hint: r.hint, icon: r.icon, image: r.image, sep: r.sep, section: r.section, disabled: r.disabled,
  kind: r.stay ? "stay" : r.pick ? "pick" : r.config ? `config:${r.config.key}` : r.run ? "run" : "none", program: r.program?.key,
}));
const view = w => { w.handlers.length = 0; const tree = digest(w.menu.render(w.cx).__node); return tree; };

async function record(host) {
  const out = {};
  const effects = [];
  const w = await opened(host, effects);
  out.init = { effects: plain(effects), state: state(w.menu), shared: [...w.shared.entries()], state2: plain(w.menu.currentState()) };
  out.rows = listOf(w.menu);
  out.create = plain(w.menu.createRows().map(r => ({ ...r, run: undefined })));
  out.render = [];
  for (const at of [0, 4, 99]) { w.menu.at = at; out.render.push([view(w), w.handlers.length]); }
  const count = w.menu.list().length;

  out.choose = [];
  for (let i = 0; i <= count; i++) {
    const log = [];
    const x = await opened(host, log);
    log.length = 0;
    x.menu.choose(i, x.cx);
    await settle(x);
    out.choose.push([plain(log), state(x.menu), listOf(x.menu).length]);
  }

  out.keys = [];
  for (const press of KEY_PRESSES) for (const at of [0, count - 1]) {
    const log = [];
    const x = await opened(host, log);
    x.menu.at = Math.max(at, 0);
    view(x);
    log.length = 0;
    x.handlers.find(([name]) => name === "on_key_down")[1](press, x.cx);
    await settle(x);
    out.keys.push([press.key, at, plain(log), state(x.menu)]);
  }

  out.wheel = [];
  for (const dy of [0, 2, -2]) {
    const log = [];
    const x = await opened(host, log);
    view(x);
    log.length = 0;
    x.handlers.find(([name]) => name === "on_scroll_wheel")[1]({ delta: { y: dy } }, x.cx);
    out.wheel.push([dy, plain(log), x.menu.at]);
  }

  out.pointer = [];
  const x = await opened(host, []);
  view(x);
  const hovers = x.handlers.filter(([name]) => name === "on_hover");
  const moves = x.handlers.filter(([name]) => name === "on_mouse_move");
  const log = [];
  x.cx.notify = () => log.push(["notify"]);
  for (const [, fn] of hovers) { fn(false, x.cx); fn(true, x.cx); out.pointer.push(["hover", x.menu.at]); }
  const rowEvent = (xPos, y) => ({ position: { x: 300 + xPos, y: 100 + y }, local_position: { x: xPos, y }, bounds: { width: 272 } });
  for (const [, fn] of moves) for (const e of [{}, rowEvent(10, 5), rowEvent(250, 5)]) {
    log.length = 0; fn(e, x.cx); await settle(x);
    out.pointer.push(["move", plain(log), plain(x.menu.rowEdge ?? null)]);
  }
  out.flyout = [];
  for (const viewport of host.viewports ?? []) {
    const f = await opened({ ...host, viewport }, []);
    view(f);
    const trackers = f.handlers.filter(([name]) => name === "on_mouse_move");
    if (trackers.length) { trackers[0][1](rowEvent(250, 20), f.cx); out.flyout.push([viewport, plain(f.menu.rowEdge)]); }
  }
  const clickLog = [];
  const y = await opened(host, clickLog);
  view(y);
  clickLog.length = 0;
  const clickFns = y.handlers.filter(([name]) => name === "on_click");
  if (clickFns.length) { clickFns[clickFns.length - 1][1]({}, y.cx); await settle(y); }
  out.click = plain(clickLog);

  // The model picker of every row that has one.
  out.picker = {};
  for (const [i, row] of listOf(w.menu).entries()) {
    if (row.kind !== "stay") continue;
    const log2 = [];
    const p = await opened(host, log2);
    p.menu.choose(i, p.cx);
    await settle(p);
    const steps = { after: [state(p.menu), listOf(p.menu), view(p), plain(log2)] };
    for (const typed of ["", "g", "zzz"]) {
      p.inputHandlers.change?.({}, p.cx);
      p.menu.filter = typed; p.menu.at = 0;
      steps[`filter ${typed}`] = [listOf(p.menu), view(p)];
    }
    p.menu.at = 1;
    p.inputHandlers.submit?.({}, p.cx);
    await settle(p);
    steps.submit = [plain(log2.slice(-4)), state(p.menu)];
    steps.keys = [];
    for (const press of KEY_PRESSES) {
      const q = await opened(host, []);
      q.menu.choose(i, q.cx);
      await settle(q);
      view(q);
      q.handlers.find(([name]) => name === "on_key_down")[1](press, q.cx);
      await settle(q);
      steps.keys.push([press.key, state(q.menu)]);
    }
    const r = await opened(host, []);
    r.menu.choose(i, r.cx);
    await settle(r);
    view(r);
    const rowClicks = r.handlers.filter(([name]) => name === "on_click");
    rowClicks[rowClicks.length - 1][1]({}, r.cx);
    steps.back = state(r.menu);
    out.picker[row.label] = steps;
  }
  return out;
}

test("every host records as before", async () => {
  const got = {};
  for (const [name, host] of Object.entries(HOSTS)) got[name] = await record(host);
  const now = summary(got);
  if (!existsSync(GOLDEN)) writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`);
  assert.deepEqual(now, JSON.parse(readFileSync(GOLDEN, "utf8")));
});

test("the flyout opens through the orca-agent-flyout popup and swaps for another agent", async () => {
  const log = [];
  const w = await opened(HOSTS["local, fresh inventory, freebuff on"], log);
  const claude = w.menu.agents.find(a => a.key === "claude");
  const codex = w.menu.agents.find(a => a.key === "codex");
  w.menu.hoverConfig(claude, true, false);
  w.menu.hoverConfig(claude, true, false);
  w.menu.hoverConfig(codex, true, false);
  w.menu.hoverConfig(codex, false, false);
  w.menu.closeFlyout();
  assert.deepEqual(plain(log.filter(e => ["closeOverlay", "setShared"].includes(e[0]))), [
    ["setShared", "orca-agent-flyout", { id: "pop1", key: "claude" }], ["closeOverlay", "pop1"],
    ["setShared", "orca-agent-flyout", { id: "pop2", key: "codex" }], ["closeOverlay", "pop2"], ["setShared", "orca-agent-flyout", null],
  ]);
});
