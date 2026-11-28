import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { queueSave } from "../../../mods/orca-files/save-queue.js";

test("autosave and leaving are serialized against the last successful snapshot", async () => {
  const doc = { full: "/file", disk: "original" }, calls = [];
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const write = async (path, text, expected) => {
    calls.push({ path, text, expected });
    if (text === "first") await wait;
  };
  const first = queueSave(doc, "first", write);
  await Promise.resolve();
  const last = queueSave(doc, "last", write);
  assert.equal(calls.length, 1);
  release(); await Promise.all([first, last]);
  assert.deepEqual(calls.map((c) => [c.text, c.expected]), [["first", "original"], ["last", "first"]]);
  assert.equal(doc.disk, "last");
});

test("reverting while a save is pending still writes the reverted text", async () => {
  const doc = { full: "/file", disk: "original" }, writes = [];
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const write = async (_path, text, expected) => { writes.push([text, expected]); if (text === "new") await wait; };
  const first = queueSave(doc, "new", write); await Promise.resolve();
  const revert = queueSave(doc, "original", write);
  release(); await Promise.all([first, revert]);
  assert.deepEqual(writes, [["new", "original"], ["original", "new"]]);
});

test("a conflict blocks queued writes and leaves the original snapshot intact", async () => {
  const doc = { full: "/file", disk: "original" }; let attempts = 0;
  const write = async () => { attempts++; throw new Error("external change"); };
  const first = queueSave(doc, "first", write), second = queueSave(doc, "last", write);
  await assert.rejects(first, /external change/);
  await assert.rejects(second, /external change/);
  assert.equal(attempts, 1); assert.equal(doc.disk, "original");
});
