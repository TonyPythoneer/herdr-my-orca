// shortcut: the path can change between this check and the host write; use a directory-handle API when available.
export async function canEditPath(root, full, exec) {
  if (typeof root !== "string" || typeof full !== "string" || !root.startsWith("/") || !full.startsWith("/")) return false;
  const base = root.replace(/\/+$/, "") || "/", prefix = base === "/" ? "/" : `${base}/`;
  if (!full.startsWith(prefix)) return false;
  const relative = full.slice(prefix.length);
  if (!relative || relative.split("/").some((part) => !part || part === "." || part === "..")) return false;
  const script = `
dir=$1; rest=$2
if [ -L "$dir" ] || [ ! -d "$dir" ]; then exit 1; fi
while case "$rest" in */*) true;; *) false;; esac; do
  part=\${rest%%/*}; rest=\${rest#*/}; dir="$dir/$part"
  if [ -L "$dir" ] || [ ! -d "$dir" ]; then exit 1; fi
done
file="$dir/$rest"
[ ! -L "$file" ] && [ -f "$file" ]
`;
  try { return (await exec("sh", ["-c", script, "editor-path", base, relative])).code === 0; }
  catch { return false; }
}

export async function writeEditorFile(doc, text, expected, exec, write) {
  if (!await canEditPath(doc.root, doc.full, exec)) throw new Error("File path is outside the workspace, changed, or contains a symbolic link.");
  return write(doc.full, text, expected);
}
