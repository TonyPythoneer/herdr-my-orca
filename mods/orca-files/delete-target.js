import { sameWorkspace, hasUnsafePart } from "./workspace-path.js";

// The path below the workspace root, checked against the workspace the confirmation was opened for.
function relativeTarget(target, current) {
  if (!target?.cwd || !target.space || !target.path || !sameWorkspace(target, current)) {
    throw new Error("Workspace or host changed; deletion was cancelled.");
  }
  const root = target.cwd.replace(/\/+$/, ""), prefix = root ? `${root}/` : "/";
  const relative = target.path.startsWith(prefix) ? target.path.slice(prefix.length) : "";
  if (!relative || hasUnsafePart(relative)) throw new Error("Invalid deletion target.");
  return { root, relative };
}

// The confirmation may outlive the workspace that opened it.
export async function deleteTarget(target, current, exec) {
  const { root, relative } = relativeTarget(target, current);
  // shortcut: path components can change between the checks and rm; use a host API with
  // directory-handle-relative deletion when Herdr exposes one.
  const script = `
dir=$1; rest=$2
if [ -L "$dir" ] || [ ! -d "$dir" ]; then echo 'Unsafe or missing workspace root' >&2; exit 1; fi
while case "$rest" in */*) true;; *) false;; esac; do
  part=\${rest%%/*}; rest=\${rest#*/}; dir="$dir/$part"
  if [ -L "$dir" ] || [ ! -d "$dir" ]; then echo 'Unsafe or missing parent directory' >&2; exit 1; fi
done
if [ ! -e "$dir/$rest" ] && [ ! -L "$dir/$rest" ]; then echo 'Target no longer exists' >&2; exit 1; fi
rm -r -- "$dir/$rest"
`;
  const result = await exec("sh", ["-c", script, "delete", root || "/", relative], { on: target.on });
  if (result.code !== 0) throw new Error((result.stderr || result.stdout || "Delete failed").trim());
}
