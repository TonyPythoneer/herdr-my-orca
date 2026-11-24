// Characterization test for the panel header's real main.js, run through the recorder stubs
// (scripts/gpui-stub-loader.mjs). Render output is compared with render.golden.json; delete that
// file to re-record after an intended view change. The git probe, the folder/SSH gating, the
// location rules and the command bridge are driven through the herdr globals.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

register(new URL("../../../../scripts/gpui-stub-loader.mjs", import.meta.url));
// The shared stub does not know panes, focused or nextCommand; this test feeds them through globals.
registerHooks({ resolve(name, context, next) {
  const result = next(name, context);
  if (name !== "herdr") return result;
  const source = `export * from ${JSON.stringify(result.url)};
    export const panes = () => globalThis.__herdrPanes?.();
    export const focused = () => globalThis.__herdrFocused?.();
    export const nextCommand = () => globalThis.__herdrNextCommand?.();`;
  return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
} });
const { default: PanelHead } = await import("./main.js");

const GOLDEN = new URL("./render.golden.json", import.meta.url);
// `foreground` is a real hex colour so the translucent tints get computed; the rest are placeholders.
const THEME = new Proxy({ foreground: "#112233" }, { get: (target, key) => target[key] ?? `#${String(key)}` });
const LAYOUT = (active) => ({ id: "root", children: [{ id: "panel", children: [{ id: "panel-body", active }] }] });
const REPO = { code: 0, stdout: "/repo\n", stderr: "" };
const NOT_REPO = { code: 128, stdout: "", stderr: "fatal" };
const PROBE_TTL = 5000;

let now = 1_000_000;
mock.method(Date, "now", () => now);

// A fresh `cx`: spawned callbacks are kept so a test runs the probe itself, and notify is counted.
function makeCx() {
  const cx = { spawned: [], notified: 0, notify() { cx.notified++; }, spawn(fn) { cx.spawned.push(fn); } };
  return cx;
}
const drain = async (cx) => {
  const jobs = cx.spawned.splice(0);
  for (const job of jobs) await job({ notify: cx.notify });
};

// Sets every herdr global one scenario reads; exec answers are looked up by call number.
function arrange({ spaces = [], panes = [], focused, active = "files", answers = [REPO], props = {} } = {}) {
  const env = { execs: [], runs: [] };
  globalThis.__herdrTheme = () => THEME;
  globalThis.__herdrSpaces = () => spaces;
  globalThis.__herdrPanes = () => panes;
  globalThis.__herdrFocused = () => focused;
  globalThis.__herdrLayout = () => LAYOUT(active);
  globalThis.__herdrProps = () => props;
  globalThis.__herdrRun = (name, args) => env.runs.push({ name, args });
  globalThis.__herdrExec = async (cmd, args, options) => {
    const answer = answers[Math.min(env.execs.length, answers.length - 1)];
    env.execs.push({ cmd, args, options });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return env;
}

const view = () => Object.create(PanelHead.prototype);
const rec = (node) => JSON.parse(JSON.stringify(node.__node));
const toolIds = (node) => rec(node).c.find(([key]) => key === "children")[1][0].map((child) => child.a[0].replace(/^panel-/, ""));

// Renders once and runs the probe, so the second render sees the resolved git state.
async function settle(cx) {
  const v = view();
  v.render(cx);
  await drain(cx);
  return v;
}
const resetProbe = () => { arrange(); view().render(makeCx()); };

const folderOf = (id, folder, machine) => ({ id, folder, machine, active: true });

const LOCATIONS = {
  noSpaceNoFocus: {},
  paneCwd: { spaces: [folderOf("s1", "/proj")], focused: { pane: "p1", cwd: "/ignored" }, panes: [{ pane: "p1", cwd: "/proj/src" }] },
  focusCwdOnly: { spaces: [folderOf("s1", "/proj")], focused: { pane: "p9", cwd: "/proj/lib" } },
  outsideProject: { spaces: [folderOf("s1", "/proj")], focused: { pane: "p1" }, panes: [{ pane: "p1", cwd: "/tmp" }] },
  siblingPrefix: { spaces: [folderOf("s1", "/proj")], focused: { pane: "p1" }, panes: [{ pane: "p1", cwd: "/proj2" }] },
  sameAsProject: { spaces: [folderOf("s1", "/proj")], focused: { pane: "p1" }, panes: [{ pane: "p1", cwd: "/proj" }] },
  projectOnly: { spaces: [folderOf("s1", "/proj")] },
  liveOnly: { focused: { pane: "p1", cwd: "/live" } },
  spaceMachine: { spaces: [folderOf("s1", "/proj", "box")], focused: { pane: "p1", cwd: "/proj" } },
  hostTerminal: { spaces: [folderOf("s1", "/proj")], focused: { pane: null, terminal: "hostA/term", cwd: "/remote" } },
  hostTerminalNoSlash: { spaces: [folderOf("s1", "/proj")], focused: { pane: null, terminal: "term", cwd: "/remote" } },
  hostTerminalNone: { spaces: [folderOf("s1", "/proj")], focused: { pane: null, cwd: "/remote" } },
  inactiveSpaceIgnored: { spaces: [{ id: "s2", folder: "/other", active: false }], focused: { pane: "p1", cwd: "/live" } },
};

for (const [name, scenario] of Object.entries(LOCATIONS)) {
  test(`location: ${name}`, async () => {
    resetProbe();
    const env = arrange(scenario);
    const cx = makeCx();
    view().render(cx);
    await drain(cx);
    const probe = env.execs[0];
    const seen = probe ? { cmd: probe.cmd, tail: probe.args.slice(-2), options: probe.options } : null;
    const golden = readGolden();
    golden.locations ??= {};
    if (!(name in golden.locations)) { golden.locations[name] = seen; writeGolden(golden); }
    assert.deepEqual(JSON.parse(JSON.stringify(seen)), golden.locations[name]);
  });
}

function readGolden() { return existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, "utf8")) : {}; }
function writeGolden(golden) { writeFileSync(GOLDEN, `${JSON.stringify(golden, null, 1)}\n`); }
function checkGolden(section, name, actual) {
  const golden = readGolden();
  golden[section] ??= {};
  if (!(name in golden[section])) { golden[section][name] = actual; writeGolden(golden); }
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), golden[section][name]);
}

test("the probe asks git for the repo root without touching .git, in the located folder", async () => {
  resetProbe();
  const env = arrange({ spaces: [folderOf("s1", "/proj", "box")], focused: { pane: "p1", cwd: "/proj" } });
  await settle(makeCx());
  assert.deepEqual(env.execs, [{
    cmd: "git",
    args: ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "rev-parse", "--show-toplevel"],
    options: { cwd: "/proj", on: "box" },
  }]);
});

test("a repo shows the git set, a folder shows the folder set, and an SSH host adds ports", async () => {
  const shown = {};
  for (const [name, answer, scenario] of [
    ["repo", REPO, { spaces: [folderOf("s1", "/proj")], focused: { pane: "p1", cwd: "/proj" } }],
    ["folder", NOT_REPO, { spaces: [folderOf("s1", "/proj")], focused: { pane: "p1", cwd: "/proj" } }],
    ["sshRepo", REPO, { spaces: [folderOf("s1", "/proj", "box")], focused: { pane: "p1", cwd: "/proj" } }],
    ["hostTerminal", REPO, LOCATIONS.hostTerminal],
  ]) {
    resetProbe();
    const env = arrange({ ...scenario, answers: [answer] });
    const cx = makeCx();
    await settle(cx);
    const second = view();
    shown[name] = toolIds(second.render(makeCx()));
  }
  checkGolden("tools", "byState", shown);
  assert.ok(shown.repo.includes("changes") && !shown.repo.includes("workspaces"));
  assert.ok(shown.folder.includes("workspaces") && !shown.folder.includes("changes"));
  assert.ok(shown.sshRepo.includes("ports") && !shown.repo.includes("ports"));
});

test("an unresolved probe shows the git set; a failing exec resolves to a folder", async () => {
  resetProbe();
  const env = arrange({ spaces: [folderOf("s1", "/proj")], focused: { pane: "p1", cwd: "/proj" }, answers: [new Error("spawn failed")] });
  const first = makeCx();
  const before = toolIds(view().render(first));
  assert.ok(before.includes("changes"), "git items show while the probe is in flight");
  await drain(first);
  assert.equal(first.notified, 1, "the first answer always repaints");
  assert.ok(toolIds(view().render(makeCx())).includes("workspaces"));
});

test("probe results are cached for five seconds, then refreshed; only a changed answer repaints", async () => {
  resetProbe();
  const env = arrange({ spaces: [folderOf("s1", "/proj")], focused: { pane: "p1", cwd: "/proj" }, answers: [REPO, REPO, NOT_REPO] });
  const first = makeCx();
  view().render(first);
  const second = makeCx();
  view().render(second);
  assert.equal(second.spawned.length, 0, "a render while the probe is pending starts no second probe");
  await drain(first);
  assert.equal(first.notified, 1);

  now += PROBE_TTL;
  const fresh = makeCx();
  view().render(fresh);
  assert.equal(fresh.spawned.length, 0, "exactly at the limit the cache still holds");

  now += 1;
  const stale = makeCx();
  view().render(stale);
  assert.equal(stale.spawned.length, 1);
  await drain(stale);
  assert.equal(stale.notified, 0, "same answer, no repaint");

  now += PROBE_TTL + 1;
  const flipped = makeCx();
  view().render(flipped);
  await drain(flipped);
  assert.equal(flipped.notified, 1, "the answer changed, repaint");
  assert.equal(env.execs.length, 3);
});

test("a changed target restarts the probe even while one is pending, and a stale answer is dropped", async () => {
  resetProbe();
  arrange({ spaces: [folderOf("s1", "/a")], focused: { pane: "p1", cwd: "/a" } });
  const first = makeCx();
  view().render(first);
  const env = arrange({ spaces: [folderOf("s1", "/b")], focused: { pane: "p1", cwd: "/b" }, answers: [REPO] });
  const second = makeCx();
  view().render(second);
  assert.equal(second.spawned.length, 1);
  await drain(first);
  assert.equal(first.notified, 0, "the answer for the old target is ignored");
  await drain(second);
  assert.equal(second.notified, 1);
  assert.equal(env.execs.length, 2, "both probes ran, only the current one counted");
});

test("a known answer for the same target survives the refresh without repainting", async () => {
  resetProbe();
  arrange({ spaces: [folderOf("s1", "/proj")], focused: { pane: "p1", cwd: "/proj" }, answers: [NOT_REPO] });
  await settle(makeCx());
  now += PROBE_TTL + 1;
  const refresh = makeCx();
  const during = toolIds(view().render(refresh));
  assert.ok(during.includes("workspaces"), "the previous answer stays visible while the refresh runs");
  await drain(refresh);
  assert.equal(refresh.notified, 0);
});

test("no folder at all counts as a resolved non-repo", () => {
  resetProbe();
  arrange({});
  const cx = makeCx();
  const ids = toolIds(view().render(cx));
  assert.equal(cx.spawned.length, 0);
  assert.ok(ids.includes("workspaces") && !ids.includes("changes"));
});

test("a gated-out active tab falls back to the first visible one, on a deferred call", () => {
  resetProbe();
  const env = arrange({ active: "changes" });
  const cx = makeCx();
  view().render(cx);
  assert.equal(env.runs.length, 0, "render itself mutates nothing");
  assert.equal(cx.spawned.length, 1);
  cx.spawned[0]();
  assert.deepEqual(env.runs, [{ name: "layout.select", args: { stack: "panel-body", child: "files" } }]);
});

test("a visible active tab, or a missing stack, needs no fallback", () => {
  resetProbe();
  const env = arrange({ active: "workspaces" });
  const cx = makeCx();
  view().render(cx);
  assert.equal(cx.spawned.length, 0);
  globalThis.__herdrLayout = () => undefined;
  view().render(cx);
  assert.equal(cx.spawned.length, 0, "the default active tab is files, which is always visible");
  globalThis.__herdrLayout = () => ({ id: "root", children: [{ id: "other" }] });
  view().render(cx);
  assert.equal(cx.spawned.length, 0);
  assert.equal(env.runs.length, 0);
});

test("render output for each state matches the golden record", async () => {
  const states = {
    folderFilesActive: { answers: [NOT_REPO], active: "files" },
    folderWorkspacesActive: { answers: [NOT_REPO], active: "workspaces" },
    repoChangesActive: { answers: [REPO], active: "changes" },
  };
  for (const [name, state] of Object.entries(states)) {
    resetProbe();
    const env = arrange({ spaces: [folderOf("s1", "/proj", "box")], focused: { pane: "p1", cwd: "/proj" }, ...state });
    await settle(makeCx());
    checkGolden("render", name, rec(view().render(makeCx())));
  }
});

test("the command bridge runs a view's commands and repaints, and ignores unknown or empty ones", async () => {
  const env = arrange();
  const queue = ["search", "agent-sessions", null, "ports"];
  globalThis.__herdrNextCommand = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise(() => {}));
  const cx = makeCx();
  view().init({}, cx);
  assert.equal(cx.spawned.length, 1);
  cx.spawned[0]({ notify: cx.notify });
  while (queue.length) await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(env.runs.map((r) => r.name), [
    "layout.show", "layout.select", "orca-files.search",
    "layout.show", "layout.select",
  ]);
  assert.equal(cx.notified, 3, "an unknown view still repaints; an empty command does not");
  delete globalThis.__herdrNextCommand;
});

test("panel tools use native accessible buttons and report their selected state", async () => {
  resetProbe();
  arrange({ active: "changes", spaces: [folderOf("s1", "/proj")], answers: [REPO] });
  const v = await settle(makeCx());
  const root = rec(v.render(makeCx()));
  const buttons = root.c.find(([key]) => key === "children")[1][0];
  assert.ok(buttons.every(button => button.n === "Button.new"));
  const selected = buttons.filter(button => button.c.some(([key, args]) => key === "selected" && args[0]));
  assert.deepEqual(selected.map(button => button.a[0]), ["panel-changes"]);
  assert.ok(buttons.every(button => button.c.some(([key]) => key === "on_click")));
  assert.ok(root.c.some(([key, args]) => key === "child" && args[0]?.n === "Button.new" && args[0].a[0] === "panel-toggle"));
});
