import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync, existsSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { mutateFile } from "./file-mutation.js";

test("file actions reject escapes and collisions without modifying files", async () => {
  const temp = mkdtempSync(join(tmpdir(), "orca-mutate-"));
  try {
    const root = join(temp, "workspace"), outside = join(temp, "outside");
    mkdirSync(root); mkdirSync(outside);
    writeFileSync(join(root, "existing"), "keep");
    writeFileSync(join(outside, "external"), "outside");
    symlinkSync(outside, join(root, "link"));
    const loc = { cwd: root, on: "host-a", space: "space-a" };
    const calls = [];
    const exec = async (cmd, args, opts) => {
      calls.push(opts);
      const r = spawnSync(cmd, args, { encoding: "utf8" });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    };
    const file = { ...loc, mode: "touch", full: root };
    for (const name of ["", " ", ".", "..", "../bad", "a/b", "a\\b"]) {
      await assert.rejects(mutateFile(file, loc, name, exec), /valid file name/);
    }
    await assert.rejects(mutateFile(file, { ...loc, on: "host-b" }, "new", exec), /changed/);
    assert.equal(calls.length, 0);
    await assert.rejects(mutateFile(file, loc, "existing", exec), /already exists/);
    await assert.rejects(mutateFile({ ...file, full: join(root, "link") }, loc, "new", exec), /Unsafe/);
    await assert.rejects(mutateFile({ ...file, mode: "mv", full: join(root, "link") }, loc, "moved-link", exec), /symbolic link/);
    await assert.rejects(mutateFile({ ...file, full: join(temp, "outside") }, loc, "new", exec), /Invalid/);
    const linkedRoot = join(temp, "linked-root"); symlinkSync(outside, linkedRoot);
    const linkedLocation = { ...loc, cwd: linkedRoot };
    await assert.rejects(mutateFile({ ...linkedLocation, mode: "touch", full: linkedRoot }, linkedLocation, "new", exec), /Unsafe/);
    const trailingLocation = { ...linkedLocation, cwd: `${linkedRoot}/` };
    await assert.rejects(mutateFile({ ...trailingLocation, mode: "touch", full: linkedRoot }, trailingLocation, "new", exec), /Unsafe/);
    assert.equal(existsSync(join(outside, "new")), false);
    assert.equal(readFileSync(join(root, "existing"), "utf8"), "keep");
    assert.equal(readFileSync(join(outside, "external"), "utf8"), "outside");
    await mutateFile(file, loc, "-新 file ", exec);
    assert.ok(existsSync(join(root, "-新 file ")));
    await mutateFile({ ...file, mode: "mkdir" }, loc, "dir", exec);
    await mutateFile({ ...file, mode: "mv", full: join(root, "-新 file ") }, loc, "renamed", exec);
    assert.ok(existsSync(join(root, "renamed")));
    await assert.rejects(mutateFile({ ...file, mode: "mv", full: join(root, "renamed") }, loc, "existing", exec), /already exists/);
    assert.ok(existsSync(join(root, "renamed")));
    assert.equal(readFileSync(join(root, "existing"), "utf8"), "keep");
    chmodSync(join(root, "existing"), 0o600);
    writeFileSync(join(root, "existing copy"), "do not overwrite");
    await mutateFile({ ...file, mode: "duplicate", full: join(root, "existing") }, loc, "existing", exec);
    assert.equal(readFileSync(join(root, "existing copy"), "utf8"), "do not overwrite");
    assert.equal(readFileSync(join(root, "existing copy 2"), "utf8"), "keep");
    assert.equal(statSync(join(root, "existing copy 2")).mode & 0o077, 0);
    chmodSync(join(root, "renamed"), 0o751);
    await mutateFile({ ...file, mode: "duplicate", full: join(root, "renamed") }, loc, "renamed", exec);
    assert.equal(statSync(join(root, "renamed copy")).mode & 0o777, 0o751);
    chmodSync(join(root, "renamed"), 0o4751);
    await mutateFile({ ...file, mode: "duplicate", full: join(root, "renamed") }, loc, "renamed", exec);
    assert.equal(statSync(join(root, "renamed copy 2")).mode & 0o7777, 0o751);
    const binary = Buffer.from([0, 255, 42]);
    writeFileSync(join(root, "-新.bin"), binary);
    symlinkSync("missing", join(root, "-新 copy.bin"));
    await mutateFile({ ...file, mode: "duplicate", full: join(root, "-新.bin") }, loc, "-新.bin", exec);
    assert.deepEqual(readFileSync(join(root, "-新 copy 2.bin")), binary);
    await assert.rejects(mutateFile({ ...file, mode: "duplicate", full: join(root, "link") }, loc, "link", exec), /regular file/);
    assert.ok(calls.every((opts) => opts.on === "host-a"));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("concurrent duplicates never overwrite existing copies", async () => {
  const root = mkdtempSync(join(tmpdir(), "orca-copy-"));
  try {
    writeFileSync(join(root, "file.txt"), "source");
    writeFileSync(join(root, "file copy.txt"), "existing");
    const loc = { cwd: root, on: null, space: "space" };
    const target = { ...loc, full: join(root, "file.txt"), mode: "duplicate" };
    const exec = (cmd, args) => new Promise((resolve, reject) => {
      const child = spawn(cmd, args); let stderr = "";
      child.stderr.on("data", (s) => { stderr += s; });
      child.on("error", reject); child.on("close", (code) => resolve({ code, stderr }));
    });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => mutateFile(target, loc, "file.txt", exec)));
    assert.ok(results.some((r) => r.status === "fulfilled"));
    assert.equal(readFileSync(join(root, "file copy.txt"), "utf8"), "existing");
    for (let i = 2; i <= 7; i++) {
      const path = join(root, `file copy ${i}.txt`);
      if (existsSync(path)) assert.equal(readFileSync(path, "utf8"), "source");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a competing file created immediately before exclusive open is not removed", async () => {
  const root = mkdtempSync(join(tmpdir(), "orca-copy-race-"));
  try {
    writeFileSync(join(root, "file.txt"), "source");
    const loc = { cwd: root, on: null, space: "space" };
    const exec = async (cmd, args) => {
      const script = args[1].replace('  (\n    umask 077; set -C; set -e', '  printf competitor > "$dest"\n  (\n    umask 077; set -C; set -e');
      assert.notEqual(script, args[1]);
      const result = spawnSync(cmd, [args[0], script, ...args.slice(2)], { encoding: "utf8" });
      return { code: result.status, stdout: result.stdout, stderr: result.stderr };
    };
    await assert.rejects(mutateFile({ ...loc, full: join(root, "file.txt"), mode: "duplicate" }, loc, "file.txt", exec), /Copy failed/);
    assert.equal(readFileSync(join(root, "file copy.txt"), "utf8"), "competitor");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
