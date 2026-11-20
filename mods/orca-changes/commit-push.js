// Keep commit success distinct from the later push so a failed push is safe to retry.
export async function commitAndPush(git, isCurrent, committed) {
  const commit = await git("commit");
  if (commit.code !== 0) throw new Error((commit.stderr || commit.stdout).trim() || "Commit failed");
  if (!isCurrent()) return false;
  committed();
  try {
    const push = await git("push");
    if (push.code !== 0) throw new Error((push.stderr || push.stdout).trim() || "Unknown error");
    return true;
  } catch (e) {
    throw new Error(`Commit succeeded, but push failed: ${e.message || e}`);
  }
}
