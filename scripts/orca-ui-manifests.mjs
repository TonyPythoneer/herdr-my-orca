// Read the Orca UI manifests from disk and answer one question for the builder and where-error:
// which repo file produces each delivered `mods/<mod>/<file>`.
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Where things live. Everything the scripts assume about the repo layout is named here.
const FEATURES_DIR = "orca-ui/features";
export const SHARED = "orca-ui/shared";
const MANIFEST_FILE = "manifest.json";
// Herdr writes these into a mod folder when it checks the mod; they are never builder output.
const RESERVED = ["gpui-kit.d.ts", "jsconfig.json"];
const FEATURE_FIELDS = ["feature", "mod", "source", "output", "files", "tests", "layoutSlots", "keys"];
const OPTIONAL_FIELDS = ["handwritten"];
export const MODE_MASK = 0o777;
const MOD_NAME = /^[A-Za-z0-9][\w.-]*$/;

export class ManifestError extends Error {
  constructor(message, path) {
    super(message);
    this.name = "ManifestError";
    this.path = path;
  }
}

const failer = path => message => { throw new ManifestError(message, path); };
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const strings = value => Array.isArray(value) && value.every(v => typeof v === "string");
const modeOf = (root, rel) => statSync(join(root, rel)).mode & MODE_MASK;
const modOf = dest => dest.split("/")[1];
const inMod = (output, file) => posix.join(output, posix.normalize(file));

// A normalized relative path that stays inside its base folder, or null.
function relativeInside(path) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\")) return null;
  const clean = posix.normalize(path);
  return clean === "." || clean === ".." || clean.startsWith("../") || clean.endsWith("/") ? null : clean;
}

export function walkFiles(dir, prefix = "") {
  const found = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === ".DS_Store") continue;
    if (lstatSync(join(dir, name)).isDirectory()) found.push(...walkFiles(join(dir, name), `${prefix}${name}/`));
    else found.push(`${prefix}${name}`);
  }
  return found;
}

function walkObjects(node, visit) {
  if (Array.isArray(node)) node.forEach(n => walkObjects(n, visit));
  else if (isObject(node)) { visit(node); Object.values(node).forEach(n => walkObjects(n, visit)); }
}

// Reads JSON that must live inside the repo; a symlink out of it is refused.
function readJson(root, rel, fail) {
  try {
    const real = realpathSync(join(root, rel));
    if (!real.startsWith(realpathSync(root) + sep)) throw new Error("resolves outside the repo");
    return JSON.parse(readFileSync(real, "utf8"));
  } catch (error) { return fail(`cannot read ${rel}: ${error.message}`); }
}

// A regular file at `rel` under `base` that really lives under `base`, or a failure.
function requireSourceFile(root, base, rel, fail) {
  const shown = `${base}/${rel}`;
  let stat;
  try { stat = lstatSync(join(root, shown)); } catch { fail(`missing source ${shown}`); }
  if (!stat.isFile()) fail(`${shown} is not a regular file`);
  if (!realpathSync(join(root, shown)).startsWith(realpathSync(join(root, base)) + sep)) fail(`${shown} resolves outside the source folder`);
}

// Every feature manifest path, repo relative, sorted.
function discover(root) {
  if (!existsSync(join(root, FEATURES_DIR))) return [];
  return walkFiles(join(root, FEATURES_DIR)).filter(f => posix.basename(f) === MANIFEST_FILE).map(f => `${FEATURES_DIR}/${f}`).sort();
}

function checkFeatureFields(m, fail) {
  if (!isObject(m)) fail("manifest must be an object");
  for (const key of Object.keys(m)) if (![...FEATURE_FIELDS, ...OPTIONAL_FIELDS].includes(key)) fail(`unknown field "${key}"`);
  for (const key of FEATURE_FIELDS) if (m[key] === undefined) fail(`missing "${key}"`);
}

function checkFeatureNames(m, path, fail) {
  if (typeof m.feature !== "string" || !m.feature) fail('"feature" must be a non-empty string');
  if (typeof m.mod !== "string" || !MOD_NAME.test(m.mod)) fail('"mod" must be one folder name');
  if (m.source !== posix.dirname(path)) fail(`"source" must be ${posix.dirname(path)}`);
  if (m.output !== `mods/${m.mod}`) fail(`"output" must be mods/${m.mod}`);
}

function checkFeatureLists(m, fail) {
  if (m.handwritten === undefined) m.handwritten = []; // a manifest with no handwritten files may leave the list out
  for (const key of ["files", "handwritten", "tests", "keys"]) if (!strings(m[key])) fail(`"${key}" must be an array of strings`);
  if (!isObject(m.layoutSlots) || !Object.values(m.layoutSlots).every(strings)) fail('"layoutSlots" must map layout names to arrays of ids');
  for (const file of m.handwritten) if (!relativeInside(file)) fail(`handwritten entry "${file}" is not a path inside the mod`);
}

function checkFeatureShape(m, path, fail) {
  checkFeatureFields(m, fail);
  checkFeatureNames(m, path, fail);
  checkFeatureLists(m, fail);
}

// `files` plus `tests` plus the manifest must be exactly what is in the source folder.
function checkFeatureSources(root, m, fail) {
  if (!(realpathSync(join(root, m.source)) + sep).startsWith(realpathSync(root) + sep)) fail("source folder is outside the repo");
  const declared = new Set([MANIFEST_FILE]);
  for (const [label, list] of [["files", m.files], ["tests", m.tests]]) {
    for (const file of list) {
      const rel = relativeInside(file) ?? fail(`${label} entry "${file}" is not a path inside the source folder`);
      if (declared.has(rel)) fail(`"${rel}" is declared twice`);
      declared.add(rel);
      requireSourceFile(root, m.source, rel, fail);
    }
  }
  for (const file of walkFiles(join(root, m.source))) if (!declared.has(file)) fail(`${m.source}/${file} is not listed in the manifest`);
}

// Each slot id must name exactly one layout node, and that node must mount this mod.
function checkLayoutSlots(root, m, fail) {
  for (const [layout, ids] of Object.entries(m.layoutSlots)) {
    if (!MOD_NAME.test(layout)) fail(`layout name "${layout}" is not a layout file name`);
    const tree = readJson(root, `layouts/${layout}.json`, fail);
    for (const id of ids) {
      const hits = [];
      walkObjects(tree, node => { if (node.id === id) hits.push(node); });
      if (hits.length !== 1) fail(`layouts/${layout}.json has ${hits.length} nodes with id "${id}", expected 1`);
      if (hits[0].content?.mod !== m.mod) fail(`layouts/${layout}.json node "${id}" does not mount mod ${m.mod}`);
    }
  }
}

function checkKeySections(root, m, fail) {
  if (!m.keys.length) return;
  const sections = readJson(root, "keys.json", fail);
  if (!isObject(sections)) fail("keys.json must be an object");
  for (const key of m.keys) if (!Object.hasOwn(sections, key)) fail(`keys.json has no section "${key}"`);
}

function parseFeature(root, path) {
  const fail = failer(path);
  const m = readJson(root, path, fail);
  checkFeatureShape(m, path, fail);
  checkFeatureSources(root, m, fail);
  checkLayoutSlots(root, m, fail);
  checkKeySections(root, m, fail);
  return m;
}

// Every output must be `mods/<mod>/<name>`, unclaimed so far, in a mod that has a mod.json.
function checkSharedOutputs(root, item, name, seen, fail) {
  if (!strings(item.outputs) || !item.outputs.length) fail(`${item.source}: "outputs" must be a non-empty array of strings`);
  // MOD_NAME without its ^ and $ anchors, so it can sit in the middle of the pattern.
  const shape = new RegExp(`^mods/${MOD_NAME.source.slice(1, -1)}/${name.replace(/\./g, "\\.")}$`);
  for (const out of item.outputs) {
    if (!shape.test(out)) fail(`output "${out}" must be mods/<mod>/${name}`);
    if (seen.outputs.has(out)) fail(`output ${out} is declared twice`);
    if (!existsSync(join(root, "mods", modOf(out), "mod.json"))) fail(`output ${out}: mods/${modOf(out)} has no mod.json, check the mod name`);
    seen.outputs.add(out);
  }
}

function checkSharedItem(root, item, seen, fail) {
  if (!isObject(item) || Object.keys(item).some(k => k !== "source" && k !== "outputs")) fail("each file needs only source and outputs");
  const name = typeof item.source === "string" && item.source.startsWith(`${SHARED}/`) ? item.source.slice(SHARED.length + 1) : null;
  if (!name || !/^[\w.-]+\.js$/.test(name)) fail(`source "${item.source}" must be ${SHARED}/<name>.js`);
  if (seen.sources.has(name)) fail(`source ${item.source} is declared twice`);
  seen.sources.add(name);
  requireSourceFile(root, SHARED, name, fail);
  checkSharedOutputs(root, item, name, seen, fail);
}

// `orca-ui/shared/manifest.json`: `{ files: [{ source, outputs }] }`. Required, so a mistyped
// --root or a deleted folder is an error rather than a silently empty build.
function parseShared(root) {
  const path = `${SHARED}/${MANIFEST_FILE}`;
  const fail = failer(path);
  let realDir;
  try { realDir = realpathSync(join(root, SHARED)); } catch { fail(`${SHARED} does not exist`); }
  if (realDir !== join(realpathSync(root), ...SHARED.split("/"))) fail(`${SHARED} is a symlink or leaves the repo`);
  const m = readJson(root, path, fail);
  if (!isObject(m) || Object.keys(m).some(k => k !== "files") || !Array.isArray(m.files)) fail('manifest must be { "files": [...] }');
  const seen = { sources: new Set([MANIFEST_FILE]), outputs: new Set() };
  for (const item of m.files) checkSharedItem(root, item, seen, fail);
  for (const file of walkFiles(join(root, SHARED))) if (!seen.sources.has(file)) fail(`${SHARED}/${file} is not listed in the manifest`);
  return m;
}

// The one table: destination -> who produces it. Rows say where to edit and what to run.
function row(root, { kind, id, source, consumers, owner }) {
  return { kind, id, source, mode: modeOf(root, source), consumers,
    tests: owner ? owner.tests.map(t => `${owner.source}/${t}`) : [], layoutSlots: owner?.layoutSlots ?? {} };
}

export function loadManifests({ root = ROOT } = {}) {
  const features = new Map();
  const table = new Map();
  const owners = new Map(); // destination -> who claimed it first
  // Reported against the later claimant's manifest; every claimant is a manifest path.
  const claim = (dest, who, path) => {
    const parts = dest.split("/");
    if (parts.length === 3 && RESERVED.includes(parts[2])) failer(path)(`${dest} is a Herdr reserved file (${who})`);
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
      table.set(dest, row(root, { kind: "feature", id: m.feature, source: `${m.source}/${posix.normalize(file)}`, consumers: [m.mod], owner: m }));
    }
  }

  const shared = parseShared(root);
  for (const item of shared.files) {
    const name = posix.basename(item.source);
    for (const dest of item.outputs) {
      claim(dest, `shared ${name}`, `${SHARED}/${MANIFEST_FILE}`);
      const owner = [...features.values()].find(f => f.mod === modOf(dest));
      table.set(dest, row(root, { kind: "shared", id: name, source: item.source, consumers: item.outputs.map(modOf), owner }));
    }
  }

  for (const [path, m] of features) for (const file of m.handwritten) claim(inMod(m.output, file), `handwritten in feature "${m.feature}"`, path);
  return { table, features, shared };
}

// Destination paths a build must leave alone inside a feature mod besides what it writes:
// handwritten and Herdr reserved files, as `mods/<mod>/<file>`.
export function allowedExtras({ features }) {
  const extras = new Set();
  for (const m of features.values()) {
    for (const file of m.handwritten) extras.add(inMod(m.output, file));
    for (const file of RESERVED) extras.add(`${m.output}/${file}`);
  }
  return extras;
}
