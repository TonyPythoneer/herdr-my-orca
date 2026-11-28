import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { canEditPath, writeEditorFile } from "../../../mods/orca-files/editor-path.js";

test("only regular files reached without symlinks under the workspace are editable", async () => {
  const temp = mkdtempSync(join(tmpdir(), "orca-editor-"));
  const root = join(temp, "workspace"), outside = join(temp, "outside");
  mkdirSync(root); mkdirSync(outside); mkdirSync(join(root, "nested"));
  const file = join(root, "nested", "-檔 file"), external = join(outside, "secret");
  writeFileSync(file, "inside"); writeFileSync(external, "outside");
  symlinkSync(outside, join(root, "external-link")); symlinkSync(file, join(root, "file-link"));
  symlinkSync(outside, join(temp, "linked-root"));
  const exec = async (cmd, args) => { const r = spawnSync(cmd, args, { encoding: "utf8" }); return { code: r.status }; };
  try {
    assert.equal(await canEditPath(root, file, exec), true);
    assert.equal(await canEditPath(`${root}/`, file, exec), true);
    assert.equal(await canEditPath(root, external, exec), false);
    assert.equal(await canEditPath(root, `${root}/../outside/secret`, exec), false);
    assert.equal(await canEditPath(root, join(root, "external-link", "secret"), exec), false);
    assert.equal(await canEditPath(root, join(root, "file-link"), exec), false);
    assert.equal(await canEditPath(join(temp, "linked-root"), join(temp, "linked-root", "secret"), exec), false);
    assert.equal(await canEditPath(root, file, async () => { throw new Error("missing shell"); }), false);
    let writes = 0;
    const write = async () => { writes++; };
    await writeEditorFile({ root, full: file }, "edited", "inside", exec, write);
    assert.equal(writes, 1);
    unlinkSync(file); symlinkSync(external, file);
    await assert.rejects(writeEditorFile({ root, full: file }, "edited", "inside", exec, write), /symbolic link/);
    assert.equal(writes, 1);
    assert.equal(readFileSync(external, "utf8"), "outside");
    renameSync(root, join(temp, "old-workspace")); symlinkSync(outside, root);
    await assert.rejects(writeEditorFile({ root, full: join(root, "secret") }, "edited", "outside", exec, write), /symbolic link/);
    assert.equal(writes, 1); assert.equal(readFileSync(external, "utf8"), "outside");
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
