// Literal pathspecs prevent file names from becoming Git glob or magic expressions.
export const GIT_OPTIONS = ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

// One git command takes at most this many paths and about this many bytes of arguments
// (a path counts three bytes per character plus a separator, the worst case for UTF-8).
const MAX_PATHS_PER_COMMAND = 200, MAX_ARGUMENT_BYTES = 16000, BYTES_PER_CHARACTER = 3;

export function chunkPaths(paths) {
  const chunks = []; let current = [], bytes = 0;
  for (const path of paths) {
    const size = path.length * BYTES_PER_CHARACTER + 1;
    if (current.length && (current.length === MAX_PATHS_PER_COMMAND || bytes + size > MAX_ARGUMENT_BYTES)) { chunks.push(current); current = []; bytes = 0; }
    current.push(path); bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
