#!/usr/bin/env node
// Turn a Herdr error (from `herdr-app check`, `status` or the window's Copy details) into the
// file and line to edit, using the same manifest table the builder uses. Herdr only ever names the
// built copy under mods/; this answers without opening it.
//
// Usage: node scripts/where-error.mjs '<error text>'   or   herdr-app check mods/x | node scripts/where-error.mjs
// Exit 0 when a frame was found (even an unknown one), 1 when none was, 2 when the manifests or the
// input cannot be read.
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, ManifestError, loadManifests } from "./orca-ui-manifests.mjs";

// `<anything>/mods/<mod>/<file>[?v=N]:<line>[:<col>]`, the frame shape Herdr prints.
const FRAME = /(?:[^\s?:()]*\/)?mods\/([^/\s?:()]+)\/([^\s?:()]+)(?:\?v=\d+)?:(\d+)(?::([1-9]\d*))?/g;
const list = items => (items.length ? items.join(", ") : "-");
// lstat, so a symlink out of the mod is not offered as an in-place edit target.
const isPlainFile = path => { try { return lstatSync(path).isFile(); } catch { return false; } };

const UNKNOWN = "unknown path: no such mod in this repo";
const NOT_MAPPED = "not in app.mjs yet: edit this file in place";
const nextHint = next => (next?.length ? `; next ${list(next)}` : "");
const slotNames = layoutSlots => Object.entries(layoutSlots).flatMap(([layout, ids]) => ids.map(id => `${layout}#${id}`));
// A frame whose path steps out of its mod (`..`, `.` or an empty segment) is never trusted.
const escapes = (mod, file) => `${mod}/${file}`.split("/").some(part => part === ".." || part === "." || part === "");

// A hit for a file a manifest produces: where to edit the source, plus its tests, layouts and next.
function tableNote(row, mod, table, { features }) {
  const entry = features.find(e => (row.kind === "feature" ? e.manifest?.feature === row.id : e.area === "shared"));
  const detail = `; tests ${list(row.tests)}; layouts ${list(slotNames(row.layoutSlots))}`;
  if (row.kind === "feature") return `feature "${row.id}"${detail}${nextHint(entry?.next)}`;
  const modHasFeature = [...table].some(([dest, r]) => r.kind === "feature" && dest.startsWith(`mods/${mod}/`));
  return `shared helper, copied into ${list(row.consumers)}${modHasFeature ? detail : ""}${nextHint(entry?.next)}`;
}

// A hit for a plain file in a mod no manifest generates.
function inPlaceNote(mod, { inPlace }) {
  const mapped = inPlace.find(e => e.mod === mod);
  if (!mapped) return NOT_MAPPED;
  return `edit this file in place; mod "${mod}" is in app.mjs; tests ${list(mapped.tests ?? [])}; layouts ${list(mapped.layouts ?? [])}${nextHint(mapped.next)}`;
}

// `hints` is what app.mjs exports: `features` and `inPlace` only add reading hints, and `root` is
// the repo to check plain files against.
export function locate(text, table, { features = [], inPlace = [], root = ROOT } = {}) {
  const hints = { features, inPlace };
  const out = [];
  for (const [, mod, file, l, c] of text.matchAll(FRAME)) {
    if (Number(l) === 0) continue;
    const at = path => `${path}:${Number(l)}${c ? `:${c}` : ""}`;
    const frame = at(`mods/${mod}/${file}`);
    const row = escapes(mod, file) ? null : table.get(`mods/${mod}/${file}`);
    const plain = !escapes(mod, file) && isPlainFile(join(root, "mods", mod, "mod.json")) && isPlainFile(join(root, "mods", mod, file));
    if (row) out.push({ frame, edit: at(row.source), kind: row.kind, note: tableNote(row, mod, table, hints) });
    else if (plain) out.push({ frame, edit: frame, kind: "in-place", note: inPlaceNote(mod, hints) });
    else out.push({ frame, edit: frame, kind: "unknown", note: UNKNOWN });
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
  const app = await import(pathToFileURL(join(ROOT, "orca-ui", "app.mjs")).href).catch(() => ({}));
  const hits = locate(text, table, { features: app.features, inPlace: app.inPlace });
  if (!hits.length) { console.error("no mods/<mod>/<file>:<line> frame found in the input"); process.exit(1); }
  for (const h of hits) console.log(`${h.edit}\n  from ${h.frame}; ${h.note}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
