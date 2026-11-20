export const REMOVE_UNAVAILABLE = "Remove worktree is unavailable: files created during removal could be lost.";

// shortcut: Git cannot guard ignored files created after inspection; restore removal when the host can make it atomic.
export async function removeWorktree() {
  throw new Error(REMOVE_UNAVAILABLE);
}
