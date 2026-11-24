// Parsing for the Changes panel's diff view, ported from the shipped `changes` mod. Kept free of
// gpui imports so node can test it.
const MAX_LINES = 1500;
// A single line is cut here so one minified file cannot make a row of unbounded width.
const MAX_LINE_CHARS = 4000;
const TAB_WIDTH = 4;
const UNTRACKED_PREVIEW_MAX = 20;

// Text draws a tab as nothing: pad each to the next tab stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (chunk) => chunk.slice(0, -1).padEnd((chunk.length - 1) - (chunk.length - 1) % TAB_WIDTH + TAB_WIDTH));

function diffFileLabel(line) {
  const header = line.slice("diff --git ".length);
  const quoted = /^"a\/((?:\\.|[^"\\])*)" "b\/((?:\\.|[^"\\])*)"$/.exec(header);
  if (quoted && quoted[1] === quoted[2]) return `"${quoted[2]}"`;
  if (header.startsWith("a/")) {
    for (let i = header.indexOf(" b/"); i !== -1; i = header.indexOf(" b/", i + 1)) {
      if (header.slice(2, i) === header.slice(i + 3)) return header.slice(i + 3);
    }
  }
  return header;
}

export function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    if (line.startsWith("diff --git ")) return { kind: "F", text: diffFileLabel(line) };
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, number: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: untab(line.slice(1)) || " " }; }
    return { kind: "", text: line };
  });
}

// `git diff` output -> the lines from each hunk on; `files` keeps each file's `diff --git` line as its header.
// A binary file keeps one message line, and a diff with neither has nothing to show.
const clipLine = (line) => line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) + "…" : line;

function boundedLines(out, max) {
  if (!out.length) return ["No text diff available"];
  return out.length > max ? [...out.slice(0, max), `… diff cut at ${max} lines`] : out;
}

export function diffLines(stdout, { files = false, max = MAX_LINES } = {}) {
  const out = []; let inHunk = false;
  for (const l of stdout.replace(/\n$/, "").split("\n")) {
    if (l.startsWith("diff --git ")) { inHunk = false; if (files) out.push(l); continue; }
    if (l.startsWith("@@")) inHunk = true;
    if (inHunk) out.push(clipLine(l));
    else if (/^(Binary files|GIT binary patch)/.test(l)) out.push("Binary file · no text diff");
    if (out.length > max) break;
  }
  return boundedLines(out, max);
}

export function untrackedPreview(paths) {
  return { paths: paths.slice(0, UNTRACKED_PREVIEW_MAX), omitted: Math.max(0, paths.length - UNTRACKED_PREVIEW_MAX) };
}

export const diffWidth = (rows) => Math.max(300, ...rows.map((row) => (row.text.length + 1) * 7 + 50));
