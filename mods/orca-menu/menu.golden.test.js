// Characterization test for main.js: for a matrix of scenarios (each menu kind, with and without
// the facts each row looks at) it records the rows, icons, separators, destructive flags, the render
// tree and what choosing every row asks of the host, and compares them with menu.golden.json.
// Loads the real main.js in a vm, like close-row.test.js. Delete the json to re-record after an
// intended change.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { closeRows } from "./close-space.js";
import { closeSideTabs } from "./close-sides.js";

const SOURCE = readFileSync(new URL("./main.js", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "").replace("export default class Menu", "class Menu");
const SCRIPT = new vm.Script(SOURCE + `
;globalThis.__t = { Menu, items, menuIcon, section, isDestructive, closeRow, keyHint, shortcut, unpinnedTabs, checkout, stored };`, { filename: new URL("./main.js", import.meta.url).pathname });
const GOLDEN = new URL("./menu.golden.json", import.meta.url);

// A render tree is long, so the golden keeps its digest; a mismatch is found by diffing the trees.

// One digest per scenario and section keeps the golden small; a mismatch names the section.
const canon = x => Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x;
const sha = x => createHash("sha1").update(JSON.stringify(canon(x))).digest("hex");
const digest = x => sha(plain(x));
const summary = got => Object.fromEntries(Object.entries(plain(got)).map(([name, sections]) => [name, Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, sha(v)]))]));
const plain = x => JSON.parse(JSON.stringify(x, (k, v) => typeof v === "function" ? "fn" : k === "at" && typeof v === "number" ? "<now>" : v));

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

const tab = (id, more = {}) => ({ id, ...more });
const SPACES = [
  { id: "s1", folder: "/repo", machine: null, name: "repo", branch: "main", tabs: [tab("t1", { named: true, name: "Build", settled: true }), tab("t2"), tab("t3", { settled: true, status: "working" })] },
  { id: "s2", folder: "/repo", machine: null, name: "repo2", tabs: [tab("t4"), tab("t6", { settled: true })] },
  { id: "s3", folder: "/repo/wt", machine: "m", named: true, name: "Linked", tabs: [tab("t5")] },
  { id: "s4", folder: "/other", machine: null, name: "other", tabs: [tab("t7", { status: "blocked" })] },
];
const PANES = [
  { pane: "p1", tab: "t1", focused: true, program: { agent: "claude", name: "claude" }, status: "working", title: "Claude", zoomed: true },
  { pane: "p2", tab: "t1", program: { name: "zsh", shell: true } },
  { pane: "p3", tab: "t2", program: { name: "vim" }, title: "" },
  { pane: "p4", tab: "t4" },
  { pane: "p5", tab: "t3", status: "blocked" },
  { pane: "p6", tab: "t5", program: { name: "zsh", shell: true } },
  { pane: "p7", tab: "t6" },
  { pane: "p8", tab: "t7" },
];
const TERMINALS = [
  { address: "a1", agent: true, parent: "a0", labels: { "herdr.right-click": "program" } },
  { address: "a0", name: "Boss" }, { address: "a2" }, { address: "a3", parent: "zz" },
];
const KEYS = [
  { action: "pane.split:right", keys: "cmd-d" }, { action: "tab.close", keys: "cmd-w" }, { action: "app.help", keys: "f1" },
  { action: "tab.rename", keys: "f2" }, { action: "pane.zoom", keys: "ctrl-shift-alt-z" }, { action: "space.new", keys: "cmd-n" },
];

const withPane = (pane, extra = {}) => ({ tab: "pane", overlay: "ov", target: { pane, terminal: "a1", ...extra } });
const SCENARIOS = {
  "pane, agent in a split tab": { props: withPane("p1") },
  "pane, shell in the same tab": { props: withPane("p2", { terminal: "a2" }) },
  "pane, alone in a pinned tab": { props: withPane("p7", { terminal: "a2" }) },
  "pane, alone in an unpinned tab": { props: withPane("p4", { terminal: "a3" }) },
  "pane, no terminal and no known pane": { props: withPane(undefined, { terminal: undefined }) },
  "pane, unknown ids": { props: withPane("nope", { terminal: "nope" }) },
  "tab with panes, pinned, split": { props: { tab: "tab", overlay: "ov", target: { id: "t1", space: "s1" } } },
  "tab, running command": { props: { tab: "tab", overlay: "ov", target: { id: "t2" } } },
  "tab, agent status, pinned": { props: { tab: "tab", overlay: "ov", target: { id: "t3" } } },
  "tab, only tab of its space": { props: { tab: "tab", overlay: "ov", target: { id: "t5" } } },
  "tab, no panes": { props: { tab: "tab", overlay: "ov", target: { id: "t6" } } },
  "tab, blocked status, unnamed": { props: { tab: "tab", overlay: "ov", target: { id: "t7" } } },
  "tab, unknown": { props: { tab: "tab", overlay: "ov", target: { id: "zz" } } },
  "tab, pinned close skipped": { props: { tab: "tab", overlay: "ov", target: { id: "t1" } }, ls: { "orca.confirmClosePinnedTab": "false" } },
  "tab, running close skipped": { props: { tab: "tab", overlay: "ov", target: { id: "t2" } }, ls: { "orca.skipCloseTerminalWithRunningProcessConfirm": "true" } },
  "tab, storage throws": { props: { tab: "tab", overlay: "ov", target: { id: "t1" } }, lsThrows: true },
  "group, open space with children": { props: { tab: "group", overlay: "ov", target: { id: "s1", path: "/repo", spaces: ["s1", "s2", "s3", "x:1"], repo: "r1", machine: "m" } } },
  "group, unopened project": { props: { tab: "group", overlay: "ov", target: { id: "gone", path: "/nowhere", repo: "r2" } } },
  "group, by folder prefix": { props: { tab: "group", overlay: "ov", target: { id: "g", path: "/repo" } } },
  "group, nothing at all": { props: { tab: "group", overlay: "ov", target: {} } },
  "space, open and linked": { props: { tab: "space", overlay: "ov", target: { id: "s3", linked: true, folder: "/repo/wt", branch: "feat", unread: true, machine: "m" } } },
  "space, open, main checkout": { props: { tab: "space", overlay: "ov", target: { id: "s1", linked: false, top: "/repo", repo: "r1" } } },
  "space, open, probe says linked": { props: { tab: "space", overlay: "ov", target: { id: "s3" } }, exec: { top: "/repo/wt", common: "/repo/.git" } },
  "space, open, probe says main": { props: { tab: "space", overlay: "ov", target: { id: "s1" } }, exec: { top: "/repo", common: "/repo/.git" } },
  "space, open, probe fails": { props: { tab: "space", overlay: "ov", target: { id: "s1" } }, exec: { fail: true } },
  "space, open, probe throws": { props: { tab: "space", overlay: "ov", target: { id: "s1" } }, exec: { throws: true } },
  "space, unopened card with repo": { props: { tab: "space", overlay: "ov", multi: true, target: { id: "wt:/x", linked: true, path: "/x", named: true, name: "Pretty", repo: "r3", machine: "m" } } },
  "space, unopened card, folder only": { props: { tab: "space", overlay: "ov", target: { id: "wt:/y", folder: "/y/" } }, exec: { fail: true } },
  "global": { props: { tab: "global", overlay: "ov" } },
  "no props": { props: undefined },
};

function world(scn, effects) {
  const ls = new Map(Object.entries(scn.ls ?? {}));
  const handlers = [];
  const log = (name, ...args) => effects.push([name, ...plain(args)]);
  const exec = scn.exec;
  const scope = {
    View: class {}, closeRows, closeSideTabs, props: () => scn.props,
    div: recorder(handlers)("div"), svg: recorder(handlers)("svg"), h_flex: recorder(handlers)("h_flex"), v_flex: recorder(handlers)("v_flex"),
    theme: () => ({ foreground: "fg", popover: "pop", selected: "sel", muted: "mu", border: "bd" }),
    keys: () => KEYS, terminals: () => TERMINALS, spaces: () => SPACES, panes: () => PANES, home: () => "/home",
    run: (...a) => log("run", ...a), closeOverlay: id => log("closeOverlay", id), openOverlay: a => log("openOverlay", a),
    setShared: (...a) => log("setShared", ...a), copyText: (...a) => log("copyText", a[0]),
    hc: (args) => { log("hc", args); return Promise.resolve(scn.hc ?? { code: 0, stdout: "line one\nline two\n" }); },
    buildBoundedSessionTranscript: text => text.trim() && `clean:${text.trim()}`,
    shared: () => null,
    exec: async (cmd, args) => {
      if (exec?.throws) throw new Error("boom");
      if (exec?.fail) return { code: 1, stdout: "" };
      return { code: 0, stdout: args.includes("--show-toplevel") ? exec?.top : exec?.common };
    },
    window: { appearance: () => scn.dark === false ? "light" : "dark" },
    localStorage: {
      getItem: k => { if (scn.lsThrows) throw new Error("denied"); return ls.has(k) ? ls.get(k) : null; },
      setItem: (k, v) => { if (scn.lsThrows) throw new Error("denied"); ls.set(k, v); log("localStorage.setItem", k, v); },
    },
  };
  vm.createContext(scope);
  SCRIPT.runInContext(scope);
  return { t: scope.__t, handlers, scope };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const cxFor = (jobs, effects) => ({ notify: () => effects.push(["notify"]), spawn: job => jobs.push(job), focus_handle: () => ({ focus() { effects.push(["focus"]); } }) });
async function started(scn, effects) {
  const w = world(scn, effects);
  const jobs = [];
  const cx = cxFor(jobs, effects);
  const menu = new w.t.Menu();
  menu.init({}, cx);
  for (const job of jobs) await job(cx);
  return { ...w, menu, cx };
}

async function record(scn) {
  const out = {};
  const setup = [];
  const { t, menu, handlers, cx } = await started(scn, setup);
  const p = scn.props;
  const rows = t.items(p, menu.git);
  out.init = { git: menu.git, effects: setup };
  out.rows = plain(rows);
  out.icons = rows.map(row => [t.menuIcon(row, false), t.menuIcon(row, true)]);
  out.sections = rows.map((_row, i) => t.section(p, rows, i));
  out.destructive = rows.map(row => t.isDestructive(p, row));
  out.closeRow = rows.map(row => t.closeRow(p, row));
  out.shortcuts = rows.map(row => t.shortcut(row[1], row[2]));
  out.render = [];
  if (rows.length) for (const at of [0, rows.length - 1]) {
    menu.at = at;
    handlers.length = 0;
    out.render.push(digest(menu.render(cx).__node));
  }
  // The handlers of the last render: keys drive the cursor, hover moves it, click chooses.
  const keyEffects = [];
  const driver = handlers.find(([name]) => name === "on_key_down")?.[1];
  const cursor = [];
  if (driver && rows.length) for (const key of ["down", "down", "up", "up", "end", "home", "x", "space", "enter", "escape"]) {
    const effects = [];
    const w = await started(scn, effects);
    const rendered = w.menu; rendered.at = key === "x" ? 1 : 0;
    w.handlers.length = 0; rendered.render(w.cx);
    effects.length = 0;
    w.handlers.find(([name]) => name === "on_key_down")[1]({ key }, w.cx);
    await flush();
    cursor.push([key, rendered.at, plain(effects)]);
  }
  out.keys = cursor;
  const hover = handlers.filter(([name]) => name === "on_hover").map(([, fn]) => fn);
  if (hover.length > 1) {
    const effects = [];
    menu.at = 0;
    hover[1](true, cx); hover[1](false, cx);
    out.hover = [menu.at, plain(effects)];
  }
  out.choose = [];
  for (let i = 0; i <= rows.length; i++) {
    const effects = [];
    const w = await started(scn, effects);
    effects.length = 0;
    w.menu.choose(i, w.cx);
    await flush();
    out.choose.push(plain(effects));
  }
  const clicks = [];
  const w = await started(scn, clicks);
  w.handlers.length = 0; w.menu.render(w.cx);
  const click = w.handlers.filter(([name]) => name === "on_click").map(([, fn]) => fn);
  clicks.length = 0;
  if (click.length) { click[click.length - 1]({}, w.cx); await flush(); }
  out.click = plain(clicks);
  return out;
}

test("every menu records as before", async () => {
  const got = {};
  for (const [name, scn] of Object.entries(SCENARIOS)) got[name] = await record(scn);
  const now = summary(got);
  if (!existsSync(GOLDEN)) writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`);
  assert.deepEqual(now, JSON.parse(readFileSync(GOLDEN, "utf8")));
});

test("copy and transcript rows act on their own data", async () => {
  const effects = [];
  const scn = { props: { tab: "pane", overlay: "ov", target: { pane: "p1", terminal: "a1" } }, hc: { code: 0, stdout: "  \n" } };
  const { menu, cx, t } = await started(scn, effects);
  for (const label of ["Copy Context", "Copy Terminal Buffer", "Clear Screen", "Reset Terminal"]) {
    effects.length = 0;
    menu.choose(t.items(scn.props, null).findIndex(row => row[0] === label), cx);
    await flush();
    assert.ok(effects.some(e => e[0] === "closeOverlay"), label);
    assert.equal(effects.some(e => e[0] === "copyText"), false, label);
  }
});

test("key hints use glyphs for modifiers and keep a bare key as it is", async () => {
  const { t } = await started({ props: undefined }, []);
  assert.deepEqual(["cmd-shift-d", "f2", undefined, "ctrl-alt-x", "cmd-w"].map(t.keyHint), ["⇧⌘D", "f2", "", "⌃⌥X", "⌘W"]);
});

test("stored values are cached by raw text, and bad json falls back", async () => {
  const { t } = await started({ props: undefined, ls: { good: '{"a":1}', arr: "[1]", bad: "{" } }, []);
  assert.deepEqual(plain([t.stored("good", 0), t.stored("good", 0), t.stored("arr", "f"), t.stored("bad", "f"), t.stored("none", "f")]), [{ a: 1 }, { a: 1 }, [1], "f", "f"]);
});
