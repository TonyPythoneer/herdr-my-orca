// Orca's status priority: deleted > modified > added/untracked > renamed > copied
// (git-path-decoration.ts:14-22); labels are U/A/M/D/R/C (git-status-labels.ts:3-10).
// Porcelain chars outside the set (T, unmerged U) are `modified`, as parseStatusChar does
// (git-status-porcelain-parser.ts:179-194).
const RANK = { D: 5, M: 4, A: 3, U: 3, R: 2, C: 1 };

function trackedMark(xy) {
  let best = "M", rank = 0;
  for (const char of xy) {
    if (char === " " || char === ".") continue;
    const letter = "DMARC".includes(char) ? char : "M";
    if (RANK[letter] > rank) { best = letter; rank = RANK[letter]; }
  }
  return best;
}

function folderStatuses(marks) {
  const folders = {};
  // Deleted and ignored descendants do not colour their parent.
  for (const [path, letter] of Object.entries(marks)) {
    if (letter === "!" || letter === "D") continue;
    let folder = "";
    for (const name of path.split("/").slice(0, -1)) {
      folder = folder ? `${folder}/${name}` : name;
      if (!folders[folder] || RANK[letter] > (RANK[folders[folder]] ?? 1)) folders[folder] = letter;
    }
  }
  return folders;
}

export function parseStatus(stdout, base, root, limit) {
  const marks = {}, ignored = new Set();
  const fields = stdout.split("\0").filter(Boolean);
  for (let i = 0; i < fields.length && i < limit; i++) {
    const entry = fields[i], xy = entry.slice(0, 2);
    const absolute = `${base}/${entry.slice(3).replace(/\/$/, "")}`;
    if (!absolute.startsWith(root + "/")) continue;
    const path = absolute.slice(root.length + 1);
    if (xy === "!!") { marks[path] = "!"; ignored.add(path); continue; }
    if (xy === "??") { marks[path] = "U"; continue; }
    marks[path] = trackedMark(xy);
    // A rename/copy has a second NUL-delimited field for its original path.
    if (xy[0] === "R" || xy[0] === "C") i++;
  }
  return { marks, folderMarks: folderStatuses(marks), ignored };
}
