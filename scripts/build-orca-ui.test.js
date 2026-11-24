import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FEATURE, edit, fixture, temp, write } from "./orca-ui-fixture.mjs";

const script = fileURLToPath(new URL("./build-orca-ui.mjs", import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
const files = dir => readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(dir.length + 1)).sort();
const FEATURE_FILES = ["main.js", "mod.json", "view.js", "icons/a.svg", "tool.sh"].map(f => `mods/orca-files/${f}`).sort();

test("an empty directory receives exactly the managed batch, twice identically", t => {
  const root = fixture(t);
  const [a, b] = [temp(t), temp(t)];
  assert.equal(run("--root", root, "--out", a).status, 0);
  assert.equal(run("--root", root, "--out", b).status, 0);
  assert.deepEqual(files(a), FEATURE_FILES);
  assert.deepEqual(files(a), files(b));
  for (const f of FEATURE_FILES) {
    const source = join(root, FEATURE, f.replace("mods/orca-files/", ""));
    assert.ok(readFileSync(join(a, f)).equals(readFileSync(source)), f);
    assert.equal(statSync(join(a, f)).mode & 0o777, statSync(source).mode & 0o777, f);
  }
  assert.equal(run("--root", root, "--check", "--out", a).status, 0);
});

test("the real repo builds its 12 panel-head files and matches", t => {
  const out = temp(t);
  assert.equal(run("--out", out).status, 0);
  assert.equal(files(out).length, 12);
  assert.equal(run("--check", "--out", out).status, 0);
});

test("check fails on drift, a missing file and a changed mode", t => {
  const root = fixture(t);
  const out = temp(t);
  run("--root", root, "--out", out);
  const main = join(out, "mods/orca-files/main.js");
  const svg = join(out, "mods/orca-files/icons/a.svg");
  const original = readFileSync(main);

  writeFileSync(main, "tampered");
  let r = run("--root", root, "--check", "--out", out);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /mods\/orca-files\/main\.js: content differs/);
  writeFileSync(main, original);

  chmodSync(svg, 0o755);
  r = run("--root", root, "--check", "--out", out);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /icons\/a\.svg: mode differs/);
  chmodSync(svg, 0o644);

  rmSync(main);
  r = run("--root", root, "--check", "--out", out);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /main\.js: missing/);
  writeFileSync(main, original);

  write(out, "mods/orca-files/stray/new.js", "x");
  r = run("--root", root, "--check", "--out", out);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /stray\/new\.js: not declared/);
});

test("check allows handwritten, shared copies, Herdr reserved files and .DS_Store, and ignores unmanaged mods", t => {
  const root = fixture(t);
  const out = temp(t);
  run("--root", root, "--out", out);
  for (const f of ["extra.js", "clip.js", "panel-motion.js", "gpui-kit.d.ts", "jsconfig.json", ".DS_Store", "icons/.DS_Store"]) write(out, `mods/orca-files/${f}`, "x");
  write(out, "mods/orca-panel-gap/anything.js", "unrelated");
  const r = run("--root", root, "--check", "--out", out);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /5 managed file\(s\) match/);
});

test("build repairs drift, and files that already match are not rewritten", t => {
  const root = fixture(t);
  const out = temp(t);
  run("--root", root, "--out", out);
  const kept = join(out, "mods/orca-files/view.js");
  utimesSync(kept, 1000, 1000);
  writeFileSync(join(out, "mods/orca-files/main.js"), "tampered");
  chmodSync(join(out, "mods/orca-files/tool.sh"), 0o644);
  assert.equal(run("--root", root, "--out", out).status, 0);
  assert.equal(run("--root", root, "--check", "--out", out).status, 0);
  assert.equal(statSync(kept).mtimeMs, 1_000_000);
});

test("a destination that is a directory, or a symlinked mod folder, fails with no writes", t => {
  const root = fixture(t);
  const out = temp(t);
  mkdirSync(join(out, "mods/orca-files/main.js"), { recursive: true });
  let r = run("--root", root, "--out", out);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /main\.js: exists but is not a regular file/);
  assert.deepEqual(files(out), []);

  for (const target of [temp(t), join(temp(t), "dangling")]) {
    const fresh = temp(t);
    mkdirSync(join(fresh, "mods"));
    symlinkSync(target, join(fresh, "mods/orca-files"));
    for (const flags of [[], ["--check"]]) {
      r = run("--root", root, ...flags, "--out", fresh);
      assert.equal(r.status, 1, flags.join());
      assert.match(r.stdout + r.stderr, /symlink/);
    }
    assert.equal(existsSync(target) && files(target).length, existsSync(target) ? 0 : false);
  }
});

test("an output under a symlinked directory is refused", t => {
  const root = fixture(t);
  const real = temp(t);
  const holder = temp(t);
  symlinkSync(real, join(holder, "link"));
  assert.equal(run("--root", root, "--out", join(holder, "link", "out")).status, 1);
  assert.deepEqual(files(real), []);
});

test("bad usage exits 2", t => {
  const root = fixture(t);
  const out = temp(t);
  for (const args of [[], ["--out"], ["--out", "--check"], ["--out", out, "--out", out], ["--out", out, "--check", "--check"],
    ["--out", out, "--root"], ["--out", out, "--root", root, "--root", root], ["--out", out, "--nope"], ["--check"]]) {
    assert.equal(run(...args).status, 2, args.join(" "));
  }
  edit(root, `${FEATURE}/manifest.json`, m => { m.tests.push("missing.test.js"); });
  const r = run("--root", root, "--out", out);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /manifest\.json: missing source/);
  assert.deepEqual(files(out), []);
});

test("relative --out and --root resolve against the working directory", t => {
  const root = fixture(t);
  const out = temp(t);
  const r = spawnSync(process.execPath, [script, "--root", ".", "--out", "dist"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(files(join(root, "dist")).length, 5);
  assert.deepEqual(files(out), []);
});
