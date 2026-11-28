const MAX_LINES = 1500;

const MAX_LINE_CHARS = 4000;
const TAB_WIDTH = 4;
const UNTRACKED_PREVIEW_MAX = 20;
const WIDTH_PER_CHAR = 7;
const WIDTH_GUTTER = 50;
export const MIN_WIDTH = 300;
const DIFF_HEADER = "diff --git ";
const BLANK = " ";

export const ROW = {
  file: "F",
  hunk: "@",
  added: "+",
  removed: "-",
  context: " ",
  plain: "",
} as const;

export type DiffRow = { kind: string; number?: number; text: string };
export type DiffLinesOptions = { files?: boolean; max?: number };
export type UntrackedPreview = { paths: string[]; omitted: number };

const untab = (text: string): string =>
  text.replace(/[^\t]*\t/g, (chunk) =>
    chunk.slice(0, -1).padEnd(chunk.length - 1 - ((chunk.length - 1) % TAB_WIDTH) + TAB_WIDTH),
  );

function diffFileLabel(line: string): string {
  const header = line.slice(DIFF_HEADER.length);
  const quoted = /^"a\/((?:\\.|[^"\\])*)" "b\/((?:\\.|[^"\\])*)"$/.exec(header);
  if (quoted && quoted[1] === quoted[2]) return `"${quoted[2]}"`;
  if (header.startsWith("a/")) {
    for (let i = header.indexOf(" b/"); i !== -1; i = header.indexOf(" b/", i + 1)) {
      if (header.slice(2, i) === header.slice(i + 3)) return header.slice(i + 3);
    }
  }
  return header;
}

export function diffRows(lines: string[]): DiffRow[] {
  let old = 0,
    next = 0;
  return lines.map((line): DiffRow => {
    if (line.startsWith(DIFF_HEADER)) return { kind: ROW.file, text: diffFileLabel(line) };
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) {
      old = +match[1];
      next = +match[2];
      return { kind: ROW.hunk, text: line };
    }
    const kind = line[0];
    if (kind === ROW.removed) return { kind, number: old++, text: untab(line.slice(1)) || BLANK };
    if (kind === ROW.added) return { kind, number: next++, text: untab(line.slice(1)) || BLANK };
    if (kind === ROW.context) {
      old++;
      return { kind, number: next++, text: untab(line.slice(1)) || BLANK };
    }
    return { kind: ROW.plain, text: line };
  });
}

const clipLine = (line: string): string =>
  line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) + "…" : line;

function boundedLines(out: string[], max: number): string[] {
  if (!out.length) return ["No text diff available"];
  return out.length > max ? [...out.slice(0, max), `… diff cut at ${max} lines`] : out;
}

export function diffLines(
  stdout: string,
  { files = false, max = MAX_LINES }: DiffLinesOptions = {},
): string[] {
  const out: string[] = [];
  let inHunk = false;
  for (const l of stdout.replace(/\n$/, "").split("\n")) {
    if (l.startsWith(DIFF_HEADER)) {
      inHunk = false;
      if (files) out.push(l);
      continue;
    }
    if (l.startsWith("@@")) inHunk = true;
    if (inHunk) out.push(clipLine(l));
    else if (/^(Binary files|GIT binary patch)/.test(l)) out.push("Binary file · no text diff");
    if (out.length > max) break;
  }
  return boundedLines(out, max);
}

export function untrackedPreview(paths: string[]): UntrackedPreview {
  return {
    paths: paths.slice(0, UNTRACKED_PREVIEW_MAX),
    omitted: Math.max(0, paths.length - UNTRACKED_PREVIEW_MAX),
  };
}

export const diffWidth = (rows: DiffRow[]): number =>
  Math.max(MIN_WIDTH, ...rows.map((row) => (row.text.length + 1) * WIDTH_PER_CHAR + WIDTH_GUTTER));
