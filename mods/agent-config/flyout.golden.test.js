// Characterization test for main.js: for each agent flyout in several worlds (saved settings, a
// fresh, stale or missing model cache, providers, another machine) it records what init leaves behind,
// the render tree, what every handler of the render does, and what each flyout method asks of the
// host, and compares them with flyout.golden.json. Loads the real main.js in a vm, like
// orca-menu's close-row.test.js. Delete the json to re-record after an intended change.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { register } from "node:module";
import vm from "node:vm";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const codexProvider = await import("./codex-provider.js");
const viewport = await import("./list-viewport.js");
const flyout = await import("./agent-flyout.js");

const SOURCE = readFileSync(new URL("./agent-config-view.js", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "").replace("export function createAgentConfigClass", "function createAgentConfigClass");
const SCRIPT = new vm.Script(`${SOURCE}\n;globalThis.__Menu = createAgentConfigClass(View);`, { filename: new URL("./agent-config-view.js", import.meta.url).pathname });
const managerUrl = new URL("../orca-agent-manager/agent-config-view.js", import.meta.url);
const managerSource = readFileSync(managerUrl, "utf8")
  .replace(/^import .*;$/gm, "").replace("export function createAgentConfigClass", "function createAgentConfigClass");
const MANAGER_SCRIPT = new vm.Script(`${managerSource}\n;globalThis.__Menu = createAgentConfigClass();`, { filename: managerUrl.pathname });
const GOLDEN = new URL("./flyout.golden.json", import.meta.url);

const stamp = text => String(text).replace(/"(checkedAt|at)": \d{10,}/g, '"$1": "<now>"');
const plain = x => x === undefined ? null : JSON.parse(JSON.stringify(x, (k, v) => typeof v === "function" ? "fn" : (k === "checkedAt" || k === "at") && typeof v === "number" && v > 1e12 ? "<now>" : v));

// One digest per scenario and section keeps the golden small; a mismatch names the section.
const canon = x => Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x;
const sha = x => createHash("sha1").update(JSON.stringify(canon(x))).digest("hex");
const digest = x => sha(plain(x));
const summary = got => Object.fromEntries(Object.entries(plain(got)).map(([name, sections]) => [name, Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, sha(v)]))]));

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
const STALE = 1;
const CODEX_MODELS = [
  { id: "m1", label: "Model One", efforts: ["low", "high"], fallbackEffort: "high" },
  { id: "m2", label: "Model Two", efforts: [], fallbackEffort: "high" },
  { id: "m3", label: "Model Three", efforts: ["low", "medium", "high"], fallbackEffort: "medium" },
];
const GROUPED = [
  { id: "opencode/a", label: "A", group: "free", free: true, efforts: ["", "high"], fallbackEffort: "high" },
  { id: "opencode/b", label: "B", group: "paid", efforts: [], fallbackEffort: "high" },
  { id: "omlx/c", label: "C", group: "omlx", efforts: [], fallbackEffort: "high" },
];
const catalog = (key, models, checkedAt = NOW, schema = 3) => ({ catalog: { [key]: { models, checkedAt, schema, version: "v1" } } });
const json = x => `${JSON.stringify(x, null, 2)}\n`;
const record = (name, over = {}) => ({ name, host: "http://127.0.0.1:8000/v1", apiKey: "k", githubOwner: "", iconPath: "", verifiedAt: "x", models: ["pm1", "pm2"], selectedModel: { codex: "pm2" }, ...over });
const PROVIDERS = json({ omlx: record("oMLX", { iconPath: "/home/omlx.png" }), outside: record("Elsewhere", { iconPath: "/x/y.png" }), plain: record("Plain"), bad: record("Bad", { host: "nope" }) });
const CLAUDE_REPLY = JSON.stringify({ type: "control_response", response: { response: { models: [{ value: "opus", displayName: "Opus", supportedEffortLevels: ["low", "high"] }, { value: "haiku", displayName: "Haiku" }] } } });
const CODEX_REPLY = JSON.stringify({ models: [{ slug: "g1", display_name: "G1", visibility: "list", supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }], default_reasoning_level: "high" }, { slug: "hide", visibility: "hide" }] });
const PI_TABLE = "provider  model        context  max-out  thinking  images\nacme      big-model    128k     8k       yes       no\nacme      small-model  8k       1k       no        no\n";

const WORLDS = {
  "codex, fresh cache, providers, saved choices": {
    key: "codex", argv: ["codex", "--no-daemon"],
    files: { "/home/agent-config.json": json({ codex: { model: "m3", effort: "low", hidden: ["m1"], preset: { codexOff: ["apps", "mcp"] } }, ...catalog("codex", CODEX_MODELS) }), "/home/model-providers.json": PROVIDERS, "/home/.codex/config.toml": '[mcp_servers.alpha]\n[mcp_servers."quoted name"]\n[other]\n', "/home/agent-manager.json": '{"disabled":["pi",4]}' },
  },
  "codex, fresh cache, launch now": {
    key: "codex", argv: ["codex"], launchNow: true,
    files: { "/home/agent-config.json": json({ codex: { model: "gone" }, ...catalog("codex", CODEX_MODELS) }), "/home/model-providers.json": PROVIDERS },
  },
  "codex, launch now but disabled in the manager": {
    key: "codex", argv: ["codex"], launchNow: true, files: { "/home/agent-config.json": json(catalog("codex", CODEX_MODELS)), "/home/agent-manager.json": '{"disabled":["codex"]}' },
  },
  "codex, stale cache, list changed": {
    key: "codex", argv: ["codex"], files: { "/home/agent-config.json": json({ codex: { model: "g1", effort: "high" }, ...catalog("codex", CODEX_MODELS, STALE) }) },
    exec: { version: "codex 2.0", models: CODEX_REPLY },
  },
  "codex, stale cache, same list, version fails": {
    key: "codex", argv: ["codex"], files: { "/home/agent-config.json": json(catalog("codex", [{ id: "g1", label: "G1", efforts: ["low", "high"], fallbackEffort: "high" }], STALE)) },
    exec: { version: new Error("no cli"), models: CODEX_REPLY }, launchNow: true,
  },
  "codex, stale cache, nothing listed": { key: "codex", argv: ["codex"], files: { "/home/agent-config.json": json(catalog("codex", CODEX_MODELS, STALE)) }, exec: { version: "v", models: JSON.stringify({ models: [] }) } },
  "codex, old schema, cli fails": { key: "codex", argv: ["codex"], files: { "/home/agent-config.json": json(catalog("codex", CODEX_MODELS, NOW, 1)) }, exec: { version: "v", models: new Error("offline") } },
  "codex, no settings file": { key: "codex", argv: ["codex"], files: {}, exec: { version: "v", models: CODEX_REPLY } },
  "codex, settings not json": { key: "codex", argv: ["codex"], files: { "/home/agent-config.json": "{" }, exec: { version: "v", models: CODEX_REPLY } },
  "codex, remote machine": {
    key: "codex", argv: ["codex"], machine: "m1", files: { "/home/agent-config.json": json(catalog("codex", CODEX_MODELS)), "/home/model-providers.json": PROVIDERS },
  },
  "claude, styles and editors": {
    key: "claude", argv: ["claude"], dark: false,
    files: { "/home/agent-config.json": json({ claude: { model: "haiku", effort: "high", preset: { outputStyle: "mine", advisorModel: "haiku", agents: "{bad", systemPrompt: "be brief" } }, ...catalog("claude", [{ id: "opus", label: "Opus", efforts: ["low", "high"], fallbackEffort: "high" }, { id: "haiku", label: "Haiku", efforts: [], fallbackEffort: "high" }]) }) },
    exec: { ls: "mine.md\nnotes.txt\nExplanatory.md\n" },
  },
  "claude, valid agents json": {
    key: "claude", argv: ["claude"], files: { "/home/agent-config.json": json({ claude: { preset: { agents: '{"a":{"x":1}}' } }, ...catalog("claude", [{ id: "opus", label: "Opus", efforts: ["low"], fallbackEffort: "low" }]) }) }, exec: { ls: new Error("no dir") },
  },
  "claude, no cache": { key: "claude", argv: ["claude"], files: {}, exec: { version: "1.0", models: CLAUDE_REPLY, ls: "" } },
  "opencode, groups, hidden models, variant file": {
    key: "opencode", argv: ["opencode"], files: { "/home/agent-config.json": json({ opencode: { model: "opencode/a", effort: "high", group: "paid", hidden: ["opencode/b"] }, ...catalog("opencode", GROUPED) }), "/home/.local/state/opencode/model.json": '{"variant":{"x":"y"}}' },
  },
  "opencode, all group, variant file missing": {
    key: "opencode", argv: ["opencode"], files: { "/home/agent-config.json": json({ opencode: { onlyFree: false, model: "omlx/c", effort: "" }, ...catalog("opencode", GROUPED) }) },
  },
  "pi, no cache": { key: "pi", argv: ["pi"], files: {}, exec: { version: "pi 1", models: PI_TABLE } },
  "pi, no cache, cli lists nothing": { key: "pi", argv: ["pi"], files: {}, exec: { version: "pi 1", models: new Error("none") } },
  "pi, saved presets": { key: "pi", argv: ["pi"], files: { "/home/agent-config.json": json({ pi: { model: "acme/big-model", effort: "high", preset: { off: ["mcp"], systemPrompt: "x" } }, ...catalog("pi", [{ id: "", label: "Default", efforts: [], fallbackEffort: "" }, { id: "acme/big-model", label: "big-model", group: "acme", efforts: ["", "high"], fallbackEffort: "" }]) }) }, exec: {} },
  "checking: no loading": { key: "codex", argv: ["codex"], files: {}, checking: true },
};

function start(world, log, settingsPage = false) {
  const handlers = [];
  const jobs = [];
  const timers = [];
  const files = new Map(Object.entries(world.files ?? {}));
  const field = value => ({ __v: value ?? "", value() { return this.__v; }, set_value(v) { this.__v = v; log.push(["set_value", v]); }, set_soft_wrap: v => log.push(["soft_wrap", v]), on(event, fn) { (this.fns ??= {})[event] = fn; }, focus: () => log.push(["focus"]) });
  const t = new Proxy({}, { get: (_t, key) => `#${String(key)}` });
  const exec = world.exec ?? {};
  const answer = value => { if (value instanceof Error) throw value; return { code: 0, stdout: value ?? "" }; };
  const props = { key: world.key, space: "s1", name: world.key, argv: world.argv, launchNow: Boolean(world.launchNow), overlay: "ov", menu: "menu" };
  const scope = {
    View: class {}, ...codexProvider, ...viewport, ...flyout,
    div: recorder(handlers)("div"), image: recorder(handlers)("image"), svg: recorder(handlers)("svg"), v_flex: recorder(handlers)("v_flex"), h_flex: recorder(handlers)("h_flex"),
    TextareaState: { new: o => field(o?.value) }, InputState: { new: () => field("") },
    Textarea: { new: (...a) => recorder(handlers)("Textarea.new")(...a) }, Input: { new: (...a) => recorder(handlers)("Input.new")(...a) },
    Scrollbar: { vertical: (...a) => recorder(handlers)("Scrollbar.vertical")(...a) },
    checking: () => Boolean(world.checking), run: (...a) => log.push(["run", ...plain(a)]), props: () => props, closeOverlay: id => log.push(["closeOverlay", id]),
    theme: () => t, setShared: (...a) => log.push(["setShared", ...plain(a)]), appHome: () => "/home", home: () => "/home", settings: () => ({ dark: world.dark !== false, font_family: "Mono" }),
    spaces: () => [{ id: "s1", active: true, machine: world.machine ?? null, folder: "/repo" }],
    readTextFile: async path => files.get(path),
    writeTextFile: async (path, text, expected) => { log.push(["write", path, stamp(text), expected === undefined ? "<none>" : expected === null ? null : "<prev>"]); files.set(path, text); },
    exec: async (cmd, args) => {
      log.push(["exec", cmd, args[0] === "-lic" ? args[1].replace(/'[^']*'/g, "'…'").slice(0, 60) : args]);
      if (cmd === "zsh") return answer(args[1].includes("--version") ? exec.version : exec.models);
      if (cmd === "ls") return answer(exec.ls);
      return { code: 0, stdout: "" };
    },
  };
  vm.createContext(scope);
  (settingsPage ? MANAGER_SCRIPT : SCRIPT).runInContext(scope);
  const cx = {
    notify: () => log.push(["notify"]), spawn: job => jobs.push(job), timer: { after: (ms, fn) => timers.push([ms, fn]) },
    stop_propagation: () => log.push(["stop"]),
  };
  const menu = new scope.__Menu();
  if (settingsPage) menu.settingsContext = { key: world.key, name: world.key, argv: world.argv, space: "s1" };
  return { menu, cx, handlers, jobs, timers, files, log, props };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
async function settle(w) {
  for (let round = 0; round < 6; round++) {
    for (const job of w.jobs.splice(0)) await job(w.cx);
    for (const [, fn] of w.timers.splice(0)) fn();
    await w.menu.saving; await w.menu.savingProvider;
    await flush();
  }
}
async function opened(world) {
  const w = start(world, []);
  w.menu.init({}, w.cx);
  await settle(w);
  w.log.length = 0;
  return w;
}

const state = (m, w) => plain({
  key: m.key, values: m.values, models: m.models, error: m.error, hidden: [...m.hidden], modelGroup: m.modelGroup, groupOpen: m.groupOpen, showHidden: m.showHidden,
  open: m.open, providers: Object.keys(m.providers ?? {}), providerId: m.providerId, cliModel: m.cliModel, styles: m.styles, naming: m.naming, nameError: m.nameError,
  editors: Object.fromEntries(Object.entries(m.editors).map(([id, e]) => [id, { v: e.input.value(), dirty: e.dirty, error: e.error }])), launching: m.launching, launched: m.launched,
  refreshing: m.refreshing, files: [...w.files].map(([k, v]) => [k, stamp(v)]),
});
// Compare the existing popup controls; the new shortcut has its own render and launch tests.
const view = w => { w.handlers.length = 0; w.menu.showSettingsShortcut = () => false; return digest(w.menu.render().__node); };

const KEYS = ["escape", "x"];
// Method calls that cover what the handlers of the render do not reach.
const OPS = {
  launch: (m, w) => m.launch(w.cx),
  "launch blocked json": async (m, w) => { for (const e of Object.values(m.editors)) e.input.__v = "{bad\nline"; await m.launch(w.cx); },
  "launch valid json": async (m, w) => { for (const e of Object.values(m.editors)) e.input.__v = '{"ok":true}'; await m.launch(w.cx); },
  "launch via provider": async (m, w) => { m.providerId = "omlx"; m.providers = { omlx: record("oMLX") }; m.model = "pm1"; await m.launch(w.cx); },
  "launch via missing provider": async (m, w) => { m.providerId = "ghost"; await m.launch(w.cx); },
  "launch via bad host": async (m, w) => { m.providerId = "bad"; await m.launch(w.cx); },
  "launch twice": (m, w) => Promise.all([m.launch(w.cx), m.launch(w.cx)]),
  "launch without cx": (m) => m.launch(undefined),
  refresh: (m, w) => { m.refresh(w.cx); m.refresh(w.cx); },
  "refresh fails": (m, w) => { m.listModels = async () => []; m.refresh(w.cx); },
  "list models": (m) => m.listModels().then(plain, e => `error: ${e.message}`),
  "set value": (m, w) => m.setValue(Object.keys(m.spec.options).find(id => m.spec.options[id].type === "select"), "haiku", w.cx),
  "pick new style": (m, w) => m.pickChoice("outputStyle", "+ New style…", w.cx),
  "pick style": (m, w) => m.pickChoice("outputStyle", "Explanatory", w.cx),
  "create style: empty": (m, w) => { m.naming = true; m.styleInput.__v = ""; m.createStyle(w.cx); },
  "create style: bad name": (m, w) => { m.naming = true; m.styleInput.__v = "bad name"; m.createStyle(w.cx); },
  "create style: new name": (m, w) => { m.naming = true; m.styleInput.__v = "fresh"; m.createStyle(w.cx); },
  "create style: existing name": (m, w) => { m.naming = true; m.styleInput.__v = "mine"; m.createStyle(w.cx); },
  "cancel naming": (m, w) => { m.naming = true; m.cancelNaming(w.cx); m.cancelNaming(w.cx); },
  "blur and change": (m, w) => { const f = m.styleInput.fns; f.focus(); f.change({}, w.cx); m.naming = true; f.blur({}, w.cx); },
  "save editors": (m, w) => { for (const [id, e] of Object.entries(m.editors)) for (const raw of ['{"a":1}', "{bad", "plain"]) { e.input.__v = raw; m.saveEditor(id, w.cx); } },
  "editor change": (m, w) => { for (const e of Object.values(m.editors)) { e.input.__v = "changed"; e.input.fns.change({}, w.cx); } },
  "reset preset": (m, w) => m.resetPreset(w.cx),
  "all items": (m, w) => { for (const [id, o] of Object.entries(m.spec.options)) if (o.items) { m.setAllItems(id, true, w.cx); m.toggleItem(id, o.items[0].id, w.cx); m.setAllItems(id, false, w.cx); } },
  "toggle hidden": (m, w) => { m.toggleHidden("m1"); m.toggleHidden("m1"); m.toggleHidden(m.models?.[0]?.id); m.remember(); m.rememberGroup(); },
  "set provider": async (m, w) => { for (const id of ["omlx", "omlx", "none", "gone", "plain"]) { m.setProvider(id, w.cx); await settle(w); } },
  "choose": (m) => { const rows = []; for (const model of [null, ...(m.models ?? [])]) for (const effort of [undefined, "low", "high", "bogus"]) { m.effort = "medium"; m.choose(model, effort); rows.push([model?.id, effort, m.model, m.effort]); } return rows; },
  "open providers": (m) => m.openProviders(),
  "open style file": (m) => m.openStyleFile("mine"),
  "variant": (m) => { m.effort = ""; return m.rememberVariant().then(() => { m.effort = null; return m.rememberVariant(); }); },
  "load providers": async (m) => { const out = await m.loadProviders(); return plain(out); },
  "build launch": async (m) => plain(await m.buildLaunch({ argv: ["x"] })),
  "toggle select": (m, w) => { m.open = "model"; m.toggle("model", w.cx); m.toggle("model", w.cx); },
};

async function recordWorld(world) {
  const out = {};
  const w = await opened(world);
  const initLog = []; const first = start(world, initLog);
  first.menu.init({}, first.cx);
  await settle(first);
  out.init = { log: plain(initLog), state: state(first.menu, first), render: view(first) };
  out.render = [];
  for (const open of [null, "model", "effort", "provider", "outputStyle", "advisorModel"]) {
    const x = await opened(world);
    x.menu.open = open;
    for (const extra of [{}, { groupOpen: true }, { showHidden: true }, { naming: true }, { naming: true, nameError: true }]) { Object.assign(x.menu, extra); out.render.push([open, Object.keys(extra).join(), view(x)]); }
  }
  const x = await opened(world);
  view(x);
  out.handlers = x.handlers.map(([name]) => name);
  out.clicks = [];
  for (let i = 0; i < x.handlers.length; i++) {
    const names = x.handlers[i][0];
    const events = names === "on_key_down" ? KEYS.map(key => ({ key })) : [{}];
    for (const event of events) {
      const y = await opened(world);
      view(y);
      const fn = y.handlers[i][1];
      y.log.length = 0;
      const hov = names === "on_hover" ? [true] : [event, y.cx];
      const result = fn(...(names === "on_hover" ? [true, y.cx] : hov));
      await result;
      await settle(y);
      out.clicks.push([i, names, event.key ?? null, plain(y.log), state(y.menu, y)]);
    }
  }
  out.ops = {};
  for (const [name, op] of Object.entries(OPS)) {
    const y = await opened(world);
    y.log.length = 0;
    let result = null, failure = null;
    try { result = await op(y.menu, y); await settle(y); } catch (error) { failure = error.constructor.name; }
    out.ops[name] = { result: plain(result), failure, log: plain(y.log), state: state(y.menu, y) };
  }
  void w;
  return out;
}

test("every flyout records as before", async () => {
  const got = {};
  for (const [name, world] of Object.entries(WORLDS)) got[name] = await recordWorld(world);
  const now = summary(got);
  if (!existsSync(GOLDEN)) writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`);
  assert.deepEqual(now, JSON.parse(readFileSync(GOLDEN, "utf8")));
});

test("the catalog fallback and error text are what the person reads", async () => {
  const w = await opened(WORLDS["codex, old schema, cli fails"]);
  assert.equal(w.menu.error, "Could not list models: offline");
});

const pageTheme = new Proxy({}, { get: (_t, key) => "#" + String(key) });
async function openSettings(world) {
  const w = start(world, [], true);
  w.menu.init({}, w.cx);
  await settle(w);
  w.log.length = 0;
  return w;
}
function drawSettings(w, enabled = true) {
  const out = w.menu.renderSettings(pageTheme, w.cx, { argv: w.props.argv, format: argv => argv.join(" "), copy() {}, enabled });
  return JSON.stringify(out.__node);
}
test("the settings controller loads a real catalog, previews current argv, and launches locally without closing a popup", async () => {
  const w = await openSettings(WORLDS["codex, fresh cache, providers, saved choices"]);
  assert.equal(w.menu.settingsLoaded, true);
  assert.equal(w.menu.model, "m3");
  assert.match(drawSettings(w), /Building command/);
  await settle(w);
  const argv = Array.from(w.menu.previewResult.argv);
  assert.deepEqual(argv, Array.from((await w.menu.buildLaunch({ argv: w.props.argv })).argv));
  const tree = drawSettings(w);
  assert.match(tree, /am-copy-command/);
  assert.match(tree, /am-launch-from-settings/);
  assert.match(tree, /MODEL SOURCE/);
  assert.ok(!w.log.some(entry => entry[0] === "run"));
  w.menu.setAllItems("codexOff", false, w.cx);
  await settle(w);
  assert.match(drawSettings(w), /Building command/);
  await settle(w);
  assert.notDeepEqual(Array.from(w.menu.previewResult.argv), argv);
  await w.menu.launch(w.cx);
  await settle(w);
  assert.ok(w.log.some(entry => entry[0] === "run" && entry[1] === "tab.new"));
  assert.ok(w.log.some(entry => entry[0] === "run" && entry[1] === "layout.select"));
  assert.ok(!w.log.some(entry => entry[0] === "closeOverlay"));
});

test("settings writes preserve another agent's data and reject conflicting or malformed disk state", async () => {
  const w = await openSettings(WORLDS["codex, fresh cache, providers, saved choices"]);
  const path = "/home/agent-config.json";
  const disk = JSON.parse(w.files.get(path));
  disk.pi = { model: "other" };
  w.files.set(path, json(disk));
  w.menu.effort = "high";
  w.menu.remember();
  await settle(w);
  let saved = JSON.parse(w.files.get(path));
  assert.equal(saved.pi.model, "other");
  assert.equal(saved.codex.effort, "high");
  saved.codex.effort = "external";
  w.files.set(path, json(saved));
  const before = w.files.get(path);
  w.menu.effort = "low";
  w.menu.remember();
  await settle(w);
  assert.equal(w.files.get(path), before);
  assert.match(w.menu.settingsSaveError, /changed on disk/);
  w.files.set(path, "{");
  w.menu.remember();
  await settle(w);
  assert.equal(w.files.get(path), "{");
  assert.ok(w.menu.settingsSaveError);
  assert.match(drawSettings(w), /Could not save/);
});

test("Claude settings preview reads live JSON and never mutates an invalid editor or launches it", async () => {
  const w = await openSettings(WORLDS["claude, valid agents json"]);
  assert.match(drawSettings(w), /Harness CLI arguments/);
  await settle(w);
  assert.ok(w.menu.previewResult.argv);
  const editor = w.menu.editors.agents;
  editor.input.__v = "{bad";
  const prior = editor.error;
  const blocked = await w.menu.buildPreview(w.props.argv);
  assert.match(blocked.error, /invalid JSON/);
  assert.equal(editor.error, prior);
  await w.menu.launch(w.cx);
  assert.ok(editor.error);
  assert.ok(!w.log.some(entry => entry[0] === "run" && entry[1] === "tab.new"));
  editor.input.__v = '{"worker":{"description":"test"}}';
  w.menu.saveEditor("agents", w.cx);
  await settle(w);
  assert.ok((await w.menu.buildPreview(w.props.argv)).argv);
});

test("remote settings are local-only, and OpenCode variant preview is read-only", async () => {
  const remote = await openSettings(WORLDS["codex, remote machine"]);
  drawSettings(remote);
  await settle(remote);
  assert.match(drawSettings(remote), /Choose a local workspace/);
  await remote.menu.launch(remote.cx);
  assert.ok(!remote.log.some(entry => entry[0] === "run"));
  const w = await openSettings(WORLDS["opencode, groups, hidden models, variant file"]);
  drawSettings(w);
  await settle(w);
  assert.match(drawSettings(w), /stored separately as its model variant/);
  assert.ok(!w.log.some(entry => entry[0] === "write" && entry[1].includes("model.json")));
  const preview = Array.from(w.menu.previewResult.argv);
  assert.deepEqual(preview, Array.from((await w.menu.buildLaunch({ argv: w.props.argv })).argv));
  await w.menu.launch(w.cx);
  await settle(w);
  assert.ok(w.log.some(entry => entry[0] === "run" && entry[1] === "tab.new"));
});

test("Pi and unavailable catalogs render the settings page without launching", async () => {
  const pi = await openSettings(WORLDS["pi, saved presets"]);
  drawSettings(pi);
  await settle(pi);
  assert.match(drawSettings(pi), /am-copy-command/);
  assert.ok(pi.menu.previewResult.argv);
  const missing = await openSettings(WORLDS["codex, old schema, cli fails"]);
  assert.match(drawSettings(missing), /Could not list models: offline/);
  assert.ok(!(await missing.menu.buildPreview(missing.props.argv)).argv);
  assert.ok(!missing.log.some(entry => entry[0] === "run"));
});
