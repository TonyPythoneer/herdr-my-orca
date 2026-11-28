import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  assertDiscardUnchanged,
  discardSnapshot,
  type SnapshotExec,
} from "../../../src/mods/orca-changes/discard-snapshot.js";

const runExec: SnapshotExec = async (cmd, args, opts) => {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, encoding: "utf8" });
  return { code: r.status as number, stdout: r.stdout, stderr: r.stderr };
};

test("snapshot detects working content and index changes even when status stays modified", async () => {
  const root = mkdtempSync(join(tmpdir(), "orca-snapshot-"));
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  const exec = runExec;
  try {
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    const name = ":(glob) file\n.bin",
      other = "untracked";
    writeFileSync(join(root, name), Buffer.from([0, 1, 2]));
    git("add", "--", ".");
    git("commit", "-qm", "base");
    writeFileSync(join(root, name), Buffer.from([0, 3, 4]));
    writeFileSync(join(root, other), "before");
    const target = { root, on: "host" },
      paths = [name, other];
    const before = await discardSnapshot(target, paths, exec);
    assert.equal(await discardSnapshot(target, paths, exec), before);
    await assertDiscardUnchanged(target, paths, before, exec);
    writeFileSync(join(root, name), Buffer.from([0, 5, 6]));
    assert.notEqual(await discardSnapshot(target, paths, exec), before);
    await assert.rejects(assertDiscardUnchanged(target, paths, before, exec), /changed/);
    assert.deepEqual(readFileSync(join(root, name)), Buffer.from([0, 5, 6]));
    writeFileSync(join(root, name), Buffer.from([0, 3, 4]));
    git("--literal-pathspecs", "add", "--", name);
    assert.notEqual(await discardSnapshot(target, paths, exec), before);
    writeFileSync(join(root, other), "after");
    assert.notEqual(await discardSnapshot(target, paths, exec), before);
    unlinkSync(join(root, other));
    symlinkSync("missing", join(root, other));
    await assert.rejects(discardSnapshot(target, paths, exec), /Symbolic link/);
    mkdirSync(join(root, "nested"));
    symlinkSync(root, join(root, "nested", "link"));
    await assert.rejects(discardSnapshot(target, ["nested/link/anything"], exec), /Unsafe/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cleaning a selected untracked file preserves ignored and unrelated files", () => {
  const root = mkdtempSync(join(tmpdir(), "orca-clean-"));
  try {
    assert.equal(spawnSync("git", ["init", "-q", root]).status, 0);
    writeFileSync(join(root, ".gitignore"), "ignored\n");
    writeFileSync(join(root, "ignored"), "keep");
    writeFileSync(join(root, "other"), "keep");
    writeFileSync(join(root, "selected"), "delete");
    assert.equal(
      spawnSync("git", ["--literal-pathspecs", "clean", "-f", "--", "selected"], { cwd: root })
        .status,
      0,
    );
    assert.equal(existsSync(join(root, "selected")), false);
    assert.equal(readFileSync(join(root, "ignored"), "utf8"), "keep");
    assert.equal(readFileSync(join(root, "other"), "utf8"), "keep");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discard snapshot rejects a symlink repository root", async () => {
  const temp = mkdtempSync(join(tmpdir(), "orca-repo-link-"));
  const root = join(temp, "repo"),
    link = join(temp, "link");
  try {
    assert.equal(spawnSync("git", ["init", "-q", root]).status, 0);
    writeFileSync(join(root, "file"), "content");
    symlinkSync(root, link);
    const exec = runExec;
    await assert.rejects(discardSnapshot({ root: link, on: null }, ["file"], exec), /Unsafe/);
    await assert.rejects(discardSnapshot({ root: `${link}/`, on: null }, ["file"], exec), /Unsafe/);
    assert.equal(readFileSync(join(root, "file"), "utf8"), "content");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("a changed index aborts a staged batch before reset", async () => {
  const root = mkdtempSync(join(tmpdir(), "orca-stage-"));
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const exec = runExec;
  try {
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    writeFileSync(join(root, "a"), "base a");
    writeFileSync(join(root, "b"), "base b");
    git("add", "--", ".");
    git("commit", "-qm", "base");
    writeFileSync(join(root, "a"), "staged a");
    writeFileSync(join(root, "b"), "staged b");
    git("add", "--", ".");
    const target = { root, on: null },
      paths = ["a", "b"];
    const snapshot = await discardSnapshot(target, paths, exec);
    writeFileSync(join(root, "b"), "new staged b");
    git("add", "--", "b");
    const indexBefore = git("diff", "--cached", "--binary"),
      contentBefore = readFileSync(join(root, "a"), "utf8");
    await assert.rejects(
      (async () => {
        await assertDiscardUnchanged(target, paths, snapshot, exec);
        git("reset", "--quiet", "--", ...paths);
      })(),
      /changed/,
    );
    assert.equal(git("diff", "--cached", "--binary"), indexBefore);
    assert.equal(readFileSync(join(root, "a"), "utf8"), contentBefore);
    assert.equal(readFileSync(join(root, "b"), "utf8"), "new staged b");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
