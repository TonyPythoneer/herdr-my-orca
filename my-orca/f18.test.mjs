// F18: the happy path against real git (a temp repo with a bare upstream); only hc is fake. The fake worker
// really commits (and pushes, unless told not to), so acceptance and the unpushed check are exercised for real.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runLoop, makeRunnerContext, makeGit, writeState, readJsonMaybe, resolveConfig } from "./my-orca.mjs";

const sh = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

async function run({ push }) {
  const base = fs.realpathSync(await fsp.mkdtemp(path.join(os.tmpdir(), "f18-")));
  const repo = path.join(base, "repo"), remote = path.join(base, "remote.git"), stateDir = path.join(base, "state");
  await fsp.mkdir(path.join(stateDir, "results"), { recursive: true });
  sh(base, "init", "--bare", remote);
  sh(base, "init", "-b", "feat", repo);
  sh(repo, "config", "user.email", "t@example.com");
  sh(repo, "config", "user.name", "T");
  fs.writeFileSync(path.join(repo, "README.md"), "x\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-m", "base");
  sh(repo, "remote", "add", "origin", remote);
  sh(repo, "push", "-u", "origin", "feat");
  const head0 = sh(repo, "rev-parse", "HEAD");
  const g = path.join(repo, ".git");
  const st = {
    run_id: "r1", status: "working", stage: "development", planning: { closed: null },
    profile: { cli: "claude", model: "m", effort: "low" },
    tasks: [{ id: "T-01", kind: "dev", title: "t", test: "test -f ok.txt", deps: [], cycle: 0, state: "pending", attempts: [] }],
    acceptance: [{ id: "AC-1", text: "a", verify: "test -f ok.txt" }], reviews: [], rework: { cycles: 0 }, dispatch: null,
    repo: { toplevel: repo, branch: "feat", head: head0, stage_head: head0, base_head: head0, dirty_at_start: [], first_commit_seen: false, git_dir: g, common_dir: g },
  };
  await writeState(stateDir, st);

  let live = null, killed = false, launches = 0;
  const hc = {
    coreId: () => "core", reads: () => ({ code: 0, stdout: "" }), list: () => [],
    get: (address) => (live && live.address === address
      ? { address, state: killed ? "finished" : "live", status: killed ? null : { state: "idle" }, turn: 1, created_ms: 1, labels: live.labels, foreground: { pid: 1 } }
      : null),
    run: (args) => {
      if (++launches > 1) throw new Error("STOP"); // the task is settled; cut the run at the Tuning launch
      const labels = {};
      args.forEach((a, i) => { if (a === "--label") { const [k, v] = args[i + 1].split("="); labels[k] = v; } });
      const id = labels["orca.dispatch"];
      live = { address: "t1", labels };
      fs.writeFileSync(path.join(stateDir, "results", `${id}.ack`), "");
      fs.writeFileSync(path.join(repo, "ok.txt"), "ok");
      sh(repo, "add", "-A");
      sh(repo, "commit", "-m", "orca(T-01): done");
      if (push) sh(repo, "push");
      fs.writeFileSync(path.join(stateDir, "results", `${id}.json`), JSON.stringify({ dispatch: id, task: "T-01", status: "done", summary: "x", commits: [], test: { cmd: "x", exit: 0 } }));
      return { code: 0, json: { address: "t1" }, error: null };
    },
    kill: () => { killed = true; }, rm: () => { live = null; killed = false; },
  };
  const cfg = resolveConfig({ poll_s: 2, ack_timeout_s: 10, dev_timeout_min: 1, tuning_timeout_min: 1, test_timeout_min: 1, stopped_grace_s: 10 }).config;
  const ctx = makeRunnerContext({ stateDir, state: st, hc, git: makeGit(), config: cfg, event: async () => {}, sleep: async () => {}, clock: () => Date.now() });
  await runLoop(ctx).catch((e) => { if (e.message !== "STOP") throw e; });
  return { final: await readJsonMaybe(path.join(stateDir, "state.json")), head: sh(repo, "rev-parse", "HEAD"), head0 };
}

test("F18: a committed and pushed task is accepted, and its head becomes the baseline", async () => {
  const { final, head, head0 } = await run({ push: true });
  assert.notEqual(head, head0);
  assert.equal(final.tasks[0].state, "accepted");
  assert.equal(final.repo.head, head);
});

test("F18: a committed but unpushed task stops with needs_user(unpushed)", async () => {
  const { final } = await run({ push: false });
  assert.equal(final.status, "needs_user");
  assert.equal(final.needs_user.code, "unpushed");
  assert.notEqual(final.tasks[0].state, "accepted");
});
