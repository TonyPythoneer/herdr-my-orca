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
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve, sep } from "node:path";
import { ROOT, SHARED, ManifestError, MODE_MASK, allowedExtras, loadManifests, walkFiles } from "./orca-ui-manifests.mjs";

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

// A shared copy ends with a generated-file line, last so Herdr error lines match the source.
const GENERATED_PREFIX = `// Generated from ${SHARED}/`;
const generatedLine = source => `// Generated from ${source} by scripts/build-orca-ui.mjs. Edit that file, not this copy.\n`;
const TEMP_SUFFIX = ".orca-build-tmp";

function deliverable(root, row) {
  const bytes = readFileSync(join(root, row.source));
  if (row.kind !== "shared") return bytes;
  const lf = bytes.length && bytes[bytes.length - 1] === 0x0a ? "" : "\n";
  return Buffer.concat([bytes, Buffer.from(lf + generatedLine(row.source))]);
}

function loadOrExit(root) {
  try { return loadManifests({ root }); }
  catch (error) {
    if (!(error instanceof ManifestError)) throw error;
    console.error(`${error.path}: ${error.message}`);
    console.error(USAGE);
    return process.exit(2);
  }
}

// Compare every managed destination with what the build would write.
function plan(loaded, root, out) {
  const problems = [];
  const pending = [];
  for (const [dest, row] of loaded.table) {
    const to = join(out, dest);
    const bad = pathProblem(to);
    if (bad) { problems.push(`${dest}: ${bad}`); continue; }
    const want = deliverable(root, row);
    const why = !existsSync(to) ? "missing" : !readFileSync(to).equals(want) ? "content differs" : (statSync(to).mode & MODE_MASK) !== row.mode ? "mode differs" : null;
    if (why) pending.push({ dest, to, want, mode: row.mode, why, source: join(root, row.source) });
  }
  return { problems, pending };
}

// Files in a feature's mod folder that nothing declares, and generated shared copies no manifest
// lists (a typo'd or retired target).
function undeclared(loaded, out) {
  const found = [];
  const managed = new Set(loaded.table.keys());
  const extras = allowedExtras(loaded);
  for (const m of loaded.features.values()) {
    const dir = join(out, m.output);
    if (!existsSync(dir) || !lstatSync(dir).isDirectory()) continue;
    for (const file of walkFiles(dir)) {
      const dest = `${m.output}/${file}`;
      if (!managed.has(dest) && !extras.has(dest)) found.push(`${dest}: not declared by any manifest`);
    }
  }
  const mods = join(out, "mods");
  for (const mod of existsSync(mods) ? readdirSync(mods) : []) {
    const dir = join(mods, mod);
    if (!lstatSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir).filter(n => n.endsWith(".js"))) {
      const dest = `mods/${mod}/${name}`;
      if (!managed.has(dest) && readFileSync(join(dir, name), "utf8").split("\n").some(l => l.startsWith(GENERATED_PREFIX))) {
        found.push(`${dest}: generated shared copy that no manifest lists`);
      }
    }
  }
  return found;
}

// Only an existing copy that must change can be a hand edit; missing files are always safe.
const looksHandEdited = p => p.why !== "missing" && statSync(p.to).mtimeMs > statSync(p.source).mtimeMs;

// Write beside the target and rename: an interrupted build leaves no truncated file, and a hard
// link to a file outside the tree is replaced instead of rewritten.
function replaceFile(p) {
  const tmp = `${p.to}${TEMP_SUFFIX}`;
  mkdirSync(dirname(p.to), { recursive: true });
  try {
    writeFileSync(tmp, p.want);
    chmodSync(tmp, p.mode);
    renameSync(tmp, p.to);
  } catch (error) { rmSync(tmp, { force: true }); throw error; }
}

function check(loaded, out, { problems, pending }) {
  const lines = [...problems, ...undeclared(loaded, out), ...pending.map(p => `${p.dest}: ${p.why}`)];
  for (const line of lines) console.log(line);
  console.log(lines.length ? `${lines.length} managed file(s) drifted` : `${loaded.table.size} managed file(s) match`);
  return lines.length ? 1 : 0;
}

function build(loaded, out, { problems, pending }, force) {
  if (problems.length) { for (const line of problems) console.error(line); return 1; }
  const blocked = force ? [] : pending.filter(looksHandEdited);
  if (blocked.length) {
    for (const p of blocked) console.error(p.dest);
    console.error("newer than their source and different: edit the source, or rerun with --force to overwrite");
    return 1;
  }
  try { pending.forEach(replaceFile); }
  catch (error) { console.error(`${error.path ?? out}: ${error.message}`); return 1; }
  console.log(`wrote ${pending.length} of ${loaded.table.size} managed file(s) from ${loaded.features.size} feature(s) and ${loaded.shared.files.length} shared helper(s) to ${out}`);
  return 0;
}

const { out, check: checkOnly, force, root } = parseArgs(process.argv.slice(2));
const loaded = loadOrExit(root);
const result = plan(loaded, root, out);
process.exit(checkOnly ? check(loaded, out, result) : build(loaded, out, result, force));
