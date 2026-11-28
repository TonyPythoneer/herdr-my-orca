import { it, onTestFinished } from "vite-plus/test";
import { packedExpectedBytes } from "../../src/tooling/packed-contract.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ROOT, loadManifests } from "../../src/tooling/orca-ui-manifests.ts";

const { table, shared } = loadManifests();
const sharedCopies = [...table].filter(([, row]) => row.kind === "shared");

it("every copy of a shared helper matches its canonical source", () => {
  assert.equal(sharedCopies.length, 72);
  for (const [dest, row] of sharedCopies) {
    const source = readFileSync(`${ROOT}/${row.source}`, "utf8");
    const want = `${source}${source.endsWith("\n") ? "" : "\n"}`;
    assert.deepEqual(
      readFileSync(`${ROOT}/${dest}`),
      packedExpectedBytes(dest, Buffer.from(want), { table }),
      dest,
    );
  }
  const script = fileURLToPath(new URL("../../src/tooling/build-orca-ui.ts", import.meta.url));
  const vpx = join(ROOT, "node_modules", ".bin", "vpx");

  const out = process.env.HERDR_PACKED_ARTIFACT_DIR
    ? mkdtempSync(join(tmpdir(), "legacy-check-"))
    : ROOT;
  if (out !== ROOT) {
    onTestFinished(() => rmSync(out, { recursive: true, force: true }));
    assert.equal(spawnSync(vpx, [script, "--out", out], { encoding: "utf8" }).status, 0);
  }
  assert.equal(spawnSync(vpx, [script, "--check", "--out", out], { encoding: "utf8" }).status, 0);
});

it("shared helpers are listed once per mod", () => {
  const outputs = shared.files.flatMap((f) => f.outputs);
  assert.equal(new Set(outputs).size, outputs.length);
  for (const { outputs: list } of shared.files)
    assert.equal(new Set(list.map((o) => o.split("/")[1])).size, list.length);
});
