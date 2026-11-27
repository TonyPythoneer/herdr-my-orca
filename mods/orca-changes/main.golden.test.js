// Characterization (golden-master) test for main.js: renders the panel, the entry menu and the dialogs in
// many states, then calls every click, hover, key and mouse handler it finds and records what each one did
// (git calls, commands, shared values, state). Recorded once from the code as it was before the refactor;
// delete main.golden.json to re-record after an intended behavior change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { commitAndPush } from "./commit-push.js";
import { GIT_OPTIONS, chunkPaths } from "./git-options.js";
import { sameOperationTarget } from "./operation-target.js";
import { prepareCreatePr, createPr } from "./create-pr.js";
import { assertDiscardUnchanged, discardSnapshot } from "./discard-snapshot.js";
import { displayPushDestination, forcePushConfirmed, forcePushTarget, pushConfigured } from "./push-target.js";

const GOLDEN = new URL("./main.golden.json", import.meta.url);
const MAIN = new URL("./main.js", import.meta.url);
// One Script, named after main.js and run in every fresh context, keeps line numbers and coverage attached to the file (the stripped text is blanked, not removed, so offsets hold).
const SOURCE = readFileSync(MAIN, "utf8")
  .replace(/^import .*;$/gm, (line) => " ".repeat(line.length)).replace("export default class Changes", `${" ".repeat(15)}class Changes`);
const SCRIPT = new vm.Script(`${SOURCE}\nglobalThis.Changes = Changes;`, { filename: fileURLToPath(MAIN) });
// dialog-button.js is a shared helper main.js imports; it runs in the same context, imports blanked the same way.
const DIALOG_BUTTON_SOURCE = readFileSync(new URL("./dialog-button.js", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, (line) => " ".repeat(line.length)).replace("export function DialogButton", "function DialogButton");
const DIALOG_BUTTON = new vm.Script(`${DIALOG_BUTTON_SOURCE}\nglobalThis.DialogButton = DialogButton;`, { filename: fileURLToPath(new URL("./dialog-button.js", import.meta.url)) });

function cleanse(value) {
  if (value?.__rec) return value.__rec;
  if (typeof value === "function") return "fn";
  if (Array.isArray(value)) return value.map(cleanse);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanse(v)]));
  return value;
}

function node(name, args) {
  const rec = { n: name, a: args.map(cleanse), c: [] };
  Object.defineProperty(rec, "fns", { value: {} });
  Object.defineProperty(rec, "kids", { value: [] });
  const proxy = new Proxy(function () {}, {
    get(_target, key) {
      if (key === "__rec") return rec;
      if (typeof key === "symbol") return undefined;
      return (...a) => {
        if (key === "when") {
          if (a[0]) { const r = a[1](proxy); if (r !== proxy) { rec.c.push(["when", cleanse(r)]); if (r?.__rec) rec.kids.push(r.__rec); } }
          return proxy;
        }
        if (key === "hover") { const inner = node("hover", []); a[0](inner); rec.c.push(["hover", inner.__rec]); return proxy; }
        rec.c.push([key, a.map(cleanse)]);
        if (key.startsWith("on_")) (rec.fns[key] ??= []).push(a.at(-1));
        if (key === "child") { if (a[0]?.__rec) rec.kids.push(a[0].__rec); }
        if (key === "children") for (const k of a[0] ?? []) if (k?.__rec) rec.kids.push(k.__rec);
        return proxy;
      };
    },
  });
  return proxy;
}
const factory = (name) => (...args) => node(name, args);
const builder = (name) => ({ new: (...args) => node(name, args) });

const theme = new Proxy({}, { get: (_t, key) => key === "is_dark" ? false : `#${String(key)}` });
const FILES = [
  { path: "src/a.js", section: "changes", status: "M", fresh: false, add: 3, del: 1 },
  { path: "new file.txt", section: "changes", status: "U", fresh: true, add: 0, del: 0 },
  { path: "gone.js", section: "changes", status: "D", fresh: false, add: 0, del: 4 },
  { path: "added.js", section: "changes", status: "A", fresh: false, add: 5, del: 0 },
  { path: "staged.js", section: "staged", status: "M", fresh: false, add: 1, del: 1 },
  { path: "bin.png", section: "staged", status: "A", fresh: false, add: 0, del: 0, binary: true },
  { path: "c1.js", section: "conflicts", status: "!", xy: "DU", fresh: false, add: 0, del: 0 },
  { path: "c2.js", section: "conflicts", status: "!", xy: "UU", fresh: false, add: 0, del: 0 },
  { path: "c3.js", section: "conflicts", status: "!", xy: "DD", fresh: false, add: 0, del: 0 },
];

// Answers every git call a flow can make; `script` overrides by a substring of the joined command line.
function gitAnswer(args, script) {
  const line = args.join(" ");
  for (const [needle, answer] of Object.entries(script)) if (line.includes(needle)) return typeof answer === "function" ? answer(args) : answer;
  if (line.includes("rev-parse --show-toplevel")) return { code: 0, stdout: "/repo\n" };
  if (line.includes("symbolic-ref --quiet HEAD")) return { code: 0, stdout: "refs/heads/topic\n" };
  if (line.includes("symbolic-ref refs/remotes/origin/HEAD")) return { code: 0, stdout: "refs/remotes/origin/main\n" };
  if (line.includes("for-each-ref")) return { code: 0, stdout: "refs/heads/topic\0origin\0refs/heads/topic\0refs/remotes/origin/topic\0origin\0refs/heads/topic\0refs/remotes/origin/topic" };
  if (line.includes("config --get-all remote.origin.push")) return { code: 1, stdout: "" };
  if (line.includes("config --get push.default")) return { code: 1, stdout: "" };
  if (line.includes("config --bool --get remote.origin.mirror")) return { code: 1, stdout: "" };
  if (line.includes("config --get-all branch.topic.merge")) return { code: 0, stdout: "refs/heads/topic\n" };
  if (line.includes("remote get-url --push --all origin")) return { code: 0, stdout: "https://u:p@example.com/r.git\n" };
  if (line.includes("rev-parse --verify HEAD^{commit}")) return { code: 0, stdout: `${"a".repeat(40)}\n` };
  if (line.includes("rev-parse --verify refs/remotes/origin/topic^{commit}")) return { code: 0, stdout: `${"b".repeat(40)}\n` };
  if (line.includes("--porcelain=v2")) return { code: 0, stdout: "u UU N... 100644 100644 100644 100644 h h h c2.js\0" };
  if (line.includes("ls-files")) return { code: 0, stdout: "src/a.js\0gone.js\0" };
  if (line.includes("diff --cached --numstat")) return { code: 0, stdout: "1\t1\tstaged.js\0" };
  if (line.includes("diff --numstat")) return { code: 0, stdout: "3\t1\tsrc/a.js\0" };
  if (line.includes("status --porcelain=v1")) return { code: 0, stdout: ["MM src/a.js", "?? new.txt", "UU c.js", "AD x"].join("\0") };
  return { code: 0, stdout: "", stderr: "" };
}

function setup({ script = {}, props = {}, spaceState } = {}) {
  const log = { exec: [], runs: [], shared: [], overlays: [], closed: [], copies: [], dialogs: [], timers: [], dialogClosed: 0 };
  const sharedValues = { "orca-diff.target": { path: "src/a.js", section: "changes" } };
  const state = { spaces: spaceState ?? [{ active: true, folder: "/repo", machine: "host", id: "s" }], props: { ...props } };
  const tasks = [];
  const scope = {
    View: class {}, div: factory("div"), svg: factory("svg"), v_flex: factory("v_flex"), h_flex: factory("h_flex"),
    TextareaState: { new: (...a) => ({ ...node("TextareaState", a), set_auto_grow() {}, on() {}, value: () => state.text ?? "", set_value(v) { log.exec.push(["set_value", v]); state.text = v; } }) },
    Textarea: builder("Textarea"), Input: builder("Input"),
    InputState: { new: () => ({ set_value() {}, value: () => state.inputText ?? "" }) },
    spaces: () => state.spaces, theme: () => theme, focused: () => ({ tab: "t1" }),
    panes: () => [{ pane: "p1", tab: "t1", focused: true }], shared: (k) => sharedValues[k], setShared: (k, v) => log.shared.push([k, cleanse(v)]),
    window: { open_dialog: (fn) => { log.dialogs.push(fn); }, close_dialog: () => { log.dialogClosed++; } },
    run: (name, args) => log.runs.push([name, cleanse(args)]), props: () => state.props,
    openOverlay: (o) => log.overlays.push(cleanse(o)), closeOverlay: (id) => log.closed.push(id), nextCommand: () => new Promise(() => {}),
    watchFolder: () => new Promise(() => {}), copyText: async (text) => { log.copies.push(text); }, reveal: async (path, flag) => { log.copies.push(["reveal", path, flag]); },
    exec: async (cmd, args, options) => { log.exec.push([cmd, args, options]); return gitAnswer(args, script); },
    commitAndPush, prepareCreatePr: (git, gh) => prepareCreatePr(git, gh), createPr, sameOperationTarget, READ: GIT_OPTIONS, chunks: chunkPaths,
    assertDiscardUnchanged, discardSnapshot, displayPushDestination, forcePushConfirmed, forcePushTarget, pushConfigured,
    panelFrame: (inner) => inner,
  };
  const context = vm.createContext(scope);
  SCRIPT.runInContext(context);
  DIALOG_BUTTON.runInContext(context);
  let notifies = 0;
  const cx = {
    notify() { notifies++; }, stop_propagation() { log.exec.push(["stop_propagation"]); },
    focus_handle: () => ({ focus() { log.exec.push(["focus"]); }, is_focused: () => state.focusedSection === true }),
    spawn(fn) { tasks.push(fn(cx)); },
    timer: { after(ms, fn) { log.timers.push(["after", ms]); log.pending = [...(log.pending ?? []), fn]; }, every(ms) { log.timers.push(["every", ms]); } },
  };
  const view = new scope.Changes();
  return { view, cx, log, state, sharedValues, scope, get notifies() { return notifies; }, tasks };
}

const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve)); };

async function ready(options, patch = {}) {
  const env = setup(options);
  if (options?.withMain) {
    // The entry menu is a second view; it reaches the panel's view through the module-level `mainChangesView`.
    const saved = env.state.props;
    env.state.props = {};
    const main = new env.scope.Changes();
    main.init(null, env.cx);
    await settle();
    Object.assign(main, { root: "/repo", on: "host", context: JSON.stringify({ cwd: "/repo", on: "host", space: "s" }), files: [], error: null, loading: false, busy: false });
    env.state.props = saved; env.main = main;
  }
  env.view.init(null, env.cx);
  await settle();
  env.log.exec.length = 0; env.log.runs.length = 0; env.log.timers.length = 0;
  Object.assign(env.view, { root: "/repo", on: "host", context: JSON.stringify({ cwd: "/repo", on: "host", space: "s" }), files: FILES, error: null, loading: false, busy: false, note: null, limited: false, message: "", ...structuredClone(patch) });
  env.notifies0 = env.notifies;
  return env;
}

const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const snapshotState = (view) => plain(Object.fromEntries(["note", "busy", "busyReason", "loading", "menuOpen", "typing", "collapsed", "hovered", "message", "error", "limited", "root", "on"].map((k) => [k, view[k] ?? null])));

function handlers(rec, path = [], out = []) {
  for (const [name, fns] of Object.entries(rec.fns)) fns.forEach((fn, idx) => out.push({ name, fn, idx, path: path.join("/"), rec }));
  rec.kids.forEach((kid, i) => handlers(kid, [...path, `${kid.n}${i}`], out));
  return out;
}

const SAMPLE_EVENTS = {
  on_click: [[{}]],
  on_hover: [[true], [false]],
  on_mouse_down: [[{}]],
  on_key_down: [[{ key: "escape", modifiers: {} }], [{ key: "enter", modifiers: { platform: true } }], [{ key: "enter", modifiers: { alt: true, control: true } }], [{ key: "space", modifiers: {} }], [{ key: "x", modifiers: {} }]],
};

async function fire(env, h, args) {
  await h.fn(args[0], env.cx);
  await settle();
}

function dialogTree(env) {
  const fn = env.log.dialogs.at(-1);
  if (!fn) return null;
  const root = fn();
  return root;
}

// Explore each handler of a render in a fresh environment, and each handler of any dialog it opened.
async function explore(label, options, patch, renderName = "renderBody") {
  const results = {};
  const probe = await ready(options, patch);
  const count = handlers(probe.view[renderName](probe.cx).__rec).length;
  for (let i = 0; i < count; i++) {
    const metaList = handlers(probe.view[renderName](probe.cx).__rec), meta = metaList[i];
    if (!meta) throw new Error(`${label}: handler ${i} of ${count} missing (${metaList.length})`);
    for (const [argIndex, args] of (SAMPLE_EVENTS[meta.name] ?? [[{}]]).entries()) {
      const env = await ready(options, patch);
      const h = handlers(env.view[renderName](env.cx).__rec)[i];
      await fire(env, h, args);
      const key = `${label}#${i}:${h.path}:${h.name}:${argIndex}`;
      const entry = { main: env.main ? snapshotState(env.main) : null, state: snapshotState(env.view), exec: plain(env.log.exec), runs: plain(env.log.runs), shared: plain(env.log.shared), overlays: plain(env.log.overlays), closed: plain(env.log.closed), copies: plain(env.log.copies), timers: plain(env.log.timers), dialogClosed: env.log.dialogClosed, notifies: env.notifies - env.notifies0, dialog: null, inner: {} };
      if (env.log.dialogs.length) {
        const dialog = dialogTree(env);
        entry.dialog = plain(dialog.__rec);
        const inner = handlers(dialog.__rec);
        for (let j = 0; j < inner.length; j++) {
          const env2 = await ready(options, patch);
          const h1 = handlers(env2.view[renderName](env2.cx).__rec)[i];
          await fire(env2, h1, args);
          const target = handlers(dialogTree(env2).__rec)[j];
          env2.log.exec.length = 0; env2.log.runs.length = 0; env2.log.dialogClosed = 0;
          const before = env2.notifies;
          await fire(env2, target, [{}]);
          entry.inner[`${j}:${target.path}:${target.name}`] = { main: env2.main ? snapshotState(env2.main) : null, state: snapshotState(env2.view), exec: plain(env2.log.exec), runs: plain(env2.log.runs), dialogClosed: env2.log.dialogClosed, notifies: env2.notifies - before, reopened: env2.log.dialogs.length };
        }
      }
      results[key] = entry;
    }
  }
  return results;
}

test("main.js behaves as recorded: renders, handlers and flows", async () => {
  const out = { renders: {}, flows: {}, handlers: {} };
  const render = async (name, patch, options, extra = {}) => {
    const env = await ready(options, patch);
    Object.assign(env.state, extra.state ?? {});
    out.renders[name] = plain(env.view.renderBody(env.cx).__rec);
  };
  const files = FILES, tab = { props: { tab: "entry-menu" } };
  await render("full", {});
  await render("no-root", { root: null, files: [] });
  await render("loading", { root: null, files: [], loading: true });
  await render("error", { root: null, files: [], error: "boom" });
  await render("clean", { files: [] });
  await render("typing-menu-message", { typing: true, menuOpen: true, message: "msg", note: "Push completed." });
  await render("hovered-failed-note", { hovered: "changes-src/a.js", note: "bad", collapsed: { changes: true } });
  await render("hover-staged-conflict", { hovered: "conflicts-c1.js" });
  await render("hover-staged", { hovered: "staged-staged.js" });
  await render("busy-limited", { busy: true, limited: true, busyReason: "Commit in progress…", hovered: "changes-new file.txt", files });
  await render("conflicts-block-commit", { message: "m", files: files.filter((f) => f.section === "conflicts") });
  await render("staged-no-message", { files: files.filter((f) => f.section === "staged") });
  await render("staged-with-message", { message: "m", files: files.filter((f) => f.section === "staged"), menuOpen: true });
  await render("menu-no-root", { menuOpen: true, root: null, files: [] });
  for (const [label, entry, root] of [
    ["changes", files[0], "/repo"], ["fresh", files[1], "/repo/"], ["deleted", files[2], "/repo"], ["staged", files[4], "/repo"],
    ["conflict-du", files[6], "/repo"], ["conflict-uu", files[7], "/repo"], ["conflict-dd", files[8], "/repo"], ["no-root", files[0], null],
  ]) {
    const env = await ready({ props: { ...tab.props, entry, target: { root, on: "host", context: "c" }, overlay: "ov" } });
    out.renders[`entry-menu-${label}`] = plain(env.view.renderBody(env.cx).__rec);
  }
  { const env = await ready({ props: { tab: "entry-menu" } }); out.renders["entry-menu-empty"] = plain(env.view.renderBody(env.cx).__rec); }
  { const env = await ready(); out.renders.panel = plain(env.view.render(env.cx).__rec); }
  { const env = await ready(); out.renders.tooMany = plain(env.view.tooManyBanner({ ...theme, is_dark: true }, env.cx).__rec); }

  const primary = {};
  for (const [name, patch] of Object.entries({ busy: { busy: true, busyReason: "r" }, conflicts: {}, ready: { message: " x ", files: files.filter((f) => f.section === "staged") },
    noMessage: { files: files.filter((f) => f.section === "staged") }, stage: { files: files.filter((f) => f.section === "changes") }, none: { files: [] } })) {
    const env = await ready(undefined, patch); primary[name] = plain(env.view.primaryAction());
  }
  out.flows.primaryAction = primary;

  out.handlers.panel = await explore("panel", {}, {});
  out.handlers.panelMenu = await explore("panel-menu", {}, { menuOpen: true, message: "m", typing: true, limited: true, files: files.filter((f) => f.section !== "conflicts" || f.xy === "UU") });
  out.handlers.panelStaged = await explore("panel-staged", {}, { message: "m", hovered: "staged-staged.js", files: files.filter((f) => f.section === "staged") });
  out.handlers.panelBusy = await explore("panel-busy", {}, { busy: true, hovered: "changes-src/a.js", collapsed: { staged: true } });
  for (const [label, entry] of [["changes", files[0]], ["conflict", files[6]], ["conflict-uu", files[7]], ["deleted", files[2]]]) {
    out.handlers[`entry-${label}`] = await explore(`entry-${label}`, { props: { tab: "entry-menu", entry, target: { root: "/repo", on: "host", context: JSON.stringify({ cwd: "/repo", on: "host", space: "s" }) }, overlay: "ov" }, withMain: true }, {});
  }
  out.handlers.entryMismatch = await explore("entry-mismatch", { props: { tab: "entry-menu", entry: files[6], target: { root: "/other", on: "host", context: "x" }, overlay: "ov" }, withMain: true }, {});

  // Direct flows with scripted Git answers, so every branch of the guards and the error copy is visited.
  const flow = async (name, fn, options, patch) => {
    const env = await ready(options, patch);
    let thrown = null;
    try { await fn(env); await settle(); } catch (e) { thrown = String(e); }
    out.flows[name] = { thrown, state: snapshotState(env.view), exec: plain(env.log.exec), runs: plain(env.log.runs), shared: plain(env.log.shared), dialogs: env.log.dialogs.length, dialogClosed: env.log.dialogClosed, notifies: env.notifies - env.notifies0 };
    return env;
  };
  const guarded = { busy: { busy: true }, loading: { loading: true }, noRoot: { root: null }, otherContext: { context: "other" } };
  for (const method of ["runPrimary", "runCommitAndPush", "runPush", "runSync", "runFetch", "runPull", "runForcePush", "runPublish", "runRebase", "openCreatePrDialog"]) {
    for (const [g, patch] of Object.entries({ ok: { message: "m", files: files.filter((f) => f.section === "staged") }, ...guarded })) {
      await flow(`${method}-${g}`, (env) => env.view[method](env.cx), undefined, patch);
    }
  }
  await flow("runPrimary-stage", (env) => env.view.runPrimary(env.cx), undefined, { files: files.filter((f) => f.section === "changes") });
  await flow("commit-and-push-fail-commit", (env) => env.view.runCommitAndPush(env.cx), { script: { " commit ": { code: 1, stderr: "nope", stdout: "" } } }, { message: "m", files: files.filter((f) => f.section === "staged") });
  await flow("commit-and-push-fail-push", (env) => env.view.runCommitAndPush(env.cx), { script: { "push --no-follow-tags": { code: 1, stderr: "rejected https://u:p@example.com/r.git", stdout: "" } } }, { message: "m", files: files.filter((f) => f.section === "staged") });
  await flow("commit-and-push-ok", (env) => env.view.runCommitAndPush(env.cx), undefined, { message: "m", files: files.filter((f) => f.section === "staged") });
  await flow("push-ok", (env) => env.view.runPush(env.cx));
  await flow("push-fail", (env) => env.view.runPush(env.cx), { script: { "push --no-follow-tags": { code: 1, stderr: "denied", stdout: "" } } });
  await flow("push-no-target", (env) => env.view.runPush(env.cx), { script: { "symbolic-ref --quiet HEAD": { code: 1, stdout: "" } } });
  await flow("push-silent-fail", (env) => env.view.runPush(env.cx), { script: { "push --no-follow-tags": { code: 1, stdout: "", stderr: "" } } });
  await flow("rebase-ok", (env) => env.view.runRebase(env.cx));
  await flow("rebase-no-base", (env) => env.view.runRebase(env.cx), { script: { "symbolic-ref refs/remotes/origin/HEAD": { code: 1, stdout: "" } } });
  await flow("rebase-fail", (env) => env.view.runRebase(env.cx), { script: { "rebase origin/main": { code: 1, stderr: "conflict", stdout: "" } } });
  await flow("force-push-dialog", async (env) => { await env.view.runForcePush(env.cx); await settle(); const d = dialogTree(env); out.flows.forcePushDialog = plain(d.__rec); for (const h of handlers(d.__rec)) await fire(env, h, [{}]); });
  await flow("force-push-confirm", (env) => env.view.confirmForcePush(env.view.operationTarget(), { branch: "topic", remote: "origin", ref: "refs/heads/topic", oid: "a".repeat(40), destination: "https://u:p@example.com/r.git", leaseTracking: "refs/remotes/origin/topic", expected: "b".repeat(40) }, env.cx));
  await flow("force-push-confirm-busy", (env) => env.view.confirmForcePush(env.view.operationTarget(), {}, env.cx), undefined, { busy: true });
  await flow("force-push-no-lease", (env) => env.view.runForcePush(env.cx), { script: { "for-each-ref": { code: 0, stdout: "refs/heads/topic\0origin\0refs/heads/topic\0\0\0\0" } } });
  await flow("create-pr-dialog", async (env) => {
    await env.view.openCreatePrDialog(env.cx); await settle();
    if (env.log.dialogs.length) { const d = dialogTree(env); out.flows.createPrDialog = plain(d.__rec); for (const h of handlers(d.__rec)) await fire(env, h, [{}]); }
  }, { script: { "symbolic-ref --quiet HEAD": { code: 0, stdout: "refs/heads/topic\n" }, "config --null --get-all branch.topic.remote": { code: 0, stdout: "origin\0" }, "config --null --get-all branch.topic.merge": { code: 0, stdout: "refs/heads/topic\0" }, "remote get-url --all origin": { code: 0, stdout: "git@github.com:o/r.git\n" }, "gh": { code: 0, stdout: "" } } });
  await flow("submit-create-pr", (env) => env.view.submitCreatePr(env.view.operationTarget(), {}, { title: "t", body: "b", draft: true }, env.cx));
  await flow("submit-create-pr-busy", (env) => env.view.submitCreatePr(env.view.operationTarget(), {}, { title: "t", body: "b", draft: true }, env.cx), undefined, { busy: true });
  for (const [name, target] of [["ok", undefined], ["stale", { root: "/x", on: "host", context: "x" }]]) {
    await flow(`apply-${name}`, (env) => env.view.apply([["add", "--", "a"], ["commit", "-m", "x"]], env.cx, () => { env.log.exec.push(["done"]); }, target));
  }
  await flow("apply-fail", (env) => env.view.apply([["add", "--", "a"]], env.cx), { script: { "add -- a": { code: 1, stderr: "", stdout: "failed" } } });
  await flow("apply-context-change", (env) => { env.view.apply([["add", "--", "a"], ["add", "--", "b"]], env.cx); env.state.spaces = [{ active: true, folder: "/other", machine: "host", id: "s" }]; });
  await flow("stage-paths", (env) => env.view.stagePaths(Array.from({ length: 450 }, (_, i) => `f${i}`), env.cx));
  await flow("unstage-paths", (env) => env.view.unstagePaths(["a", "b"], env.cx));
  for (const [name, patch] of Object.entries({ ok: {}, busy: { busy: true }, mismatch: { context: "x" } })) {
    await flow(`prepare-discard-${name}`, (env) => env.view.prepareDiscard(env.view.operationTarget(), ["a"], env.cx, (s) => env.log.exec.push(["open", plain(s)])), undefined, patch);
    await flow(`verify-discard-${name}`, (env) => env.view.verifyDiscard(env.view.operationTarget(), ["a"], {}, env.cx, () => env.log.exec.push(["perform"])), undefined, patch);
    await flow(`discard-paths-${name}`, (env) => env.view.discardPaths(["src/a.js", "new.txt"], "staged", env.cx), undefined, patch);
    await flow(`resolve-${name}`, (env) => env.view.resolveConflict(files[7], "mark_resolved", env.cx), undefined, patch);
    await flow(`confirm-discard-all-${name}`, async (env) => { env.view.confirmDiscardAll("changes", ["a", "b"], env.cx); await settle(); }, undefined, patch);
  }
  await flow("discard-paths-clean", (env) => env.view.discardPaths(["src/a.js", "new.txt"], "changes", env.cx), { script: { "clean -f": { code: 1, stderr: "no", stdout: "" } } });
  await flow("discard-paths-context", (env) => { env.view.discardPaths(["a"], "changes", env.cx); env.state.spaces = []; });
  await flow("confirm-discard-all-empty", (env) => env.view.confirmDiscardAll("staged", [], env.cx));
  await flow("confirm-discard-all-staged", async (env) => { env.view.confirmDiscardAll("staged", ["one"], env.cx); await settle(); out.flows.discardAllStagedDialog = plain(dialogTree(env)?.__rec); });
  await flow("resolve-keep-deletion", (env) => env.view.resolveConflict(files[6], "keep_deletion", env.cx));
  await flow("resolve-keep-file-missing", (env) => env.view.resolveConflict(files[6], "keep_file", env.cx), { script: { "--porcelain=v2": { code: 0, stdout: "u DU N... 100644 000000 100644 100644 h h h c1.js\0" } } });
  await flow("resolve-not-conflict", (env) => env.view.resolveConflict(files[6], "keep_file", env.cx), { script: { "--porcelain=v2": { code: 0, stdout: "" } } });
  await flow("resolve-status-fail", (env) => env.view.resolveConflict(files[6], "keep_file", env.cx), { script: { "--porcelain=v2": { code: 1, stdout: "", stderr: "bad" } } });
  await flow("resolve-add-fail", (env) => env.view.resolveConflict(files[7], "mark_resolved", env.cx), { script: { "--literal-pathspecs add": { code: 1, stdout: "", stderr: "denied" } } });
  await flow("resolve-target-changed", (env) => { const target = env.view.operationTarget(); env.view.resolveConflict(files[7], "mark_resolved", env.cx, target); env.state.spaces = [{ active: true, folder: "/other", machine: "host", id: "s" }]; });
  await flow("confirm-discard", async (env) => {
    for (const f of [files[0], files[1], files[2]]) { env.view.confirmDiscard(f, f.path.split("/").pop(), env.cx); await settle(); out.flows[`discardDialog-${f.status}`] = plain(dialogTree(env)?.__rec); }
  });
  for (const [name, f, root, extra] of [["file", files[0], "/repo", {}], ["section", { sectionAll: true, section: "changes", paths: ["a"], limited: true }, "/repo", {}], ["all", { all: true }, "/repo", {}],
    ["conflict", files[6], "/repo", {}], ["noroot", files[0], null, { root: null }]]) {
    await flow(`open-diff-${name}`, (env) => env.view.openDiff(f, root ?? undefined, "host"), undefined, extra);
  }
  await flow("open-diff-default-args", (env) => env.view.openDiff(files[0]));
  await flow("open-entry", (env) => env.view.openEntry(files[0]));
  await flow("open-entry-no-cwd", (env) => env.view.openEntry(files[0]), undefined, { root: "/repo/sub/" });
  await flow("open-diff-no-panes", (env) => { env.scope.panes = () => []; env.view.openDiff(files[0]); });
  await flow("open-diff-existing-pane", (env) => { env.scope.panes = () => [{ pane: "p9", tab: "t1", mod: "orca-diff" }]; env.view.openDiff(files[0]); });
  await flow("open-diff-hostless", (env) => { env.scope.panes = () => [{ pane: "p9", tab: "t1", mod: "other" }]; env.view.openDiff(files[0]); });

  // refresh paths: not a repo, failing status, stale context, watch.
  await flow("refresh-not-repo", (env) => env.view.refresh(env.cx), { script: { "rev-parse --show-toplevel": { code: 128, stdout: "" } } });
  await flow("refresh-status-fail", (env) => env.view.refresh(env.cx), { script: { "status --porcelain=v1": { code: 1, stderr: "bad", stdout: "" } } });
  await flow("refresh-numstat-fail", (env) => env.view.refresh(env.cx), { script: { "diff --numstat": { code: 1, stderr: "bad numstat", stdout: "" } } });
  await flow("refresh-ok-watch", (env) => env.view.refresh(env.cx));
  await flow("refresh-no-cwd", (env) => env.view.refresh(env.cx), { spaceState: [] }, { context: undefined });
  await flow("refresh-context-change", (env) => { env.view.refresh(env.cx); env.state.spaces = [{ active: true, folder: "/other", machine: "host", id: "s" }]; }, undefined, { context: undefined });
  await flow("refresh-new-context", (env) => env.view.refresh(env.cx), undefined, { context: "other", message: "m" });
  await flow("watch-twice", (env) => { env.view.on = null; env.view.watched = null; env.view.watch("/repo", env.cx); env.view.watch("/repo", env.cx); });
  await flow("watch-loop", (env) => {
    let calls = 0;
    env.scope.watchFolder = async (root) => { env.log.exec.push(["watch", root, ++calls]); if (calls > 1) throw new Error("gone"); };
    env.view.on = null; env.view.watched = null; env.view.watch("/repo", env.cx);
  });

  // init: commands, timers, entry-menu tab and the key handlers of the root.
  {
    const env = setup({ props: { tab: "entry-menu" } });
    env.view.init(null, env.cx); await settle();
    out.flows.initEntryMenu = { runs: plain(env.log.runs), exec: plain(env.log.exec), timers: plain(env.log.timers) };
  }
  {
    const env = setup(); const commands = ["other", "refresh"];
    env.scope.nextCommand = () => commands.length ? Promise.resolve(commands.shift()) : new Promise(() => {});
    env.view.init(null, env.cx); await settle();
    out.flows.initCommands = { exec: plain(env.log.exec), timers: plain(env.log.timers), notifies: env.notifies, files: env.view.files.length };
  }
  {
    const env = await ready();
    env.view.context = "stale"; env.view.renderBody(env.cx);
    out.flows.renderDefersRefresh = { timers: plain(env.log.timers), pending: env.log.pending?.length ?? 0 };
    await env.log.pending[0]?.(env.cx); await settle();
    out.flows.renderDefersRefresh.after = { exec: plain(env.log.exec), context: env.view.context };
  }
  out.flows.relPath = (() => {
    const env = setup();
    return plain([["/a/b", "/a/b/c.js"], ["/a/b/", "/a/c/d.js"], ["/a", "/b"]].map(([from, to]) => env.scope.relPath(from, to)));
  })();
  out.flows.tones = (() => {
    const env = setup();
    return plain(["A", "D", "M", "R", "U", "C", "!", "Z"].map((m) => env.scope.gitTone(m, { dim: "#dim" })));
  })();
  out.flows.conflictResolutions = (() => {
    const env = setup();
    return plain(["DD", "DU", "UD", "UU", "AA"].map((xy) => env.scope.conflictResolutions(xy)));
  })();

  // The golden file keeps one SHA-256 per scenario (the full record is megabytes); set GOLDEN_FULL=<file>
  // to dump the full record and diff it against one taken before a change.
  if (process.env.GOLDEN_FULL) writeFileSync(process.env.GOLDEN_FULL, JSON.stringify(out, null, 1));
  const digest = {};
  for (const [group, entries] of Object.entries(out)) for (const [name, value] of Object.entries(entries)) digest[`${group}/${name}`] = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  if (!existsSync(GOLDEN)) writeFileSync(GOLDEN, JSON.stringify(digest, null, 1) + "\n");
  assert.deepStrictEqual(digest, JSON.parse(readFileSync(GOLDEN, "utf8")));
});
