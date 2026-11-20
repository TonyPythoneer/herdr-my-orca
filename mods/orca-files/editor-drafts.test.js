import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { queueSave } from "./save-queue.js";

function fixture(write, check = async () => true) {
  let disk = "disk", jobs = [];
  const calls = [];
  const source = readFileSync(new URL("./main.js", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "").replace("export default class Files", "class Files");
  const scope = {
    View: class {}, queueSave, canEditPath: check, exec: async () => ({ code: 0 }),
    writeEditorFile: (doc, text, expected, _exec, writer) => writer(doc.full, text, expected),
    writeTextFile: (...args) => write(...args, (text) => { disk = text; }),
    readTextFile: async () => disk, spaces: () => [{ active: true, folder: "/repo", machine: null, id: "space" }],
    run: (cmd) => calls.push(cmd), theme: () => ({}), settings: () => ({}),
    EditorState: { new: ({ value, readonly }) => ({ value: () => value, readonly, on() {}, release() {} }) },
  };
  vm.runInNewContext(source + "\nglobalThis.Files = Files;", scope);
  const view = new scope.Files();
  const context = { key: JSON.stringify({ cwd: "/repo", on: null, space: "space" }), cwd: "/repo", on: null };
  Object.assign(view, { root: "/repo", on: null, context, drafts: new Map(), file: "a", doc: { full: "/repo/a", disk: "disk", ver: 1 },
    code: { value: () => "unsaved", release() {} }, refresh() {} });
  const cx = { notify() {}, spawn(fn) { const p = Promise.resolve().then(() => fn(cx)); jobs.push(p); return p; } };
  const settle = async () => { const current = jobs; jobs = []; await Promise.allSettled(current); };
  return { view, cx, calls, settle, setDisk(value) { disk = value; } };
}

test("a failed leave preserves the complete draft for read-only recovery", async () => {
  const f = fixture(async () => { throw new Error("external change"); });
  f.view.show("other", f.cx); await f.settle();
  await Promise.resolve();
  f.setDisk("external");
  f.view.show("a", f.cx); await f.settle();
  assert.equal(f.view.code.value(), "unsaved");
  assert.equal(f.view.code.readonly, true);
  assert.match(f.view.fileError, /Unsaved draft.*external change/);
});

test("an outside-workspace file is shown read-only without a writable document", async () => {
  const f = fixture(async () => {}, async (_root, full) => full.startsWith("/repo/"));
  f.view.show("/outside/file", f.cx); await f.settle();
  assert.equal(f.view.code.readonly, true);
  assert.equal(f.view.doc, null);
  assert.match(f.view.fileError, /outside the workspace/);
});

test("a pending draft reloads as editable when its save succeeds", async () => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const f = fixture(async (_path, text, _expected, setDisk) => { await wait; setDisk(text); });
  f.view.show("other", f.cx); await f.settle();
  f.view.show("a", f.cx); await f.settle();
  assert.equal(f.view.code.readonly, true);
  release();
  await f.view.doc?.queue; await new Promise((resolve) => setImmediate(resolve));
  assert.ok(f.calls.includes("orca-files.refresh"));
  f.view.command("refresh", f.cx); await f.settle();
  assert.equal(f.view.code.value(), "unsaved");
  assert.equal(f.view.code.readonly, false);
});
