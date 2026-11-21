#!/usr/bin/env node
// A mod may only import files inside its own folder, so shared code is copied, not imported.
// shared/<name>.js is the one place to edit; this copies it into each mod that uses it.
// `node scripts/sync-shared.mjs` writes the copies, `--check` fails if any differs.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const USES = {
  "clip.js": ["orca-changes", "orca-files", "orca-handoff", "orca-menu"],
  "transcript.js": ["orca-handoff", "orca-menu"],
  "review-store.js": ["orca-changes", "orca-spaces"],
};
const header = (name) => `// Generated from shared/${name} by scripts/sync-shared.mjs. Edit that file, not this copy.\n`;

export async function copies(root = ROOT) {
  const out = [];
  for (const [name, mods] of Object.entries(USES)) {
    const source = await readFile(join(root, "shared", name), "utf8");
    for (const mod of mods) out.push({ path: join(root, "mods", mod, name), want: header(name) + source });
  }
  return out;
}

export async function stale(root = ROOT) {
  const bad = [];
  for (const { path, want } of await copies(root)) {
    if ((await readFile(path, "utf8").catch(() => null)) !== want) bad.push(path);
  }
  return bad;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const bad = await stale();
    if (bad.length) { console.error("Out of date, run scripts/sync-shared.mjs:\n" + bad.join("\n")); process.exit(1); }
  } else {
    for (const { path, want } of await copies()) await writeFile(path, want);
  }
}
