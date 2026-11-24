#!/usr/bin/env node
// Turn a Herdr error (from `herdr-app check`, `status` or the window's Copy details) into the
// file and line to edit, using orca-ui/app.mjs, the feature manifests and sync-shared's USES.
// Herdr only ever names the built copy under mods/; this answers without opening it.
//
// Usage: node scripts/where-error.mjs '<error text>'   or   herdr-app check mods/x | node scripts/where-error.mjs
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, USES } from "./sync-shared.mjs";
import { features } from "../orca-ui/app.mjs";

function manifests(dir = join(ROOT, "orca-ui", "features")) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return manifests(path);
    return name === "manifest.json" ? [JSON.parse(readFileSync(path, "utf8"))] : [];
  });
}

// `<anything>/mods/<mod>/<file>[?v=N]:<line>[:<col>]`, the frame shape Herdr prints.
const FRAME = /mods\/([^/\s?:()]+)\/([^\s?:()]+)(?:\?v=\d+)?:(\d+)(?::(\d+))?/g;

export function locate(text, all = manifests()) {
  const out = [];
  for (const [, mod, file, l, c] of text.matchAll(FRAME)) {
    const line = Number(l);
    const at = (path, n) => `${path}:${n}${c ? `:${c}` : ""}`;
    if (USES[file]?.includes(mod)) {
      // sync-shared appends its header, so copy lines equal shared/ lines.
      out.push({ frame: `mods/${mod}/${file}:${line}`, edit: at(`shared/${file}`, line),
        note: `shared helper, also copied into ${USES[file].filter(m => m !== mod).join(", ")}` });
      continue;
    }
    const m = all.find(x => x.output === `mods/${mod}` && x.files.includes(file));
    if (m) {
      const f = features.find(x => x.id === m.feature);
      out.push({ frame: `mods/${mod}/${file}:${line}`, edit: at(`${m.source}/${file}`, line),
        note: `app.mjs feature "${m.feature}"; tests ${m.tests.map(t => `${m.source}/${t}`).join(", ")}` +
          (f?.layouts ? `; layouts ${f.layouts.join(", ")}` : "") + (f?.next?.length ? `; next ${f.next.join(", ")}` : "") });
      continue;
    }
    out.push({ frame: `mods/${mod}/${file}:${line}`, edit: at(`mods/${mod}/${file}`, line),
      note: "not in app.mjs yet: edit this file in place" });
  }
  return out;
}

if (process.argv[1] && relative(process.argv[1], new URL(import.meta.url).pathname) === "") {
  const text = process.argv.length > 2 ? process.argv.slice(2).join(" ") : readFileSync(0, "utf8");
  const hits = locate(text);
  if (!hits.length) { console.error("no mods/<mod>/<file>:<line> frame found in the input"); process.exit(1); }
  for (const h of hits) console.log(`${h.edit}\n  from ${h.frame}; ${h.note}`);
}
