import { sameWorkspace, hasUnsafePart } from "./workspace-path.js";

const MODES = ["touch", "mkdir", "mv", "duplicate"];

// shortcut: shell path checks and mutation are not atomic; use a host directory-handle API when available.
// Copies retain ordinary permission bits, but never inherit setuid, setgid or sticky bits.
const FILE_ACTION_SCRIPT = `
dir=$1; rest=$2; mode=$3; name=$4; source=$5; stem=$6; ext=$7
if [ -L "$dir" ] || [ ! -d "$dir" ]; then echo 'Unsafe or missing workspace root' >&2; exit 1; fi
while [ -n "$rest" ]; do
  case "$rest" in */*) part=\${rest%%/*}; rest=\${rest#*/};; *) part=$rest; rest=;; esac
  dir="$dir/$part"
  if [ -L "$dir" ] || [ ! -d "$dir" ]; then echo 'Unsafe or missing parent directory' >&2; exit 1; fi
done
if [ "$mode" = duplicate ]; then
  if [ -L "$source" ] || [ ! -f "$source" ]; then echo 'Source is missing or is not a regular file' >&2; exit 1; fi
  dest="$dir/$stem copy$ext"; n=2
  while [ -e "$dest" ] || [ -L "$dest" ]; do dest="$dir/$stem copy $n$ext"; n=$((n + 1)); done
  (
    umask 077; set -C; set -e
    exec 3> "$dest"
    cat "$source" >&3
    permissions=$(stat -f '%Lp' "$source" 2>/dev/null) || permissions=$(stat -c '%a' "$source")
    case "$permissions" in ''|*[!0-7]*) echo 'Cannot read source permissions' >&2; exit 1;; esac
    while [ \${#permissions} -gt 3 ]; do permissions=\${permissions#?}; done
    chmod "$permissions" /dev/fd/3
  ) || { echo "Copy failed; an incomplete file may remain at $dest" >&2; exit 1; }
  exit 0
fi
dest="$dir/$name"
if [ -e "$dest" ] || [ -L "$dest" ]; then echo 'Destination already exists' >&2; exit 1; fi
case "$mode" in
  touch) (set -C; : > "$dest") ;;
  mkdir) mkdir -- "$dest" ;;
  mv)
    if [ -L "$source" ] || [ ! -e "$source" ]; then echo 'Source is missing or is a symbolic link' >&2; exit 1; fi
    mv -n -- "$source" "$dest" || exit 1
    if [ -e "$source" ] || [ -L "$source" ]; then echo 'Destination already exists or rename failed' >&2; exit 1; fi ;;
esac
`;

const isSingleName = (name) => Boolean(name) && Boolean(name.trim()) && name !== "." && name !== ".." && !/[/\\\0]/.test(name);

function validateRequest(target, current, name) {
  if (!target?.cwd || !target.space || !sameWorkspace(target, current)) throw new Error("Workspace or host changed; action was cancelled.");
  if (!isSingleName(name)) throw new Error("Enter a single valid file name.");
  if (!MODES.includes(target.mode)) throw new Error("Invalid action.");
}

// The folder the action runs in, relative to the workspace root ("" for the root itself), or null when it is outside.
function relativeFolder(parent, root, prefix, cwd) {
  if (parent === root || (cwd === "/" && parent === "/")) return "";
  return parent.startsWith(prefix) ? parent.slice(prefix.length) : null;
}

function assertSource(target, prefix, name) {
  const { full } = target;
  if (!full.startsWith(prefix) || !full.slice(prefix.length) || full.endsWith("/")) throw new Error("Invalid source.");
  if (target.mode === "duplicate" && full.slice(full.lastIndexOf("/") + 1) !== name) throw new Error("Invalid source name.");
}

// Where the action runs and what it acts on, checked against the workspace root; throws when either is outside it.
function resolvePaths(target, name) {
  const root = target.cwd.replace(/\/+$/, ""), prefix = root ? `${root}/` : "/";
  const hasSource = target.mode === "mv" || target.mode === "duplicate";
  const parent = hasSource ? target.full.replace(/\/[^/]*$/, "") : target.full;
  const relative = relativeFolder(parent, root, prefix, target.cwd);
  if (relative === null || (relative && hasUnsafePart(relative))) throw new Error("Invalid target folder.");
  if (hasSource) assertSource(target, prefix, name);
  return { root, relative };
}

export async function mutateFile(target, current, name, exec) {
  validateRequest(target, current, name);
  const { root, relative } = resolvePaths(target, name);
  const dot = name.lastIndexOf("."), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
  const result = await exec("sh", ["-c", FILE_ACTION_SCRIPT, "file-action", root || "/", relative, target.mode, name, target.full, stem, ext], { on: target.on });
  if (result.code !== 0) throw new Error((result.stderr || result.stdout || "File operation failed").trim());
}
