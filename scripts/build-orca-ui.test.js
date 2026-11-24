import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./build-orca-ui.mjs", import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

test("an empty directory receives exactly the managed batch, twice identically", t => {
  const root = mkdtempSync(join(tmpdir(), "orca-build-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = join(root, "a");
  const second = join(root, "b");
  assert.equal(run("--out", first).status, 0);
  assert.equal(run("--out", second).status, 0);
  for (const file of ["main.js", "panel-views.js", "mod.json", "files.svg"]) {
    const path = `mods/orca-panel-head/${file}`;
    assert.ok(existsSync(join(first, path)), `${path} built without the repo copy`);
    assert.ok(readFileSync(join(first, path)).equals(readFileSync(join(second, path))));
  }
  assert.equal(run("--check", "--out", first).status, 0);
});

test("check fails on drift, a missing file and a changed mode", t => {
  const out = mkdtempSync(join(tmpdir(), "orca-build-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  assert.equal(run("--out", out).status, 0);
  const main = join(out, "mods/orca-panel-head/main.js");
  const original = readFileSync(main);

  writeFileSync(main, original.toString().replace("export default class", "export default class  "));
  const tampered = run("--check", "--out", out);
  assert.equal(tampered.status, 1);
  assert.match(tampered.stdout, /main\.js: content differs/);

  writeFileSync(main, original);
  const svg = join(out, "mods/orca-panel-head/plug.svg");
  const svgBytes = readFileSync(svg);
  chmodSync(svg, 0o755);
  const modes = run("--check", "--out", out);
  assert.equal(modes.status, 1);
  assert.match(modes.stdout, /plug\.svg: mode differs/);
  chmodSync(svg, 0o644);
  assert.equal(readFileSync(svg).equals(svgBytes), true);

  rmSync(main);
  const missing = run("--check", "--out", out);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /main\.js: missing/);
});

test("bad usage exits 2", () => {
  assert.equal(run().status, 2);
  assert.equal(run("--out").status, 2);
  assert.equal(run("--out", "/tmp/orca-build-unused", "--nope").status, 2);
});
