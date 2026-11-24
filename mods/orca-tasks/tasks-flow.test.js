import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));

// Record what the page publishes: the shared recorder drops setShared.
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(name, context, next) {
    const result = await next(name, context);
    if (name !== "herdr") return result;
    const source = 'export * from ' + JSON.stringify(result.url)
      + '; export const setShared = (...args) => globalThis.__setShared?.(...args);';
    return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
  }
`));

const { default: Tasks } = await import("./main.js");
import { serializeTasks } from "./tasks.js";

test("page timer, editor and stale writes keep their notification and retry behavior", async () => {
  const view = new Tasks(), commands = [];
  let tick, notices = 0, writes = 0;
  const cx = { notify: () => notices++, timer: { every: (ms, fn) => { assert.equal(ms, 30000); tick = fn; } } };
  view.init({}, cx);
  globalThis.__herdrLayout = () => ({ children: [{ id: "main", active: "main-tasks" }] });
  tick(cx);
  assert.equal(notices, 1);
  globalThis.__herdrRun = cmd => commands.push(cmd);
  globalThis.__herdrShared = key => key === "tasks.text" ? '{"tasks":[]}' : undefined;
  globalThis.__herdrFiles = { set() { writes++; throw Error("stale"); }, get: () => '{"version":1,"tasks":[]}' };
  await view.apply(cx, config => config);
  assert.equal(writes, 2);
  assert.match(view.error, /changed while saving/);
  globalThis.__herdrFiles = new Map();
  await view.apply(cx, config => config, { saved: true });
  assert.equal(view.saved, true);
  assert.deepEqual(commands, ["orca-chrome.tasks-scan"]);
  view.openEditor(cx);
  assert.equal(view.editing, true);
});

test("task cards show last failure, reset exemption, paused and scheduled states", () => {
  const view = new Tasks();
  const task = { id: "one", agent: "codex", name: "Check", argv: ["echo"], enabled: false,
    trigger: { type: "reset", provider: "codex", window: "h5" } };
  let exempt = true;
  const live = { last: { code: 2, fails: 3, note: "oops", at: 1 } };
  globalThis.__herdrShared = key => ({
    "tasks.config": { tasks: [task] }, "tasks.state": { one: live },
    "tasks.resets": { codex: { metered5h: !exempt } },
  })[key];
  const draw = () => JSON.stringify(view.render({}).__node);
  assert.match(draw(), /no 5h limit on this plan/);
  assert.match(draw(), /exit 2 · oops · 3×/);
  exempt = false;
  assert.match(draw(), /paused/);
  task.enabled = true;
  assert.match(draw(), /no next run/);
});

// A page with one stored config: its text is what `shared` serves and what the file holds.
function pageFixture(tasks) {
  const config = { version: 1, tasks };
  const text = serializeTasks(config);
  const files = new Map([["/home/tasks.json", text]]), published = {}, commands = [];
  let notified = 0;
  globalThis.__herdrFiles = files;
  globalThis.__herdrRun = (cmd, args) => commands.push(args ? [cmd, args] : cmd);
  globalThis.__setShared = (key, value) => { published[key] = value; };
  globalThis.__herdrShared = key => key === "tasks.text" ? text : undefined;
  const cx = { notify: () => notified++ };
  return { files, published, commands, cx, view: new Tasks(), notified: () => notified, text };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const sample = (id, extra = {}) => ({ id, agent: "claude", name: `Name ${id}`, argv: ["echo", id], enabled: true, trigger: { type: "daily", time: "09:00" }, ...extra });

test("toggle, delete and New task rewrite the file and publish the new config", async () => {
  const page = pageFixture([sample("a"), sample("b")]);
  page.view.toggle(page.cx, sample("a"));
  await settle();
  assert.deepEqual(JSON.parse(page.files.get("/home/tasks.json")).tasks.map(t => [t.id, t.enabled]), [["a", false], ["b", true]]);
  assert.deepEqual(page.commands, ["orca-chrome.tasks-scan"]);
  assert.equal(page.published["tasks.error"], "");
  assert.equal(page.view.saved, false);
  page.view.remove(page.cx, sample("a"));
  await settle();
  assert.deepEqual(page.published["tasks.config"].tasks.map(t => t.id), ["b"]);
  page.view.add(page.cx);
  await settle();
  const added = JSON.parse(page.files.get("/home/tasks.json")).tasks.at(-1);
  assert.match(added.id, /^task-/);
  assert.deepEqual([added.name, added.enabled, added.agent, added.trigger, added.cwd], ["New task", false, "claude", { type: "daily", time: "09:00" }, null]);
  assert.equal(page.view.saved, true);
  assert.equal(page.notified(), 3);
});

test("a stored text that is not a task list, or a mutation that throws, reports its message", async () => {
  const bad = pageFixture([]);
  globalThis.__herdrShared = key => key === "tasks.text" ? "not json" : undefined;
  await bad.view.apply(bad.cx, config => config);
  assert.equal(bad.view.error, "tasks.json is not valid JSON.");
  assert.deepEqual(bad.commands, []);
  const throwing = pageFixture([sample("a")]);
  await throwing.view.apply(throwing.cx, () => { throw Error("no good"); });
  assert.equal(throwing.view.error, "no good");
  assert.equal(throwing.notified(), 1);
  assert.deepEqual(throwing.published, {});
});

test("a stale write re-reads the file once and publishes what it found", async () => {
  const page = pageFixture([sample("a")]);
  const fresh = serializeTasks({ version: 1, tasks: [sample("z")] });
  let sets = 0;
  globalThis.__herdrFiles = { get: () => fresh, set: () => { sets++; throw Error("stale"); } };
  await page.view.apply(page.cx, config => config);
  assert.equal(sets, 2);
  assert.deepEqual(page.published["tasks.config"].tasks.map(t => t.id), ["z"]);
  assert.equal(page.published["tasks.text"], fresh);
  assert.match(page.view.error, /changed while saving/);
});

test("Run now files a request for the runner; the JSON editor validates, saves and cancels", async () => {
  const page = pageFixture([sample("a")]);
  page.view.runNow(page.cx, sample("a"));
  assert.equal(page.published["tasks.request"].id, "a");
  assert.deepEqual(page.commands, ["orca-chrome.tasks-scan"]);
  page.view.openEditor(page.cx);
  assert.equal(page.view.editing, true);
  const edited = value => { page.view.editor = { value: () => value }; return page.view.saveEditor(page.cx); };
  await edited("{");
  assert.equal(page.view.error, "tasks.json is not valid JSON.");
  await edited('{"tasks": []}');
  assert.equal(page.files.get("/home/tasks.json"), '{"tasks": []}\n');
  assert.deepEqual([page.view.saved, page.view.error, page.published["tasks.error"]], [true, "", ""]);
  globalThis.__herdrFiles = { set() { throw Error("stale"); } };
  await edited('{"tasks": []}\n');
  assert.match(page.view.error, /cancel and reopen/);
  page.view.closeEditor(page.cx);
  assert.deepEqual([page.view.editing, page.view.editor, page.view.error], [false, null, ""]);
});

test("cards word the last run: never, ok with note, failure with count, running and paused", () => {
  const view = new Tasks();
  const tasks = [sample("n"), sample("ok"), sample("zero", { enabled: false }), sample("run")];
  const state = { ok: { last: { code: 0, at: 1, note: "fine" }, nextAt: Date.now() + 3_630_000 }, zero: { last: { code: 3, at: 1, fails: 0 } }, run: { running: true } };
  globalThis.__herdrShared = key => ({ "tasks.config": { tasks }, "tasks.state": state, "tasks.error": "shared failure" })[key];
  const page = JSON.stringify(view.render({}).__node);
  for (const text of ["Never ran.", "· ok · fine", "exit 3", "paused", "running…", "shared failure", "Edit JSON", "in 1h 0m"]) assert.ok(page.includes(text), text);
  assert.ok(!page.includes("3×"));
  view.editing = true;
  view.editor = {};
  assert.match(JSON.stringify(view.render({}).__node), /Close JSON[\s\S]*tm-editor/);
});

test("task page owns every referenced icon and renders without sibling mods", () => {
  const source = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const refs = [...source.matchAll(/"mods\/([^/]+)\/([^"]+\.svg)"/g)];
  assert.equal(refs.length, 4);
  for (const [, mod, file] of refs) {
    assert.equal(mod, "orca-tasks");
    assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /<svg/);
  }
});

test("rendered task controls never reuse expired render or event contexts", async () => {
  const task = sample("a", { enabled: false });
  const page = pageFixture([task]);
  const current = () => JSON.parse(page.files.get("/home/tasks.json"));
  globalThis.__herdrShared = key => ({
    "tasks.text": page.files.get("/home/tasks.json"),
    "tasks.config": current(),
  })[key];
  const callbacks = new Map();
  globalThis.__gpuiClickHandler = (node, callback) => {
    const id = node.c.find(([method]) => method === "id")?.[1]?.[0];
    if (id) callbacks.set(id, callback);
  };
  const expired = { notify() { throw Error("render context expired"); }, spawn() { throw Error("render context expired"); } };
  const click = async id => {
    callbacks.clear();
    page.view.render(expired);
    const handler = callbacks.get(id);
    assert.equal(typeof handler, "function", id);
    let valid = true, pending;
    const eventCx = {
      notify() { assert.ok(valid, "event context expired"); },
      spawn(fn) { assert.ok(valid); pending = Promise.resolve().then(() => fn(page.cx)); },
    };
    handler({}, eventCx);
    valid = false;
    await pending;
  };
  try {
    await click("tm-json");
    assert.equal(page.view.editing, true);
    await click("tm-cancel");
    assert.equal(page.view.editing, false);
    await click("tm-json");
    page.view.editor = { value: () => JSON.stringify(current()) };
    await click("tm-save");
    assert.equal(page.view.saved, true);
    await click("tm-json");
    assert.equal(page.view.editing, false);
    await click("tm-on-a");
    assert.equal(current().tasks[0].enabled, true);
    await click("tm-run-a");
    assert.equal(page.published["tasks.request"].id, "a");
    await click("tm-add");
    assert.equal(current().tasks.length, 2);
    assert.equal(current().tasks[1].enabled, false);
    await click("tm-del-a");
    assert.equal(current().tasks.length, 1);
  } finally {
    delete globalThis.__gpuiClickHandler;
  }
});

test("editing tasks JSON presents the editor ahead of the task cards and hides the reset list", () => {
  const view=new Tasks();
  globalThis.__herdrShared=key=>key==="tasks.config"?{tasks:[sample("a")]}:undefined;
  view.editing=true;
  view.editor={};
  const json=JSON.stringify(view.render({}).__node);
  assert.match(json,/Close JSON[\s\S]*tm-editor[\s\S]*tm-save[\s\S]*tm-cancel/);
  assert.doesNotMatch(json,/tm-task-a|RESET WINDOWS/);
});
