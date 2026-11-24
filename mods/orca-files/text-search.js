// splitSearchGlobPatterns (text-search-glob-patterns.ts:2-62): a comma separates several
// globs unless escaped or inside `{…}` / `[…]`; trim each piece and drop empties.
// shortcut: POSIX classes (`[[:alpha:],]`) are not tracked for rg; upgrade if one is needed.
export function splitGlobs(text) {
  const globs = [];
  let pattern = "", braces = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      pattern += text.slice(i, i + 2);
      i++;
    } else if (ch === "[") {
      // The first character (after an optional negation) may itself be a literal ']'.
      const start = i;
      const first = i + ("!^".includes(text[i + 1]) ? 2 : 1);
      const end = text.indexOf("]", first + 1);
      i = end < 0 ? text.length - 1 : end;
      pattern += text.slice(start, i + 1);
    } else if (ch === "," && !braces) {
      if (pattern.trim()) globs.push(pattern.trim());
      pattern = "";
    } else {
      if (ch === "{") braces++;
      if (ch === "}") braces = Math.max(0, braces - 1);
      pattern += ch;
    }
  }
  if (pattern.trim()) globs.push(pattern.trim());
  return globs;
}

const MAX_SEARCH_HITS = 200;

export function searchResults(stdout) {
  const groups = new Map();
  let totalMatches = 0;
  for (const l of stdout.split("\n")) {
    const [file, lineS, colS, ...rest] = l.split(":");
    if (!file || !lineS) continue;
    totalMatches += 1;
    if (totalMatches > MAX_SEARCH_HITS) continue; // count all hits, keep 200 for display
    let group = groups.get(file);
    if (!group) { group = { path: file, matches: [] }; groups.set(file, group); }
    group.matches.push({ line: Number(lineS), column: Number(colS) || 1, text: rest.join(":").trim() });
  }
  const files = [...groups.values()];
  return { totalMatches, fileCount: files.length, files, truncated: totalMatches > MAX_SEARCH_HITS };
}
