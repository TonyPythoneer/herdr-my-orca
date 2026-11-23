// A tab follows its agent into a worktree.
//
// An agent CLI can take its own process out of the space it was started in: `claude
// --worktree`, `codex --worktree`, or a `cd` inside the CLI. Herdr keeps the tab where it
// was, so the tab works on a worktree but is still listed under the main checkout, on the
// main checkout's branch. Herdr has no tab→space move, so the move is the pair `orca-tabs`
// already uses between panes: `terminal.park` takes the pane away while the terminal keeps
// running, `terminal.keep` gives it a tab in the space that is shown. Nothing restarts the
// agent and nothing changes its folder.

/** Herdr reports no worktree event, so this is a poll. Three seconds costs one `hc get` per agent. */
export const FOLLOW_EVERY_MS = 3000;
/** Terminal -> the checkout it was already sent to. Stops a tab bouncing back and forth. */
export const FOLLOW_STATE_KEY = "wt-follow.moved";

/**
 * `git rev-parse --path-format=absolute --show-toplevel --git-dir --git-common-dir --abbrev-ref HEAD`
 * as one record. The main checkout has `git-dir === common`; a linked worktree's git-dir lives
 * under `<common>/worktrees/<name>`.
 */
export function parseCheckout(out) {
  const lines = String(out ?? "").trim().split(/\r?\n/);
  if (lines.length < 3 || !lines[0]) return null;
  const [top, gitdir, common, branch] = lines;
  if (!gitdir) return null;
  return { top, gitdir, common: common || gitdir, branch: branch || null };
}

/** A checkout that is not the repository's main one. */
export const isLinked = (checkout) => Boolean(checkout?.top) && checkout.gitdir !== checkout.common;

/**
 * The first agent pane whose live folder is a linked worktree of the repo its space is on.
 * `spaces[i].checkout` and `cwdCheckouts[cwd]` are records from `parseCheckout` (or null);
 * `panes` are `panes()` rows; `cwds` maps a terminal to the folder its program is in now.
 * One move per call: the tab moves, then the next poll plans again.
 */
export function planFollow({ spaces = [], panes = [], cwds = {}, cwdCheckouts = {}, moved = {} }) {
  for (const pane of panes) {
    if (!pane.terminal || !pane.program?.agent) continue;
    const cwd = cwds[pane.terminal];
    const there = cwd ? cwdCheckouts[cwd] : null;
    if (!isLinked(there)) continue;
    const space = spaces.find((s) => (s.tabs ?? []).some((t) => t.id === pane.tab));
    if (!space || space.machine) continue; // another machine's folder is not ours to git
    const from = space.checkout;
    if (!from?.top || from.common !== there.common) continue; // another repository
    if (there.top === from.top) continue; // already the checkout the space is on
    if (moved[pane.terminal] === there.top) continue; // sent there once and came back
    const tab = (space.tabs ?? []).find((t) => t.id === pane.tab);
    return {
      terminal: pane.terminal,
      app: pane.program.name || pane.app || "Agent",
      to: there.top,
      branch: there.branch,
      from: {
        space: space.id,
        folder: space.folder,
        tab: pane.tab,
        active: Boolean(space.active),
        tabName: tab?.named ? tab.name : null,
        // Parking the last terminal closes its tab, and a space closes with its last tab.
        onlyTerminal: panes.filter((p) => p.terminal && (space.tabs ?? []).some((t) => t.id === p.tab)).length === 1,
      },
    };
  }
  return null;
}
