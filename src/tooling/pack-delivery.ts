import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifests } from "./orca-ui-manifests";
import { compiledSourceBytes } from "./packed-contract";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = fileURLToPath(new URL("../../tools/vite-plus-pilot/dist/", import.meta.url));
const output = join(dist, "delivery");
const paths = ["layouts", "mods", "themes", "keys.json", "programs.json", "settings.json"];
const excluded =
  /\.test\.[^/]+$|\.(?:golden|snap)\.json$|(?:^|\/)(?:flow-harness|golden)\.(?:js|mjs|cjs)$/;

type ManifestRow = { source: string; packId?: string };
type Exists = (path: string) => boolean;

export function isDeliveredFile(path: string): boolean {
  return !excluded.test(path);
}

export function selectInstallFiles(
  tracked: readonly string[],
  manifestPaths: Iterable<string>,
  exists: Exists,
): string[] {
  return [...new Set([...tracked, ...manifestPaths])]
    .filter((path) => exists(path) && isDeliveredFile(path))
    .sort();
}

export function selectTypedOutputs(
  table: ReadonlyMap<string, ManifestRow>,
): Map<string, ManifestRow> {
  return new Map([...table].filter(([, row]) => row.source.endsWith(".ts")));
}

export function deliveryReport({
  installFiles,
  trackedFiles,
  typedByOutput,
  manifestOutputs,
}: {
  installFiles: readonly string[];
  trackedFiles: readonly string[];
  typedByOutput: ReadonlyMap<string, ManifestRow>;
  manifestOutputs: number;
}): Record<string, number> {
  return {
    installationFiles: installFiles.length,
    excludedTestFiles: trackedFiles.filter((path) => !isDeliveredFile(path)).length,
    typedRuntimeCopies: typedByOutput.size,
    compiledSources: new Set([...typedByOutput.values()].map(({ source }) => source)).size,
    bytePreservedFiles: installFiles.length - typedByOutput.size,
    manifestOutputs,
  };
}

export function isDirectEntry(entry: string | undefined, modulePath: string): boolean {
  return Boolean(
    entry &&
    existsSync(resolve(entry)) &&
    realpathSync(resolve(entry)) === realpathSync(modulePath),
  );
}

export function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    return item.isDirectory() ? walk(path) : [path];
  });
}

export function command(bin: string, args: string[], cwd = root): string {
  const result = spawnSync(bin, args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${bin} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

export interface DeliveryWriteOptions {
  rootDir?: string;
  outputDir?: string;
  distDir?: string;
  compile?: (source: string, distDir: string, packId?: string) => Buffer;
}

type Compile = (source: string, distDir: string, packId?: string) => Buffer;

interface DeliveryContext {
  rootDir: string;
  outputDir: string;
  distDir: string;
  compile: Compile;
}

function writeInstallFiles(
  installFiles: readonly string[],
  typedByOutput: ReadonlyMap<string, ManifestRow>,
  { rootDir, outputDir, distDir, compile }: DeliveryContext,
): void {
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  for (const path of installFiles) {
    const original = join(rootDir, path);
    const mode = lstatSync(original);
    assert.ok(mode.isFile() && !mode.isSymbolicLink(), `not a regular file: ${path}`);
    const target = join(outputDir, path);
    mkdirSync(dirname(target), { recursive: true });
    const source = typedByOutput.get(path);
    if (source) writeFileSync(target, compile(source.source, distDir, source.packId));
    else copyFileSync(original, target);
    chmodSync(target, mode.mode & 0o777);
  }
}

function verifyInstallFiles(
  installFiles: readonly string[],
  typedByOutput: ReadonlyMap<string, ManifestRow>,
  { rootDir, outputDir, distDir, compile }: DeliveryContext,
): void {
  assert.deepEqual(
    walk(outputDir)
      .map((path) => relative(outputDir, path))
      .sort(),
    [...installFiles].sort(),
    "installation path inventory",
  );
  for (const path of installFiles) {
    const original = join(rootDir, path);
    const target = join(outputDir, path);
    assert.equal(lstatSync(target).mode & 0o777, lstatSync(original).mode & 0o777, `mode: ${path}`);
    const source = typedByOutput.get(path);
    assert.deepEqual(
      readFileSync(target),
      source ? compile(source.source, distDir, source.packId) : readFileSync(original),
      `bytes: ${path}`,
    );
    if (path.startsWith("mods/") && /\.[cm]?js$/.test(path))
      command(process.execPath, ["--check", target]);
  }
}

export function writeAndVerifyDelivery(
  installFiles: readonly string[],
  typedByOutput: ReadonlyMap<string, ManifestRow>,
  options: DeliveryWriteOptions = {},
): void {
  const context: DeliveryContext = {
    rootDir: options.rootDir ?? root,
    outputDir: options.outputDir ?? output,
    distDir: options.distDir ?? dist,
    compile: options.compile ?? compiledSourceBytes,
  };
  writeInstallFiles(installFiles, typedByOutput, context);
  verifyInstallFiles(installFiles, typedByOutput, context);
  assert.ok(existsSync(join(context.outputDir, "mods/orca-agent-settings/mod.json")));
}

async function main(): Promise<void> {
  const manifest = loadManifests({ root });
  const typedByOutput = selectTypedOutputs(manifest.table);
  assert.ok(typedByOutput.size, "missing typed manifest rows");
  console.log(command(join(root, "node_modules", ".bin", "vp"), ["pack"]));
  console.log(
    command(join(root, "node_modules", ".bin", "vpx"), [
      "src/tooling/build-orca-ui.ts",
      "--check",
      "--out",
      ".",
    ]),
  );
  const tracked = command("git", ["ls-files", "-z", "--", ...paths])
    .split("\0")
    .filter(Boolean);
  const installFiles = selectInstallFiles(tracked, manifest.table.keys(), (path) =>
    existsSync(join(root, path)),
  );
  assert.ok(tracked.length > 0 && manifest.table.size > 0);
  for (const name of typedByOutput.keys())
    assert.ok(installFiles.includes(name), `missing delivery target: ${name}`);
  assert.ok(
    installFiles.every(
      (path) => !/\.test\.[^/]+$/.test(path) && !/\.(?:golden|snap)\.json$/.test(path),
    ),
    "test code and snapshots cannot be delivered",
  );

  writeAndVerifyDelivery(installFiles, typedByOutput);
  console.log(
    JSON.stringify(
      deliveryReport({
        installFiles,
        trackedFiles: tracked,
        typedByOutput,
        manifestOutputs: manifest.table.size,
      }),
    ),
  );
}

if (isDirectEntry(process.argv[1], fileURLToPath(import.meta.url))) await main();
