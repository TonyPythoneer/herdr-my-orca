import { afterEach, it } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT, loadManifests } from "../../src/tooling/orca-ui-manifests.ts";
import { packedExpectedBytes, stripCodeComments } from "../../src/tooling/packed-contract.ts";
import { FEATURE, edit, fixture, temp, write } from "../helpers/orca-ui-fixture.ts";

const script = join(ROOT, "src/tooling/build-orca-ui.ts");
const vpx = join(ROOT, "node_modules", ".bin", "vpx");
const run = (...args: string[]) => spawnSync(vpx, [script, ...args], { encoding: "utf8" });
const files = (dir: string) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();
const cleanupCallbacks: (() => void)[] = [];
const fixtureContext = { after: (callback: () => void) => cleanupCallbacks.push(callback) };
afterEach(() => {
  for (const cleanup of cleanupCallbacks.splice(0)) cleanup();
});

const FEATURE_FILES = ["main.js", "mod.json", "view.js", "icons/a.svg", "tool.sh"]
  .map((file) => `mods/orca-files/${file}`)
  .sort();
const SHARED_FILES = [
  "orca-changes/clip.js",
  "orca-files/clip.js",
  "orca-handoff/clip.js",
  "orca-context-menu/clip.js",
  "orca-handoff/transcript.js",
  "orca-context-menu/transcript.js",
].map((file) => `mods/${file}`);
const ALL_FILES = [...FEATURE_FILES, ...SHARED_FILES].sort();

it("an empty directory receives exactly the managed batch, twice identically", () => {
  const root = fixture(fixtureContext);
  const [a, b] = [temp(fixtureContext), temp(fixtureContext)];
  assert.equal(run("--root", root, "--out", a).status, 0);
  assert.equal(run("--root", root, "--out", b).status, 0);
  assert.deepEqual(files(a), ALL_FILES);
  assert.deepEqual(files(a), files(b));
  for (const file of FEATURE_FILES) {
    const source = join(root, FEATURE, file.replace("mods/orca-files/", ""));
    assert.ok(readFileSync(join(a, file)).equals(readFileSync(source)), file);
    assert.equal(statSync(join(a, file)).mode & 0o777, statSync(source).mode & 0o777, file);
  }
  assert.equal(
    readFileSync(join(a, "mods/orca-context-menu/clip.js"), "utf8"),
    'export const n = "clip.js";\n',
  );
  assert.equal(
    readFileSync(join(a, "mods/orca-context-menu/transcript.js"), "utf8"),
    'export const n = "transcript.js"\n',
  );
  assert.equal(statSync(join(a, "mods/orca-context-menu/clip.js")).mode & 0o777, 0o644);
  assert.equal(run("--root", root, "--check", "--out", a).status, 0);
}, 60_000);

it("generated code comments are removed without changing comment-like string text", () => {
  const source =
    'const text = "/* not a comment */"; const value = /* @__PURE__ */ new Set(); // trailing\n';
  const output = stripCodeComments(source);
  assert.equal(output.includes("@__PURE__"), false);
  assert.equal(output.includes("// trailing"), false);
  assert.ok(output.includes('"/* not a comment */"'));
});

it("the real repo builds every managed file and matches", () => {
  const out = temp(fixtureContext);
  assert.equal(run("--out", out).status, 0);
  assert.equal(files(out).length, loadManifests().table.size);
  assert.equal(run("--check", "--out", out).status, 0);
}, 60_000);

it("the real repo builds its 4 panel-head files and matches", () => {
  const out = temp(fixtureContext);
  assert.equal(run("--out", out).status, 0);
  assert.equal(
    files(out).filter((file) => file.startsWith("mods/orca-right-sidebar-header/")).length,
    4,
  );
  for (const file of files(out)) {
    const expected = packedExpectedBytes(file, readFileSync(join(out, file)), loadManifests());
    assert.ok(expected.equals(readFileSync(join(ROOT, file))), file);
    assert.equal(
      statSync(join(out, file)).mode & 0o777,
      statSync(join(ROOT, file)).mode & 0o777,
      file,
    );
  }
}, 60_000);

it("check fails on drift, a missing file and a changed mode", () => {
  const root = fixture(fixtureContext);
  const out = temp(fixtureContext);
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
}, 60_000);

it("a stale, hand-edited or missing shared copy fails check; a shared-only mod keeps its own files", () => {
  const root = fixture(fixtureContext);
  const out = temp(fixtureContext);
  run("--root", root, "--out", out);
  write(out, "mods/orca-context-menu/main.js", "// the mod's own file, not managed");
  assert.equal(run("--root", root, "--check", "--out", out).status, 0);
  write(root, "orca-ui/shared/clip.js", "export const n = 2;\n");
  let r = run("--root", root, "--check", "--out", out);
  assert.equal(r.status, 1);
  assert.equal(r.stdout.match(/clip\.js: content differs/g)?.length, 4);
  writeFileSync(join(out, "mods/orca-context-menu/transcript.js"), "x");
  rmSync(join(out, "mods/orca-handoff/transcript.js"));
  r = run("--root", root, "--check", "--out", out);
  assert.match(r.stdout, /orca-context-menu\/transcript\.js: content differs/);
  assert.match(r.stdout, /orca-handoff\/transcript\.js: missing/);
}, 60_000);

it("check allows handwritten, shared copies, Herdr reserved files and .DS_Store, and ignores unmanaged mods", () => {
  const root = fixture(fixtureContext);
  const out = temp(fixtureContext);
  run("--root", root, "--out", out);
  for (const file of ["extra.js", "gpui-kit.d.ts", "jsconfig.json", ".DS_Store", "icons/.DS_Store"])
    write(out, `mods/orca-files/${file}`, "x");
  write(out, "mods/orca-right-sidebar-placeholders/anything.js", "unrelated");
  const r = run("--root", root, "--check", "--out", out);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /11 managed file\(s\) match/);
}, 60_000);

it("build repairs drift, and files that already match are not rewritten", () => {
  const root = fixture(fixtureContext);
  const out = temp(fixtureContext);
  run("--root", root, "--out", out);
  const kept = join(out, "mods/orca-files/view.js");
  utimesSync(kept, 1000, 1000);
  writeFileSync(join(out, "mods/orca-files/main.js"), "tampered");
  chmodSync(join(out, "mods/orca-files/tool.sh"), 0o644);
  assert.equal(run("--root", root, "--force", "--out", out).status, 0);
  assert.equal(run("--root", root, "--check", "--out", out).status, 0);
  assert.equal(statSync(kept).mtimeMs, 1_000_000);
}, 60_000);

it("a destination that is a directory, or a symlinked mod folder, fails with no writes", () => {
  const root = fixture(fixtureContext);
  const out = temp(fixtureContext);
  mkdirSync(join(out, "mods/orca-files/main.js"), { recursive: true });
  let r = run("--root", root, "--out", out);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /main\.js: exists but is not a regular file/);
  assert.deepEqual(files(out), []);

  for (const target of [temp(fixtureContext), join(temp(fixtureContext), "dangling")]) {
    const fresh = temp(fixtureContext);
    mkdirSync(join(fresh, "mods"));
    symlinkSync(target, join(fresh, "mods/orca-files"));
    for (const flags of [[], ["--check"]]) {
      r = run("--root", root, ...flags, "--out", fresh);
      assert.equal(r.status, 1, flags.join());
      assert.match(r.stdout + r.stderr, /symlink/);
    }
    assert.deepEqual(files(fresh), []);
    if (existsSync(target)) assert.deepEqual(files(target), []);
    else assert.equal(existsSync(target), false);
  }
}, 60_000);

it("an output under a symlinked directory is refused", () => {
  const root = fixture(fixtureContext);
  const real = temp(fixtureContext);
  const holder = temp(fixtureContext);
  symlinkSync(real, join(holder, "link"));
  assert.equal(run("--root", root, "--out", join(holder, "link", "out")).status, 1);
  assert.deepEqual(files(real), []);
}, 60_000);

it("bad usage exits 2", () => {
  const root = fixture(fixtureContext);
  const out = temp(fixtureContext);
  for (const args of [
    [],
    ["--out"],
    ["--out", "--check"],
    ["--out", out, "--out", out],
    ["--out", out, "--check", "--check"],
    ["--out", out, "--root"],
    ["--out", out, "--root", root, "--root", root],
    ["--out", out, "--nope"],
    ["--check"],
  ]) {
    assert.equal(run(...args).status, 2, args.join(" "));
  }
  edit(root, `${FEATURE}/manifest.json`, (json) => {
    (json.tests as string[]).push("missing.test.js");
  });
  const r = run("--root", root, "--out", out);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /manifest\.json: missing source/);
  assert.deepEqual(files(out), []);
}, 60_000);

it("relative --out and --root resolve against the working directory", () => {
  const root = fixture(fixtureContext);
  const out = temp(fixtureContext);
  const r = spawnSync(vpx, [script, "--root", ".", "--out", "dist"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(files(join(root, "dist")).length, 11);
  assert.deepEqual(files(out), []);
}, 60_000);

it("a differing copy newer than its source blocks the whole build; matching files keep their mtime", () => {
  const root = fixture(fixtureContext);
  const out = temp(fixtureContext);
  run("--root", root, "--out", out);
  const at = (file: string) => join(out, "mods/orca-files", file);
  const past = new Date(Date.now() - 100_000);
  for (const file of ["main.js", "view.js", "mod.json", "tool.sh", "icons/a.svg"])
    utimesSync(join(root, FEATURE, file), past, past);

  write(root, `${FEATURE}/view.js`, "export const view = 2;\n");
  utimesSync(join(root, FEATURE, "view.js"), past, past);
  utimesSync(at("view.js"), past, past);
  const newer = new Date(Date.now() - 50_000);
  utimesSync(at("mod.json"), newer, newer);
  assert.equal(run("--root", root, "--out", out).status, 0);
  assert.equal(readFileSync(at("view.js"), "utf8"), "export const view = 2;\n");
  assert.equal(statSync(at("mod.json")).mtimeMs, newer.getTime());

  writeFileSync(at("main.js"), "hand edit");
  chmodSync(at("tool.sh"), 0o644);
  rmSync(at("icons/a.svg"));
  const r = run("--root", root, "--out", out);
  assert.equal(r.status, 1);
  assert.deepEqual(r.stderr.split("\n").slice(0, 2), [
    "mods/orca-files/main.js",
    "mods/orca-files/tool.sh",
  ]);
  assert.equal(readFileSync(at("main.js"), "utf8"), "hand edit");
  assert.equal(existsSync(at("icons/a.svg")), false);

  assert.equal(run("--root", root, "--force", "--out", out).status, 0);
  assert.equal(run("--root", root, "--check", "--out", out).status, 0);
}, 60_000);

it("--force never overrides a symlinked destination, and cannot be combined with --check", () => {
  const root = fixture(fixtureContext);
  const out = temp(fixtureContext);
  const other = temp(fixtureContext);
  mkdirSync(join(out, "mods"));
  symlinkSync(other, join(out, "mods/orca-files"));
  assert.equal(run("--root", root, "--force", "--out", out).status, 1);
  assert.deepEqual(files(other), []);
  assert.equal(run("--root", root, "--force", "--check", "--out", out).status, 2);
  assert.equal(run("--root", root, "--force", "--force", "--out", out).status, 2);
}, 60_000);

it("a wrong --root exits 2 instead of building nothing", () => {
  const out = temp(fixtureContext);
  for (const flags of [[], ["--check"]]) {
    const r = run("--root", join(out, "typo"), ...flags, "--out", out);
    assert.equal(r.status, 2, flags.join());
    assert.match(r.stderr, /orca-ui\/shared\/manifest\.json: /);
  }
  assert.deepEqual(files(out), []);
}, 60_000);

it("layouts come from the repo, not the output tree: a correct layout only in --out still exits 2", () => {
  const root = fixture(fixtureContext);
  const out = temp(fixtureContext);
  write(out, "layouts/orca.json", readFileSync(join(root, "layouts/orca.json"), "utf8"));
  write(root, "layouts/orca.json", JSON.stringify({ id: "root", children: [] }));
  const r = run("--root", root, "--out", out);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /has 0 nodes with id "list"/);
  assert.deepEqual(files(out), ["layouts/orca.json"]);
}, 60_000);

it("a shared source that is not UTF-8 is copied byte for byte", () => {
  const root = fixture(fixtureContext);
  const out = temp(fixtureContext);
  writeFileSync(join(root, "orca-ui/shared/clip.js"), Buffer.from([0x61, 0xff, 0xfe, 0x0a]));
  assert.equal(run("--root", root, "--out", out).status, 0);
  const copy = readFileSync(join(out, "mods/orca-context-menu/clip.js"));
  assert.ok(copy.subarray(0, 4).equals(Buffer.from([0x61, 0xff, 0xfe, 0x0a])));
  assert.equal(run("--root", root, "--check", "--out", out).status, 0);
}, 60_000);

it("check reports a generated shared copy that no manifest lists", () => {
  const root = fixture(fixtureContext);
  const out = temp(fixtureContext);
  run("--root", root, "--out", out);
  write(out, "mods/orca-filez/clip.js", "stale content from an older source version\n");
  write(out, "mods/orca-context-menu/own.js", "// the mod's own file\n");
  const r = run("--root", root, "--check", "--out", out);
  assert.equal(r.status, 1);
  assert.match(
    r.stdout,
    /^mods\/orca-filez\/clip\.js: generated shared copy that no manifest lists$/m,
  );
  assert.doesNotMatch(r.stdout, /own\.js/);
}, 60_000);

it("an update replaces the file instead of rewriting it, so a hard link outside the tree keeps its bytes", () => {
  const root = fixture(fixtureContext);
  const out = temp(fixtureContext);
  const elsewhere = temp(fixtureContext);
  run("--root", root, "--out", out);
  const copy = join(out, "mods/orca-files/view.js");
  linkSync(copy, join(elsewhere, "linked.js"));
  const past = new Date(Date.now() - 100_000);
  utimesSync(join(root, FEATURE, "view.js"), past, past);
  write(root, `${FEATURE}/view.js`, "export const view = 3;\n");
  utimesSync(join(root, FEATURE, "view.js"), past, past);
  utimesSync(copy, past, past);
  assert.equal(run("--root", root, "--out", out).status, 0);
  assert.equal(readFileSync(copy, "utf8"), "export const view = 3;\n");
  assert.equal(readFileSync(join(elsewhere, "linked.js"), "utf8"), "export const view = 1;\n");
  assert.deepEqual(
    files(join(out, "mods/orca-files")).filter((file) => file.endsWith("tmp")),
    [],
  );
}, 60_000);

it("a symlink planted at the temp path is never written through", () => {
  const root = fixture(fixtureContext);
  const out = temp(fixtureContext);
  const outside = temp(fixtureContext);
  run("--root", root, "--out", out);
  write(outside, "victim.txt", "keep me");
  symlinkSync(join(outside, "victim.txt"), join(out, "mods/orca-files/view.js.orca-build-tmp"));
  const past = new Date(Date.now() - 100_000);
  write(root, `${FEATURE}/view.js`, "export const view = 4;\n");
  for (const file of [join(root, FEATURE, "view.js"), join(out, "mods/orca-files/view.js")])
    utimesSync(file, past, past);
  assert.equal(run("--root", root, "--out", out).status, 0);
  assert.equal(readFileSync(join(outside, "victim.txt"), "utf8"), "keep me");
  assert.equal(
    readFileSync(join(out, "mods/orca-files/view.js"), "utf8"),
    "export const view = 4;\n",
  );
}, 60_000);

it("check survives odd .js entries and reports an orphan in a feature mod once", () => {
  const root = fixture(fixtureContext);
  const out = temp(fixtureContext);
  run("--root", root, "--out", out);
  mkdirSync(join(out, "mods/orca-context-menu/lib.js"));
  symlinkSync(join(out, "nowhere"), join(out, "mods/orca-context-menu/dangling.js"));
  write(out, "mods/orca-files/old.js", "stale content from an older source version\n");
  const r = run("--root", root, "--check", "--out", out);
  assert.equal(r.status, 1);
  assert.equal(r.stdout.match(/old\.js/g)?.length, 1);
  assert.match(r.stdout, /1 managed file\(s\) drifted/);
}, 60_000);
