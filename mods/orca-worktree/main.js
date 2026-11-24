// Worktree dialog: { space, action: "new" | "open" | "remove" } or
// { folder, machine } for a repo without a space; optional { branch, tab, argv }.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar } from "gpui-base";
import { run, props, closeOverlay, theme, spaces, panes, agents, exec, home } from "herdr";
import { removeWorktree, REMOVE_UNAVAILABLE } from "./remove.js";
import { ROOT, tilde, slug, ago, spaceOf, branchRows, switchBlocker } from "./helpers.js";

// Pause before the filter input takes focus once the list has mounted.
const INPUT_FOCUS_DELAY_MS = 100;
// `git worktree add` can copy a large checkout.
const WORKTREE_ADD_TIMEOUT_MS = 600_000;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], SPINNER_FRAME_MS = 90;
// Dialog action -> where the filter input's placeholder text comes from.
const PLACEHOLDER = new Map([["open", "filter worktrees"], ["switch", "filter branches"]]);

// Every checkout of a repo (`git worktree list`), the main one first, then
// the most recently committed: { path, branch, main, at }.
async function checkouts(repo, on) {
  const list = await git(repo.main, ["worktree", "list", "--porcelain"], on);
  if (!list.ok) return [];
  const refs = await git(repo.main, ["for-each-ref", "--format=%(refname:short)%09%(committerdate:unix)", "refs/heads"], on);
  const when = new Map(refs.out.split("\n").map((l) => l.split("\t")).map(([b, at]) => [b, Number(at) || 0]));
  const out = [];
  for (const block of list.out.split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    out.push({ path, branch, main: out.length === 0, at: branch ? (when.get(branch) ?? 0) : 0 });
  }
  return out.sort((a, b) => b.main - a.main || b.at - a.at);
}

async function git(cwd, args, on, timeout) {
  const r = await exec("git", args, { cwd, on, ...(timeout === undefined ? {} : { timeout }) });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? r.stdout ?? "").trim() };
}

// The home folder on a remote host: `sh` first, PowerShell when the host has none.
async function remoteHome(on) {
  let result;
  // A host without `sh` throws here; the PowerShell fallback below reports the real failure.
  try { result = await exec("sh", ["-c", 'printf %s "$HOME"'], { on }); } catch {}
  if (!result || result.code !== 0 || !result.stdout.trim()) result = await exec("powershell.exe", ["-NoProfile", "-Command", "[Console]::Write($HOME)"], { on });
  if (result.code !== 0 || !result.stdout.trim()) throw new Error("Could not find the remote home folder.");
  return result.stdout.trim().replace(/\\/g, "/");
}

// The repo a folder belongs to: its main checkout and name, and whether
// the folder is itself a linked worktree. null outside git.
async function repoOf(folder, on) {
  const top = await git(folder, ["rev-parse", "--show-toplevel"], on);
  const common = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on);
  if (!top.ok || !common.ok) return null;
  const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
  return { top: top.out, main, common: common.out, name: main.split("/").pop(), linked: main !== top.out };
}

export default class Worktree extends View {
  init(_props, cx) {
    this.initialIdentity = this.identity();
    this.on = this.initialIdentity.on;
    this.userHome = this.on ? null : home();
    this.opening = props()?.action === "open";
    // Orca switches branches in place from its source control (`WorkspaceBranchPicker`); Herdr has
    // no source control panel, so the card menu opens this dialog for that one checkout.
    this.switching = props()?.action === "switch";
    this.text = props()?.branch ?? "";
    this.list = undefined; // open and switch: the checkouts, once read
    this.branches = undefined; // switch: the local branches, once read
    this.current = null; // switch: the branch HEAD is on
    this.blocker = ""; // switch: why Git must not be asked to switch
    this.at = 0;
    this.input = InputState.new({ value: this.text, placeholder: PLACEHOLDER.get(props()?.action) ?? "branch name" });
    this.input.on("change", (_e, eventCx) => { this.text = this.input.value(); this.error = ""; this.at = 0; eventCx.notify(); });
    this.input.on("submit", (_e, eventCx) => this.go(eventCx));
    this.inputFocused = true;
    this.input.on("focus", (_e, eventCx) => { this.inputFocused = true; eventCx.notify(); });
    this.input.on("blur", (_e, eventCx) => { this.inputFocused = false; eventCx.notify(); });
    this.handle = cx.focus_handle();
    this.handle.focus(); // the root is mounted from the first frame: keep the keyboard here while loading
    if (props()?.action !== "remove") this.input.focus();
    this.busy = false;
    this.error = "";
    this.repo = undefined; // undefined: looking, null: not in git
    cx.spawn((taskCx) => this.load(taskCx));
  }

  async load(cx) {
    try {
      if (this.on) this.userHome = await remoteHome(this.on);
      this.folder = this.initialIdentity.folder || this.userHome;
      await this.loadRepo();
      cx.notify();
      // The list (and with it the filter input) only mounts once loading is
      // done, so the keyboard must move there now — a focus call made while
      // loading lands on nothing and the dialog stays keyboard-dead.
      this.handle.focus();
      const p = props() ?? {};
      if (p.action !== "remove") cx.timer.after(INPUT_FOCUS_DELAY_MS, () => this.input.focus());
      if (p.branch) await this.work(cx);
    } catch (error) { this.repo = null; this.error = String(error); cx.notify(); }
  }

  // The repo is set last: Enter does nothing until the warnings it consents to are known.
  async loadRepo() {
    const repo = await repoOf(this.folder, this.on);
    if (repo && (this.opening || this.switching)) this.list = await checkouts(repo, this.on);
    // Read before `this.repo` lands, so the first frame that can draw the list knows the blocker.
    if (repo && this.switching) await this.loadBranches(repo);
    this.repo = repo;
  }

  space() {
    const p = props() ?? {};
    return spaces().find((s) => s.id === p.space) ?? (p.folder ? { folder: p.folder, machine: p.machine ?? null, name: "" } : undefined);
  }

  identity() {
    const p = props() ?? {}, all = spaces(), s = p.space ? all.find((item) => item.id === p.space) : null;
    const space = { folder: s?.folder ?? null, machine: s?.machine ?? null };
    return { spaceId: p.space ?? null, folder: p.folder ?? space.folder, spaceFolder: space.folder,
      spaceMachine: space.machine, on: p.machine ?? space.machine, active: all.find((item) => item.active)?.id ?? null };
  }

  close() {
    closeOverlay(props().overlay);
  }

  go(cx) {
    if (this.busy || !this.repo || props()?.action === "remove") return;
    // Enter takes the highlighted branch; in this mode the input only filters, it names nothing new.
    if (this.switching) return this.act(this.visible()[this.at], cx);
    cx.spawn((taskCx) => this.work(taskCx));
  }

  async work(cx) {
    if (this.busy || !this.repo) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    try { this.error = props().action === "remove" ? await this.remove() : await this.create(); }
    catch (error) { this.error = String(error); }
    this.busy = false;
    if (!this.error) this.close();
    cx.notify();
  }

  async create() {
    const branch = this.text.trim();
    if (!branch) return "Type a branch name.";
    // `git worktree add -b <name>` would read a leading dash as another option, and a name
    // that slugs to nothing would put the checkout at the repo folder itself.
    if (branch.startsWith("-")) return "Branch names cannot start with -.";
    if (!slug(branch)) return "Branch name must contain a letter or number.";
    const path = `${ROOT(this.userHome)}/${this.repo.name}/${slug(branch)}`;
    const exists = (await git(this.repo.main, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], this.on)).ok;
    const add = exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, "HEAD"];
    const r = await git(this.repo.top, add, this.on, WORKTREE_ADD_TIMEOUT_MS);
    if (!r.ok) return r.err || "git worktree add failed.";
    const p = props();
    // Leave spaces unnamed so they follow the checkout folder and nest under the repo.
    run("space.new", { folder: path, machine: this.on ?? "", tab: p.tab, argv: p.argv });
    return "";
  }

  shown() {
    const f = this.text.trim().toLowerCase();
    return (this.list ?? []).filter((c) => !f || `${c.branch ?? ""} ${c.path}`.toLowerCase().includes(f));
  }

  branchList() {
    const f = this.text.trim().toLowerCase();
    return (this.branches ?? []).filter((b) => !f || b.branch.toLowerCase().includes(f));
  }

  // The mode's rows: checkouts to open, or branches to switch to.
  visible() {
    if (this.opening) return this.shown();
    return this.switching ? this.branchList() : [];
  }

  act(row, cx) {
    if (this.opening) this.open(row);
    else if (this.switching) void this.switchTo(row, cx);
  }

  // Every branch this checkout could move to, plus whether Git may be asked right now. Read when
  // the dialog opens so its rows can say which branch is current and which another worktree holds.
  async loadBranches(repo) {
    const head = await git(this.folder, ["symbolic-ref", "--quiet", "--short", "HEAD"], this.on);
    const refs = await git(repo.main, ["for-each-ref", "--format=%(refname:short)%09%(committerdate:unix)", "refs/heads"], this.on);
    const list = refs.ok && refs.out
      ? refs.out.split("\n").map((line) => line.split("\t")).map(([branch, at]) => ({ branch, at: Number(at) || 0 }))
      : [];
    this.current = head.ok ? head.out : null;
    this.branches = branchRows(list, this.list ?? [], this.current);
    this.blocker = await this.blockerNow();
  }

  // Read again on every attempt: a turn can start, or a file can change, while the dialog is open
  // (`WorkspaceBranchPicker`: "the host re-checks on switch").
  async blockerNow() {
    const status = await git(this.folder, ["status", "--porcelain"], this.on);
    const tabs = new Set((this.space()?.tabs ?? []).map((tab) => tab.id));
    const agentWorking = agents().some((a) => tabs.has(a.tab) && (a.status === "working" || a.status === "blocked"));
    const dirtyCount = status.ok ? status.out.split("\n").filter(Boolean).length : 0;
    return switchBlocker({ agentWorking, statusKnown: status.ok, dirtyCount });
  }

  async switchTo(row, cx) {
    if (!row || row.current || row.held || this.busy) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    const blocker = await this.blockerNow();
    if (blocker) {
      this.busy = false;
      this.blocker = this.error = blocker;
      cx.notify();
      return;
    }
    const r = await git(this.folder, ["switch", row.branch], this.on);
    this.busy = false;
    if (!r.ok) this.error = r.err || "git switch failed.";
    else this.close();
    cx.notify();
  }

  open(c) {
    if (!c) return;
    this.close();
    const s = spaceOf(c.path, this.list, this.on, spaces(), panes());
    if (s) run("space.select", { id: s.id });
    else run("space.new", { folder: c.path, machine: this.on ?? "" });
  }

  async remove() {
    await removeWorktree();
  }

  key(e, cx) {
    if (e.key === "escape") return this.close();
    if (this.opening || this.switching) {
      const rows = this.visible();
      const n = rows.length;
      if (e.key === "enter") this.act(rows[this.at], cx);
      else if ((e.key === "down" || e.key === "up") && n) this.at = (this.at + (e.key === "down" ? 1 : n - 1)) % n;
      else return;
      cx.stop_propagation();
      return cx.notify();
    }
    if (e.key === "enter" && props()?.action === "remove") return this.go(cx);
  }

  // The frame every mode of the dialog draws into.
  dialogFrame(t) {
    return v_flex()
      .id("worktree")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13);
  }

  filterInput(t) {
    return Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1).border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_color(t.foreground);
  }

  // The scrolling rows under the filter input, with the list's own scrollbar.
  rowList(t, id, rows, row, emptyText) {
    return div()
      .relative()
      .flex_1()
      .min_h(0)
      .child(
        v_flex()
          .id(id)
          .size_full()
          .overflow_y_scroll()
          .children(rows.map(row))
          .when(rows.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child(emptyText))),
      )
      .child(Scrollbar.vertical(id).absolute().inset_0());
  }

  openRow(t, c, i, there) {
    const on = i === this.at;
    return v_flex()
      .id(`wt-${i}`)
      .flex_none()
      .h(44)
      .px(10)
      .justify_center()
      .rounded(7)
      .cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => this.open(c))
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.branch ?? "detached"))
          .when(c.main, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("main checkout")))
          .when(Boolean(there), (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child("open")))
          .when(!there && c.at > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ago(c.at)))),
      )
      .child(div().truncate().text_size(11.5).text_color(t.dim).child(tilde(c.path, this.userHome ?? "")));
  }

  renderOpen(t) {
    const r = this.repo;
    const rows = this.shown();
    const all = this.list ?? [];
    const spaceList = spaces();
    const paneList = panes();
    const row = (c, i) => this.openRow(t, c, i, spaceOf(c.path, all, this.on, spaceList, paneList));
    const count = rows.length === all.length ? `${all.length} checkouts` : `${rows.length}/${all.length} checkouts`;
    return this.dialogFrame(t)
      .child(h_flex().child(div().flex_1().font_semibold().text_color(t.foreground).child(`Open worktree${r ? ` of ${r.name}` : ""}`)).child(div().text_size(11).text_color(t.dim).child(r ? count : "")))
      .when(r === undefined || (r && this.list === undefined), (el) => el.child(div().text_color(t.muted).child("\u2026")))
      .when(r === null, (el) => el.child(div().text_color(t.muted).child(`${this.folder ? tilde(this.folder, this.userHome ?? "") : "This folder"} is not in a git repository.`)))
      .when(Boolean(r && this.list), (el) =>
        el
          .child(this.filterInput(t))
          .child(this.rowList(t, "wt-list", rows, row, "No matching worktrees.")),
      )
      .child(h_flex().justify_end().text_size(11).text_color(t.dim).child("\u2191\u2193 choose \u00b7 \u21b5 open \u00b7 esc close"));
  }

  // What the right-hand tag of a branch row says.
  branchTag(b) {
    if (b.current) return "current";
    return b.held ? `in ${b.held.split("/").pop()}` : "";
  }

  switchRow(t, b, i) {
    const on = i === this.at && !this.blocker;
    const disabled = b.current || Boolean(b.held);
    return h_flex()
      .id(`br-${i}`)
      .flex_none()
      .h(32)
      .px(10)
      .gap(8)
      .items_center()
      .rounded(7)
      .when(on && !disabled, (el) => el.bg(t.selected))
      .when(!on && !disabled, (el) => el.hover((s) => s.bg(t.hover)))
      .when(disabled, (el) => el.opacity(0.45))
      .when(!disabled, (el) => el.cursor_pointer().on_click((_e, cx) => void this.switchTo(b, cx)))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(b.branch))
      .child(div().flex_none().text_size(11).text_color(b.current ? t.accent : t.dim).child(this.branchTag(b)));
  }

  // The line under the title of the switch dialog: loading, not a repo, the blocker, or what the switch does.
  switchDetail(r) {
    if (r === undefined) return "\u2026";
    if (r === null) return `${this.folder ? tilde(this.folder, this.userHome) : "This folder"} is not in a git repository.`;
    return this.blocker || `Moves ${tilde(this.folder, this.userHome ?? "")} to the branch you pick.`;
  }

  // Checked before the branches are read, for the "…" placeholder.
  branchesLoading(r) {
    return r === undefined || (r && this.branches === undefined);
  }

  // The space's name, else the repo's.
  switchTarget(r) {
    return this.space()?.name || r?.name || "this checkout";
  }

  switchFooterText() {
    if (this.busy) return "switching\u2026";
    return this.blocker ? "esc close" : "\u2191\u2193 choose \u00b7 \u21b5 checkout \u00b7 esc close";
  }

  // A checkout, not a new worktree: this moves HEAD in the folder the space already has, which is
  // why the agent and uncommitted-change blockers come before the list (Orca's picker order).
  renderSwitch(t) {
    const r = this.repo;
    const rows = this.blocker ? [] : this.branchList();
    const all = this.branches ?? [];
    const count = rows.length === all.length ? `${all.length} branches` : `${rows.length}/${all.length} branches`;
    const row = (b, i) => this.switchRow(t, b, i);
    const name = this.switchTarget(r);
    const detail = this.switchDetail(r);
    return this.dialogFrame(t)
      .child(h_flex().child(div().flex_1().font_semibold().text_color(t.foreground).child(`Checkout branch in ${name}`)).child(div().text_size(11).text_color(t.dim).child(this.blocker ? "" : count)))
      .when(this.branchesLoading(r), (el) => el.child(div().text_color(t.muted).child("\u2026")))
      .when(Boolean(r) && this.branches !== undefined, (el) => el.child(div().text_color(this.blocker ? t.blocked : t.muted).child(detail)))
      .when(Boolean(r && this.branches && !this.blocker), (el) =>
        el
          .child(this.filterInput(t))
          .child(this.rowList(t, "br-list", rows, row, "No matching branches.")),
      )
      .when(Boolean(this.error) && this.error !== this.blocker, (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().justify_end().text_size(11).text_color(t.dim).gap(6)
        .when(this.busy, (el) => el.child(div().frames(SPINNER_FRAMES, SPINNER_FRAME_MS)))
        .child(this.switchFooterText()));
  }

  // The line under the title of the new / remove dialog.
  newDetail(remove, r) {
    if (remove) return REMOVE_UNAVAILABLE;
    if (r === undefined) return "…";
    if (r === null) return `${this.folder ? tilde(this.folder, this.userHome) : "This folder"} is not in a git repository.`;
    return `A new space on a checkout in ${tilde(ROOT(this.userHome), this.userHome)}/${r.name}/. A branch that exists is checked out; a new one starts from here.`;
  }

  newFooterText(remove, blocked) {
    if (this.busy) return "working…";
    if (blocked) return "esc close";
    return remove ? "↵ remove · esc cancel" : "↵ create · esc cancel";
  }

  render(_cx) {
    const t = theme();
    if (this.opening) return this.renderOpen(t);
    if (this.switching) return this.renderSwitch(t);
    const remove = props()?.action === "remove";
    const s = this.space();
    const r = this.repo;
    const title = remove ? `Remove worktree ${s?.name ?? ""}?` : `New worktree${r ? ` of ${r.name}` : ""}`;
    const detail = this.newDetail(remove, r);
    const blocked = !r || remove;
    return this.dialogFrame(t)
      .child(div().font_semibold().text_color(t.foreground).child(title))
      .child(div().text_color(t.muted).child(detail))
      .when(!remove && !blocked, (el) => el.child(this.filterInput(t)))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(
        h_flex()
          .justify_end()
          .text_size(11)
          .text_color(t.dim)
          .gap(6)
          .when(this.busy, (el) => el.child(div().frames(SPINNER_FRAMES, SPINNER_FRAME_MS)))
          .child(this.newFooterText(remove, blocked)),
      );
  }
}
