// Derived from Herdr App's defaults/mods/spaces/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
// Workspace spaces: worktrees under their checkout, grouped by machine when more than
// one is known. Cards follow Orca's classic card: folder/repo header, a status lane, a
// title and a meta row (branch, then the review badge at its end). Agent state lives in
// the agents list, not here. Click to switch, right-click for its menu, drag to reorder.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { spaces, machines, panes, agents, run, openOverlay, exec, hc, notify, theme, shared, setShared, watchFolder, window, nextCommand, layout } from "herdr";
import { repoMark, tint, parseRemote, avatarUrlFor, ensureAvatar, avatarFile } from "./project.js";

import { getProjectGroupHeaderPaddingLeft } from "./indentation.js";
import { tip, tipMark } from "./tip.js";
import { stopsInit, stop, focusRoot, enter, within, onStop } from "./focus.js";
import { parseWorktreeList, place, where, base, readPair, foldKey, projectWorktreePlan, pruneGitCache, forgetProject as forgetProjectCache, agentsByRow, activeReviewKeys, planRenderRows, groupSpaceIds } from "./worktree-plan.js";
import { cardView } from "./cards.js";
import { agentSettingsOpen, agentRailOwner, leftSidebarAgentRail } from "./left-sidebar-agents.js";
import { stored, workspaceOptions } from "./storage.js";
import { loadReviewCache, saveReviewCache, isReviewFresh, MAX_INFLIGHT_PR_LOOKUPS, BRANCH_PR_LOOKUP_PAGE_SIZE } from "./review-store.js";

// `BRANCH_PR_LOOKUP_PAGE_SIZE` (pr-branch-lookup.ts:28): "GitHub lists a branch's PRs newest
// first, so with a page of one a closed PR opened after the live one wins." Exported by review-store.js.

// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// Retained row views released, created or re-propped per sync, so one frame never does them all at once.
const MAX_RETAINED_OPERATIONS = 16;

// While the sidebar is stepped narrower (orca-header `toggleSidebar`) its content
// keeps the open width and only fades and slides, so nothing reflows or truncates on the way.
// Opacity clamp((k-.15)/.85) and a -28px*(1-k) shift are the approved prototype's numbers.
// Untouched (returns `inner`) whenever the sidebar is at its open width or no open width is shared.
function sidebarFrame(inner) {
  const find = (n, id) => { if (n?.id === id) return n; for (const c of n?.children ?? []) { const r = find(c, id); if (r) return r; } return null; };
  const open = shared("left-sidebar.openPx");
  const px = find(layout(), "left-sidebar")?.size?.px;
  if (!(open > 0) || !(px > 0) || px >= open - 0.5) return inner;
  const k = px / open;
  // GPU cost: a group `opacity` makes the GPU draw the whole subtree off-screen every frame. A flat
  // cover in the sidebar's own colour, with the alpha the fade needs, is one blended quad.
  const bg = theme().surface;
  const cover = Math.max(0, Math.min(1, 1 - (k - 0.15) / 0.85));
  const alpha = Math.round(cover * 255).toString(16).padStart(2, "0");
  return div().size_full().overflow_hidden().relative()
    .child(div().w(open).h_full().relative().left(-(1 - k) * 28).child(inner))
    .child(div().absolute().top(0).left(0).right(0).bottom(0).bg(/^#[0-9a-f]{6}$/i.test(bg) ? `${bg}${alpha}` : bg));
}

// The repo's own .git folder names it; a worktree's top differs from it.
async function readGitIdentity(cwd, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
  const topDir = top.stdout.trim();
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
  const commonDir = common.stdout.trim();
  if (top.code !== 0 || common.code !== 0 || !topDir || !commonDir) throw new Error("Incomplete git identity");
  const name = commonDir.endsWith("/.git") ? base(commonDir.slice(0, -5)) : base(commonDir).replace(/\.git$/, "");
  return { topDir, commonDir, name };
}

// The parent of a fork that has no `upstream` remote, or null. `exec` has its own 30s cap
// (`gpui-kit.d.ts:22202`), so there is no per-call timeout to pass; off-machine reads are skipped
// by the caller because `gh` there may not be authenticated.
async function forkParent(origin, cwd) {
  const q = await exec("gh", ["repo", "view", `${origin.owner}/${origin.repo}`, "--json", "isFork,parent"], { cwd }).catch(() => null);
  if (q?.code !== 0) return null;
  const d = JSON.parse(q.stdout);
  const owner = d?.parent?.owner?.login;
  const repo = d?.parent?.name;
  return d?.isFork && owner && repo ? { owner, repo } : null;
}

// Orca queries PRs by base repo and origin head (`pr-branch-lookup.ts:41-48`,
// `github-api-repository.ts:127-133`); repo icons use Orca's owner avatar fallback
// (`repo-icon.ts:37-54`). Fills `found` as it learns, so a failure part-way keeps what it had.
async function fillRemoteIdentity(found, cwd, on) {
  const origin = await exec("git", ["remote", "get-url", "origin"], { cwd, on });
  const o = origin.code === 0 ? parseRemote(origin.stdout) : null;
  if (!o) return;
  found.head = o.owner;
  const u = await upstreamRemote(cwd, on);
  found.baseRepo = `${(u ?? o).owner}/${(u ?? o).repo}`;
  let slug = u && !(u.owner === o.owner && u.repo === o.repo) ? u : null;
  // No `upstream` remote: ask GitHub whether origin is a fork.
  const parent = !slug && !on ? await forkParent(o, cwd) : null;
  if (parent) {
    slug = { host: o.host, owner: parent.owner, repo: parent.repo };
    // A fork with no `upstream` remote still files its PRs on the parent.
    found.baseRepo = `${parent.owner}/${parent.repo}`;
  }
  found.owner = avatarOwner(o, slug);
}

// A renamed fork keeps its own identity; a same-name fork shows the parent's.
function avatarOwner(origin, slug) {
  return avatarUrlFor(slug && slug.repo !== origin.repo ? origin : (slug ?? origin));
}

async function upstreamRemote(cwd, on) {
  const up = await exec("git", ["remote", "get-url", "upstream"], { cwd, on }).catch(() => null);
  return up?.code === 0 ? parseRemote(up.stdout) : null;
}

// What the repo's remotes say: the repo PRs are filed in (upstream when there is one), origin's
// owner (who the branch must belong to), and the owner's avatar. All null when git cannot say.
async function readRemoteIdentity(cwd, on) {
  const found = { baseRepo: null, head: null, owner: null };
  try { await fillRemoteIdentity(found, cwd, on); } catch { /* a remote git cannot read costs only the avatar and the review: keep what was learned */ }
  return found;
}

// Only the branch name is read. `# branch.ab` (ahead/behind) fed the removed gitTail,
// and Orca's card has no such element; the flag still prints the header we parse.
function branchOf(status) {
  let branch = null;
  for (const line of status.split("\n")) {
    if (line.startsWith("# branch.head ")) branch = line.slice(14);
  }
  return branch;
}

// Everything one place's git says: identity, remotes, branch and the repo's worktree list.
async function readGitInfo(status, cwd, on) {
  const { topDir, commonDir, name } = await readGitIdentity(cwd, on);
  const { baseRepo, head, owner } = await readRemoteIdentity(cwd, on);
  const info = { name, top: topDir, branch: branchOf(status), owner, base: baseRepo, head, repo: JSON.stringify([on, commonDir]), linked: commonDir !== `${topDir}/.git` };
  // Orca's rows are the repo's worktrees (`listRepoWorktrees`), not its open sessions. A
  // repo is one group whether the open space is the main checkout or a linked worktree —
  // `git worktree list` answers for both — so read it every time. Without this, a repo
  // opened only on linked worktrees could never show its main checkout or its siblings.
  const wt = await exec("git", ["worktree", "list", "--porcelain"], { cwd, on });
  if (wt.code !== 0) throw new Error("Couldn't list git worktrees");
  info.worktrees = parseWorktreeList(wt.stdout);
  return { info, commonDir };
}

// `readWorkspaceReviewFact` passes the cache's `state` through, while `ReviewIcon` switches on
// `merged`/`closed`/`draft` (review-state-presentation.ts:28-37). REST reports a merged PR as
// `state: "closed"` with a `merged_at` stamp, so `state` alone would paint every merged PR as
// closed and never reach `getStateTone`'s purple (`mapRestPullRequest`,
// pull-request-lookup-data.ts:115-153): Orca derives it. A draft is reported as `draft`.
function pullRequestState(pr) {
  if (pr.merged_at) return "merged";
  if (pr.draft) return "draft";
  return String(pr.state ?? "").toLowerCase();
}

// The review a branch shows, from the REST list: only PRs whose head owner is this repo's
// origin (`pullRequestMatchesHeadRepository`, pull-request-lookup-data.ts:187-193). When a fork
// repo is deleted on GitHub, `p.head.repo` is null, so fall back to `p.head.user` or `p.user`
// (pull-request-lookup-data.ts:147). The list is newest first, so prefer the live one
// (`preferOpenPullRequest`, pr-branch-lookup.ts:30-32).
function reviewFromPullRequests(list, head) {
  const mine = list.filter((p) => {
    const o = String(p.head?.repo?.owner?.login ?? p.head?.user?.login ?? p.user?.login ?? "").toLowerCase();
    return o === String(head).toLowerCase();
  });
  const first = mine.find((p) => String(p.state ?? "").toLowerCase() === "open") ?? mine[0];
  if (!first?.number) return null;
  const review = { number: first.number, title: first.title, state: pullRequestState(first) };
  // `html_url` is the page the badge opens; REST gives the base repo's own URL even for a fork.
  // Older cached entries have none, so the badge falls back to the base repo's pull page.
  if (first.html_url) review.url = first.html_url;
  return review;
}

// What a row says about its checkout: where, which branch, which host, and whether it is a linked worktree.
function gitFacts(w, g) {
  return {
    top: g?.top ?? w.folder ?? null,
    branch: g?.branch ?? w.branch ?? null,
    machine: w.machine ?? null,
    linked: g ? Boolean(g.linked) : null,
  };
}

// An agent working, or a program in front of the shell.
function isBusy(pane) {
  return pane.status === "working" || !(pane.program?.shell || pane.program?.agent);
}

// A new space in the project's folder on its host, then the terminals page.
function newSpaceIn(w, g) {
  run("space.new", { folder: g?.top ?? w.folder, machine: w.machine ?? "" });
  run("layout.select", { stack: "main", child: "main-terminals" });
}

// A review's glyph and tone by state; an unknown state draws the plain pull-request icon, muted.
// A null prototype so a state named `constructor` finds nothing.
const PR_ICONS = { __proto__: null, merged: "git-merge", closed: "git-pull-request-closed", draft: "git-pull-request-draft" };
const PR_TONES = { __proto__: null, merged: "#c084fcb3", open: "#10b981cc", draft: "#acacac80", closed: "#acacac99" };

export default class Spaces extends View {
  init(_props, cx) {
    stopsInit(this, cx, "entry");
    this.retainedRows = new Map();
    this.retainedPending = new Map();
    this.ownerCx = cx;
    this.agentRail = agentRailOwner();
    // pane.go onto this list (mod.json's "focusable"): the keyboard starts at the heading's button.
    cx.spawn(async (taskCx) => {
      for (;;) {
        const cmd = await nextCommand();
        // A popup over this mod hands focus back when it closes, so the header cluster can stop
        // being held visible for `has-[button[aria-expanded=true]]`
        // (`worktree-list/rows/ProjectHeaderActions.tsx:5-15`) — Herdr has no expanded attribute.
        if (cmd === "focus") {
          this.menuKey = null;
          // The "Spaces" heading that owned `space-new` was removed in aa54e29, so the id names
          // no control: pane.go landed on a dangling handle. The first drawn group header's New
          // space button is the nearest stop; `header()` emits it on every headed row and
          // `repo-header-project-actions.tsx:250` names the create button.
          const first = this.ordered().find((r) => r.head);
          if (first) enter(this, taskCx, `space-new-${first.w.id}`);
        }
        // `project-collapse-all.ts` setAllProjectsCollapsed: collapsing adds every project key;
        // expanding clears all project keys (nested ones included), keeping machine folds.
        // Keys are the same ones `header()` folds on: repo name, or `space:<id>` for a folder.
        else if (cmd === "collapse-all" || cmd === "expand-all") {
          if (cmd === "collapse-all") {
            for (const k of this.projectKeys(taskCx)) this.foldedRepos.add(k);
          } else {
            this.foldedRepos.clear();
          }
          localStorage.setItem("repos.folded", JSON.stringify([...this.foldedRepos]));
          this.notify(taskCx);
        }
        // The options menu writes "workspace.options.v1" and pings this loop; ordered() re-reads
        // the key on the next render. setShared alone does not wake another mod (AGENTS.md rule 10).
        else if (cmd === "options-changed") this.notify(taskCx);
        // Workspace options' Refresh (orca-sidebar-top): re-read git now, not on the 60s fallback or a
        // filesystem wake. Orca reads a repo's worktrees when a dialog asks; a person who just
        // checked out or added one here has no such trigger.
        else if (cmd === "refresh") this.refreshAll(taskCx);
        // The project menu's "Remove Project from Sidebar" (Orca's Remove Project): the
        // catalog and the rows drawn from it live in this mod, so orca-context-menu hands over the
        // repo through the shared store and pings this loop.
        else if (cmd === "forget-project") this.forgetProject(taskCx);
      }
    });
    // where() -> { name, branch, owner, repo, linked }, null: not a repo.
    // v2: v1 stored no `worktrees` for a space opened on a linked worktree, so the plan
    // could not name that repo's main checkout or its siblings. Retire those entries rather
    // than trust a shape the plan can no longer anchor a group on.
    // Seeded from the last session, the Herdr equivalent of the project list Orca hydrates
    // from its persisted store (`sidebar/index.tsx:69` reads `s.repos`;
    // `main/persistence/loading-store/store.ts:68` owns it). Herdr exposes no project catalog
    // (`defaults/herdr.d.ts`), so a repo no `exec` has ever probed is unreachable; this cache
    // is seeded whenever a space's git is read, and rows paint from it while refresh runs.
    this.git = { ...stored("git.cache.v2", {}) };
    // Orca keeps reviews out of the worktree row: `buildWorkspaceReviewFacts` reads a
    // persisted cache keyed `repo::branch` (`getGitHubPRCacheKeyCandidates`) and the card
    // draws whatever sits there. Nothing is fetched while rendering. Same shape here:
    // `prCache[key] = { data: { number, state } | null, at }`, keyed `<common-dir>::<branch>`.
    // Loaded from the shared review store (`review-store.js`), backed by `shared("pr.cache.v2")`
    // and `localStorage`.
    this.prCache = loadReviewCache();
    this.lastSharedPrCache = null;
    this.prAsking = new Set(); // keys with a hydrating `gh` in flight
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Map(); // repo -> native cancellable FolderWatch
    // Orca startupWorktreeRefreshCompleted (startup-worktree-refresh.ts:80).
    // When cached git state exists, rows paint immediately without a loading flash.
    this.loaded = Object.keys(this.git).length > 0;
    // Saved folders (`projects.saved.v1`) are probed once each: a path that is gone is
    // marked, never silently dropped (the row stays, with "missing").
    this.missingFolders = new Set();
    this.savedChecked = new Set();
    this.pressed = null;
    // The group whose menu overlay is open: its header cluster stays visible while the
    // pointer is over the overlay instead of the header.
    this.menuKey = null;
    this.over = null;
    // Orca reveals the sidebar thumb on `.scrollbar-sleek-parent:hover` (`main.css:781-800`);
    // the placed bar's own `hover` mode only sees the bar, so the list's pointer drives it.
    this.listHover = false;
    this.machines = [];
    this.reconnecting = Object.fromEntries(Object.entries(stored("machines.reconnecting", {})).map(([key, value]) => [key, value && typeof value === "object" ? { ...value } : value]));
    for (const state of Object.values(this.reconnecting)) if (state && typeof state === "object") state.busy = false;
    this.folded = new Set(stored("machines.folded", []));
    this.foldedRepos = new Set(stored("repos.folded", []));
    // `worktree-card-agents-expansion-state.ts:12-16`: a card's compact agent list starts
    // collapsed (`compactRootListExpanded: false`), so the stored set is the expanded ones.
    this.expandedAgents = new Set(stored("agents.expanded", []));

    // Herdr has no unread state: `Model::status` (model.rs:528-536) only ever returns
    // working | blocked | done | idle. Orca's card reads `worktree.isUnread` and writes it
    // through `setWorkspaceUnreadByUser` (`use-worktree-card-activation-actions.ts:200-206`);
    // no host field can hold that here, so the mod persists the toggled worktree ids.
    this.unread = new Set(stored("spaces.unread.v1", []));
    // The lane whose bell the pointer reveals; GPUI has no `group-hover`, so one id marks it.
    this.laneHot = null;
    this.refreshMachines(cx);
    cx.timer.every(15000, timerCx => this.refreshMachines(timerCx));
    cx.timer.every(15000, timerCx => { void this.checkSaved(timerCx); });
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (timerCx) => this.checkNew(timerCx));
  }

  notify(_cx) {
    this.refreshRetained();
    this.syncRetained(this.ownerCx);
    this.ownerCx.notify();
  }

  syncRetained(cx) {
    if (this.retainedSynced === this.retainedPending) return false;
    let operations = 0;
    let changed = false;
    for (const [key, held] of this.retainedRows) {
      if (!this.retainedPending.has(key)) {
        if (++operations > MAX_RETAINED_OPERATIONS) return changed;
        held.entity.release();
        this.retainedRows.delete(key);
        changed = true;
      }
    }
    for (const [key, data] of this.retainedPending) {
      const held = this.retainedRows.get(key);
      if (!held) {
        if (++operations > MAX_RETAINED_OPERATIONS) return changed;
        this.retainedRows.set(key, { signature: data.signature, entity: cx.new(WorkspaceRow, { owner: this, key }) });
        changed = true;
      } else if (held.signature !== data.signature) {
        if (++operations > MAX_RETAINED_OPERATIONS) return changed;
        held.entity.set_props({ owner: this, key });
        held.signature = data.signature;
        changed = true;
      }
    }
    this.retainedSynced = this.retainedPending;
    return changed;
  }

  rowElements({ r, t, ps, mine, groupBy }) {
    return groupBy === "repo" ? this.row(r, t, ps, mine) : [this.card(r, t, ps, mine)];
  }

  refreshRetained() {
    const focused = onStop(this);
    const keyboardMode = this.retainedKeyboardMode = Boolean(shared("t3-focus"));
    for (const data of this.retainedPending.values()) data.signature = this.rowSignature(data, focused, keyboardMode);
    this.retainedSynced = null;
  }

  rowSignature({ r, t, mine, groupBy, sortBy }, focused = onStop(this), keyboardMode = Boolean(shared("t3-focus"))) {
    const key = r.w.id;
    const fold = foldKey(r);
    // The plan already projects the sibling catalog into row/head/count changes.
    const git = { ...r.g };
    delete git.worktrees;
    return JSON.stringify([
      r.w, Boolean(r.g), git, r.also?.map(row => row.w), r.head, r.count, r.unopened, r.pos,
      t, mine, groupBy, sortBy, this.reviewOf(r.g), avatarFile(r.g?.owner),
      this.foldedRepos.has(fold), this.expandedAgents.has(key), this.unread.has(key),
      this.hot?.endsWith(key) ? this.hot : null, this.hoveredRepo === fold, this.menuKey === fold,
      this.laneHot === key, this.pressed === key, this.over === key,
      this.over === key ? [this.pressed, this.rowIndex?.get(this.pressed)] : null,
      keyboardMode, this.fs.keyboard, focused?.endsWith(key) ? focused : null,
    ]);
  }

  retainedRow(r, t, ps, mine, groupBy, sortBy) {
    const key = r.w.id;
    const data = { r, t, ps, mine, groupBy, sortBy };
    const keyboardMode = this.retainedKeyboardMode ?? Boolean(shared("t3-focus"));
    const signature = data.signature = this.rowSignature(data, this.retainedFocus, keyboardMode);
    this.retainedPending.set(key, data);
    const held = this.retainedRows.get(key);
    // New or changed host data paints immediately; a task adopts the retained view afterwards.
    // shortcut: keyboard mode draws directly to preserve focus-pool refill and full Tab order.
    return !keyboardMode && held?.signature === signature
      ? [held.entity]
      : this.rowElements(data);
  }

  close() {
    for (const { entity } of this.retainedRows.values()) entity.release();
    this.retainedRows.clear();
    this.closed = true;
    this.pending?.clear();
    for (const repo of this.watching?.keys() ?? []) this.stopWatch(repo);
  }

  // A saved folder can be moved or deleted between runs. Orca keeps a project whose
  // worktree list is gone until the person removes it, so the row says "missing" and
  // the remove control is the only way it disappears.
  async checkSaved(cx) {
    const saved = stored("projects.saved.v1", []);
    const unseen = saved.filter(folder => !this.savedChecked.has(folder));
    if (!unseen.length) return;
    let changed = false;
    for (const folder of unseen) {
      this.savedChecked.add(folder);
      const r = await exec("test", ["-d", folder]).catch(() => null);
      const missing = r ? r.code !== 0 : false;
      if (missing !== this.missingFolders.has(folder)) {
        if (missing) this.missingFolders.add(folder); else this.missingFolders.delete(folder);
        changed = true;
      }
    }
    if (changed) this.notify(cx);
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    else if (!this.loaded && !this.refreshing) {
      this.loaded = true;
      this.notify(cx);
    }
    // The row order git implies is committed here, in the task phase, not from `render`.
    this.settleRows(cx);
    // Agent state is read straight from the host model (`space.status`, `agent.status`), so a
    // running agent changes it without touching git and without a new space. Nothing notified
    // in that case, and the indicators sat on whatever the last render caught — the bug that
    // made a working agent look idle. Repaint when any space or agent status differs from the
    // last look: cheap, and only on a real change.
    // `agents()` reports `address`, not `id` (an agent has address/pane/space/tab/status);
    // keying on `a.id` made every entry `undefined:idle`, so a real change never differed.
    const now2 = { spaces: sp.map((s) => `${s.id}:${s.status}`).join(","), agents: agents().map((a) => `${a.address}:${a.status}`).join(",") };
    const changed = now2.spaces !== this.statusSeen?.spaces || now2.agents !== this.statusSeen?.agents;
    this.statusSeen = now2;
    // A git pass writes `this.git` one place at a time; painting mid-pass shows a half-filled
    // list, which is the sidebar's visible jitter. The pass notifies once when it commits, so
    // the status change can wait for it.
    if (changed && !this.refreshing) this.notify(cx);
    // Adopt new host snapshots discovered during render without mutating retained views there.
    if (this.syncRetained(cx)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => readPair(k)[1]));
    const due = new Set([...keys].filter((k) => this.needsFirstLook(k)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    this.addFinishedCommands(due, { sp, ps, at, keys });
    this.addReturningHosts(due, keys);
    if (window()?.active) this.addStaleFallbacks(due, keys, now);
    return due;
  }

  // Never read, or cached by a version that did not record the repo owner.
  needsFirstLook(key) {
    return !(key in this.git) || (this.git[key] !== null && this.git[key]?.owner === undefined);
  }

  // A pane whose command or agent turn just ended may have checked out, committed or edited.
  addFinishedCommands(due, { sp, ps, at, keys }) {
    const spaceOf = {};
    for (const s of sp) for (const tab of s.tabs ?? []) spaceOf[tab.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = isBusy(p);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
  }

  // A machine that was away and is ready again.
  addReturningHosts(due, keys) {
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (readPair(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
  }

  // Repos in view whose last look is older than the fallback interval, on a host that is not folded.
  addStaleFallbacks(due, keys, now) {
    for (const k of keys) {
      const asks = k in this.git || this.unsure.has(k);
      if (asks && !this.folded.has(readPair(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
    }
  }

  // `key` and the other places in its repo (a commit there moves their branch).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async taskCx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch { /* keep the last list: the next poll asks again */ }
      this.notify(taskCx);
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    // A stored entry can name no machine (older shape, hand edit): nothing to reconnect to.
    if (!machine) return;
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    this.notify(cx);
    cx.spawn(async taskCx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch { /* not JSON: the raw output below is the message */ }
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(taskCx);
      this.notify(taskCx);
    });
  }

  // Workspace options ▸ Refresh: every project the list knows, open or closed, is asked again.
  // Keys come from the open spaces plus the git cache, because a project's worktree list is
  // carried by any one of its places (`check` writes it to every entry of the same repo); a
  // repo whose only space was closed would otherwise keep its old branches forever.
  refreshAll(cx) {
    this.refreshingAll = true;
    this.refreshGit(new Set([...spaces().map((s) => where(s, panes())), ...Object.keys(this.git)]), cx);
    this.notify(cx);
  }

  // Runs git checks concurrently across hosts, matching startup-worktree-refresh.ts:51-68
  // Promise.allSettled. A serial queue caused rows to stall behind earlier repositories.
  refreshGit(keys, cx) {
    if (this.closed) return;
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (taskCx) => {
      while (this.pending.size) {
        const batch = [...this.pending];
        this.pending.clear();
        await Promise.all(batch.map((key) => this.check(key, taskCx)));
      }
      if (this.closed) return;
      pruneGitCache(this.git, spaces(), this.checked);
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => readPair(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching.keys()) if (!used.has(repo)) this.stopWatch(repo);
      this.refreshing = false;
      this.refreshingAll = false;
      this.loaded = true;
      // The refresh is the only writer, so one write per completed pass is enough.
      localStorage.setItem("git.cache.v2", JSON.stringify(this.git));
      this.notify(taskCx);
    });
  }

  // One place's git: branch, its repo, and the review on that branch.
  async check(key, cx) {
    const [on, cwd] = readPair(key);
    const cached = this.git[key];
    if (this.closed) return;
    const started = this.checked[key] = Date.now();
    // The refresh queue serializes checks for each key; forgetting it invalidates this result.
    const stillCurrent = () => !this.closed && this.checked[key] === started;
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Only branch headers are consumed; skip the untracked-file traversal.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch", "--untracked-files=no"], { cwd, on });
      if (!stillCurrent()) return;
      if (r.code !== 0) return await this.checkFailed(key, cached, on, stillCurrent, r.stderr);
      const { info, commonDir } = await readGitInfo(r.stdout, cwd, on);
      if (!stillCurrent()) return;
      for (const entry of Object.values(this.git)) {
        if (entry?.repo === info.repo) entry.worktrees = info.worktrees;
      }
      this.git[key] = info;
      // The review is NOT part of the worktree row. Orca's `buildWorkspaceReviewFacts` looks
      // each worktree's own branch up in a persisted PR cache; the row never carries a PR to
      // be inherited by other worktrees. Ask for this exact branch, and only on this machine.
      if (!on && info.branch) this.lookupPRByBranch(`${commonDir}::${info.branch}`, info, cwd, cx);
      if (!on) this.watch(commonDir, cx);
    } catch {
      await this.checkFailed(key, cached, on, stillCurrent);
    }
  }

  async checkFailed(key, cached, on, stillCurrent, stderr = "") {
    if (!stillCurrent()) return;
    await this.refreshCatalog(cached, on, stillCurrent);
    if (!stillCurrent()) return;
    // Only git's own "no" is remembered as no repo; anything else is asked again.
    if (/not a git repository/i.test(stderr)) this.git[key] = null;
    else { this.git[key] ??= null; this.unsure.add(key); }
  }

  // A project's worktree list is carried by every cached place of the repo; when a place cannot be
  // read, its repo's own git directory can still say which worktrees exist.
  async refreshCatalog(cached, on, stillCurrent = () => true) {
    if (!cached?.linked) return;
    try {
      const wt = await exec("git", ["--git-dir", readPair(cached.repo)[1], "worktree", "list", "--porcelain"], { on });
      if (wt.code === 0 && stillCurrent()) {
        const worktrees = parseWorktreeList(wt.stdout);
        for (const entry of Object.values(this.git)) if (entry?.repo === cached.repo) entry.worktrees = worktrees;
      }
    } catch { /* the catalog is a refresh of what the row already shows: keep it as it was */ }
  }

  stopWatch(repo) {
    const pending = this.watching.get(repo);
    this.watching.delete(repo);
    pending?.cancel?.();
  }

  watch(repo, cx) {
    if (this.closed || this.watching.has(repo)) return;
    const pending = watchFolder(repo);
    this.watching.set(repo, pending);
    cx.spawn(async (taskCx) => {
      let current = pending;
      try {
        for (;;) {
          await current;
          if (this.watching.get(repo) !== current) return;
          const mine = JSON.stringify([null, repo]);
          const keys = Object.keys(this.git).filter((k) => this.git[k]?.repo === mine);
          if (!keys.length) break;
          this.refreshGit(keys, taskCx);
          if (this.watching.get(repo) !== current) return;
          current = watchFolder(repo);
          this.watching.set(repo, current);
        }
      } catch { /* fallback refresh remains active */ }
      if (this.watching.get(repo) === current) this.stopWatch(repo);
    });
  }

  reviewCache() {
    const sh = shared("pr.cache.v2");
    if (sh && typeof sh === "object" && sh !== this.lastSharedPrCache) {
      this.lastSharedPrCache = sh;
      this.prCache = { ...sh };
    }
    return this.prCache;
  }

  // `readWorkspaceReviewPR` + `getGitHubPRCacheKeyCandidates`, in Herdr's terms: one key per
  // repo+branch, read at render, refreshed out of band. A cache entry of `null` means asked
  // and there is no PR — Orca's `{ data: null }` — so a miss and a known-empty differ.
  reviewOf(info) {
    if (!info?.branch || !info.repo) return null;
    const entry = this.reviewCache()[`${readPair(info.repo)[1]}::${info.branch}`];
    // `entry` is whatever storage holds (a hand edit, an older shape): read, never trust it.
    return entry?.data ?? null;
  }

  // The writer half of Orca's pipeline, named for what it does. `lookupPRByBranchName`
  // (pr-branch-lookup.ts) is Orca's refresh path; this is its `getRestPRForBranch` branch —
  // REST first, because REST honors `head=<owner>:<branch>` and `gh pr list --head
  // owner:branch` silently returns nothing.
  lookupPRByBranch(key, { base: baseRepo, head, branch }, cwd, cx) {
    const entry = this.reviewCache()[key];
    // Orca's TTL check (`hosted-review-branch-cache.ts:93-100` isFresh) prevents hammering GitHub
    // while allowing expired entries (1 min for found review, 15 min for negative cache) to refresh.
    if (this.prAsking.has(key) || isReviewFresh(entry)) return;
    if (this.prAsking.size >= MAX_INFLIGHT_PR_LOOKUPS) return;
    // No remote or no branch, no question: `head` is who the branch must belong to.
    if (!baseRepo || !head || !branch) { this.setPr(key, null); return; }
    this.prAsking.add(key);
    cx.spawn(async (taskCx) => {
      try {
        // Orca's exact query (`getRestPRForBranch`, pr-branch-lookup.ts:41-48): the base repo,
        // a head filter qualified with the owner, `state=all`, and a page of ten.
        const [owner, repo] = baseRepo.split("/");
        const q = `repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${head}:${branch}`)}`
          + `&state=all&per_page=${BRANCH_PR_LOOKUP_PAGE_SIZE}`;
        const r = await exec("gh", ["api", q], { cwd });
        const list = r.code === 0 ? JSON.parse(r.stdout || "[]") : [];
        this.setPr(key, reviewFromPullRequests(list, head));
      } catch {
        this.setPr(key, null);
      } finally {
        this.prAsking.delete(key);
        this.notify(taskCx);
      }
    });
  }

  setPr(key, data) {
    this.reviewCache()[key] = { data, at: Date.now() };
    saveReviewCache(this.prCache);
  }

  menu(w, g) {
    // A popup is as tall as its items; height is only the most.
    const s = spaces().find((x) => x.id === w.id);
    const path = s ? place(s, panes()) : (g?.top ?? w.folder ?? null);
    // WorktreeContextMenuView.tsx:147 — `min-w-52` (208).
    openOverlay({ mod: "orca-context-menu", kind: "popup", width: 208, height: 320, props: { tab: "space", target: this.menuTarget(w, g, path) } });
  }

  // `WorktreeContextMenu` wraps the worktree, not a tab (`worktree-card-surface.tsx:139-146`),
  // and reads `tabsByWorktree` only while it is open
  // (`use-worktree-context-menu-model.tsx:101-102`); its worktree rows need no open space.
  // So a row that has no space still hands over the worktree's own facts.
  menuTarget(w, g, path) {
    return {
      id: w.id,
      path,
      ...gitFacts(w, g),
      folder: w.folder ?? g?.top ?? path,
      unread: this.unread.has(w.id),
      named: Boolean(w.named),
      name: w.name ?? null,
      // The catalog entry this row was drawn from: a project with no open space is only a
      // cache entry, and the menu's "Remove Project from Sidebar" needs the repo to name it.
      repo: g?.repo ?? null,
    };
  }

  // Orca's rows are worktrees, keyed by host+path (host-qualified-identity.ts), not by open
  // session: two tabs on one checkout are one card. Merge Herdr spaces on the same worktree
  // before emitting, so the card and its agents span them.
  // Rows are a pure derivation of host state, like Orca's `planSidebarRows` under `useMemo`
  // (`use-section-rows.ts:15,147`). Domain projection is delegated to `projectWorktreePlan`
  // (`worktree-plan.js`). Nothing here may mutate this view or dispatch a command:
  // it runs inside `render`, and a reorder fired from render both loses commands and re-enters
  // the frame. Reordering is the drag handler's job (`use-document-drop.ts:72` fires
  // `onReorderWorktrees`); nothing here moves a space.
  ordered() {
    const plan = projectWorktreePlan({
      spaces: spaces(),
      panes: panes(),
      gitState: this.git,
      foldedRepos: this.foldedRepos,
      loaded: this.loaded,
      whereFn: where,
      options: workspaceOptions(),
    });
    this.plan = plan;
    this.rowIndex = plan.rowIndex;
    return plan.visibleRows;
  }

  // Everything that must happen in the task phase, once per tick: ask for the reviews of rows
  // that have no open space, then reconcile the host's order with the plan.
  //
  // Orca has no equivalent of the second half, and neither should we: its row order is a pure
  // partition of the plan's items (`orderMainWorktreeFirst` = `[...main, ...rest]`,
  // `section-order.ts:4-16`), recomputed every render. Only a drag commits an order
  // (`use-document-drop.ts:72`).
  //
  // We used to dispatch one `space.move` per out-of-place row from here. Every dispatcher echo
  // re-entered the frame, each move renumbered the rows still to be moved, and the list visibly
  // built itself outward from the middle. Sorting in the plan removes the cascade entirely.
  settleRows(cx) {
    const out = this.ordered();
    const keys = activeReviewKeys(out);
    const signature = JSON.stringify(keys);
    if (signature !== this.activeReviewSignature) {
      this.activeReviewSignature = signature;
      setShared("pr.active.v1", keys);
    }
    // Rows with no open space still need their review: nothing else probes those branches. Ask
    // here, in the task phase, keyed exactly like `reviewOf` looks it up. Local machine only —
    // `gh` on the far side of an ssh may not be authenticated. This used to live in the row
    // builder, which made a network lookup a side effect of rendering.
    // Orca refresh pacing (`hosted-review-refresh-pacing.ts:4-28`): pace lookups with max
    // MAX_INFLIGHT_PR_LOOKUPS in-flight and respect TTL (`hosted-review-branch-cache.ts:93-100`).
    for (const r of out) {
      if (this.prAsking.size >= MAX_INFLIGHT_PR_LOOKUPS) break;
      if (r.w.machine || !r.g?.branch) continue;
      const key = `${readPair(r.g.repo)[1]}::${r.g.branch}`;
      if (this.prAsking.has(key)) continue;
      const entry = this.reviewCache()[key];
      if (isReviewFresh(entry)) continue;
      this.lookupPRByBranch(key, r.g, r.g.top, cx);
    }
  }

  // `worktree-card-agents-expansion-state.ts`: each card's disclosure is its own state,
  // remembered across remounts. Here it survives restarts, in localStorage.
  toggleAgents(id, cx) {
    this.expandedAgents.has(id) ? this.expandedAgents.delete(id) : this.expandedAgents.add(id);
    localStorage.setItem("agents.expanded", JSON.stringify([...this.expandedAgents]));
    this.notify(cx);
  }

  // `WorktreeCardStatusSlot.tsx:230-252`'s click flips the worktree's read/unread. Mod-owned
  // because Herdr's model has no unread state; writes both localStorage and shared store
  // so orca-context-menu and orca-sidebar-projects stay synchronized (AGENTS.md rule 10).
  toggleUnread(id, cx) {
    this.unread.has(id) ? this.unread.delete(id) : this.unread.add(id);
    const updated = [...this.unread];
    localStorage.setItem("spaces.unread.v1", JSON.stringify(updated));
    setShared("spaces.unread.v1", updated);
    this.notify(cx);
  }

  toggleRepo(repo, cx) {
    this.foldedRepos.has(repo) ? this.foldedRepos.delete(repo) : this.foldedRepos.add(repo);
    localStorage.setItem("repos.folded", JSON.stringify([...this.foldedRepos]));
    // `cx` is absent for a keyboard Enter from `stop` (`focus.js`), which has no render cx.
    this.notify(cx);
  }

  // Orca's Remove Project (`repo-header-project-actions.tsx:204`): the project leaves the
  // sidebar, nothing on disk is touched. Herdr has no project catalog, so the sidebar's list
  // IS this cache — every repo ever read stays listed with its main checkout and worktrees
  // once its spaces close, and nothing else drops a non-null entry. A key a live space still
  // sits on is kept, so the group those spaces draw from never loses its row.
  forgetProject(cx) {
    const ask = shared("orca-sidebar-projects.forget");
    setShared("orca-sidebar-projects.forget", null);
    const repo = ask?.repo;
    if (!repo) return;
    const live = spaces().map((s) => where(s));
    const candidates = Object.keys(this.git).filter(key => this.git[key]?.repo === repo);
    if (!forgetProjectCache(this.git, repo, live)) return;
    const [on, commonDir] = readPair(repo);
    if (!on && !Object.values(this.git).some(entry => entry?.repo === repo)) this.stopWatch(commonDir);
    for (const key of candidates) if (!(key in this.git)) {
      delete this.checked[key];
      this.pending.delete(key);
      this.unsure.delete(key);
    }
    localStorage.setItem("git.cache.v2", JSON.stringify(this.git));
    this.notify(cx);
  }

  // The rows, under a header per machine once one isn't this computer.
  // A button's icon and text brighten together: a hover style reaches the text but not the svg, so it's state, as in the inbox.
  glow(id) {
    return (on, cx) => {
      if (on) this.hot = id;
      else if (this.hot === id) this.hot = null;
      this.notify(cx);
    };
  }

  grouped(t, cx, rows = this.ordered()) {
    const ps = panes();
    const rowAgents = agentsByRow(rows, agents());
    // `SectionHeader.tsx:190-192`: a header draws its collapse chevron only when its group
    // has rows (`row.count > 0`). Count per group from projected plan.
    const counts = new Map((this.plan?.groups ?? []).map((g) => [g.key, g.rows.length]));
    // Group by None draws cards only; Status adds its own section heads; only Project (repo)
    // draws the project header row (`group-sections.ts:119-130`; WORKSPACE_GROUP_BY_CHOICES).
    const groupBy = workspaceOptions().groupBy;
    const sortBy = workspaceOptions().sortBy;
    const draw = (r, i) => {
      const pos = this.rowIndex?.get(r.w.id) ?? i;
      return this.retainedRow({ ...r, count: counts.get(foldKey(r)) ?? 0, pos }, t, ps, rowAgents.get(r), groupBy, sortBy);
    };
    // The descriptors reference row positions, so equal signatures can reuse them with fresh row data.
    const repairing = new Set([...Object.keys(this.reconnecting), ...this.machines.filter(m => this.rebuilt(m)).map(m => m.name)]);
    const hidden = new Set([...repairing].filter(m => {
      const repair = this.reconnecting[m];
      return this.rebuilt(this.machines.find(k => k.name === m) ?? repair?.machine) || !!repair;
    }));
    const signature = JSON.stringify([groupBy, rows.map(r => [r.w.machine ?? null, r.w.status]), [...repairing], [...this.folded], [...hidden]]);
    if (signature !== this.renderPlanSignature) {
      this.renderPlanSignature = signature;
      this.renderPlan = planRenderRows(rows, groupBy, repairing, this.folded, hidden);
    }
    return this.renderPlan.flatMap((item) => {
      if (item.kind === "row") return draw(rows[item.index], item.position);
      if (item.kind === "status") return [this.statusHead(item.label, item.count, t)];
      return [this.machineHead(item, t)];
    });
  }

  // What is known of a host: its reconnect attempt, its machine record, and whether it is up or was rebuilt.
  machineStatus(m) {
    const repair = this.reconnecting[m];
    const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
    return { repair, machine, connected: !m || machine?.state === "connected", rebuilt: this.rebuilt(machine) || !!repair };
  }

  machineHead(item, t) {
    const m = item.machine;
    const count = item.count;
    const slug = m ?? "local";
    const { repair, machine, connected, rebuilt } = this.machineStatus(m);
    const folded = this.folded.has(m);
    const stateWords = (machine?.state ?? "asleep").replace(/_/g, " ");
    // Drawn as the agents list's group headers, each 8px below what's above it, the heading included: right under it,
    // its + and chevron crowded the heading's buttons, a column of icons unevenly spaced.
    // Its + and chevron stand under the heading's two buttons, in slots built as those are (26px, 2px apart, 10px from the edge), so any zoom rounds them alike.
    const head = h_flex().id(`machine-${slug}`).pt(8).h(30).flex_none().pl(8).pr(2).gap(4).items_center()
      // `ProjectHeaderHostLabel.tsx:25`: `text-muted-foreground` (full #acacac, not `t.dim`).
      .text_size(12).font_medium().text_color(t.muted)
      .role("button").accessibility_label(`${folded ? "Expand" : "Collapse"} ${m ?? "This computer"}`)
      .on_hover((on, cx) => {
        // By the row's id: this computer's m is null, which a cleared field would equal.
        if (on) this.overMachine = `machine-${slug}`;
        else if (this.overMachine === `machine-${slug}`) this.overMachine = null;
        this.notify(cx);
      })
      .on_click((_e, cx) => {
        folded ? this.folded.delete(m) : this.folded.add(m);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        this.notify(cx);
      })
      // -1: the glyph's own inset, so its edge meets the heading and the spaces' marks.
      .child(svg(sharedAsset(`mods/orca-sidebar-projects/${m ? "server" : "monitor"}.svg`)).size(14).ml(-1).flex_none())
      // The dot describes the machine, so it follows its name, however short.
      .child(h_flex().flex_1().min_w(0).gap(6).items_center()
        .child(div().min_w(0).truncate().child(m ?? "This computer"))
        .child(tipMark(this, t, { id: `machine-state-${slug}`, label: connected ? "Connected" : stateWords.replace(/^./, c => c.toUpperCase()), mark: div().size(6).rounded_full().flex_none().bg(connected ? t.ansi2 : t.dim) })))
      // `HostSectionHeader.tsx:11-35,119`: the count badge is always drawn beside the label
      // (its `count` is the host's workspace rows, folded groups included).
      .child(div().flex_none().h(16).px(6).flex().items_center().justify_center().rounded_full().border_1().border_color(t.border).bg(t.hover).text_size(9).line_height("9px").text_color(t.muted).child(String(count)))
      .when(!connected && !rebuilt, el => el.child(div().flex_none().child(stateWords)))
      .when(rebuilt, el => el.child(this.machineConnect(m, machine, repair, t)))
      .child(h_flex().flex_none().gap(2).items_center()
        .when(connected, el => el.child(this.machineAdd(m, t)))
        // An indicator, not a button: the whole row folds, so it lights with the row and has no label of its own.
        // `HostSectionHeader.tsx:121-125`: the chevron is `can-hover:opacity-0` until the
        // header is hovered (`group-hover/host-header:opacity-100`), keeping its slot; and
        // `SectionHeader.tsx:190-192` draws a collapse affordance only when there is something
        // to collapse (`row.count > 0`).
        .when(count > 0, el => el.child(div().id(`machine-fold-${slug}`).w(26).flex_none().flex().items_center().justify_center()
          .opacity(this.overMachine === `machine-${slug}` ? 1 : 0)
          .child(svg(sharedAsset(`mods/orca-sidebar-projects/chevron-${folded ? "right" : "down"}.svg`)).size(12).flex_none()))));
    // `host-section-rows.ts:236-246`: a host header exists only for a host with rows, and a
    // host with no rows draws no section — and no placeholder beneath it.
    return stop(this, t, `machine-${slug}`, head, { radius: 8 });
  }

  // The "Connect" control of a host that was rebuilt or is being reconnected.
  machineConnect(m, machine, repair, t) {
    const id = `machine-connect-${m}`;
    return h_flex().flex_none().gap(3).items_center()
      .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
      .child(tip({ hot: this.hot, t, id, label: `Connect ${m}`, trigger: stop(this, t, id, div().id(id).text_color(repair?.error ? t.blocked : t.muted)
        .hover(s => s.text_color(t.foreground)).on_hover(this.glow(id))
        .role("button").accessibility_label(`Connect ${m}`)
        .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
        .child(repair?.busy ? "Connecting…" : "Connect"), { radius: 4 }) }));
  }

  // The + that makes a space on this host.
  machineAdd(m, t) {
    const id = `machine-add-${m ?? "local"}`;
    return tip({ hot: this.hot, t, id, label: "New space here", trigger: stop(this, t, id, div().id(id).w(26).h(20).flex_none().flex().items_center().justify_center().rounded(4)
      .text_color(this.hot === id ? t.foreground : t.dim).on_hover(this.glow(id))
      .role("button").accessibility_label("New space here")
      .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); run("layout.select", { stack: "main", child: "main-terminals" }); }).child(svg("mods/orca-assets/plus--orca-float-workspace.svg").size(12)), { radius: 4 }),
      // The key makes a space on the current space's machine: it names this + only on that one.
      action: (spaces().find(s => s.active)?.machine ?? null) === m ? "space.new" : null });
  }

  statusHead(label, count, t) {
    // SectionHeader.tsx project-header geometry: 28px row, 8px left inset, 12px semibold muted.
    return h_flex().h(28).pl(8).pr(2).gap(6).items_center().text_size(12).font_semibold().text_color(t.muted)
      .child(div().child(label))
      .child(div().h(16).px(6).flex().items_center().justify_center().rounded_full().border_1().border_color(t.border).bg(t.hover).text_size(9).line_height("9px").child(String(count)));
  }

  // `ReviewIcon` (worktree-review-presentation.tsx:74-94): the glyph is state-specific —
  // merged GitMerge, closed GitPullRequestClosed, draft GitPullRequestDraft, else the plain
  // PullRequestIcon — and the tone is `getStateTone` (:54-70): merged purple-400/70, open
  // emerald-500/80, closed muted-foreground/60, draft muted-foreground/50. `size-3` is the
  // MetaIconBadge glyph size.
  prBadge(pr, t, id, info) {
    const icon = PR_ICONS[pr.state] ?? "git-pull-request";
    // `getStateTone` (worktree-review-presentation.tsx:58-72), dark-mode values:
    //   merged  text-purple-400/70           -> #c084fcb3
    //   open    text-emerald-500/80          -> #10b981cc
    //   closed  text-muted-foreground/60     -> #acacac99
    //   draft   text-muted-foreground/50     -> #acacac80
    //   (none)  text-muted-foreground opacity-70 -> #acacacb3
    // `text-muted-foreground` is `--orca-security-muted-foreground` = #acacac in dark
    // (main.css:328 -> :519), so every muted tone below is that hex at an alpha.
    const tone = PR_TONES[pr.state] ?? "#acacacb3";
    // `MetaIconBadge` (WorktreeCardMetadataControls.tsx:33) is `inline-flex size-3.5
    // shrink-0 items-center justify-center text-muted-foreground/70 [&>svg]:size-3.5` — a 14px
    // box whose glyph is also 14px, 12 was too small. `text-muted-foreground/70` is its default
    // colour; `getStateTone` overrides it per state.
    return div().flex_none().flex().items_center().justify_center().pr(6)
      .child(tip({
        hot: this.hot, t, id: `pr-${id}`, label: `Open PR #${pr.number}`,
        trigger: stop(this, t, `pr-${id}`, div().id(`pr-${id}`).size(20).flex_none().flex().items_center().justify_center().rounded(6)
          .cursor_pointer().hover(s => s.bg("#404040b3"))
          // The badge is an action, not decoration: it opens the pull request's own page.
          // The card under it switches spaces, so the click must not reach that handler.
          .on_click((_e, cx) => { cx.stop_propagation(); this.openPR(pr, info); })
          .child(svg(sharedAsset(`mods/orca-sidebar-projects/${icon}.svg`)).size(14).flex_none().text_color(tone)),
          { enter: () => this.openPR(pr, info) }),
      }));
  }

  // REST's `html_url` is canonical; an entry cached before that field, or a hand edit, falls
  // back to the base repo's pull page, which is the same address on GitHub.
  prURL(pr, info) {
    if (pr?.url) return pr.url;
    return pr?.number && info?.base ? `https://github.com/${info.base}/pull/${pr.number}` : null;
  }

  openPR(pr, info) {
    const url = this.prURL(pr, info);
    if (!url) return;
    const opener = window()?.platform === "macos" ? "open" : "xdg-open";
    exec(opener, [url]).catch((error) =>
      notify({ title: `Failed to open PR #${pr.number}`, body: String(error?.message ?? error), level: "error" })
    );
  }

  // `gitTail` used to draw `↑N`/`↓N` at the end of the title row. That was ours, not
  // Orca's: `default-workspace-card.json` has no ahead/behind var (its 32 vars are
  // classic/compact/folder/branch/conflict/details/ports/indicators and friends), and a
  // search for `ahead` across `components/sidebar/` returns only unrelated prose. Orca's
  // only right-side element on a classic card is the review badge in the meta row.

  // Every project key currently rendered, for `setAllProjectsCollapsed`. Orca collects them
  // from the row plan (`getRenderedProjectCollapseKeys`, project-collapse-all.ts:7-13).
  projectKeys(_cx) {
    return this.plan?.projectKeys ?? [];
  }

  // The group menu, for the right-click, the ellipsis button and the keyboard alike.
  openGroupMenu(w, g, groupSpaces) {
    openOverlay({ mod: "orca-context-menu", kind: "popup", width: 176, height: 248, props: { tab: "group", target: { id: w.id, path: g?.top ?? w.folder, machine: w.machine ?? null, spaces: groupSpaces, repo: g?.repo ?? null } } });
  }

  // Orca's project header (SectionHeader.tsx): h-7, gap-1.5, pr-2, a 16px icon slot, a 13px
  // semibold label, and a 20px collapse button. The header owns the fold; its cards hide under it.
  header({ w, g, count }, t, ps) {
    const key = foldKey({ w, g });
    const folded = this.foldedRepos.has(key);
    const id = `space-head-${w.id}`;
    // One list serves both the right-click and the ellipsis menu; the menu turns it into a project
    // "Delete all tabs" (it covers linked worktrees, which a folder-prefix match would miss).
    const groupSpaces = groupSpaceIds((this.plan?.groups ?? []).find((x) => x.key === key), spaces().map((s) => s.id));
    return stop(this, t, id, h_flex()
      .id(id)
      .h(28).flex_none().w_full().pl(getProjectGroupHeaderPaddingLeft(0)).pr(8).gap(6).items_center().mt(4)
      .role("button").accessibility_label(g?.name ?? w.name)
      // SectionHeader.tsx:355-414 & repo-header-project-actions.tsx:113: right click opens group actions menu
      .on_mouse_down("right", () => this.openGroupMenu(w, g, groupSpaces))
      .on_click((_e, cx) => this.toggleRepo(key, cx))
      .on_hover((on, cx) => {
        if (on) this.hoveredRepo = key;
        else if (this.hoveredRepo === key) this.hoveredRepo = null;
        this.notify(cx);
      })
      // Orca's RepoIconGlyph uses the repo's own image or Folder (`SectionHeader.tsx:327-342`,
      // `repo-icon.tsx:145-186`).
      .child(repoMark(16, g?.owner ?? null))
      .child(div().min_w(0).flex_1().truncate().text_size(13).font_semibold().line_height("16px").text_color(t.foreground).child(g?.name ?? w.name))
      .child(this.headerActions(w, g, { id, key, folded, count, groupSpaces }, t)),
      { radius: 6, enter: () => this.toggleRepo(key) });
  }

  // Orca's hover cluster (`worktree-list/rows/ProjectHeaderActions.tsx:5-15`, used at
  // `rows/SectionHeader.tsx:355-399`): an ABSOLUTE overlay — `can-hover:absolute right-1
  // top-1/2 -translate-y-1/2`, `bg-worktree-sidebar pl-1` — that only fades
  // (`can-hover:opacity-0`). It stays mounted for `has-[:focus-visible]` and
  // `has-[button[aria-expanded=true]]`, so here it is always mounted and faded by opacity:
  // the buttons join the Tab order (`stop` per control), the title is never re-truncated,
  // and the sidebar-coloured bg masks the title behind it. The row is 28px and the slots
  // 20px, so top-4 is `top-1/2 -translate-y-1/2` for this row.
  headerActions(w, g, { id, key, folded, count, groupSpaces }, t) {
    return h_flex().absolute().right(4).top(4).flex_none().items_center().gap(2).rounded(6).bg(t.surface).pl(4)
      .opacity(this.hoveredRepo === key || this.menuKey === key ||
        within(this, [id, `space-fold-${w.id}`, `space-more-${w.id}`, `space-new-${w.id}`]) ? 1 : 0)
      // ORDER, from SectionHeader.tsx:355-414 — the collapse chevron comes FIRST in
      // `ProjectHeaderActions`, then `RepoHeaderProjectActionsMenu` (the ellipsis, size-3.5,
      // repo-header-project-actions.tsx:113), then `RepoHeaderCreateWorkspaceButton`
      // (the plus, size-3, :250). Left to right: chevron, ellipsis, plus.
      // `SectionHeader.tsx:190-192`: the chevron is omitted entirely when the group has no
      // rows (`row.count > 0`); the menus/plus are not gated on it.
      // SectionHeader.tsx:358: size-5 rounded-md text-muted-foreground,
      // hover:bg-accent/70 and hover:text-foreground — a 70% accent wash, not a 70% white one.
      .when(count > 0, el => el.child(stop(this, t, `space-fold-${w.id}`,
        div().size(20).flex_none().flex().items_center().justify_center().rounded(6)
          .role("button").accessibility_label(folded ? "Expand group" : "Collapse group")
          .text_color(t.muted).hover((s) => s.bg("#404040b3").text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.toggleRepo(key, cx); })
          .child(svg(sharedAsset(`mods/orca-sidebar-projects/chevron-${folded ? "right" : "down"}.svg`)).size(14).flex_none()),
        { radius: 6, enter: () => this.toggleRepo(key, null) })))
      .child(stop(this, t, `space-more-${w.id}`,
        div().size(20).flex_none().flex().items_center().justify_center().rounded(6)
          .role("button").accessibility_label("Group menu")
          .text_color(t.muted).hover((s) => s.bg("#404040b3").text_color(t.foreground))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.menuKey = key;
            // RepoHeaderProjectActionsMenu's DropdownMenuContent has no width class, so Orca's
            // dropdown-menu.tsx:80 `min-w-[11rem]` (176) applies.
            this.openGroupMenu(w, g, groupSpaces);
            this.notify(cx);
          })
          .child(svg("mods/orca-assets/ellipsis--orca-pane-header.svg").size(14).flex_none()),
        { radius: 6, enter: () => { this.menuKey = key; this.openGroupMenu(w, g, groupSpaces); } }))
      .child(stop(this, t, `space-new-${w.id}`,
        div().size(20).flex_none().flex().items_center().justify_center().rounded(6)
          .role("button").accessibility_label("New space")
          .text_color(t.muted).hover((s) => s.bg("#404040b3").text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); newSpaceIn(w, g); })
          .child(svg("mods/orca-assets/plus--orca-float-workspace.svg").size(12).flex_none()),
        { radius: 6, enter: () => { newSpaceIn(w, g); } }));
  }

  // Orca's worktree card (worktree-card-surface.tsx): ml-1, py-2 (36px single line), rounded-lg,
  // a status lane, a 13px/20px title, the primary pill on the main checkout.
  card(row, t, ps, mine) {
    return cardView(this, row, t, ps, mine);
  }

  row(r, t, ps, mine) {
    const key = foldKey(r);
    const folded = this.foldedRepos.has(key);
    if (folded) return r.head ? [this.header(r, t, ps)] : [];
    return r.head ? [this.header(r, t, ps), this.card(r, t, ps, mine)] : [this.card(r, t, ps, mine)];
  }

  // Publishes what orca-sidebar-top's collapse-all button needs.
  publishProjectState(cx) {
    // ProjectsCollapseAllButton's `allCollapsed` prop: Orca computes it from the same set the
    // header folds on (`useAppStore` allCollapsed), so publish the identical predicate here and
    // let orca-sidebar-top pick the glyph and the toggle direction. `setShared` does not notify
    // (AGENTS.md rule 10), which is fine: orca-sidebar-top re-reads it when orca-sidebar-projects re-renders.
    const keys = this.projectKeys(cx);
    const allCollapsed = keys.length > 0 && keys.every((k) => this.foldedRepos.has(k));
    if (allCollapsed !== Boolean(shared("projects.allCollapsed"))) setShared("projects.allCollapsed", allCollapsed);
    // `WorktreeList.tsx:290` mounts the collapse-all button only when
    // `projectsCollapseTarget && projectCollapseKeys.length > 0` — with no projects there is
    // nothing to collapse, so Orca renders no button at all. Publish the count so orca-sidebar-top can
    // make the same call; the header cannot see the row plan itself.
    if (keys.length !== shared("projects.count")) setShared("projects.count", keys.length);
  }

  // A saved project no open space covers: folder glyph and basename, a "missing" mark when the
  // folder is gone, and a remove button.
  savedProjectRow(folder, t) {
    const basename = folder.split("/").pop() || folder;
    const missing = this.missingFolders.has(folder);
    // Orca project row geometry (SectionHeader.tsx:355-399; folder-row.tsx): 24px row,
    // folder glyph + 13px name, muted hover. This is the saved-project entry.
    return div()
      .id(`saved-${folder}`)
      .h(24)
      .w_full()
      .flex()
      .items_center()
      .gap(6)
      .px(8)
      .rounded(4)
      .text_color(missing ? t.dim : t.muted)
      .hover(s => s.bg(t.hover).text_color(missing ? t.dim : t.foreground))
      .cursor_pointer()
      .role("button")
      .accessibility_label(missing ? `Saved project ${basename} (folder missing)` : `Open saved project ${basename}`)
      .on_click((_e, clickCx) => {
        clickCx.spawn(async () => {
          run("space.new", { folder }); run("layout.select", { stack: "main", child: "main-terminals" });
        });
      })
      .child(svg("mods/orca-assets/folder--orca-sidebar-projects.svg").size(14).flex_none())
      .child(div().flex_1().truncate().text_size(13).child(basename))
      .when(missing, el => el.child(div().flex_none().text_size(11).text_color(t.dim).child("missing")))
      .child(div()
        .id(`saved-remove-${folder}`)
        .size(20)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(4)
        .text_color(t.dim)
        .hover(s => s.bg("#404040b3").text_color(t.foreground))
        .cursor_pointer()
        .role("button")
        .accessibility_label(`Remove saved project ${basename}`)
        .on_click((_e, clickCx) => {
          clickCx.stop_propagation();
          const existing = stored("projects.saved.v1", []);
          const filtered = existing.filter(f => f !== folder);
          localStorage.setItem("projects.saved.v1", JSON.stringify(filtered));
          this.notify(clickCx);
        })
        .child(svg("mods/orca-assets/trash.svg").size(10)));
  }

  // While the agent settings page is open the left sidebar carries the agent rail instead of projects.
  // The rail is never framed: the narrowed sidebar is its real width, not a fade in progress.
  render(cx) { return agentSettingsOpen() ? this.agentRailBody() : sidebarFrame(this.renderBody(cx)); }

  agentRailBody() {
    const t = theme();
    return v_flex().size_full().min_h(0).bg(t.surface).text_size(13).child(leftSidebarAgentRail(this, t));
  }

  renderBody(cx) {
    const t = theme();
    const sp = spaces();
    // Unread workspace state (`spaces.unread.v1`): orca-context-menu writes shared store on toggle;
    // sync this instance's set so the unread bell state updates visually on re-render
    // (WorktreeCardStatusSlot.tsx:220-252, AGENTS.md rule 10).
    const shUnread = shared("spaces.unread.v1");
    if (Array.isArray(shUnread)) {
      this.unread = new Set(shUnread);
    }
    // `WorktreeList.tsx:285-287`: the empty state is the row plan's emptiness, not the raw
    // collection's — an unopened worktree or a group with no rows still counts as a row.
    const rows = this.ordered();
    this.retainedPending = new Map();
    this.retainedFocus = onStop(this);
    this.retainedKeyboardMode = Boolean(shared("t3-focus"));
    // The shipped mods (the Terminals picker) still color spaces from "space.colors": the same color, from the name.
    const colors = Object.fromEntries(sp.filter(p => p.name !== "~").map(p => [p.id, tint(p.name, false)]));
    if (JSON.stringify(colors) !== JSON.stringify(shared("space.colors") ?? {})) setShared("space.colors", colors);
    this.publishProjectState(cx);
    // One fetch per repo per session; `ensureAvatar` writes the file and notifies once, so the
    // next render draws the avatar instead of the Folder.
    for (const g of Object.values(this.git)) if (g?.owner) ensureAvatar(g.owner, cx);
    // Fold saved-project rows: folders persisted in localStorage["projects.saved.v1"]
    // that no open space's folder covers. The folder glyph + basename row opens a space
    // in that folder; hover reveals a remove button (Orca's RepositoryRemoveProjectButton).
    // Missing folders are marked but never deleted silently.
    const saved = stored("projects.saved.v1", []);
    const savedRows = saved
      .filter(folder => !sp.some(s => typeof s.folder === "string" && (s.folder === folder || s.folder.startsWith(folder + "/"))))
      .map(folder => this.savedProjectRow(folder, t));

    return focusRoot(this, v_flex().size_full().min_h(0).bg(t.surface).text_size(13)
      // Orca's sidebar bar is an 8px webkit scrollbar with `padding-right: 4px`
      // (`main.css:767-781`), transparent until the sidebar is hovered (`:781-800`). A webkit
      // bar takes layout width, so no row sits under it. Herdr's placed bar fills the box it is
      // put in (`gpui-kit.d.ts:21188-21218`) and the shipped `changes` mod paints one over the
      // scroll area (`defaults/mods/changes/main.js:196`); the same shape here, with the 12px
      // inset on the content, keeps rows clear of the thumb.
      .child(div().w_full().flex_1().min_h(0).relative()
        .child(v_flex().id("space-list").absolute().inset_0().overflow_y_scroll()
          .on_mouse_up("left", (_e, upCx) => { this.pressed = this.over = null; this.notify(upCx); })
          // Herdr reports no release outside the sidebar, so leaving ends a drag, as in the inbox.
          .on_hover((on, hoverCx) => {
            if (this.listHover !== on) { this.listHover = on; this.notify(hoverCx); }
            if (on || this.pressed === null) return;
            this.pressed = this.over = null;
            this.notify(hoverCx);
          })
          .child(v_flex().id("space-content").w_full().flex_none().pr(12).pb(8)
            // StartupWorktreeRefreshStatus.tsx:22-29 status row with mx-3 mb-2 gap-2 text-xs text-muted-foreground.
            // StartupWorktreeRefreshStatus.tsx:14-16 delays 200ms before showing; omitted because Herdr has no frame timer.
            .when(!this.loaded || this.refreshingAll, el => el.child(h_flex().flex_none().mx(12).mb(8).gap(8).items_center()
              .text_size(12).text_color(t.muted)
              .child(svg("mods/orca-assets/loader-circle.svg").size(16).flex_none().spin(1000))
              .child(div().child(this.loaded ? "Refreshing workspaces\u2026" : "Loading workspaces\u2026"))))
            // EmptyState.tsx:22-27 renders "No workspaces found" when rows are empty.
            // EmptyState.tsx:14 and WorktreeList.tsx:285-287 gate this on startupWorktreeRefreshCompleted.
            .when(this.loaded && rows.length === 0, el => el.child(div().flex().flex_col().items_center().gap(8).px(16).py(24).w_full()
              .text_size(11).text_center().text_color(t.muted)
              .child(div().child("No workspaces found"))))
            .children(rows.length ? this.grouped(t, cx, rows) : [])
            // Saved projects: folders stored in localStorage["projects.saved.v1"] that no
            // open space's folder covers. Click → run("space.new", { folder }).
            // Hover reveals a remove control that drops the folder from the store and notifies.
            .when(savedRows.length > 0, el => el.child(v_flex().flex_none().w_full().mt(8).gap(4)
              .child(div().text_size(11).text_color("#6a6a6a").child("Saved Projects"))
              .children(savedRows)))))
        // The list's `.on_hover` flips the bar to `always`; Orca reveals on the sidebar's hover
        // (`main.css:781-800`), and the bar's own `hover` mode only sees the bar itself.
        .child(Scrollbar.vertical("space-list").mode(this.listHover ? "always" : "hover").absolute().inset_0())));
  }
}

class WorkspaceRow extends View {
  init(rowProps) { this.update(rowProps); }
  update(rowProps) { this.owner = rowProps.owner; this.key = rowProps.key; }
  render() {
    const data = this.owner.retainedPending.get(this.key);
    return data ? v_flex().w_full().flex_none().children(this.owner.rowElements(data)) : div();
  }
}

const SHARED_ASSET_PATHS = Object.freeze({
  "mods/orca-sidebar-projects/bell.svg": "mods/orca-assets/bell--orca-context-menu.svg",
  "mods/orca-sidebar-projects/chevron-down.svg": "mods/orca-assets/chevron-down--orca-files.svg",
  "mods/orca-sidebar-projects/chevron-right.svg": "mods/orca-assets/chevron-right--orca-files.svg",
  "mods/orca-sidebar-projects/ellipsis.svg": "mods/orca-assets/ellipsis--orca-pane-header.svg",
  "mods/orca-sidebar-projects/folder-plus.svg": "mods/orca-assets/folder-plus--orca-sidebar-projects.svg",
  "mods/orca-sidebar-projects/folder.svg": "mods/orca-assets/folder--orca-sidebar-projects.svg",
  "mods/orca-sidebar-projects/git-branch.svg": "mods/orca-assets/git-branch--orca-header.svg",
  "mods/orca-sidebar-projects/plus.svg": "mods/orca-assets/plus--orca-float-workspace.svg",
  "mods/orca-sidebar-projects/square-pen.svg": "mods/orca-assets/square-pen--orca-sidebar-projects.svg"
});
function sharedAsset(path) {
  return SHARED_ASSET_PATHS[path] ?? `mods/orca-assets/${path.slice(path.lastIndexOf("/") + 1)}`;
}
