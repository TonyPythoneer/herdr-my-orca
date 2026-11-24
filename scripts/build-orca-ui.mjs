#!/usr/bin/env node
// Build the managed Orca UI outputs from `orca-ui/features/<area>/<feature>/manifest.json`.
//
// Usage: node scripts/build-orca-ui.mjs --out <dir> [--check]
//   The build writes only files a manifest declares, so an empty <dir> gets exactly that batch.
//   --check compares bytes and file modes against <dir> without writing; exit 0 clean, 1 drift.
// Exit 2 is a usage or manifest error. Undeclared files in a feature folder are an error too, so
// a new asset cannot be silently left out of the output set.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FEATURES = join(ROOT, "orca-ui", "features");
const USAGE = "usage: node scripts/build-orca-ui.mjs --out <dir> [--check]";

function fail(message) {
  console.error(message);
  console.error(USAGE);
  process.exit(2);
}

function manifests(dir = FEATURES) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...manifests(path));
    else if (name === "manifest.json") found.push(path);
  }
  return found.sort();
}

function load(path) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  for (const key of ["feature", "mod", "source", "output", "files", "tests"]) {
    if (manifest[key] === undefined) fail(`${relative(ROOT, path)}: missing "${key}"`);
  }
  const source = join(ROOT, manifest.source);
  if (!existsSync(source)) fail(`${relative(ROOT, path)}: source folder ${manifest.source} does not exist`);
  const declared = new Set([...manifest.files, ...manifest.tests, "manifest.json"]);
  for (const file of manifest.files) {
    if (!existsSync(join(source, file))) fail(`${relative(ROOT, path)}: missing source ${manifest.source}/${file}`);
  }
  for (const file of manifest.tests) {
    if (!existsSync(join(source, file))) fail(`${relative(ROOT, path)}: missing test ${manifest.source}/${file}`);
  }
  for (const file of readdirSync(source)) {
    if (declared.has(file) || file.endsWith(".test.js")) continue;
    fail(`${relative(ROOT, path)}: ${manifest.source}/${file} is not listed in the manifest`);
  }
  return { manifest, source };
}

function main(argv) {
  const args = argv.slice(2);
  let out = null;
  let check = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--check") check = true;
    else if (args[i] === "--out") {
      if (!args[i + 1]) fail("--out needs a directory");
      out = args[++i];
    } else fail(`unknown argument ${args[i]}`);
  }
  if (!out) fail("--out is required");

  const target = resolve(out);
  const batch = manifests().map(load);
  const drift = [];
  let written = 0;

  for (const { manifest, source } of batch) {
    const destination = join(target, manifest.output);
    for (const file of manifest.files) {
      const from = join(source, file);
      const to = join(destination, file);
      const want = readFileSync(from);
      const mode = statSync(from).mode & 0o777;
      if (check) {
        const label = relative(ROOT, to) || to;
        if (!existsSync(to)) drift.push(`${label}: missing`);
        else if (!readFileSync(to).equals(want)) drift.push(`${label}: content differs`);
        else if ((statSync(to).mode & 0o777) !== mode) drift.push(`${label}: mode differs`);
      } else {
        mkdirSync(dirname(to), { recursive: true });
        writeFileSync(to, want);
        chmodSync(to, mode);
      }
      written++;
    }
  }

  if (check) {
    for (const line of drift) console.log(line);
    console.log(drift.length ? `${drift.length} managed file(s) drifted` : `${written} managed file(s) match`);
    process.exit(drift.length ? 1 : 0);
  }
  const shown = relative(ROOT, target).startsWith("..") ? target : relative(ROOT, target) || ".";
  console.log(`wrote ${written} managed file(s) from ${batch.length} feature(s) to ${shown}`);
}

main(process.argv);
