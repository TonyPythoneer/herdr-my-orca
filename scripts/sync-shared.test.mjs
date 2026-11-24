import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ROOT, loadManifests } from "./orca-ui-manifests.mjs";

const { table, shared } = loadManifests();
const sharedCopies = [...table].filter(([, row]) => row.kind === "shared");

test("every copy of a shared helper matches orca-ui/shared/", () => {
  assert.equal(sharedCopies.length, 26);
  for (const [dest, row] of sharedCopies) {
    const source = readFileSync(`${ROOT}/${row.source}`, "utf8");
    const want = `${source}${source.endsWith("\n") ? "" : "\n"}// Generated from ${row.source} by scripts/build-orca-ui.mjs. Edit that file, not this copy.\n`;
    assert.equal(readFileSync(`${ROOT}/${dest}`, "utf8"), want, dest);
  }
  const script = fileURLToPath(new URL("./build-orca-ui.mjs", import.meta.url));
  assert.equal(spawnSync(process.execPath, [script, "--check", "--out", ROOT], { encoding: "utf8" }).status, 0);
});

test("shared helpers are listed once per mod", () => {
  const outputs = shared.files.flatMap(f => f.outputs);
  assert.equal(new Set(outputs).size, outputs.length);
  for (const { outputs: list } of shared.files) assert.equal(new Set(list.map(o => o.split("/")[1])).size, list.length);
});
