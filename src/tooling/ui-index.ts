import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { Component, Indexed, Mod, Page, SharedHelper } from "../../types/herdr/ui-tooling";

export const SCHEMA_VERSION = 1;
const SKIP_FILE = /\.test\.(?:js|mjs|ts|mts)$|\.loader\.(?:js|mjs|ts|mts)$|\.json$/;

const DECL =
  /^(export\s+)?(?:(?:default|async)\s+)*(function|class|const|let|var)\s+([A-Za-z_$][\w$]*)?/;
const METHOD = /^  (?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\(/;
const UI_CALL =
  /\b(?:div|h_flex|v_flex|svg|image|Button|IconButton|Input|InputState|TextareaState|Table|List|Link|Scrollbar)\s*\(/;
const CLICK = /\.on_click\s*\(/;

export const SHARED_CONTROLS = ["IconButton", "DialogButton"];

export const SHARED_CONTROL_FILES = new Set([
  "src/primitives/icon-button.ts",
  "src/primitives/dialog-button.ts",
]);
const CONTROL_CALL = new RegExp(`(?<!function\\s+)\\b(?:${SHARED_CONTROLS.join("|")})\\s*\\(`);

const CONTROL_LITERALS = new RegExp(
  `(?<!function\\s+)\\b(?:${SHARED_CONTROLS.join("|")})\\s*\\(\\s*(["'\`])([^"'\`]+)\\1(?:\\s*,\\s*(["'\`])([^"'\`]+)\\3)?`,
  "g",
);
const ICON_TOOLTIP = /\btooltip:\s*(["'`])([^"'`]+)\1/g;
const QUOTED = (name: string) => new RegExp(`\\.${name}\\(\\s*["'\`]([^"'\`]+)["'\`]`, "g");
const attr = (body: string, name: string): string[] =>
  [...body.matchAll(QUOTED(name))].map((m) => m[1].trim()).filter(Boolean);
const iconButtonIds = (body: string): string[] =>
  [...body.matchAll(CONTROL_LITERALS)].map((m) => m[2].trim());
const iconButtonLabels = (body: string): string[] =>
  [...body.matchAll(CONTROL_LITERALS)]
    .map((m) => m[4]?.trim())
    .filter((text): text is string => Boolean(text && !text.includes("${")));

const controlLabelFor = (body: string): Record<string, string> =>
  Object.fromEntries(
    [...body.matchAll(CONTROL_LITERALS)].map((m) => [
      m[2].trim(),
      m[4] && !m[4].includes("${") ? m[4].trim() : "",
    ]),
  );
const iconButtonTooltips = (body: string): string[] =>
  [...body.matchAll(ICON_TOOLTIP)].map((m) => m[2].trim()).filter((text) => !text.includes("${"));
const unique = <T>(values: T[]): T[] => [...new Set(values)];

export const normalize = (text: string): string =>
  String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

interface Decl {
  sort: string;
  name: string;
  exported: boolean;
}

function readDirFiles(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const file = `${prefix}${entry.name}`;
      if (entry.isDirectory()) return readDirFiles(join(dir, entry.name), `${file}/`);
      return entry.isFile() &&
        /\.(?:js|mjs|ts|mts)$/.test(entry.name) &&
        !SKIP_FILE.test(entry.name)
        ? [file]
        : [];
    })
    .sort();
}

function readTestFiles(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const file = `${prefix}${entry.name}`;
      if (entry.isDirectory()) return readTestFiles(join(dir, entry.name), `${file}/`);
      return entry.isFile() && /\.test\.(?:js|mjs|ts|mts)$/.test(entry.name) ? [file] : [];
    })
    .sort();
}

function declarationAt(lines: string[], index: number): Decl | null {
  const match = DECL.exec(lines[index]);
  if (!match || !match[3]) return null;
  const exported = Boolean(match[1]);
  return { sort: match[2], name: match[3], exported };
}

function endOfBlock(lines: string[], start: number, stopAtColumnZero: boolean): number {
  for (let at = start + 1; at < lines.length; at++) {
    if (stopAtColumnZero ? lines[at] === "}" : DECL.test(lines[at])) return at;
  }
  return lines.length;
}

function kindOf(body: string): string {
  if (CLICK.test(body) || CONTROL_CALL.test(body)) return "control";
  if (UI_CALL.test(body)) return "view";
  if (/=>|\bfunction\b/.test(body)) return "logic";
  return "data";
}

interface ComponentParts {
  mod: string;
  file: string;
  fileName: string;
  lines: string[];
  start: number;
  end: number;
  name: string;
  label: string;
  exported: boolean;
}

function component(parts: ComponentParts): Component {
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
    description: "",
    ids: unique([...attr(body, "id"), ...iconButtonIds(body)]),
    roles: unique([...attr(body, "role"), ...(CONTROL_CALL.test(body) ? ["button"] : [])]),
    labels: unique([...attr(body, "accessibility_label"), ...iconButtonLabels(body)]),
    labelFor: controlLabelFor(body),
    controlIds: unique(iconButtonIds(body)),
    tooltips: unique([
      ...attr(body, "tooltip"),
      ...(CONTROL_CALL.test(body) ? iconButtonTooltips(body) : []),
    ]),
    texts: unique([...attr(body, "child"), ...attr(body, "placeholder")])
      .filter((text) => !text.includes("${"))
      .slice(0, 12),
    lines: parts.end - parts.start,
  };
}

interface ClassMeta {
  mod: string;
  file: string;
  fileName: string;
  className: string;
}

function classMembers(
  lines: string[],
  meta: ClassMeta,
  start: number,
  end: number,
  out: Component[],
): number {
  const methods: { index: number; name: string }[] = [];
  for (let at = start + 1; at < end; at++) {
    const match = METHOD.exec(lines[at]);
    if (
      match &&
      match[1] !== "if" &&
      match[1] !== "for" &&
      match[1] !== "while" &&
      match[1] !== "switch"
    ) {
      methods.push({ index: at, name: match[1] });
    }
  }
  for (let i = 0; i < methods.length; i++) {
    const member = methods[i];
    out.push(
      component({
        ...meta,
        lines,
        start: member.index,
        end: i + 1 < methods.length ? methods[i + 1].index : end,
        name: `${meta.className}.${member.name}`,
        label: `${meta.className}.${member.name}`,
        exported: false,
      }),
    );
  }
  return methods.length;
}

export function parseComponents(source: string, mod: string, file: string): Component[] {
  const lines = source.split(/\r?\n/);
  const out: Component[] = [];
  for (let at = 0; at < lines.length; at++) {
    const decl = declarationAt(lines, at);
    if (!decl) continue;
    const end = decl.sort === "class" ? endOfBlock(lines, at, true) : endOfBlock(lines, at, false);
    if (decl.sort === "class") {
      const members = classMembers(
        lines,
        { mod, file, fileName: basename(file), className: decl.name },
        at,
        end,
        out,
      );
      out.push({
        id: `${mod}:${basename(file)}:${decl.name}`,
        name: decl.name,
        label: decl.name,
        mod,
        file,
        line: at + 1,
        exported: decl.exported,
        kind: "class",
        description: "",
        ids: [],
        roles: [],
        labels: [],
        tooltips: [],
        texts: [],
        members,
        lines: end - at,
        labelFor: {},
        controlIds: [],
      });
    } else {
      out.push(
        component({
          mod,
          file,
          fileName: basename(file),
          lines,
          start: at,
          end,
          name: decl.name,
          label: decl.name,
          exported: decl.exported,
        }),
      );
    }
    at = end - 1;
  }
  return out;
}

function attachMods(root: string, inPlace: InPlaceEntry[]): Record<string, Mod> {
  const mods: Record<string, Mod> = {};
  for (const entry of inPlace) {
    mods[entry.mod] = {
      name: entry.mod,
      description: entry.description ?? "",
      area: entry.area,
      files: entry.files ?? [],
      tests: entry.tests ?? [],
      pageNodes: entry.pageNodes ?? [],
      componentCount: entry.componentCount ?? 0,
      shared: entry.shared,
      next: entry.next,
    };
  }
  const dir = join(root, "mods");
  if (!existsSync(dir)) return mods;
  for (const name of readdirSync(dir)) {
    if (!existsSync(join(dir, name, "mod.json"))) continue;
    mods[name] ??= {
      name,
      description: "",
      files: [],
      tests: [],
      pageNodes: [],
      componentCount: 0,
    };
  }
  return mods;
}

interface LayoutNode {
  type: string;
  id?: string;
  content?: { mod?: string; props?: unknown };
  stack?: string;
  children?: LayoutNode[];
}

function pushPage(out: Page[], layout: string, stack: string | null, node: LayoutNode): void {
  const content = node.content;
  let mod: string | null = null;
  if (content && content.mod !== undefined) mod = content.mod;
  if (mod || node.type === "block") {
    let props: unknown = null;
    if (content) {
      if (content.props !== undefined) props = content.props;
    }
    out.push({ layout, node: node.id ? node.id : "", stack, mod, props });
  }
}

function walkLayout(
  node: LayoutNode | null,
  stack: string | null,
  layout: string,
  out: Page[],
): void {
  if (!node || typeof node !== "object") return;
  const type = node.type;
  const inner = type === "stack" ? (node.id ?? stack) : stack;
  pushPage(out, layout, inner, node);
  const children = node.children ? node.children : [];
  for (let i = 0; i < children.length; i++) walkLayout(children[i], inner, layout, out);
}

function readPages(root: string): Page[] {
  const dir = join(root, "layouts");
  if (!existsSync(dir)) return [];
  const pages: Page[] = [];
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()) {
    let layout: unknown;
    try {
      layout = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch {
      continue;
    }
    const out: Page[] = [];
    walkLayout(layout as LayoutNode, null, name.replace(/\.json$/, ""), out);
    pages.push(...out);
  }
  return pages;
}

interface FeatureMapEntry {
  manifest?: {
    mod?: string;
    source?: string;
    files?: string[];
    area?: string;
    description?: string;
    tests?: string[];
  };
  area?: string;
  description?: string;
}

interface InPlaceEntry {
  mod: string;
  name: string;
  description?: string;
  area?: string;
  files?: string[];
  tests?: string[];
  pageNodes?: string[];
  componentCount?: number;
  shared?: string[];
  next?: string[];
}

async function readReadingMap(
  root: string,
): Promise<{ features: FeatureMapEntry[]; inPlace: InPlaceEntry[] }> {
  const file = join(root, "orca-ui", "app.mjs");
  if (!existsSync(file)) return { features: [], inPlace: [] };
  const map = await import(pathToFileURL(file).href);
  return { features: map.features ?? [], inPlace: map.inPlace ?? [] };
}

function sharedHelpers(root: string): SharedHelper[] {
  const file = join(root, "orca-ui", "shared", "manifest.json");
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")).files ?? [];
}

function deliveredFiles(root: string, prefix: string, declared: string[] | null): string[] {
  if (declared) return declared.map((file) => `${prefix}/${file}`);
  if (!existsSync(join(root, prefix))) return [];
  return readDirFiles(join(root, prefix)).map((file) => `${prefix}/${file}`);
}

interface SourceLocation {
  files: string[];
}

function generatedOutputs(root: string): Set<string> {
  const outputs = new Set<string>();
  const buildEntries = join(root, "src", "build-entries.json");
  if (existsSync(buildEntries)) {
    const manifest = JSON.parse(readFileSync(buildEntries, "utf8"));
    for (const entry of manifest.entries ?? [])
      if (typeof entry.output === "string") outputs.add(entry.output);
  }
  const shared = join(root, "orca-ui", "shared", "manifest.json");
  if (existsSync(shared)) {
    const manifest = JSON.parse(readFileSync(shared, "utf8"));
    for (const entry of manifest.files ?? [])
      for (const output of entry.outputs ?? []) if (typeof output === "string") outputs.add(output);
  }
  return outputs;
}

function sourceLocation(
  root: string,
  mod: string,
  feature: FeatureMapEntry | undefined,
  generated: Set<string>,
): SourceLocation {
  if (feature) {
    const prefix = feature.manifest?.source ?? `mods/${mod}`;
    const buildEntriesPath = join(root, "src", "build-entries.json");
    const buildEntries = existsSync(buildEntriesPath)
      ? (JSON.parse(readFileSync(buildEntriesPath, "utf8")).entries ?? [])
      : [];
    const typedSources = buildEntries
      .filter(
        (entry: { source?: string }) =>
          typeof entry.source === "string" && entry.source.startsWith(`src/mods/${mod}/`),
      )
      .map((entry: { source: string }) => entry.source);
    const featureFiles =
      feature.manifest?.files?.filter((file) => /\.(?:js|mjs|ts|mts)$/.test(file)) ??
      readDirFiles(join(root, prefix));
    return {
      files: [...featureFiles.map((file) => `${prefix}/${file}`), ...typedSources],
    };
  }
  const sourceDir = join("src", "mods", mod);
  const deliveredDir = `mods/${mod}`;
  if (!existsSync(join(root, sourceDir))) {
    return {
      files: deliveredFiles(root, deliveredDir, null).filter((file) => !generated.has(file)),
    };
  }
  const sourceFiles = readDirFiles(join(root, sourceDir)).map((file) => `${sourceDir}/${file}`);
  return {
    files: [
      ...sourceFiles,
      ...deliveredFiles(root, deliveredDir, null).filter((file) => !generated.has(file)),
    ],
  };
}

function modTests(root: string, name: string, feature: FeatureMapEntry | undefined): string[] {
  const prefix = feature?.manifest?.source ?? `mods/${name}`;
  const declared = feature
    ? (feature.manifest?.tests
        ?.filter((file) => /\.test\.(?:js|mjs|ts|mts)$/.test(file))
        .map((file) => `${prefix}/${file}`) ?? [])
    : [];
  const typed = feature
    ? readTestFiles(join(root, "test", "mods", name), `test/mods/${name}/`)
    : [];
  return [...new Set([...declared, ...typed])].filter((test) => existsSync(join(root, test)));
}

function attachFiles(
  root: string,
  mods: Record<string, Mod>,
  components: Component[],
  featureMods: Map<string, FeatureMapEntry>,
): void {
  const generated = generatedOutputs(root);
  for (const [name, mod] of Object.entries(mods)) {
    if (name === "shared") continue;
    const feature = featureMods.get(name);
    const { files } = sourceLocation(root, name, feature, generated);
    mod.files = files;
    mod.tests = feature
      ? modTests(root, name, feature)
      : (mod.tests ?? []).filter((test) => existsSync(join(root, test)));
    if (!mod.tests.length) mod.tests = mod.files.filter((file) => /\.test\./.test(file));
    mod.componentCount = components.filter((item) => item.mod === name).length;
  }
}

function sharedComponents(root: string, helpers: SharedHelper[]): Component[] {
  const out: Component[] = [];
  for (const row of helpers) {
    const file = row.source;
    out.push(...parseComponents(readFileSync(join(root, file), "utf8"), "shared", file));
  }
  return out;
}

export async function buildIndex(root: string): Promise<Indexed> {
  const { features, inPlace } = await readReadingMap(root);
  const featureMods = new Map<string, FeatureMapEntry>();
  for (const feature of features) {
    if (feature.manifest?.mod) featureMods.set(feature.manifest.mod, feature);
  }
  const mods = attachMods(root, inPlace);
  for (const [name, feature] of featureMods) {
    const current = mods[name] ?? {
      name,
      description: "",
      files: [],
      tests: [],
      pageNodes: [],
      componentCount: 0,
    };
    mods[name] = {
      ...current,
      area: feature.area ?? current.area,
      description: current.description || feature.description || "",
    };
  }
  const helpers = sharedHelpers(root);
  const components = readModComponents(root, mods, featureMods, helpers);
  const shared = sharedComponents(root, helpers);
  components.push(...shared);
  mods.shared = {
    name: "shared",
    area: "shared",
    description:
      "Helpers copied into mods by src/tooling/build-orca-ui.ts; edit these files, never a copy.",
    files: [...new Set(shared.map((item) => item.file))],
    tests: [],
    pageNodes: [],
    componentCount: 0,
  };
  const pages = readPages(root);
  for (const [name, mod] of Object.entries(mods)) {
    mod.pageNodes = pages.filter((page) => page.mod === name).map((page) => page.node);
  }
  attachFiles(root, mods, components, featureMods);
  return {
    schemaVersion: SCHEMA_VERSION,
    root,
    mods,
    components,
    ids: collectIds(components),
    pages,
    shared: helpers,
  };
}

function readModComponents(
  root: string,
  mods: Record<string, Mod>,
  featureMods: Map<string, FeatureMapEntry>,
  helpers: SharedHelper[],
): Component[] {
  const out: Component[] = [];
  const sharedOutputs = new Set(helpers.flatMap((row) => row.outputs));
  const generated = generatedOutputs(root);
  for (const name of Object.keys(mods).sort()) {
    const { files } = sourceLocation(root, name, featureMods.get(name), generated);
    for (const path of files) {
      if (sharedOutputs.has(path)) continue;
      out.push(...parseComponents(readFileSync(join(root, path), "utf8"), name, path));
    }
  }
  return out;
}

interface IdEntry {
  id: string;
  mod: string;
  file: string;
  line: number;
  component: string;
  label: string;
  role: string;
}

function collectIds(components: Component[]): Record<string, IdEntry> {
  const ids: Record<string, IdEntry> = {};
  for (const item of components) {
    for (const id of item.ids) {
      ids[id] ??= {
        id,
        mod: item.mod,
        file: item.file,
        line: item.line,
        component: item.name,
        label: item.labelFor?.[id] ?? (item.ids.length === 1 ? item.labels[0] : undefined) ?? "",
        role: item.controlIds?.includes(id)
          ? "button"
          : ((item.ids.length === 1 ? item.roles[0] : undefined) ?? ""),
      };
    }
  }
  return ids;
}

export function searchIndex(
  index: Indexed,
  term: string,
  limit = 20,
): Array<{
  type: string;
  mod?: string;
  name?: string;
  file?: string;
  line?: number;
  description?: string;
  score?: number;
}> {
  const query = normalize(term);
  if (!query) return [];
  const hits: Array<{
    type: string;
    mod?: string;
    name?: string;
    file?: string;
    line?: number;
    description?: string;
    score?: number;
  }> = [];
  for (const [name, mod] of Object.entries(index.mods)) {
    const hay = normalize([name, mod.description, mod.area].join(" "));
    if (hay.includes(query))
      hits.push({
        type: "mod",
        mod: name,
        name,
        description: mod.description ?? "",
        file: `mods/${name}`,
        line: 0,
        score: normalize(name) === query ? 70 : 40,
      });
  }
  for (const item of index.components) {
    const score = componentScore(item, query);
    if (score) hits.push({ type: "component", ...item, score });
  }
  return hits.sort((a, b) => b.score! - a.score! || a.name!.localeCompare(b.name!)).slice(0, limit);
}

function componentScore(item: Component, query: string): number {
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
  if (
    ids.some((id) => id.includes(query)) ||
    labels.some((label) => label.includes(query)) ||
    texts.some((text) => text.includes(query))
  )
    return 55;
  if (normalize(item.description).includes(query)) return 40;
  if (normalize(item.file).includes(query)) return 30;
  return 0;
}

type FoundEntity = {
  type: string;
  mod?: string;
  name?: string;
  file?: string;
  line?: number;
  ids?: string[];
  labels?: string[];
  roles?: string[];
  description?: string;
  kind?: string;
};

function componentEntity(item: Component): FoundEntity {
  return {
    type: "component",
    mod: item.mod,
    name: item.name,
    file: item.file,
    line: item.line,
    ids: item.ids,
    labels: item.labels,
    roles: item.roles,
    description: item.description,
    kind: item.kind,
  };
}

export function findEntity(index: Indexed, term: string): FoundEntity | null {
  const query = normalize(term);
  if (!query) return null;
  const id = Object.values(index.ids).find((entry) => normalize(entry.id) === query);
  if (id) return { type: "id", ...id };
  const exact = index.components.find((item) =>
    item.labels.some((label) => normalize(label) === query),
  );
  if (exact) return componentEntity(exact);
  const named = index.components.find((item) => normalize(item.name) === query);
  if (named) return componentEntity(named);
  const drawn = index.components.find((item) =>
    item.texts.some((text) => normalize(text) === query),
  );
  if (drawn) return componentEntity(drawn);
  return null;
}

export function textMap(index: Indexed): Map<string, Component[]> {
  const map = new Map<string, Component[]>();
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

export function outline(index: Indexed, mod: string): Record<string, Component[]> {
  const byFile: Record<string, Component[]> = {};
  for (const item of index.components
    .filter((entry) => entry.mod === mod)
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    (byFile[item.file] ??= []).push(item);
  }
  return byFile;
}

export function audit(index: Indexed): {
  interactive: number;
  missingIds: Array<{ mod: string; name: string; file: string; line: number; labels: string[] }>;
  missingLabels: Array<{ mod: string; name: string; file: string; line: number }>;
  duplicateIds: Array<{ id: string; first: string; second: string }>;
} {
  const interactive = index.components.filter(
    (item) =>
      item.kind === "control" &&
      !SHARED_CONTROLS.includes(item.name) &&
      !SHARED_CONTROL_FILES.has(item.file),
  );
  const bare = interactive.filter((item) => !item.ids.length);
  const seen = new Map<string, Component>();
  const duplicateIds: Array<{ id: string; first: string; second: string }> = [];
  for (const item of index.components) {
    for (const id of item.ids) {
      if (id.includes("${")) continue;
      const first = seen.get(id);
      if (first)
        duplicateIds.push({
          id,
          first: `${first.file}:${first.line}`,
          second: `${item.file}:${item.line}`,
        });
      else seen.set(id, item);
    }
  }
  return {
    interactive: interactive.length,
    missingIds: bare.map(({ mod, name, file, line, labels }) => ({
      mod,
      name,
      file,
      line,
      labels,
    })),
    missingLabels: interactive
      .filter((item) => !item.labels.length)
      .map(({ mod, name, file, line }) => ({ mod, name, file, line })),
    duplicateIds,
  };
}

export const relativeTo = (root: string, path: string): string =>
  relative(root, path).split(sep).join("/");
