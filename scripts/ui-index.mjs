// Machine-readable index of the Orca UI, built from source on every run. Mods, components,
// stable ids, accessible labels, layout pages and shared helpers all come from the code, so the
// index cannot drift the way a hand-written catalog would. `scripts/ui.mjs` is the query front end.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const SCHEMA_VERSION = 1;
const SKIP_FILE = /\.test\.(?:js|mjs)$|\.loader\.(?:js|mjs)$|\.json$/;
const GENERATED_COPY = /^\/\/ Generated from /;
// A top-level declaration starts at column 0; anything indented belongs to the one above it.
const DECL = /^(export\s+)?(?:(?:default|async)\s+)*(function|class|const|let|var)\s+([A-Za-z_$][\w$]*)?/;
const METHOD = /^  (?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\(/;
const UI_CALL = /\b(?:div|h_flex|v_flex|svg|image|Button|IconButton|Input|InputState|TextareaState|Table|List|Link|Scrollbar)\s*\(/;
const CLICK = /\.on_click\s*\(/;
const QUOTED = (name) => new RegExp(`\\.${name}\\(\\s*["'\`]([^"'\`]+)["'\`]`, "g");
const attr = (body, name) => [...body.matchAll(QUOTED(name))].map((m) => m[1].trim()).filter(Boolean);
const unique = (values) => [...new Set(values)];

export const normalize = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function readDirFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:js|mjs)$/.test(entry.name) && !SKIP_FILE.test(entry.name))
    .map((entry) => entry.name).sort();
}

function docAbove(lines, index) {
  const out = [];
  for (let at = index - 1; at >= 0; at--) {
    const line = lines[at].trim();
    if (!/^(\/\/|\*|\/\*)/.test(line)) break;
    out.unshift(line.replace(/^\/\/\s?|^\/\*+\s?|^\*+\s?|\*\/\s*$/g, ""));
  }
  return out.join(" ").trim();
}

function declarationAt(lines, index) {
  const match = DECL.exec(lines[index]);
  if (!match || !match[3]) return null;
  const exported = Boolean(match[1]);
  return { sort: match[2], name: match[3], exported };
}

function endOfBlock(lines, start, stopAtColumnZero) {
  for (let at = start + 1; at < lines.length; at++) {
    if (stopAtColumnZero ? lines[at] === "}" : DECL.test(lines[at])) return at;
  }
  return lines.length;
}

// A 
function kindOf(body) {
  if (CLICK.test(body)) return "control";
  if (UI_CALL.test(body)) return "view";
  if (/=>|\bfunction\b/.test(body)) return "logic";
  return "data";
}

function component(parts) {
  const bodyLines = parts.lines.slice(parts.start, parts.end);
  const body = bodyLines.join("\n");
  return {
    id: `${parts.mod}:${parts.fileName}:${parts.label}`,
    name: parts.name,
    label: parts.label,
    mod: parts.mod,
    file: parts.file,
    line: parts.start + 1,
    exported: parts.exported,
    kind: kindOf(body),
    description: docAbove(parts.lines, parts.start),
    ids: unique(attr(body, "id")),
    roles: unique(attr(body, "role")),
    labels: unique(attr(body, "accessibility_label")),
    tooltips: unique(attr(body, "tooltip")),
    texts: unique([...attr(body, "child"), ...attr(body, "placeholder")]).filter((text) => !text.includes("${")).slice(0, 12),
    lines: parts.end - parts.start,
  };
}

function classMembers(lines, meta, start, end, out) {
  const methods = [];
  for (let at = start + 1; at < end; at++) {
    const match = METHOD.exec(lines[at]);
    if (match && match[1] !== "if" && match[1] !== "for" && match[1] !== "while" && match[1] !== "switch") {
      methods.push({ index: at, name: match[1] });
    }
  }
  for (let i = 0; i < methods.length; i++) {
    const member = methods[i];
    out.push(component({
      ...meta, lines, start: member.index,
      end: i + 1 < methods.length ? methods[i + 1].index : end,
      name: `${meta.className}.${member.name}`, label: `${meta.className}.${member.name}`, exported: false,
    }));
  }
  return methods.length;
}

export function parseComponents(source, mod, file) {
  const lines = source.split(/\r?\n/);
  const last = [...lines].reverse().find((line) => line.trim()) ?? "";
  if (GENERATED_COPY.test(last)) return [];
  const out = [];
  for (let at = 0; at < lines.length; at++) {
    const decl = declarationAt(lines, at);
    if (!decl) continue;
    const end = decl.sort === "class" ? endOfBlock(lines, at, true) : endOfBlock(lines, at, false);
    if (decl.sort === "class") {
      const members = classMembers(lines, { mod, file, fileName: basename(file), className: decl.name }, at, end, out);
      out.push({ id: `${mod}:${basename(file)}:${decl.name}`, name: decl.name, label: decl.name, mod, file, line: at + 1,
        exported: decl.exported, kind: "class", description: docAbove(lines, at), ids: [], roles: [], labels: [], tooltips: [], texts: [], members, lines: end - at });
    } else {
      out.push(component({ mod, file, fileName: basename(file), lines, start: at, end, name: decl.name, label: decl.name, exported: decl.exported }));
    }
    at = end - 1;
  }
  return out;
}

function attachMods(root, inPlace) {
  const mods = {};
  for (const entry of inPlace) mods[entry.mod] = { ...entry, name: entry.mod };
  const dir = join(root, "mods");
  if (!existsSync(dir)) return mods;
  for (const name of readdirSync(dir)) {
    if (!existsSync(join(dir, name, "mod.json"))) continue;
    mods[name] ??= { name, description: "" };
  }
  return mods;
}

function walkLayout(node, stack, layout, out) {
  if (!node || typeof node !== "object") return;
  const inner = node.type === "stack" ? node.id : stack;
  const mod = node.content?.mod;
  if (mod) out.push({ layout, node: node.id, stack: stack ?? null, mod, props: node.content.props ?? null });
  else if (node.type === "block") out.push({ layout, node: node.id, stack: stack ?? null, mod: null, props: null });
  for (const child of node.children ?? []) walkLayout(child, inner, layout, out);
}

function readPages(root) {
  const dir = join(root, "layouts");
  if (!existsSync(dir)) return [];
  const pages = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    let layout;
    try { layout = JSON.parse(readFileSync(join(dir, name), "utf8")); } catch { continue; }
    const out = [];
    walkLayout(layout, null, name.replace(/\.json$/, ""), out);
    pages.push(...out);
  }
  return pages;
}

async function readReadingMap(root) {
  const file = join(root, "orca-ui", "app.mjs");
  if (!existsSync(file)) return { features: [], inPlace: [] };
  const map = await import(pathToFileURL(file).href);
  return { features: map.features ?? [], inPlace: map.inPlace ?? [] };
}

function sharedHelpers(root) {
  const file = join(root, "orca-ui", "shared", "manifest.json");
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")).files ?? [];
}

function deliveredFiles(root, prefix, declared) {
  if (declared) return declared.map((file) => `${prefix}/${file}`);
  if (!existsSync(join(root, prefix))) return [];
  return readDirFiles(join(root, prefix)).map((file) => `${prefix}/${file}`);
}

function attachFiles(root, mods, components, featureMods) {
  for (const [name, mod] of Object.entries(mods)) {
    if (name === "shared") continue;
    const feature = featureMods.get(name);
    const { prefix, files } = sourceLocation(name, feature);
    mod.files = deliveredFiles(root, prefix, files);
    const declared = feature ? feature.manifest.tests.filter((file) => /\.test\.js$/.test(file)).map((file) => `${prefix}/${file}`) : mod.tests ?? [];
    mod.tests = declared.filter((test) => existsSync(join(root, test)));
    if (!mod.tests.length) mod.tests = mod.files.filter((file) => /\.test\./.test(file));
    mod.componentCount = components.filter((item) => item.mod === name).length;
  }
}

function sharedComponents(root) {
  const dir = join(root, "orca-ui", "shared");
  const out = [];
  for (const name of readDirFiles(dir)) {
    const file = `orca-ui/shared/${name}`;
    out.push(...parseComponents(readFileSync(join(root, file), "utf8"), "shared", file));
  }
  return out;
}

export async function buildIndex(root) {
  const { features, inPlace } = await readReadingMap(root);
  const featureMods = new Map(features.filter((feature) => feature.manifest?.mod).map((feature) => [feature.manifest.mod, feature]));
  const mods = attachMods(root, inPlace);
  for (const [name, feature] of featureMods) {
    mods[name] = { ...(mods[name] ?? { name }), area: feature.area ?? mods[name]?.area, description: mods[name]?.description || feature.description };
  }
  const components = readModComponents(root, mods, featureMods);
  const shared = sharedComponents(root);
  components.push(...shared);
  mods.shared = { name: "shared", area: "shared", description: "Helpers copied into mods by scripts/build-orca-ui.mjs; edit these files, never a copy.", files: [...new Set(shared.map((item) => item.file))], tests: [], pageNodes: [] };
  const pages = readPages(root);
  for (const [name, mod] of Object.entries(mods)) {
    mod.pageNodes = pages.filter((page) => page.mod === name).map((page) => page.node);
  }
  attachFiles(root, mods, components, featureMods);
  return { schemaVersion: SCHEMA_VERSION, root, mods, components, ids: collectIds(components), pages, shared: sharedHelpers(root) };
}

function sourceLocation(mod, feature) {
  if (feature) return { prefix: feature.manifest.source, files: feature.manifest.files.filter((file) => file.endsWith(".js")) };
  return { prefix: `mods/${mod}`, files: null };
}

function readModComponents(root, mods, featureMods) {
  const out = [];
  for (const name of Object.keys(mods).sort()) {
    const { prefix, files } = sourceLocation(name, featureMods.get(name));
    const dir = join(root, prefix);
    if (!existsSync(dir)) continue;
    for (const file of files ?? readDirFiles(dir)) {
      const path = `${prefix}/${file}`;
      out.push(...parseComponents(readFileSync(join(root, path), "utf8"), name, path));
    }
  }
  return out;
}

function collectIds(components) {
  const ids = {};
  for (const item of components) {
    for (const id of item.ids) ids[id] ??= { id, mod: item.mod, file: item.file, line: item.line, component: item.name, label: item.labels[0] ?? "", role: item.roles[0] ?? "" };
  }
  return ids;
}

export function searchIndex(index, term, limit = 20) {
  const query = normalize(term);
  if (!query) return [];
  const hits = [];
  for (const [name, mod] of Object.entries(index.mods)) {
    const hay = normalize([name, mod.description, mod.area].join(" "));
    if (hay.includes(query)) hits.push({ type: "mod", mod: name, name, description: mod.description ?? "", file: `mods/${name}`, line: 0, score: normalize(name) === query ? 70 : 40 });
  }
  for (const item of index.components) {
    const score = componentScore(item, query);
    if (score) hits.push({ type: "component", ...item, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

function componentScore(item, query) {
  const name = normalize(item.name);
  const labels = item.labels.map(normalize);
  const ids = item.ids.map(normalize);
  const tooltips = item.tooltips.map(normalize);
  const texts = item.texts.map(normalize);
  if (ids.includes(query)) return 100;
  if (labels.includes(query) || tooltips.includes(query)) return 90;
  if (texts.includes(query)) return 88;
  if (name === query) return 85;
  if (name.includes(query)) return 60;
  if (ids.some((id) => id.includes(query)) || labels.some((label) => label.includes(query)) || texts.some((text) => text.includes(query))) return 55;
  if (normalize(item.description).includes(query)) return 40;
  if (normalize(item.file).includes(query)) return 30;
  return 0;
}

export function findEntity(index, term) {
  const query = normalize(term);
  if (!query) return null;
  const id = Object.values(index.ids).find((entry) => normalize(entry.id) === query);
  if (id) return { type: "id", ...id };
  const exact = index.components.find((item) => item.labels.some((label) => normalize(label) === query));
  if (exact) return { type: "component", mod: exact.mod, name: exact.name, file: exact.file, line: exact.line, ids: exact.ids, labels: exact.labels, roles: exact.roles, description: exact.description, kind: exact.kind };
  const named = index.components.find((item) => normalize(item.name) === query);
  if (named) return { type: "component", mod: named.mod, name: named.name, file: named.file, line: named.line, ids: named.ids, labels: named.labels, roles: named.roles, description: named.description, kind: named.kind };
  const drawn = index.components.find((item) => item.texts.some((text) => normalize(text) === query));
  if (drawn) return { type: "component", mod: drawn.mod, name: drawn.name, file: drawn.file, line: drawn.line, ids: drawn.ids, labels: drawn.labels, roles: drawn.roles, description: drawn.description, kind: drawn.kind };
  return null;
}

// Visible text -> the builders that draw it. OCR rows and source labels then share one key.
export function textMap(index) {
  const map = new Map();
  for (const item of index.components) {
    for (const text of [...item.labels, ...item.texts]) {
      const key = normalize(text);
      if (!key) continue;
      const items = map.get(key) ?? [];
      if (!items.includes(item)) items.push(item);
      map.set(key, items.slice(0, 3));
    }
  }
  return map;
}

export function outline(index, mod) {
  const byFile = {};
  for (const item of index.components.filter((entry) => entry.mod === mod).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    (byFile[item.file] ??= []).push(item);
  }
  return byFile;
}

export function audit(index) {
  const interactive = index.components.filter((item) => item.kind === "control");
  const bare = interactive.filter((item) => !item.ids.length);
  const seen = new Map();
  const duplicateIds = [];
  for (const item of index.components) {
    for (const id of item.ids) {
      if (id.includes("${")) continue;
      const first = seen.get(id);
      if (first) duplicateIds.push({ id, first: `${first.file}:${first.line}`, second: `${item.file}:${item.line}` });
      else seen.set(id, item);
    }
  }
  return {
    interactive: interactive.length,
    missingIds: bare.map(({ mod, name, file, line, labels }) => ({ mod, name, file, line, labels })),
    missingLabels: interactive.filter((item) => !item.labels.length).map(({ mod, name, file, line }) => ({ mod, name, file, line })),
    duplicateIds,
  };
}

export const relativeTo = (root, path) => relative(root, path).split(sep).join("/");
