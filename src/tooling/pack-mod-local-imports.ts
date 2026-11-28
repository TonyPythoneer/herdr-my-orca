import { parse } from "@babel/parser";
import { dirname, join, posix, relative, resolve, sep } from "node:path";

type ImportNode = {
  type?: string;
  value?: unknown;
  start?: number;
  end?: number;
  source?: ImportNode;
  callee?: ImportNode;
  arguments?: ImportNode[];
  [key: string]: unknown;
};

type ManifestRow = { source: string; packId?: string };
type SourceRow = ManifestRow & { output: string };

function isNode(value: unknown): value is ImportNode {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function importSource(node: ImportNode): ImportNode | undefined {
  if (
    ["ImportDeclaration", "ExportAllDeclaration", "ExportNamedDeclaration"].includes(
      String(node.type),
    )
  )
    return node.source;
  if (node.type === "ImportExpression") return node.source;
  if (node.type === "CallExpression" && node.callee?.type === "Import") return node.arguments?.[0];
  return undefined;
}

function importSources(ast: unknown): ImportNode[] {
  const found: ImportNode[] = [];
  const visited = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (!isNode(value) || visited.has(value)) return;
    visited.add(value);
    const source = importSource(value);
    if (source?.type === "StringLiteral") found.push(source);
    for (const [key, child] of Object.entries(value)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(ast);
  return found;
}

function relativeSource(
  root: string,
  importer: string,
  specifier: string,
  bySource: Map<string, SourceRow[]>,
): string | null {
  if (!specifier.startsWith(".")) return null;
  const path = resolve(root, dirname(importer), specifier);
  const candidates = [path, path.replace(/\.js$/, ".ts"), `${path}.ts`, join(path, "index.ts")];
  return (
    candidates
      .map((candidate) => relative(root, candidate).split(sep).join("/"))
      .find((candidate) => bySource.has(candidate)) ?? null
  );
}

function packedSource(
  importer: string,
  specifier: string,
  bySource: Map<string, SourceRow[]>,
): string | null {
  const parts = importer.split("/");
  const mod = parts[2];
  const prefix = `./mods/${mod}/`;
  if (parts[0] !== "src" || parts[1] !== "mods" || !specifier.startsWith(prefix)) return null;
  const source = `src/mods/${mod}/${specifier.slice(prefix.length).replace(/\.js$/, ".ts")}`;
  return bySource.has(source) ? source : null;
}

function pathForConsumer(sourceRows: SourceRow[], consumer: string): string {
  const mod = consumer.split("/")[1];
  const output = sourceRows.find((row) => row.output.split("/")[1] === mod)?.output;
  if (!output) throw new Error(`${consumer}: no generated output in mod ${mod}`);
  return `./${relative(dirname(consumer), output).split(sep).join("/")}`;
}

function outputSpecifier(
  sourceRows: SourceRow[],
  root: string,
  importer: string,
  specifier: string,
  maps: {
    bySource: Map<string, SourceRow[]>;
    byChunkPath: Map<string, SourceRow[]>;
    chunkFile: string;
  },
): string | null {
  const target =
    relativeSource(root, importer, specifier, maps.bySource) ??
    packedSource(importer, specifier, maps.bySource);
  if (!specifier.startsWith(".")) return null;
  const emittedPath = posix.normalize(posix.join(posix.dirname(maps.chunkFile), specifier));
  const targetRows = (target && maps.bySource.get(target)) ?? maps.byChunkPath.get(emittedPath);
  if (!targetRows) return null;
  const paths = new Set(sourceRows.map((row) => pathForConsumer(targetRows, row.output)));
  if (paths.size !== 1)
    throw new Error(`${importer}: import ${specifier} resolves to different mod-local paths`);
  return [...paths][0];
}

export function packModLocalImportsPlugin({
  rows,
  root,
}: {
  rows: Iterable<readonly [string, ManifestRow]>;
  root: string;
}) {
  const bySource = new Map<string, SourceRow[]>();
  const byPackId = new Map<string, SourceRow[]>();
  for (const [output, row] of rows) {
    if (!row.source.endsWith(".ts") || !row.packId) continue;
    const sourceRows = bySource.get(row.source) ?? [];
    sourceRows.push({ ...row, output });
    bySource.set(row.source, sourceRows);
    byPackId.set(row.packId, sourceRows);
  }

  return {
    name: "herdr-mod-local-imports",
    renderChunk(code: string, chunk: { fileName: string }): string | null {
      const packId = chunk.fileName.split("/").at(-1)?.replace(/\.js$/, "");
      const sourceRows = byPackId.get(packId ?? "");
      if (!sourceRows) return null;
      const byChunkPath = new Map(
        [...byPackId].map(([id, candidateRows]) => [
          posix.join(posix.dirname(chunk.fileName), `${id}.js`),
          candidateRows,
        ]),
      );
      const source = sourceRows[0].source;
      const imports = importSources(parse(code, { sourceType: "module" }));
      const replacements: { start: number; end: number; value: string }[] = [];
      for (const item of imports) {
        if (
          typeof item.value !== "string" ||
          typeof item.start !== "number" ||
          typeof item.end !== "number"
        )
          continue;
        const replacement = outputSpecifier(sourceRows, root, source, item.value, {
          bySource,
          byChunkPath,
          chunkFile: chunk.fileName,
        });
        if (!replacement) continue;
        if (replacement !== item.value)
          replacements.push({
            start: item.start,
            end: item.end,
            value: `${code[item.start]}${replacement}${code[item.end - 1]}`,
          });
      }
      if (!replacements.length) return null;
      let output = code;
      for (const item of [...replacements].reverse())
        output = `${output.slice(0, item.start)}${item.value}${output.slice(item.end)}`;
      return output;
    },
  };
}
