import type { ExecResult } from "herdr";

export async function commitAndPush(
  git: (step: "commit" | "push") => Promise<ExecResult>,
  isCurrent: () => boolean,
  committed: () => void,
): Promise<boolean> {
  const commit = await git("commit");
  if (commit.code !== 0)
    throw new Error((commit.stderr || commit.stdout).trim() || "Commit failed");
  if (!isCurrent()) return false;
  committed();
  try {
    const push = await git("push");
    if (push.code !== 0) throw new Error((push.stderr || push.stdout).trim() || "Unknown error");
    return true;
  } catch (e) {
    throw new Error(
      `Commit succeeded, but push failed: ${(e as { message?: string }).message || e}`,
    );
  }
}
