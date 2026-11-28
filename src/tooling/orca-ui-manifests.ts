import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const FEATURES_DIR = "orca-ui/features";
export const SHARED = "orca-ui/shared";
export const BUILD_ENTRIES = "src/build-entries.json";
const MANIFEST_FILE = "manifest.json";

const RESERVED = ["gpui-kit.d.ts", "jsconfig.json"];
const FEATURE_FIELDS = [
  "feature",
  "mod",
  "source",
  "output",
  "files",
  "tests",
  "layoutSlots",
  "keys",
];
const OPTIONAL_FIELDS = ["handwritten"];
export const MODE_MASK = 0o777;
const MOD_NAME = /^[A-Za-z0-9][\w.-]*$/;

type JsonObject = Record<string, unknown>;
type Fail = (message: string) => never;

interface FeatureManifest {
  feature: string;
  mod: string;
  source: string;
  output: string;
  files: string[];
  tests: string[];
  layoutSlots: Record<string, string[]>;
  keys: string[];
  handwritten: string[];
}

interface SharedFile {
  source: string;
  outputs: string[];
}
interface SharedManifest {
  files: SharedFile[];
}
interface BuildEntry {
  id: string;
  source: string;
  output: string;
}
interface BuildManifest {
  entries: BuildEntry[];
}
interface ManifestRow {
  kind: string;
  id: string;
  source: string;
  mode: number;
  consumers: string[];
  tests: string[];
  layoutSlots: Record<string, string[]>;
  packId?: string;
}
interface OwnerMap {
  sources: Set<string>;
  outputs: Set<string>;
  ids: Set<string>;
}
interface LoadResult {
  table: Map<string, ManifestRow>;
  features: Map<string, FeatureManifest>;
  shared: SharedManifest;
  entries: BuildManifest;
}

export class ManifestError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(message);
    this.name = "ManifestError";
    this.path = path;
  }
}

const failer =
  (path: string): Fail =>
  (message: string) => {
    throw new ManifestError(message, path);
  };
const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");
const modeOf = (root: string, rel: string): number => statSync(join(root, rel)).mode & MODE_MASK;
const modOf = (dest: string): string => dest.split("/")[1] ?? "";
const inMod = (output: string, file: string): string => posix.join(output, posix.normalize(file));

function relativeInside(path: unknown): string | null {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\")) return null;
  const clean = posix.normalize(path);
  return clean === "." || clean === ".." || clean.startsWith("../") || clean.endsWith("/")
    ? null
    : clean;
}

export function walkFiles(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === ".DS_Store") continue;
    if (lstatSync(join(dir, name)).isDirectory())
      found.push(...walkFiles(join(dir, name), `${prefix}${name}/`));
    else found.push(`${prefix}${name}`);
  }
  return found;
}

function walkObjects(node: unknown, visit: (node: JsonObject) => void): void {
  if (Array.isArray(node)) node.forEach((n) => walkObjects(n, visit));
  else if (isObject(node)) {
    visit(node);
    Object.values(node).forEach((n) => walkObjects(n, visit));
  }
}

function readJson(root: string, rel: string, fail: Fail): unknown {
  try {
    const real = realpathSync(join(root, rel));
    if (!real.startsWith(realpathSync(root) + sep)) throw new Error("resolves outside the repo");
    return JSON.parse(readFileSync(real, "utf8"));
  } catch (error) {
    return fail(`cannot read ${rel}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireSourceFile(root: string, base: string, rel: string, fail: Fail): void {
  const shown = `${base}/${rel}`;
  let stat;
  try {
    stat = lstatSync(join(root, shown));
  } catch {
    return fail(`missing source ${shown}`);
  }
  if (!stat.isFile()) fail(`${shown} is not a regular file`);
  if (!realpathSync(join(root, shown)).startsWith(realpathSync(join(root, base)) + sep))
    fail(`${shown} resolves outside the source folder`);
}

function discover(root: string): string[] {
  if (!existsSync(join(root, FEATURES_DIR))) return [];
  return walkFiles(join(root, FEATURES_DIR))
    .filter((f) => posix.basename(f) === MANIFEST_FILE)
    .map((f) => `${FEATURES_DIR}/${f}`)
    .sort();
}

function checkFeatureFields(m: unknown, fail: Fail): asserts m is JsonObject {
  if (!isObject(m)) fail("manifest must be an object");
  for (const key of Object.keys(m))
    if (![...FEATURE_FIELDS, ...OPTIONAL_FIELDS].includes(key)) fail(`unknown field "${key}"`);
  for (const key of FEATURE_FIELDS) if (m[key] === undefined) fail(`missing "${key}"`);
}

function checkFeatureNames(m: JsonObject, path: string, fail: Fail): void {
  if (typeof m.feature !== "string" || !m.feature) fail('"feature" must be a non-empty string');
  if (typeof m.mod !== "string" || !MOD_NAME.test(m.mod)) fail('"mod" must be one folder name');
  if (m.source !== posix.dirname(path)) fail(`"source" must be ${posix.dirname(path)}`);
  if (m.output !== `mods/${m.mod}`) fail(`"output" must be mods/${m.mod}`);
}

function checkFeatureLists(m: JsonObject, fail: Fail): void {
  if (m.handwritten === undefined) m.handwritten = [];
  for (const key of ["files", "handwritten", "tests", "keys"])
    if (!strings(m[key])) fail(`"${key}" must be an array of strings`);
  if (!isObject(m.layoutSlots) || !Object.values(m.layoutSlots).every(strings))
    fail('"layoutSlots" must map layout names to arrays of ids');
  const handwritten = m.handwritten;
  if (strings(handwritten))
    for (const file of handwritten)
      if (!relativeInside(file)) fail(`handwritten entry "${file}" is not a path inside the mod`);
}

function checkFeatureShape(m: unknown, path: string, fail: Fail): asserts m is FeatureManifest {
  checkFeatureFields(m, fail);
  checkFeatureNames(m, path, fail);
  checkFeatureLists(m, fail);
}

function checkFeatureSources(root: string, m: FeatureManifest, fail: Fail): void {
  if (!(realpathSync(join(root, m.source)) + sep).startsWith(realpathSync(root) + sep))
    fail("source folder is outside the repo");
  const declared = new Set([MANIFEST_FILE]);
  for (const [label, list] of [
    ["files", m.files],
    ["tests", m.tests],
  ]) {
    for (const file of list) {
      const rel =
        relativeInside(file) ??
        fail(`${label} entry "${file}" is not a path inside the source folder`);
      if (declared.has(rel)) fail(`"${rel}" is declared twice`);
      declared.add(rel);
      requireSourceFile(root, m.source, rel, fail);
    }
  }
  for (const file of walkFiles(join(root, m.source)))
    if (!declared.has(file)) fail(`${m.source}/${file} is not listed in the manifest`);
}

function checkLayoutSlots(root: string, m: FeatureManifest, fail: Fail): void {
  for (const [layout, ids] of Object.entries(m.layoutSlots)) {
    if (!MOD_NAME.test(layout)) fail(`layout name "${layout}" is not a layout file name`);
    const tree = readJson(root, `layouts/${layout}.json`, fail);
    for (const id of ids) {
      const hits: JsonObject[] = [];
      walkObjects(tree, (node) => {
        if (node.id === id) hits.push(node);
      });
      if (hits.length !== 1)
        fail(`layouts/${layout}.json has ${hits.length} nodes with id "${id}", expected 1`);
      if (!isObject(hits[0].content) || hits[0].content.mod !== m.mod)
        fail(`layouts/${layout}.json node "${id}" does not mount mod ${m.mod}`);
    }
  }
}

function checkKeySections(root: string, m: FeatureManifest, fail: Fail): void {
  if (!m.keys.length) return;
  const sections = readJson(root, "keys.json", fail);
  if (!isObject(sections)) fail("keys.json must be an object");
  for (const key of m.keys)
    if (!Object.hasOwn(sections, key)) fail(`keys.json has no section "${key}"`);
}

function parseFeature(root: string, path: string): FeatureManifest {
  const fail = failer(path);
  const m = readJson(root, path, fail);
  checkFeatureShape(m, path, fail);
  checkFeatureSources(root, m, fail);
  checkLayoutSlots(root, m, fail);
  checkKeySections(root, m, fail);
  return m;
}

function checkSharedOutputs(
  root: string,
  item: JsonObject,
  name: string,
  seen: OwnerMap,
  fail: Fail,
): void {
  if (!strings(item.outputs) || !item.outputs.length)
    fail(`${item.source}: "outputs" must be a non-empty array of strings`);

  const shape = new RegExp(`^mods/${MOD_NAME.source.slice(1, -1)}/${name.replace(/\./g, "\\.")}$`);
  for (const out of item.outputs) {
    if (!shape.test(out)) fail(`output "${out}" must be mods/<mod>/${name}`);
    if (seen.outputs.has(out)) fail(`output ${out} is declared twice`);
    if (!existsSync(join(root, "mods", modOf(out), "mod.json")))
      fail(`output ${out}: mods/${modOf(out)} has no mod.json, check the mod name`);
    seen.outputs.add(out);
  }
}

function sharedOutputName(root: string, source: unknown, seen: OwnerMap, fail: Fail): string {
  if (typeof source === "string" && source.startsWith(`${SHARED}/`)) {
    const name = source.slice(SHARED.length + 1);
    if (/^[\w.-]+\.js$/.test(name)) {
      if (seen.sources.has(name)) fail(`source ${source} is declared twice`);
      seen.sources.add(name);
      requireSourceFile(root, SHARED, name, fail);
      return name;
    }
  }
  if (typeof source === "string" && source.startsWith("src/shared/")) {
    const name = source.slice("src/shared/".length);
    if (/^[\w.-]+\.ts$/.test(name)) {
      if (seen.sources.has(source)) fail(`source ${source} is declared twice`);
      seen.sources.add(source);
      requireSourceFile(root, "src/shared", name, fail);
      return name.replace(/\.ts$/, ".js");
    }
  }
  fail(`source "${source}" must be ${SHARED}/<name>.js or src/shared/<name>.ts`);
}

function checkSharedItem(
  root: string,
  item: unknown,
  seen: OwnerMap,
  fail: Fail,
): asserts item is SharedFile {
  if (!isObject(item) || Object.keys(item).some((k) => k !== "source" && k !== "outputs"))
    fail("each file needs only source and outputs");
  checkSharedOutputs(root, item, sharedOutputName(root, item.source, seen, fail), seen, fail);
}

function parseShared(root: string): SharedManifest {
  const path = `${SHARED}/${MANIFEST_FILE}`;
  const fail = failer(path);
  let realDir;
  try {
    realDir = realpathSync(join(root, SHARED));
  } catch {
    fail(`${SHARED} does not exist`);
  }
  if (realDir !== join(realpathSync(root), ...SHARED.split("/")))
    fail(`${SHARED} is a symlink or leaves the repo`);
  const m = readJson(root, path, fail);
  if (!isObject(m)) return fail('manifest must be { "files": [...] }');
  if (Object.keys(m).some((k) => k !== "files") || !Array.isArray(m.files))
    return fail('manifest must be { "files": [...] }');
  const manifestFiles = m.files;
  if (!Array.isArray(manifestFiles)) return fail('manifest must be { "files": [...] }');
  const seen: OwnerMap = { sources: new Set([MANIFEST_FILE]), outputs: new Set(), ids: new Set() };
  const files: SharedFile[] = [];
  for (const item of manifestFiles) {
    checkSharedItem(root, item, seen, fail);
    files.push(item);
  }
  for (const file of walkFiles(join(root, SHARED)))
    if (!seen.sources.has(file)) fail(`${SHARED}/${file} is not listed in the manifest`);
  return { files };
}

function checkBuildEntryId(entry: BuildEntry, ids: Set<string>, fail: Fail): void {
  if (typeof entry.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(entry.id))
    fail('"id" must be a lowercase Pack entry id');
  if (ids.has(entry.id)) fail(`entry id ${entry.id} is declared twice`);
  ids.add(entry.id);
}

function checkBuildEntrySource(
  root: string,
  entry: BuildEntry,
  sources: Set<string>,
  fail: Fail,
): void {
  if (
    typeof entry.source !== "string" ||
    !entry.source.startsWith("src/") ||
    !entry.source.endsWith(".ts") ||
    relativeInside(entry.source) !== entry.source
  )
    fail(`source "${entry.source}" must be a TypeScript file inside src`);
  if (sources.has(entry.source)) fail(`source ${entry.source} is declared twice`);
  requireSourceFile(root, "src", entry.source.slice("src/".length), fail);
  sources.add(entry.source);
}

function checkBuildEntryOutput(
  root: string,
  entry: BuildEntry,
  outputs: Set<string>,
  fail: Fail,
): void {
  const expected = `mods/${entry.source.slice("src/mods/".length).replace(/\.ts$/, ".js")}`;
  if (
    !entry.source.startsWith("src/mods/") ||
    entry.output !== expected ||
    !relativeInside(entry.output)
  )
    fail(`output "${entry.output}" must mirror its src/mods TypeScript source as mods/**/*.js`);
  if (outputs.has(entry.output)) fail(`output ${entry.output} is declared twice`);
  const mod = modOf(entry.output);
  if (!existsSync(join(root, "mods", mod, "mod.json")))
    fail(`output ${entry.output}: mods/${mod} has no mod.json`);
  outputs.add(entry.output);
}

function checkBuildEntry(
  root: string,
  entry: unknown,
  seen: OwnerMap,
  fail: Fail,
): asserts entry is BuildEntry {
  if (
    !isObject(entry) ||
    Object.keys(entry).some((key) => !["id", "source", "output"].includes(key))
  )
    fail("each entry needs only id, source and output");
  const parsed = entry as unknown as BuildEntry;
  checkBuildEntryId(parsed, seen.ids, fail);
  checkBuildEntrySource(root, parsed, seen.sources, fail);
  checkBuildEntryOutput(root, parsed, seen.outputs, fail);
}

function parseBuildEntries(root: string): BuildManifest {
  const fail = failer(BUILD_ENTRIES);
  const manifest = readJson(root, BUILD_ENTRIES, fail);
  if (!isObject(manifest)) return fail('manifest must be { "entries": [...] }');
  if (Object.keys(manifest).some((key) => key !== "entries") || !Array.isArray(manifest.entries))
    return fail('manifest must be { "entries": [...] }');
  const manifestEntries = manifest.entries;
  if (!Array.isArray(manifestEntries)) return fail('manifest must be { "entries": [...] }');
  const seen: OwnerMap = { ids: new Set(), sources: new Set(), outputs: new Set() };
  const entries: BuildEntry[] = [];
  for (const entry of manifestEntries) {
    checkBuildEntry(root, entry, seen, fail);
    entries.push(entry);
  }
  return { entries };
}

function row(
  root: string,
  {
    kind,
    id,
    source,
    consumers,
    owner,
  }: { kind: string; id: string; source: string; consumers: string[]; owner?: FeatureManifest },
): ManifestRow {
  return {
    kind,
    id,
    source,
    mode: modeOf(root, source),
    consumers,
    tests: owner ? owner.tests.map((t) => `${owner.source}/${t}`) : [],
    layoutSlots: owner?.layoutSlots ?? {},
  };
}

function addBuildEntries(
  root: string,
  entries: BuildManifest,
  table: Map<string, ManifestRow>,
  packIds: Set<string>,
  claim: (dest: string, who: string, path: string) => void,
): void {
  for (const entry of entries.entries) {
    if (packIds.has(entry.id))
      failer(BUILD_ENTRIES)(`Pack entry id ${entry.id} is already declared`);
    claim(entry.output, `build entry ${entry.id}`, BUILD_ENTRIES);
    packIds.add(entry.id);
    table.set(entry.output, {
      ...row(root, {
        kind: "entry",
        id: entry.id,
        source: entry.source,
        consumers: [modOf(entry.output)],
      }),
      packId: entry.id,
    });
  }
}

export function loadManifests({ root = ROOT }: { root?: string } = {}): LoadResult {
  const features = new Map<string, FeatureManifest>();
  const table = new Map<string, ManifestRow>();
  const owners = new Map<string, string>();

  const claim = (dest: string, who: string, path: string): void => {
    const parts = dest.split("/");
    if (parts.length === 3 && RESERVED.includes(parts[2]))
      failer(path)(`${dest} is a Herdr reserved file (${who})`);
    if (owners.has(dest)) failer(path)(`${dest} is claimed by both ${owners.get(dest)} and ${who}`);
    owners.set(dest, who);
  };

  for (const path of discover(root)) {
    const m = parseFeature(root, path);
    const twin = [...features].find(([, other]) => other.feature === m.feature);
    if (twin) failer(path)(`feature "${m.feature}" is already defined in ${twin[0]}`);
    features.set(path, m);
    for (const file of m.files) {
      const dest = inMod(m.output, file);
      claim(dest, `feature "${m.feature}"`, path);
      table.set(
        dest,
        row(root, {
          kind: "feature",
          id: m.feature,
          source: `${m.source}/${posix.normalize(file)}`,
          consumers: [m.mod],
          owner: m,
        }),
      );
    }
  }

  const shared = parseShared(root);
  for (const item of shared.files) {
    const name = posix.basename(item.source);
    for (const dest of item.outputs) {
      claim(dest, `shared ${name}`, `${SHARED}/${MANIFEST_FILE}`);
      const owner = [...features.values()].find((f) => f.mod === modOf(dest));
      table.set(dest, {
        ...row(root, {
          kind: "shared",
          id: name,
          source: item.source,
          consumers: item.outputs.map(modOf),
          owner,
        }),
        ...(item.source.endsWith(".ts") ? { packId: posix.basename(item.source, ".ts") } : {}),
      });
    }
  }

  const entries = parseBuildEntries(root);
  const packIds = new Set(
    [...table.values()].map((item) => item.packId).filter((id): id is string => Boolean(id)),
  );
  addBuildEntries(root, entries, table, packIds, claim);

  for (const [path, m] of features)
    for (const file of m.handwritten)
      claim(inMod(m.output, file), `handwritten in feature "${m.feature}"`, path);
  return { table, features, shared, entries };
}

export function allowedExtras({ features }: Pick<LoadResult, "features">): Set<string> {
  const extras = new Set<string>();
  for (const m of features.values()) {
    for (const file of m.handwritten) extras.add(inMod(m.output, file));
    for (const file of RESERVED) extras.add(`${m.output}/${file}`);
  }
  return extras;
}
