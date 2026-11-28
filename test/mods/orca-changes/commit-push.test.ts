import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecResult } from "herdr";
import { commitAndPush } from "../../../src/mods/orca-changes/commit-push.js";

test("failed push reports the successful commit and allows push-only retry", async () => {
  const temp = mkdtempSync(join(tmpdir(), "orca-commit-"));
  const root = join(temp, "work"),
    remote = join(temp, "remote.git");
  mkdirSync(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    writeFileSync(join(root, "file"), "content");
    git("add", "--", "file");
    let message = "first commit";
    const run = async (step: "commit" | "push"): Promise<ExecResult> => {
      const r = spawnSync("git", step === "commit" ? ["commit", "-m", message] : ["push"], {
        cwd: root,
        encoding: "utf8",
      });
      return { code: r.status as number, stdout: r.stdout, stderr: r.stderr };
    };
    await assert.rejects(
      commitAndPush(
        run,
        () => true,
        () => {
          message = "";
        },
      ),
      /Commit succeeded, but push failed:/,
    );
    assert.equal(message, "");
    assert.equal(git("rev-list", "--count", "HEAD"), "1");
    assert.equal(git("status", "--porcelain"), "");
    git("init", "--bare", "-q", remote);
    git("remote", "add", "origin", remote);
    git("push", "-q", "-u", "origin", "HEAD");
    assert.equal(git("rev-list", "--count", "HEAD"), "1");
    assert.equal(git("rev-parse", "HEAD"), git("--git-dir", remote, "rev-parse", "HEAD"));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("commit failure and workspace switch do not push", async () => {
  const steps: string[] = [];
  let cleared = false;
  await assert.rejects(
    commitAndPush(
      async (step) => {
        steps.push(step);
        return { code: 1, stdout: "", stderr: "commit error" };
      },
      () => true,
      () => {
        cleared = true;
      },
    ),
    /commit error/,
  );
  assert.deepEqual(steps, ["commit"]);
  assert.equal(cleared, false);
  steps.length = 0;
  assert.equal(
    await commitAndPush(
      async (step) => {
        steps.push(step);
        return { code: 0, stdout: "", stderr: "" };
      },
      () => false,
      () => {
        cleared = true;
      },
    ),
    false,
  );
  assert.deepEqual(steps, ["commit"]);
  assert.equal(cleared, false);
});

test("reports successful commit and push", async () => {
  assert.equal(
    await commitAndPush(
      async () => ({ code: 0, stdout: "", stderr: "" }),
      () => true,
      () => {},
    ),
    true,
  );
});

test("a rejected push reports partial success", async () => {
  await assert.rejects(
    commitAndPush(
      async (step) => {
        if (step === "push") throw new Error("host unavailable");
        return { code: 0, stdout: "", stderr: "" };
      },
      () => true,
      () => {},
    ),
    /Commit succeeded, but push failed: host unavailable/,
  );
});
