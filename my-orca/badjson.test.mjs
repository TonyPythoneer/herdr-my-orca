// A result file that is never valid JSON: handleResult re-reads it 3 times, then rejects the attempt as bad_result.
// Regression for `const result` being reassigned in that retry loop (TypeError crashed the Runner).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runLoop, makeRunnerContext, writeState, readJsonMaybe, resolveConfig } from "./my-orca.mjs";

test("a result file that stays invalid JSON is rejected as bad_result, not a crash", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "badjson-"));
  await fsp.mkdir(path.join(dir, "results"), { recursive: true });
  const g = path.join(dir, ".git");
  const st = {
    run_id: "r1", status: "working", stage: "development", planning: { closed: null },
    profile: { cli: "claude", model: "m", effort: "low" },
    tasks: [{ id: "T-01", kind: "dev", title: "t", test: "true", deps: [], cycle: 0, state: "pending", attempts: [] }],
    acceptance: [{ id: "AC-1", text: "a", verify: "true" }], reviews: [], rework: { cycles: 0 }, dispatch: null,
    repo: { toplevel: dir, branch: "feat", head: "a", stage_head: "a", base_head: "a", dirty_at_start: [], first_commit_seen: false, git_dir: g, common_dir: g },
  };
  await writeState(dir, st);
  let live = null, killed = false, launches = 0;
  const hc = {
    coreId: () => "core", reads: () => ({ code: 0, stdout: "" }), list: () => [],
    get: (address) => {
      if (!live || live.address !== address) return null;
      return { address, state: killed ? "finished" : "live", status: killed ? null : { state: "idle" }, turn: 1, created_ms: 1, labels: live.labels, foreground: { pid: 1 } };
    },
    run: (args) => {
      if (++launches > 4) throw new Error("LOOP");
      const labels = {};
      args.forEach((a, i) => { if (a === "--label") { const [k, v] = args[i + 1].split("="); labels[k] = v; } });
      live = { address: "t1", labels };
      fs.writeFileSync(path.join(dir, "results", `${labels["orca.dispatch"]}.ack`), "");
      fs.writeFileSync(path.join(dir, "results", `${labels["orca.dispatch"]}.json`), "{");
      return { code: 0, json: { address: "t1" }, error: null };
    },
    kill: () => { killed = true; }, rm: () => { live = null; killed = false; },
  };
  const git = { info: () => ({ ok: true, toplevel: dir, git_dir: g, common_dir: g, branch: "feat", head: "a", dirty: [], upstream: "origin/feat", ahead: 0 }), isAncestor: () => true, commitsSince: () => 1, run: () => ({ code: 0, stdout: "", stderr: "" }) };
  const cfg = resolveConfig({ poll_s: 2, ack_timeout_s: 10, dev_timeout_min: 1, tuning_timeout_min: 1, test_timeout_min: 1, stopped_grace_s: 10 }).config;
  const ctx = makeRunnerContext({ stateDir: dir, state: st, hc, git, config: cfg, event: async () => {}, sleep: async () => {}, clock: () => Date.now() });
  await assert.doesNotReject(runLoop(ctx));
  const final = await readJsonMaybe(path.join(dir, "state.json"));
  assert.deepEqual(final.tasks[0].attempts.map((a) => a.reason), ["bad_result", "bad_result"]);
  assert.equal(final.needs_user.code, "task_failed");
});
