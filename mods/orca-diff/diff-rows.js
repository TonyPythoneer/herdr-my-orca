// Parsing for the Changes panel's diff view, ported from the shipped `changes` mod. Kept free of
// gpui imports so node can test it.
const MAX_LINES = 1500;

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

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
export function diffLines(stdout, { files = false, max = MAX_LINES } = {}) {
  const out = []; let inHunk = false;
  for (const l of stdout.replace(/\n$/, "").split("\n")) {
    if (l.startsWith("diff --git ")) { inHunk = false; if (files) out.push(l); continue; }
    if (l.startsWith("@@")) inHunk = true;
    if (inHunk) out.push(l.length > 4000 ? l.slice(0, 4000) + "…" : l);
    else if (/^(Binary files|GIT binary patch)/.test(l)) out.push("Binary file · no text diff");
    if (out.length > max) break;
  }
  if (!out.length) return ["No text diff available"];
  return out.length > max ? [...out.slice(0, max), `… diff cut at ${max} lines`] : out;
}

export function untrackedPreview(paths) {
  return { paths: paths.slice(0, 20), omitted: Math.max(0, paths.length - 20) };
}

export const diffWidth = (rows) => Math.max(300, ...rows.map((row) => (row.text.length + 1) * 7 + 50));
