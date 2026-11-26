// Exercise the page's host callbacks with in-memory files, commands and timers.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: AgentManager } = await import("./main.js");
const PROGRAMS = "/home/programs.json";
const MANAGER = "/home/agent-manager.json";
const agents = [
  { key: "claude", name: "Claude", installed: true, run: ["claude"] },
  { key: "codex", name: "Codex", installed: false, run: ["codex"] },
];

function harness(t, props = {}) {
  const page = new AgentManager();
  const files = new Map([[PROGRAMS, "{}"], [MANAGER, "{}"]]);
  const tasks = [];
  const timers = [];
  const cache = new Map();
  const cx = {
    notify() {},
    focus_handle: () => ({ focus() {} }),
    spawn: (fn) => tasks.push(fn),
    timer: {
      every: (ms, fn) => timers.push([ms, fn]),
      after: (ms, fn) => timers.push([ms, fn]),
    },
  };
  globalThis.__herdrProps = () => props;
  globalThis.__herdrFiles = files;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key) => cache.get(key),
    setItem: (key, value) => cache.set(key, value),
  } });
  t.after(() => {
    delete globalThis.localStorage;
    delete globalThis.__herdrProps;
    delete globalThis.__herdrFiles;
    delete globalThis.__herdrExec;
  });
  cache.set("agent-manager.inventory.v1", JSON.stringify(agents));
  page.init({}, cx);
  async function drain() {
    while (tasks.length) await tasks.shift()(cx);
  }
  return { page, cx, drain, timers, tasks, files, cache };
}

const output = (stdout, code = 0, stderr = "") => ({ stdout, stderr, code });
const field = (text) => ({ value: () => text, set_value(value) { text = value; }, set_masked() {} });
const editor = () => ({ command: field("claude"), args: field(""), originalArgs: [], dirty: false });

test("refresh probes the cached inventory, retries the login shell and keeps the last answer on failure", async (t) => {
  const { page, drain, cx, timers, cache } = harness(t);
  const calls = [];
  globalThis.__herdrExec = (command, args, options) => {
    calls.push([command, args, options.timeout]);
    if (args[0] === "-c") return output("/bin/zsh");
    if (args[0] === "-lic") return output("", 1, "profile");
    return output("noise\nHERDRAM:0\nHERDRAM:1\nHERDRAM:1");
  };
  await drain();
  assert.deepEqual(calls.map(([cmd, args, ms]) => [cmd, args[0], ms]), [
    ["/bin/sh", "-c", 5000], ["/bin/zsh", "-lic", 30000], ["/bin/zsh", "-lc", 30000],
  ]);
  assert.deepEqual(JSON.parse(cache.get("agent-manager.inventory.v1")).map((a) => a.installed), [false, true]);
  assert.equal(page.freebuffInstalled, true);
  assert.equal(page.refreshing, false);
  assert.equal(timers[0][0], 4000);
  globalThis.__herdrExec = () => output("", 1, "probe error");
  page.refresh(cx);
  await drain();
  assert.match(page.freshWarning, /probe error/);
  assert.equal(page.freebuffInstalled, true);
  assert.ok(page.lastChecked);
});

test("a superseded refresh cannot clear the new refresh flag or apply its probe", async (t) => {
  const { page, tasks, cx } = harness(t);
  const pending = Promise.withResolvers();
  page.freshInstallCheck = () => pending.promise;
  const first = tasks.shift()(cx);
  await new Promise((resolve) => setImmediate(resolve));
  page.refreshGen++;
  pending.resolve(new Map([["claude", false]]));
  await first;
  assert.equal(page.agents[0].installed, true);
  assert.equal(page.refreshing, true);
  assert.equal(page.lastChecked, null);
});

test("polling keeps a dirty draft, reload takes disk, save rechecks and expires its notice", async (t) => {
  const { page, cx, timers, tasks, files, drain } = harness(t);
  tasks.shift();
  page.refreshing = false;
  page.applyPrograms("{}");
  const draft = editor();
  draft.dirty = true;
  page.editors.set("claude", draft);
  const next = '{"programs":{"claude":{"run":["other"]}}}';
  files.set(PROGRAMS, next);
  timers[0][1](cx);
  await drain();
  assert.equal(page.externalConflict, true);
  assert.equal(draft.command.value(), "claude");
  page.reloadRow(page.allRows().all[0], cx);
  assert.equal(draft.command.value(), "other");
  assert.equal(page.externalConflict, false);
  const row = page.allRows().all[0];
  draft.command.set_value("cli");
  draft.dirty = true;
  await page.save(row, cx);
  assert.deepEqual(JSON.parse(files.get(PROGRAMS)).programs.claude.run, ["cli"]);
  assert.equal(page.savedKey, "claude");
  assert.equal(timers[1][0], 2200);
  timers[1][1]();
  assert.equal(page.savedKey, null);
  assert.equal(tasks.length, 1);
});

test("keyboard navigation wraps across Global and both rail groups and dispatches menu actions", async (t) => {
  const { page, cx, tasks, drain, files } = harness(t);
  tasks.shift();
  page.refreshing = false;
  const press = key => page.onKey({ key }, cx);
  for (const [key, selection] of [["up", "providers"], ["up", "freebuff"], ["down", "providers"], ["end", "providers"], ["home", "global"], ["down", "claude"]]) {
    assert.equal(press(key), true);
    assert.equal(page.railSelection, selection);
  }
  assert.equal(press("enter"), true);
  assert.equal(page.railSelection, "claude");
  assert.equal(press("escape"), false);
  assert.equal(press("space"), true);
  await drain();
  assert.deepEqual(JSON.parse(files.get(MANAGER)).disabled, ["claude"]);
  page.setPermissionMenu("default", true, cx);
  page.setPermissionMenu("claude", false, cx);
  assert.equal(page.permissionOpen, "default");
  press("down");
  assert.equal(page.permissionActive, 0);
  press("up");
  assert.equal(page.permissionActive, 3);
  assert.equal(press("escape"), true);
  assert.equal(page.permissionOpen, null);
  page.typing = true;
  assert.equal(press("R"), false);
  page.typing = false;
  assert.equal(press("other"), false);
  assert.equal(press("R"), true);
  assert.equal(tasks.length, 1);
});

test("uninstall revalidates the confirmed npm location before exec and rechecks after success", async (t) => {
  const { page, cx, tasks, drain } = harness(t);
  tasks.shift();
  page.freshInstallCheck = async () => new Map([["claude", true]]);
  const row = agents[0];
  const status = { managed: true, method: { kind: "npm", package: "@anthropic-ai/claude-code" }, path: "/bin/claude", real: "/npm/cli", root: "/npm", npm: "/bin/npm" };
  let current = status;
  page.npmStatusFor = async () => current;
  const calls = [];
  globalThis.__herdrExec = (...args) => { calls.push(args); return output(""); };
  page.requestUninstall(row, cx);
  assert.equal(page.uninstall.phase, "checking");
  await drain();
  assert.equal(page.uninstall.phase, "confirm");
  current = { ...status, real: "/changed" };
  page.confirmUninstall(row, cx);
  await drain();
  assert.match(page.uninstall.message, /installation changed/);
  assert.deepEqual(calls, []);
  current = status;
  page.requestUninstall(row, cx);
  await drain();
  page.freshInstallCheck = async () => new Map([["claude", false]]);
  page.confirmUninstall(row, cx);
  assert.equal(page.action.phase, "running");
  await drain();
  assert.deepEqual(calls, [["/bin/npm", ["uninstall", "-g", "@anthropic-ai/claude-code"], { timeout: 600000 }]]);
  assert.equal(page.action.phase, "done");
  assert.equal(page.uninstall, null);
  assert.equal(page.agents[0].installed, false);
});

test("the agents page renders loading, conflicts, permissions and unsupported command arguments", async (t) => {
  const { page, cx } = harness(t);
  const draw = () => JSON.stringify(page.render(cx).__node);
  page.agents = null;
  page.loading = true;
  assert.match(draw(), /Detecting installed agents/);
  page.agents = agents;
  const draft = editor();
  Object.assign(draft, { originalArgs: [""], dirty: true, conflict: true });
  page.editors.set("claude", draft);
  page.expanded.add("claude");
  page.externalConflict = true;
  page.pendingProgramsText = "{}";
  page.managerError = "unreadable";
  page.detectionError = "no inventory";
  page.programsError = "bad programs";
  page.freshWarning = "stale probe";
  page.freebuffInstalled = true;
  let retries = 0;
  page.flashPermission("pick again", "blocked", cx, () => retries++);
  const buttons = new Map();
  const buildButton = page.button.bind(page);
  page.button = (id, label, theme, click, options) => {
    buttons.set(id, click);
    return buildButton(id, label, theme, click, options);
  };
  const tree = draw();
  for (const text of ["am-reload-all", "am-retry-detection", "am-permission-retry", "stale probe", "no inventory"]) {
    assert.ok(tree.includes(text), text);
  }
  assert.match(JSON.stringify(page.editor(page.allRows().all.find(row => row.key === "claude"), draft, {}).__node), /empty or multi-line/);
  buttons.get("am-permission-retry")({}, cx);
  assert.equal(retries, 1);
  buttons.get("am-reload-all")({}, cx);
  assert.equal(page.externalConflict, false);
  assert.equal(draft.dirty, false);
  assert.equal(draft.command.value(), "claude");
});

test("provider cards render new, saved and replacement fields and dispatch their buttons", async (t) => {
  const { page, cx, drain } = harness(t, { page: "providers" });
  await drain();
  const buttons = new Map();
  const buildButton = page.button.bind(page);
  page.button = (id, label, theme, click, options) => {
    buttons.set(id, click);
    return buildButton(id, label, theme, click, options);
  };
  const draw = () => JSON.stringify(page.render(cx).__node);
  assert.match(draw(), /Choose a provider from the left rail, or add one with \+/);
  const card = { id: null, open: true, name: field(""), host: field("http:\/\/127.0.0.1:8000/v1"), link: field(""), key: field(""), fetched: { path: "", link: "" } };
  page.adding = card;
  assert.match(draw(), /Add model provider/);
  assert.match(draw(), /Test and save/);
  buttons.get("am-cancel-new")({}, cx);
  assert.equal(page.adding, null);
  card.id = "demo";
  page.cards.set("demo", card);
  page.providers.demo = { name: "Demo", host: "https://example.org", apiKey: "test", models: [], verifiedAt: 0 };
  page.selectedProviderId = "demo";
  assert.match(draw(), /am-key-replace-demo/);
  buttons.get("am-key-replace-demo")({}, cx);
  assert.equal(card.replacing, true);
  assert.match(draw(), /am-key-eye-demo/);
});
