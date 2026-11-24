import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildItems } from "./model.js";
Date.now = () => 1700000000000; // age text and expiry must not depend on the clock

// Render digests over many panel and dialog states (see view-test.js for the host). Named *-test.js: see model-test.js.
const { host } = await import("./view-test-host.js");

const digest = (trees) => createHash("sha256").update(JSON.stringify(trees)).digest("hex");
const GOLDEN = {
  "panel": "fddb30ad491b7c720114cfe06018a9bcf81b22e0733620329c83a221bf6498ee",
  "preview": "160efd82b623045f5b39164b976273d361af272dcc537005ff7397e0214b2bc0",
  "dialogs": "909a303c5092d71327116ab4111f1ee3620388224d6c43cfbc2eb84cfda98854",
};
function check(name, trees) {
  const actual = digest(trees);
  if (process.env.PRINT_GOLDEN) console.log(`GOLDEN ${name} ${actual}`);
  else assert.equal(actual, GOLDEN[name], name);
}

const rich = (scope) => ({
  list: [{ name: "s1", kind: "skill", source: "https://github.com/o/r.git" }, { name: "s2", kind: "skill", repoName: "tr1" }, { name: "s3", kind: "skill", disabled: true },
    { name: "ag.md", kind: "agent", relPath: "ag.md" }, { name: "s4" }, { name: "s5", relPath: "x/s5" }, { name: "s6", source: "https://github.com/o/r.git" }],
  check: { skills: [{ name: "s1", status: "update_available", version: "1" }], tracked_repos: [{ name: "tr1", status: "behind", behind: 3 }] },
  checkAgents: [{ name: "ag", status: "update_available" }],
  diff: { targets: [{ name: "claude", items: [{ name: "s4", is_sync: true, action: "add" }, { name: "s5", is_sync: true, action: "modify" }, { name: "ag", kind: "agent", is_sync: true, action: "modify" }] }, { name: "codex", items: [] }] },
  mcp: { changes: [{ name: "m1", target: "claude", action: "add" }, { name: "m1", target: "codex", action: "unchanged" }, { name: "m2", target: "claude", action: "unchanged" }] },
  plugins: { packages: { p1: { source: "https://github.com/o/p.git", version: "2", bindings: { claude: { pending: true, id: "x" }, codex: {} } }, p2: { bindings: {} } } },
  hooks: { source: { entries: { fmt: { description: "d", bindings: { claude: {} } }, off: { enabled: false, bindings: {} } } },
    plan: { changes: [{ name: "fmt", target: "claude", action: "add" }, { name: "off", target: "claude", action: "inactive", inactiveReason: "off" }, { target: "claude", action: "conflict", message: "c" }], warnings: ["w1"] } },
  root: "/repo", targetPaths: [{ name: "claude", path: "/repo/.claude/skills" }, { name: "codex", path: "/repo/.codex/skills" }],
  extras: [{ name: "rules", source_dir: "/s", file_count: 2, targets: [{ path: "/repo/.claude/r", status: "synced" }, { path: "/repo/.codex/r", status: "drift", mode: "symlink" }] },
    { name: "f", file: "f.md", source_dir: "/s", targets: [] }, { name: "gone", source_exists: false, source_dir: "/g", targets: [] }],
  memory: { root: "/m", notes: [{ path: "n.md" }] }, targets: ["claude", "codex"], skillTargets: ["claude", "codex"], agentTargets: ["claude"], pending: [], errors: {}, scope,
});
const FAR = 1e15; // a lock or notice stamped in the future never expires
const GIT = [null, { repo: true, top: "/r", upstream: "o/m", files: [{ code: "M", path: "a" }], ahead: 1, behind: 2 }, { repo: true, upstream: null, files: [], ahead: 0, behind: 0 }, { error: "bad" }];
const MACHINES = [{}, { "": { here: true, label: "this computer", version: "1.0", update: true, latest: "2.0", doctor: { errors: 1 }, git: GIT[1], targets: 2, drift: 2, pending: [{ name: "a", n: 1 }] },
  desk: { on: "desk", label: "desk", version: "0.9", git: { ...GIT[2], repo: true }, targets: 1, drift: 0, pending: [] }, gone: { on: "gone", label: "gone", missing: true }, bad: { label: "bad", error: "x" }, wait: { label: "wait", checking: true } }];

test("panel views over many states keep their render trees", (t) => {
  const trees = [];
  const h = host(t);
  const fill = (extra = {}) => {
    Object.assign(h.view, { project: "/repo", projectKnown: true, loadedAt: 1, raw: { project: rich("project"), global: { ...rich("global"), list: rich("global").list.slice(0, 3) } }, checks: {}, pending: [], error: null, git: GIT[1], ...extra });
    h.view.rebuild();
  };
  for (const view of ["overview", "library", "machines"]) {
    for (const [git, scope, kind, query, machines] of [[0, "all", "skills", "", 0], [1, "project", "agents", "", 1], [2, "global", "mcp", "s", 1], [3, "all", "plugins", "zzz", 0], [1, "all", "hooks", "", 0], [2, "project", "extras", "", 1]]) {
      h.shared.set("skillshare.busy.v1", null); h.shared.set("skillshare.notice.v1", null);
      fill({ view, scope, kind, query, git: GIT[git], machines: MACHINES[machines], machinesAt: machines ? 1 : 0, expanded: new Set(["source:o/r"]) });
      h.shared.set("skillshare.inSyncView.v1", pick(["list", null], scope));
      trees.push(h.render());
    }
  }
  const variants = [
    { loadedAt: 0, raw: {}, items: [], project: null, projectKnown: false }, { loadedAt: 0, raw: {}, items: [], error: "boom" }, { error: "boom", items: [] },
    { raw: { project: { ...rich("project"), pending: ["diff", "mcp"], errors: { hooks: "bad", memory: "m" } }, global: rich("global") } },
    { raw: { project: { ...rich("project"), pending: ["list"], errors: { list: "x" } } }, items: [] },
    { project: null, projectKnown: true, raw: { global: rich("global") } }, { project: null, projectKnown: false, raw: {} },
    { pending: [{ op: "toggle", item: { key: "project:skills:s1" }, action: "disable", ended: false }, { op: "update", ended: true, on: null }], machines: MACHINES[1] },
  ];
  for (const view of ["overview", "library", "machines"]) for (const v of variants) { fill({ view, kind: "skills", scope: "all", query: "", ...v }); trees.push(h.render()); }
  for (const [lock, notice] of [[{ "": { text: "Syncing project…", at: FAR } }, null], [{ "": { text: "Pulling…", at: FAR }, desk: { text: "Updating skillshare on desk…", at: FAR } }, { kind: "done", text: "ok", at: FAR }],
    [null, { kind: "warn", text: "careful", at: FAR }], [null, { kind: "error", text: "bad", at: FAR }], [{ "*": { text: "Updating the panel to v2", at: FAR } }, { kind: "info", text: "fyi", at: FAR }]]) {
    h.shared.set("skillshare.busy.v1", lock); h.shared.set("skillshare.notice.v1", notice);
    for (const view of ["overview", "library", "machines"]) { fill({ view, machines: MACHINES[1], machinesAt: 1, pending: [{ op: "pullsync", on: "desk", ended: false }, { op: "upgrade", on: null, ended: false }] }); trees.push(h.render()); }
  }
  h.shared.set("skillshare.busy.v1", null); h.shared.set("skillshare.notice.v1", null);
  fill({ view: "overview", stopped: { files: ["a"], previews: {}, repo: "/r" }, latest: "v9.9.9", version: "1.2" }); trees.push(h.render());
  h.view.view = "library"; h.view.stopped = null; trees.push(h.render());
  check("panel", trees);
});

function pick(list, key) { return list[key.length % list.length]; }

test("preview dialogs for every kind, state, pane and document keep their render trees", (t) => {
  const items = [...buildItems("project", rich("project")), ...buildItems("global", rich("global"))];
  const states = new Map();
  for (const i of items) states.set(`${i.kind}/${i.state}/${Boolean(i.notice)}/${i.extra ?? ""}/${Boolean(i.diagnostic)}/${Boolean(i.blocker)}`, i);
  const trees = [], docs = [{ loading: true }, { gone: "missing" }, { error: "bad" }, { files: ["SKILL.md", "b.md"], more: true, dir: "/d", meta: [{ key: "k", value: "v" }], body: "text" },
    { files: ["x"], dir: "/d", meta: [], body: "plain", plain: true }, { server: [{ key: "command", value: "run" }] }, { server: [] }, { files: ["only.md"], body: "t" }];
  const h = host(t, { role: "text" });
  for (const it of states.values()) {
    for (const d of docs) for (const pane of ["main", "targets", "details", "nope"]) {
      h.state.props = { role: "preview", item: it, on: pick([null, "desk"], it.key), project: "/repo", busy: it.key.length % 2 === 0, agent: it.key.length % 3 ? { address: "a1", name: "Codex" } : null,
        targets: [{ name: "claude", text: "needs sync", warn: true }, { name: "codex", text: "in sync", warn: false }].slice(0, it.key.length % 3) };
      Object.assign(h.view, { doc: d, pane, file: d.files?.[0] ?? null, gone: false });
      trees.push(h.render());
    }
  }
  check("preview", trees);
  assert.ok(states.size > 15);
});

test("action, source, sync, conflict, audit and text dialogs keep their render trees", (t) => {
  const h = host(t, { role: "text" }), trees = [];
  const item = { name: "s", label: "S", scope: "global", kind: "skills", key: "k" };
  h.state.agents = [{ address: "a1", status: "idle", space_name: "sp", tab_name: "tb", program: { name: "Codex", icon: "i.svg", tint: true } }, { address: "a2", status: "blocked", program: { name: "Claude", icon: "c.svg" } }];
  const gits = [{ repo: false }, undefined, { repo: false, error: "bad" }, ...GIT.slice(1), { repo: true, top: "/r", upstream: "o", files: [], ahead: 2, behind: 0 }, { repo: true, top: "/r", upstream: "o", files: [{ code: "A", path: "x" }], ahead: 0, behind: 0 },
    { repo: true, upstream: "o", files: [], ahead: 0, behind: 3 }, { repo: true, upstream: "o", files: new Array(50).fill({ code: "M", path: "p" }), ahead: 1, behind: 1 }];
  const roles = [
    ...gits.map((git) => ({ role: "source", on: "desk", git })), { role: "syncboth", repo: "/r", label: "desk" }, { role: "syncboth", repo: "/r" },
    { role: "upgrade", on: "desk", label: "desk", from: "v1", to: "2.0" }, { role: "upgrade", label: "x", to: "v3" }, { role: "panelupdate", from: "1.0", to: "v2" },
    { role: "text", title: "T", text: "out" }, { role: "text" }, { role: "nothing" },
    ...["hook", "able"].flatMap((role) => ["enable", "disable", "remove"].map((action) => ({ role, item, action, on: null }))),
    { role: "uninstall", item },
    { role: "audit", address: "a1", name: "Codex", item, text: "msg" }, { role: "audit", address: "a2", name: "Claude", item, text: "msg" }, { role: "audit", address: "zz", name: "Gone", item, text: "msg" },
  ];
  for (const p of roles) { h.state.props = p; h.view.choices = {}; h.view.msg = h.view.msg ?? { value: () => "" }; trees.push(h.render()); }
  h.state.props = { role: "text", title: "T", text: "out" };
  h.view.sending = true; h.view.failed = "could not send"; h.state.props = { role: "audit", address: "a1", name: "Codex", item, text: "m" }; trees.push(h.render());
  h.view.sending = false; trees.push(h.render()); h.view.failed = null;
  const conflict = { role: "conflict", on: null, repo: "/r", push: true, files: ["a", "b", "c", "d"], previews: {
    a: { differ: 1, local: { lines: [{ text: "x", mark: true }, { text: "" }], cut: false }, remote: { lines: [{ text: "y" }], cut: true } }, b: { differ: 2, local: null, remote: { lines: [] } } } };
  h.state.props = conflict; h.view.choices = { a: "local", b: "remote" }; trees.push(h.render()); h.view.choices = {}; trees.push(h.render());
  check("dialogs", trees);
});
