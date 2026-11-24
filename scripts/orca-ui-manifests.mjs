// Read the Orca UI manifests from disk and answer one question for the builder and where-error:
// which repo file produces each delivered `mods/<mod>/<file>`.
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Herdr writes these into a mod folder when it checks the mod; they are never builder output.
export const RESERVED = ["gpui-kit.d.ts", "jsconfig.json"];
const KEYS = new Set(["feature", "mod", "source", "output", "files", "handwritten", "tests", "layoutSlots", "keys"]);

export class ManifestError extends Error {
  constructor(message, path) {
    super(message);
    this.name = "ManifestError";
    this.path = path;
  }
}

// A normalized repo-relative path that stays inside `base`, or null.
function inside(base, path) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\")) return null;
  const clean = posix.normalize(path);
  if (clean === "." || clean === ".." || clean.startsWith("../") || clean.endsWith("/")) return null;
  return base ? posix.join(base, clean) : clean;
}

function walkFiles(dir, prefix = "") {
  const found = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === ".DS_Store") continue;
    const stat = lstatSync(join(dir, name));
    if (stat.isDirectory()) found.push(...walkFiles(join(dir, name), `${prefix}${name}/`));
    else found.push(`${prefix}${name}`);
  }
  return found;
}

// Every feature manifest path, repo relative, sorted.
function discover(root) {
  const top = join(root, "orca-ui", "features");
  if (!existsSync(top)) return [];
  return walkFiles(top).filter(f => f === "manifest.json" || f.endsWith("/manifest.json"))
    .map(f => `orca-ui/features/${f}`).sort();
}

const strings = value => Array.isArray(value) && value.every(v => typeof v === "string");

function readJson(root, rel, fail) {
  try {
    if (!realpathSync(join(root, rel)).startsWith(realpathSync(root) + sep)) throw new Error("resolves outside the repo");
    return JSON.parse(readFileSync(join(root, rel), "utf8"));
  } catch (error) { return fail(`cannot read ${rel}: ${error.message}`); }
}

function walkObjects(node, visit) {
  if (Array.isArray(node)) node.forEach(n => walkObjects(n, visit));
  else if (node && typeof node === "object") { visit(node); Object.values(node).forEach(n => walkObjects(n, visit)); }
}

function parseFeature(root, path) {
  const fail = message => { throw new ManifestError(message, path); };
  const m = readJson(root, path, fail);
  if (!m || typeof m !== "object" || Array.isArray(m)) fail("manifest must be an object");
  for (const key of Object.keys(m)) if (!KEYS.has(key)) fail(`unknown field "${key}"`);
  for (const key of ["feature", "mod", "source", "output", "files", "tests", "layoutSlots", "keys"]) {
    if (m[key] === undefined) fail(`missing "${key}"`);
  }
  if (typeof m.feature !== "string" || !m.feature) fail('"feature" must be a non-empty string');
  if (typeof m.mod !== "string" || !/^[A-Za-z0-9][\w.-]*$/.test(m.mod)) fail('"mod" must be one folder name');
  if (m.source !== posix.dirname(path)) fail(`"source" must be ${posix.dirname(path)}`);
  if (m.output !== `mods/${m.mod}`) fail(`"output" must be mods/${m.mod}`);
  if (m.handwritten === undefined) m.handwritten = [];
  for (const key of ["files", "handwritten", "tests", "keys"]) if (!strings(m[key])) fail(`"${key}" must be an array of strings`);
  if (!m.layoutSlots || typeof m.layoutSlots !== "object" || Array.isArray(m.layoutSlots) ||
      !Object.values(m.layoutSlots).every(strings)) fail('"layoutSlots" must map layout names to arrays of ids');

  const base = join(root, m.source);
  const realBase = realpathSync(base);
  if (!(realBase + sep).startsWith(realpathSync(root) + sep)) fail("source folder is outside the repo");
  const declared = new Set();
  for (const [label, list] of [["files", m.files], ["tests", m.tests]]) {
    for (const file of list) {
      const rel = inside("", file) ?? fail(`${label} entry "${file}" is not a path inside the source folder`);
      if (declared.has(rel)) fail(`"${rel}" is declared twice`);
      declared.add(rel);
      let stat;
      try { stat = lstatSync(join(base, rel)); } catch { fail(`missing source ${m.source}/${rel}`); }
      if (!stat.isFile()) fail(`${m.source}/${rel} is not a regular file`);
      if (!realpathSync(join(base, rel)).startsWith(realBase + sep)) fail(`${m.source}/${rel} resolves outside the source folder`);
    }
  }
  declared.add("manifest.json");
  for (const file of walkFiles(base)) if (!declared.has(file)) fail(`${m.source}/${file} is not listed in the manifest`);

  for (const file of m.handwritten) inside("", file) ?? fail(`handwritten entry "${file}" is not a path inside the mod`);
  const layouts = new Map();
  for (const [layout, ids] of Object.entries(m.layoutSlots)) {
    if (!/^[\w.-]+$/.test(layout)) fail(`layout name "${layout}" is not a layout file name`);
    if (!layouts.has(layout)) layouts.set(layout, readJson(root, `layouts/${layout}.json`, fail));
    for (const id of ids) {
      const hits = [];
      walkObjects(layouts.get(layout), node => { if (node.id === id) hits.push(node); });
      if (hits.length !== 1) fail(`layouts/${layout}.json has ${hits.length} nodes with id "${id}", expected 1`);
      if (hits[0].content?.mod !== m.mod) fail(`layouts/${layout}.json node "${id}" does not mount mod ${m.mod}`);
    }
  }
  if (m.keys.length) {
    const sections = readJson(root, "keys.json", fail);
    if (!sections || typeof sections !== "object" || Array.isArray(sections)) fail("keys.json must be an object");
    for (const key of m.keys) if (!Object.hasOwn(sections, key)) fail(`keys.json has no section "${key}"`);
  }
  return m;
}

export const SHARED = "orca-ui/shared";

// `orca-ui/shared/manifest.json`: `{ files: [{ source, outputs }] }`. Required, so a mistyped
// --root or a deleted folder is an error rather than a silently empty build.
function parseShared(root) {
  const path = `${SHARED}/manifest.json`;
  const fail = message => { throw new ManifestError(message, path); };
  let realDir;
  try { realDir = realpathSync(join(root, SHARED)); } catch { fail(`${SHARED} does not exist`); }
  if (realDir !== join(realpathSync(root), "orca-ui", "shared")) fail(`${SHARED} is a symlink or leaves the repo`);
  const m = readJson(root, path, fail);
  if (!m || typeof m !== "object" || Array.isArray(m) || Object.keys(m).some(k => k !== "files") || !Array.isArray(m.files)) {
    fail('manifest must be { "files": [...] }');
  }
  const listed = new Set(["manifest.json"]);
  const outputs = new Set();
  for (const item of m.files) {
    if (!item || typeof item !== "object" || Object.keys(item).some(k => k !== "source" && k !== "outputs")) fail("each file needs only source and outputs");
    const name = typeof item.source === "string" && item.source.startsWith(`${SHARED}/`) ? item.source.slice(SHARED.length + 1) : null;
    if (!name || !/^[\w.-]+\.js$/.test(name)) fail(`source "${item.source}" must be ${SHARED}/<name>.js`);
    if (listed.has(name)) fail(`source ${item.source} is declared twice`);
    listed.add(name);
    let stat;
    try { stat = lstatSync(join(root, item.source)); } catch { fail(`missing source ${item.source}`); }
    if (!stat.isFile()) fail(`${item.source} is not a regular file`);
    if (!strings(item.outputs) || !item.outputs.length) fail(`${item.source}: "outputs" must be a non-empty array of strings`);
    for (const out of item.outputs) {
      if (!new RegExp(`^mods/[A-Za-z0-9][\\w.-]*/${name.replace(/\./g, "\\.")}$`).test(out)) fail(`output "${out}" must be mods/<mod>/${name}`);
      if (outputs.has(out)) fail(`output ${out} is declared twice`);
      if (!existsSync(join(root, "mods", out.split("/")[1], "mod.json"))) fail(`output ${out}: mods/${out.split("/")[1]} has no mod.json, check the mod name`);
      outputs.add(out);
    }
  }
  for (const file of walkFiles(join(root, SHARED))) if (!listed.has(file)) fail(`${SHARED}/${file} is not listed in the manifest`);
  return m;
}

export function loadManifests({ root = ROOT } = {}) {
  const features = new Map();
  const table = new Map();
  const owners = new Map(); // destination -> [who, manifest path]
  const ids = new Map();
  const claim = (dest, who, path) => {
    const parts = dest.split("/");
    if (parts.length === 3 && RESERVED.includes(parts[2])) throw new ManifestError(`${dest} is a Herdr reserved file (${who})`, path);
    if (owners.has(dest)) {
      const [first, firstPath] = owners.get(dest);
      throw new ManifestError(`${dest} is claimed by both ${first} and ${who}`, path.endsWith("manifest.json") ? path : firstPath);
    }
    owners.set(dest, [who, path]);
  };

  for (const path of discover(root)) {
    const m = parseFeature(root, path);
    if (ids.has(m.feature)) throw new ManifestError(`feature "${m.feature}" is already defined in ${ids.get(m.feature)}`, path);
    ids.set(m.feature, path);
    features.set(path, m);
    for (const file of m.files) {
      const dest = posix.join(m.output, posix.normalize(file));
      claim(dest, `feature "${m.feature}"`, path);
      const source = `${m.source}/${posix.normalize(file)}`;
      table.set(dest, { kind: "feature", id: m.feature, source, mode: statSync(join(root, source)).mode & 0o777,
        consumers: [m.mod], tests: m.tests.map(t => `${m.source}/${t}`), layoutSlots: m.layoutSlots });
    }
  }

  const shared = parseShared(root);
  for (const item of shared?.files ?? []) {
    const name = posix.basename(item.source);
    const mods = item.outputs.map(o => o.split("/")[1]);
    for (const dest of item.outputs) {
      claim(dest, `shared ${name}`, `${SHARED}/manifest.json`);
      const own = [...features.values()].find(f => f.mod === dest.split("/")[1]);
      table.set(dest, { kind: "shared", id: name, source: item.source, mode: statSync(join(root, item.source)).mode & 0o777,
        consumers: mods, tests: own ? own.tests.map(t => `${own.source}/${t}`) : [], layoutSlots: own?.layoutSlots ?? {} });
    }
  }

  for (const [path, m] of features) {
    for (const file of m.handwritten) claim(posix.join(m.output, posix.normalize(file)), `handwritten in feature "${m.feature}"`, path);
  }
  return { table, features, shared };
}

// Destination paths a build must leave alone inside a feature mod besides what it writes:
// handwritten and Herdr reserved files, as `mods/<mod>/<file>`.
export function allowedExtras({ features }) {
  const extras = new Set();
  for (const m of features.values()) {
    for (const file of m.handwritten) extras.add(posix.join(m.output, posix.normalize(file)));
    for (const file of RESERVED) extras.add(`${m.output}/${file}`);
  }
  return extras;
}

export { walkFiles };
