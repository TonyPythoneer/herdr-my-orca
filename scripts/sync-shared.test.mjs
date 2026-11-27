import { packedExpectedBytes } from "../tools/vite-plus-pilot/packed-contract.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ROOT, loadManifests } from "./orca-ui-manifests.mjs";

const { table, shared } = loadManifests();
const sharedCopies = [...table].filter(([, row]) => row.kind === "shared");

test("every copy of a shared helper matches orca-ui/shared/", t => {
  assert.equal(sharedCopies.length, 41);
  for (const [dest, row] of sharedCopies) {
    const source = readFileSync(`${ROOT}/${row.source}`, "utf8");
    const want = `${source}${source.endsWith("\n") ? "" : "\n"}// Generated from ${row.source} by scripts/build-orca-ui.mjs. Edit that file, not this copy.\n`;
    assert.deepEqual(readFileSync(`${ROOT}/${dest}`), packedExpectedBytes(dest, Buffer.from(want), { table }), dest);
  }
  const script = fileURLToPath(new URL("./build-orca-ui.mjs", import.meta.url));
  // The source worktree independently verifies legacy drift. The packed worktree checks
  // the compiler-emitted bytes above and exercises the legacy builder in a clean directory.
  const out = process.env.HERDR_PACKED_ARTIFACT_DIR ? mkdtempSync(join(tmpdir(), "legacy-check-")) : ROOT;
  if (out !== ROOT) {
    t.after(() => rmSync(out, { recursive: true, force: true }));
    assert.equal(spawnSync(process.execPath, [script, "--out", out], { encoding: "utf8" }).status, 0);
  }
  assert.equal(spawnSync(process.execPath, [script, "--check", "--out", out], { encoding: "utf8" }).status, 0);
});

test("shared helpers are listed once per mod", () => {
  const outputs = shared.files.flatMap(f => f.outputs);
  assert.equal(new Set(outputs).size, outputs.length);
  for (const { outputs: list } of shared.files) assert.equal(new Set(list.map(o => o.split("/")[1])).size, list.length);
});
