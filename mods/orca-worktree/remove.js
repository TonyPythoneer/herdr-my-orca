const REMOVE_UNAVAILABLE = "Remove worktree is unavailable: files created during removal could be lost.";
async function removeWorktree() {
	throw new Error(REMOVE_UNAVAILABLE);
}

export { REMOVE_UNAVAILABLE, removeWorktree };
