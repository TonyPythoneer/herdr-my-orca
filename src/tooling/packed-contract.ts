import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

type ContractRow = { source: string; packId?: string };
type LoadedManifest = { table: Map<string, ContractRow> };

export function stripCodeComments(source: string): string {
  const comments = parse(source, { sourceType: "unambiguous", plugins: ["jsx"] }).comments ?? [];
  let output = source;
  for (const { start, end } of [...comments].reverse()) {
    const removed = output.slice(start, end).replace(/[^\r\n]/g, " ");
    output = `${output.slice(0, start)}${removed}${output.slice(end)}`;
  }
  return output;
}

export function compiledSourceBytes(
  source: string,
  dist: string,
  packId = basename(source, ".ts"),
): Buffer {
  const raw = readFileSync(join(dist, `typed/${packId}.js`), "utf8");
  const banner = `// ${source}\n`;
  const content = stripCodeComments(raw.startsWith(banner) ? raw.slice(banner.length) : raw);
  return Buffer.from(content + (content.endsWith("\n") ? "" : "\n"));
}

export function packedExpectedBytes(path: string, legacy: Buffer, loaded: LoadedManifest): Buffer {
  const dist =
    process.env.HERDR_PACKED_ARTIFACT_DIR ??
    fileURLToPath(new URL("../../tools/vite-plus-pilot/dist/", import.meta.url));
  const row = loaded.table.get(path);
  return row?.source.endsWith(".ts") ? compiledSourceBytes(row.source, dist, row.packId) : legacy;
}
