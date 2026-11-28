export type ConfigValidation = {
  errors: string[];
  parsedCount: number;
  modCount: number;
  layoutCount: number;
};

type ConfigSource = {
  trackedPaths: Iterable<string>;
  readText: (path: string) => string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function matching(tracked: Set<string>, pattern: RegExp): string[] {
  return [...tracked].filter((path) => pattern.test(path));
}

function parseJson(
  tracked: Set<string>,
  readText: ConfigSource["readText"],
  errors: string[],
): Map<string, unknown> {
  const parsed = new Map<string, unknown>();
  for (const path of matching(tracked, /\.json$/)) {
    try {
      parsed.set(path, JSON.parse(readText(path)));
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return parsed;
}

function validateManifests(
  tracked: Set<string>,
  parsed: Map<string, unknown>,
  errors: string[],
): Set<string> {
  const manifests = new Set<string>();
  for (const path of matching(tracked, /^mods\/[^/]+\/mod\.json$/)) {
    const name = path.split("/")[1];
    manifests.add(name);
    if (!isObject(parsed.get(path))) errors.push(`${path}: manifest must be a JSON object`);
    if (!tracked.has(`mods/${name}/main.js`)) errors.push(`${path}: missing tracked main.js`);
  }
  if (!manifests.size) errors.push("No mod manifests found");
  return manifests;
}

function validateObjects(
  tracked: Set<string>,
  parsed: Map<string, unknown>,
  errors: string[],
): void {
  for (const path of ["keys.json", "programs.json", "settings.json"]) {
    if (!isObject(parsed.get(path))) errors.push(`${path}: missing or not a JSON object`);
  }
  for (const path of matching(tracked, /^themes\/[^/]+\.json$/)) {
    if (!isObject(parsed.get(path))) errors.push(`${path}: theme must be a JSON object`);
  }
}

function requireMod(name: unknown, path: string, manifests: Set<string>, errors: string[]): void {
  if (typeof name !== "string" || !manifests.has(name))
    errors.push(`${path}: unknown mod ${JSON.stringify(name)}`);
}

function walkLayout(value: unknown, path: string, manifests: Set<string>, errors: string[]): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "mod" && typeof child === "string") requireMod(child, path, manifests, errors);
    else walkLayout(child, path, manifests, errors);
  }
}

function validateLayout(
  path: string,
  tracked: Set<string>,
  parsed: Map<string, unknown>,
  manifests: Set<string>,
  errors: string[],
): void {
  const layout = parsed.get(path);
  if (!isObject(layout)) {
    errors.push(`${path}: layout must be a JSON object`);
    return;
  }
  walkLayout(layout, path, manifests, errors);
  if (layout.terminal_menu) requireMod(layout.terminal_menu, path, manifests, errors);
  if (typeof layout.theme === "string" && !parsed.has(`themes/${layout.theme}.json`))
    errors.push(`${path}: missing theme ${layout.theme}`);
  if (typeof layout.preview === "string" && !tracked.has(layout.preview))
    errors.push(`${path}: missing preview ${layout.preview}`);
}

function validateLayouts(
  tracked: Set<string>,
  parsed: Map<string, unknown>,
  manifests: Set<string>,
  errors: string[],
): string[] {
  const layouts = matching(tracked, /^layouts\/[^/]+\.json$/);
  if (!layouts.length) errors.push("No layouts found");
  for (const path of layouts) validateLayout(path, tracked, parsed, manifests, errors);
  return layouts;
}

export function validateConfig({ trackedPaths, readText }: ConfigSource): ConfigValidation {
  const tracked = new Set(trackedPaths);
  const errors: string[] = [];
  const parsed = parseJson(tracked, readText, errors);
  const manifests = validateManifests(tracked, parsed, errors);
  validateObjects(tracked, parsed, errors);
  const layouts = validateLayouts(tracked, parsed, manifests, errors);

  return {
    errors,
    parsedCount: parsed.size,
    modCount: manifests.size,
    layoutCount: layouts.length,
  };
}
