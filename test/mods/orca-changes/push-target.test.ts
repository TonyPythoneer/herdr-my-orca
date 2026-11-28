import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import type { ExecResult } from "herdr";
import {
  displayPushDestination,
  forcePushConfirmed,
  forcePushTarget,
  pushConfigured,
  redactPushOutput,
  resolvePushTarget,
  type PushGit,
} from "../../../src/mods/orca-changes/push-target.js";

const ok = (stdout: string, stderr = ""): ExecResult => ({ code: 0, stdout, stderr });
const fail = (code: number, stdout = "", stderr = ""): ExecResult => ({ code, stdout, stderr });

test("force-push confirmation hides URL credentials and query strings", () => {
  assert.equal(
    displayPushDestination("https://user:secret@example.invalid/repo?token=secret#frag"),
    "https://example.invalid/repo",
  );
  assert.equal(displayPushDestination("user:secret@example.invalid:repo"), "example.invalid:repo");
  assert.equal(displayPushDestination("/tmp/local@repo"), "/tmp/local@repo");
  const secret = "https://user:secret@example.invalid/repo?token=secret";
  assert.equal(redactPushOutput(`failed ${secret}`, secret), "failed https://example.invalid/repo");
  assert.equal(
    redactPushOutput("fatal https://another:password@example.invalid/x?key=secret", secret),
    "fatal https://example.invalid/x",
  );
});

test("push targets only one configured branch and never follows tags", async () => {
  const temp = mkdtempSync(join(tmpdir(), "orca-push-"));
  const root = join(temp, "work"),
    remote = join(temp, "remote.git");
  mkdirSync(root);
  const run = (args: string[], cwd = root) => spawnSync("git", args, { cwd, encoding: "utf8" });
  const git: PushGit = async (args) => {
    const r = run(args);
    return { code: r.status as number, stdout: r.stdout, stderr: r.stderr };
  };
  const must = (...args: string[]) => {
    const r = run(args);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  try {
    must("init", "-q");
    must("config", "user.name", "Test");
    must("config", "user.email", "test@example.invalid");
    writeFileSync(join(root, "file"), "one");
    must("add", "--", "file");
    must("commit", "-qm", "one");
    must("init", "--bare", "-q", remote);
    must("remote", "add", "origin", remote);
    must("push", "-qu", "origin", "HEAD");
    const branch = must("symbolic-ref", "--short", "HEAD");
    must("branch", "other");
    must("push", "-q", "origin", "other");
    must("checkout", "-q", "other");
    must("commit", "--allow-empty", "-qm", "other update");
    must("checkout", "-q", branch);
    writeFileSync(join(root, "file"), "two");
    must("add", "--", "file");
    must("commit", "-qm", "two");
    must("tag", "-a", "new-tag", "-m", "tag");
    must("config", "push.followTags", "true");
    const target = await resolvePushTarget(git);
    assert.equal(target.remote, "origin");
    assert.equal(target.ref, `refs/heads/${branch}`);
    assert.equal((await pushConfigured(git, () => true)).code, 0);
    assert.equal(
      must("--git-dir", remote, "rev-parse", `refs/heads/${branch}`),
      must("rev-parse", "HEAD"),
    );
    assert.notEqual(
      must("--git-dir", remote, "rev-parse", "refs/heads/other"),
      must("rev-parse", "other"),
    );
    assert.notEqual(
      run(["--git-dir", remote, "rev-parse", "--verify", "refs/tags/new-tag"]).status,
      0,
    );
    must("push", "-q", "origin", "other");
    const divergent = must("rev-parse", "other");
    must("--git-dir", remote, "update-ref", `refs/heads/${branch}`, divergent);
    assert.notEqual((await pushConfigured(git, () => true)).code, 0);
    assert.equal(must("--git-dir", remote, "rev-parse", `refs/heads/${branch}`), divergent);
    must("--git-dir", remote, "update-ref", "refs/heads/other", must("rev-parse", "HEAD~1"));
    must("--git-dir", remote, "update-ref", "-d", "refs/tags/new-tag");
    must("config", "remote.origin.mirror", "true");
    await assert.rejects(
      pushConfigured(git, () => true),
      /Mirror/,
    );
    assert.equal(must("--git-dir", remote, "rev-parse", `refs/heads/${branch}`), divergent);
    assert.notEqual(
      must("--git-dir", remote, "rev-parse", "refs/heads/other"),
      must("rev-parse", "other"),
    );
    assert.notEqual(
      run(["--git-dir", remote, "rev-parse", "--verify", "refs/tags/new-tag"]).status,
      0,
    );
    must("config", "--unset", "remote.origin.mirror");
    must("config", "remote.origin.push", "HEAD:refs/heads/review");
    await assert.rejects(
      resolvePushTarget(git),
      /Custom push refspec|single configured push target/,
    );
    must("config", "--add", "remote.origin.push", "other:refs/heads/other");
    await assert.rejects(
      resolvePushTarget(git),
      /Custom push refspec|single configured push target/,
    );
    must("config", "--unset-all", "remote.origin.push");
    must("config", "push.default", "matching");
    await assert.rejects(resolvePushTarget(git), /push policy|single configured push target/);
    must("config", "--unset", "push.default");
    must("config", "--add", `branch.${branch}.merge`, "refs/heads/other");
    await assert.rejects(resolvePushTarget(git), /multiple upstreams/);
    must("config", "--unset-all", `branch.${branch}.merge`);
    must("config", `branch.${branch}.merge`, `refs/heads/${branch}`);
    must("remote", "set-url", "--add", "--push", "origin", remote);
    must("remote", "set-url", "--add", "--push", "origin", join(temp, "another"));
    await assert.rejects(resolvePushTarget(git), /multiple destinations/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("push cancels before any write if the workspace or target changes", async () => {
  let round = 0,
    pushes = 0;
  const git: PushGit = async (args) => {
    if (args[0] === "push") {
      pushes++;
      return ok("");
    }
    if (args[0] === "symbolic-ref") return ok("refs/heads/main\n");
    if (args[0] === "for-each-ref")
      return ok(`refs/heads/main\0origin\0refs/heads/${round++ ? "different" : "main"}\0\0\0\0\n`);
    if (args[0] === "remote") return ok("local-remote\n");
    if (args[0] === "config") return fail(1);
    return ok(`${"a".repeat(40)}\n`);
  };
  await assert.rejects(
    pushConfigured(git, () => true),
    /changed/,
  );
  assert.equal(pushes, 0);
  await assert.rejects(
    pushConfigured(git, () => false),
    /changed/,
  );
  assert.equal(pushes, 0);
});

test("a changed push URL cancels before any write", async () => {
  let urlReads = 0,
    pushes = 0;
  const git: PushGit = async (args) => {
    if (args[0] === "push") {
      pushes++;
      return ok("");
    }
    if (args[0] === "symbolic-ref") return ok("refs/heads/main\n");
    if (args[0] === "for-each-ref") return ok("refs/heads/main\0origin\0refs/heads/main\0\0\0\0\n");
    if (args[0] === "config") return fail(1);
    if (args[0] === "remote") return ok(urlReads++ ? "remote-b\n" : "remote-a\n");
    return ok(`${"a".repeat(40)}\n`);
  };
  await assert.rejects(
    pushConfigured(git, () => true),
    /changed/,
  );
  assert.equal(pushes, 0);
});

test("push failures do not expose the configured URL credentials", async () => {
  const destination = "https://user:secret@example.invalid/repo?token=secret";
  const git: PushGit = async (args) => {
    if (args[0] === "push") return fail(1, "", `rejected ${destination}`);
    if (args[0] === "symbolic-ref") return ok("refs/heads/main\n");
    if (args[0] === "for-each-ref") return ok("refs/heads/main\0origin\0refs/heads/main\0\0\0\0\n");
    if (args[0] === "config") return fail(1);
    if (args[0] === "remote") return ok(`${destination}\n`);
    return ok(`${"a".repeat(40)}\n`);
  };
  const result = await pushConfigured(git, () => true);
  assert.equal(result.code, 1);
  assert.equal(result.stderr, "rejected https://example.invalid/repo");
});

test("confirmed force push uses an exact lease and cannot overwrite an advanced remote", async () => {
  const temp = mkdtempSync(join(tmpdir(), "orca-force-"));
  const root = join(temp, "work"),
    remote = join(temp, "remote.git");
  mkdirSync(root);
  const run = (args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const git: PushGit = async (args) => {
    const r = run(args);
    return { code: r.status as number, stdout: r.stdout, stderr: r.stderr };
  };
  const must = (...args: string[]) => {
    const r = run(args);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  try {
    must("init", "-q");
    must("config", "user.name", "Test");
    must("config", "user.email", "test@example.invalid");
    must("commit", "--allow-empty", "-qm", "base");
    must("init", "--bare", "-q", remote);
    must("remote", "add", "origin", remote);
    must("push", "-qu", "origin", "HEAD");
    const branch = must("symbolic-ref", "--short", "HEAD"),
      base = must("rev-parse", "HEAD");
    must("branch", "other");
    must("checkout", "-q", "other");
    must("commit", "--allow-empty", "-qm", "remote update");
    must("push", "-q", "origin", "other");
    const advanced = must("rev-parse", "HEAD");
    must("checkout", "-q", branch);
    must("commit", "--allow-empty", "-qm", "local update");
    const target = await forcePushTarget(git);
    assert.equal(target.expected, base);
    must("--git-dir", remote, "update-ref", target.ref, advanced);
    const rejected = await forcePushConfirmed(git, target, () => true);
    assert.notEqual(rejected.code, 0);
    assert.equal(must("--git-dir", remote, "rev-parse", target.ref), advanced);
    await assert.rejects(
      forcePushConfirmed(git, target, () => false),
      /cancelled/,
    );
    must("update-ref", target.leaseTracking as string, advanced);
    await assert.rejects(
      forcePushConfirmed(git, target, () => true),
      /changed/,
    );
    assert.equal(must("--git-dir", remote, "rev-parse", target.ref), advanced);
    must("update-ref", target.leaseTracking as string, base);
    must("--git-dir", remote, "update-ref", target.ref, base);
    assert.equal((await forcePushConfirmed(git, target, () => true)).code, 0);
    assert.equal(must("--git-dir", remote, "rev-parse", target.ref), target.oid);
    assert.equal(must("--git-dir", remote, "rev-parse", "refs/heads/other"), advanced);
    must("commit", "--allow-empty", "-qm", "changed after confirmation");
    await assert.rejects(
      forcePushConfirmed(git, target, () => true),
      /changed/,
    );
    assert.equal(must("--git-dir", remote, "rev-parse", target.ref), target.oid);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
