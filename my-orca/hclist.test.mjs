// hc.list must not turn "hc ls failed" into "no terminals": reconcile would read that as a gone worker.
import test from "node:test";
import assert from "node:assert/strict";
import { makeHc, HcError } from "./my-orca.mjs";

test("hc.list throws HcError when `hc ls` fails", () => {
  const hc = makeHc({ exec: () => ({ code: 1, stdout: "", stderr: "core down" }) });
  assert.throws(() => hc.list({ "orca.run": "r1" }), HcError);
});

test("hc.list returns [] when `hc ls` succeeds with no terminals", () => {
  const hc = makeHc({ exec: () => ({ code: 0, stdout: '{"terminals":[]}', stderr: "" }) });
  assert.deepEqual(hc.list({ "orca.run": "r1" }), []);
});
