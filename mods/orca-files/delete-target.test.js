import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { deleteTarget } from "./delete-target.js";

test("delete keeps the captured workspace and host, and rejects changed targets", async () => {
  const temp = mkdtempSync(join(tmpdir(), "orca-delete-"));
  try {
    const a = join(temp, "one"), b = join(temp, "two");
    mkdirSync(a); mkdirSync(b);
    const file = "-檔案 with spaces";
    writeFileSync(join(a, file), "a"); writeFileSync(join(b, file), "b");
    const target = { cwd: a, on: "host-a", space: "one", path: join(a, file) };
    const calls = [];
    const exec = async (cmd, args, options) => {
      calls.push({ cmd, args, options });
      const r = spawnSync(cmd, args, { encoding: "utf8" });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    };
    await assert.rejects(deleteTarget(target, { cwd: b, on: "host-b", space: "two" }, exec), /cancelled/);
    await assert.rejects(deleteTarget(target, { cwd: a, on: "host-b", space: "one" }, exec), /cancelled/);
    await assert.rejects(deleteTarget({ ...target, path: `${a}/../two/${file}` }, { cwd: a, on: "host-a", space: "one" }, exec), /Invalid/);
    assert.equal(calls.length, 0);
    assert.ok(existsSync(join(a, file)) && existsSync(join(b, file)));
    symlinkSync(b, join(a, "outside"));
    await assert.rejects(deleteTarget({ ...target, path: join(a, "outside", file) }, { cwd: a, on: "host-a", space: "one" }, exec), /Unsafe/);
    const linkedRoot = join(temp, "linked-root"); symlinkSync(b, linkedRoot);
    await assert.rejects(deleteTarget({ ...target, cwd: linkedRoot, path: join(linkedRoot, file) }, { cwd: linkedRoot, on: "host-a", space: "one" }, exec), /Unsafe/);
    await assert.rejects(deleteTarget({ ...target, cwd: `${linkedRoot}/`, path: join(linkedRoot, file) }, { cwd: `${linkedRoot}/`, on: "host-a", space: "one" }, exec), /Unsafe/);
    assert.ok(existsSync(join(b, file)));
    await deleteTarget(target, { cwd: a, on: "host-a", space: "one" }, exec);
    assert.deepEqual(calls[0].options, { on: "host-a" });
    assert.equal(existsSync(join(a, file)), false);
    assert.equal(existsSync(join(b, file)), true);
    await assert.rejects(deleteTarget(target, { cwd: a, on: "host-a", space: "one" }, exec));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
