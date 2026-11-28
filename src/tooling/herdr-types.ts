import { parse } from "@babel/parser";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUT = join(ROOT, "types/herdr/host.d.ts");
const RELEASE = JSON.parse(readFileSync(join(ROOT, "types/herdr/release.json"), "utf8")) as {
  version: string;
};
const REQUIRED_MODULES = [
  "gpui-kit",
  "gpui",
  "gpui-base",
  "gpui-component",
  "gpui-shell",
  "gpui-fps",
  "herdr",
];
const HERITAGE_ANCHOR = 'export interface ElementBounds extends import("gpui-kit").Point {';
const SHELL_MODULE_ANCHOR = 'declare module "gpui-shell" {';

function exactReplace(source: string, search: string, replacement: string): string {
  const count = source.split(search).length - 1;
  if (count !== 1)
    throw new Error(`expected exactly one host declaration anchor, found ${count}: ${search}`);
  return source.replace(search, replacement);
}

function stripComments(
  source: string,
  start: number,
  end: number,
  comments: { start?: number; end?: number }[],
): string {
  const segments: string[] = [];
  let cursor = start;
  for (const comment of comments) {
    if (
      comment.start === undefined ||
      comment.end === undefined ||
      comment.start < start ||
      comment.end > end
    )
      continue;
    segments.push(source.slice(cursor, comment.start));
    const lineBreaks =
      source
        .slice(comment.start, comment.end)
        .match(/\r\n|\r|\n/g)
        ?.join("") ?? " ";
    segments.push(lineBreaks);
    cursor = comment.end;
  }
  segments.push(source.slice(cursor, end));
  return segments.join("").trim();
}

export function buildHostTypes(source: string): string {
  const normalized = exactReplace(
    source,
    HERITAGE_ANCHOR,
    "export interface ElementBounds extends GpuiPoint {",
  );
  const withTypeImport = exactReplace(
    normalized,
    SHELL_MODULE_ANCHOR,
    `${SHELL_MODULE_ANCHOR}\n  import type { Point as GpuiPoint } from "gpui-kit";`,
  );
  const ast = parse(withTypeImport, {
    sourceType: "module",
    plugins: [["typescript", { dts: true }]],
  });
  const modules = new Map<string, { start: number; end: number }>();
  for (const node of ast.program.body) {
    if (
      node.type !== "TSModuleDeclaration" ||
      node.id.type !== "StringLiteral" ||
      node.start == null ||
      node.end == null
    )
      continue;
    if (modules.has(node.id.value))
      throw new Error(`duplicate host module declaration: ${node.id.value}`);
    modules.set(node.id.value, { start: node.start, end: node.end });
  }
  const missing = REQUIRED_MODULES.filter((name) => !modules.has(name));
  if (missing.length) throw new Error(`missing required host modules: ${missing.join(", ")}`);
  const comments = ast.comments ?? [];
  return `${REQUIRED_MODULES.map((name) => {
    const range = modules.get(name);
    if (!range) throw new Error(`missing required host module: ${name}`);
    return stripComments(withTypeImport, range.start, range.end, comments);
  }).join("\n\n")}\n`;
}

function run(
  binary: string,
  args: string[],
  env: Record<string, string | undefined> = process.env,
): string {
  const result = spawnSync(binary, args, { encoding: "utf8", env });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${binary} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

export function writeOrCheckHostTypes(
  mode: "write" | "check",
  binary = process.env.HERDR_APP_BIN ?? "herdr-app",
): void {
  const version = run(binary, ["--version"]);
  if (!version.endsWith(` ${RELEASE.version}`))
    throw new Error(`expected Herdr ${RELEASE.version}, received ${version}`);
  const workspace = mkdtempSync(join(tmpdir(), "herdr-types-"));
  const appHome = join(workspace, "home");
  const appRoot = join(workspace, "app");
  mkdirSync(appHome, { recursive: true });
  mkdirSync(appRoot, { recursive: true });
  try {
    run(binary, ["types", appRoot], { ...process.env, HERDR_APP_HOME: appHome });
    const actual = buildHostTypes(readFileSync(join(appRoot, "gpui-kit.d.ts"), "utf8"));
    if (mode === "write") {
      mkdirSync(dirname(OUTPUT), { recursive: true });
      writeFileSync(OUTPUT, actual);
      return;
    }
    const expected = readFileSync(OUTPUT, "utf8");
    if (actual !== expected)
      throw new Error(
        "Herdr host declaration snapshot is stale; run vpx src/tooling/herdr-types.ts --write with the pinned Herdr release",
      );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

const mode = process.argv[2];
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (mode !== "--write" && mode !== "--check")
    throw new Error("usage: vpx src/tooling/herdr-types.ts --write|--check");
  writeOrCheckHostTypes(mode === "--write" ? "write" : "check");
}
