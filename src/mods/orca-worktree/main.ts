import {
  View,
  div,
  type AsyncContext,
  type Color,
  type Context,
  type FocusHandle,
  type NativeElement,
} from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar } from "gpui-base";
import {
  run,
  props,
  closeOverlay,
  theme,
  spaces,
  panes,
  agents,
  exec,
  home,
  type ExecResult,
} from "herdr";
import { themeColor } from "../../shared/theme-color.js";
import { removeWorktree, REMOVE_UNAVAILABLE } from "./remove.js";
import {
  ROOT,
  tilde,
  slug,
  ago,
  spaceOf,
  branchRows,
  switchBlocker,
  type BranchRow,
  type Checkout,
  type SpaceRef,
  type TabRef,
} from "./helpers.js";

const ACTION = { open: "open", switch: "switch", remove: "remove" } as const;
type Action = (typeof ACTION)[keyof typeof ACTION];

const KEY = { escape: "escape", enter: "enter", up: "up", down: "down" } as const;
const RUN = { spaceNew: "space.new", spaceSelect: "space.select" } as const;
const BRANCH_REF_ARGS = [
  "for-each-ref",
  "--format=%(refname:short)%09%(committerdate:unix)",
  "refs/heads",
];
const NO_FOLDER = "This folder";
const ELLIPSIS = "…";
const ESC_CLOSE = "esc close";
const NAV_HINT = "↑↓ choose · ";

type WorktreeProps = {
  overlay?: string;
  action?: Action;
  space?: string;
  folder?: string;
  machine?: string | null;
  branch?: string;
  tab?: string;
  argv?: string[];
};

type WorktreeTheme = {
  popover: Color;
  accent: Color;
  input: Color;
  background: Color;
  foreground: Color;
  dim: Color;
  selected: Color;
  hover: Color;
  muted: Color;
  blocked: Color;
};

type WorktreeRepo = { top: string; main: string; common: string; name: string; linked: boolean };
type WorktreeCheckout = Checkout & { main: boolean; at: number };
type SwitchRow = { branch: string; current?: boolean | null; held?: string | null };
type Identity = {
  spaceId: string | null;
  folder: string | null;
  spaceFolder: string | null;
  spaceMachine: string | null;
  on: string | null;
  active: string | null;
};
type WorktreeSpace = {
  id?: string;
  folder: string;
  machine: string | null;
  name: string;
  active?: boolean;
  tabs?: TabRef[];
};
type GitResult = { ok: boolean; out: string; err: string };

const INPUT_FOCUS_DELAY_MS = 100;

const WORKTREE_ADD_TIMEOUT_MS = 600_000;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  SPINNER_FRAME_MS = 90;

const PLACEHOLDER = new Map<Action | undefined, string>([
  [ACTION.open, "filter worktrees"],
  [ACTION.switch, "filter branches"],
]);

const dialogProps = (): WorktreeProps | null | undefined => props();

const worktreeTheme = (colors: Record<string, string>): WorktreeTheme => ({
  popover: themeColor(colors.popover),
  accent: themeColor(colors.accent),
  input: themeColor(colors.input),
  background: themeColor(colors.background),
  foreground: themeColor(colors.foreground),
  dim: themeColor(colors.dim),
  selected: themeColor(colors.selected),
  hover: themeColor(colors.hover),
  muted: themeColor(colors.muted),
  blocked: themeColor(colors.blocked),
});

const notARepo = (folder: string, userHome: string): string =>
  `${folder ? tilde(folder, userHome) : NO_FOLDER} is not in a git repository.`;

const isCheckout = (row: WorktreeCheckout | BranchRow | undefined): row is WorktreeCheckout =>
  row !== undefined && "path" in row;
const isBranchRow = (row: WorktreeCheckout | BranchRow | undefined): row is BranchRow =>
  row !== undefined && "held" in row;

export async function checkouts(
  repo: WorktreeRepo,
  on: string | null,
): Promise<WorktreeCheckout[]> {
  const list = await git(repo.main, ["worktree", "list", "--porcelain"], on);
  if (!list.ok) return [];
  const refs = await git(repo.main, BRANCH_REF_ARGS, on);
  const when = new Map<string, number>(
    refs.out
      .split("\n")
      .map((l) => l.split("\t"))
      .map(([b, at]): [string, number] => [b, Number(at) || 0]),
  );
  const out: WorktreeCheckout[] = [];
  for (const block of list.out.split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branch =
      lines
        .find((l) => l.startsWith("branch "))
        ?.slice(7)
        .replace(/^refs\/heads\//, "") ?? null;
    out.push({ path, branch, main: out.length === 0, at: branch ? (when.get(branch) ?? 0) : 0 });
  }
  return out.sort((a, b) => Number(b.main) - Number(a.main) || b.at - a.at);
}

async function git(
  cwd: string,
  args: string[],
  on: string | null,
  timeout?: number,
): Promise<GitResult> {
  const r = await exec("git", args, { cwd, on, ...(timeout === undefined ? {} : { timeout }) });
  return {
    ok: r.code === 0,
    out: (r.stdout ?? "").trim(),
    err: (r.stderr ?? r.stdout ?? "").trim(),
  };
}

async function remoteHome(on: string): Promise<string> {
  let result: ExecResult | undefined;

  try {
    result = await exec("sh", ["-c", 'printf %s "$HOME"'], { on });
  } catch {}
  if (!result || result.code !== 0 || !result.stdout.trim())
    result = await exec("powershell.exe", ["-NoProfile", "-Command", "[Console]::Write($HOME)"], {
      on,
    });
  if (result.code !== 0 || !result.stdout.trim())
    throw new Error("Could not find the remote home folder.");
  return result.stdout.trim().replace(/\\/g, "/");
}

async function repoOf(folder: string, on: string | null): Promise<WorktreeRepo | null> {
  const top = await git(folder, ["rev-parse", "--show-toplevel"], on);
  const common = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on);
  if (!top.ok || !common.ok) return null;
  const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
  return {
    top: top.out,
    main,
    common: common.out,
    name: main.split("/").pop() ?? "",
    linked: main !== top.out,
  };
}

export default class Worktree extends View {
  initialIdentity!: Identity;
  on!: string | null;
  userHome!: string | null;
  opening!: boolean;
  switching!: boolean;
  text!: string;
  list?: WorktreeCheckout[];
  branches?: BranchRow[];
  current!: string | null;
  blocker!: string;
  at!: number;
  input!: InputState;
  inputFocused!: boolean;
  handle!: FocusHandle;
  busy!: boolean;
  error!: string;
  repo?: WorktreeRepo | null;
  folder!: string;

  init(_props: unknown, cx: AsyncContext): void {
    this.initialIdentity = this.identity();
    this.on = this.initialIdentity.on;
    this.userHome = this.on ? null : home();
    this.opening = dialogProps()?.action === ACTION.open;

    this.switching = dialogProps()?.action === ACTION.switch;
    this.text = dialogProps()?.branch ?? "";
    this.list = undefined;
    this.branches = undefined;
    this.current = null;
    this.blocker = "";
    this.at = 0;
    this.input = InputState.new({
      value: this.text,
      placeholder: PLACEHOLDER.get(dialogProps()?.action) ?? "branch name",
    });
    this.input.on("change", (_e, eventCx) => {
      this.text = this.input.value();
      this.error = "";
      this.at = 0;
      eventCx.notify();
    });
    this.input.on("submit", (_e, eventCx) => this.go(eventCx));
    this.inputFocused = true;
    this.input.on("focus", (_e, eventCx) => {
      this.inputFocused = true;
      eventCx.notify();
    });
    this.input.on("blur", (_e, eventCx) => {
      this.inputFocused = false;
      eventCx.notify();
    });
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (dialogProps()?.action !== ACTION.remove) this.input.focus();
    this.busy = false;
    this.error = "";
    this.repo = undefined;
    cx.spawn((taskCx) => this.load(taskCx));
  }

  async load(cx: Context): Promise<void> {
    try {
      if (this.on) this.userHome = await remoteHome(this.on);
      this.folder = (this.initialIdentity.folder || this.userHome) as string;
      await this.loadRepo();
      cx.notify();

      this.handle.focus();
      const p = dialogProps() ?? {};
      if (p.action !== ACTION.remove)
        cx.timer.after(INPUT_FOCUS_DELAY_MS, () => this.input.focus());
      if (p.branch) await this.work(cx);
    } catch (error) {
      this.repo = null;
      this.error = String(error);
      cx.notify();
    }
  }

  async loadRepo(): Promise<void> {
    const repo = await repoOf(this.folder, this.on);
    if (repo && (this.opening || this.switching)) this.list = await checkouts(repo, this.on);

    if (repo && this.switching) await this.loadBranches(repo);
    this.repo = repo;
  }

  space(): WorktreeSpace | undefined {
    const p = dialogProps() ?? {};
    return (
      spaces().find((s) => s.id === p.space) ??
      (p.folder ? { folder: p.folder, machine: p.machine ?? null, name: "" } : undefined)
    );
  }

  identity(): Identity {
    const p = dialogProps() ?? {},
      all = spaces(),
      s = p.space ? all.find((item) => item.id === p.space) : null;
    const space = { folder: s?.folder ?? null, machine: s?.machine ?? null };
    return {
      spaceId: p.space ?? null,
      folder: p.folder ?? space.folder,
      spaceFolder: space.folder,
      spaceMachine: space.machine,
      on: p.machine ?? space.machine,
      active: all.find((item) => item.active)?.id ?? null,
    };
  }

  close(): void {
    closeOverlay(props().overlay);
  }

  go(cx: Context): void {
    if (this.busy || !this.repo || dialogProps()?.action === ACTION.remove) return;

    if (this.switching) return this.act(this.visible()[this.at], cx);
    cx.spawn((taskCx) => this.work(taskCx));
  }

  async work(cx: Context): Promise<void> {
    if (this.busy || !this.repo) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    try {
      this.error = props().action === ACTION.remove ? await this.remove() : await this.create();
    } catch (error) {
      this.error = String(error);
    }
    this.busy = false;
    if (!this.error) this.close();
    cx.notify();
  }

  async create(): Promise<string> {
    const branch = this.text.trim();
    if (!branch) return "Type a branch name.";

    if (branch.startsWith("-")) return "Branch names cannot start with -.";
    if (!slug(branch)) return "Branch name must contain a letter or number.";
    const path = `${ROOT(this.userHome!)}/${this.repo!.name}/${slug(branch)}`;
    const exists = (
      await git(
        this.repo!.main,
        ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
        this.on,
      )
    ).ok;
    const add = exists
      ? ["worktree", "add", path, branch]
      : ["worktree", "add", "-b", branch, path, "HEAD"];
    const r = await git(this.repo!.top, add, this.on, WORKTREE_ADD_TIMEOUT_MS);
    if (!r.ok) return r.err || "git worktree add failed.";
    const p = props();

    run(RUN.spaceNew, { folder: path, machine: this.on ?? "", tab: p.tab, argv: p.argv });
    return "";
  }

  shown(): WorktreeCheckout[] {
    const f = this.text.trim().toLowerCase();
    return (this.list ?? []).filter(
      (c) => !f || `${c.branch ?? ""} ${c.path}`.toLowerCase().includes(f),
    );
  }

  branchList(): BranchRow[] {
    const f = this.text.trim().toLowerCase();
    return (this.branches ?? []).filter((b) => !f || b.branch.toLowerCase().includes(f));
  }

  visible(): WorktreeCheckout[] | BranchRow[] {
    if (this.opening) return this.shown();
    return this.switching ? this.branchList() : [];
  }

  act(row: WorktreeCheckout | BranchRow | undefined, cx: Context): void {
    if (this.opening) {
      if (isCheckout(row)) this.open(row);
    } else if (this.switching && isBranchRow(row)) void this.switchTo(row, cx);
  }

  async loadBranches(repo: { main: string }): Promise<void> {
    const head = await git(this.folder, ["symbolic-ref", "--quiet", "--short", "HEAD"], this.on);
    const refs = await git(repo.main, BRANCH_REF_ARGS, this.on);
    const list =
      refs.ok && refs.out
        ? refs.out
            .split("\n")
            .map((line) => line.split("\t"))
            .map(([branch, at]) => ({ branch, at: Number(at) || 0 }))
        : [];
    this.current = head.ok ? head.out : null;
    this.branches = branchRows(list, this.list ?? [], this.current);
    this.blocker = await this.blockerNow();
  }

  async blockerNow(): Promise<string> {
    const status = await git(this.folder, ["status", "--porcelain"], this.on);
    const tabs = new Set((this.space()?.tabs ?? []).map((tab) => tab.id));
    const agentWorking = agents().some(
      (a) => tabs.has(a.tab) && (a.status === "working" || a.status === "blocked"),
    );
    const dirtyCount = status.ok ? status.out.split("\n").filter(Boolean).length : 0;
    return switchBlocker({ agentWorking, statusKnown: status.ok, dirtyCount });
  }

  async switchTo(row: SwitchRow | undefined, cx: Context): Promise<void> {
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

  open(c: Checkout | undefined): void {
    if (!c) return;
    this.close();
    const s = spaceOf(c.path, this.list!, this.on, spaces(), panes());
    if (s) run(RUN.spaceSelect, { id: s.id });
    else run(RUN.spaceNew, { folder: c.path, machine: this.on ?? "" });
  }

  async remove(): Promise<never> {
    return removeWorktree();
  }

  key(e: { key: string }, cx: Context): void {
    if (e.key === KEY.escape) return this.close();
    if (this.opening || this.switching) {
      const rows = this.visible();
      const n = rows.length;
      if (e.key === KEY.enter) this.act(rows[this.at], cx);
      else if ((e.key === KEY.down || e.key === KEY.up) && n)
        this.at = (this.at + (e.key === KEY.down ? 1 : n - 1)) % n;
      else return;
      cx.stop_propagation();
      return cx.notify();
    }
    if (e.key === KEY.enter && dialogProps()?.action === ACTION.remove) return this.go(cx);
  }

  dialogFrame(t: WorktreeTheme): NativeElement {
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

  filterInput(t: WorktreeTheme): NativeElement {
    return Input.new(this.input)
      .h(32)
      .px(10)
      .items_center()
      .rounded(6)
      .border(1)
      .border_color(this.inputFocused ? t.accent : t.input)
      .bg(t.background)
      .text_color(t.foreground);
  }

  footerRow(t: WorktreeTheme, busy: boolean, text: string): NativeElement {
    return h_flex()
      .justify_end()
      .text_size(11)
      .text_color(t.dim)
      .gap(6)
      .when(busy, (el) => el.child(div().frames(SPINNER_FRAMES, SPINNER_FRAME_MS)))
      .child(text);
  }

  rowList<T>(
    t: WorktreeTheme,
    id: string,
    rows: T[],
    row: (row: T, i: number) => NativeElement,
    emptyText: string,
  ): NativeElement {
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
          .when(rows.length === 0, (el) =>
            el.child(div().p(10).text_color(t.dim).child(emptyText)),
          ),
      )
      .child(Scrollbar.vertical(id).absolute().inset_0());
  }

  openRow(
    t: WorktreeTheme,
    c: WorktreeCheckout,
    i: number,
    there: SpaceRef | undefined,
  ): NativeElement {
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
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .text_color(t.foreground)
              .child(c.branch ?? "detached"),
          )
          .when(c.main, (el) =>
            el.child(div().flex_none().text_size(11).text_color(t.dim).child("main checkout")),
          )
          .when(Boolean(there), (el) =>
            el.child(div().flex_none().text_size(11).text_color(t.accent).child("open")),
          )
          .when(!there && c.at > 0, (el) =>
            el.child(div().flex_none().text_size(11).text_color(t.dim).child(ago(c.at))),
          ),
      )
      .child(
        div()
          .truncate()
          .text_size(11.5)
          .text_color(t.dim)
          .child(tilde(c.path, this.userHome ?? "")),
      );
  }

  renderOpen(t: WorktreeTheme): NativeElement {
    const r = this.repo;
    const rows = this.shown();
    const all = this.list ?? [];
    const spaceList = spaces();
    const paneList = panes();
    const row = (c: WorktreeCheckout, i: number) =>
      this.openRow(t, c, i, spaceOf(c.path, all, this.on, spaceList, paneList));
    const count =
      rows.length === all.length
        ? `${all.length} checkouts`
        : `${rows.length}/${all.length} checkouts`;
    return this.dialogFrame(t)
      .child(
        h_flex()
          .child(
            div()
              .flex_1()
              .font_semibold()
              .text_color(t.foreground)
              .child(`Open worktree${r ? ` of ${r.name}` : ""}`),
          )
          .child(
            div()
              .text_size(11)
              .text_color(t.dim)
              .child(r ? count : ""),
          ),
      )
      .when(r === undefined || (r && this.list === undefined), (el) =>
        el.child(div().text_color(t.muted).child(ELLIPSIS)),
      )
      .when(r === null, (el) =>
        el.child(
          div()
            .text_color(t.muted)
            .child(notARepo(this.folder, this.userHome ?? "")),
        ),
      )
      .when(Boolean(r && this.list), (el) =>
        el
          .child(this.filterInput(t))
          .child(this.rowList(t, "wt-list", rows, row, "No matching worktrees.")),
      )
      .child(
        h_flex()
          .justify_end()
          .text_size(11)
          .text_color(t.dim)
          .child(`${NAV_HINT}↵ open · ${ESC_CLOSE}`),
      );
  }

  branchTag(b: { current?: boolean | null; held?: string | null }): string {
    if (b.current) return "current";
    return b.held ? `in ${b.held.split("/").pop()}` : "";
  }

  switchRow(t: WorktreeTheme, b: BranchRow, i: number): NativeElement {
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
      .child(
        div()
          .flex_none()
          .text_size(11)
          .text_color(b.current ? t.accent : t.dim)
          .child(this.branchTag(b)),
      );
  }

  switchDetail(r: WorktreeRepo | null | undefined): string {
    if (r === undefined) return ELLIPSIS;
    if (r === null) return notARepo(this.folder, this.userHome!);
    return (
      this.blocker || `Moves ${tilde(this.folder, this.userHome ?? "")} to the branch you pick.`
    );
  }

  branchesLoading(r: WorktreeRepo | null | undefined): boolean {
    return r === undefined || Boolean(r && this.branches === undefined);
  }

  switchTarget(r: WorktreeRepo | null | undefined): string {
    return this.space()?.name || r?.name || "this checkout";
  }

  switchFooterText(): string {
    if (this.busy) return `switching${ELLIPSIS}`;
    return this.blocker ? ESC_CLOSE : `${NAV_HINT}↵ checkout · ${ESC_CLOSE}`;
  }

  renderSwitch(t: WorktreeTheme): NativeElement {
    const r = this.repo;
    const rows = this.blocker ? [] : this.branchList();
    const all = this.branches ?? [];
    const count =
      rows.length === all.length
        ? `${all.length} branches`
        : `${rows.length}/${all.length} branches`;
    const row = (b: BranchRow, i: number) => this.switchRow(t, b, i);
    const name = this.switchTarget(r);
    const detail = this.switchDetail(r);
    return this.dialogFrame(t)
      .child(
        h_flex()
          .child(
            div()
              .flex_1()
              .font_semibold()
              .text_color(t.foreground)
              .child(`Checkout branch in ${name}`),
          )
          .child(
            div()
              .text_size(11)
              .text_color(t.dim)
              .child(this.blocker ? "" : count),
          ),
      )
      .when(this.branchesLoading(r), (el) => el.child(div().text_color(t.muted).child(ELLIPSIS)))
      .when(Boolean(r) && this.branches !== undefined, (el) =>
        el.child(
          div()
            .text_color(this.blocker ? t.blocked : t.muted)
            .child(detail),
        ),
      )
      .when(Boolean(r && this.branches && !this.blocker), (el) =>
        el
          .child(this.filterInput(t))
          .child(this.rowList(t, "br-list", rows, row, "No matching branches.")),
      )
      .when(Boolean(this.error) && this.error !== this.blocker, (el) =>
        el.child(div().text_color(t.blocked).child(this.error)),
      )
      .child(div().flex_1())
      .child(this.footerRow(t, this.busy, this.switchFooterText()));
  }

  newDetail(remove: boolean, r: WorktreeRepo | null | undefined): string {
    if (remove) return REMOVE_UNAVAILABLE;
    if (r === undefined) return ELLIPSIS;
    if (r === null) return notARepo(this.folder, this.userHome!);
    return `A new space on a checkout in ${tilde(ROOT(this.userHome!), this.userHome!)}/${r.name}/. A branch that exists is checked out; a new one starts from here.`;
  }

  newFooterText(remove: boolean, blocked: boolean): string {
    if (this.busy) return "working…";
    if (blocked) return ESC_CLOSE;
    return remove ? "↵ remove · esc cancel" : "↵ create · esc cancel";
  }

  render(_cx: Context): NativeElement {
    const t = worktreeTheme(theme());
    if (this.opening) return this.renderOpen(t);
    if (this.switching) return this.renderSwitch(t);
    const remove = dialogProps()?.action === ACTION.remove;
    const s = this.space();
    const r = this.repo;
    const title = remove
      ? `Remove worktree ${s?.name ?? ""}?`
      : `New worktree${r ? ` of ${r.name}` : ""}`;
    const detail = this.newDetail(remove, r);
    const blocked = !r || remove;
    return this.dialogFrame(t)
      .child(div().font_semibold().text_color(t.foreground).child(title))
      .child(div().text_color(t.muted).child(detail))
      .when(!remove && !blocked, (el) => el.child(this.filterInput(t)))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(this.footerRow(t, this.busy, this.newFooterText(remove, blocked)));
  }
}
