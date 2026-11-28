#!/usr/bin/env node
// The first command an agent runs on an Orca UI task: find existing components, locate a
// control's source, open a page, screenshot it, and drive the running app.
//
//   node scripts/ui.mjs find button          search components, ids, labels, mods
//   node scripts/ui.mjs where am-back        stable id or accessible label -> source
//   node scripts/ui.mjs outline orca-files   every builder in a mod, by file and line
//   node scripts/ui.mjs pages                layout pages and how to open them
//   node scripts/ui.mjs open agents          show a page in the running app
//   node scripts/ui.mjs tree                 current window as text, in reading order
//   node scripts/ui.mjs click --id am-back   click a visible control (needs an unlocked Mac)
// Descriptions live in AGENTS.md and .agents/skills/orca-ui/SKILL.md.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { audit, buildIndex, findEntity, outline, searchIndex, textMap } from "./ui-index.mjs";
import * as live from "./ui-live.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ARTIFACTS = join(ROOT, "artifacts", "ui");
const USAGE = `usage: node scripts/ui.mjs <command> [terms] [--json] [--out path]

  discover (works offline)
    find <term>            components, stable ids, labels, mods
    where <term>           the source line for an id, label or component name
    outline <mod>          components of a mod grouped by file
    mod <name>             one mod: description, pages, tests, shared helpers
    pages                  layout blocks and the command that opens each
    audit                  interactive components missing a stable id
    index [--out path]     the whole index as JSON

  run the app (native Herdr APIs; input needs an unlocked Mac)
    status                 layout, space, tab, overlays, errors
    open <page|mod>        select a layout page, or open a mod
    shot [--out path]      screenshot the window
    tree [--map]           screenshot + OCR; --map names the builder of each text
    find-text <text>       visible positions of a text, as --point x,y
    click (--id|--text|--point)   click, then report what changed
    type <text> [--enter]  paste text into the focused field
    key <name>             escape, return, tab, up, down, ...
    scroll <up|down>       scroll at a target or the window center`;

function parseArgs(argv) {
  const flags = { _: [] };
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at];
    if (!arg.startsWith("--")) {
      flags._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[at + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      at++;
    }
  }
  return flags;
}

let cached = null;
async function index() {
  cached ??= await buildIndex(ROOT);
  return cached;
}

const oneLine = (text, width = 96) =>
  String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, width);
const quoted = (values) =>
  values
    .filter(Boolean)
    .map((value) => `"${value}"`)
    .join(", ");
const emit = (value, json) => console.log(json ? JSON.stringify(value, null, 2) : value);

function componentLine(item) {
  const bits = [`${item.file}:${item.line}`, item.name.padEnd(34), `[${item.kind}]`];
  if (item.ids?.length) bits.push(`id ${item.ids.join(",")}`);
  if (item.labels?.length) bits.push(quoted(item.labels));
  if (item.description) bits.push(`— ${oneLine(item.description, 70)}`);
  return bits.join("  ");
}

// Every file the index knows about, read once per process while answering a `where`.
function knownSources(indexed) {
  return [
    ...new Set([
      ...Object.values(indexed.mods).flatMap((mod) => mod.files ?? []),
      ...indexed.shared.map((helper) => helper.source),
    ]),
  ];
}

function references(root, needle, limit = 12) {
  if (!needle) return [];
  const hits = [];
  for (const file of knownSources(cached)) {
    let text;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    text.split(/\r?\n/).forEach((line, at) => {
      if (line.includes(needle)) hits.push(`${file}:${at + 1}`);
    });
    if (hits.length >= limit) break;
  }
  return hits.slice(0, limit);
}

function cmdFind(indexed, flags) {
  const term = flags._.join(" ");
  if (!term) throw new Error("find needs a term, for example: find toggle");
  const hits = searchIndex(indexed, term, Number(flags.limit ?? 25));
  if (flags.json) return emit(hits, true);
  if (!hits.length)
    return console.log(
      'nothing matches "' + term + '". Try: find list, find dialog, find <mod name>.',
    );
  for (const hit of hits) {
    if (hit.type === "mod") {
      const where = hit.mod === "shared" ? "orca-ui/shared" : `mods/${hit.mod}`;
      console.log(where.padEnd(36) + `mod  — ${oneLine(hit.description)}`);
    } else console.log(componentLine(hit));
  }
}

function cmdWhere(indexed, flags) {
  const term = flags._.join(" ");
  if (!term) throw new Error("where needs an id, label or component name");
  const hit = findEntity(indexed, term);
  if (!hit) {
    const near = searchIndex(indexed, term, 5);
    if (!near.length) return console.log(`no match for "${term}".`);
    console.log(`no exact match for "${term}"; closest:`);
    for (const item of near)
      console.log(item.type === "mod" ? `  mods/${item.mod}` : `  ${componentLine(item)}`);
    return;
  }
  const used = [
    ...new Set(
      [hit.labels?.[0], hit.id, hit.name, hit.component]
        .filter(Boolean)
        .flatMap((needle) => references(ROOT, needle, 4)),
    ),
  ].slice(0, 12);
  if (flags.json) return emit({ ...hit, references: used }, true);
  printWhere(hit, used);
}

function printWhere(hit, used) {
  console.log(`${hit.type}: ${hit.id ?? hit.name}`);
  if (hit.label) console.log(`  label:   ${hit.label}`);
  if (hit.role) console.log(`  role:    ${hit.role}`);
  console.log(`  source:  ${hit.file}:${hit.line}`);
  if (hit.description) console.log(`  purpose: ${oneLine(hit.description, 160)}`);
  if (used.length) console.log(`  used by: ${used.join(", ")}`);
}

function cmdMod(indexed, flags) {
  const name = flags._[0];
  const mod = indexed.mods[name];
  if (!mod) return console.log(`unknown mod "${name}". Run: node scripts/ui.mjs find <term>`);
  if (flags.json) return emit(mod, true);
  const extras = [
    [
      "pages",
      mod.pageNodes?.length
        ? `${mod.pageNodes.join(", ")}   (node scripts/ui.mjs open ${mod.pageNodes[0]})`
        : "",
    ],
    ["tests", (mod.tests ?? []).join(", ")],
    ["shared", (mod.shared ?? []).join(", ")],
    ["next", (mod.next ?? []).join(", ")],
  ].filter(([, value]) => value);
  const lines = [
    `${name}${mod.area ? `  (${mod.area})` : ""}`,
    mod.description,
    `  files:   ${(mod.files ?? []).length}`,
    ...extras.map(([label, value]) => `  ${label}:${" ".repeat(7 - label.length)}${value}`),
    `  -> node scripts/ui.mjs outline ${name}`,
  ].filter(Boolean);
  console.log(lines.join("\n"));
}

function cmdOutline(indexed, flags) {
  const name = flags._[0];
  if (!indexed.mods[name]) return console.log(`unknown mod "${name}".`);
  const grouped = outline(indexed, name);
  if (flags.json) return emit(grouped, true);
  const mod = indexed.mods[name];
  console.log(`${name} — ${oneLine(mod.description, 120)}`);
  for (const [file, items] of Object.entries(grouped)) {
    console.log(`\n${file}`);
    for (const item of items) {
      if (flags.ui && !["view", "control", "class"].includes(item.kind)) continue;
      const bits = [`  L${String(item.line).padEnd(5)}`, item.name.padEnd(38), item.kind.padEnd(7)];
      if (item.ids.length) bits.push(`id ${item.ids.join(",")}`);
      if (item.labels.length) bits.push(quoted(item.labels.slice(0, 2)));
      console.log(bits.join(" "));
    }
  }
}

function cmdPages(indexed, flags) {
  if (flags.json) return emit(indexed.pages, true);
  for (const page of indexed.pages) {
    const open = page.stack ? `node scripts/ui.mjs open ${page.node}` : `mod ${page.mod}`;
    console.log(
      `${page.layout}  ${String(page.node).padEnd(16)} ${(page.mod ?? "(native)").padEnd(30)} ${open}`,
    );
  }
}

function cmdAudit(indexed, flags) {
  const report = audit(indexed);
  if (flags.json) return emit(report, true);
  const percent = report.interactive
    ? Math.round((report.missingIds.length / report.interactive) * 100)
    : 0;
  console.log(
    `interactive builders: ${report.interactive}  without a stable id: ${report.missingIds.length} (${percent}%)`,
  );
  console.log(`literal ids reused on more than one builder: ${report.duplicateIds.length}`);
  for (const duplicate of report.duplicateIds.slice(0, 5))
    console.log(`  ${duplicate.id}: ${duplicate.first} and ${duplicate.second}`);
  const byMod = {};
  for (const item of report.missingIds) byMod[item.mod] = (byMod[item.mod] ?? 0) + 1;
  for (const [mod, count] of Object.entries(byMod).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )) {
    console.log(`  ${mod.padEnd(32)} ${count}`);
  }
  console.log(
    'Add .id("<mod>-<name>") and .accessibility_label("<what it does>") to a control before writing a new one.',
  );
}

function cmdStatus(flags) {
  const status = live.appStatus();
  if (flags.json) return emit(status, true);
  console.log(
    `layout=${status.layout} space=${status.space} tab=${status.tab} agent=${status.agent ?? "-"}`,
  );
  console.log(`overlays=${(status.overlays ?? []).length} errors=${(status.errors ?? []).length}`);
  for (const error of status.errors ?? []) console.log(`  ! ${error}`);
}

function resolvePage(indexed, term) {
  const query = String(term).toLowerCase();
  return (
    indexed.pages.find((page) => page.node?.toLowerCase() === query) ??
    indexed.pages.find((page) => page.mod?.toLowerCase() === query) ??
    indexed.pages.find(
      (page) => page.node?.toLowerCase().includes(query) || page.mod?.toLowerCase().includes(query),
    )
  );
}

function openResult(page, term) {
  if (!page) return live.appDo(["mod.open", "--name", term]);
  if (page.stack) return live.appDo(["layout.select", "--stack", page.stack, "--child", page.node]);
  if (!page.mod) throw new Error(`${page.node} is not inside a stack and has no mod`);
  return live.appDo(["mod.open", "--name", page.mod]);
}

function cmdOpen(indexed, flags) {
  const term = flags._[0];
  if (!term) throw new Error("open needs a page node or mod name; see: node scripts/ui.mjs pages");
  const page = resolvePage(indexed, term);
  const result = openResult(page, term);
  if (flags.json) return emit({ page: page ?? null, result }, true);
  console.log(page ? `opened ${page.node} (${page.mod ?? "native"})` : `opened mod ${term}`);
  emit(result, false);
}

function shotPath(flags) {
  const out = flags.out ? resolve(String(flags.out)) : join(ARTIFACTS, "latest.png");
  mkdirSync(join(out, ".."), { recursive: true });
  return out;
}

function cmdShot(flags) {
  const path = shotPath(flags);
  live.capture(path);
  live.assertShotMatchesWindow(live.appPid(), path);
  const [width, height] = live.imageSize(path);
  if (flags.json) return emit({ shot: path, width, height }, true);
  console.log(`${path}  ${width}x${height}`);
}

function currentRows(flags) {
  const path = shotPath(flags);
  live.capture(path);
  live.assertShotMatchesWindow(live.appPid(), path);
  return { path, rows: live.ocr(path) };
}

function cmdTree(indexed, flags) {
  const { path, rows } = currentRows(flags);
  const map = flags.map ? textMap(indexed) : null;
  const annotate = (row) =>
    (map?.get(live.normalize(row.text)) ?? []).map((item) => ({
      id: item.ids[0] ?? null,
      name: item.name,
      file: item.file,
      line: item.line,
    }));
  const ordered = live.readingOrder(rows).map((row) => ({ ...row, components: annotate(row) }));
  let status = null;
  try {
    status = live.appStatus();
  } catch {
    /* the window may be starting */
  }
  if (flags.json) return emit({ shot: path, layout: status?.layout ?? null, rows: ordered }, true);
  if (status)
    console.log(
      `# ${status.layout} space=${status.space} tab=${status.tab} overlays=${(status.overlays ?? []).length}`,
    );
  for (const row of ordered) {
    const tag = row.components.length
      ? `  <- ${row.components.map((item) => item.id ?? item.name).join(", ")}`
      : "";
    console.log(`${row.y.toFixed(3)}  x=${row.x.toFixed(3)}  ${row.text}${tag}`);
  }
}

async function rowsWithText(text, flags) {
  const path = shotPath(flags);
  let rows = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    live.capture(path);
    live.assertShotMatchesWindow(live.appPid(), path);
    rows = live.ocr(path);
    if (live.matchWords(rows, text).length) break;
    await live.waitForChange(180);
  }
  return { path, rows, matches: live.matchWords(rows, text) };
}

async function cmdFindText(flags) {
  const text = flags._.join(" ");
  if (!text) throw new Error("find-text needs text");
  const found = await rowsWithText(text, flags);
  const matches = found.matches.map((row) => ({
    text: row.text,
    point: live.pointOf(row),
    confidence: row.confidence,
  }));
  if (flags.json) return emit({ shot: found.path, matches }, true);
  if (!matches.length)
    return console.log(`"${text}" is not visible. Run: node scripts/ui.mjs tree`);
  for (const match of matches)
    console.log(
      `${match.point[0].toFixed(3)},${match.point[1].toFixed(3)}  "${match.text}"  (${match.confidence.toFixed(2)})`,
    );
}

function targetText(indexed, flags) {
  if (flags.text) return String(flags.text);
  if (!flags.id) return null;
  const entry = indexed.ids[flags.id];
  if (!entry)
    throw new Error(`unknown id "${flags.id}"; run: node scripts/ui.mjs find ${flags.id}`);
  if (!entry.label || entry.label.includes("${"))
    throw new Error(`id ${flags.id} has no fixed accessible label; use --text`);
  return entry.label;
}

async function driveClick(indexed, flags) {
  const pid = live.appPid();
  const bounds = live.windowBounds(pid);
  const before = join(ARTIFACTS, "before.png");
  const after = join(ARTIFACTS, "after.png");
  let point = flags.point ? String(flags.point).split(",").map(Number) : null;
  const label = point ? String(flags.point) : targetText(indexed, flags);
  if (!point && !label) throw new Error("click needs --id, --text or --point x,y");
  let rowsBefore = [];
  if (point) {
    live.capture(before);
    rowsBefore = live.ocr(before);
  } else {
    const found = await rowsWithText(label, { out: before });
    const word = live.pickWord(found.matches, flags.occurrence);
    if (!word) throw new Error(`"${label}" is not visible. Run: node scripts/ui.mjs tree`);
    point = live.pointOf(word);
    rowsBefore = found.rows;
  }
  if (flags["dry-run"]) return console.log(`would click ${point[0]},${point[1]} (${label})`);
  const pixels = live.clickPoint(pid, point, bounds);
  await live.waitForChange();
  live.capture(after);
  const rowsAfter = live.ocr(after);
  return { before, after, point, pixels, label, ...live.textDiff(rowsBefore, rowsAfter) };
}

async function cmdClick(indexed, flags) {
  const result = await driveClick(indexed, flags);
  if (!result) return;
  if (flags.json) return emit(result, true);
  console.log(
    `clicked ${result.label} at ${result.point[0].toFixed(3)},${result.point[1].toFixed(3)}`,
  );
  console.log(`  before: ${result.before}`);
  console.log(`  after:  ${result.after}`);
  console.log(`  changed text: +${result.added.length} -${result.removed.length}`);
  for (const text of result.added) console.log(`    + ${text}`);
  for (const text of result.removed) console.log(`    - ${text}`);
}

function cmdType(flags) {
  const text = flags._.join(" ");
  if (!text) throw new Error("type needs text");
  live.paste(live.appPid(), text);
  if (flags.enter) live.pressKey(live.appPid(), "return");
  console.log(`typed ${text.length} characters${flags.enter ? " and pressed return" : ""}`);
}

function cmdKey(flags) {
  const key = flags._[0];
  if (!key) throw new Error("key needs a name, for example: key escape");
  if (key === "escape") {
    let overlays = 0;
    try {
      overlays = (live.appStatus().overlays ?? []).length;
    } catch {
      /* the window may be starting */
    }
    if (overlays) {
      live.appDo(["overlay.close"]);
      console.log(`closed ${overlays} overlay with herdr-app do overlay.close`);
      return;
    }
  }
  console.log(live.pressKey(live.appPid(), key));
}

async function cmdScroll(indexed, flags) {
  const direction = flags._[0] ?? "down";
  if (!["up", "down"].includes(direction)) throw new Error("scroll needs up or down");
  const pid = live.appPid();
  const bounds = live.windowBounds(pid);
  let point = flags.point ? String(flags.point).split(",").map(Number) : [0.5, 0.5];
  if (flags.text) {
    const word = live.pickWord(
      (await rowsWithText(String(flags.text), { out: join(ARTIFACTS, "scroll.png") })).matches,
      flags.occurrence,
    );
    if (!word) throw new Error(`"${flags.text}" is not visible`);
    point = live.pointOf(word);
  }
  const amount = Number(flags.amount ?? 400) * (direction === "down" ? -1 : 1);
  live.scrollPoint(pid, point, bounds, amount);
  console.log(`scrolled ${direction} at ${point[0]},${point[1]}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseArgs(rest);
  if (!command || command === "help" || command === "--help") return console.log(USAGE);
  const indexed = await index();
  const local = {
    find: () => cmdFind(indexed, flags),
    where: () => cmdWhere(indexed, flags),
    outline: () => cmdOutline(indexed, flags),
    mod: () => cmdMod(indexed, flags),
    pages: () => cmdPages(indexed, flags),
    audit: () => cmdAudit(indexed, flags),
    status: () => cmdStatus(flags),
    open: () => cmdOpen(indexed, flags),
    shot: () => cmdShot(flags),
    tree: () => cmdTree(indexed, flags),
    "find-text": () => cmdFindText(flags),
    click: () => cmdClick(indexed, flags),
    type: () => cmdType(flags),
    key: () => cmdKey(flags),
    scroll: () => cmdScroll(indexed, flags),
    index: () =>
      flags.out
        ? writeFileSync(String(flags.out), JSON.stringify(indexed, null, 2))
        : console.log(
            `${Object.keys(indexed.mods).length} mods, ${indexed.components.length} components, ${Object.keys(indexed.ids).length} ids, ${indexed.pages.length} pages`,
          ),
  };
  if (!local[command]) throw new Error(`unknown command "${command}"\n\n${USAGE}`);
  await local[command]();
}

main().catch((error) => {
  console.error(`ui: ${error.message}`);
  process.exit(1);
});
