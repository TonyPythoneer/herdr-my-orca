import assert from "node:assert/strict";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { register } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../../", import.meta.url);
const dist = new URL("../../tools/vite-plus-pilot/dist/", import.meta.url);

type ManifestSource = { source: string; outputs: string[] };
type BuildEntry = { id: string; source: string; output: string };
type ExportMap = Record<string, unknown>;
type ViewportModule = ExportMap & {
  scrolls: (count: number) => number;
  viewportHeight: (count: number, height: number, gap?: number) => number;
};
type PiHost = { registerProvider: (name: string, config: unknown) => void };

const PI_ENV = {
  HERDR_PI_BASE_URL: "https://models.example/v1",
  HERDR_PI_MODELS: '["herdr/model-a"]',
  HERDR_PI_MODEL_INFO: '{"herdr/model-a":{"contextWindow":32768,"maxTokens":8192}}',
  HERDR_PROVIDER_API_KEY: "test-key",
};

const PI_CONTRACT = [
  [
    "herdr",
    {
      baseUrl: "https://models.example/v1",
      api: "openai-completions",
      apiKey: "test-key",
      models: [
        {
          id: "herdr/model-a",
          name: "herdr/model-a",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 32768,
          maxTokens: 8192,
        },
      ],
    },
  ],
];

export function typedManifestRows(files: readonly ManifestSource[]): ManifestSource[] {
  return files.filter(({ source }) => source.endsWith(".ts"));
}

export function isDirectEntry(entry: string | undefined, modulePath: string): boolean {
  return Boolean(
    entry &&
    existsSync(resolve(entry)) &&
    realpathSync(resolve(entry)) === realpathSync(modulePath),
  );
}

export function compareExports(other: ExportMap, original: ExportMap, label: string): void {
  assert.deepEqual(Object.keys(other).sort(), Object.keys(original).sort(), label);
  for (const key of Object.keys(original))
    compareValue(other[key], original[key], `${label}: ${key}`);
}

export function compareValue(actual: unknown, expected: unknown, label: string): void {
  if (typeof expected === "function") {
    assert.equal(typeof actual, "function", label);
    assert.equal((actual as { name: string }).name, expected.name, label);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), label);
    assert.equal(actual.length, expected.length, label);
    expected.forEach((value, index) => compareValue(actual[index], value, `${label}[${index}]`));
  } else if (expected !== null && typeof expected === "object") {
    assert.ok(actual !== null && typeof actual === "object" && !Array.isArray(actual), label);
    const actualRecord = actual as ExportMap;
    assert.deepEqual(Object.keys(actualRecord).sort(), Object.keys(expected).sort(), label);
    for (const key of Object.keys(expected))
      compareValue(actualRecord[key], (expected as ExportMap)[key], `${label}.${key}`);
  } else {
    assert.deepEqual(actual, expected, label);
  }
}

export function compareViewport(
  other: ViewportModule,
  original: ViewportModule,
  label: string,
): void {
  compareExports(other, original, label);
  for (const key of ["ROW", "FULL_ROWS", "VISIBLE_ROWS"])
    assert.deepEqual(other[key], original[key], label);
  for (const count of [-1, 0, 1, 4, 5, 6, 100]) {
    assert.equal(other.scrolls(count), original.scrolls(count), label);
    for (const height of [0, 1, 30, 31.5]) {
      assert.equal(
        other.viewportHeight(count, height),
        original.viewportHeight(count, height),
        label,
      );
      for (const gap of [0, 2, 5])
        assert.equal(
          other.viewportHeight(count, height, gap),
          original.viewportHeight(count, height, gap),
          label,
        );
    }
  }
}

export function assertPlaceholderImports(code: string): void {
  assert.match(
    code,
    /from ["']\.\/panel-motion\.js["']/,
    "placeholder import must resolve to its mod-local shared helper",
  );
  assert.doesNotMatch(
    code,
    /(?:\.\.\/)+shared\/panel-motion/,
    "placeholder output must not import from the source tree",
  );
}

export function assertStatusPortsImports(code: string): void {
  for (const helper of ["scan", "clip", "icon-button"]) {
    assert.match(
      code,
      new RegExp(`from ["']\\./${helper}\\.js["']`),
      `status ports must import its mod-local ${helper}.js`,
    );
  }
  assert.doesNotMatch(
    code,
    /(?:\.\.\/)+shared\//,
    "status ports output must not import from the source tree",
  );
}

export function runPiProviderContract(provider: (host: PiHost) => void): unknown[][] {
  const previous = Object.fromEntries(Object.keys(PI_ENV).map((key) => [key, process.env[key]]));
  Object.assign(process.env, PI_ENV);
  const providers: unknown[][] = [];
  try {
    provider({ registerProvider: (...args) => providers.push(args) });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.deepEqual(providers, PI_CONTRACT, "Pi provider output contract");
  return providers;
}

export function buildArtifact(entry: BuildEntry, delivery: boolean): URL {
  return delivery
    ? new URL(`delivery/${entry.output}`, dist)
    : new URL(`typed/${entry.id}.js`, dist);
}

async function stageBuildEntries(
  entries: readonly BuildEntry[],
  sharedRows: readonly ManifestSource[],
): Promise<{ root: string; artifacts: Map<string, URL> }> {
  const typed = fileURLToPath(new URL("typed/", dist));
  const stageRoot = await mkdtemp(join(typed, ".mod-local-"));
  const artifacts = new Map<string, URL>();
  const copyTree = async (source: string, destination: string): Promise<void> => {
    await mkdir(destination, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const from = join(source, entry.name);
      const to = join(destination, entry.name);
      if (entry.isDirectory()) await copyTree(from, to);
      else await copyFile(from, to);
    }
  };
  const stage = async (artifact: URL, output: string): Promise<void> => {
    const path = join(stageRoot, output);
    await mkdir(dirname(path), { recursive: true });
    await copyFile(fileURLToPath(artifact), path);
  };
  try {
    const mods = new Set(entries.map((entry) => entry.output.split("/")[1]));
    for (const mod of mods) {
      await copyTree(fileURLToPath(new URL(`mods/${mod}/`, root)), join(stageRoot, "mods", mod));
    }
    for (const entry of entries) {
      const artifact = buildArtifact(entry, false);
      await stage(artifact, entry.output);
      artifacts.set(artifact.href, pathToFileURL(join(stageRoot, entry.output)));
    }
    for (const row of typedManifestRows(sharedRows)) {
      const sourceName = row.source.split("/").at(-1)?.replace(/\.ts$/, ".js") ?? "";
      const artifact = new URL(`typed/${sourceName}`, dist);
      for (const output of row.outputs) await stage(artifact, output);
    }
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true });
    throw error;
  }
  return { root: stageRoot, artifacts };
}

export async function verifyManifestOutputs(
  rows: readonly ManifestSource[],
  delivery: boolean,
  load: (url: URL) => Promise<ExportMap>,
): Promise<void> {
  for (const row of rows) {
    const sourceName = row.source.split("/").at(-1)?.replace(/\.ts$/, ".js") ?? "";
    const candidate = await load(new URL(`typed/${sourceName}`, dist));
    const original = await load(new URL(row.outputs[0], root));
    if (row.source === "src/primitives/list-viewport.ts")
      compareViewport(
        candidate as ViewportModule,
        original as ViewportModule,
        "Vite+ generated JS",
      );
    else compareExports(candidate, original, "Vite+ generated JS");
    for (const path of row.outputs) {
      const copy = await load(new URL(path, root));
      compareExports(copy, original, path);
      if (row.source === "src/primitives/list-viewport.ts")
        compareViewport(copy as ViewportModule, original as ViewportModule, path);
      if (delivery) {
        const packed = await load(new URL(`delivery/${path}`, dist));
        compareExports(packed, original, `packed ${path}`);
        if (row.source === "src/primitives/list-viewport.ts")
          compareViewport(packed as ViewportModule, original as ViewportModule, `packed ${path}`);
      }
    }
  }
}

export async function verifyBuildEntries(
  entries: readonly BuildEntry[],
  delivery: boolean,
  load: (url: URL) => Promise<ExportMap>,
  artifacts?: ReadonlyMap<string, URL>,
): Promise<void> {
  for (const entry of entries) {
    const artifact =
      artifacts?.get(buildArtifact(entry, false).href) ?? buildArtifact(entry, delivery);
    const built = await load(artifact);
    const original = await load(new URL(entry.output, root));
    compareExports(built, original, `build entry ${entry.id} exports`);
  }
}

async function main(): Promise<void> {
  const delivery = process.argv.includes("--delivery");
  const manifest = JSON.parse(
    await readFile(new URL("orca-ui/shared/manifest.json", root), "utf8"),
  ) as { files: ManifestSource[] };
  const rows = typedManifestRows(manifest.files);
  assert.ok(rows.length, "typed sources must be managed");
  const buildEntries = JSON.parse(
    await readFile(new URL("src/build-entries.json", root), "utf8"),
  ) as { entries: BuildEntry[] };
  const staged = delivery ? null : await stageBuildEntries(buildEntries.entries, manifest.files);
  try {
    register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
    const load = (url: URL): Promise<ExportMap> =>
      import((staged?.artifacts.get(url.href) ?? url).href);
    await verifyManifestOutputs(rows, delivery, load);
    await verifyBuildEntries(buildEntries.entries, delivery, load, staged?.artifacts);

    const piEntry = buildEntries.entries.find(({ id }) => id === "orca-agent-flyout-pi-provider");
    assert.ok(piEntry, "missing Pi provider build entry");
    const piArtifact = buildArtifact(piEntry, delivery);
    const piProvider = (await import(`${piArtifact.href}?verified=${Date.now()}`)).default as (
      host: PiHost,
    ) => void;
    runPiProviderContract(piProvider);

    const placeholderEntry = buildEntries.entries.find(
      ({ id }) => id === "orca-right-sidebar-placeholders-main",
    );
    assert.ok(placeholderEntry, "missing placeholder mod build entry");
    assertPlaceholderImports(await readFile(buildArtifact(placeholderEntry, delivery), "utf8"));

    const portsEntry = buildEntries.entries.find(({ id }) => id === "orca-status-ports-main");
    assert.ok(portsEntry, "missing status ports build entry");
    const portsArtifact = buildArtifact(portsEntry, delivery);
    assertStatusPortsImports(await readFile(portsArtifact, "utf8"));
    const portsModule = await load(portsArtifact);
    const originalPorts = await load(new URL(portsEntry.output, root));
    compareExports(portsModule, originalPorts, "status ports runtime output");
    console.log(
      "Export shapes and configured runtime probes passed for typed sources, manifest outputs, and build entries.",
    );
  } finally {
    if (staged) await rm(staged.root, { recursive: true, force: true });
  }
}

if (isDirectEntry(process.argv[1], fileURLToPath(import.meta.url))) await main();
