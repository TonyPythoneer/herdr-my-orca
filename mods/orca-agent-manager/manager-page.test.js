// Characterization of the whole page: render() in many states is compared with page.golden.json
// (delete the file to re-record after an intended view change), and the click, key and size handlers
// that live inside the views are pressed through capture-handlers.loader.mjs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";
import { legacyButtonTree } from "./capture-handlers.loader.mjs";

process.env.TZ = "UTC";
register(new URL("./capture-handlers.loader.mjs", import.meta.url));
const { default: AgentManager } = await import("./main.js");
const { agentsPageView } = await import("./page-view.js");
const GOLDEN = new URL("./page.golden.json", import.meta.url);
const BUILDERS = new URL("./builders.golden.json", import.meta.url);
// The golden files hold one SHA-256 per recorded tree (the trees run to megabytes). Set
// GOLDEN_DUMP=<dir> to write the full trees there and diff them when a hash changes.
const digest = (out) => Object.fromEntries(Object.entries(out).map(([name, tree]) => [name, createHash("sha256").update(JSON.stringify(tree)).digest("hex")]));
function check(file, out, dumpName) {
  if (process.env.GOLDEN_DUMP) writeFileSync(`${process.env.GOLDEN_DUMP}/${dumpName}.json`, JSON.stringify(out, null, 1));
  if (!existsSync(file)) writeFileSync(file, `${JSON.stringify(digest(out), null, 1)}\n`);
  assert.deepEqual(digest(legacyButtonTree(out)), JSON.parse(readFileSync(file, "utf8")));
}
const PROGRAMS = "/home/programs.json";
const MANAGER = "/home/agent-manager.json";

globalThis.__herdrTheme = () => new Proxy({}, { get: (_t, key) => `#${String(key)}` });
const inventory = (installed) => [
  ["claude", "Claude"], ["codex", "Codex"], ["opencode", "OpenCode"], ["gemini", "Gemini"], ["pi", "Pi"], ["amp", "Amp"],
  ["cursor", "Cursor"], ["droid", "Droid"],
].map(([key, name], index) => ({ key, name, installed: installed(index), run: [key] }));
const SOME = inventory((index) => index % 2 === 0);

function harness(t, props = {}, agents = SOME) {
  const page = new AgentManager();
  const files = new Map([[PROGRAMS, "{}"], [MANAGER, "{}"]]);
  const cx = {
    notify() {},
    focus_handle: () => ({ focus() {} }),
    spawn() {},
    timer: { every() {}, after() {} },
  };
  const commands = [];
  globalThis.__herdrProps = () => props;
  globalThis.__herdrFiles = files;
  globalThis.__herdrRun = (command, args) => commands.push([command, args]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: () => JSON.stringify(agents),
    setItem() {},
  } });
  t.after(() => {
    delete globalThis.localStorage;
    delete globalThis.__herdrProps;
    delete globalThis.__herdrFiles;
    delete globalThis.__herdrRun;
    delete globalThis.__herdrHandlers;
  });
  page.init({}, cx);
  page.refreshing = false;
  page.applyPrograms("{}");
  page.applyManager("{}");
  return { page, cx, commands, files };
}

const programsWith = (runs) => JSON.stringify({ programs: Object.fromEntries(Object.entries(runs).map(([key, run]) => [key, { run }])) });
const field = (text) => ({ value: () => text, set_value(value) { text = value; }, set_masked() {} });
const draw = (page, cx) => {
  globalThis.__herdrHandlers = [];
  return JSON.parse(JSON.stringify(page.render(cx).__node));
};
// Historical characterization of the retained row/editor builders, not the active settings route.
const drawLegacy = (page, cx) => {
  globalThis.__herdrHandlers = [];
  const node = page.providersPage ? page.render(cx) : agentsPageView(page, globalThis.__herdrTheme());
  return JSON.parse(JSON.stringify(node.__node));
};
// The handler a render gave the element with this id (or, with no id, the last one of that kind).
const handler = (key, id) => {
  const found = globalThis.__herdrHandlers.filter((entry) => entry.key === key
    && (id === undefined || entry.rec.a[0] === id || entry.rec.c.some(([name, args]) => name === "id" && args[0] === id)));
  assert.ok(found.length, `${key} ${id}`);
  return found.at(-1).fn;
};
const editorOf = (command = "claude", args = "") => ({ command: field(command), args: field(args), originalArgs: [], dirty: false, error: null, conflict: false, force: false });
// A card as makeCard builds it, with plain fields in place of the editor inputs.
const cardOf = (id, saved, over = {}) => ({
  id, open: false, touched: false, testing: false, status: null, replacing: false, reveal: false, autoName: "",
  iconWork: Promise.resolve(),
  name: field(saved?.name ?? ""), host: field(saved?.host ?? ""), key: field(""), link: field(saved?.link ?? ""),
  fetched: { link: "", path: saved?.iconPath ?? "" },
  ...over,
});
const record = (over = {}) => ({ name: "Demo", host: "https://example.org/v1", apiKey: "test-key-ab12", link: "", iconPath: "", verifiedAt: "2026-01-02T03:04:05Z", models: ["a", "b"], ...over });

function pageStates(t) {
  const states = {};
  const add = (name, setup, props, agents) => {
    const { page, cx } = harness(t, props, agents);
    setup(page, cx);
    states[name] = drawLegacy(page, cx);
  };
  add("loading", (page) => { page.agents = null; page.loading = true; });
  add("cached", () => {});
  add("fresh", (page) => { page.fromCache = false; page.lastChecked = null; });
  add("none-installed", (page) => { page.agents = inventory(() => false); });
  add("all-installed", (page) => { page.agents = inventory(() => true); page.freebuffInstalled = true; });
  add("narrow", (page) => { page.width = 400; });
  add("refreshing", (page) => { page.refreshing = true; });
  add("errors", (page) => {
    Object.assign(page, {
      managerError: "bad manager", programsError: "bad programs", detectionError: "no inventory",
      freshWarning: "stale probe", writeError: "write failed", freebuffInstalled: true,
    });
  });
  add("conflict", (page) => {
    const draft = editorOf();
    draft.dirty = true;
    draft.conflict = true;
    page.editors.set("claude", draft);
    page.expanded.add("claude");
    Object.assign(page, { externalConflict: true, writeError: "changed on disk" });
  });
  add("permissions-default", (page) => { page.permissions = { default: "full-access", overrides: { claude: "ask" } }; });
  add("permissions-own", (page) => {
    page.agents = inventory(() => true);
    page.applyPrograms(programsWith({ claude: ["claude", "--permission-mode", "default"] }));
  });
  add("permissions-custom", (page) => {
    page.permissions = { default: "ask", overrides: {} };
    page.agents = inventory(() => true);
    page.applyPrograms(programsWith({ codex: ["codex", "-a", "never"] }));
  });
  add("permissions-menu", (page) => {
    page.permissionOpen = "default";
    page.permissionActive = 1;
    page.permissionNotice = { text: "Applied to 2 agents.", tone: "muted", retry: null };
  });
  add("permissions-blocked", (page) => {
    page.permissionNotice = { text: "blocked", tone: "blocked", retry() {} };
  });
  addProviderStates(add);
  return states;
}

function addProviderStates(add) {
  add("providers-empty", () => {}, { page: "providers" });
  add("providers-error", (page) => { page.providersError = "bad file"; }, { page: "providers" });
  add("providers-cards", (page) => {
    page.providers = { saved: record({ iconPath: "/home/provider-icons/icon-a.png" }), plain: record({ name: "Plain", models: undefined }), open: record({ name: "Open" }) };
    for (const [id, saved] of Object.entries(page.providers)) page.cards.set(id, cardOf(id, saved));
    page.cards.get("open").open = true;
    page.cards.get("saved").status = { tone: "done", text: "Saved · 2 models" };
    page.cards.get("saved").open = true;
    page.cards.get("saved").replacing = true;
    page.cards.get("saved").reveal = true;
    page.cards.get("plain").open = true;
    page.cards.get("plain").status = { tone: "blocked", text: "no" };
    page.cards.get("plain").testing = true;
  }, { page: "providers" });
  add("providers-adding", (page) => {
    page.adding = cardOf(null, { host: "http://127.0.0.1:8000/v1" }, { open: true, status: { tone: "muted", text: "Finding the icon…" } });
    page.adding.fetched = { link: "x", path: "/home/provider-icons/icon-b.png" };
  }, { page: "providers" });
  add("providers-adding-link", (page) => {
    page.adding = cardOf(null, { name: "typed", link: "not a link" }, { open: true });
  }, { page: "providers" });
}

test("legacy builders and unchanged provider page render as recorded in every state", (t) => {
  const out = pageStates(t);
  check(GOLDEN, out, "page");
  const distinct = new Set(Object.values(out).map((state) => JSON.stringify(state))).size;
  assert.equal(distinct, Object.keys(out).length, "every state must render differently");
});

test("the small builders render as recorded", (t) => {
  const { page } = harness(t);
  const theme = globalThis.__herdrTheme();
  const rec = (node) => JSON.parse(JSON.stringify(node.__node));
  const row = { key: "claude", name: "Claude", installed: true, enabled: true, run: ["claude", "--x"], defaultCmd: ["claude"], override: ["claude", "--x"], customized: true };
  const out = {
    buttonPlain: rec(page.button("b", "Go", theme, () => {})),
    buttonPrimary: rec(page.button("b", "Go", theme, () => {}, { primary: true, height: 20, px: 4, size: 11 })),
    buttonDisabled: rec(page.button("b", "Go", theme, () => {}, { disabled: true, color: "#c" })),
    toggleOn: rec(page.toggle(row, theme)),
    toggleOff: rec(page.toggle({ ...row, enabled: false }, theme)),
    toggleUninstalled: rec(page.toggle({ ...row, installed: false }, theme)),
    lineDefault: rec(page.commandLine({ ...row, customized: false }, theme, false)),
    lineQuiet: rec(page.commandLine({ ...row, customized: false }, theme, true)),
    lineNoDefault: rec(page.commandLine({ ...row, defaultCmd: null }, theme, false)),
    lineCustom: rec(page.commandLine(row, theme, false)),
    lineCustomQuiet: rec(page.commandLine({ ...row, override: null }, theme, true)),
    unofficialOn: rec(page.unofficialRow(theme, true)),
    unofficialOff: rec(page.unofficialRow(theme, false)),
    catalog: rec(page.catalog([row], theme, "installed")),
    catalogScrolling: rec(page.catalog(Array.from({ length: 7 }, (_, index) => ({ ...row, key: `a${index}` })), theme, "available")),
    permissions: rec(page.permissionsCard([{ ...row, supports: true, permission: "own", permissionOverride: false }], theme)),
  };
  check(BUILDERS, out, "builders");
});

const press = (fn, ...args) => fn(...args);
const spyCx = () => {
  const log = [];
  return { log, notify: () => log.push("notify"), stop_propagation: () => log.push("stop") };
};

test("the page's own handlers go back, refresh, resize, pass keys and stop the wheel", (t) => {
  const { page, cx, commands } = harness(t);
  const spy = spyCx();
  page.agents = inventory(() => true);
  drawLegacy(page, cx);
  page.typing = true;
  press(handler("on_click", "am-back"));
  assert.equal(page.typing, false);
  assert.deepEqual(commands, [["layout.select", { stack: "main", child: "main-terminals" }]]);
  const refreshed = [];
  page.refresh = (c) => refreshed.push(c);
  press(handler("on_click", "am-refresh"), {}, spy);
  assert.deepEqual(refreshed, [spy]);
  press(handler("on_size_change", "am-root"), { width: 900 }, spy);
  press(handler("on_size_change", "am-root"), { width: 900 }, spy);
  assert.equal(page.width, 900);
  assert.deepEqual(spy.log, ["notify"]);
  assert.equal(press(handler("on_key_down", "am-root"), { key: "end" }, spy), true);
  assert.equal(page.railSelection, "freebuff");
  press(handler("on_scroll_wheel"), {}, spy);
  assert.equal(spy.log.at(-1), "stop");
});

test("a row's switch, name and chevron toggle and expand without leaking the click", (t) => {
  const { page, cx } = harness(t);
  const spy = spyCx();
  const toggled = [];
  page.toggleEnabled = (row) => toggled.push(row.key);
  page.ensureEditor = (row) => page.editors.set(row.key, editorOf());
  page.agents = inventory(() => true);
  drawLegacy(page, cx);
  press(handler("on_click", "am-toggle-claude"), {}, spy);
  assert.deepEqual(toggled, ["claude"]);
  assert.equal(spy.log[0], "stop");
  press(handler("on_click", "am-name-claude"), {}, spy);
  assert.equal(page.expanded.has("claude"), true);
  drawLegacy(page, cx);
  press(handler("on_click", "am-more-claude"), {}, spy);
  assert.equal(page.expanded.has("claude"), false);
});

test("the editor's keys save on cmd-enter and cancel on escape, and its buttons act", (t) => {
  const { page, cx } = harness(t);
  const spy = spyCx();
  page.agents = inventory(() => true);
  const draft = editorOf();
  page.editors.set("claude", draft);
  page.expanded.add("claude");
  const saved = [];
  const cancelled = [];
  page.save = (row) => saved.push(row.key);
  page.cancelEdit = (row) => cancelled.push(row.key);
  page.writeError = null;
  drawLegacy(page, cx);
  const keys = globalThis.__herdrHandlers.filter((entry) => entry.key === "on_key_down" && entry.rec.c.some(([name, args]) => name === "pl" && args[0] === 52)).map((entry) => entry.fn);
  assert.equal(keys.length, 2);
  page.typing = true;
  press(keys[0], { key: "enter" }, spy);
  assert.deepEqual(cancelled, []);
  press(keys[0], { key: "escape" }, spy);
  assert.equal(page.typing, false);
  assert.deepEqual(cancelled, ["claude"]);
  page.typing = true;
  press(keys[1], { keystroke: "cmd-enter" }, spy);
  press(keys[1], { keystroke: "ctrl-enter" }, spy);
  assert.deepEqual(saved, ["claude", "claude"]);
  press(keys[1], { key: "escape" }, spy);
  press(keys[1], { key: "x" }, spy);
  assert.deepEqual(cancelled, ["claude", "claude"]);
  assert.equal(page.typing, false);
});

test("the editor's conflict, reset and uninstall buttons call the page", (t) => {
  const { page, cx } = harness(t);
  const spy = spyCx();
  page.agents = inventory(() => true);
  page.editors.set("claude", Object.assign(editorOf(), { conflict: true }));
  page.expanded.add("claude");
  page.uninstall = { key: "claude", phase: "confirm", status: { method: { package: "@anthropic-ai/claude-code" } }, message: "" };
  const calls = [];
  for (const name of ["reloadRow", "save", "reset", "requestUninstall", "cancelUninstall", "confirmUninstall"]) page[name] = (...args) => calls.push([name, args[0]?.key ?? typeof args[0]]);
  page.applyPrograms(programsWith({ claude: ["claude", "-x"] }));
  drawLegacy(page, cx);
  press(handler("on_click", "am-reload-claude"), {}, spy);
  press(handler("on_click", "am-force-claude"), {}, spy);
  assert.equal(page.editors.get("claude").force, true);
  press(handler("on_click", "am-reset-claude"), {}, spy);
  press(handler("on_click", "am-uninstall-cancel-claude"), {}, spy);
  press(handler("on_click", "am-uninstall-confirm-claude"), {}, spy);
  assert.deepEqual(calls.map(([name]) => name), ["reloadRow", "save", "reset", "cancelUninstall", "confirmUninstall"]);
  page.uninstall = null;
  drawLegacy(page, cx);
  press(handler("on_click", "am-uninstall-claude"), {}, spy);
  assert.equal(calls.at(-1)[0], "requestUninstall");
  press(handler("on_click", "am-save-claude"), {}, spy);
  assert.equal(calls.at(-1)[0], "save");
});

test("the permission menus pick an item and report open and close", (t) => {
  const { page, cx } = harness(t);
  const spy = spyCx();
  const picks = [];
  page.setDefaultPermission = (choice) => picks.push(["default", choice]);
  page.setAgentPermission = (row, choice) => picks.push([row.key, choice]);
  page.permissionOpen = "default";
  drawLegacy(page, cx);
  press(handler("on_click", "am-perm-default-ask"), {}, spy);
  press(handler("on_open_change", "am-perm-pop-default"), true, spy);
  assert.equal(page.permissionOpen, "default");
  press(handler("on_open_change", "am-perm-pop-default"), false, spy);
  assert.equal(page.permissionOpen, null);
  page.expanded.add("claude");
  page.editors.set("claude", editorOf());
  page.permissionOpen = "claude";
  drawLegacy(page, cx);
  press(handler("on_click", "am-perm-claude-ask"), {}, spy);
  press(handler("on_open_change", "am-perm-pop-claude"), true, spy);
  assert.equal(page.permissionOpen, "claude");
  assert.deepEqual(picks, [["default", "ask"], ["claude", "ask"]]);
});

test("provider cards: reveal the key, take a preset, open, add and cancel", async (t) => {
  const { page, cx } = harness(t, { page: "providers" });
  const spy = spyCx();
  const execs = [];
  globalThis.__herdrExec = (command, args) => { execs.push([command, ...args]); return { code: 0, stdout: "", stderr: "" }; };
  t.after(() => { delete globalThis.__herdrExec; });
  page.makeCard = () => cardOf(null, null);
  draw(page, cx);
  press(handler("on_click", "am-provider-add"), {}, spy);
  assert.equal(page.adding.open, true);
  const card = cardOf(null, { host: "http://127.0.0.1:8000/v1" }, { open: true });
  card.fetched = { link: "x", path: "/home/provider-icons/icon-z.png" };
  page.adding = card;
  draw(page, cx);
  press(handler("on_click", "am-key-eye-new"), {}, spy);
  assert.equal(card.reveal, true);
  const linked = [];
  page.linkChanged = (c) => linked.push(c);
  press(handler("on_click", "am-offer-new"), {}, spy);
  assert.equal(card.name.value(), "oMLX");
  assert.match(card.link.value(), /github\.com\/jundot\/omlx/);
  assert.deepEqual(linked, [card]);
  const saved = cardOf("saved", record());
  page.cards.set("saved", saved);
  page.providers.saved = record();
  draw(page, cx);
  press(handler("on_click", "am-provider-head-saved"), {}, spy);
  assert.equal(saved.open, true);
  press(handler("on_click", "am-back"));
  const buttons = new Map();
  const build = page.button.bind(page);
  page.button = (id, label, theme, click, options) => { buttons.set(id, click); return build(id, label, theme, click, options); };
  draw(page, cx);
  card.testing = true;
  buttons.get("am-cancel-new")({}, spy);
  assert.equal(page.adding, card);
  card.testing = false;
  buttons.get("am-cancel-new")({}, spy);
  assert.equal(page.adding, null);
  assert.deepEqual(execs, [["rm", "-f", "/home/provider-icons/icon-z.png"]]);
});

test("agent-manager actions use native accessible buttons and disabled controls cannot activate", (t) => {
  const { page } = harness(t);
  const theme = globalThis.__herdrTheme();
  const clicks = [];
  globalThis.__herdrHandlers = [];
  const active = page.button("active", "Save", theme, (...args) => clicks.push(args)).__node;
  const disabled = page.button("disabled", "Save", theme, () => assert.fail("disabled clicked"), { disabled: true }).__node;
  assert.equal(active.n, "Button.new");
  assert.equal(disabled.n, "Button.new");
  assert.deepEqual(active.c[0], ["disabled", [false]]);
  assert.deepEqual(disabled.c[0], ["disabled", [true]]);
  assert.ok(!disabled.c.some(([key]) => key === "on_click"));
  const cx = spyCx();
  press(handler("on_click", "active"), {}, cx);
  assert.deepEqual(clicks, [[{}, cx]]);
});

test("provider and refresh controls are native buttons; busy refresh cannot activate", (t) => {
  const { page, cx } = harness(t);
  page.refreshing = true;
  const busy = JSON.stringify(draw(page, cx));
  assert.match(busy, /"n":"Button.new","a":\["am-refresh"\],"c":\[\["disabled",\[true\]\]/);
  assert.ok(!globalThis.__herdrHandlers.some(entry => entry.key === "on_click" && entry.rec.a[0] === "am-refresh"));
  const providers = harness(t, { page: "providers" });
  assert.match(JSON.stringify(draw(providers.page, providers.cx)), /"n":"Button.new","a":\["am-provider-add"\]/);
  providers.page.adding = cardOf(null, { host: "http://127.0.0.1:8000/v1" }, { open: true });
  assert.match(JSON.stringify(draw(providers.page, providers.cx)), /"n":"Button.new","a":\["am-key-eye-new"\]/);
});

// Exercise the actual V4 route independently of the historical builder snapshots.
test("settings route follows the left sidebar's requests and publishes its selection", (t) => {
  const { page, cx } = harness(t);
  const store = new Map();
  globalThis.__herdrShared = key => store.get(key) ?? null;
  globalThis.__herdrSetShared = (key, value) => { store.set(key, value); return null; };
  t.after(() => { delete globalThis.__herdrShared; delete globalThis.__herdrSetShared; });
  const spy = spyCx();
  const toggled = [];
  page.toggleEnabled = row => toggled.push(row.key);
  page.freebuffInstalled = true;
  const global = JSON.stringify(draw(page, cx));
  for (const id of ["Global Agent Settings", "am-refresh"]) assert.ok(global.includes(id), id);
  for (const id of ["am-agent-rail", "am-rail-select-claude", "am-back"]) assert.ok(!global.includes(id), id);
  assert.deepEqual(store.get("agent-manager.selected"), { key: "global" });
  const open = key => { store.set("agent-manager.open-agent", { key }); return JSON.stringify(draw(page, cx)); };
  store.set("agent-manager.toggle-agent", { key: "claude" });
  draw(page, cx);
  store.set("agent-manager.toggle-agent", { key: "freebuff" });
  draw(page, cx);
  assert.deepEqual(toggled, ["claude", "freebuff"]);
  assert.equal(store.get("agent-manager.toggle-agent"), null);
  const claude = open("claude");
  assert.match(claude, /am-agent-detail-claude/);
  assert.match(claude, /Loading harness settings/);
  assert.deepEqual(store.get("agent-manager.selected"), { key: "claude" });
  assert.equal(store.get("agent-manager.open-agent"), null);
  assert.match(open("codex"), /Install this CLI/);
  const freebuff = open("freebuff");
  assert.match(freebuff, /Preview command/);
  assert.match(freebuff, /am-copy-command/);
  assert.match(open("global"), /Global Agent Settings/);
  assert.deepEqual(store.get("agent-manager.selected"), { key: "global" });
  press(handler("on_size_change", "am-root"), { width: 420 }, spy);
  assert.equal(page.width, 420);
});

test("harness inputs are initialized after render and cached by the manager", async (t) => {
  const { page, cx } = harness(t);
  const row = SOME[0];
  let resume;
  const afterRender = new Promise(resolve => { resume = resolve; });
  const tasks = [];
  cx.spawn = task => tasks.push(task({
    sleep: () => afterRender,
    spawn() {},
    notify() {},
  }));

  assert.equal(page.harnessFor(row, cx), null);
  assert.equal(page.harnesses.has(row.key), false);
  assert.equal(page.harnessFor(row, cx), null);
  assert.equal(tasks.length, 1);
  assert.equal(page.harnessPending.has(row.key), true);

  resume();
  await tasks[0];
  const controller = page.harnessFor(row, cx);
  assert.equal(controller.key, row.key);
  assert.ok(controller.styleInput);
  assert.equal(page.harnessPending.has(row.key), false);
  assert.equal(tasks.length, 1);
});

// The full settings route exposes a real Copy control, not just the preview string.
test("unsupported harness command copy reaches both clipboard channels without launching", (t) => {
  const { page, cx, commands } = harness(t);
  page.freebuffInstalled = true;
  const copied = [], host = [];
  globalThis.__clipboard_write_text = value => copied.push(value);
  globalThis.__herdrExec = (command, args) => { host.push([command, args]); return { code: 0, stdout: "" }; };
  t.after(() => { delete globalThis.__clipboard_write_text; delete globalThis.__herdrExec; });
  page.selectRail("freebuff", cx);
  assert.match(JSON.stringify(draw(page, cx)), /am-copy-command/);
  const clipboard = [];
  const spy = { ...spyCx(), write_to_clipboard: value => clipboard.push(value) };
  press(handler("on_click", "am-copy-command"), {}, spy);
  assert.equal(copied.length, 1);
  assert.match(copied[0], /freebuff/);
  assert.deepEqual(clipboard, copied);
  assert.equal(host.length, 1);
  assert.equal(host[0][0], "sh");
  assert.equal(host[0][1].at(-1), copied[0]);
  assert.deepEqual(commands, []);
});
