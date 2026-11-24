// Characterization tests for operations.js, loader.js, jobs.js and channel.js. A fake machine
// answers from seeded random pools; the calls made and the results are compared with digests
// recorded before the refactor. Named *-test.js: see model-test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { operate } from "./operations.js";
import { findProject, loadResources, loadChecks, loadMachine, loadLatestRelease, loadPreview, loadFile } from "./loader.js";
import { createRunner, withShell } from "./jobs.js";
import { createChannel, EVERY } from "./channel.js";

function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(77);
const pick = (list) => list[Math.floor(R() * list.length)];
const maybe = (p, make) => (R() < p ? make() : undefined);
const some = (max, make) => Array.from({ length: Math.floor(R() * (max + 1)) }, make);
const digest = (value) => createHash("sha256").update(JSON.stringify(value, (_k, v) => {
  if (v === undefined) return "__undefined";
  return v instanceof Set ? [...v] : v;
})).digest("hex");

const GOLDEN = {
  operate: "8ce8e29beffd6315850766d8d66d46088b91724d842627c3f80d5bd96fd6bc9c",
  loaders: "9ee7f809e753d2b4d60340a81916e35ace2eef3d035696c82bd4a96cc0a4f673",
  loadPreview: "3dfbe61de095530c55f4138dd69c451ac4f00f6ef27f8e73b195cd301500f385",
  job: "35c609c00fdd5a245dfdf5fc17b3ce7be05814260f70cdc8d5f66e209901492b",
  withShell: "8f335fbf85408fa399d591a35e4c136fc0eb8b2d7b0159c259d224c191381055",
  channel: "164e0fab354db8ff7e35f6d6745edaf867a363370aa5f8c11e70a595c70fe253",
  scripted: "f866448bc35f2135f166844268dc118ccf2b50a3ddb23757ff692578b7dc2058",
};
function check(name, value) {
  const actual = digest(value);
  if (process.env.PRINT_GOLDEN) console.log(`GOLDEN ${name} ${actual}`);
  else assert.equal(actual, GOLDEN[name], name);
}

// Stop time so durations are the same on every run.
Date.now = () => 1700000000000; // each test file runs in its own process

const FILES = ["a.txt", "b/c.md", ".metadata.json", "sub/.metadata.json", "d.txt"];
const STDOUTS = [
  "", "junk", "{}", '{"updated":2}', '{"updated":0}', '{"error":"E"}', '{"items":[{"name":"x","status":"security_blocked"}]}',
  '{"items":[{"name":"y","status":"failed","error":"why"}]}', '{"agents":[{"name":"z","status":"failed","message":"msg"},{"status":"updated"}]}', '{"agents":[{"status":"updated"}]}',
  '{"failed":["f1"]}', '{"failed":[]}', '[]', '[{"name":"s","relPath":"s","kind":"skill","disabled":true}]', '[{"name":"s","relPath":"s","kind":"skill","disabled":false}]',
  '[{"name":"a","kind":"agent","relPath":"a","disabled":true}]', FILES.join("\n"), FILES.slice(0, 1).join("\n"),
  "@@stage 1\n{}\n@@stage 2\n{\"entries\":{}}\n@@stage 3\n{\"entries\":{\"k\":{\"installed_at\":\"2020-01-01\"}}}", "@@stage 1\n{bad",
  "@@local a.txt\nx\n@@remote a.txt\ny\n", "no files here", "both changed",
];
const STDERRS = ["", "oops\nlast line", "\u001b[31mred\u001b[0m", "both changed the same file", "merge was undone", "conflict in x"];

// The fake machine: every call is logged, every answer comes from the pools.
function machine() {
  const log = [];
  const answer = () => ({ code: pick([0, 0, 0, 0, 1, 2]), stdout: pick(STDOUTS), stderr: pick(STDERRS) });
  const io = {
    log,
    step: (text) => log.push(["step", text]),
    job: async (args, opt) => { log.push(["job", args, opt]); return answer(); },
    run: async (args, opt) => { log.push(["run", args, opt]); return answer(); },
    sh: async (script, args = [], on) => { log.push(["sh", script.slice(0, 24), args, on]); return answer(); },
  };
  return io;
}

const item = () => ({ key: "k", kind: pick(["skills", "agents", "hooks", "mcp"]), scope: pick(["project", "global"]), label: "L", name: "n", rel: "r/x", path: pick(["p", "q/r"]),
  disabled: pick([true, false]), declared: true, root: "" });
const requests = () => [
  { op: "sync", scopes: some(2, () => pick(["project", "global"])).concat("global"), plugins: maybe(0.5, () => true), project: "/p", on: maybe(0.3, () => "desk") },
  { op: "update", updates: some(3, () => ({ kind: pick(["skills", "agents"]), scope: pick(["project", "global"]), all: maybe(0.4, () => true), name: "n", label: "L" })), project: "/p" },
  { op: "hook", item: item(), action: pick(["enable", "disable", "remove", "x"]), project: "/p" },
  { op: "toggle", item: item(), action: pick(["enable", "disable", "x"]), project: "/p" },
  { op: "uninstall", item: item(), project: "/p" },
  { op: "syncboth", repo: pick(["/repo", undefined]), on: maybe(0.3, () => "desk") },
  { op: "pull", repo: pick(["/repo", undefined]) },
  { op: "push", commit: maybe(0.5, () => true), message: "m" },
  { op: "resolve", repo: "/repo", push: maybe(0.5, () => true), choices: Object.fromEntries(some(3, () => [pick(FILES), pick(["local", "remote"])])) },
  { op: "pullsync", label: "desk", on: "desk" }, { op: "upgrade", label: "desk", on: "desk" }, { op: "panel", to: "v2", from: "v1" },
  { op: "text", busy: "Reading", args: ["doctor"], title: "T", cwd: pick([undefined, "/c"]) }, { op: "nothing" },
];

test("every request's commands, order and notice", async () => {
  const out = [];
  for (let n = 0; n < 250; n++) {
    for (const req of requests()) {
      const io = machine();
      out.push([req.op, await operate(req, io), io.log]);
    }
  }
  check("operate", out);
});

test("reading a machine's resources, checks, card and previews", async () => {
  const out = [];
  const valid = {
    list: '[{"name":"a","kind":"skill"}]', diff: '{"targets":[{"name":"t","items":[{"name":"a","is_sync":true,"action":"add"}]}]}', status: '{"version":"1.2","source":{"path":"/src"},"targets":[{"name":"t","path":"/t","skills_enabled":false},{"name":"u","path":"/u"}],"agents":{"targets":[{"name":"ag"}],"source":"/ag"}}',
  };
  const reply = (args) => {
    const name = args[0] === "extras" && args[1] === "memory" ? "memory" : args[0];
    const r = R();
    if (r < 0.1) return { code: 1, stdout: "", stderr: "bad" };
    if (r < 0.15) return { code: 0, stdout: "not json", stderr: "" };
    if (r < 0.2) return { code: 0, stdout: "null", stderr: "" };
    if (r < 0.25) return { code: 0, stdout: '{"not":"array"}', stderr: "" };
    return { code: 0, stdout: valid[name] ?? pick(['{"x":1}', "[]", '{"packages":{}}']), stderr: "" };
  };
  const io = () => {
    const log = [];
    return { log,
      job: async (args, opt) => { log.push(["job", args, opt]); return reply(args); },
      run: async (args, opt) => { log.push(["run", args, opt]); return pick([0, 0, 0, 1]) ? reply(args) : { code: 127, stdout: "", stderr: "skillshare not found" }; },
      sh: async (script, args = [], on) => { log.push(["sh", script.slice(0, 20), args, on]); return { code: pick([0, 0, 1]), stdout: pick([...STDOUTS, "top /r\n## main...o/m [ahead 1]\n M a", "norepo", "desk", "/found", "v1.2.3\n", "https://github.com/runkids/skillshare/releases/tag/v1.2.3"]), stderr: pick(STDERRS) }; },
    };
  };
  for (let n = 0; n < 60; n++) {
    const c = io(), snaps = [];
    const result = await loadResources(c, pick([null, "desk"]), pick(["/p", null]), { network: pick([true, false]), progress: (s) => snaps.push(s), previous: pick([{}, { global: { list: [1], took: { list: 1 } } }]) });
    out.push([result, snaps.length, snaps.at(-1), c.log]);
    const k = io();
    out.push([await loadChecks(k, pick([null, "desk"]), pick(["/p", null])), k.log]);
    const m = io();
    out.push([await loadMachine(m, pick([null, "desk"])), m.log]);
    const f = io();
    out.push([await findProject(f, "desk", ["", "/a", "/b"]), await loadLatestRelease(f), f.log]);
  }
  check("loaders", out);
  const previews = [];
  const items = [
    { kind: "mcp", name: "m" }, { kind: "extras", extra: "file", dir: "/d", file: "f.md" }, { kind: "extras", extra: "file", dir: "/d", file: "f.txt" },
    { kind: "extras", extra: "folder", dir: "/d" }, { kind: "extras", sourceMissing: true, dir: "/d", file: "x" }, { kind: "extras", sourceMissing: true, dir: "/d" },
    { kind: "agents", rel: "a/b", label: "b", scope: "global" }, { kind: "skills", rel: "s", label: "s", scope: "project" }, { kind: "skills", rel: "s", label: "s", scope: "global" },
  ];
  const skillText = (n) => `${Array.from({ length: n }, (_, i) => `f${i}.md`).join("\n")}\n@@\n---\nname: S\n---\nbody`;
  const shReply = () => pick([{ code: 0, stdout: skillText(pick([0, 3, 40, 41, 42])) }, { code: 0, stdout: "SKILL.md\nx.md\n@@\n" }, { code: 3, stdout: "" }, { code: 0, stdout: "just text" }, { code: 0, stdout: "name: x\nbody" },
    { code: 0, stdout: "x.md\n@@\n" }, { code: 0, stdout: "SKILL.md\n@@\ntext" }, { code: 0, stdout: "" }]);
  for (let n = 0; n < 40; n++) for (const it of items) {
    const log = [];
    const pio = { run: async (args, opt) => { log.push(["run", args, opt]); return { code: 0, stdout: pick(["", "{}", '{"source":{"path":"/s"},"agents":{"source":"/ag"}}', '{"source":{"path":"/s"}}']) }; },
      sh: async (script, args, on) => { log.push(["sh", script.slice(0, 16), args, on]); return { stderr: "", ...shReply() }; } };
    previews.push([await loadPreview(pio, pick([null, "desk"]), "/p", it, pick([undefined, "/mcp.yaml"])), log]);
  }
  previews.push(await loadFile({ sh: async () => ({ stdout: "---\nk: v\n---\nb" }) }, null, "/d", "a.MD"), await loadFile({ sh: async () => ({ stdout: "plain" }) }, null, "/d", "a.txt"));
  check("loadPreview", previews);
});

test("a job runs to its code, a stopped job and a job past its budget", async () => {
  const out = [];
  for (let n = 0; n < 80; n++) {
    const log = [];
    const start = pick(["/tmp/d", "", "/tmp/d", "/tmp/d"]), startCode = pick([0, 0, 1]);
    const finishAt = pick([1, 2, 3, 30, 100]), alive = pick([0, 1]);
    let polls = 0;
    const runner = createRunner({
      exec: async (script, args, on) => {
        log.push(["exec", script.slice(0, 18), args, on]);
        if (script.startsWith("unset HC")) return { code: startCode, stdout: `${start}\n`, stderr: "" };
        return script.startsWith("[ -s") ? { code: alive, stdout: "", stderr: "" } : { code: 0, stdout: "", stderr: "" };
      },
      readText: async (path) => {
        if (path.endsWith("/code")) return ++polls >= finishAt ? pick(["0", "3\n", " "]) : pick([null, ""]);
        if (path.endsWith("/out")) return pick(["out", null]);
        return pick(["lost\nlast", null, ""]);
      },
      pollMs: 10, aliveEvery: 3, budgetMs: 100,
    });
    const slept = [];
    const a = await runner.job(pick([["x", "y"], []]), { on: pick([null, "desk"]), cwd: pick([null, "/c"]), script: pick([null, "echo"]), sleep: async (ms) => slept.push(ms) });
    const b = await runner.run(["status"], { on: "desk", cwd: "/c" });
    const c = await runner.run(["status"]);
    out.push([a, b, c, log, slept.length]);
  }
  check("job", out);
  const shells = [];
  for (const failing of [[], ["sh"], ["sh", "other"]]) for (const gitOut of [{ code: 0, stdout: "C:\\Program Files\\Git\\mingw64\\libexec\\git-core\n" }, { code: 1, stdout: "" }, null, { code: 0, stdout: "/usr/lib/git-core" }]) {
    const calls = [];
    const shell = withShell(async (cmd, args, on) => {
      calls.push([cmd, args, on]);
      if (cmd === "git") { if (!gitOut) throw new Error("no git"); return gitOut; }
      if (failing.includes(cmd) || (failing.includes("other") && cmd.endsWith("sh.exe"))) throw new Error(`cannot start ${cmd}`);
      return { code: 0, stdout: cmd, stderr: "" };
    });
    const rs = [];
    for (const on of [null, "desk", null]) rs.push(await shell(["-c", "x"], on).catch((e) => `error: ${e.message}`));
    shells.push([rs, calls]);
  }
  check("withShell", shells);
});

test("the channel's requests, locks and notices", () => {
  const store = new Map();
  let now = 1000;
  const ch = createChannel({ get: (k) => store.get(k), set: (k, v) => store.set(k, v), now: () => now, staleMs: 60000 });
  const out = [];
  const next = ch.listen();
  out.push(next());
  ch.request({ op: "x" });
  const first = next();
  out.push(first && first.op, next());
  out.push(ch.claim("a", "t1"), ch.claim("a", "t2"), ch.busyAt("a"), ch.busyAt("b"), ch.textAt("a"), ch.claim(EVERY, "all"), ch.claim("b", "t3"), ch.busyText());
  now += 5000; ch.touch("a"); out.push(JSON.stringify(store.get("skillshare.busy.v1")));
  now += 6000; ch.touch("a"); ch.touch("zz"); out.push(JSON.stringify(store.get("skillshare.busy.v1")));
  ch.step("a", "t4"); out.push(ch.textAt("a")); ch.release("a"); ch.release("b"); out.push(ch.busyText(), ch.claim(EVERY, "all"), ch.busyAt("q"), ch.textAt("q"));
  now += 70000; out.push(ch.busyText(), ch.busyAt("q"));
  store.set("skillshare.busy.v1", "old string"); out.push(ch.busyText());
  ch.say("warn", "careful"); out.push(JSON.stringify(ch.notice())); ch.clearNotice(); out.push(ch.notice());
  check("channel", out);
});

// A machine that answers each call, whatever its kind, from a queue (then with success).
function scripted(answers) {
  const queue = [...answers], log = [];
  const next = (kind, args) => { log.push([kind, ...args.map((a) => (typeof a === "string" ? a.slice(0, 16) : a))]); return Promise.resolve({ code: 0, stdout: "", stderr: "", ...queue.shift() }); };
  return { log, step: (text) => log.push(["step", text]), job: (...a) => next("job", a), run: (...a) => next("run", a), sh: (...a) => next("sh", a) };
}
const STAGES = "@@stage 1\n{}\n@@stage 2\n{\"entries\":{\"a\":{}}}\n@@stage 3\n{\"entries\":{}}";
const STOP = { code: 1, stdout: "both changed" };
const MERGE_OK = [{ stdout: ".metadata.json" }, { stdout: ".metadata.json" }, { stdout: STAGES }, {}, {}];
test("scripted conflicts, merges and mismatched toggles", async () => {
  const out = [];
  const run = async (req, answers) => { const io = scripted(answers); out.push([req.op, await operate(req, io), io.log]); };
  const skill = { kind: "skills", scope: "global", label: "L", path: "p" }, agent = { kind: "agents", scope: "project", label: "L", path: "p" };
  for (const [it, action, list] of [[skill, "disable", '[{"relPath":"p","disabled":false}]'], [skill, "enable", '[{"relPath":"p","disabled":true}]'], [agent, "disable", '[{"kind":"agent","relPath":"p"}]'], [skill, "disable", '[{"relPath":"p","disabled":true}]'], [skill, "enable", "[]"], [skill, "enable", "junk"]]) {
    await run({ op: "toggle", item: it, action, project: "/p" }, [{}, { stdout: list }]);
  }
  for (const op of ["syncboth", "pull"]) {
    const base = { op, repo: "/repo", on: "desk" };
    await run(base, [STOP, ...MERGE_OK, {}, {}]);
    await run(base, [STOP, ...MERGE_OK, {}, { code: 1, stderr: "nope" }]);
    await run(base, [STOP, { stdout: ".metadata.json" }, { stdout: ".metadata.json" }, { stdout: "@@stage 1\n{bad" }, {}]);
    await run(base, [STOP, { stdout: ".metadata.json" }, { stdout: ".metadata.json" }, { stdout: STAGES }, { code: 1, stderr: "denied" }]);
    await run(base, [STOP, { stdout: ".metadata.json" }, { stdout: ".metadata.json" }, { stdout: STAGES }, {}, { code: 1 }]);
    await run(base, [STOP, { stdout: "a.txt\n.metadata.json" }, {}, { stdout: "@@local a.txt\nx\n@@remote a.txt\ny\n" }]);
    await run(base, [STOP, { stdout: "" }]);
    await run(base, [{ code: 1, stderr: "plain failure" }]);
    await run({ op, on: null }, [{ code: 1, stdout: "conflict" }]);
  }
  const resolve = { op: "resolve", repo: "/repo", push: true, choices: { "a.txt": "local" } };
  await run(resolve, [{ stdout: "a.txt" }, {}, {}, {}, {}, {}]);
  await run({ ...resolve, push: false }, [{ stdout: "a.txt" }, {}, {}, {}, {}, {}]);
  await run(resolve, [{ stdout: "a.txt\nb.txt" }, {}, STOP, { stdout: "c.txt" }, {}, {}]);
  await run(resolve, [{ stdout: "a.txt\nb.txt" }, {}, { stdout: "x" }]);
  await run(resolve, [{ stdout: "a.txt" }, { stdout: ".metadata.json" }, { stdout: "@@stage 1\n{bad" }, {}, {}]);
  await run(resolve, [{ stdout: "a.txt" }, {}, {}, { code: 1, stderr: "bad apply" }]);
  await run(resolve, [{ stdout: "a.txt" }, {}, {}, {}, {}, { code: 1 }]);
  check("scripted", out);
});
