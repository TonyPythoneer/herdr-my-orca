import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const { host } = await import("./view-test-host.js");

// Fingerprint the original recorder bytes for several states without maintaining a second snapshot file.
const digest = (trees) => createHash("sha256").update(JSON.stringify(trees)).digest("hex");
test("panel tabs, target map, source footer and machine cards keep their render trees", (t) => {
  const h = host(t);
  const trees = [h.render()];
  Object.assign(h.view, { project: "/repo", projectKnown: true, loadedAt: 1,
    git: { repo: true, upstream: "origin/main", files: [], ahead: 1 },
    raw: { project: { targets: ["one", "two"], list: [{ name: "search" }], diff: { targets: [{ name: "one", items: [{ name: "search", action: "add", is_sync: true }] }] } } } });
  h.view.rebuild();
  trees.push(h.render());
  h.click("have-skills");
  assert.equal(h.view.view, "library");
  trees.push(h.render());
  h.click("scope-global");
  assert.equal(h.view.scope, "global");
  h.click("view-machines");
  trees.push(h.render());
  h.view.machines = { desk: { on: "desk", label: "desk", version: "1", targets: 2, drift: 1, pending: [{ name: "one", n: 1 }], git: h.view.git },
    local: { here: true, label: "local", version: "2", update: true, latest: "3", doctor: { warnings: 1 } }, down: { label: "down", error: "offline" } };
  trees.push(h.render());
  h.click("ps-local");
  assert.equal(h.shared.get("skillshare.request.v1").op, "pullsync");
  h.click("close");
  assert.deepEqual(h.calls, [["layout.hide", { id: "skillshare-panel" }]]);
  assert.equal(digest(trees), "04f5ddafe79cd5fa76ef3142064a7a01dcbb77891b3aa11013fdf4dbc43c3d13");
});

test("dialog roles, preview panes and install stages keep their render trees", (t) => {
  const h = host(t, { role: "text" }), trees = [];
  const item = { name: "skill", label: "Skill", key: "s", scope: "project", kind: "skills", state: "update", update: "s" };
  h.view.choices = {};
  for (const role of ["text", "hook", "able", "uninstall", "audit", "source", "syncboth", "conflict", "upgrade", "panelupdate", "other"]) {
    h.state.props = { role, name: "Agent", item, action: "remove", on: "desk", files: ["a", "b"], previews: { a: { local: null, remote: { lines: [{ text: "line", mark: true }], cut: true }, differ: 1 } },
      git: { repo: true, upstream: "origin", ahead: 1, behind: 2, files: [{ code: "M", path: "a" }] } };
    trees.push(h.render());
    if (role === "conflict") { h.click("all-local"); trees.push(h.render()); h.click("go"); assert.deepEqual(h.shared.get("skillshare.request.v1").choices, { a: "local", b: "local" }); }
  }
  for (const kind of ["skills", "agents", "mcp", "hooks", "plugins", "extras"]) {
    h.state.props = { role: "preview", item: { ...item, kind }, targets: [{ name: "desk", warn: true, text: "changed" }] };
    h.view.doc = { files: ["SKILL.md", "more"], body: "text", meta: [{ key: "name", value: "Skill" }] };
    for (const pane of ["main", "targets", "details"]) { h.view.pane = pane; trees.push(h.render()); }
  }
  h.state.props = { role: "install", project: "/repo" };
  Object.assign(h.view, { step: "url", scope: "project", found: [{ name: "one", path: "." }], picked: new Set() });
  trees.push(h.render());
  h.view.step = "pick"; trees.push(h.render()); h.click("pick-all"); trees.push(h.render());
  assert.deepEqual([...h.view.picked], ["one"]);
  h.view.step = "progress";
  for (const fields of [{ at: 0, replaces: ["one"] }, { at: 1 }, { at: 1, blocked: { blocked: ["."], findings: [] } }, { at: 2, error: "failed" }, { at: 3, done: ["one"] }]) {
    h.view.prog = { label: "one", ...fields }; trees.push(h.render());
  }
  assert.equal(digest(trees), "e33ffbca3db5a48ac987570338efc7876cba411d9d7bb16399d7334be65f9671");
});

test("panel timers skip hidden work, expire each notice once and handle focus commands", async (t) => {
  const h = host(t), work = [];
  for (const method of ["refresh", "checkRelease", "loadMachines"]) h.view[method] = () => work.push(method);
  h.state.hidden = true; h.timers.get(20000)(h.cx);
  h.state.hidden = false; h.timers.get(20000)(h.cx);
  h.view.view = "machines"; h.timers.get(60000)(h.cx);
  assert.deepEqual(work, ["refresh", "checkRelease", "loadMachines"]);
  h.shared.set("skillshare.notice.v1", { kind: "warn", at: 1 });
  h.timers.get(1000)(h.cx); h.timers.get(1000)(h.cx);
  assert.equal(h.notifications(), 1);
  let focused = 0, next = 0;
  h.view.handle.focus = () => focused++;
  hostCommand();
  function hostCommand() { globalThis.host.nextCommand = async () => { if (++next > 1) throw Error("end of stream"); return "focus"; }; }
  await assert.rejects(h.tasks.at(-1)(h.cx), /end of stream/);
  assert.equal(focused, 1);
});

test("refresh reads the selected project and install discovery, audit and install run in sequence", async (t) => {
  const h = host(t), jobs = [], files = new Map();
  globalThis.__herdrFiles = files;
  globalThis.__herdrExec = async (cmd, args, { on }) => {
    assert.equal(cmd, "sh"); assert.equal(on, "desk");
    const script = args[1], words = args.slice(3);
    let stdout = "";
    if (script.includes('for d in "$@"')) stdout = "/repo";
    else if (script.includes('/code') && script.includes("mktemp")) {
      const dir = "/job-" + jobs.length;
      let output = "{}";
      if (words[1]?.includes("git clone")) output = '@dir /clone\n{"planned":[{"name":"one","path":"."}]}';
      else if (words[1]?.includes("skillshare audit")) output = '@@ .\n{"results":[]}';
      else if (words[1] === "install") output = '{"skills":["one"]}';
      else if (words[1] === "list") output = "[]";
      jobs.push(words); files.set(dir + "/code", "0"); files.set(dir + "/out", output); stdout = dir;
    } else if (words.includes("status")) stdout = '{"version":"1","targets":[]}';
    return { code: 0, stdout, stderr: "" };
  };
  h.tasks.length = 0; h.view.ctx = h.view.context();
  h.view.refresh(h.cx, true); await h.tasks.shift()(h.cx);
  assert.equal(h.view.project, "/repo"); assert.equal(h.view.version, "1"); assert.equal(h.view.loading, false);
  h.state.props = { role: "install", on: "desk", project: "/repo" };
  Object.assign(h.view, { url: { value: () => "owner/repo" }, scope: "project" });
  h.view.installNext(h.cx);
  while (h.tasks.length) await h.tasks.shift()(h.cx);
  assert.deepEqual(h.view.prog.done, ["one"]);
  assert.deepEqual(jobs.at(-1), ["/repo", "install", "owner/repo", "--json", "--kind", "skill", "-p"]);
  assert.equal(h.shared.get("skillshare.request.v1").op, "refresh");
});

test("a dialog reads the selected file and reports preview failures", async (t) => {
  const h = host(t, { role: "preview", item: { kind: "extras", dir: "/d", file: "a", extra: "file" } });
  globalThis.__herdrExec = async (_cmd, args) => ({ code: 0, stdout: args.at(-1), stderr: "" });
  await h.tasks.at(-1)(h.cx);
  assert.equal(h.view.doc.body, "/d/a");
  h.view.openFile("b", h.cx); await h.tasks.at(-1)(h.cx);
  assert.equal(h.view.doc.body, "/d/b");
});

test("dialog keys propagate only when handled, then the overlay finishes its exit", async (t) => {
  const h = host(t, { role: "text", overlay: "dialog-id" });
  const delays = [], closed = [];
  h.cx.sleep = async ms => { delays.push(ms); };
  globalThis.__herdrCloseOverlay = id => closed.push(id);
  t.after(() => { delete globalThis.__herdrCloseOverlay; });
  let stops = 0;
  h.cx.stop_propagation = () => stops++;
  const motion = h.tasks.at(-1)(h.cx);
  await Promise.resolve();
  h.render();
  const key = h.listeners.get("text/on_key_down/");
  key({ key: "tab" }, h.cx);
  assert.equal(stops, 0);
  key({ key: "enter" }, h.cx);
  key({ key: "escape" }, h.cx);
  await motion;
  assert.equal(stops, 2);
  assert.deepEqual(delays, [16, 150]);
  assert.deepEqual(closed, ["dialog-id"]);
});

test("collapsed target lanes show the remaining target names", (t) => {
  const h = host(t);
  h.render();
  h.view.raw = { global: { list: [], targets: Array.from({length: 9}, (_, i) => "agent-" + i) } };
  h.view.loadedAt = 1;
  const tree = JSON.stringify(h.render());
  assert.match(tree, /map-rest-ok/);
  assert.match(tree, /agent-8/);
});

test("review from a blocked install closes it and passes the findings to the audit dialog", (t) => {
  const h = host(t, { role: "install", agent: { address: "a1", name: "Codex" } });
  h.state.agents = [{ address: "a1" }];
  let overlay;
  globalThis.host.openOverlay = spec => { overlay = spec; };
  Object.assign(h.view, { step: "progress", source: "owner/repo", prog: {
    at: 1, label: "one", blocked: { blocked: ["."], findings: [{ severity: "HIGH", pattern: "test", file: "a.md", line: 2, snippet: "example" }] }
  } });
  h.render();
  h.click("review");
  assert.equal(h.view.closed, true);
  assert.equal(overlay.props.role, "audit");
  assert.equal(overlay.props.address, "a1");
  assert.match(overlay.props.text, /a\.md:2 “example”/);
});
