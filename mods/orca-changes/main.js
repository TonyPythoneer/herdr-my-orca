// Derived from Herdr App's defaults/mods/changes/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, Input, InputState } from "gpui-base";
import { spaces, exec, watchFolder, theme, focused, panes, shared, setShared, window, run, props, openOverlay, closeOverlay, nextCommand } from "herdr";
import { copyText, reveal } from "./clip.js";
import { commitAndPush } from "./commit-push.js";
import { prepareCreatePr, createPr } from "./create-pr.js";
import { sameOperationTarget } from "./operation-target.js";
import { GIT_OPTIONS as READ, chunkPaths as chunks } from "./git-options.js";
import { assertDiscardUnchanged, discardSnapshot } from "./discard-snapshot.js";
import { displayPushDestination, forcePushConfirmed, forcePushTarget, pushConfigured } from "./push-target.js";
import { panelFrame } from "./panel-motion.js";

let mainChangesView = null;

// Orca scopes the panel to the project/workspace folder (open-uncommitted-entry.ts:6-36,
// GLOSSARY.md: "The space is the scope; the terminal is only where keystrokes go").
function location() {
  const space = (spaces() ?? []).find(s => s.active);
  return { cwd: space?.folder ?? null, on: space?.machine ?? null, space: space?.id };
}
const key = () => JSON.stringify(location());

// `props.file` is read against orca-files' root, which is space.folder (GLOSSARY.md:
// "The space is the scope; the terminal is only where keystrokes go").
// Status paths are relative to git toplevel, so rebase onto space.folder if they differ.
function relPath(from, to) {
  const a = from.replace(/\/+$/, "").split("/"), b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/");
}

// getConflictResolutions (shared/source-control/listing/source-control-entry-actions.ts:27-42):
// a delete/modify conflict may keep the file or the deletion, both-deleted has no file to keep,
// and every other conflict is staged as resolved. The porcelain XY pair is the conflict kind.
function conflictResolutions(xy) {
  if (xy === "DD") return ["keep_deletion"];
  if (xy === "DU" || xy === "UD") return ["keep_file", "keep_deletion"];
  return ["mark_resolved"];
}

// conflict-label.ts:28-46 — CONFLICT_RESOLUTION_ICONS and their labels.
const RESOLUTION = {
  mark_resolved: ["check.svg", "Mark as resolved"],
  keep_file: ["file-check.svg", "Keep file"],
  keep_deletion: ["file-x.svg", "Keep deletion"],
};

// Git decoration tones, `git-path-decoration.ts:5-12` -> main.css:489-496 (dark).
function gitTone(mark, t) {
  switch (mark) {
    case "A": return "#81b88b";               // added
    case "D": return "#c74e39";               // deleted
    case "M": return "#e2c08d";               // modified
    case "R": case "U": case "C": return "#73c991"; // renamed / untracked / copied
    case "!": return "#808080";               // ignored
    default: return t.dim;
  }
}

// Git and gh calls pinned to one captured repository and host.
const gitIn = (target) => (args) => exec("git", [...READ, ...args], { cwd: target.root, on: target.on });
const ghIn = (target) => (args) => exec("gh", args, { cwd: target.root, on: target.on });

// The card every confirmation dialog draws: a width and a title; the caller adds the rest.
const dialogShell = (t, width, title) => v_flex().w(width).p(16).gap(12).rounded(8).bg(t.popover).border_1().border_color(t.border)
  .child(div().text_size(13).font_weight(500).text_color(t.foreground).child(title));

const discardCancelButton = (t) => div().h(24).px(12).flex().items_center().rounded(6).border_1().border_color(t.border)
  .text_size(11).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover))
  .on_click((_e, _cx) => { window.close_dialog(); }).child("Cancel");

// Orca gates every per-row discard/delete behind a confirmation dialog
// (discard-confirmation.ts:13-62, use-discard-confirmation.ts:190-201).
const DISCARD_COPY = {
  delete: { title: (name) => `Delete "${name}"?`, text: "This will permanently delete this file. This cannot be undone.", label: "Delete" },
  restore: { title: (name) => `Restore "${name}"?`, text: "This will restore the last staged version and discard the deletion. This cannot be undone.", label: "Restore" },
  discard: { title: (name) => `Discard changes to "${name}"?`, text: "This will revert the unstaged changes to this file. This cannot be undone.", label: "Discard" },
};
const discardKind = (f) => {
  if (f.fresh) return "delete";
  return f.status === "D" ? "restore" : "discard";
};

const absolutePath = (root, path) => (root ? `${root.replace(/\/+$/, "")}/${path}` : path);

function platformRevealLabel() {
  // The platform name is only available when the host exposes `window` as a function.
  const platform = typeof window !== "undefined" && typeof window === "function" ? window()?.platform : null;
  if (platform === "macos") return "Reveal in Finder";
  return platform === "windows" ? "Reveal in File Explorer" : "Open Containing Folder";
}

// The status read shows at most this many entries; Stage All still covers the rest.
const MAX_STATUS_ENTRIES = 1000;
const REFRESH_INTERVAL_MS = 10_000;

async function readNumstat(git, args) {
  const r = await git(args);
  if (r.code !== 0) throw new Error(r.stderr);
  const stats = {};
  for (const entry of r.stdout.split("\0")) {
    const [a, d, ...parts] = entry.split("\t");
    if (!parts.length) continue;
    stats[parts.join("\t")] = { add: Number(a) || 0, del: Number(d) || 0, binary: a === "-" };
  }
  return stats;
}

// A, D or modified: the labels a status letter maps to (git-status-labels.ts:1-8).
const rowStatus = (letter) => (letter === "A" || letter === "D" ? letter : "M");

// Porcelain XY splits into an index (staged) and worktree (unstaged) entry; `??` is
// untracked and a partially staged file lands in both sections with its own counts
// (shared/git/status/git-status-porcelain-parser.ts:99-104,126-148). Labels follow
// shared/git/status/git-status-labels.ts:1-8 (untracked is U; conflicts render a badge).
function statusRows(entry, stagedStats, unstagedStats) {
  const xy = entry.slice(0, 2), path = entry.slice(3);
  if (xy === "??") return [{ path, section: "changes", status: "U", fresh: true, add: 0, del: 0 }];
  // `xy` stays on the row: it is the conflict kind getConflictResolutions reads.
  if (xy.includes("U") || xy === "AA" || xy === "DD") return [{ path, section: "conflicts", status: "!", xy, fresh: false, add: 0, del: 0 }];
  const rows = [];
  if (xy[0] !== " " && xy[0] !== "?") rows.push({ path, section: "staged", status: rowStatus(xy[0]), fresh: false, ...(stagedStats[path] ?? { add: 0, del: 0 }) });
  if (xy[1] !== " " && xy[1] !== "?") rows.push({ path, section: "changes", status: rowStatus(xy[1]), fresh: false, ...(unstagedStats[path] ?? { add: 0, del: 0 }) });
  return rows;
}

export default class Changes extends View {
  init(_props, cx) {
    if (props()?.tab !== "entry-menu") mainChangesView = this;
    this.files = []; this.message = ""; this.handle = cx.focus_handle();
    this.sectionViewFocus = { changes: cx.focus_handle(), staged: cx.focus_handle() };
    this.hovered = null; this.collapsed = {}; this.busy = false; this.busyReason = null; this.typing = false;
    this.menuOpen = false;
    this.input = TextareaState.new({ placeholder: "Message", rows: 2 });
    this.input.set_auto_grow(2, 12);
    this.input.on("change", (_e, eventCx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) eventCx.notify();
    });
    this.input.on("focus", (_e, eventCx) => { this.typing = true; eventCx.notify(); });
    this.input.on("blur", (_e, eventCx) => { this.typing = false; eventCx.notify(); });
    this.refresh(cx);
    cx.timer.every(REFRESH_INTERVAL_MS, (timerCx) => this.refresh(timerCx));
    cx.spawn(async (taskCx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "refresh") this.refresh(taskCx);
        taskCx.notify();
      }
    });
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (taskCx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(taskCx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) this.resetForContext(context);
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (taskCx) => {
      try { await this.readChanges(cwd, on, context, taskCx); }
      catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; taskCx.notify(); }
    });
  }

  // A different workspace or host: nothing of the old one stays on screen.
  resetForContext(context) {
    this.context = context; this.root = null; this.files = [];
    this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null; this.limited = false;
  }

  async readChanges(cwd, on, context, taskCx) {
    const top = await exec("git", [...READ, "rev-parse", "--show-toplevel"], { cwd, on });
    if (key() !== context) return;
    if (top.code !== 0) { this.root = null; this.files = []; this.error = "Source Control is only available for Git repositories"; return; }
    const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
    const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
    if (status.code !== 0) throw new Error(status.stderr);
    const stagedStats = await readNumstat(git, ["diff", "--cached", "--numstat", "-z", "--no-renames"]);
    const unstagedStats = await readNumstat(git, ["diff", "--numstat", "-z", "--no-renames"]);
    const rawEntries = status.stdout.split("\0").filter(Boolean);
    const files = rawEntries.slice(0, MAX_STATUS_ENTRIES).flatMap((entry) => statusRows(entry, stagedStats, unstagedStats));
    this.root = root; this.on = on; this.files = files; this.limited = rawEntries.length > MAX_STATUS_ENTRIES; this.error = null;
    this.watch(root, taskCx);
  }

  // Orca's primary-action state machine (shared/source-control/decisions/source-control-primary-action-decision.ts:95-140)
  // and commit eligibility (decisions/source-control-commit-eligibility.ts:24-38). Only the local
  // branches are reachable here: nothing staged + stageable -> Stage All; staged + message -> Commit;
  // staged without message -> Commit disabled. The upstream/publish/PR branches are omitted below.
  primaryAction() {
    const staged = this.files.filter((f) => f.section === "staged");
    const changes = this.files.filter((f) => f.section === "changes");
    const conflicts = this.files.filter((f) => f.section === "conflicts");
    if (this.busy) return { kind: "commit", label: "Commit", disabled: true, reason: this.busyReason };
    if (conflicts.length) return { kind: "commit", label: "Commit", disabled: true, reason: "Resolve conflicts before committing" };
    if (staged.length && this.message.trim()) return { kind: "commit", label: "Commit", disabled: false, reason: null };
    if (staged.length) return { kind: "commit", label: "Commit", disabled: true, reason: "Enter a commit message to commit" };
    if (changes.length) return { kind: "stage", label: "Stage All", disabled: false, reason: null };
    return { kind: "commit", label: "Commit", disabled: true, reason: "Stage at least one file to commit" };
  }

  // Ends a git operation: clears the busy state and reads the status again.
  finishOperation(cx) {
    this.busy = false; this.busyReason = null; this.refresh(cx); cx.notify();
  }

  runPrimary(cx) {
    const action = this.primaryAction();
    if (action.disabled || !this.root || this.busy || this.loading) return;
    // Stage All stages only; Commit never stages (src/main/git/source-control/staging.ts:131-153, commit-changes.ts).
    if (action.kind === "stage") this.apply([["add", "--all", "--", "."]], cx);
    else this.apply([["commit", "-m", this.message.trim()]], cx, () => { this.message = ""; this.input.set_value(""); });
  }

  runCommitAndPush(cx) {
    const action = this.primaryAction();
    if (action.disabled || action.kind !== "commit" || !this.root || this.busy || this.loading || key() !== this.context) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.busyReason = "Commit in progress…"; this.note = null;
    cx.spawn(async (taskCx) => {
      try {
        const pushed = await commitAndPush(
          (step) => step === "commit"
            ? exec("git", [...READ, "commit", "-m", message], { cwd: root, on })
            : pushConfigured((args) => exec("git", [...READ, ...args], { cwd: root, on }), () => key() === context),
          () => key() === context,
          () => {
            if (this.message.trim() === message) { this.message = ""; this.input.set_value(""); }
            this.busyReason = "Push in progress…"; taskCx.notify();
          },
        );
        if (pushed && key() === context) this.note = "Push completed.";
      } catch (e) { if (key() === context) this.note = String(e).trim(); }
      finally { this.finishOperation(taskCx); }
    });
    cx.notify();
  }

  runPush(cx) {
    if (!this.root || this.busy || this.loading || key() !== this.context) return;
    const root = this.root, on = this.on, context = this.context;
    this.busy = true; this.busyReason = "Push in progress…"; this.note = null; cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        const r = await pushConfigured((args) => exec("git", [...READ, ...args], { cwd: root, on }), () => key() === context);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || "Push failed");
        if (key() === context) this.note = "Push completed.";
      } catch (e) { if (key() === context) this.note = String(e.message || e).trim(); }
      finally { this.finishOperation(taskCx); }
    });
  }

  runSync(cx) {
    if (!this.root || this.busy || this.loading) return;
    this.apply([["pull", "--rebase"], ["push"]], cx);
  }

  // source-control-dropdown-items.ts:128-143 remote entries; the git commands are the ones
  // use-remote-action-runner.ts:119-185 dispatches. Labels lose Orca's ahead/behind counts
  // (formatCountLabel) because this panel does not read upstream status.
  runFetch(cx) {
    if (!this.root || this.busy || this.loading) return;
    // remote.ts:143 — fetch with pruning when no push target is configured.
    this.apply([["fetch", "--prune"]], cx);
  }

  runPull(cx) {
    if (!this.root || this.busy || this.loading) return;
    // remote.ts:105-119 — `git pull` honors the configured strategy; no push target is known here.
    this.apply([["pull"]], cx);
  }

  runForcePush(cx) {
    if (!this.root || this.busy || this.loading || key() !== this.context) return;
    const captured = this.operationTarget(), git = gitIn(captured);
    this.busy = true; this.busyReason = "Checking Force Push target…"; this.note = null; cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        const target = await forcePushTarget(git);
        if (!this.matchesTarget(captured)) return;
        window.open_dialog(this.forcePushDialog(captured, target));
      } catch (e) { if (this.matchesTarget(captured)) this.note = String(e.message || e); }
      finally { this.busy = false; this.busyReason = null; taskCx.notify(); }
    });
  }

  forcePushDialog(captured, target) {
    const t = theme();
    const destination = displayPushDestination(target.destination);
    return () => dialogShell(t, 420, "Force Push?")
      .child(div().text_size(12).text_color(t.muted).child(`This can overwrite remote history.\nRepository: ${captured.root}\nHost: ${captured.on ?? "local"}\nBranch: ${target.branch}\nRemote: ${target.remote} (${destination})\nTarget: ${target.ref}\nLease from local tracking: ${target.expected}\nPush commit: ${target.oid}`))
      .child(h_flex().justify_end().gap(8)
        .child(div().h(24).px(12).flex().items_center().rounded(6).border_1().border_color(t.border).text_color(t.muted).cursor_pointer().on_click(() => window.close_dialog()).child("Cancel"))
        .child(div().h(24).px(12).flex().items_center().rounded(6).bg(t.blocked).text_color(t.canvas).cursor_pointer()
          .on_click((_e, eventCx) => { window.close_dialog(); this.confirmForcePush(captured, target, eventCx); }).child("Force Push")));
  }

  confirmForcePush(captured, target, cx) {
    if (!this.matchesTarget(captured) || this.busy || this.loading) {
      this.note = "Workspace or host changed, or an operation is in progress. Force Push cancelled."; cx.notify(); return;
    }
    const git = gitIn(captured);
    this.busy = true; this.busyReason = "Force Push in progress…"; this.note = null; cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        const r = await forcePushConfirmed(git, target, () => this.matchesTarget(captured));
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || "Force Push failed");
        if (this.matchesTarget(captured)) this.note = "Push completed.";
      } catch (e) { if (this.matchesTarget(captured)) this.note = String(e.message || e); }
      finally { this.finishOperation(taskCx); }
    });
  }

  runPublish(cx) {
    if (!this.root || this.busy || this.loading) return;
    // remote.ts:30-48 — publish is the same gitPush with --set-upstream; only error copy differs.
    this.apply([["push", "--set-upstream", "origin", "HEAD"]], cx);
  }

  // Orca rebases onto the branch-compare base (source-control-dropdown-items.ts:123-143 ->
  // remote-rebase.ts:57-87). No base ref is exposed to this panel, so it takes origin/HEAD's
  // branch — the derivation openCreatePrDialog already uses — and ports the fetch-then-rebase
  // step (:70-87). The fork-point/--onto variant needs a merge-base probe, so this replays the
  // plain `git rebase origin/<base>` form (:87).
  runRebase(cx) {
    const root = this.root, on = this.on, context = this.context;
    if (!root || this.busy || this.loading) return;
    this.busy = true; this.note = null; cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        const sym = await exec("git", [...READ, "symbolic-ref", "refs/remotes/origin/HEAD"], { cwd: root, on });
        const full = sym.code === 0 ? sym.stdout.trim() : "";
        const prefix = "refs/remotes/origin/";
        const base = full.startsWith(prefix) ? full.slice(prefix.length) : "";
        if (!base) throw new Error("Choose a remote base branch to rebase from");
        for (const args of [["fetch", "--prune", "origin", base], ["rebase", `origin/${base}`]]) {
          const r = await exec("git", [...READ, ...args], { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
      } catch (e) { if (key() === context) this.note = String(e).trim(); }
      finally { this.finishOperation(taskCx); }
    });
  }

  openCreatePrDialog(cx) {
    const target = this.operationTarget();
    if (!this.matchesTarget(target) || this.busy || this.loading) return;
    const git = gitIn(target), gh = ghIn(target);
    this.busy = true; this.busyReason = "Checking GitHub branch…"; this.note = null; cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        const snapshot = await prepareCreatePr(git, gh);
        if (!this.matchesTarget(target)) return;
        this.showCreatePrDialog(target, snapshot);
      } catch (e) { if (this.matchesTarget(target)) this.note = `Cannot prepare PR: ${e.message || e}`; }
      finally { this.busy = false; this.busyReason = null; taskCx.notify(); }
    });
  }

  showCreatePrDialog(target, snapshot) {
    const title = InputState.new({ placeholder: "Title" });
    title.set_value(this.message.trim() || snapshot.branch);
    const body = InputState.new({ placeholder: "Description (optional)" });
    let draft = false;
    const t = theme();
    window.open_dialog(() => dialogShell(t, 420, "Create Pull Request")
      .child(div().text_size(11).text_color(t.muted).child(`${snapshot.name} · ${snapshot.head} → ${snapshot.base}\nHost: ${target.on ?? "local"} · already-pushed branch`))
      .child(Input.new(title).h(30).px(8).border_1().border_color(t.input).text_color(t.foreground))
      .child(Input.new(body).h(56).px(8).border_1().border_color(t.input).text_color(t.foreground))
      .child(h_flex().gap(6).cursor_pointer().on_click((_e, eventCx) => { draft = !draft; eventCx.notify(); })
        .child(div().size(14).border_1().border_color(t.border).bg(draft ? t.accent : t.popover))
        .child(div().text_size(11).text_color(t.muted).child("Create as draft PR")))
      .child(h_flex().justify_end().gap(8)
        .child(div().px(12).py(5).cursor_pointer().text_color(t.muted).on_click(() => window.close_dialog()).child("Cancel"))
        .child(div().px(12).py(5).rounded(4).bg(t.done).text_color(t.canvas).cursor_pointer()
          .on_click((_e, eventCx) => { const text = title.value().trim(); if (!text) return; window.close_dialog(); this.submitCreatePr(target, snapshot, { title: text, body: body.value(), draft }, eventCx); }).child("Create PR"))));
  }

  submitCreatePr(target, snapshot, { title, body, draft }, cx) {
    if (!this.matchesTarget(target) || this.busy || this.loading) return;
    this.busy = true; this.busyReason = "Creating pull request…"; this.note = null; cx.notify();
    const git = gitIn(target), gh = ghIn(target);
    cx.spawn(async (taskCx) => {
      try {
        const pr = await createPr({ snapshot, git, gh, current: () => this.matchesTarget(target), title, body, draft });
        if (this.matchesTarget(target)) this.note = `Created PR #${pr.number}: ${pr.url}`;
      } catch (e) { if (this.matchesTarget(target)) this.note = String(e.message || e); }
      finally { this.finishOperation(taskCx); }
    });
  }

  operationTarget() { return { root: this.root, on: this.on, context: this.context }; }

  matchesTarget(expected) {
    return sameOperationTarget(expected, { ...this.operationTarget(), activeContext: key() });
  }

  prepareDiscard(target, paths, cx, open) {
    if (!this.matchesTarget(target) || this.busy || this.loading) return;
    this.busy = true; this.note = null; cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        const snapshot = await discardSnapshot(target, paths, exec);
        if (this.matchesTarget(target)) open(snapshot);
      } catch (e) { if (this.matchesTarget(target)) this.note = `Cannot prepare discard: ${e.message || e}`; }
      finally { this.busy = false; taskCx.notify(); }
    });
  }

  verifyDiscard(target, paths, snapshot, cx, perform) {
    if (!this.matchesTarget(target) || this.busy || this.loading) {
      this.note = "Workspace or host changed, or an operation is in progress. Action cancelled."; cx.notify(); return;
    }
    this.busy = true; this.note = null; cx.notify();
    cx.spawn(async (taskCx) => {
      let verified = false;
      try {
        await assertDiscardUnchanged(target, paths, snapshot, exec);
        verified = this.matchesTarget(target);
      } catch (e) { if (this.matchesTarget(target)) this.note = `Discard cancelled: ${e.message || e}`; }
      finally { this.busy = false; taskCx.notify(); }
      if (verified && this.matchesTarget(target)) perform(taskCx);
    });
  }

  apply(commands, cx, done, expected = this.operationTarget()) {
    if (!this.matchesTarget(expected) || this.busy || this.loading) {
      this.note = "Workspace or host changed, or an operation is in progress. Action cancelled."; cx.notify(); return;
    }
    const root = this.root, on = this.on, context = this.context;
    this.busy = true; this.busyReason = commands[0]?.[0] === "commit" ? "Commit in progress…" : null; this.note = null;
    cx.spawn(async (taskCx) => {
      try {
        for (const args of commands) {
          if (key() !== context) throw new Error("Workspace or host changed; remaining actions were cancelled.");
          const r = await exec("git", [...READ, ...args], { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (key() === context && done) done();
      } catch (e) { if (key() === context) this.note = String(e).trim(); }
      finally { this.finishOperation(taskCx); }
    });
    cx.notify();
  }

  stagePaths(paths, cx) {
    this.apply(chunks(paths).map((c) => ["add", "--", ...c]), cx);
  }

  unstagePaths(paths, cx) {
    this.apply(chunks(paths).map((c) => ["reset", "--quiet", "--", ...c]), cx);
  }

  actionButton(icon, t, onClick, title, enabled = true) {
    // uncommitted-entry-row.tsx:218-273 overlay buttons are 24px with 14px glyphs (action-button.tsx:31-40);
    // Orca disables them with opacity-50 while a bulk action runs. These are icon-only, so the
    // name and disabled state must reach the accessibility tree as well as the tooltip (M8).
    const label = title ?? icon.replace(/\.svg$/, "");
    return div().w(24).h(24).flex().flex_none().items_center().justify_center().rounded(4)
      .role("button").accessibility_label(label).tooltip(label).disabled(!enabled)
      .when(enabled, (s) => s.cursor_pointer().hover((x) => x.bg(t.chrome))
        .on_click((_e, eventCx) => { eventCx.stop_propagation(); onClick(); }))
      .when(!enabled, (s) => s.opacity(0.5))
      .child(svg(sharedAsset(`mods/orca-changes/${icon}`)).size(14).text_color(t.muted));
  }

  // Per-file commands match Orca: stage `git add --` (src/main/git/source-control/staging.ts:23-31), unstage
  // `git reset --quiet --` (:88-102), discard `git restore --worktree --` (discard-changes.ts:39),
  // Untracked deletion excludes ignored files and nested repositories.
  rowButtons(f, name, t, cx) {
    const buttons = [];
    if (f.section === "changes") {
      buttons.push(this.actionButton(f.fresh ? "trash.svg" : "undo.svg", t, () => this.confirmDiscard(f, name, cx),
        f.fresh ? "Delete untracked file" : "Discard changes",
        !this.busy));
      buttons.push(this.actionButton("plus.svg", t, () => this.apply([["add", "--", f.path]], cx), "Stage", !this.busy));
    } else if (f.section === "staged") {
      buttons.push(this.actionButton("minus.svg", t, () => this.apply([["reset", "--quiet", "--", f.path]], cx), "Unstage", !this.busy));
    } else if (f.section === "conflicts") {
      // uncommitted-entry-row.tsx:218-229 draws one ActionButton per resolution; the commands are
      // resolveConflict (src/main/git/source-control/staging.ts:41-86): `git add` stages the file, `git rm -f` records the deletion.
      for (const r of conflictResolutions(f.xy)) {
        const [icon, title] = RESOLUTION[r];
        buttons.push(this.actionButton(icon, t, () => this.resolveConflict(f, r, cx), title, !this.busy && r !== "keep_deletion"));
      }
    }
    return buttons;
  }

  fileRow(f, t, cx) {
    const id = `${f.section}-${f.path}`, parts = f.path.split("/"), name = parts.pop();
    const hovered = this.hovered === id, buttons = this.rowButtons(f, name, t, cx);
    // Row click opens the file's diff in the diff pane (openDiff); Open in File Explorer opens the file itself.
    const selected = this.openTarget?.path === f.path && this.openTarget?.section === f.section;
    return h_flex().id(id).w_full().h(24).flex_none().pl(20).pr(12).gap(4).items_center().relative()
      // Non-open rows hover at accent/40 (row-layout.ts:9-11); t.hover is --accent.
      .hover((s) => s.bg(t.hover + "66")).when(selected, (e) => e.bg(t.selected))
      .on_hover((on, eventCx) => { if (on !== hovered) { this.hovered = on ? id : null; eventCx.notify(); } })
      .on_click(() => this.openDiff(f))
      // uncommitted-entry-row.tsx:100-277 — right-click context menu (SourceControlEntryContextMenu)
      .on_mouse_down("right", (_e, eventCx) => {
        eventCx.stop_propagation();
        openOverlay({
          mod: "orca-changes",
          kind: "popup",
          width: 208,
          props: { tab: "entry-menu", entry: f, target: this.operationTarget() }
        });
      })
      .child(svg("mods/orca-assets/file.svg").size(14).flex_none().text_color(gitTone(f.status, t)))
      .child(h_flex().flex_1().min_w(0).items_center()
        .child(div().flex_none().max_w(260).truncate().text_color(t.foreground).child(name))
        .when(parts.length > 0, (e) => e.child(div().ml(6).flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(parts.join("/")))))
      .when(f.add > 0 || f.del > 0, (e) => e.child(h_flex().flex_none().gap(3)
        .when(f.add > 0, (x) => x.child(div().text_size(10).text_color(gitTone("A", t)).child(`+${f.add}`)))
        .when(f.del > 0, (x) => x.child(div().text_size(10).text_color(gitTone("D", t)).child(`-${f.del}`)))))
      .when(f.section === "conflicts", (e) => e.child(div().rounded(999).px(8).py(1).text_size(10).font_weight(600)
        .bg(gitTone("D", t) + "1f").text_color(gitTone("D", t)).child("Unresolved")))
      .when(f.section !== "conflicts", (e) => e.child(div().w(16).flex_none().text_center().text_size(10).font_bold()
        .text_color(gitTone(f.status, t)).child(f.status)))
      .when(hovered && buttons.length > 0, (e) => e.child(h_flex().absolute().right(0).top(0).bottom(0).flex_none()
        .items_center().gap(6).bg(t.hover).pr(12).pl(8).children(buttons)));
  }

  // openUncommittedEntry (open-uncommitted-entry.ts:6-36, entry-context-menu.tsx:93-99) opens a diff editor for most rows,
  // the file itself for added/untracked markdown, and the conflicted file for conflicts. Herdr's
  // editor holds one buffer and has no diff model, so the diff is drawn by the `orca-diff` pane (openDiff);
  // this is the open-file half, ported through orca-files' `props.file` (a tab whose only pane is
  // that mod), which resolves it against space.folder. The conflict merge view has no equivalent,
  // so a conflicted file opens as plain text.
  // Shows `f` (or every change, `{ all: true }`) in the `orca-diff` pane beside the terminals: this tab's pane if it has one,
  // else a split of the focused terminal. Conflicts stay on openEntry: their `git diff` is the combined `--cc` format.
  // `root` and `on` are passed along because status paths are relative to the git toplevel; the popup passes its own.
  openDiff(f, root = this.root, on = location().on) {
    if (f.section === "conflicts") return this.openEntry(f, root);
    if (!root) return;
    const target = { root, on, all: Boolean(f.all), sectionAll: Boolean(f.sectionAll), paths: f.paths, limited: Boolean(f.limited), path: f.path, section: f.section, status: f.status };
    setShared("orca-diff.target", target);
    const tab = focused()?.tab, inTab = panes().filter((p) => p.tab === tab);
    if (inTab.some((p) => p.mod === "orca-diff")) return run("orca-diff.show");
    const host = inTab.find((p) => p.focused && !p.mod) ?? inTab.find((p) => !p.mod);
    if (host) run("pane.split", { direction: "right", pane: host.pane, mod: "orca-diff", props: target });
    else run("tab.new", { mod: "orca-diff", props: target });
  }

  openEntry(f, root = this.root) {
    const cwd = location().cwd;
    if (!root || !cwd) return;
    // Status paths are relative to the git toplevel; `props.file` is read against space.folder.
    const file = relPath(cwd, `${root.replace(/\/+$/, "")}/${f.path}`);
    run("tab.new", { mod: "orca-files", props: { file } });
  }

  // resolveConflict (src/main/git/source-control/staging.ts:41-86, entry-context-menu.tsx:100-113)
  resolveConflict(f, resolution, cx, target = this.operationTarget()) {
    if (!this.matchesTarget(target) || this.busy || resolution === "keep_deletion") return;
    const { root, on, context } = target;
    // resolveConflict (src/main/git/source-control/staging.ts:41-86) re-reads the exact unmerged
    // record and refuses to keep a file the worktree no longer has, because `git add` would stage
    // that deletion (:56-68); the worktree mode is field 7 of porcelain v2's `u` record (:66).
    // mark_resolved and keep_file both stage the file; keep_deletion records it with `git rm
    // --force --quiet -- path` (:79-84).
    const command = resolution === "keep_deletion"
      ? ["rm", "--force", "--quiet", "--", f.path]
      : ["add", "--", f.path];
    this.busy = true; this.note = null; cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        const st = await exec("git", [...READ, "--literal-pathspecs", "status", "--porcelain=v2", "-z", "--untracked-files=no", "--", f.path], { cwd: root, on });
        if (st.code !== 0) throw new Error((st.stderr || st.stdout).trim());
        const record = st.stdout.split("\0").find((line) => line.startsWith("u "));
        if (!record) throw new Error(`${f.path} is no longer in conflict. Refresh to see its current state.`);
        if (resolution !== "keep_deletion" && record.split(" ")[6] === "000000")
          throw new Error(`${f.path} has changed since this list loaded. Refresh to see its current state.`);
        if (!this.matchesTarget(target)) throw new Error("Workspace changed; conflict resolution cancelled.");
        const r = await exec("git", [...READ, "--literal-pathspecs", ...command], { cwd: root, on });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        if (mainChangesView) mainChangesView.refresh(taskCx);
        run("orca-changes.refresh");
      } catch (e) { if (key() === context) this.note = String(e).trim(); }
      finally { this.busy = false; this.refresh(taskCx); taskCx.notify(); }
    });
  }

  confirmDiscard(f, name, cx) {
    const t = theme(), target = this.operationTarget(), deleting = f.fresh;
    const copy = DISCARD_COPY[discardKind(f)];
    const command = deleting ? ["clean", "-f", "--", f.path] : ["restore", "--worktree", "--", f.path];
    this.prepareDiscard(target, [f.path], cx, (snapshot) => window.open_dialog(() => dialogShell(t, 360, copy.title(name))
      .child(div().text_size(12).text_color(t.muted).child(`${copy.text}\nRepository: ${target.root}\nHost: ${target.on ?? "local"}\nPath: ${f.path}`))
      .child(h_flex().justify_end().gap(8)
        .child(discardCancelButton(t))
        .child(div().h(24).px(12).flex().items_center().rounded(6).bg(deleting ? t.blocked : t.done)
          .text_color(t.canvas).text_size(11).cursor_pointer()
          .on_click((_e, eventCx) => { window.close_dialog(); this.verifyDiscard(target, [f.path], snapshot, eventCx, (callbackCx) => this.apply([command], callbackCx, null, target)); }).child(copy.label)))));
  }

  // Discard all is gated by the same destructive confirmation as one row
  // (uncommitted-sections.tsx:122-135 -> discard-confirmation.ts:13-62); runDiscardAllForArea
  // unstages the staged area before discarding (source-control-discard-all-sequence.ts:73-118).
  confirmDiscardAll(sectionKey, paths, cx) {
    if (!paths.length || this.busy) return;
    const t = theme(), target = this.operationTarget(), area = sectionKey === "staged" ? "staged" : "changes";
    const count = `${paths.length} ${paths.length === 1 ? "file" : "files"}`;
    this.prepareDiscard(target, paths, cx, (snapshot) => window.open_dialog(() => dialogShell(t, 360, "Discard all changes?")
      .child(div().max_h(200).overflow_y_scrollbar().text_size(12).text_color(t.muted).child((area === "staged"
        ? `This will unstage and discard the changes to ${count}. This cannot be undone.`
        : `This will revert the unstaged changes to ${count}. This cannot be undone.`) + `\nRepository: ${target.root}\nHost: ${target.on ?? "local"}\n${paths.join("\n")}`))
      .child(h_flex().justify_end().gap(8)
        .child(discardCancelButton(t))
        .child(div().h(24).px(12).flex().items_center().rounded(6).bg(t.blocked)
          .text_color(t.canvas).text_size(11).cursor_pointer()
          .on_click((_e, eventCx) => { window.close_dialog(); this.verifyDiscard(target, paths, snapshot, eventCx, (callbackCx) => this.discardPaths(paths, area, callbackCx, target)); }).child("Discard all")))));
  }

  discardPaths(paths, area, cx, expected = this.operationTarget()) {
    const root = this.root, on = this.on, context = this.context;
    if (!this.matchesTarget(expected) || this.busy || this.loading) {
      this.note = "Workspace or host changed, or an operation is in progress. Action cancelled."; cx.notify(); return;
    }
    // discard-changes.ts:16-60 picks the command per path: tracked -> `restore --worktree`,
    // untracked -> `clean -f`; tracked-ness comes from `ls-files` (listTrackedPathSpecs, :64-80).
    const git = async (args) => {
      if (key() !== context) throw new Error("Workspace or host changed; remaining actions were cancelled.");
      const r = await exec("git", [...READ, ...args], { cwd: root, on });
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
      return r.stdout;
    };
    this.busy = true; this.note = null; cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        if (area === "staged") for (const c of chunks(paths)) await git(["reset", "--quiet", "--", ...c]);
        const tracked = new Set();
        for (const c of chunks(paths)) {
          for (const p of (await git(["ls-files", "-z", "--", ...c])).split("\0")) if (p) tracked.add(p);
        }
        for (const c of chunks(paths.filter((p) => tracked.has(p)))) await git(["restore", "--worktree", "--", ...c]);
        for (const c of chunks(paths.filter((p) => !tracked.has(p)))) await git(["clean", "-f", "--", ...c]);
      } catch (e) { if (key() === context) this.note = String(e).trim(); }
      finally { this.busy = false; this.refresh(taskCx); taskCx.notify(); }
    });
  }

  section(sectionKey, label, t, cx) {
    const items = this.files.filter((f) => f.section === sectionKey);
    if (!items.length) return null;
    const collapsed = Boolean(this.collapsed[sectionKey]), bulk = [];
    // uncommitted-sections.tsx:122-150 orders the header actions Discard all, Stage all, Unstage all;
    // each is disabled while a bulk operation runs (isExecutingBulk). Conflicts never get Discard all
    // because getDiscardAllPaths excludes every conflicted row (source-control-discard-all-sequence.ts:9-27).
    if (sectionKey !== "conflicts") bulk.push(this.actionButton("undo.svg", t,
      () => this.confirmDiscardAll(sectionKey, items.map((f) => f.path), cx), "Discard all", !this.busy));
    if (sectionKey === "changes") bulk.push(this.actionButton("plus.svg", t, () => this.stagePaths(items.map((f) => f.path), cx), "Stage all", !this.busy));
    if (sectionKey === "staged") bulk.push(this.actionButton("minus.svg", t, () => this.unstagePaths(items.map((f) => f.path), cx), "Unstage all", !this.busy));
    const viewAll = () => {
      if (this.context !== JSON.stringify(location())) { this.note = "Workspace or host changed; action cancelled."; return; }
      this.openDiff({ sectionAll: true, section: sectionKey, paths: items.map((item) => item.path), limited: this.limited }, this.root, this.on);
    };
    return div().child(
      div().pl(4).pr(12).pt(12).pb(4).child(
        h_flex().rounded(6).pr(4).gap(4).items_center()
          .child(div().id(`section-${sectionKey}`).flex_1().min_w(0).flex().items_center().gap(4).cursor_pointer()
            .on_click((_e, eventCx) => { this.collapsed[sectionKey] = !collapsed; eventCx.notify(); })
            .child(svg(sharedAsset(`mods/orca-changes/${collapsed ? "chevron-right.svg" : "chevron-down.svg"}`)).size(14).flex_none().text_color(t.muted))
            .child(div().truncate().text_size(12).font_weight(600).text_color(t.muted).child(label.toUpperCase()))
            .child(div().flex_none().text_size(11).text_color(t.muted).child(String(items.length))))
          .child(h_flex().flex_none().items_center().gap(6).children(bulk)
            .when(sectionKey !== "conflicts", (e) => e.child(div().id(`view-all-${sectionKey}`).h(24).px(6).flex().items_center().rounded(4)
              .text_size(11).text_color(t.muted).cursor_pointer().role("button").accessibility_label(`View all ${label}`)
              .track_focus(this.sectionViewFocus[sectionKey]).tab_index(0)
              .when(this.sectionViewFocus[sectionKey].is_focused(), (el) => el.border_1().border_color(t.accent))
              .hover((el) => el.bg(t.hover)).on_click((_e, eventCx) => { eventCx.stop_propagation(); viewAll(); eventCx.notify(); })
              .on_key_down((event, eventCx) => { if (this.sectionViewFocus[sectionKey].is_focused() && !event.modifiers?.platform && !event.modifiers?.control && !event.modifiers?.alt && !event.modifiers?.shift && (event.key === "enter" || event.key === "space")) { eventCx.stop_propagation(); viewAll(); eventCx.notify(); } })
              .child("View all"))))))
      // One scroll container for the whole panel body, as Orca has (panel/panel-ready.tsx).
      .when(!collapsed, (e) => e.child(v_flex().children(items.map((f) => this.fileRow(f, t, cx)))));
  }

  commitArea(t, action, cx) {
    // Orca renders the commit surface above the list (panel/panel-content.tsx:130): wrapper
    // px-3 pb-2 (commit-area.tsx:216), textarea min-h-14 rounded-md border-input bg-background
    // px-2 py-1.5 text-xs (commit-message-composer.tsx:46), actions on an mt-1 row (:32-80).
    // Orca has no top inset here; pt(12) keeps the box off the header border (same as section headers).
    return v_flex().flex_none().px(12).pt(12).pb(8)
      .child(div().id("commit-message").min_h(56).rounded(6).border_1()
        .border_color(this.typing ? t.accent : t.input).bg(t.canvas).px(8).py(6).cursor_text()
        .on_mouse_down("left", (_e, eventCx) => eventCx.stop_propagation())
        .child(Textarea.new(this.input).w_full().text_size(12).text_color(t.foreground)))
      .child(h_flex().mt(4).gap(4).items_center()
        // commit-action-menu.tsx:34-85: split button pairing primary action with chevron dropdown
        .child(h_flex().rounded(6).border_1().border_color(t.border).items_stretch()
          .child(div().id("commit-primary").h(24).px(12).flex().flex_none().items_center().rounded_l(5)
            .text_size(11)
            .text_color(action.disabled ? t.dim : t.foreground)
            .when(!action.disabled, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)))
            .on_click((_e, eventCx) => { if (!action.disabled) this.runPrimary(eventCx); })
            .child(action.label))
          .child(div().id("commit-chevron").h(24).w(22).flex().flex_none().items_center().justify_center().rounded_r(5)
            .border_l(1).border_color(t.border)
            .cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click((_e, eventCx) => {
              this.menuOpen = !this.menuOpen;
              eventCx.notify();
            })
            .child(svg("mods/orca-assets/chevron-down--orca-agent-settings.svg").size(12).text_color(t.muted))))
        .when(Boolean(action.reason), (e) => e.child(div().text_size(11).text_color(t.dim).child(action.reason))))
      .when(this.menuOpen, (e) => e.child(this.actionMenu(t, action, cx)));
  }

  actionMenu(t, action, cx) {
    // commit-action-menu.tsx:34-85 & source-control-dropdown-items.ts:128-143. Entries in Orca's
    // order: Commit, Commit & Push, [separator], Push, Force Push, Create PR…, Push & Create PR…,
    // Pull, Sync, Rebase, Fetch, Publish. Commit & Sync, the fast-forward Pull and the abort entries
    // are not drawn: this panel exposes no ahead/behind counts and no conflict-operation state, so
    // only "a repository is open" decides whether they are enabled.
    const item = (label, enabled, onClick, icon) => div().h(26).px(10).flex().items_center().gap(6).rounded(4)
      .text_size(11).text_color(enabled ? t.foreground : t.dim)
      .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)))
      .on_click((_e, eventCx) => {
        if (!enabled) return;
        this.menuOpen = false;
        onClick(eventCx);
      })
      .when(Boolean(icon), (e) => e.child(svg(icon).size(12).text_color(enabled ? t.muted : t.dim)))
      .child(label);

    const canCommit = !action.disabled && action.kind === "commit";
    return v_flex().w_full().mt(4).p(4).gap(2).rounded(6).border_1().border_color(t.border).bg(t.popover)
      .child(item("Commit", canCommit, (eventCx) => this.runPrimary(eventCx)))
      .child(item("Commit & Push · destination binding unavailable", false, () => {}))
      .child(div().h(1).my(2).bg(t.border))
      .child(item("Push · destination binding unavailable", false, () => {}))
      .child(item("Force Push · destination binding unavailable", false, () => {}))
      .child(item("Create PR…", Boolean(this.root), (eventCx) => this.openCreatePrDialog(eventCx), "mods/orca-assets/git-pull-request.svg"))
      .child(item("Push & Create PR · target unavailable", false, () => {}, "mods/orca-assets/git-pull-request.svg"))
      .child(item("Pull", Boolean(this.root), (eventCx) => this.runPull(eventCx)))
      .child(item("Sync · target unavailable", false, () => {}))
      .child(item("Rebase · base unavailable", false, () => {}))
      .child(item("Fetch", Boolean(this.root), (eventCx) => this.runFetch(eventCx)))
      .child(item("Publish · target unavailable", false, () => {}));
  }

  // SourceControlEntryContextMenu — entry-context-menu.tsx:90-150
  entryMenuView(t, cx) {
    const { entry, target } = props() ?? {};
    if (!entry || !target) return div();
    const abs = absolutePath(target.root, entry.path);
    const overlay = props()?.overlay;
    const close = () => { if (overlay) closeOverlay(overlay); };
    const revealLabel = platformRevealLabel();

    const item = (i, label, icon, onClick, enabled = true) => h_flex().id(`scm-${i}`).h(28).flex_none().px(8).gap(8).items_center().rounded(6)
      .when(enabled, s => s.cursor_pointer().hover(x => x.bg(t.hover)).on_click((_e, clickCx) => { onClick(clickCx); close(); }))
      .when(!enabled, s => s.opacity(0.5))
      .child(svg(sharedAsset(`mods/orca-changes/${icon}.svg`)).size(14).flex_none().text_color(t.muted))
      .child(div().child(label));
    const sep = () => div().h(1).my(3).mx(4).bg(t.border);

    // Conflict resolutions if conflicted (entry-context-menu.tsx:100-113)
    const resolutions = entry.section === "conflicts" ? conflictResolutions(entry.xy) : [];

    return v_flex().id("orca-changes-entry-menu").w_full().min_h(0).p(5).bg(t.popover).text_size(12.8).text_color(t.foreground)
      .child(div().px(8).py(4).text_size(11).text_color(t.dim).child(entry.path ?? ""))
      // View — entry-context-menu.tsx:93-99
      .child(item(0, "View", "eye", () => { if (mainChangesView?.matchesTarget(target)) mainChangesView.openDiff(entry, target.root, target.on); }))
      .when(resolutions.length > 0, el => el
        .child(sep())
        .children(resolutions.map((r, idx) => {
          const [icon, title] = RESOLUTION[r];
          return item(`res-${idx}`, title, icon.replace(/\.svg$/, ""), (clickCx) => { if (mainChangesView?.matchesTarget(target)) mainChangesView.resolveConflict(entry, r, clickCx, target); }, r !== "keep_deletion");
        }))
      )
      .child(sep())
      // Copy Path — entry-context-menu.tsx:115-118
      .child(item(1, "Copy Path", "copy", (clickCx) => void copyText(abs, clickCx)))
      // Copy Relative Path — entry-context-menu.tsx:119-124
      .child(item(2, "Copy Relative Path", "copy", (clickCx) => void copyText(entry.path, clickCx)))
      .child(sep())
      // Reveal in File Manager — entry-context-menu.tsx:132-139 (disabled if deleted: hasWorkingTreeFile)
      .child(item(3, revealLabel, "external-link", () => void reveal(abs, false), entry.status !== "D"))
      .child(sep())
      // Open in File Explorer — entry-context-menu.tsx:141-147
      .child(item(4, "Open in File Explorer", "folder-open", () => {
        if (!mainChangesView?.matchesTarget(target)) return;
        const cwd = location().cwd;
        const file = cwd ? relPath(cwd, abs) : entry.path;
        run("tab.new", { mod: "orca-files", props: { file } });
      }));
  }

  // Unified layout: a narrowing panel keeps this content at its open width (see panel-motion.js).
  render(cx) { return panelFrame(this.renderBody(cx)); }

  renderBody(cx) {
    // A task's error is reported, not thrown into the paint: a failed refresh
    // must never replace the pane with the shell's "could not be re-rendered" bar.
    // Deferred off the frame for the same reason as `orca-files`: a spawn body runs immediately
    // up to its first `await`, and calling into a view from render invites the same refusal.
    if (key() !== this.context) cx.timer.after(0, (timerCx) => this.refresh(timerCx));
    this.openTarget = shared("orca-diff.target");
    const t = theme(), action = this.primaryAction();
    if (props()?.tab === "entry-menu") return this.entryMenuView(t, cx);
    // Orca pins conflicts first, then applies the group order (default changes-first):
    // listing/source-control-section-order.ts:121-142, source-control-group-order.ts:3-5. A fourth
    // section, Committed on Branch (listing/branch-section.tsx:92-99), needs a base ref and a branch
    // compare; this panel has no base-ref setting, so it is not drawn.
    const sections = [["conflicts", "Conflicts"], ["changes", "Changes"], ["staged", "Staged Changes"]];
    return v_flex().id("changes").size_full().min_h(0).overflow_hidden().text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, eventCx) => {
        if (e.key === "escape") {
          if (this.menuOpen) { this.menuOpen = false; eventCx.notify(); return; }
          if (this.typing) { this.typing = false; this.handle.focus(); eventCx.stop_propagation(); eventCx.notify(); return; }
        }
        // Cmd/Ctrl+Enter commits (src/renderer/src/components/right-sidebar/source-control/commit/commit-shortcut.ts:8-17 -> screen-submit-shortcut.ts:20-27).
        if (e.key === "enter" && !e.modifiers.alt && !e.modifiers.shift && (e.modifiers.platform || e.modifiers.control)) {
          eventCx.stop_propagation(); this.runPrimary(eventCx);
        }
      })
      // Toolbar, filter and branch context (panel/header-toolbar.tsx:210-322) are not drawn: no
      // filter or branch-compare state is exposed to a mod.
      .child(this.commitArea(t, action, cx))
      // content-status.tsx:99-108 renders the too-many card in a px-3 pb-2 block above the list;
      // Stage All stages every change on the host, past the cap, and Retry re-runs the status read.
      .when(this.limited, (e) => e.child(this.tooManyBanner(t, cx)))
      // Orca opens a Monaco DiffEditor in an editor tab (open-uncommitted-entry.ts:28-31); Herdr's
      // EditorState is one buffer with no diff model, so a row click opens the `orca-diff` pane.
      .child(v_flex().id("changes-list").flex_1().min_h(0).overflow_y_scrollbar()
        .children(sections.map(([sectionKey, label]) => this.section(sectionKey, label, t, cx)).filter(Boolean))
        .when(!this.files.length, (e) => e.child(this.emptyState(t))))
      .when(Boolean(this.note), (e) => e.child(div().px(12).pb(8).text_size(11).text_color(this.note === "Push completed." ? t.ansi2 : t.ansi1).child(this.note)));
  }

  tooManyBanner(t, cx) {
    // amber-500/25 border, amber-500/5 fill, AlertTriangle amber-600 (light) / amber-400 (dark):
    // too-many-changes-banner.tsx:11-22.
    const amber = t.is_dark ? "#fbbf24" : "#d97706";
    const button = (label, onClick, enabled) => div().h(24).px(8).flex().items_center().rounded(6)
      .border_1().border_color(t.border).text_size(11).text_color(enabled ? t.foreground : t.dim)
      .when(enabled, (s) => s.cursor_pointer().hover((x) => x.bg(t.hover)).on_click(onClick))
      .child(label);
    return v_flex().id("too-many-changes").mx(12).mb(8).gap(6).rounded(6).border_1()
      .border_color("#f59e0b40").bg("#f59e0b0d").px(12).py(8)
      .child(h_flex().items_start().gap(8)
        .child(svg("mods/orca-assets/triangle-alert.svg").size(16).flex_none().text_color(amber))
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.foreground)
          .child(`Too many changes detected. Only the first ${MAX_STATUS_ENTRIES.toLocaleString()} changes are shown.`)))
      .child(h_flex().justify_end().gap(8)
        // Stage All stages every change on the host, including rows past the cap (:9-10,34-45).
        .child(button("Stage All", (_e, eventCx) => this.apply([["add", "--all", "--", "."]], eventCx), !this.busy))
        // StatusRetryButton (status-retry-button.tsx:12-79) re-runs the status read; its 1s-delayed
        // spinner is not drawn, the button simply disables while the read runs.
        .child(button("Retry", (_e, eventCx) => this.refresh(eventCx), !this.loading && !this.busy)));
  }

  emptyState(t) {
    if (this.error) return div().px(16).py(24).text_size(12).text_color(t.muted).child(this.error);
    if (this.loading) return div().px(16).py(24).text_size(12).text_color(t.muted).child("Loading changes…");
    // panel/panel.tsx:11-16; content-status.tsx:133-151 with empty-state.tsx:11-13.
    if (!this.root) return div().px(16).py(24).text_size(12).text_color(t.muted).child("Select a workspace to view changes");
    return div().px(16).py(24)
      .child(div().text_size(14).font_weight(500).text_color(t.foreground).child("No changes on this branch"))
      // No branch base ref is exposed, so this uses Orca's own 'base' fallback (content-status.tsx:139-150).
      .child(div().mt(4).text_size(12).text_color(t.muted).child("This workspace is clean and this branch has no changes ahead of base"));
  }
}

const SHARED_ASSET_PATHS = Object.freeze({
  "mods/orca-changes/chevron-down.svg": "mods/orca-assets/chevron-down--orca-agent-settings.svg",
  "mods/orca-changes/chevron-right.svg": "mods/orca-assets/chevron-right--orca-changes.svg",
  "mods/orca-changes/eye.svg": "mods/orca-assets/eye--orca-changes.svg",
  "mods/orca-changes/minus.svg": "mods/orca-assets/minus--orca-changes.svg",
  "mods/orca-changes/plus.svg": "mods/orca-assets/plus--orca-changes.svg"
});
function sharedAsset(path) {
  return SHARED_ASSET_PATHS[path] ?? `mods/orca-assets/${path.slice(path.lastIndexOf("/") + 1)}`;
}
