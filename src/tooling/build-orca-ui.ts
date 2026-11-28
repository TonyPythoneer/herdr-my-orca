import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import {
  ROOT,
  ManifestError,
  MODE_MASK,
  allowedExtras,
  loadManifests,
  walkFiles,
} from "./orca-ui-manifests";
import { compiledSourceBytes } from "./packed-contract";

type Loaded = ReturnType<typeof loadManifests>;
type Row = Loaded["table"] extends Map<string, infer R> ? R : never;
type Pending = {
  dest: string;
  to: string;
  want: Buffer;
  mode: number;
  why: string;
  source: string;
};
type Plan = { problems: string[]; pending: Pending[] };
type Options = { out: string; check: boolean; force: boolean; root: string };

const USAGE =
  "usage: vpx src/tooling/build-orca-ui.ts --out <dir> [--check | --force] [--root <dir>]";

const EXIT_DRIFT = 1;
const EXIT_USAGE = 2;

function fail(message: string): never {
  console.error(message);
  console.error(USAGE);
  return process.exit(EXIT_USAGE);
}

function parseArgs(args: string[]): Options {
  const opts: Options = { out: "", check: false, force: false, root: ROOT };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!["--out", "--check", "--force", "--root"].includes(flag)) fail(`unknown argument ${flag}`);
    if (seen.has(flag)) fail(`${flag} given more than once`);
    seen.add(flag);
    if (flag === "--check" || flag === "--force") opts[flag.slice(2) as "check" | "force"] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith("--")) fail(`${flag} needs a directory`);
      opts[flag.slice(2) as "out" | "root"] = resolve(value);
    }
  }
  if (!opts.out) fail("--out is required");
  if (opts.check && opts.force) fail("--check and --force cannot be combined");
  return opts;
}

function pathProblem(path: string): string | null {
  const { root } = parse(path);
  let at = root;
  for (const part of path.slice(root.length).split(sep)) {
    at = join(at, part);
    let stat;
    try {
      stat = lstatSync(at);
    } catch {
      return null;
    }
    if (stat.isSymbolicLink()) return "is or crosses a symlink";
    if (at !== path && !stat.isDirectory()) return "is or crosses a non-directory";
    if (at === path && !stat.isFile()) return "exists but is not a regular file";
  }
  return null;
}

const TEMP_SUFFIX = ".orca-build-tmp";
const LINE_FEED = 0x0a;

function deliverable(root: string, row: Row): Buffer {
  const compiledTS = row.source.endsWith(".ts");
  const bytes = compiledTS
    ? compiledSourceBytes(row.source, join(root, "tools/vite-plus-pilot/dist"), row.packId)
    : readFileSync(join(root, row.source));
  if (
    (!compiledTS && row.kind !== "shared") ||
    (bytes.length && bytes[bytes.length - 1] === LINE_FEED)
  )
    return bytes;
  return Buffer.concat([bytes, Buffer.from("\n")]);
}

function loadOrExit(root: string): Loaded {
  try {
    return loadManifests({ root });
  } catch (error) {
    console.error(
      `${error instanceof ManifestError ? error.path : "orca-ui"}: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(USAGE);
    return process.exit(EXIT_USAGE);
  }
}

function driftReason(to: string, want: Buffer, mode: number): string | null {
  if (!existsSync(to)) return "missing";
  if (!readFileSync(to).equals(want)) return "content differs";
  if ((statSync(to).mode & MODE_MASK) !== mode) return "mode differs";
  return null;
}

function plan(loaded: Loaded, root: string, out: string): Plan {
  const problems: string[] = [];
  const pending: Pending[] = [];
  for (const [dest, row] of loaded.table) {
    const to = join(out, dest);
    const bad = pathProblem(to);
    if (bad) {
      problems.push(`${dest}: ${bad}`);
      continue;
    }
    const want = deliverable(root, row);
    const why = driftReason(to, want, row.mode);
    if (why) pending.push({ dest, to, want, mode: row.mode, why, source: join(root, row.source) });
  }
  return { problems, pending };
}

function undeclaredInFeatureMods(loaded: Loaded, out: string): string[] {
  const found: string[] = [];
  const managed = new Set(loaded.table.keys());
  const extras = allowedExtras(loaded);
  for (const m of loaded.features.values()) {
    const dir = join(out, m.output);
    if (!existsSync(dir) || !lstatSync(dir).isDirectory()) continue;
    for (const file of walkFiles(dir)) {
      const dest = `${m.output}/${file}`;
      if (!managed.has(dest) && !extras.has(dest))
        found.push(`${dest}: not declared by any manifest`);
    }
  }
  return found;
}

function unlistedSharedCopies(loaded: Loaded, out: string): string[] {
  const found: string[] = [];
  const managed = new Set(loaded.table.keys());
  const featureMods = new Set([...loaded.features.values()].map((m) => m.output));
  const sharedNames = new Set(
    loaded.shared.files.map((row) => basename(row.source).replace(/\.ts$/, ".js")),
  );
  const mods = join(out, "mods");
  for (const mod of existsSync(mods) ? readdirSync(mods) : []) {
    const dir = join(mods, mod);
    if (featureMods.has(`mods/${mod}`) || !lstatSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir).filter(
      (n) => n.endsWith(".js") && lstatSync(join(dir, n)).isFile(),
    )) {
      const dest = `mods/${mod}/${name}`;
      if (!managed.has(dest) && sharedNames.has(name)) {
        found.push(`${dest}: generated shared copy that no manifest lists`);
      }
    }
  }
  return found;
}

const undeclared = (loaded: Loaded, out: string): string[] => [
  ...undeclaredInFeatureMods(loaded, out),
  ...unlistedSharedCopies(loaded, out),
];

const looksHandEdited = (p: Pending): boolean =>
  p.why !== "missing" && statSync(p.to).mtimeMs > statSync(p.source).mtimeMs;

function replaceFile(p: Pending): void {
  const tmp = `${p.to}${TEMP_SUFFIX}`;
  mkdirSync(dirname(p.to), { recursive: true });
  try {
    rmSync(tmp, { force: true, recursive: true });
    writeFileSync(tmp, p.want, { flag: "wx" });
    chmodSync(tmp, p.mode);
    renameSync(tmp, p.to);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

function check(loaded: Loaded, out: string, { problems, pending }: Plan): number {
  const lines = [
    ...problems,
    ...undeclared(loaded, out),
    ...pending.map((p) => `${p.dest}: ${p.why}`),
  ];
  for (const line of lines) console.log(line);
  console.log(
    lines.length
      ? `${lines.length} managed file(s) drifted`
      : `${loaded.table.size} managed file(s) match`,
  );
  return lines.length ? EXIT_DRIFT : 0;
}

function build(loaded: Loaded, out: string, { problems, pending }: Plan, force: boolean): number {
  if (problems.length) {
    for (const line of problems) console.error(line);
    return EXIT_DRIFT;
  }
  const blocked = force ? [] : pending.filter(looksHandEdited);
  if (blocked.length) {
    for (const p of blocked) console.error(p.dest);
    console.error(
      "newer than their source and different: edit the source, or rerun with --force to overwrite",
    );
    return EXIT_DRIFT;
  }
  try {
    pending.forEach(replaceFile);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    console.error(`${failure.path ?? out}: ${failure.message}`);
    return EXIT_DRIFT;
  }
  console.log(
    `wrote ${pending.length} of ${loaded.table.size} managed file(s) from ${loaded.features.size} feature(s) and ${loaded.shared.files.length} shared helper(s) to ${out}`,
  );
  return 0;
}

const { out, check: checkOnly, force, root } = parseArgs(process.argv.slice(2));
const loaded = loadOrExit(root);
const result = plan(loaded, root, out);
process.exit(checkOnly ? check(loaded, out, result) : build(loaded, out, result, force));
