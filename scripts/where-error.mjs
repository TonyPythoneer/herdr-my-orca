#!/usr/bin/env node
// Turn a Herdr error (from `herdr-app check`, `status` or the window's Copy details) into the
// file and line to edit, using the same manifest table the builder uses. Herdr only ever names the
// built copy under mods/; this answers without opening it.
//
// Usage: node scripts/where-error.mjs '<error text>'   or   herdr-app check mods/x | node scripts/where-error.mjs
// Exit 0 when a frame was found (even an unknown one), 1 when none was, 2 when the manifests or the
// input cannot be read.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, ManifestError, loadManifests } from "./orca-ui-manifests.mjs";

// `<anything>/mods/<mod>/<file>[?v=N]:<line>[:<col>]`, the frame shape Herdr prints.
const FRAME = /(?:[^\s?:()]*\/)?mods\/([^/\s?:()]+)\/([^\s?:()]+)(?:\?v=\d+)?:(\d+)(?::([1-9]\d*))?/g;
const list = items => (items.length ? items.join(", ") : "-");
const isFile = path => existsSync(path) && statSync(path).isFile();

// `entries` is app.mjs's `features`; it only adds the `next` hint.
export function locate(text, table, entries = [], root = ROOT) {
  const out = [];
  for (const [, mod, file, l, c] of text.matchAll(FRAME)) {
    const line = Number(l);
    if (line === 0) continue;
    const at = path => `${path}:${line}${c ? `:${c}` : ""}`;
    const frame = at(`mods/${mod}/${file}`);
    const parts = `${mod}/${file}`.split("/");
    if (parts.some(p => p === ".." || p === "." || p === "")) {
      out.push({ frame, edit: frame, kind: "unknown", note: "unknown path: no such mod in this repo" });
      continue;
    }
    const row = table.get(`mods/${mod}/${file}`);
    if (row) {
      const entry = entries.find(e => (row.kind === "feature" ? e.manifest?.feature === row.id : e.area === "shared"));
      const next = entry?.next?.length ? `; next ${list(entry.next)}` : "";
      const owned = [...table].some(([dest, r]) => r.kind === "feature" && dest.startsWith(`mods/${mod}/`));
      const slots = Object.entries(row.layoutSlots).flatMap(([layout, ids]) => ids.map(id => `${layout}#${id}`));
      const detail = `; tests ${list(row.tests)}; layouts ${list(slots)}`;
      const note = row.kind === "feature"
        ? `feature "${row.id}"${detail}${next}`
        : `shared helper, copied into ${list(row.consumers)}${owned ? detail : ""}${next}`;
      out.push({ frame, edit: at(row.source), kind: row.kind, note });
    } else if (isFile(join(root, "mods", mod, "mod.json")) && isFile(join(root, "mods", mod, file))) {
      out.push({ frame, edit: frame, kind: "in-place", note: "not in app.mjs yet: edit this file in place" });
    } else {
      out.push({ frame, edit: frame, kind: "unknown", note: "unknown path: no such mod in this repo" });
    }
  }
  return out;
}

async function main() {
  let table;
  try { table = loadManifests().table; }
  catch (error) {
    if (!(error instanceof ManifestError)) throw error;
    console.error(`${error.path}: ${error.message}`);
    process.exit(2);
  }
  let text;
  try { text = process.argv.length > 2 ? process.argv.slice(2).join(" ") : readFileSync(0, "utf8"); }
  catch (error) {
    console.error(`cannot read input: ${error.message}`);
    process.exit(2);
  }
  // app.mjs only adds `next`; a missing or broken one must not stop the lookup.
  const entries = await import(pathToFileURL(join(ROOT, "orca-ui", "app.mjs")).href).then(m => m.features ?? [], () => []);
  const hits = locate(text, table, entries);
  if (!hits.length) { console.error("no mods/<mod>/<file>:<line> frame found in the input"); process.exit(1); }
  for (const h of hits) console.log(`${h.edit}\n  from ${h.frame}; ${h.note}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
