// Characterization (golden-master) test for main.js: the dialog is opened in each mode and repository state,
// rendered, and every click, key and input handler it exposes is called; what each did (git calls, commands,
// state) is recorded as a SHA-256 per scenario in main.golden.json, once from the code as it was before the
// refactor. Set GOLDEN_FULL=<file> to dump the full record for a diff; delete main.golden.json to re-record
// after an intended behavior change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { removeWorktree, REMOVE_UNAVAILABLE } from "./remove.js";
import { ROOT, tilde, slug, ago, spaceOf, branchRows, switchBlocker } from "./helpers.js";

const GOLDEN = new URL("./main.golden.json", import.meta.url);
const MAIN = new URL("./main.js", import.meta.url);
const SOURCE = readFileSync(MAIN, "utf8")
  .replace(/^import .*;$/gm, (line) => " ".repeat(line.length)).replace("export default class Worktree", `${" ".repeat(15)}class Worktree`);
// One Script, named after main.js and run in every fresh context, keeps coverage attached to the file.
const SCRIPT = new vm.Script(`${SOURCE}\nglobalThis.Worktree = Worktree;`, { filename: fileURLToPath(MAIN) });

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
        if (key === "child" && a[0]?.__rec) rec.kids.push(a[0].__rec);
        if (key === "children") for (const k of a[0] ?? []) if (k?.__rec) rec.kids.push(k.__rec);
        return proxy;
      };
    },
  });
  return proxy;
}
const factory = (name) => (...args) => node(name, args);
const theme = new Proxy({}, { get: (_t, key) => `#${String(key)}` });
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve)); };

const BLOCKS = [
  "worktree /repo\nHEAD a1\nbranch refs/heads/main",
  "worktree /wt/feat\nHEAD a2\nbranch refs/heads/feat",
  "worktree /wt/det\nHEAD a3\ndetached",
  "worktree /wt/bare\nbare",
  "worktree /wt/gone\nHEAD a4\nbranch refs/heads/gone\nprunable gitdir file points to non-existent location",
  "worktree /wt/nobranch\nHEAD a5\nbranch refs/heads/other",
].join("\n\n");

function answer(args, script, opts) {
  const line = args.join(" ");
  for (const [needle, value] of Object.entries(script)) if (line.includes(needle)) return typeof value === "function" ? value(args, opts) : value;
  if (line.includes("--show-toplevel")) return { code: 0, stdout: "/repo\n" };
  if (line.includes("--git-common-dir")) return { code: 0, stdout: "/repo/.git\n" };
  if (line.includes("worktree list")) return { code: 0, stdout: BLOCKS };
  if (line.includes("for-each-ref")) return { code: 0, stdout: "main\t300\nfeat\t200\nother\t100\nnodate\t" };
  if (line.includes("symbolic-ref")) return { code: 0, stdout: "main\n" };
  if (line.includes("status --porcelain")) return { code: 0, stdout: "" };
  if (line.includes("show-ref")) return { code: 1, stdout: "" };
  return { code: 0, stdout: "", stderr: "" };
}

function setup({ props = {}, spaces, panes, agents = [], script = {}, shell = "ok" } = {}) {
  const log = { exec: [], runs: [], closed: [], timers: [], focus: [] };
  const state = {
    props: { overlay: "ov", ...props },
    spaces: spaces ?? [{ id: "s1", active: true, folder: "/repo", machine: props.machine ?? null, name: "repo", tabs: [{ id: "t1" }] }],
    panes: panes ?? [{ tab: "t1", cwd: "/repo/sub" }, { tab: "t9", cwd: "/wt/feat" }], agents, inputs: {},
  };
  const scope = {
    View: class {}, div: factory("div"), v_flex: factory("v_flex"), h_flex: factory("h_flex"), Input: { new: (...a) => node("Input", a) }, Scrollbar: { vertical: (...a) => node("Scrollbar.vertical", a) },
    InputState: { new: (opts) => { const handlers = {}; const input = { opts, handlers, on(name, fn) { handlers[name] = fn; }, value: () => state.inputText ?? opts.value ?? "", focus() { log.focus.push("input"); } }; state.inputs.last = input; return input; } },
    run: (name, args) => log.runs.push([name, cleanse(args)]), props: () => state.props, closeOverlay: (id) => log.closed.push(id), theme: () => theme,
    spaces: () => state.spaces, panes: () => state.panes, agents: () => state.agents, home: () => "/home/u",
    exec: async (cmd, args, opts) => {
      log.exec.push([cmd, args, opts]);
      if (cmd === "sh") { if (shell === "throw") throw new Error("no sh"); if (shell === "empty") return { code: 0, stdout: "" }; return { code: 0, stdout: "/home/remote\n" }; }
      if (cmd === "powershell.exe") return shell === "powershell-fail" ? { code: 1, stdout: "" } : { code: 0, stdout: "C:\\Users\\r" };
      return answer(args, script, opts);
    },
    removeWorktree, REMOVE_UNAVAILABLE, ROOT, tilde, slug, ago, spaceOf, branchRows, switchBlocker,
  };
  SCRIPT.runInNewContext(scope);
  let notifies = 0;
  const handle = { focus() { log.focus.push("handle"); } };
  const cx = {
    notify() { notifies++; }, stop_propagation() { log.focus.push("stop"); }, focus_handle: () => handle,
    spawn(fn) { fn(cx); }, timer: { after(ms, fn) { log.timers.push(ms); fn(); } },
  };
  const view = new scope.Worktree();
  return { view, cx, log, state, get notifies() { return notifies; } };
}

async function opened(options, patch = {}) {
  const env = setup(options);
  env.view.init(null, env.cx);
  await settle();
  Object.assign(env.view, structuredClone(patch));
  env.log.exec.length = 0; env.log.runs.length = 0; env.log.closed.length = 0; env.log.timers.length = 0; env.log.focus.length = 0;
  env.n0 = env.notifies;
  return env;
}
const view = (v) => plain(Object.fromEntries(["on", "userHome", "opening", "switching", "text", "list", "branches", "current", "blocker", "at", "busy", "error", "repo", "folder", "inputFocused"].map((k) => [k, v[k] ?? null])));

function handlers(rec, path = [], out = []) {
  for (const [name, fns] of Object.entries(rec.fns)) fns.forEach((fn) => out.push({ name, fn, path: path.join("/") }));
  rec.kids.forEach((kid, i) => handlers(kid, [...path, `${kid.n}${i}`], out));
  return out;
}
const KEYS = [{ key: "escape" }, { key: "enter" }, { key: "down" }, { key: "up" }, { key: "x" }];

async function explore(label, options, patch) {
  const out = {};
  const probe = await opened(options, patch);
  const count = handlers(probe.view.render(probe.cx).__rec).length;
  for (let i = 0; i < count; i++) {
    const kinds = handlers(probe.view.render(probe.cx).__rec)[i].name === "on_key_down" ? KEYS : [{}];
    for (const [k, ev] of kinds.entries()) {
      const env = await opened(options, patch);
      const h = handlers(env.view.render(env.cx).__rec)[i];
      await h.fn(ev, env.cx); await settle();
      out[`${label}#${i}:${h.path}:${h.name}:${k}`] = { view: view(env.view), exec: plain(env.log.exec), runs: plain(env.log.runs), closed: plain(env.log.closed), focus: env.log.focus, notifies: env.notifies - env.n0, after: plain(env.view.render(env.cx).__rec) };
    }
  }
  // The input's own handlers (change / submit / focus / blur) are not part of the render tree.
  for (const name of ["change", "submit", "focus", "blur"]) {
    const env = await opened(options, patch);
    env.state.inputText = "fe";
    env.state.inputs.last.handlers[name]({}, env.cx); await settle();
    out[`${label}#input:${name}`] = { view: view(env.view), exec: plain(env.log.exec), runs: plain(env.log.runs), closed: plain(env.log.closed), notifies: env.notifies - env.n0 };
  }
  return out;
}

test("worktree dialog behaves as recorded: renders, handlers and flows", async () => {
  const out = { renders: {}, handlers: {}, flows: {} };
  const MODES = { new: { action: "new", space: "s1", tab: "t2", argv: ["x"] }, open: { action: "open", space: "s1" }, switch: { action: "switch", space: "s1" }, remove: { action: "remove", space: "s1" },
    newFolder: { action: "new", folder: "/solo", machine: "m1" }, newBranch: { action: "new", space: "s1", branch: "feat/x" }, removeBranch: { action: "remove", space: "s1", branch: "x" } };
  for (const [name, props] of Object.entries(MODES)) {
    const env = await opened({ props });
    out.renders[name] = { view: view(env.view), tree: plain(env.view.render(env.cx).__rec), exec: plain(env.log.exec), runs: plain(env.log.runs), closed: plain(env.log.closed) };
    out.handlers[name] = await explore(name, { props }, {});
  }
  const notGit = { script: { "--show-toplevel": { code: 128, stdout: "" } } };
  for (const [name, props] of Object.entries({ new: MODES.new, open: MODES.open, switch: MODES.switch })) {
    const env = await opened({ props, ...notGit });
    out.renders[`${name}-not-git`] = { view: view(env.view), tree: plain(env.view.render(env.cx).__rec) };
  }
  for (const [name, patch] of Object.entries({ looking: { repo: undefined }, notGit: { repo: null }, busy: { busy: true }, error: { error: "oops" }, unfocused: { inputFocused: false, text: "fe" }, noMatch: { text: "zzz" }, at: { at: 1, text: "" } })) {
    for (const mode of ["open", "switch", "new", "remove"]) {
      const env = await opened({ props: MODES[mode] }, patch);
      out.renders[`${mode}-${name}`] = plain(env.view.render(env.cx).__rec);
      if (mode === "open" || mode === "switch") out.handlers[`${mode}-${name}`] = await explore(`${mode}-${name}`, { props: MODES[mode] }, patch);
    }
  }
  out.renders["switch-blocker"] = plain((await opened({ props: MODES.switch, script: { "status --porcelain": { code: 0, stdout: " M a\n?? b" } } })).view.render({}).__rec);
  out.handlers["switch-blocker"] = await explore("switch-blocker", { props: MODES.switch, script: { "status --porcelain": { code: 0, stdout: " M a\n?? b" } } }, {});
  out.handlers["switch-held"] = await explore("switch-held", { props: MODES.switch }, { at: 1 });
  out.handlers["open-filter"] = await explore("open-filter", { props: MODES.open }, { text: "feat", at: 0 });
  out.handlers["open-no-space"] = await explore("open-no-space", { props: MODES.open, panes: [] }, {});

  // Flows with scripted answers.
  const flow = async (name, fn, options = { props: MODES.new }, patch = {}) => {
    const env = await opened(options, patch);
    let thrown = null, returned;
    try { returned = await fn(env); await settle(); } catch (e) { thrown = String(e); }
    out.flows[name] = { thrown, returned: plain(returned), view: view(env.view), exec: plain(env.log.exec), runs: plain(env.log.runs), closed: plain(env.log.closed), focus: env.log.focus, timers: env.log.timers, notifies: env.notifies - env.n0 };
  };
  const created = [["empty", ""], ["spaces", "   "], ["dash", "-x"], ["nonslug", "!!!"], ["plain", "feat"], ["slash", "feat/Login Page"]];
  for (const [name, text] of created) await flow(`create-${name}`, (env) => env.view.create(), { props: MODES.new }, { text });
  await flow("create-exists", (env) => env.view.create(), { props: MODES.new, script: { "show-ref": { code: 0, stdout: "" } } }, { text: "feat" });
  await flow("create-add-fails", (env) => env.view.create(), { props: MODES.new, script: { "worktree add": { code: 1, stdout: "", stderr: "exists already" } } }, { text: "feat" });
  await flow("create-add-fails-silent", (env) => env.view.create(), { props: MODES.new, script: { "worktree add": { code: 1, stdout: "out only", stderr: undefined } } }, { text: "feat" });
  await flow("create-add-fails-empty", (env) => env.view.create(), { props: MODES.new, script: { "worktree add": { code: 1, stdout: "", stderr: "" } } }, { text: "feat" });
  await flow("create-remote", (env) => env.view.create(), { props: { action: "new", folder: "/r", machine: "host" } }, { text: "b" });
  await flow("work-new", (env) => env.view.work(env.cx), { props: MODES.new }, { text: "feat" });
  await flow("work-new-empty", (env) => env.view.work(env.cx), { props: MODES.new }, { text: "" });
  await flow("work-remove", (env) => env.view.work(env.cx), { props: MODES.remove });
  await flow("work-busy", (env) => env.view.work(env.cx), { props: MODES.new }, { busy: true, text: "a" });
  await flow("work-no-repo", (env) => env.view.work(env.cx), { props: MODES.new }, { repo: null, text: "a" });
  await flow("work-throws", (env) => env.view.work(env.cx), { props: MODES.new, script: { "worktree add": () => { throw new Error("crash"); } } }, { text: "feat" });
  await flow("go-busy", (env) => env.view.go(env.cx), undefined, { busy: true });
  await flow("go-new", (env) => env.view.go(env.cx), undefined, { text: "feat" });
  await flow("go-remove", (env) => env.view.go(env.cx), { props: MODES.remove });
  await flow("go-switch", (env) => env.view.go(env.cx), { props: MODES.switch }, { at: 1 });
  await flow("go-switch-none", (env) => env.view.go(env.cx), { props: MODES.switch }, { text: "zzz" });
  await flow("go-open", (env) => env.view.go(env.cx), { props: MODES.open }, { at: 1 });
  for (const [name, row] of Object.entries({ none: undefined, current: { branch: "main", current: true }, held: { branch: "feat", held: "/wt/feat" }, free: { branch: "other", current: false, held: null }, nodate: { branch: "nodate" } })) {
    await flow(`switchTo-${name}`, (env) => env.view.switchTo(row, env.cx), { props: MODES.switch });
  }
  await flow("switchTo-busy", (env) => env.view.switchTo({ branch: "other" }, env.cx), { props: MODES.switch }, { busy: true });
  await flow("switchTo-dirty", (env) => env.view.switchTo({ branch: "other" }, env.cx), { props: MODES.switch, script: { "status --porcelain": { code: 0, stdout: " M a" } } });
  await flow("switchTo-agent", (env) => env.view.switchTo({ branch: "other" }, env.cx), { props: MODES.switch, agents: [{ tab: "t1", status: "working" }] });
  await flow("switchTo-fail", (env) => env.view.switchTo({ branch: "other" }, env.cx), { props: MODES.switch, script: { "switch other": { code: 1, stdout: "", stderr: "would overwrite" } } });
  await flow("switchTo-fail-silent", (env) => env.view.switchTo({ branch: "other" }, env.cx), { props: MODES.switch, script: { "switch other": { code: 1, stdout: "", stderr: "" } } });
  for (const [name, agents] of Object.entries({ none: [], working: [{ tab: "t1", status: "working" }], blocked: [{ tab: "t1", status: "blocked" }], idle: [{ tab: "t1", status: "idle" }], elsewhere: [{ tab: "t7", status: "working" }] })) {
    await flow(`blocker-${name}`, (env) => env.view.blockerNow(), { props: MODES.switch, agents });
  }
  await flow("blocker-dirty-one", (env) => env.view.blockerNow(), { props: MODES.switch, script: { "status --porcelain": { code: 0, stdout: " M a\n" } } });
  await flow("blocker-unknown", (env) => env.view.blockerNow(), { props: MODES.switch, script: { "status --porcelain": { code: 128, stdout: "" } } });
  await flow("loadBranches-detached", (env) => env.view.loadBranches({ main: "/repo" }), { props: MODES.switch, script: { "symbolic-ref": { code: 1, stdout: "" } } });
  await flow("loadBranches-no-refs", (env) => env.view.loadBranches({ main: "/repo" }), { props: MODES.switch, script: { "for-each-ref": { code: 0, stdout: "" } } });
  await flow("loadBranches-refs-fail", (env) => env.view.loadBranches({ main: "/repo" }), { props: MODES.switch, script: { "for-each-ref": { code: 1, stdout: "x" } } });
  await flow("open-worktree-open", (env) => env.view.open({ path: "/wt/feat" }), { props: MODES.open });
  await flow("open-worktree-new", (env) => env.view.open({ path: "/wt/other" }), { props: MODES.open });
  await flow("open-worktree-none", (env) => env.view.open(undefined), { props: MODES.open });
  await flow("open-worktree-remote", (env) => env.view.open({ path: "/wt/other" }), { props: { action: "open", folder: "/r", machine: "host" } });
  await flow("remove", (env) => env.view.remove(), { props: MODES.remove });
  await flow("close", (env) => env.view.close());
  await flow("space-folder", (env) => plain(env.view.space()), { props: { action: "new", folder: "/solo", machine: "m1" } });
  await flow("space-folder-nomachine", (env) => plain(env.view.space()), { props: { action: "new", folder: "/solo" } });
  await flow("space-none", (env) => plain(env.view.space()), { props: { action: "new" } });
  await flow("identity", (env) => ({ a: env.view.identity(), initial: env.view.initialIdentity }), { props: { action: "new", space: "s1", machine: "m2" } });
  await flow("identity-nospace", (env) => ({ a: env.view.identity() }), { props: { action: "new", space: "missing" } });
  await flow("visible-modes", (env) => ({ new: env.view.visible() }), { props: MODES.new });
  await flow("key-escape", (env) => env.view.key({ key: "escape" }, env.cx), { props: MODES.open });
  await flow("key-nav-empty", (env) => env.view.key({ key: "down" }, env.cx), { props: MODES.open }, { text: "zzz" });
  await flow("key-up-wrap", (env) => { env.view.key({ key: "up" }, env.cx); return env.view.at; }, { props: MODES.open });
  await flow("key-down-wrap", (env) => { for (let i = 0; i < 4; i++) env.view.key({ key: "down" }, env.cx); return env.view.at; }, { props: MODES.open });
  await flow("key-enter-remove", (env) => env.view.key({ key: "enter" }, env.cx), { props: MODES.remove });
  await flow("key-enter-new", (env) => env.view.key({ key: "enter" }, env.cx), { props: MODES.new }, { text: "feat" });
  await flow("key-other-new", (env) => env.view.key({ key: "x" }, env.cx), { props: MODES.new });

  // init: remote home lookup, props.branch auto-run, failures.
  const remoteProps = { action: "new", folder: "/r", machine: "host" };
  for (const shell of ["ok", "throw", "empty", "powershell-fail"]) {
    const env = await opened({ props: remoteProps, shell });
    out.flows[`init-remote-${shell}`] = { view: view(env.view), tree: plain(env.view.render(env.cx).__rec) };
  }
  for (const [name, props] of Object.entries({ branch: { ...MODES.new, branch: "auto" }, openBranch: { ...MODES.open, branch: "x" }, removeBranch: MODES.removeBranch })) {
    const env = setup({ props }); env.view.init(null, env.cx); await settle();
    out.flows[`init-${name}`] = { view: view(env.view), exec: plain(env.log.exec), runs: plain(env.log.runs), closed: plain(env.log.closed), focus: env.log.focus, timers: env.log.timers, notifies: env.notifies, input: plain(env.state.inputs.last.opts) };
  }
  { const env = setup({ props: MODES.new, script: { "--git-common-dir": () => { throw new Error("git gone"); } } }); env.view.init(null, env.cx); await settle(); out.flows["init-throws"] = { view: view(env.view), tree: plain(env.view.render(env.cx).__rec) }; }
  { const env = setup({ props: MODES.new, script: { "--git-common-dir": { code: 0, stdout: "/other/place\n" } } }); env.view.init(null, env.cx); await settle(); out.flows["init-no-dot-git"] = { view: view(env.view) }; }
  { const env = setup({ props: MODES.open, script: { "worktree list": { code: 1, stdout: "" } } }); env.view.init(null, env.cx); await settle(); out.flows["init-open-list-fails"] = { view: view(env.view) }; }
  { const env = setup({ props: {} }); env.view.init(null, env.cx); await settle(); out.flows["init-no-props"] = { view: view(env.view) }; }

  if (process.env.GOLDEN_FULL) writeFileSync(process.env.GOLDEN_FULL, JSON.stringify(out, null, 1));
  const digest = {};
  for (const [group, entries] of Object.entries(out)) for (const [name, value] of Object.entries(entries)) digest[`${group}/${name}`] = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  if (!existsSync(GOLDEN)) writeFileSync(GOLDEN, JSON.stringify(digest, null, 1) + "\n");
  assert.deepStrictEqual(digest, JSON.parse(readFileSync(GOLDEN, "utf8")));
});
