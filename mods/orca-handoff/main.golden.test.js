// Characterization (golden-master) test for main.js: the dialog is opened as handoff and as fork, rendered, and
// every click, key and hover handler is called; what each did (commands, copies, overlay closes, state) is
// recorded as a SHA-256 per scenario in main.golden.json, once from the code as it was before the refactor. Set
// GOLDEN_FULL=<file> to dump the full record for a diff; delete main.golden.json to re-record after an intended
// behavior change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildAgentSessionForkPrompt, buildAgentSessionContinuationPrompt } from "./transcript.js";

const GOLDEN = new URL("./main.golden.json", import.meta.url);
const MAIN = new URL("./main.js", import.meta.url);
// Imports (also the multi-line one) and `export default` are blanked, not removed, so offsets and coverage hold.
const SOURCE = readFileSync(MAIN, "utf8")
  .replace(/^import\s[^;]*;$/gm, (text) => text.replace(/[^\n]/g, " ")).replace("export default class HandoffDialog", `${" ".repeat(15)}class HandoffDialog`);
const SCRIPT = new vm.Script(`${SOURCE}\nglobalThis.HandoffDialog = HandoffDialog;`, { filename: fileURLToPath(MAIN) });

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
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve)); };

const TRANSCRIPT = "\u001b[31mhello\u001b[0m\nworld ".repeat(3);
const DEFAULT_INVENTORY = [
  ["claude", "Claude Code", "claude"], ["opencode", "OpenCode", "opencode"], ["codex", "Codex", "codex"], ["pi", "Pi", "pi"],
  ["gemini", "Gemini", "gemini"], ["agy", "Antigravity", "agy"], ["cursor", "Cursor Agent", "cursor-agent"], ["aider", "Aider", "aider"]
].map(([key, name, cmd]) => ({ key, name, run: [cmd], installed: true }));
function setup({ props = {}, panes, agents, hcResult, git = {}, spaces = [{ active: true, id: "s" }], inventory = DEFAULT_INVENTORY } = {}) {
  const log = { exec: [], runs: [], closed: [], copies: [], timers: [], hc: [] };
  const state = { props: { overlay: "ov", action: "handoff", terminal: "term1", pane: "p1", ...props } };
  const scope = {
    View: class {}, div: factory("div"), svg: factory("svg"), v_flex: factory("v_flex"), h_flex: factory("h_flex"),
    run: (name, args) => log.runs.push([name, cleanse(args)]), props: () => state.props, closeOverlay: (id) => log.closed.push(id), theme: () => theme,
    panes: () => panes ?? [{ pane: "p1", terminal: "term1", cwd: "/repo", title: "My Terminal" }], spaces: () => spaces,
    agents: () => agents ?? [{ address: "term1", app: "Codex" }],
    knownAgents: async (opts) => { log.inventory = opts; if (inventory === "reject") throw Error("offline"); return inventory; },
    hc: async (args) => { log.hc.push(args); if (hcResult === "reject") throw new Error("hc gone"); return hcResult ?? { code: 0, stdout: TRANSCRIPT }; },
    exec: async (cmd, args, opts) => {
      log.exec.push([cmd, args, opts]);
      const answer = git[args[0]];
      if (typeof answer === "function") return answer();
      if (answer) return answer;
      return args[0] === "rev-parse" ? { code: 0, stdout: `${opts.cwd}\n` } : { code: 0, stdout: "topic\n" };
    },
    copyText: async (text) => { log.copies.push(text); },
    buildAgentSessionForkPrompt, buildAgentSessionContinuationPrompt,
  };
  SCRIPT.runInNewContext(scope);
  let notifies = 0;
  const cx = { notify() { notifies++; }, spawn(fn) { fn(cx); }, focus_handle: () => ({ focus() { log.exec.push(["focus"]); } }), timer: { after(ms, fn) { log.timers.push(ms); fn(); } } };
  return { view: new scope.HandoffDialog(), cx, log, state, get notifies() { return notifies; } };
}

async function opened(options, patch = {}) {
  const env = setup(options);
  env.view.init(null, env.cx);
  await settle();
  Object.assign(env.view, structuredClone(patch));
  for (const key of ["exec", "runs", "closed", "copies", "timers"]) env.log[key].length = 0;
  env.n0 = env.notifies;
  return env;
}
const fields = ["action", "terminal", "paneId", "cwd", "paneTitle", "sourceAgent", "selectedAgentIndex", "loading", "capturedText", "copied", "busy", "statusMessage"];
const view = (v) => plain(Object.fromEntries(fields.map((k) => [k, v[k] ?? null])));

function handlers(rec, path = [], out = []) {
  for (const [name, fns] of Object.entries(rec.fns)) fns.forEach((fn) => out.push({ name, fn, path: path.join("/") }));
  rec.kids.forEach((kid, i) => handlers(kid, [...path, `${kid.n}${i}`], out));
  return out;
}
const KEYS = [{ key: "escape" }, { key: "enter" }, { key: "x" }];

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
      out[`${label}#${i}:${h.path}:${h.name}:${k}`] = { view: view(env.view), exec: plain(env.log.exec), runs: plain(env.log.runs), closed: plain(env.log.closed), copies: env.log.copies, timers: env.log.timers, notifies: env.notifies - env.n0, after: plain(env.view.render(env.cx).__rec) };
    }
  }
  return out;
}

test("handoff dialog behaves as recorded: renders, handlers and flows", async () => {
  const out = { renders: {}, handlers: {}, flows: {} };
  const states = {
    handoff: {}, fork: { props: { action: "fork" } }, forkNoTerminal: { props: { action: "fork", terminal: "", pane: "" }, panes: [], agents: [] },
    unknownAction: { props: { action: "weird" } }, noPane: { panes: [] }, byPane: { props: { terminal: "", pane: "p1" }, agents: [{ pane: "p1", program: { name: "Claude" } }] },
    sameAgent: { agents: [{ address: "term1", app: "Claude Code" }] }, claudeLower: { agents: [{ address: "term1", app: "claude" }] }, hcFails: { hcResult: "reject" }, hcNonZero: { hcResult: { code: 1, stdout: "x" } },
    hcEmpty: { hcResult: { code: 0, stdout: "" } }, noAgent: { agents: [] }, noProps: { props: { terminal: undefined, pane: undefined } },
  };
  for (const [name, options] of Object.entries(states)) {
    const env = await opened(options);
    out.renders[name] = { view: view(env.view), tree: plain(env.view.render(env.cx).__rec), hc: env.log.hc, cont: env.view.getContinuationPrompt(), fork: env.view.getForkPrompt() };
    out.handlers[name] = await explore(name, options, {});
  }
  for (const [name, patch] of Object.entries({ loading: { loading: true }, busy: { busy: true }, copied: { copied: true, statusMessage: "Prompt copied to clipboard" }, status: { statusMessage: "hello" }, picked: { selectedAgentIndex: 3 }, noCwd: { cwd: "", paneTitle: "" } })) {
    for (const mode of ["handoff", "fork"]) {
      const options = states[mode];
      const env = await opened(options, patch);
      out.renders[`${mode}-${name}`] = plain(env.view.render(env.cx).__rec);
      out.handlers[`${mode}-${name}`] = await explore(`${mode}-${name}`, options, patch);
    }
  }

  const flow = async (name, fn, options, patch) => {
    const env = await opened(options, patch);
    let thrown = null, returned;
    try { returned = await fn(env); await settle(); } catch (e) { thrown = String(e); }
    out.flows[name] = { thrown, returned: plain(returned), view: view(env.view), exec: plain(env.log.exec), runs: plain(env.log.runs), closed: plain(env.log.closed), copies: env.log.copies, timers: env.log.timers, notifies: env.notifies - env.n0 };
  };
  await flow("copy-handoff", (env) => env.view.copyCurrentPrompt(env.cx));
  await flow("copy-fork", (env) => env.view.copyCurrentPrompt(env.cx), { props: { action: "fork" } });
  await flow("copy-empty", (env) => env.view.copyCurrentPrompt(env.cx), undefined, { sourceAgent: "x", capturedText: "" });
  await flow("handoff-run", (env) => env.view.executeHandoff(env.cx));
  await flow("handoff-run-index", (env) => env.view.executeHandoff(env.cx), undefined, { selectedAgentIndex: 7 });
  await flow("handoff-run-out-of-range", (env) => env.view.executeHandoff(env.cx), undefined, { selectedAgentIndex: 99 });
  await flow("handoff-busy", (env) => env.view.executeHandoff(env.cx), undefined, { busy: true });
  await flow("handoff-no-cwd", (env) => env.view.executeHandoff(env.cx), { panes: [] });
  await flow("handoff-twice", async (env) => { await env.view.executeHandoff(env.cx); await env.view.executeHandoff(env.cx); });
  const forks = {
    branch: {}, emptyBranch: { git: { branch: { code: 0, stdout: "\n" } } }, branchFails: { git: { branch: { code: 1, stdout: "" } } }, branchThrows: { git: { branch: () => { throw new Error("x"); } } },
    notRepo: { git: { "rev-parse": { code: 128, stdout: "" } } }, revParseThrows: { git: { "rev-parse": () => { throw new Error("x"); } } }, noCwd: { panes: [] },
  };
  for (const [name, options] of Object.entries(forks)) await flow(`fork-${name}`, (env) => env.view.executeFork(env.cx), { props: { action: "fork" }, ...options });
  await flow("fork-busy", (env) => env.view.executeFork(env.cx), { props: { action: "fork" } }, { busy: true });
  await flow("fork-twice", async (env) => { await env.view.executeFork(env.cx); await env.view.executeFork(env.cx); }, { props: { action: "fork" } });
  await flow("fork-empty-prompt", (env) => env.view.executeFork(env.cx), { props: { action: "fork" } }, { capturedText: "" });
  await flow("init-spawn-timing", async (env) => { env.view.init(null, env.cx); return view(env.view); }, { hcResult: { code: 0, stdout: "later" } });

  if (process.env.GOLDEN_FULL) writeFileSync(process.env.GOLDEN_FULL, JSON.stringify(out, null, 1));
  const digest = {};
  for (const [group, entries] of Object.entries(out)) for (const [name, value] of Object.entries(entries)) digest[`${group}/${name}`] = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  if (!existsSync(GOLDEN)) writeFileSync(GOLDEN, JSON.stringify(digest, null, 1) + "\n");
  assert.deepStrictEqual(digest, JSON.parse(readFileSync(GOLDEN, "utf8")));
});

test("handoff uses Herdr's installed catalog and configured argv, not hardcoded commands", async () => {
  const env = await opened({
    panes: [{ pane: "p1", tab: "t", terminal: "term1", cwd: "/repo" }],
    spaces: [{ id: "s", machine: "remote", tabs: [{ id: "t" }] }],
    inventory: [
      { key: "custom", name: "Custom Agent", run: ["custom", "--flag"], installed: true },
      { key: "claude", name: "Claude", run: ["claude"], installed: false }
    ]
  });
  assert.deepEqual(plain(env.log.inventory), { on: "remote" });
  const tree = JSON.stringify(env.view.render(env.cx).__rec);
  assert.match(tree, /agent-opt-custom/);
  assert.doesNotMatch(tree, /agent-opt-claude/);
  await env.view.executeHandoff(env.cx);
  assert.deepEqual(plain(env.log.runs[0][1].argv), ["custom", "--flag"]);
  const empty = await opened({ inventory: [] });
  await empty.view.executeHandoff(empty.cx);
  assert.deepEqual(empty.log.runs, []);
  assert.match(empty.view.statusMessage, /No installed/);
  const failed = await opened({ inventory: "reject" });
  assert.match(failed.view.statusMessage, /discovery unavailable/);
  assert.match(JSON.stringify(failed.view.render(failed.cx).__rec), /agent-opt-claude/);
});
