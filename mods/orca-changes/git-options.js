// Literal pathspecs prevent file names from becoming Git glob or magic expressions.
export const GIT_OPTIONS = ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

export function chunkPaths(paths) {
  const chunks = []; let current = [], bytes = 0;
  for (const path of paths) {
    const size = path.length * 3 + 1;
    if (current.length && (current.length === 200 || bytes + size > 16000)) { chunks.push(current); current = []; bytes = 0; }
    current.push(path); bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
