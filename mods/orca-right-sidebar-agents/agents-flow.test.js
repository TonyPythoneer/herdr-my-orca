import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));

// Agents come from the app model; the shared recorder leaves `agents` undefined.
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(name, context, next) {
    const result = await next(name, context);
    if (name !== "herdr") return result;
    const source = 'export * from ' + JSON.stringify(result.url) + '; export const agents = () => globalThis.__agents?.();';
    return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
  }
`));

const { default: Agents } = await import("./main.js");

test("scan keeps the user title, earliest cwd and latest assistant preview", async () => {
  const view = new Agents(), jobs = [], timers = [];
  const path = "/sessions/one.jsonl";
  const records = [
    { type: "session", id: "abc", cwd: "/repo", title: "Initial", timestamp: "2020-01-01" },
    { type: "session_info", name: "Named", timestamp: "2020-01-02" },
    { type: "title", v: 1, source: "auto", title: "Generated", updatedAt: "2021-01-01" },
    { type: "model_change", modelId: "m" },
    { type: "message", message: { role: "user", content: "hello" } },
    { type: "message", timestamp: "2020-01-03", message: { role: "assistant", content: ["one", {}, { text: "two" }], model: "final" } },
  ];
  globalThis.__herdrExec = (_cmd, args) => ({ stdout: args.at(-1) === path
    ? ["{invalid", ...records.map(r => JSON.stringify(r))].join("\n") : path });
  let notified = 0;
  const cx = { spawn: fn => jobs.push(fn), notify: () => notified++, timer: { every: (ms, fn) => timers.push([ms, fn]) } };
  view.init({}, cx);
  await jobs.shift()(cx);
  assert.deepEqual(view.history, [{ id: "abc", path, cwd: "/repo", title: "Named", model: "final",
    updatedAt: Date.parse("2020-01-03"), preview: { role: "assistant", text: "one  two" } }]);
  assert.deepEqual(timers.map(([ms]) => ms), [1000, 60000]);
  timers[0][1](cx);
  timers[1][1](cx);
  assert.equal(jobs.length, 1);
  assert.equal(notified, 1);
  const space = { active: true, id: "main", folder: "/repo" };
  globalThis.__herdrSpaces = () => [space];
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: () => JSON.stringify({ entry: { repo: "/common", top: "/repo", worktrees: [{ path: "/linked" }] } }),
  } });
  view.scope = "project";
  view.search = { value: () => "named" };
  assert.match(JSON.stringify(view.render(cx).__node), /Resume Named/);
  view.search = { value: () => "other" };
  view.historyLoading = false; // the 60 s timer started another scan

  assert.match(JSON.stringify(view.render(cx).__node), /No sessions match/);
});

// One transcript through the real scan: the file reader is the exec stub.
async function scan(path, records) {
  const view = new Agents(); let job;
  globalThis.__herdrExec = (_cmd, args) => ({ stdout: args.length === 2 ? path : records.map(r => JSON.stringify(r)).join("\n") });
  view.init({}, { spawn: fn => { job = fn; }, notify() {}, timer: { every() {} } });
  await job({ notify() {} });
  return view.history[0];
}
const SESSION = "/s/0123abcd-0123-0123-0123-0123456789ab.jsonl";

test("a user-given name outranks any automatic title, whichever comes first", async () => {
  const auto = { type: "title", v: 1, source: "auto", title: "Auto", updatedAt: "2021-01-01" };
  const user = { type: "session_info", name: " Mine ", timestamp: "2020-01-01" };
  assert.equal((await scan(SESSION, [auto, user])).title, "Mine");
  assert.equal((await scan(SESSION, [user, auto])).title, "Mine");
  assert.equal((await scan(SESSION, [{ type: "title", v: 1, source: "user", title: "Set" }, user])).title, "Mine");
});

test("among automatic titles the newer stamp wins and unknown sources, versions and blanks are ignored", async () => {
  const auto = (title, updatedAt, extra = {}) => ({ type: "title", v: 1, source: "auto", title, updatedAt, ...extra });
  assert.equal((await scan(SESSION, [auto("New", "2021-01-01"), auto("Old", "2020-01-01")])).title, "New");
  assert.equal((await scan(SESSION, [auto("Old", "2020-01-01"), auto("New", "2021-01-01")])).title, "New");
  assert.equal((await scan(SESSION, [auto("Later", "bad"), auto("Kept", "2020-01-01")])).title, "Kept");
  assert.equal((await scan(SESSION, [auto("Wrong", "2020", { v: 2 }), auto("Blank", "2020", { title: "  " }), auto("Odd", "2020", { source: "bogus" }),
    { type: "title_change", title: "Changed", titleSource: "auto", timestamp: "2019-01-01" }])).title, "Changed");
  assert.equal((await scan(SESSION, [{ type: "session", id: "x", title: "From session", cwd: " /w " }])).cwd, "/w");
});

test("without a name the first user message, then the short id, titles the session", async () => {
  const message = (role, content) => ({ type: "message", message: { role, content } });
  assert.equal((await scan(SESSION, [message("assistant", "hi"), message("user", " first "), message("user", "second")])).title, "first");
  const bare = await scan(SESSION, [{ type: "x" }]);
  assert.equal(bare.title, "OMP 0123abcd");
  assert.equal(bare.id, "0123abcd-0123-0123-0123-0123456789ab");
  assert.equal(bare.updatedAt, null);
  assert.equal(bare.preview, null);
  const modelled = await scan("/s/plain.jsonl", [{ type: "model_change", model: "a" }, { type: "model_change", modelId: "b" }, { type: "message", message: { role: "user", content: [] } }]);
  assert.deepEqual([modelled.id, modelled.model, modelled.title], ["plain", "b", "OMP plain"]);
});

test("project scope lists agents and sessions from the repo's other checkouts, not from other repos", () => {
  const view = new Agents();
  const spaces = [{ id: "s1", folder: "/repo", active: true }, { id: "s2", folder: "/linked" }, { id: "s3", folder: "/other" }];
  globalThis.__herdrSpaces = () => spaces;
  globalThis.__agents = () => ["s1", "s2", "s3"].map(space => ({ address: `t-${space}`, status: "idle", title: `agent ${space}`, space }));
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: () => JSON.stringify({ a: { repo: "/common", top: "/repo", worktrees: [{ path: "/linked" }] }, b: { repo: "/zzz", top: "/other" } }),
  } });
  view.scope = "project";
  view.history = ["/repo/x", "/linked/y", "/other/z", null].map((cwd, i) => ({ path: `/p/${i}`, cwd, title: `session ${i}`, updatedAt: null, preview: null }));
  view.search = { value: () => "" };
  const page = JSON.stringify(view.render({}).__node);
  for (const text of ["agent s1", "agent s2", "session 0", "session 1", "2 of 4 sessions"]) assert.ok(page.includes(text), text);
  for (const text of ["agent s3", "session 2", "session 3"]) assert.ok(!page.includes(text), text);
  spaces.length = 0;
  view.scope = "workspace";
  assert.match(JSON.stringify(view.render({}).__node), /"Live agents"[\s\S]*agent s3/, "with no space every scope falls back to all");
});

test("session rows read their age and the scope and search controls report their state", () => {
  const view = new Agents(), at = ms => Date.now() - ms;
  globalThis.__herdrSpaces = () => [];
  globalThis.__agents = () => [];
  view.search = { value: () => "" };
  view.history = [30_000, 5 * 60_000, 2 * 3_600_000, 3 * 86_400_000, 60 * 86_400_000, 800 * 86_400_000].map((age, i) => ({ path: `/p/${i}`, title: `t${i}`, cwd: "/w", model: "m", updatedAt: at(age), preview: { role: "user", text: "q" } }));
  view.history.push({ path: "/p/x", title: "unknown", updatedAt: NaN, preview: null });
  const page = JSON.stringify(view.render({}).__node);
  for (const text of ["Just now", "5m ago", "2h ago", "3d ago", "2mo ago", "2y ago", "Unknown time", "You", "No conversation preview available", "unknown folder", "7 sessions"]) assert.ok(page.includes(text), text);
  view.history = [];
  assert.match(JSON.stringify(view.render({}).__node), /No agent sessions found/);
  view.historyError = "boom";
  view.historyLoading = true;
  assert.match(JSON.stringify(view.render({}).__node), /boom[\s\S]*Scanning sessions/);
  const runs = [];
  globalThis.__herdrRun = (cmd, args) => runs.push([cmd, args]);
  view.resume({ path: "/p/1", cwd: null });
  view.resume({ path: "/p/2", cwd: "/w" });
  assert.deepEqual(runs, [["terminal.open", { argv: ["omp", "--resume=/p/1"] }], ["terminal.open", { argv: ["omp", "--resume=/p/2"], folder: "/w" }]]);
});
