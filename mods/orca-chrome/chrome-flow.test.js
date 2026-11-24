import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));

// The shared recorder drops setShared and notify; the runner's output is exactly those two.
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(name, context, next) {
    const result = await next(name, context);
    if (name !== "herdr") return result;
    const source = 'export * from ' + JSON.stringify(result.url)
      + '; export const setShared = (...args) => globalThis.__setShared?.(...args),'
      + ' notify = (...args) => globalThis.__notify?.(...args), nextCommand = () => globalThis.__command();';
    return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
  }
`));

const { default: Chrome } = await import("./main.js");

test("titlebar chooses padding for the rail, traffic lights, fullscreen and non-mac windows", () => {
  const view = new Chrome();
  for (const [hidden, traffic_lights, win, padding] of [
    [false, true, null, 75], [false, false, { platform: "macos", fullscreen: true }, 8],
    [false, true, { platform: "linux" }, 10], [true, false, null, 6],
  ]) {
    globalThis.__herdrLayout = () => ({ traffic_lights, children: [{ id: "sidebar", hidden }] });
    view.win = win;
    assert.deepEqual(view.render().__node.c.find(([key]) => key === "pl"), ["pl", [padding]]);
  }
  globalThis.__herdrProps = () => ({ footer: true, unified: true });
  globalThis.__herdrShared = () => 350;
  globalThis.__herdrLayout = () => ({ children: [{ id: "sidebar", size: { px: 175 } }] });
  const frame = JSON.stringify(view.render().__node);
  assert.match(frame, /Model providers/);
  assert.match(frame, /"left",\[-14\]/);
});

test("footer seeds the catalog model, then runs a requested task on the next tick", async () => {
  const jobs = [], calls = [], files = new Map([["/home/tasks.json", null]]);
  files.set("/home/agent-config.json", JSON.stringify({ catalog: { codex: { models: [{ id: "small" }] } } }));
  globalThis.__herdrFiles = files;
  globalThis.__herdrProps = () => ({ footer: true });
  globalThis.__herdrExec = (cmd, args) => { calls.push(cmd); return { stdout: "", stderr: "", code: 0 }; };
  let every;
  const pending = {};
  globalThis.__herdrShared = (key) => key === "tasks.request" ? pending.request : null;
  const cx = { spawn: fn => jobs.push(fn), timer: { every(ms, fn) { assert.equal(ms, 10000); every = fn; } } };
  new Chrome().init({}, cx);
  // The command listener waits indefinitely. The startup tick is the second job.
  await jobs[1]();
  const config = JSON.parse(files.get("/home/tasks.json"));
  assert.match(JSON.stringify(config), /small/);
  const task = config.tasks[0];
  pending.request = { id: task.id, at: Date.now() };
  every(cx);
  await jobs.at(-1)();
  assert.ok(calls.includes(task.argv[0]));
});

// The footer copy of the runner, with a file, an exec and a publish log the test can read.
async function startRunner({ text, exec, files = new Map(), resets = '{"claude":null,"codex":null}', request }) {
  const published = request ? { "tasks.request": request } : {}, sets = [], notices = [], jobs = [], execs = [];
  files.set("/home/tasks.json", text);
  globalThis.__herdrFiles = files;
  globalThis.__herdrProps = () => ({ footer: true });
  globalThis.__setShared = (key, value) => { sets.push(key); published[key] = value; };
  globalThis.__herdrShared = key => published[key];
  globalThis.__notify = notice => notices.push(notice);
  globalThis.__herdrExec = async (cmd, args, options) => {
    execs.push(cmd);
    if (cmd === "sh") return { stdout: resets, code: 0 };
    return exec(cmd, args, options);
  };
  let every;
  const cx = { spawn: fn => jobs.push(fn), timer: { every: (_ms, fn) => { every = fn; } } };
  new Chrome().init({}, cx);
  const tick = async () => { await jobs.at(-1)(); };
  await tick();
  return { published, sets, notices, execs, files, tick: async () => { every(cx); await tick(); } };
}
const daily = (id, extra = {}) => ({ id, name: `Task ${id}`, agent: "claude", argv: ["run", id], enabled: true, trigger: { type: "daily", time: "00:00" }, ...extra });
const configText = tasks => JSON.stringify({ version: 1, tasks });

test("a broken tasks.json is published as an error and nothing runs", async () => {
  const run = await startRunner({ text: "{ nope", exec: () => assert.fail("no task may run") });
  assert.equal(run.published["tasks.text"], "{ nope");
  assert.equal(run.published["tasks.config"], null);
  assert.equal(run.published["tasks.error"], "tasks.json is not valid JSON.");
  assert.deepEqual(run.notices, []);
});

test("a due task runs once, a failure warns with its exit code and a thrown start reports its note", async () => {
  const run = await startRunner({ text: configText([daily("a"), daily("off", { enabled: false }), daily("b")]),
    exec: (cmd, args) => { if (args[0] === "b") throw Error("not installed"); return { code: 2, stderr: "bad", stdout: "" }; } });
  assert.deepEqual(run.execs, ["sh", "run", "run"]);
  assert.deepEqual(run.notices, [
    { title: "Task a failed", body: "Exit 2 · bad", level: "warning" },
    { title: "Task b failed", body: "not installed", level: "warning" }]);
  assert.deepEqual(Object.keys(run.published["tasks.state"]), ["a", "off", "b"]);
  assert.equal(run.published["tasks.state"].a.last.fails, 1);
  assert.equal(run.published["tasks.state"].off.last, null);
  assert.equal(run.published["tasks.error"], "");
  // The two-minute retry is not due yet, and the reset probe waits for the next tick after a run only.
  const sets = run.sets.length;
  await run.tick();
  assert.deepEqual(run.execs.filter(cmd => cmd === "run"), ["run", "run"]);
  assert.equal(run.sets.length, sets, "an unchanged tick publishes nothing");
});

test("the reset probe publishes its readings and a failing probe keeps the last ones", async () => {
  const resets = JSON.stringify({ claude: { live: { rate_limits: { five_hour: { resets_at: 4102444800 } } } }, codex: null });
  const run = await startRunner({ text: configText([]), exec: () => ({ code: 0 }), resets });
  assert.equal(run.published["tasks.resets"].claude.h5, 4102444800 * 1000);
  const failing = await startRunner({ text: configText([]), exec: () => ({ code: 0 }), resets: undefined });
  assert.deepEqual(Object.keys(failing.published["tasks.resets"]), ["claude", "codex"]);
  globalThis.__herdrExec = async () => { throw Error("no shell"); };
  const before = failing.published["tasks.resets"];
  await failing.tick();
  assert.equal(failing.published["tasks.resets"], before);
});

test("an unreadable file reports its message, and the runner works again on the next tick", async () => {
  const files = { get: () => { throw Error("disk gone"); }, set() {} };
  const run = await startRunner({ text: "", exec: () => ({ code: 0 }), files: new Map() });
  globalThis.__herdrFiles = files;
  await run.tick();
  assert.equal(run.published["tasks.error"], "disk gone");
  globalThis.__herdrFiles = new Map([["/home/tasks.json", configText([])]]);
  await run.tick();
  assert.equal(run.published["tasks.error"], "");
});

test("a missing file is seeded, with the catalog model unless the cache is unreadable", async () => {
  const files = new Map([["/home/agent-config.json", "{ broken"]]);
  const run = await startRunner({ text: null, exec: () => ({ code: 0 }), files });
  assert.equal(files.get("/home/tasks.json"), run.published["tasks.text"]);
  assert.ok(run.published["tasks.config"].tasks.length > 0);
  assert.equal(run.published["tasks.error"], "");
});

test("a Run now request is served once while fresh and ignored when stale, malformed or for an unknown task", async () => {
  const text = configText([daily("a", { enabled: false })]);
  const exec = () => ({ code: 0 });
  const ran = async request => (await startRunner({ text, exec, request })).execs.filter(cmd => cmd === "run").length;
  assert.equal(await ran({ id: "a", at: Date.now() }), 1);
  assert.equal(await ran({ id: "a", at: Date.now() - 120_000 }), 0);
  assert.equal(await ran({ id: "a", at: "x" }), 0);
  assert.equal(await ran({ id: 5, at: Date.now() }), 0);
  assert.equal(await ran({ id: "zzz", at: Date.now() }), 0);
  assert.equal(await ran(undefined), 0);
});
