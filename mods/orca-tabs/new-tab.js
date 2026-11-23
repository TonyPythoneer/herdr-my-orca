// The arguments for a tab that must start in its space's work directory — the worktree
// checkout for a worktree space, the repo root for the main space — rather than in whatever
// directory the space's focused shell happens to be in. `tab.new`'s own default is the
// focused terminal's live cwd (`herdr-app commands`), which moves with every `cd`.
// A space with no folder keeps that default (its machine's home).
export function newTabArgs(space) {
  if (!space?.id) return {};
  return { space: space.id, ...(space.folder ? { folder: space.folder } : {}) };
}
