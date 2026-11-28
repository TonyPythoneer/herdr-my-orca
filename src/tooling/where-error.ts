#!/usr/bin/env node

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, ManifestError, loadManifests } from "./orca-ui-manifests";

type ManifestTable = ReturnType<typeof loadManifests>["table"];
type ManifestRow = ManifestTable extends Map<string, infer Row> ? Row : never;
type Feature = { manifest?: { feature?: string }; area?: string; next?: string[] };
type InPlace = { mod: string; tests?: string[]; layouts?: string[]; next?: string[] };
type Hints = { features?: Feature[]; inPlace?: InPlace[]; root?: string };
export type Hit = { frame: string; edit: string; kind: string; note: string };

const FRAME =
  /(?:[^\s?:()]*\/)?mods\/([^/\s?:()]+)\/([^\s?:()]+)(?:\?v=\d+)?:(\d+)(?::([1-9]\d*))?/g;
const list = (items: readonly string[]): string => (items.length ? items.join(", ") : "-");

const isPlainFile = (path: string): boolean => {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
};

const isModFile = (root: string, mod: string, file: string): boolean => {
  const path = join(root, "mods", mod, file);
  try {
    return (
      isPlainFile(path) &&
      realpathSync(path).startsWith(realpathSync(join(root, "mods", mod)) + sep)
    );
  } catch {
    return false;
  }
};

const UNKNOWN = "unknown path: no such mod in this repo";
const NOT_MAPPED = "not in app.mjs yet: edit this file in place";
const nextHint = (next?: string[]): string => (next?.length ? `; next ${list(next)}` : "");
const slotNames = (layoutSlots: Record<string, string[]>): string[] =>
  Object.entries(layoutSlots).flatMap(([layout, ids]) => ids.map((id) => `${layout}#${id}`));

const escapes = (mod: string, file: string): boolean =>
  `${mod}/${file}`.split("/").some((part) => part === ".." || part === "." || part === "");

function tableNote(
  row: ManifestRow,
  mod: string,
  table: ManifestTable,
  { features = [] }: Hints,
): string {
  if (row.kind === "entry") return `generated entry from ${row.source}`;
  const entry = features.find((e) =>
    row.kind === "feature" ? e.manifest?.feature === row.id : e.area === "shared",
  );
  const detail = `; tests ${list(row.tests)}; layouts ${list(slotNames(row.layoutSlots))}`;
  if (row.kind === "feature") return `feature "${row.id}"${detail}${nextHint(entry?.next)}`;
  const modHasFeature = [...table].some(
    ([dest, r]) => r.kind === "feature" && dest.startsWith(`mods/${mod}/`),
  );
  return `shared helper, copied into ${list(row.consumers)}${modHasFeature ? detail : ""}${nextHint(entry?.next)}`;
}

function inPlaceNote(mod: string, { inPlace = [] }: Hints): string {
  const mapped = inPlace.find((e) => e.mod === mod);
  if (!mapped) return NOT_MAPPED;
  return `edit this file in place; mod "${mod}" is in app.mjs; tests ${list(mapped.tests ?? [])}; layouts ${list(mapped.layouts ?? [])}${nextHint(mapped.next)}`;
}

type Frame = { mod: string; file: string; line: string; column?: string };

function hitFor(
  { mod, file, line, column }: Frame,
  table: ManifestTable,
  hints: Hints,
  root: string,
): Hit {
  const at = (path: string): string => `${path}:${Number(line)}${column ? `:${column}` : ""}`;
  const frame = at(`mods/${mod}/${file}`);
  const row = escapes(mod, file) ? null : table.get(`mods/${mod}/${file}`);
  const plain =
    !escapes(mod, file) && isModFile(root, mod, "mod.json") && isModFile(root, mod, file);
  if (row && (row.kind === "entry" || /\.(?:ts|mts)$/.test(row.source))) {
    return {
      frame,
      edit: row.source,
      kind: row.kind,
      note: `${tableNote(row, mod, table, hints)}; runtime frame coordinates are not mapped to the source`,
    };
  }
  if (row)
    return { frame, edit: at(row.source), kind: row.kind, note: tableNote(row, mod, table, hints) };
  if (plain) return { frame, edit: frame, kind: "in-place", note: inPlaceNote(mod, hints) };
  return { frame, edit: frame, kind: "unknown", note: UNKNOWN };
}

export function locate(
  text: string,
  table: ManifestTable,
  { features = [], inPlace = [], root = ROOT }: Hints = {},
): Hit[] {
  const hints = { features, inPlace };
  const out: Hit[] = [];
  for (const match of text.matchAll(FRAME)) {
    const [, mod, file, line, column] = match;
    if (!mod || !file || !line || Number(line) === 0) continue;
    out.push(hitFor({ mod, file, line, column }, table, hints, root));
  }
  return out;
}

async function main(): Promise<void> {
  const root = process.env.ORCA_UI_ROOT ?? ROOT;
  let table: ManifestTable;
  try {
    table = loadManifests({ root }).table;
  } catch (error) {
    console.error(
      `${error instanceof ManifestError ? error.path : "orca-ui"}: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  }
  let text: string;
  try {
    text = process.argv.length > 2 ? process.argv.slice(2).join(" ") : readFileSync(0, "utf8");
  } catch (error) {
    console.error(`cannot read input: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }

  const app = await import(pathToFileURL(join(root, "orca-ui", "app.mjs")).href).catch(
    () => ({}) as { features?: Feature[]; inPlace?: InPlace[] },
  );
  const hits = locate(text, table, { features: app.features, inPlace: app.inPlace, root });
  if (!hits.length) {
    console.error("no mods/<mod>/<file>:<line> frame found in the input");
    process.exit(1);
  }
  for (const hit of hits) console.log(`${hit.edit}\n  from ${hit.frame}; ${hit.note}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
