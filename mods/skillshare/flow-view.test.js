import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildItems } from "./model.js";
Date.now = () => 1700000000000; // age text and expiry must not depend on the clock

// Every click handler of the panel and dialogs, then the work it starts (see view-test.js for the host). Named *-test.js: see model-test.js.
const { host: createHost } = await import("./view-test-host.js");
function host(t, props) {
  const h = createHost(t, props);
  h.tasks.length = 0; // the init loops (focus commands) never end
  return h;
}

const digest = (trees) => createHash("sha256").update(JSON.stringify(trees)).digest("hex");
const GOLDEN = {
  "panel-clicks": "a9e6381b26763f469340e70c66d15f67886fd38b56f8f30c6df11e17a97c1e10",
  "dialog-clicks": "129451f54d81c9966e986bac805b50d931668ffb02672d6f7f6bb47a40f51adc",
  "install-flow": "13c9cf0f5fb58e967c2d4f7fe49d574e47b7f92855a8048afe661c362a99bbcc",
  "panel-work": "0bda648f035726054a7d168c870157ace67baf81c30388ebf57cdf01ac114395",
};
function check(name, trees) {
  const actual = digest(trees);
  if (process.env.PRINT_GOLDEN) console.log(`GOLDEN ${name} ${actual}`);
  else assert.equal(actual, GOLDEN[name], name);
}
const rich = (scope) => ({
  list: [{ name: "s1", kind: "skill", source: "https://github.com/o/r.git" }, { name: "s2", kind: "skill", repoName: "tr1" }, { name: "s3", kind: "skill", disabled: true }, { name: "ag.md", kind: "agent", relPath: "ag.md" }, { name: "s4" }, { name: "s6", source: "https://github.com/o/r.git" }],
  check: { skills: [{ name: "s1", status: "update_available", version: "1" }], tracked_repos: [{ name: "tr1", status: "behind", behind: 3 }] }, checkAgents: [{ name: "ag", status: "update_available" }],
  diff: { targets: [{ name: "claude", items: [{ name: "s4", is_sync: true, action: "add" }, { name: "ag", kind: "agent", is_sync: true, action: "modify" }] }, { name: "codex", items: [] }] },
  mcp: { changes: [{ name: "m1", target: "claude", action: "add" }] }, plugins: { packages: { p1: { bindings: { claude: { pending: true } } } } },
  hooks: { source: { entries: { fmt: { description: "d", bindings: { claude: {} } } } }, plan: { changes: [{ name: "fmt", target: "claude", action: "add" }, { target: "claude", action: "conflict" }] } },
  root: "/repo", targetPaths: [{ name: "claude", path: "/repo/.claude/skills" }], extras: [{ name: "rules", source_dir: "/s", targets: [{ path: "/repo/.claude/r", status: "drift" }] }],
  memory: null, targets: ["claude"], skillTargets: ["claude"], agentTargets: ["claude"], pending: [], errors: {}, scope,
});
const GITS = { repo: true, top: "/r", upstream: "o/m", files: [{ code: "M", path: "a" }], ahead: 1, behind: 2 };
const FAR = 1e15;

// A machine for exec: every skillshare command is answered by its first word.
const ANSWERS = { status: '{"version":"1","source":{"path":"/src"},"targets":[{"name":"claude","path":"/repo/.claude/skills"}]}', list: JSON.stringify(rich("p").list), diff: JSON.stringify(rich("p").diff), doctor: '{"version":{"current":"1","latest":"2","update_available":true}}',
  install: '{"skills":["one"]}', check: "{}", mcp: "{}", plugin: "{}", hooks: "{}", extras: "[]" };
function jobOutput(h, sub, text, script) {
  let out = ANSWERS[sub] ?? "{}";
  if (text.includes("git clone") || script.includes("git clone")) out = h.found ?? '@dir /clone\n{"planned":[{"name":"one","path":"."},{"name":"two","path":"two"}]}';
  else if (text.includes("audit") || script.includes("skillshare audit")) out = h.audit ?? '@@ .\n{"results":[{"isBlocked":true,"findings":[{"severity":"HIGH","pattern":"p","file":"/clone/r/f","line":1,"snippet":"s"}]}]}';
  return out;
}
function install(h, files, jobs) {
  globalThis.__herdrFiles = files;
  globalThis.__herdrMachines = () => [{ name: "desk", layout: "ok" }, { name: "away", layout: "unavailable" }];
  globalThis.__herdrExec = async (cmd, args) => {
    const script = args[1], words = args.slice(3);
    if (cmd !== "sh") return { code: 0, stdout: "", stderr: "" };
    if (script.includes('for d in "$@"')) return { code: 0, stdout: "/repo", stderr: "" };
    const sub = words.find((w) => ANSWERS[w] !== undefined) ?? "";
    const text = words.join(" ");
    if (script.includes("mktemp") && script.includes("/code")) {
      const dir = `/job-${jobs.length}`;
      const out = jobOutput(h, sub, text, script);
      jobs.push(words); files.set(`${dir}/code`, "0"); files.set(`${dir}/out`, out);
      return { code: 0, stdout: dir, stderr: "" };
    }
    return { code: 0, stdout: ANSWERS[sub] ?? "", stderr: "" };
  };
}
async function drain(h, limit = 60) {
  const errors = [];
  for (let n = 0; n < limit && h.tasks.length; n++) { try { await h.tasks.shift()(h.cx); } catch (e) { errors.push(String(e.message)); } }
  return errors;
}
const clean = (value) => JSON.parse(JSON.stringify(value ?? null, (k, v) => {
  if (k === "id" && typeof v === "string" && /^\d+-/.test(v)) return "ID";
  return v instanceof Set ? [...v] : v;
}));
const report = (h, errors) => clean({ errors, shared: [...h.shared], calls: h.calls, view: ["view", "scope", "kind", "query", "step", "error", "stopped", "checkedAt", "machinesAt", "pending", "prog", "discovering", "closed", "gone", "failed", "sending", "choices", "found", "picked", "dir", "source", "pane", "file", "doc"].map((k) => [k, h.view[k]]) });

// Clicks every handler of one rendered state on a fresh host, then lets the work it starts finish.
async function clickAll(t, make, label) {
  const first = make(t); first.render();
  const ids = [...first.listeners.keys()].filter((k) => k.endsWith("/on_click/")).sort();
  const out = [];
  for (const id of ids) {
    const h = make(t);
    h.render();
    let error = null;
    try { h.listeners.get(id)({}, h.cx); } catch (e) { error = String(e.message); }
    const errors = [error, ...(await drain(h))];
    out.push([label, id, report(h, errors), h.render()]);
  }
  assert.ok(ids.length > 0, label);
  return out;
}

const panel = (extra) => (t) => {
  const h = host(t);
  install(h, new Map(), []);
  Object.assign(h.view, { project: "/repo", projectKnown: true, loadedAt: 1, raw: { project: rich("project"), global: rich("global") }, git: GITS, machines: { "": { here: true, label: "this computer", version: "1", update: true, latest: "2", git: GITS, drift: 1, pending: [{ name: "a", n: 1 }] }, desk: { on: "desk", label: "desk", version: "1", targets: 1, git: { ...GITS, files: [], ahead: 0 } } }, machinesAt: 1, ...extra });
  h.view.ctx = h.view.context(); h.view.rebuild();
  h.shared.set("skillshare.inSyncView.v1", "source");
  return h;
};

test("panel clicks", async (t) => {
  const out = [];
  for (const view of ["overview", "library", "machines"]) {
    for (const [scope, kind] of [["all", "skills"], ["project", "agents"], ["global", "hooks"], ["all", "mcp"], ["all", "extras"]]) out.push(...await clickAll(t, panel({ view, scope, kind, expanded: new Set(["source:o/r"]) }), `${view}/${scope}/${kind}`));
  }
  out.push(...await clickAll(t, panel({ view: "overview", stopped: { files: ["a"], previews: {}, repo: "/r", on: null }, latest: "v9.9.9" }), "stopped"));
  check("panel-clicks", out);
});

const dialog = (props, extra = {}) => (t) => {
  const h = host(t, { role: "text" });
  install(h, new Map(), []);
  h.state.props = props; h.state.agents = [{ address: "a1", status: "idle", space_name: "sp", tab_name: "tb", program: { name: "Codex" } }];
  globalThis.host.hc = async (args) => (extra.hcFails ? { code: 1, stderr: "no send\nreason" } : { code: 0, args });
  h.view.msg = { value: () => " note " }; h.view.choices = extra.choices ?? {}; h.view.doc = extra.doc ?? null; h.view.pane = "main"; h.view.file = extra.file ?? null;
  h.view.ctx = h.view.context();
  return h;
};
test("dialog clicks", async (t) => {
  const out = [];
  const it = { name: "s", label: "S", scope: "global", kind: "skills", key: "k", path: "s", rel: "s", state: "update", update: "s", behind: 1, disabled: false };
  const items = [...buildItems("project", rich("project")), ...buildItems("global", rich("global"))];
  const seen = new Set();
  for (const i of items) {
    const sig = `${i.kind}/${i.state}/${i.notice}/${i.extra}/${i.declared}`;
    if (seen.has(sig)) continue; seen.add(sig);
    out.push(...await clickAll(t, dialog({ role: "preview", item: i, on: null, project: "/repo", busy: false, agent: { address: "a1", name: "Codex" }, targets: [{ name: "claude", text: "x", warn: true }] },
      { doc: { files: ["a.md", "b.md"], dir: "/d", body: "x", meta: [] }, file: "a.md" }), `preview/${sig}`));
  }
  out.push(...await clickAll(t, dialog({ role: "preview", item: { ...it, state: "sync" }, on: "desk", project: "/repo", busy: true }, { doc: { error: "bad" } }), "preview/error"));
  for (const props of [
    { role: "source", on: "desk", git: GITS }, { role: "source", on: null, git: { ...GITS, files: [], behind: 0 } }, { role: "source", git: { ...GITS, files: [], ahead: 0 } }, { role: "source", git: { repo: false } },
    { role: "syncboth", repo: "/r", label: "desk" }, { role: "upgrade", on: "desk", label: "desk", from: "1", to: "2" }, { role: "panelupdate", from: "1", to: "v2" }, { role: "text", text: "t" },
    { role: "hook", item: { ...it, kind: "hooks" }, action: "remove" }, { role: "able", item: it, action: "disable" }, { role: "uninstall", item: it },
    { role: "audit", address: "a1", name: "Codex", item: it, text: "m" }, { role: "audit", address: "zz", name: "G", item: it, text: "m" },
    { role: "conflict", on: null, repo: "/r", push: true, files: ["a", "b"], previews: {} },
  ]) out.push(...await clickAll(t, dialog(props), props.role));
  out.push(...await clickAll(t, dialog({ role: "audit", address: "a1", name: "Codex", item: it, text: "m" }, { hcFails: true }), "audit/fails"));
  out.push(...await clickAll(t, dialog({ role: "conflict", on: null, repo: "/r", push: false, files: ["a", "b"], previews: {} }, { choices: { a: "local", b: "remote" } }), "conflict/chosen"));
  check("dialog-clicks", out);
});

test("install dialog from URL to the end", async (t) => {
  const out = [], stepsOf = async (label, setup, run) => {
    const h = host(t, { role: "install", on: null, project: "/repo", scope: "project", existing: { project: ["one"], global: [] }, agent: { address: "a1", name: "Codex" } });
    h.state.agents = [{ address: "a1", status: "idle", program: { name: "Codex" } }];
    install(h, new Map(), []);
    h.view.ctx = h.view.context();
    setup(h);
    const log = [];
    for (const step of run) { let error = null; try { step(h); } catch (e) { error = String(e.message); } log.push([error, ...(await drain(h)), JSON.stringify(report(h, [])), h.render()]); }
    out.push([label, log]);
  };
  const type = (value) => (h) => { h.view.url = { value: () => value, set_value() {}, on() {} }; h.view.installNext(h.cx); };
  const click = (id) => (h) => h.listeners.get(`${id}/on_click/`)({}, h.cx);
  await stepsOf("bad url", () => {}, [type("???"), type(""), type("  ")]);
  await stepsOf("pick two", () => {}, [type("owner/repo"), click("pick-all"), click("go"), click("replace")]);
  await stepsOf("pick then back", () => {}, [type("owner/repo"), click("back"), type("owner/repo"), click("pick-."), click("go")]);
  await stepsOf("single blocked then anyway", (h) => { h.found = '@dir /clone\n{"planned":[{"name":"one","path":"."}]}'; }, [type("owner/repo"), click("anyway"), click("show")]);
  await stepsOf("single clean", (h) => { h.found = '@dir /clone\n{"planned":[{"name":"new","path":"n"}]}'; h.audit = '@@ n\n{"results":[]}'; }, [type("github.com/o/r"), click("another")]);
  await stepsOf("none found", (h) => { h.found = '@dir /clone\n{"planned":[]}'; }, [type("o/r")]);
  await stepsOf("cancel replace", () => {}, [type("owner/repo"), click("pick-all"), click("go"), click("keep")]);
  await stepsOf("closed while discovering", () => {}, [(h) => { h.view.closed = true; type("o/r")(h); }]);
  check("install-flow", out);
});

test("panel work: requests, machines and reads", async (t) => {
  const out = [];
  const scenario = async (label, setup, steps) => {
    const h = panel({ view: "library" })(t);
    setup?.(h);
    const log = [];
    for (const step of steps) { let error = null; try { step(h); } catch (e) { error = String(e.message); } log.push([error, ...(await drain(h)), JSON.stringify(report(h, [])), h.render()]); }
    out.push([label, log, h.shared.get("skillshare.request.v1") ? "req" : "none"]);
  };
  const perform = (req) => (h) => h.view.perform(req, h.cx);
  const item = { key: "project:skills:s3", kind: "skills", scope: "project", label: "s3", path: "s3", disabled: true };
  for (const req of [{ op: "show", name: "s1", scope: "global" }, { op: "sync", on: null, project: "/repo", scopes: ["global"] }, { op: "update", on: null, project: "/repo", updates: [{ kind: "skills", scope: "global", all: true }] },
    { op: "toggle", on: null, project: "/repo", item, action: "enable" }, { op: "uninstall", on: null, project: "/repo", item }, { op: "refresh", on: null, project: "/repo", added: [{ name: "n", scope: "global", source: "x" }] },
    { op: "panel", on: "*", from: "1", to: "v2" }, { op: "text", on: null, args: ["doctor"], busy: "b", title: "T" }, { op: "syncboth", on: null, repo: "/r" }, { op: "pull", on: "desk", repo: "/r" }, { op: "unknown", on: null }]) {
    await scenario(req.op, null, [perform(req)]);
    await scenario(`${req.op}/busy`, (h) => h.shared.set("skillshare.busy.v1", { "": { text: "Working…", at: FAR }, "*": { text: "all", at: FAR } }), [perform(req)]);
  }
  await scenario("machines", null, [(h) => h.view.loadMachines(h.cx), (h) => h.view.loadMachines(h.cx)]);
  await scenario("machines throw", (h) => { const exec = globalThis.__herdrExec; globalThis.__herdrExec = async (...a) => { if (a[2]?.on === "desk") throw new Error("down"); return exec(...a); }; }, [(h) => h.view.loadMachines(h.cx)]);
  await scenario("refresh", (h) => { h.view.loading = false; }, [(h) => h.view.refresh(h.cx, true), (h) => h.view.refresh(h.cx, false), (h) => h.view.checkRelease(h.cx)]);
  await scenario("refresh fails", (h) => { globalThis.__herdrExec = async () => { throw new Error("exec down"); }; }, [(h) => h.view.refresh(h.cx, true), (h) => { h.view.token++; h.view.refresh(h.cx, true); h.view.token++; }]);
  await scenario("refresh ended", (h) => { h.view.pending = [{ op: "update", ended: true, on: null, updates: [] }]; }, [(h) => h.view.refresh(h.cx, true)]);
  await scenario("openers", null, [(h) => h.view.openConflict(), (h) => { h.view.stopped = { files: ["a"], previews: {}, repo: "/r" }; h.view.openConflict(); }, (h) => h.view.syncBoth(), (h) => h.view.openInstall(h.view.ctx),
    (h) => h.view.updateAll(h.view.items, h.view.ctx), (h) => h.view.openPreview(item, h.view.ctx), (h) => h.view.openPreview(null, h.view.ctx), (h) => h.view.openAudit(item, { address: "a", program: { name: "n" } })]);
  check("panel-work", out);
});
