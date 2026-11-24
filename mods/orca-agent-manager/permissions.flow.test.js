// Flow test: runs the real permission handlers of main.js against in-memory programs.json and
// agent-manager.json (scripts/gpui-stub-loader.mjs), so the write order and both file shapes are
// checked without the app.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: AgentManager } = await import("./main.js");

const PROGRAMS = "/home/programs.json";
const MANAGER = "/home/agent-manager.json";
const AGENTS = [
  { key: "claude", installed: true },
  { key: "codex", installed: true },
  { key: "opencode", installed: true },
  { key: "gemini", installed: true },
  { key: "pi", installed: true },
];

function harness({ programs, manager = "", failPrograms = false }) {
  const files = new Map([
    [PROGRAMS, programs],
    [MANAGER, manager],
  ]);
  globalThis.__herdrFiles = files;
  const pending = [];
  const cx = {
    notify() {},
    timer: { after() {} },
    spawn(fn) {
      const promise = fn(cx);
      pending.push(promise);
      return promise;
    },
  };
  const owner = Object.create(AgentManager.prototype);
  Object.assign(owner, {
    agents: AGENTS,
    disabled: new Set(),
    permissions: { default: "own", overrides: {} },
    editors: new Map(),
    expanded: new Set(),
    permissionOpen: null,
    permissionNotice: null,
    programsText: undefined,
    managerText: undefined,
    programsError: null,
    managerError: null,
    writeError: null,
    refreshing: false,
    pendingProgramsText: undefined,
    externalConflict: false,
    loading: false,
    savedKey: null,
    action: null,
    uninstall: null,
  });
  owner.applyPrograms(programs);
  owner.applyManager(manager);
  // The page's re-read is deliberately out of scope here; the writes it would read are asserted.
  owner.refresh = () => {};
  owner.syncEditors = () => {};
  owner.shareInventory = () => {};
  const flush = async () => {
    while (pending.length) await Promise.all(pending.splice(0));
    // A nested spawn (write -> refresh) would land here.
    while (pending.length) await Promise.all(pending.splice(0));
  };
  return { owner, files, cx, flush };
}

const runOf = (files, key) => JSON.parse(files.get(PROGRAMS)).programs[key]?.run;
const managerOf = (files) => JSON.parse(files.get(MANAGER));

test("a default permission writes the recipe into every managed command, then stores the choice", async () => {
  const { owner, files, cx, flush } = harness({
    programs: JSON.stringify({
      programs: {
        claude: { run: ["claude", "--dangerously-skip-permissions"] },
        codex: { run: ["codex", "--no-daemon", "-c", "disable_paste_burst=true", "--dangerously-bypass-approvals-and-sandbox"] },
        omp: { name: "OMP", run: ["omp"] },
      },
    }),
  });
  await owner.setDefaultPermission("ask", cx);
  await flush();

  assert.deepEqual(runOf(files, "claude"), ["claude", "--permission-mode", "default"]);
  assert.deepEqual(runOf(files, "codex"), [
    "codex", "--no-daemon", "-c", "disable_paste_burst=true",
    "-a", "on-request", "-s", "read-only", "-c", "approvals_reviewer=user",
  ]);
  // An agent with no permission flag and an unmanaged entry are left exactly alone.
  assert.equal(runOf(files, "pi"), undefined);
  assert.deepEqual(JSON.parse(files.get(PROGRAMS)).programs.omp, { name: "OMP", run: ["omp"] });
  assert.deepEqual(managerOf(files), { version: 1, disabled: [], permissions: { default: "ask", overrides: {} } });
  // Only Claude and Codex can ask; the other managed agents say so instead of being rewritten.
  assert.match(owner.permissionNotice.text, /Applied to 2 agents; 2 don't support this setting/);
});

test("one agent's permission is an override and a default change keeps it", async () => {
  const { owner, files, cx, flush } = harness({
    programs: JSON.stringify({ programs: { claude: { run: ["claude"] }, codex: { run: ["codex"] } } }),
  });
  await owner.setDefaultPermission("ask", cx);
  await flush();
  const claude = owner.allRows().all.find((row) => row.key === "claude");
  await owner.setAgentPermission(claude, "full-access", cx);
  await flush();

  assert.deepEqual(runOf(files, "claude"), ["claude", "--dangerously-skip-permissions"]);
  assert.deepEqual(runOf(files, "codex"), ["codex", "-a", "on-request", "-s", "read-only", "-c", "approvals_reviewer=user"]);
  assert.deepEqual(managerOf(files).permissions, { default: "ask", overrides: { claude: "full-access" } });
  assert.equal(owner.currentPermissions().overrides.claude, "full-access");
  // An agent with no ask flag is not an exception: it simply keeps its own command.
  assert.equal(owner.currentPermissions().overrides.opencode, undefined);

  // Same as all agents clears the exception and writes the default recipe back.
  const again = owner.allRows().all.find((row) => row.key === "claude");
  assert.equal(again.permissionOverride, true);
  await owner.setAgentPermission(again, "default", cx);
  await flush();
  assert.deepEqual(runOf(files, "claude"), ["claude", "--permission-mode", "default"]);
  assert.deepEqual(managerOf(files).permissions.overrides, {});
});

test("a command that sets its own permission flags is reported and never bulk-changed", async () => {
  const { owner, files, cx, flush } = harness({
    programs: JSON.stringify({
      programs: { claude: { run: ["claude", "--permission-mode", "plan"] }, codex: { run: ["codex"] } },
    }),
  });
  await owner.setDefaultPermission("full-access", cx);
  await flush();

  assert.deepEqual(runOf(files, "claude"), ["claude", "--permission-mode", "plan"]);
  assert.deepEqual(runOf(files, "codex"), ["codex", "--dangerously-bypass-approvals-and-sandbox"]);
  assert.match(owner.permissionNotice.text, /1 uses custom launch arguments/);
  assert.equal(owner.allRows().all.find((row) => row.key === "claude").permission, "custom");
});

test("a failed programs.json write leaves agent-manager.json untouched", async () => {
  const { owner, files, cx } = harness({
    programs: JSON.stringify({ programs: { claude: { run: ["claude"] } } }),
    manager: '{"version":1,"disabled":["omp"]}',
  });
  files.set(PROGRAMS, "{ not json");
  owner.programsError = "programs.json is not valid JSON";
  const ok = await owner.setDefaultPermission("ask", cx);

  assert.equal(ok, false);
  assert.equal(files.get(MANAGER), '{"version":1,"disabled":["omp"]}');
  assert.match(owner.permissionNotice.text, /programs\.json is invalid/);
});

test("an unsaved command draft blocks a permission change", async () => {
  const { owner, files, cx } = harness({
    programs: JSON.stringify({ programs: { claude: { run: ["claude"] } } }),
  });
  owner.editors.set("claude", { dirty: true });
  const ok = await owner.setDefaultPermission("ask", cx);

  assert.equal(ok, false);
  assert.deepEqual(runOf(files, "claude"), ["claude"]);
  assert.match(owner.permissionNotice.text, /Save or cancel/);
});

// A backend whose writes can be delayed or failed, so the UI's independence from storage and the
// order of writes are checked against the real handlers.
function slowFiles(files, { delayFor = () => 0, fail = () => false } = {}) {
  let writes = 0;
  const slow = new Map(files);
  slow.set = (key, value) => {
    const n = (writes += 1);
    return new Promise((resolve, reject) =>
      setTimeout(() => (fail(key, n) ? reject(new Error("disk full")) : (Map.prototype.set.call(slow, key, value), resolve())), delayFor(n)),
    );
  };
  globalThis.__herdrFiles = slow;
  return slow;
}
const claudeRow = (owner) => owner.allRows().all.find((row) => row.key === "claude");
const diskRun = (files) => JSON.parse(Map.prototype.get.call(files, PROGRAMS)).programs.claude?.run;

test("the picked permission is visible before the disk write finishes", async () => {
  const { owner, files, cx } = harness({ programs: JSON.stringify({ programs: { claude: { run: ["claude"] } } }) });
  const slow = slowFiles(files, { delayFor: () => 40 });
  const done = owner.setAgentPermission(claudeRow(owner), "full-access", cx);

  // Synchronously, before any write: the row shows it, the menu is closed, nothing is on disk yet.
  assert.equal(claudeRow(owner).permission, "full-access");
  assert.equal(owner.permissionOpen, null);
  assert.deepEqual(diskRun(slow), ["claude"]);
  assert.equal(await done, true);
  assert.deepEqual(diskRun(slow), ["claude", "--dangerously-skip-permissions"]);
});

test("rapid picks end on the last one even when the first write is slower", async () => {
  const { owner, files, cx } = harness({ programs: JSON.stringify({ programs: { claude: { run: ["claude"] } } }) });
  // Write 1 (A's programs.json) takes 60ms, every later write 1ms: unordered writes would let A land last.
  const slow = slowFiles(files, { delayFor: (n) => (n === 1 ? 60 : 1) });
  const a = owner.setAgentPermission(claudeRow(owner), "auto", cx);
  const b = owner.setAgentPermission(claudeRow(owner), "ask", cx);
  assert.equal(claudeRow(owner).permission, "ask");
  await Promise.all([a, b]);

  assert.deepEqual(diskRun(slow), ["claude", "--permission-mode", "default"]);
  assert.equal(JSON.parse(Map.prototype.get.call(slow, MANAGER)).permissions.overrides.claude, "ask");
  assert.equal(claudeRow(owner).permission, "ask");
});

test("a failed write reloads the disk state, reports it and can be retried", async () => {
  const { owner, files, cx } = harness({ programs: JSON.stringify({ programs: { claude: { run: ["claude"] } } }) });
  let failing = true;
  const slow = slowFiles(files, { fail: () => failing });
  const ok = await owner.setAgentPermission(claudeRow(owner), "full-access", cx);

  assert.equal(ok, false);
  assert.equal(claudeRow(owner).permission, "own"); // reconciled with what is stored
  assert.match(owner.permissionNotice.text, /Could not save programs\.json/);
  assert.equal(typeof owner.permissionNotice.retry, "function");

  failing = false;
  await owner.permissionNotice.retry(cx);
  assert.deepEqual(diskRun(slow), ["claude", "--dangerously-skip-permissions"]);
  assert.equal(claudeRow(owner).permission, "full-access");
});

test("one permission pick runs no agent detection and reads each file once", async () => {
  const { owner, files, cx } = harness({ programs: JSON.stringify({ programs: { claude: { run: ["claude"] } } }) });
  let reads = 0;
  const counted = new Map(files);
  counted.get = (key) => ((reads += 1), Map.prototype.get.call(counted, key));
  globalThis.__herdrFiles = counted;
  let refreshes = 0;
  owner.refresh = () => (refreshes += 1);
  await owner.setAgentPermission(claudeRow(owner), "full-access", cx);

  assert.equal(refreshes, 0);
  assert.equal(reads, 2); // programs.json and agent-manager.json, once each, to write against the latest
});

test("render inventory derivation parses once; permission summary reuses rows", () => {
  const {owner} = harness({programs: JSON.stringify({programs:{claude:{run:["claude"]},codex:{run:["codex","--dangerously-bypass-approvals-and-sandbox"]}}})});
  const original = JSON.parse;
  let parses = 0;
  JSON.parse = (...args) => { parses++; return original(...args); };
  let rows, summary;
  try {
    rows = owner.allRows().all;
    const originalAllRows = owner.allRows;
    owner.allRows = () => { throw new Error("unnecessary second inventory derivation"); };
    try { summary = owner.currentPermissions(rows); }
    finally { owner.allRows = originalAllRows; }
    assert.equal(parses,1);
  } finally { JSON.parse = original; }
  assert.deepEqual(summary, owner.currentPermissions());
  assert.equal(summary.overrides.codex,"full-access");
  owner.applyPrograms(JSON.stringify({programs:{codex:{run:["codex"]}}}));
  assert.equal(owner.currentPermissions().overrides.codex,undefined);
});
