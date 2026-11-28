import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { sameOperationTarget } from "../../../src/mods/orca-changes/operation-target.js";
import { chunkPaths, GIT_OPTIONS } from "../../../src/mods/orca-changes/git-options.js";

test("discard only acts on the captured repository and host", () => {
  const temp = mkdtempSync(join(tmpdir(), "orca-target-"));
  try {
    const root = join(temp, "first"),
      other = join(temp, "second");
    for (const dir of [root, other]) {
      assert.equal(spawnSync("git", ["init", "-q", dir]).status, 0);
      writeFileSync(join(dir, "untracked"), dir);
    }
    const target = { root, on: "host-a", context: "workspace-a" };
    const run = (current: { root: string; on: string; context: string; activeContext: string }) => {
      if (sameOperationTarget(target, current))
        return spawnSync("git", ["clean", "-f", "--", "untracked"], { cwd: current.root }).status;
      return null;
    };
    assert.equal(
      run({ root: other, on: "host-b", context: "workspace-b", activeContext: "workspace-b" }),
      null,
    );
    assert.equal(run({ ...target, activeContext: "workspace-b" }), null);
    assert.equal(run({ ...target, on: "host-b", activeContext: target.context }), null);
    assert.equal(readFileSync(join(root, "untracked"), "utf8"), root);
    assert.equal(readFileSync(join(other, "untracked"), "utf8"), other);
    assert.equal(run({ ...target, activeContext: target.context }), 0);
    assert.equal(readFileSync(join(other, "untracked"), "utf8"), other);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("literal Git pathspec does not expand a file name into other targets", () => {
  const root = mkdtempSync(join(tmpdir(), "orca-pathspec-"));
  try {
    assert.equal(spawnSync("git", ["init", "-q", root]).status, 0);
    const magic = ":(glob)*";
    writeFileSync(join(root, magic), "remove");
    writeFileSync(join(root, "keep"), "keep");
    assert.equal(
      spawnSync("git", [...GIT_OPTIONS, "clean", "-f", "--", magic], { cwd: root }).status,
      0,
    );
    assert.equal(existsSync(join(root, magic)), false);
    assert.equal(readFileSync(join(root, "keep"), "utf8"), "keep");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("path batches respect count and conservative byte limits", () => {
  const paths = [
    ...Array.from({ length: 205 }, (_, i) => `path-${i}`),
    ...Array(8).fill("長".repeat(1000)),
  ];
  const batches = chunkPaths(paths);
  assert.deepEqual(batches.flat(), paths);
  assert.ok(
    batches.every(
      (batch) => batch.length <= 200 && batch.reduce((n, p) => n + p.length * 3 + 1, 0) <= 16000,
    ),
  );
});
