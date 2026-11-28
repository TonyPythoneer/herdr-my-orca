import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadDiff, type Exec, type ExecOptions } from "../../../src/mods/orca-diff/diff-data.js";
import { diffRows } from "../../../src/mods/orca-diff/diff-rows.js";

const gitExec: Exec = async (cmd, args, opts: ExecOptions) => {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, encoding: "utf8" });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
};

test("unborn and committed repositories show the requested staged, unstaged and untracked data", async () => {
  const root = mkdtempSync(join(tmpdir(), "orca-diff-"));
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    const special = ":(glob)*",
      untracked = "-新 file.txt";
    writeFileSync(join(root, special), "staged content\n");
    writeFileSync(join(root, "other"), "other content\n");
    git("add", "--", ".");
    writeFileSync(join(root, special), "unstaged content\n");
    writeFileSync(join(root, untracked), "untracked content\n");
    const target = { root, on: null };
    const all = await loadDiff({ ...target, all: true }, gitExec);
    assert.ok(all.includes("No initial commit: staged and unstaged changes are shown separately"));
    assert.ok(all.includes("Staged changes") && all.includes("Unstaged changes"));
    assert.ok(
      all.includes("+staged content") &&
        all.includes("+unstaged content") &&
        all.includes("+untracked content"),
    );
    const staged = await loadDiff(
      { ...target, path: special, section: "staged", status: "A" },
      gitExec,
    );
    assert.ok(staged.includes("+staged content"));
    assert.ok(!staged.includes("+other content"));
    const unstaged = await loadDiff(
      { ...target, path: special, section: "changes", status: "M" },
      gitExec,
    );
    assert.ok(unstaged.includes("-staged content") && unstaged.includes("+unstaged content"));
    const fresh = await loadDiff(
      { ...target, path: untracked, section: "changes", status: "U" },
      gitExec,
    );
    assert.ok(fresh.includes("+untracked content"));
    git("commit", "-qm", "first");
    const committed = await loadDiff({ ...target, all: true }, gitExec);
    assert.ok(!committed.some((line) => line.startsWith("No initial commit")));
    assert.ok(committed.includes("+unstaged content") && committed.includes("+untracked content"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("all-changes preview explicitly reports omitted untracked files", async () => {
  const root = mkdtempSync(join(tmpdir(), "orca-diff-limit-"));
  try {
    assert.equal(spawnSync("git", ["init", "-q", root]).status, 0);
    for (let i = 0; i < 22; i++) writeFileSync(join(root, `file-${i}`), `${i}\n`);
    const lines = await loadDiff({ root, on: null, all: true }, gitExec);
    assert.ok(lines.includes("… 2 untracked file(s) omitted from preview"));
    assert.equal(lines.filter((line) => line.startsWith("diff --git ")).length, 20);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("empty untracked files and vanished files do not look like no changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "orca-diff-empty-"));
  try {
    assert.equal(spawnSync("git", ["init", "-q", root]).status, 0);
    const all = { root, on: null, all: true };
    assert.ok((await loadDiff(all, gitExec)).includes("No changes"));
    writeFileSync(join(root, "empty"), "");
    assert.ok((await loadDiff(all, gitExec)).includes("Untracked empty file: empty"));
    assert.deepEqual(
      await loadDiff({ root, on: null, path: "empty", status: "U", section: "changes" }, gitExec),
      ["Untracked empty file: empty"],
    );
    await assert.rejects(
      loadDiff({ root, on: null, path: "missing", status: "U", section: "changes" }, gitExec),
      /access|No such/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("binary and long untracked diffs show their limitations", async () => {
  const root = mkdtempSync(join(tmpdir(), "orca-diff-binary-"));
  try {
    assert.equal(spawnSync("git", ["init", "-q", root]).status, 0);
    writeFileSync(join(root, "binary"), Buffer.from([0, 1, 2]));
    writeFileSync(
      join(root, "large"),
      `${Array.from({ length: 6000 }, (_, i) => `line-${i}`).join("\n")}\n`,
    );
    const binary = await loadDiff(
      { root, on: null, path: "binary", status: "U", section: "changes" },
      gitExec,
    );
    assert.ok(binary.includes("Binary file · no text diff"));
    const all = await loadDiff({ root, on: null, all: true }, gitExec);
    assert.ok(all.includes("Binary file · no text diff"));
    assert.equal(all.at(-1), "… diff cut at 5000 lines");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("all-changes labels preserve ambiguous and Git-quoted real file names", async () => {
  const root = mkdtempSync(join(tmpdir(), "orca-diff-names-"));
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    mkdirSync(join(root, "folder b"));
    for (const name of ["folder b/file.txt", "line\nbreak.txt", "中文.txt"])
      writeFileSync(join(root, name), "before\n");
    git("add", "--", ".");
    git("commit", "-qm", "base");
    for (const name of ["folder b/file.txt", "line\nbreak.txt", "中文.txt"])
      writeFileSync(join(root, name), "after\n");
    const labels = diffRows(await loadDiff({ root, on: null, all: true }, gitExec))
      .filter((r) => r.kind === "F")
      .map((r) => r.text);
    assert.deepEqual(labels, ["folder b/file.txt", '"line\\nbreak.txt"', "中文.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("section previews contain only selected staged or unstaged plus untracked changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "orca-section-"));
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    for (const path of [":(glob)*", "staged", "other"])
      writeFileSync(join(root, path), `base ${path}\n`);
    git("add", "--", ".");
    git("commit", "-qm", "base");
    writeFileSync(join(root, ":(glob)*"), "index version\n");
    writeFileSync(join(root, "staged"), "staged only\n");
    git("--literal-pathspecs", "add", "--", ":(glob)*", "staged");
    writeFileSync(join(root, ":(glob)*"), "working version\n");
    writeFileSync(join(root, "other"), "unselected change\n");
    writeFileSync(join(root, "new"), "untracked content\n");
    const staged = await loadDiff(
      { root, on: null, sectionAll: true, section: "staged", paths: [":(glob)*", "staged"] },
      gitExec,
    );
    assert.ok(staged.includes("+index version") && staged.includes("+staged only"));
    assert.ok(
      !staged.includes("+working version") &&
        !staged.includes("+untracked content") &&
        !staged.includes("+unselected change"),
    );
    const changesTarget = {
      root,
      on: null,
      sectionAll: true,
      section: "changes",
      paths: [":(glob)*", "new"],
      limited: true,
    };
    const changes = await loadDiff(changesTarget, gitExec);
    assert.ok(
      changes.includes("-index version") &&
        changes.includes("+working version") &&
        changes.includes("+untracked content"),
    );
    assert.ok(!changes.includes("+staged only") && !changes.includes("+unselected change"));
    assert.ok(changes.includes("Only the files shown in Source Control are included"));
    git("add", "--", "new");
    const refreshed = await loadDiff(changesTarget, gitExec);
    assert.ok(!refreshed.includes("+untracked content"));
    unlinkSync(join(root, ":(glob)*"));
    mkdirSync(join(root, ":(glob)*"));
    writeFileSync(join(root, ":(glob)*", "child"), "new child outside selected file\n");
    await assert.rejects(loadDiff(changesTarget, gitExec), /became a directory/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("section preview shows untracked file limits in an unborn repository", async () => {
  const root = mkdtempSync(join(tmpdir(), "orca-section-limit-"));
  try {
    assert.equal(spawnSync("git", ["init", "-q", root]).status, 0);
    const paths = Array.from({ length: 22 }, (_, i) => `file-${i}`);
    for (const path of paths) writeFileSync(join(root, path), `${path}\n`);
    const lines = await loadDiff(
      { root, on: null, sectionAll: true, section: "changes", paths },
      gitExec,
    );
    assert.ok(lines.includes("… 2 untracked file(s) omitted from preview"));
    assert.equal(lines.filter((line) => line.startsWith("diff --git ")).length, 20);
    assert.deepEqual(
      await loadDiff({ root, on: null, sectionAll: true, section: "staged", paths }, gitExec),
      ["No changes"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
