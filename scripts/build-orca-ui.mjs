#!/usr/bin/env node
// Build the managed Orca UI outputs from `orca-ui/features/**/manifest.json`.
//
// Usage: node scripts/build-orca-ui.mjs --out <dir> [--check | --force] [--root <dir>]
//   The build writes only files a manifest declares, so an empty <dir> gets exactly that batch.
//   A copy that differs and is newer than its source was probably edited by hand: the whole build
//   stops with exit 1 and writes nothing. --force skips that mtime test only.
//   --check compares bytes and file modes against <dir> without writing, and also reports files in
//   a feature's mod folder that nothing declares. Exit 0 clean, 1 drift or an output I/O failure,
//   2 a usage or manifest error. --root reads another repo's sources and is meant for tests.
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve, sep } from "node:path";
import { ROOT, ManifestError, allowedExtras, loadManifests, walkFiles } from "./orca-ui-manifests.mjs";
import { USES } from "./sync-shared.mjs";

const USAGE = "usage: node scripts/build-orca-ui.mjs --out <dir> [--check | --force] [--root <dir>]";

function fail(message) {
  console.error(message);
  console.error(USAGE);
  process.exit(2);
}

function parseArgs(args) {
  const opts = { out: null, check: false, force: false, root: ROOT };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!["--out", "--check", "--force", "--root"].includes(flag)) fail(`unknown argument ${flag}`);
    if (seen.has(flag)) fail(`${flag} given more than once`);
    seen.add(flag);
    if (flag === "--check" || flag === "--force") opts[flag.slice(2)] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith("--")) fail(`${flag} needs a directory`);
      opts[flag.slice(2)] = resolve(value);
    }
  }
  if (!opts.out) fail("--out is required");
  if (opts.check && opts.force) fail("--check and --force cannot be combined");
  return opts;
}

// What is wrong with the path, or null. Every existing component must be a real directory and the
// destination itself a regular file, so a symlink cannot redirect a write out of the output tree.
function pathProblem(path) {
  const { root } = parse(path);
  let at = root;
  for (const part of path.slice(root.length).split(sep)) {
    at = join(at, part);
    let stat;
    try { stat = lstatSync(at); } catch { return null; }
    if (stat.isSymbolicLink()) return "is or crosses a symlink";
    if (at !== path && !stat.isDirectory()) return "is or crosses a non-directory";
    if (at === path && !stat.isFile()) return "exists but is not a regular file";
  }
  return null;
}

function main() {
  const { out, check, force, root } = parseArgs(process.argv.slice(2));
  let loaded;
  try { loaded = loadManifests({ root, uses: USES }); }
  catch (error) {
    if (!(error instanceof ManifestError)) throw error;
    console.error(`${error.path}: ${error.message}`);
    console.error(USAGE);
    process.exit(2);
  }
  const rows = [...loaded.table].filter(([, row]) => row.kind === "feature");
  const problems = [];
  const pending = [];

  for (const [dest, row] of rows) {
    const to = join(out, dest);
    const bad = pathProblem(to);
    if (bad) { problems.push(`${dest}: ${bad}`); continue; }
    const want = readFileSync(join(root, row.source));
    if (!existsSync(to)) pending.push({ dest, to, want, mode: row.mode, why: "missing" });
    else if (!readFileSync(to).equals(want)) pending.push({ dest, to, want, mode: row.mode, why: "content differs" });
    else if ((statSync(to).mode & 0o777) !== row.mode) pending.push({ dest, to, want, mode: row.mode, why: "mode differs" });
  }

  if (check) {
    const managed = new Set(loaded.table.keys());
    const extras = allowedExtras(loaded);
    for (const m of loaded.features.values()) {
      const dir = join(out, m.output);
      if (!existsSync(dir) || !lstatSync(dir).isDirectory()) continue;
      for (const file of walkFiles(dir)) {
        const dest = `${m.output}/${file}`;
        if (!managed.has(dest) && !extras.has(dest)) problems.push(`${dest}: not declared by any manifest`);
      }
    }
    const lines = [...problems, ...pending.map(p => `${p.dest}: ${p.why}`)];
    for (const line of lines) console.log(line);
    console.log(lines.length ? `${lines.length} managed file(s) drifted` : `${rows.length} managed file(s) match`);
    process.exit(lines.length ? 1 : 0);
  }

  if (problems.length) {
    for (const line of problems) console.error(line);
    process.exit(1);
  }
  // Only an existing copy that must change can be a hand edit; missing files are always safe.
  const blocked = force ? [] : pending.filter(p => p.why !== "missing" && statSync(p.to).mtimeMs > statSync(join(root, loaded.table.get(p.dest).source)).mtimeMs);
  if (blocked.length) {
    for (const p of blocked) console.error(p.dest);
    console.error("newer than their source and different: edit the source, or rerun with --force to overwrite");
    process.exit(1);
  }
  try {
    for (const p of pending) {
      mkdirSync(dirname(p.to), { recursive: true });
      if (p.why !== "mode differs") writeFileSync(p.to, p.want);
      chmodSync(p.to, p.mode);
    }
  } catch (error) {
    console.error(`${error.path ?? out}: ${error.message}`);
    process.exit(1);
  }
  console.log(`wrote ${pending.length} of ${rows.length} managed file(s) from ${loaded.features.size} feature(s) to ${out}`);
}

main();
