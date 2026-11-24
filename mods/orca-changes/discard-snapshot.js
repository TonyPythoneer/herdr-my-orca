import { chunkPaths, GIT_OPTIONS } from "./git-options.js";

// A status or index listing longer than this is refused rather than compared.
const MAX_GIT_OUTPUT_CHARS = 7_000_000;

// shortcut: the snapshot and subsequent Git write are not atomic; use a host transaction API when available.
export async function discardSnapshot(target, paths, exec) {
  if (!target?.root || !paths.length || paths.some((p) => !p || p.startsWith("/") || p.split("/").some((s) => !s || s === "." || s === ".."))) {
    throw new Error("Invalid discard target.");
  }
  const result = [];
  for (const part of chunkPaths(paths)) {
    const opts = { cwd: target.root, on: target.on };
    for (const args of [["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...part], ["ls-files", "--stage", "-z", "--", ...part]]) {
      const r = await exec("git", [...GIT_OPTIONS, ...args], opts);
      if (r.code !== 0 || r.stdout.length > MAX_GIT_OUTPUT_CHARS) throw new Error("Cannot verify Git state before discard.");
      result.push(r.stdout);
    }
    const script = `
root=$1; shift
if [ -L "$root" ] || [ ! -d "$root" ]; then echo 'Unsafe or missing repository root' >&2; exit 1; fi
for path do
  rest=$path; dir=.
  while case "$rest" in */*) true;; *) false;; esac; do
    part=\${rest%%/*}; rest=\${rest#*/}; dir="$dir/$part"
    if [ -L "$dir" ]; then echo 'Unsafe parent directory' >&2; exit 1; fi
    if [ ! -d "$dir" ]; then printf 'missing\\n'; continue 2; fi
  done
  file="$dir/$rest"
  if [ -L "$file" ]; then echo 'Symbolic link cannot be safely discarded' >&2; exit 1; fi
  if [ ! -e "$file" ]; then printf 'missing\\n'; continue; fi
  if [ ! -f "$file" ]; then echo 'Not a regular file' >&2; exit 1; fi
  permissions=$(stat -f '%Lp' "$file" 2>/dev/null) || permissions=$(stat -c '%a' "$file") || exit 1
  hash=$(git hash-object --no-filters -- "$file") || exit 1
  printf '%s %s\\n' "$permissions" "$hash"
done
`;
    const r = await exec("sh", ["-c", script, "discard-snapshot", target.root.replace(/\/+$/, "") || "/", ...part], opts);
    if (r.code !== 0) throw new Error((r.stderr || "Cannot verify files before discard.").trim());
    result.push(r.stdout);
  }
  return JSON.stringify(result);
}

export async function assertDiscardUnchanged(target, paths, snapshot, exec) {
  if (await discardSnapshot(target, paths, exec) !== snapshot) throw new Error("Files or index changed. Refresh and confirm again.");
}
