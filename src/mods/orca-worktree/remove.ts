export const REMOVE_UNAVAILABLE =
  "Remove worktree is unavailable: files created during removal could be lost.";

export async function removeWorktree(): Promise<never> {
  throw new Error(REMOVE_UNAVAILABLE);
}
