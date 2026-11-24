// Flow test for the page's logic branches: uninstall request and confirm, refresh failures, polling,
// keyboard paths and the permission menu state, with in-memory files, sessions and commands.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./capture-handlers.loader.mjs", import.meta.url));
const { default: AgentManager } = await import("./main.js");
const PROGRAMS = "/home/programs.json";
const MANAGER = "/home/agent-manager.json";
const agents = [
  { key: "claude", name: "Claude", installed: true, run: ["claude"] },
  { key: "codex", name: "Codex", installed: false, run: ["codex"] },
];
const status = { managed: true, method: { kind: "npm", package: "@anthropic-ai/claude-code" }, path: "/bin/claude", real: "/npm/cli", root: "/npm", npm: "/bin/npm" };
const output = (stdout, code = 0, stderr = "") => ({ stdout, stderr, code });

function harness(t) {
  const page = new AgentManager();
  const files = new Map([[PROGRAMS, "{}"], [MANAGER, "{}"]]);
  const tasks = [];
  const timers = [];
  const log = [];
  const cx = {
    notify: () => log.push("notify"),
    focus_handle: () => ({ focus: () => log.push("focus") }),
    spawn: (fn) => tasks.push(fn),
    timer: { every: (ms, fn) => timers.push([ms, fn]), after: (ms, fn) => timers.push([ms, fn]) },
  };
  globalThis.__herdrProps = () => ({});
  globalThis.__herdrFiles = files;
  globalThis.__herdrKnownAgents = () => agents;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => undefined, setItem() {} } });
  t.after(() => {
    for (const name of ["localStorage", "__herdrProps", "__herdrFiles", "__herdrExec", "__herdrTerminals", "__herdrKnownAgents"]) delete globalThis[name];
  });
  page.init({}, cx);
  const drain = async () => {
    while (tasks.length) await tasks.shift()(cx);
  };
  return { page, cx, drain, tasks, timers, files, log };
}

async function confirming(t, { terminals, npm = async () => status, execute = () => output("") } = {}) {
  const ctx = harness(t);
  await ctx.drain();
  ctx.tasks.length = 0;
  const { page, cx, drain } = ctx;
  page.npmStatusFor = npm;
  globalThis.__herdrTerminals = () => terminals?.() ?? [];
  const calls = [];
  globalThis.__herdrExec = (...args) => { calls.push(args); return execute(...args); };
  page.requestUninstall(agents[0], cx);
  await drain();
  assert.equal(page.uninstall.phase, "confirm");
  return { ...ctx, calls };
}

test("requesting an uninstall explains a running session, a missing method, path or owner, and errors", async (t) => {
  const { page, cx, drain, tasks } = harness(t);
  await drain();
  tasks.length = 0;
  const row = agents[0];
  globalThis.__herdrTerminals = () => [{ program: { key: "claude" } }, { program: { key: "claude" } }];
  page.requestUninstall(row, cx);
  await drain();
  assert.match(page.uninstall.message, /Close 2 active Claude sessions first/);
  globalThis.__herdrTerminals = () => [{ program: { key: "claude" } }];
  page.requestUninstall(row, cx);
  await drain();
  assert.match(page.uninstall.message, /Close 1 active Claude session first/);
  globalThis.__herdrTerminals = () => [];
  const cases = [[{ method: null }, /No verified automatic uninstall/], [{ method: status.method, path: null }, /not on PATH/], [{ method: status.method, path: "/x", managed: false }, /does not belong/]];
  for (const [answer, pattern] of cases) {
    page.npmStatusFor = async () => answer;
    page.requestUninstall(row, cx);
    await drain();
    assert.equal(page.uninstall.phase, "error");
    assert.match(page.uninstall.message, pattern);
  }
  page.npmStatusFor = async () => { throw new Error("boom"); };
  page.requestUninstall(row, cx);
  await drain();
  assert.equal(page.uninstall.message, "boom");
  page.uninstall = { key: "claude", phase: "checking" };
  page.requestUninstall(row, cx);
  assert.equal(page.uninstall.phase, "checking");
  page.uninstall = null;
  page.action = { phase: "running" };
  page.requestUninstall(row, cx);
  assert.equal(page.uninstall, null);
  page.cancelUninstall(cx);
  assert.equal(page.uninstall, null);
});

test("confirming ignores a stale request and stops for a session, a missing command or a changed install", async (t) => {
  const { page, cx, drain, calls } = await confirming(t);
  const row = agents[0];
  page.confirmUninstall({ key: "other" }, cx);
  assert.equal(page.uninstall.phase, "confirm");
  page.action = { phase: "running" };
  page.confirmUninstall(row, cx);
  assert.equal(page.uninstall.phase, "confirm");
  page.action = null;
  globalThis.__herdrTerminals = () => [{ program: { key: "claude" } }];
  page.confirmUninstall(row, cx);
  assert.match(page.uninstall.message, /A session started while you were confirming/);
  assert.equal(page.action, null);
  globalThis.__herdrTerminals = () => [];
  page.uninstall = { key: "claude", phase: "confirm", status: { ...status, method: { kind: "pip", package: "x" } }, message: "" };
  page.confirmUninstall(row, cx);
  assert.equal(page.uninstall.phase, "confirm");
  page.uninstall = { key: "claude", phase: "confirm", status, message: "" };
  page.npmStatusFor = async () => ({ ...status, managed: false });
  page.confirmUninstall(row, cx);
  await drain();
  assert.match(page.uninstall.message, /installation changed/);
  assert.equal(page.action, null);
  page.uninstall = { key: "claude", phase: "confirm", status, message: "" };
  page.npmStatusFor = async () => status;
  let polls = 0;
  globalThis.__herdrTerminals = () => (++polls > 1 ? [{ program: { key: "claude" } }] : []);
  page.confirmUninstall(row, cx);
  await drain();
  assert.match(page.uninstall.message, /A session started while you were confirming/);
  assert.equal(page.action, null);
  assert.deepEqual(calls, []);
});

test("a failed npm uninstall reports its exit code and tail and keeps the CLI", async (t) => {
  const { page, cx, drain, calls } = await confirming(t, { execute: () => output("", 3, "EACCES denied") });
  page.confirmUninstall(agents[0], cx);
  assert.equal(page.uninstall.phase, "running");
  assert.equal(page.action.message, "Uninstalling @anthropic-ai/claude-code…");
  await drain();
  assert.equal(calls.length, 1);
  assert.deepEqual(page.action, { key: "claude", kind: "uninstall", phase: "error", message: "npm exited 3: EACCES denied" });
  assert.deepEqual([page.uninstall.phase, page.uninstall.message], ["error", "The CLI was not removed."]);
});

test("an npm failure with no output ends the message with a period", async (t) => {
  const { page, cx, drain } = await confirming(t, { execute: () => output("", 1, "") });
  page.confirmUninstall(agents[0], cx);
  await drain();
  assert.equal(page.action.message, "npm exited 1.");
});

test("an uninstall that leaves the executable on PATH warns and keeps the request in error", async (t) => {
  const { page, cx, drain } = await confirming(t);
  page.freshInstallCheck = async () => new Map([["claude", true]]);
  page.confirmUninstall(agents[0], cx);
  await drain();
  assert.equal(page.action.phase, "warning");
  assert.match(page.action.message, /still detected/);
  assert.deepEqual([page.uninstall.phase, page.uninstall.message], ["error", "The executable is still detected."]);
});

test("a recheck that fails after removal warns, and a status failure before it errors", async (t) => {
  const first = await confirming(t);
  first.page.freshInstallCheck = async () => { throw new Error("no shell"); };
  first.page.confirmUninstall(agents[0], first.cx);
  await first.drain();
  assert.equal(first.page.action.phase, "warning");
  assert.match(first.page.action.message, /could not be rechecked\. no shell/);
  assert.equal(first.page.uninstall.message, "npm finished, but the executable could not be rechecked.");
  const second = await confirming(t);
  second.page.npmStatusFor = async () => { throw new Error("npm gone"); };
  second.page.confirmUninstall(agents[0], second.cx);
  await second.drain();
  assert.equal(second.page.action.phase, "error");
  assert.match(second.page.action.message, /Could not complete the uninstall\. npm gone/);
  assert.equal(second.page.uninstall.message, "Could not complete the uninstall.");
});

test("refresh reports a failed inventory, keeps cached rows and only stops loading when none exist", async (t) => {
  const { page, cx, drain, tasks } = harness(t);
  tasks.length = 0;
  globalThis.__herdrKnownAgents = () => { throw new Error("herdr down"); };
  page.refreshing = false;
  page.refresh(cx);
  await drain();
  assert.match(page.detectionError, /Could not detect installed agents: herdr down/);
  assert.equal(page.agents, null);
  assert.equal(page.loading, false);
  assert.equal(page.refreshing, false);
  page.agents = agents;
  page.loading = true;
  globalThis.__herdrKnownAgents = () => Promise.reject(new Error("async down"));
  globalThis.__herdrExec = () => output("HERDRAM:1\nHERDRAM:0");
  page.refresh(cx);
  await drain();
  assert.match(page.detectionError, /async down/);
  assert.equal(page.agents[0].installed, true);
  assert.equal(page.agents[1].installed, false);
});

test("refresh takes a changed programs file, conflicts with a dirty draft and ignores files read mid-write", async (t) => {
  const { page, cx, drain, tasks, files } = harness(t);
  tasks.length = 0;
  globalThis.__herdrExec = () => output("HERDRAM:1\nHERDRAM:1\nHERDRAM:1");
  page.refreshing = false;
  page.applyPrograms("{}");
  const next = '{"programs":{"claude":{"run":["c2"]}}}';
  files.set(PROGRAMS, next);
  files.set(MANAGER, '{"disabled":["claude"]}');
  page.externalConflict = true;
  page.refresh(cx);
  await drain();
  assert.equal(page.programsText, next);
  assert.equal(page.externalConflict, false);
  assert.deepEqual([...page.disabled], ["claude"]);
  const draft = { command: { value: () => "c2", set_value() {} }, args: { value: () => "", set_value() {} }, originalArgs: [], dirty: true };
  page.editors.set("claude", draft);
  files.set(PROGRAMS, "{}");
  page.refresh(cx);
  await drain();
  assert.equal(page.externalConflict, true);
  assert.equal(page.pendingProgramsText, "{}");
  assert.equal(page.programsText, next);
  page.persisting = 1;
  files.set(MANAGER, "{}");
  page.refresh(cx);
  await drain();
  assert.deepEqual([...page.disabled], ["claude"]);
  assert.equal(page.pendingProgramsText, "{}");
});

test("polling applies an outside change, flags a conflict, takes the manager file and stays quiet otherwise", async (t) => {
  const { page, cx, drain, tasks, timers, files, log } = harness(t);
  tasks.length = 0;
  page.refreshing = false;
  page.applyPrograms("{}");
  page.applyManager("{}");
  const poll = timers[0][1];
  files.set(PROGRAMS, '{"programs":{}}');
  const refreshed = [];
  page.refresh = (c) => refreshed.push(c);
  page.writeError = "old";
  poll(cx);
  await drain();
  assert.equal(page.programsText, '{"programs":{}}');
  assert.equal(page.writeError, null);
  assert.equal(refreshed.length, 1);
  log.length = 0;
  poll(cx);
  await drain();
  assert.deepEqual(log, []);
  files.set(MANAGER, '{"disabled":["codex"]}');
  poll(cx);
  await drain();
  assert.deepEqual([...page.disabled], ["codex"]);
  assert.deepEqual(log, ["notify"]);
  page.editors.set("claude", { dirty: true });
  files.set(PROGRAMS, '{"x":1}');
  log.length = 0;
  poll(cx);
  await drain();
  assert.equal(page.externalConflict, true);
  assert.deepEqual(log, ["notify"]);
  log.length = 0;
  poll(cx);
  await drain();
  assert.deepEqual(log, ["notify"]);
  page.persisting = 1;
  poll(cx);
  assert.equal(tasks.length, 0);
  page.persisting = 0;
  page.refreshing = true;
  poll(cx);
  assert.equal(tasks.length, 0);
  page.refreshing = false;
  poll(cx);
  page.persisting = 1;
  await drain();
  assert.equal(page.pendingProgramsText, '{"x":1}');
});

test("keys: space and the space key toggle, r refreshes, a missing focus starts at the first row", async (t) => {
  const { page, cx, tasks, drain } = harness(t);
  globalThis.__herdrExec = () => output("HERDRAM:1\nHERDRAM:0");
  await drain();
  page.installedScroll = { scroll_to_item() {} };
  page.availableScroll = { scroll_to_item() {} };
  const toggled = [];
  page.toggleEnabled = (row) => toggled.push(row.key);
  assert.equal(page.focusKey, null);
  assert.equal(page.onKey({ key: " " }, cx), true);
  assert.deepEqual(toggled, ["claude"]);
  assert.equal(page.focusKey, null);
  assert.equal(page.onKey({ key: "space" }, cx), true);
  assert.equal(page.onKey({ key: "r" }, cx), true);
  assert.equal(tasks.length, 1);
  await drain();
  assert.equal(page.onKey({}, cx), false);
  assert.equal(page.onKey({ key: "enter" }, cx), true);
  assert.equal(page.expanded.has("claude"), true);
  page.agents = [];
  assert.equal(page.onKey({ key: "down" }, cx), false);
  page.agents = agents;
  page.focusKey = "codex";
  assert.equal(page.onKey({ key: "down" }, cx), true);
  assert.equal(page.focusKey, "claude");
  assert.equal(page.onKey({ key: "up" }, cx), true);
  assert.equal(page.focusKey, "codex");
  assert.equal(page.onKey({ key: "up" }, cx), true);
  assert.equal(page.focusKey, "claude");
  page.permissionOpen = "default";
  assert.equal(page.onKey({ key: "x" }, cx), false);
  assert.equal(page.permissionOpen, "default");
});

test("the permission menu opens one id at a time and only the open one closes", (t) => {
  const { page, cx } = harness(t);
  page.setPermissionMenu("default", true, cx);
  assert.equal(page.permissionOpen, "default");
  page.setPermissionMenu("claude", false, cx);
  assert.equal(page.permissionOpen, "default");
  page.setPermissionMenu("claude", true, cx);
  assert.equal(page.permissionOpen, "claude");
  page.setPermissionMenu("claude", false, cx);
  assert.equal(page.permissionOpen, null);
  assert.equal(page.permissionActive, -1);
});

test("the toggle tooltip and label depend on installation and state", (t) => {
  const { page } = harness(t);
  const theme = new Proxy({}, { get: (_t, key) => `#${String(key)}` });
  const text = (row) => JSON.stringify(page.toggle(row, theme).__node);
  const row = { key: "claude", name: "Claude", installed: true, enabled: true };
  assert.match(text(row), /Disable Claude/);
  assert.match(text({ ...row, enabled: false }), /Enable Claude/);
  assert.match(text({ ...row, installed: false }), /Install Claude first/);
});

const field = (text) => ({ value: () => text, set_value(value) { text = value; }, set_masked() {} });
const draftOf = (command, args = "", over = {}) => ({ command: field(command), args: field(args), originalArgs: [], dirty: true, error: null, conflict: false, force: false, ...over });
async function ready(t) {
  const ctx = harness(t);
  globalThis.__herdrExec = () => output("HERDRAM:1\nHERDRAM:0");
  await ctx.drain();
  ctx.timers.length = 0;
  return ctx;
}
const rowOf = (page, key = "claude") => page.allRows().all.find((row) => row.key === key);

test("saving validates the draft, skips a clean one and writes a dirty one back into the editor", async (t) => {
  const { page, cx, drain, timers, files, tasks } = await ready(t);
  const row = rowOf(page);
  await page.save(row, cx);
  const draft = draftOf("");
  page.editors.set("claude", draft);
  await page.save(row, cx);
  assert.ok(draft.error);
  draft.command.set_value("cli");
  draft.dirty = false;
  draft.error = null;
  await page.save(row, cx);
  assert.equal(files.get(PROGRAMS), "{}");
  draft.dirty = true;
  await page.save(row, cx);
  assert.deepEqual(JSON.parse(files.get(PROGRAMS)).programs.claude.run, ["cli"]);
  assert.deepEqual([draft.dirty, draft.error, draft.conflict, draft.force], [false, null, false, false]);
  assert.equal(draft.command.value(), "cli");
  assert.equal(page.savedKey, "claude");
  assert.equal(timers.at(-1)[0], 2200);
  timers.at(-1)[1]();
  assert.equal(page.savedKey, null);
  assert.equal(tasks.length, 1);
  await drain();
  await page.reset({ ...row, builtin: false }, cx);
  await page.reset({ ...row, defaultCmd: null }, cx);
  assert.deepEqual(JSON.parse(files.get(PROGRAMS)).programs.claude.run, ["cli"]);
  await page.reset(rowOf(page), cx);
  assert.deepEqual(JSON.parse(files.get(PROGRAMS)).programs, {});
  assert.equal(draft.command.value(), "claude");
});

test("a write that lost a race keeps the draft until overwritten, and a failed or invalid write keeps it too", async (t) => {
  const { page, cx, files } = await ready(t);
  const row = rowOf(page);
  const draft = draftOf("cli");
  page.editors.set("claude", draft);
  files.set(PROGRAMS, '{"programs":{"claude":{"run":["theirs"]}}}');
  await page.writeRun(row, ["cli"], cx);
  assert.equal(draft.conflict, true);
  assert.equal(page.externalConflict, true);
  assert.match(page.writeError, /programs\.json changed on disk/);
  assert.equal(page.pendingProgramsText, '{"programs":{"claude":{"run":["theirs"]}}}');
  draft.force = true;
  await page.writeRun(row, ["cli"], cx);
  assert.deepEqual(JSON.parse(files.get(PROGRAMS)).programs.claude.run, ["cli"]);
  assert.equal(draft.conflict, false);
  const other = draftOf("x");
  page.editors.set("codex", other);
  page.programsText = "[1]";
  files.set(PROGRAMS, "[1]");
  await page.writeRun(rowOf(page, "codex"), ["x"], cx);
  assert.ok(other.error);
  page.programsText = "{}";
  files.set(PROGRAMS, "{}");
  const broken = { get: (path) => files.get(path), set() { throw new Error("disk full"); } };
  globalThis.__herdrFiles = broken;
  await page.writeRun(rowOf(page, "codex"), ["x"], cx);
  assert.equal(other.conflict, true);
  assert.match(page.writeError, /Could not save programs\.json: disk full\. Your edit is kept\./);
  assert.equal(page.pendingProgramsText, "{}");
  await page.writeRun({ key: "unknown" }, ["x"], cx);
});

test("the availability switch ignores locked rows and reports an unreadable or unwritable file", async (t) => {
  const { page, cx, drain, files, tasks } = await ready(t);
  page.toggleEnabled({ key: "claude", installed: false }, cx);
  page.managerError = "bad";
  page.toggleEnabled({ key: "claude", installed: true }, cx);
  assert.equal(tasks.length, 0);
  page.managerError = null;
  files.set(MANAGER, "{ nope");
  page.toggleEnabled({ key: "claude", installed: true }, cx);
  await drain();
  assert.match(page.managerError, /not valid JSON/);
  files.set(MANAGER, '{"disabled":["claude"]}');
  page.managerError = null;
  page.toggleEnabled({ key: "claude", installed: true }, cx);
  await drain();
  assert.deepEqual(JSON.parse(files.get(MANAGER)).disabled, []);
  assert.equal(page.disabled.size, 0);
  const text = files.get(MANAGER);
  globalThis.__herdrFiles = { get: (path) => files.get(path), set() { throw new Error("read only"); } };
  page.toggleEnabled({ key: "claude", installed: true }, cx);
  await drain();
  assert.match(page.writeError, /Could not save agent-manager\.json: read only/);
  assert.equal(files.get(MANAGER), text);
});

test("permission notices expire unless they offer a retry, and invalid files block a change", async (t) => {
  const { page, cx, timers } = await ready(t);
  page.flashPermission("one", "muted", cx);
  page.flashPermission("two", "muted", cx, () => {});
  assert.equal(timers.at(-2)[0], 6000);
  timers.at(-2)[1]();
  assert.equal(page.permissionNotice.text, "two");
  timers.at(-1)[1]();
  assert.equal(page.permissionNotice.text, "two");
  page.flashPermission("three", "muted", cx);
  timers.at(-1)[1]();
  assert.equal(page.permissionNotice, null);
  page.programsError = "x";
  assert.equal(page.permissionReady(cx), false);
  assert.match(page.permissionNotice.text, /programs\.json is invalid/);
  page.programsError = null;
  page.managerError = "x";
  assert.equal(page.permissionReady(cx), false);
  assert.match(page.permissionNotice.text, /agent-manager\.json is invalid/);
  page.managerError = null;
  assert.equal(page.permissionReady(cx), true);
  page.editors.set("claude", draftOf("x"));
  assert.equal(page.permissionBlocked(cx), true);
  assert.equal(page.permissionNotice.tone, "blocked");
});

test("finding the install path, npm root and real paths uses the login shell with timeouts", async (t) => {
  const { page } = await ready(t);
  const calls = [];
  globalThis.__herdrExec = (command, args, options) => {
    calls.push([command, args[0], options?.timeout]);
    if (command === "realpath") return output(`/real${args[0]}\n`);
    if (args.includes("root")) return output("/npm/root\n");
    if (args[0] === "-c") return output("/bin/zsh");
    return output("/bin/tool\n");
  };
  const found = await page.npmStatusFor({ key: "claude", defaultCmd: ["claude"], run: ["claude"] });
  assert.equal(found.method.package, "@anthropic-ai/claude-code");
  assert.equal(found.root, "/real/npm/root");
  assert.ok(calls.some(([command, arg, ms]) => command === "realpath" && ms === 5000));
  assert.ok(calls.some(([, arg, ms]) => arg === "root" && ms === 15000));
  assert.deepEqual(await page.npmStatusFor({ key: "zzz" }), { method: null, managed: false });
  assert.equal(await page.realPath("relative"), null);
  globalThis.__herdrExec = () => { throw new Error("no shell"); };
  assert.equal(await page.commandPath("claude"), null);
  globalThis.__herdrExec = () => output("", 1);
  assert.equal(await page.commandPath("claude"), null);
  assert.equal(await page.realPath("/x"), null);
});

test("the conflict dismiss button clears the banner", async (t) => {
  const { page, cx } = await ready(t);
  const buttons = new Map();
  const build = page.button.bind(page);
  page.button = (id, label, theme, click, options) => { buttons.set(id, click); return build(id, label, theme, click, options); };
  const draft = draftOf("claude");
  page.editors.set("claude", draft);
  page.externalConflict = true;
  page.render(cx);
  buttons.get("am-conflict-dismiss")({}, cx);
  assert.equal(page.externalConflict, false);
});
