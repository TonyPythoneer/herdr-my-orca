import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { errorText, sameRun, tail, timeLabel } from "../../../src/mods/orca-agent-settings/util.ts";

test("errorText reads messages, strings and nothing", () => {
  assert.equal(errorText(new Error("boom")), "boom");
  assert.equal(errorText("plain"), "plain");
  assert.equal(errorText(null), "unknown error");
});

test("tail keeps the end of long text", () => {
  assert.equal(tail("  short  "), "short");
  assert.equal(tail("abcdef", 3), "…def");
  assert.equal(tail(undefined), "");
});

test("timeLabel says when nothing was checked", () => {
  assert.equal(timeLabel(0), "Not checked yet");
  assert.match(timeLabel(Date.UTC(2026, 0, 1)), /^Checked \d\d:\d\d:\d\d$/);
});

test("sameRun compares argv element by element", () => {
  assert.equal(sameRun(["a", "b"], ["a", "b"]), true);
  assert.equal(sameRun(["a"], ["a", "b"]), false);
  assert.equal(sameRun(["a", "b"], ["a", "c"]), false);
});
