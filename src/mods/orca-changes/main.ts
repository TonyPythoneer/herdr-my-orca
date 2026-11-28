import {
  View,
  div,
  svg,
  type ClickEvent,
  type Color,
  type KeyEvent,
  type Context,
  type FocusHandle,
  type NativeElement,
  type Window as GpuiWindow,
} from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, Input, InputState } from "gpui-base";
import {
  spaces,
  exec,
  watchFolder,
  theme,
  focused,
  panes,
  shared,
  setShared,
  window as herdrWindow,
  run,
  props,
  openOverlay,
  closeOverlay,
  nextCommand,
  type ExecResult,
} from "herdr";
import { copyText, reveal } from "../../shared/clip.js";
import { commitAndPush } from "./commit-push.js";
import { prepareCreatePr, createPr, type PrSnapshot, type Run } from "./create-pr.js";
import { sameOperationTarget, type OperationTarget } from "./operation-target.js";
import { GIT_OPTIONS as READ, chunkPaths as chunks } from "./git-options.js";
import { assertDiscardUnchanged, discardSnapshot } from "./discard-snapshot.js";
import {
  displayPushDestination,
  forcePushConfirmed,
  forcePushTarget,
  pushConfigured,
  type ForcePushTarget,
} from "./push-target.js";
import { panelFrame } from "../../components/right-sidebar/panel-motion.js";
import { DialogButton } from "../../primitives/dialog-button.js";
import { themeColor } from "../../shared/theme-color.js";

type Palette = Record<string, string | boolean>;
type Section = "conflicts" | "changes" | "staged";
type Resolution = "mark_resolved" | "keep_file" | "keep_deletion";
type Stats = { add: number; del: number; binary?: boolean };

export type Entry = {
  path: string;
  section: Section;
  status: string;
  fresh: boolean;
  add: number;
  del: number;
  binary?: boolean;
  xy?: string;
};

export type EntryLike = Partial<Entry> & {
  all?: boolean;
  sectionAll?: boolean;
  paths?: string[];
  limited?: boolean;
};

type ChangesProps = {
  tab?: string;
  entry?: Entry;
  target?: OperationTarget;
  overlay?: string;
};

type Action = {
  kind: "commit" | "stage";
  label: string;
  disabled: boolean;
  reason: string | null;
};

type OpenTarget = { path: string; section: Section };

type Captured = OperationTarget & { root: string | null };

let mainChangesView: Changes | null = null;

function location() {
  const space = (spaces() ?? []).find((s) => s.active);
  return { cwd: space?.folder ?? null, on: space?.machine ?? null, space: space?.id };
}
const key = (): string => JSON.stringify(location());

const hostProps = (): ChangesProps | undefined => props();

export function relPath(from: string, to: string): string {
  const a = from.replace(/\/+$/, "").split("/"),
    b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/");
}

export function conflictResolutions(xy: string | undefined): Resolution[] {
  if (xy === "DD") return ["keep_deletion"];
  if (xy === "DU" || xy === "UD") return ["keep_file", "keep_deletion"];
  return ["mark_resolved"];
}

const isKeepDeletion = (resolution: Resolution): boolean => resolution === "keep_deletion";

const RESOLUTION: Record<Resolution, [string, string]> = {
  mark_resolved: ["check.svg", "Mark as resolved"],
  keep_file: ["file-check.svg", "Keep file"],
  keep_deletion: ["file-x.svg", "Keep deletion"],
};

export function gitTone(mark: string, t: Palette): Color {
  switch (mark) {
    case "A":
      return "#81b88b";
    case "D":
      return "#c74e39";
    case "M":
      return "#e2c08d";
    case "R":
    case "U":
    case "C":
      return "#73c991";
    case "!":
      return "#808080";
    default:
      return themeColor(t.dim);
  }
}

const gitIn =
  (target: Captured) =>
  (args: string[]): Promise<ExecResult> =>
    exec("git", [...READ, ...args], { cwd: target.root as string, on: target.on });
const ghIn =
  (target: Captured) =>
  (args: string[]): Promise<ExecResult> =>
    exec("gh", args, { cwd: target.root as string, on: target.on });

const dialogShell = (t: Palette, width: number, title: string) =>
  v_flex()
    .w(width)
    .p(16)
    .gap(12)
    .rounded(8)
    .bg(themeColor(t.popover))
    .border_1()
    .border_color(themeColor(t.border))
    .child(div().text_size(13).font_weight(500).text_color(themeColor(t.foreground)).child(title));

const discardCancelButton = (t: Palette) =>
  DialogButton("discard-cancel", "Cancel", {
    t: { foreground: themeColor(t.foreground) },
    h: 24,
    size: 11,
    color: themeColor(t.muted),
    border: themeColor(t.border),
    hoverBg: themeColor(t.hover),
    onClick: () => {
      windowHandle().close_dialog();
    },
  });

const DISCARD_COPY = {
  delete: {
    title: (name: string) => `Delete "${name}"?`,
    text: "This will permanently delete this file. This cannot be undone.",
    label: "Delete",
  },
  restore: {
    title: (name: string) => `Restore "${name}"?`,
    text: "This will restore the last staged version and discard the deletion. This cannot be undone.",
    label: "Restore",
  },
  discard: {
    title: (name: string) => `Discard changes to "${name}"?`,
    text: "This will revert the unstaged changes to this file. This cannot be undone.",
    label: "Discard",
  },
};
const discardKind = (f: Entry): keyof typeof DISCARD_COPY => {
  if (f.fresh) return "delete";
  return f.status === "D" ? "restore" : "discard";
};

const absolutePath = (root: string | null | undefined, path: string): string =>
  root ? `${root.replace(/\/+$/, "")}/${path}` : path;

const windowValue = (): unknown => herdrWindow;
const windowHandle = (): GpuiWindow => windowValue() as GpuiWindow;

function platformRevealLabel(): string {
  const platform = typeof windowValue() === "function" ? herdrWindow()?.platform : null;
  if (platform === "macos") return "Reveal in Finder";
  return platform === "windows" ? "Reveal in File Explorer" : "Open Containing Folder";
}

const MAX_STATUS_ENTRIES = 1000;
const REFRESH_INTERVAL_MS = 10_000;

async function readNumstat(git: Run, args: string[]): Promise<Record<string, Stats>> {
  const r = await git(args);
  if (r.code !== 0) throw new Error(r.stderr);
  const stats: Record<string, Stats> = {};
  for (const entry of r.stdout.split("\0")) {
    const [a, d, ...parts] = entry.split("\t");
    if (!parts.length) continue;
    stats[parts.join("\t")] = { add: Number(a) || 0, del: Number(d) || 0, binary: a === "-" };
  }
  return stats;
}

const rowStatus = (letter: string): string => (letter === "A" || letter === "D" ? letter : "M");

function statusRows(
  entry: string,
  stagedStats: Record<string, Stats>,
  unstagedStats: Record<string, Stats>,
): Entry[] {
  const xy = entry.slice(0, 2),
    path = entry.slice(3);
  if (xy === "??") return [{ path, section: "changes", status: "U", fresh: true, add: 0, del: 0 }];
  if (xy.includes("U") || xy === "AA" || xy === "DD")
    return [{ path, section: "conflicts", status: "!", xy, fresh: false, add: 0, del: 0 }];
  const rows: Entry[] = [];
  if (xy[0] !== " " && xy[0] !== "?")
    rows.push({
      path,
      section: "staged",
      status: rowStatus(xy[0]),
      fresh: false,
      ...(stagedStats[path] ?? { add: 0, del: 0 }),
    });
  if (xy[1] !== " " && xy[1] !== "?")
    rows.push({
      path,
      section: "changes",
      status: rowStatus(xy[1]),
      fresh: false,
      ...(unstagedStats[path] ?? { add: 0, del: 0 }),
    });
  return rows;
}

type PrFields = { title: InputState; body: InputState; draft: { value: boolean } };

function createPrDialog(
  view: Changes,
  t: Palette,
  target: Captured,
  snapshot: PrSnapshot,
  fields: PrFields,
): NativeElement {
  const { title, body, draft } = fields;
  return dialogShell(t, 420, "Create Pull Request")
    .child(
      div()
        .text_size(11)
        .text_color(themeColor(t.muted))
        .child(
          `${snapshot.name} · ${snapshot.head} → ${snapshot.base}\nHost: ${target.on ?? "local"} · already-pushed branch`,
        ),
    )
    .child(
      Input.new(title)
        .h(30)
        .px(8)
        .border_1()
        .border_color(themeColor(t.input))
        .text_color(themeColor(t.foreground)),
    )
    .child(
      Input.new(body)
        .h(56)
        .px(8)
        .border_1()
        .border_color(themeColor(t.input))
        .text_color(themeColor(t.foreground)),
    )
    .child(draftToggle(t, draft))
    .child(createPrButtons(view, t, target, snapshot, fields));
}

function draftToggle(t: Palette, draft: { value: boolean }): NativeElement {
  return h_flex()
    .gap(6)
    .cursor_pointer()
    .on_click((_e, eventCx) => {
      draft.value = !draft.value;
      eventCx.notify();
    })
    .child(
      div()
        .size(14)
        .border_1()
        .border_color(themeColor(t.border))
        .bg(themeColor(draft.value ? t.accent : t.popover)),
    )
    .child(div().text_size(11).text_color(themeColor(t.muted)).child("Create as draft PR"));
}

function createPrButtons(
  view: Changes,
  t: Palette,
  target: Captured,
  snapshot: PrSnapshot,
  fields: PrFields,
): NativeElement {
  const { title, body, draft } = fields;
  return h_flex()
    .justify_end()
    .gap(8)
    .child(
      DialogButton("create-pr-cancel", "Cancel", {
        t: { foreground: themeColor(t.foreground) },
        h: null,
        px: 12,
        py: 5,
        rounded: null,
        color: themeColor(t.muted),
        onClick: () => windowHandle().close_dialog(),
      }),
    )
    .child(
      DialogButton("create-pr-confirm", "Create PR", {
        t: { foreground: themeColor(t.foreground) },
        h: null,
        px: 12,
        py: 5,
        rounded: 4,
        bg: themeColor(t.done),
        color: themeColor(t.canvas),
        onClick: (_e, eventCx) => {
          const text = title.value().trim();
          if (!text) return;
          windowHandle().close_dialog();
          view.submitCreatePr(
            target,
            snapshot,
            { title: text, body: body.value(), draft: draft.value },
            eventCx,
          );
        },
      }),
    );
}

function pathLabel(name: string, parts: string[], t: Palette): NativeElement {
  return h_flex()
    .flex_1()
    .min_w(0)
    .items_center()
    .child(div().flex_none().max_w(260).truncate().text_color(themeColor(t.foreground)).child(name))
    .when(parts.length > 0, (e) =>
      e.child(
        div()
          .ml(6)
          .flex_1()
          .min_w(0)
          .truncate()
          .text_size(11)
          .text_color(themeColor(t.muted))
          .child(parts.join("/")),
      ),
    );
}

function changeCounts(f: Entry, t: Palette): NativeElement {
  return h_flex()
    .flex_none()
    .gap(3)
    .when(f.add > 0, (x) =>
      x.child(
        div()
          .text_size(10)
          .text_color(themeColor(gitTone("A", t)))
          .child(`+${f.add}`),
      ),
    )
    .when(f.del > 0, (x) =>
      x.child(
        div()
          .text_size(10)
          .text_color(themeColor(gitTone("D", t)))
          .child(`-${f.del}`),
      ),
    );
}

function unresolvedBadge(t: Palette): NativeElement {
  return div()
    .rounded(999)
    .px(8)
    .py(1)
    .text_size(10)
    .font_weight(600)
    .bg(themeColor(`${gitTone("D", t)}1f`))
    .text_color(themeColor(gitTone("D", t)))
    .child("Unresolved");
}

function statusLetter(f: Entry, t: Palette): NativeElement {
  return div()
    .w(16)
    .flex_none()
    .text_center()
    .text_size(10)
    .font_bold()
    .text_color(themeColor(gitTone(f.status, t)))
    .child(f.status);
}

function hoverActions(t: Palette, buttons: NativeElement[]): NativeElement {
  return h_flex()
    .absolute()
    .right(0)
    .top(0)
    .bottom(0)
    .flex_none()
    .items_center()
    .gap(6)
    .bg(themeColor(t.hover))
    .pr(12)
    .pl(8)
    .children(buttons);
}

function rootKeyDown(view: Changes) {
  return (e: KeyEvent, eventCx: Context): void => {
    if (e.key === "escape") {
      if (view.menuOpen) {
        view.menuOpen = false;
        eventCx.notify();
        return;
      }
      if (view.typing) {
        view.typing = false;
        view.handle.focus();
        eventCx.stop_propagation();
        eventCx.notify();
        return;
      }
    }
    if (
      e.key === "enter" &&
      !e.modifiers.alt &&
      !e.modifiers.shift &&
      (e.modifiers.platform || e.modifiers.control)
    ) {
      eventCx.stop_propagation();
      view.runPrimary(eventCx);
    }
  };
}

function bannerButton(
  t: Palette,
  label: string,
  onClick: (_e: ClickEvent, eventCx: Context) => void,
  enabled: boolean,
): NativeElement {
  return div()
    .h(24)
    .px(8)
    .flex()
    .items_center()
    .rounded(6)
    .border_1()
    .border_color(themeColor(t.border))
    .text_size(11)
    .text_color(themeColor(enabled ? t.foreground : t.dim))
    .when(enabled, (s) =>
      s
        .cursor_pointer()
        .hover((x) => x.bg(themeColor(t.hover)))
        .on_click(onClick),
    )
    .child(label);
}

function overlayCloser(overlay: string | undefined): () => void {
  return () => {
    if (overlay) closeOverlay(overlay);
  };
}

function entryPathCaption(t: Palette, path: string): NativeElement {
  return div().px(8).py(4).text_size(11).text_color(themeColor(t.dim)).child(path);
}

function viewEntryDiff(target: OperationTarget, entry: Entry): void {
  if (mainChangesView?.matchesTarget(target))
    mainChangesView.openDiff(entry, target.root, target.on);
}

function openEntryInExplorer(target: OperationTarget, entry: Entry, abs: string): void {
  if (!mainChangesView?.matchesTarget(target)) return;
  const cwd = location().cwd;
  const file = cwd ? relPath(cwd, abs) : entry.path;
  run("tab.new", { mod: "orca-files", props: { file } });
}

function menuSeparator(t: Palette): NativeElement {
  return div().h(1).my(3).mx(4).bg(themeColor(t.border));
}

type EntryItem = {
  id: string | number;
  label: string;
  icon: string;
  onClick: (clickCx: Context) => void;
  enabled?: boolean;
};

function entryMenuItem(t: Palette, close: () => void, item: EntryItem): NativeElement {
  const enabled = item.enabled ?? true;
  return h_flex()
    .id(`scm-${item.id}`)
    .h(28)
    .flex_none()
    .px(8)
    .gap(8)
    .items_center()
    .rounded(6)
    .when(enabled, (s) =>
      s
        .cursor_pointer()
        .hover((x) => x.bg(themeColor(t.hover)))
        .on_click((_e, clickCx) => {
          item.onClick(clickCx);
          close();
        }),
    )
    .when(!enabled, (s) => s.opacity(0.5))
    .child(
      svg(sharedAsset(`mods/orca-changes/${item.icon}.svg`))
        .size(14)
        .flex_none()
        .text_color(themeColor(t.muted)),
    )
    .child(div().child(item.label));
}

export default class Changes extends View {
  declare files: Entry[];
  declare message: string;
  declare handle: FocusHandle;
  declare sectionViewFocus: Record<string, FocusHandle>;
  declare hovered: string | null;
  declare collapsed: Record<string, boolean>;
  declare busy: boolean;
  declare busyReason: string | null;
  declare typing: boolean;
  declare menuOpen: boolean;
  declare input: TextareaState;
  declare context: string | undefined;
  declare root: string | null;
  declare on: string | null | undefined;
  declare loading: boolean;
  declare error: string | null;
  declare note: string | null;
  declare limited: boolean;
  declare watched: string | null | undefined;
  declare openTarget: OpenTarget | undefined;

  init(_props: unknown, cx: Context): void {
    if (hostProps()?.tab !== "entry-menu") mainChangesView = this;
    this.files = [];
    this.message = "";
    this.handle = cx.focus_handle();
    this.sectionViewFocus = { changes: cx.focus_handle(), staged: cx.focus_handle() };
    this.hovered = null;
    this.collapsed = {};
    this.busy = false;
    this.busyReason = null;
    this.typing = false;
    this.menuOpen = false;
    this.input = TextareaState.new({ placeholder: "Message", rows: 2 });
    this.input.set_auto_grow(2, 12);
    this.input.on("change", (_e, eventCx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) eventCx.notify();
    });
    this.input.on("focus", (_e, eventCx) => {
      this.typing = true;
      eventCx.notify();
    });
    this.input.on("blur", (_e, eventCx) => {
      this.typing = false;
      eventCx.notify();
    });
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

  watch(root: string, cx: Context): void {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (taskCx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(taskCx);
        }
      } catch {
        this.watched = null;
      }
    });
  }

  refresh(cx: Context): void {
    if (this.loading || this.busy) return;
    const { cwd, on } = location(),
      context = key();
    if (context !== this.context) this.resetForContext(context);
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (taskCx) => {
      try {
        await this.readChanges(cwd, on, context, taskCx);
      } catch (e) {
        if (key() === context) this.error = String(e);
      } finally {
        this.loading = false;
        taskCx.notify();
      }
    });
  }

  resetForContext(context: string): void {
    this.context = context;
    this.root = null;
    this.files = [];
    this.message = "";
    this.input.set_value("");
    this.error = null;
    this.note = null;
    this.watched = null;
    this.limited = false;
  }

  async readChanges(
    cwd: string,
    on: string | null,
    context: string,
    taskCx: Context,
  ): Promise<void> {
    const top = await exec("git", [...READ, "rev-parse", "--show-toplevel"], { cwd, on });
    if (key() !== context) return;
    if (top.code !== 0) {
      this.root = null;
      this.files = [];
      this.error = "Source Control is only available for Git repositories";
      return;
    }
    const root = top.stdout.trim(),
      git = (args: string[]) => exec("git", [...READ, ...args], { cwd: root, on });
    const status = await git([
      "status",
      "--porcelain=v1",
      "-z",
      "--no-renames",
      "--untracked-files=all",
    ]);
    if (status.code !== 0) throw new Error(status.stderr);
    const stagedStats = await readNumstat(git, [
      "diff",
      "--cached",
      "--numstat",
      "-z",
      "--no-renames",
    ]);
    const unstagedStats = await readNumstat(git, ["diff", "--numstat", "-z", "--no-renames"]);
    const rawEntries = status.stdout.split("\0").filter(Boolean);
    const files = rawEntries
      .slice(0, MAX_STATUS_ENTRIES)
      .flatMap((entry) => statusRows(entry, stagedStats, unstagedStats));
    this.root = root;
    this.on = on;
    this.files = files;
    this.limited = rawEntries.length > MAX_STATUS_ENTRIES;
    this.error = null;
    this.watch(root, taskCx);
  }

  primaryAction(): Action {
    const staged = this.files.filter((f) => f.section === "staged");
    const changes = this.files.filter((f) => f.section === "changes");
    const conflicts = this.files.filter((f) => f.section === "conflicts");
    if (this.busy)
      return { kind: "commit", label: "Commit", disabled: true, reason: this.busyReason };
    if (conflicts.length)
      return {
        kind: "commit",
        label: "Commit",
        disabled: true,
        reason: "Resolve conflicts before committing",
      };
    if (staged.length && this.message.trim())
      return { kind: "commit", label: "Commit", disabled: false, reason: null };
    if (staged.length)
      return {
        kind: "commit",
        label: "Commit",
        disabled: true,
        reason: "Enter a commit message to commit",
      };
    if (changes.length) return { kind: "stage", label: "Stage All", disabled: false, reason: null };
    return {
      kind: "commit",
      label: "Commit",
      disabled: true,
      reason: "Stage at least one file to commit",
    };
  }

  finishOperation(cx: Context): void {
    this.busy = false;
    this.busyReason = null;
    this.refresh(cx);
    cx.notify();
  }

  runPrimary(cx: Context): void {
    const action = this.primaryAction();
    if (action.disabled || !this.root || this.busy || this.loading) return;
    if (action.kind === "stage") this.apply([["add", "--all", "--", "."]], cx);
    else
      this.apply([["commit", "-m", this.message.trim()]], cx, () => {
        this.message = "";
        this.input.set_value("");
      });
  }

  runCommitAndPush(cx: Context): void {
    const action = this.primaryAction();
    if (
      action.disabled ||
      action.kind !== "commit" ||
      !this.root ||
      this.busy ||
      this.loading ||
      key() !== this.context
    )
      return;
    const root = this.root,
      on = this.on,
      context = this.context,
      message = this.message.trim();
    this.busy = true;
    this.busyReason = "Commit in progress…";
    this.note = null;
    cx.spawn(async (taskCx) => {
      try {
        const pushed = await commitAndPush(
          (step) =>
            step === "commit"
              ? exec("git", [...READ, "commit", "-m", message], { cwd: root, on })
              : pushConfigured(
                  (args) => exec("git", [...READ, ...args], { cwd: root, on }),
                  () => key() === context,
                ),
          () => key() === context,
          () => {
            if (this.message.trim() === message) {
              this.message = "";
              this.input.set_value("");
            }
            this.busyReason = "Push in progress…";
            taskCx.notify();
          },
        );
        if (pushed && key() === context) this.note = "Push completed.";
      } catch (e) {
        if (key() === context) this.note = String(e).trim();
      } finally {
        this.finishOperation(taskCx);
      }
    });
    cx.notify();
  }

  runPush(cx: Context): void {
    if (!this.root || this.busy || this.loading || key() !== this.context) return;
    const root = this.root,
      on = this.on,
      context = this.context;
    this.busy = true;
    this.busyReason = "Push in progress…";
    this.note = null;
    cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        const r = await pushConfigured(
          (args) => exec("git", [...READ, ...args], { cwd: root, on }),
          () => key() === context,
        );
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || "Push failed");
        if (key() === context) this.note = "Push completed.";
      } catch (e) {
        if (key() === context) this.note = String((e as { message?: unknown }).message || e).trim();
      } finally {
        this.finishOperation(taskCx);
      }
    });
  }

  runSync(cx: Context): void {
    if (!this.root || this.busy || this.loading) return;
    this.apply([["pull", "--rebase"], ["push"]], cx);
  }

  runFetch(cx: Context): void {
    if (!this.root || this.busy || this.loading) return;
    this.apply([["fetch", "--prune"]], cx);
  }

  runPull(cx: Context): void {
    if (!this.root || this.busy || this.loading) return;
    this.apply([["pull"]], cx);
  }

  runForcePush(cx: Context): void {
    if (!this.root || this.busy || this.loading || key() !== this.context) return;
    const captured = this.operationTarget(),
      git = gitIn(captured);
    this.busy = true;
    this.busyReason = "Checking Force Push target…";
    this.note = null;
    cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        const target = await forcePushTarget(git);
        if (!this.matchesTarget(captured)) return;
        windowHandle().open_dialog(this.forcePushDialog(captured, target));
      } catch (e) {
        if (this.matchesTarget(captured))
          this.note = String((e as { message?: unknown }).message || e);
      } finally {
        this.busy = false;
        this.busyReason = null;
        taskCx.notify();
      }
    });
  }

  forcePushDialog(captured: Captured, target: ForcePushTarget): () => NativeElement {
    const t = theme();
    const destination = displayPushDestination(target.destination);
    return () =>
      dialogShell(t, 420, "Force Push?")
        .child(
          div()
            .text_size(12)
            .text_color(themeColor(t.muted))
            .child(
              `This can overwrite remote history.\nRepository: ${captured.root}\nHost: ${captured.on ?? "local"}\nBranch: ${target.branch}\nRemote: ${target.remote} (${destination})\nTarget: ${target.ref}\nLease from local tracking: ${target.expected}\nPush commit: ${target.oid}`,
            ),
        )
        .child(
          h_flex()
            .justify_end()
            .gap(8)
            .child(
              DialogButton("force-push-cancel", "Cancel", {
                t: { foreground: themeColor(t.foreground) },
                h: 24,
                border: themeColor(t.border),
                color: themeColor(t.muted),
                onClick: () => windowHandle().close_dialog(),
              }),
            )
            .child(
              DialogButton("force-push-confirm", "Force Push", {
                t: { foreground: themeColor(t.foreground) },
                h: 24,
                bg: themeColor(t.blocked),
                color: themeColor(t.canvas),
                onClick: (_e, eventCx) => {
                  windowHandle().close_dialog();
                  this.confirmForcePush(captured, target, eventCx);
                },
              }),
            ),
        );
  }

  confirmForcePush(captured: Captured, target: ForcePushTarget, cx: Context): void {
    if (!this.matchesTarget(captured) || this.busy || this.loading) {
      this.note =
        "Workspace or host changed, or an operation is in progress. Force Push cancelled.";
      cx.notify();
      return;
    }
    const git = gitIn(captured);
    this.busy = true;
    this.busyReason = "Force Push in progress…";
    this.note = null;
    cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        const r = await forcePushConfirmed(git, target, () => this.matchesTarget(captured));
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || "Force Push failed");
        if (this.matchesTarget(captured)) this.note = "Push completed.";
      } catch (e) {
        if (this.matchesTarget(captured))
          this.note = String((e as { message?: unknown }).message || e);
      } finally {
        this.finishOperation(taskCx);
      }
    });
  }

  runPublish(cx: Context): void {
    if (!this.root || this.busy || this.loading) return;
    this.apply([["push", "--set-upstream", "origin", "HEAD"]], cx);
  }

  runRebase(cx: Context): void {
    const root = this.root,
      on = this.on,
      context = this.context;
    if (!root || this.busy || this.loading) return;
    this.busy = true;
    this.note = null;
    cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        const sym = await exec("git", [...READ, "symbolic-ref", "refs/remotes/origin/HEAD"], {
          cwd: root,
          on,
        });
        const full = sym.code === 0 ? sym.stdout.trim() : "";
        const prefix = "refs/remotes/origin/";
        const base = full.startsWith(prefix) ? full.slice(prefix.length) : "";
        if (!base) throw new Error("Choose a remote base branch to rebase from");
        for (const args of [
          ["fetch", "--prune", "origin", base],
          ["rebase", `origin/${base}`],
        ]) {
          const r = await exec("git", [...READ, ...args], { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
      } catch (e) {
        if (key() === context) this.note = String(e).trim();
      } finally {
        this.finishOperation(taskCx);
      }
    });
  }

  openCreatePrDialog(cx: Context): void {
    const target = this.operationTarget();
    if (!this.matchesTarget(target) || this.busy || this.loading) return;
    const git = gitIn(target),
      gh = ghIn(target);
    this.busy = true;
    this.busyReason = "Checking GitHub branch…";
    this.note = null;
    cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        const snapshot = await prepareCreatePr(git, gh);
        if (!this.matchesTarget(target)) return;
        this.showCreatePrDialog(target, snapshot);
      } catch (e) {
        if (this.matchesTarget(target))
          this.note = `Cannot prepare PR: ${(e as { message?: unknown }).message || e}`;
      } finally {
        this.busy = false;
        this.busyReason = null;
        taskCx.notify();
      }
    });
  }

  showCreatePrDialog(target: Captured, snapshot: PrSnapshot): void {
    const title = InputState.new({ placeholder: "Title" });
    title.set_value(this.message.trim() || snapshot.branch);
    const body = InputState.new({ placeholder: "Description (optional)" });
    const draft = { value: false };
    const t = theme();
    windowHandle().open_dialog(() =>
      createPrDialog(this, t, target, snapshot, { title, body, draft }),
    );
  }

  submitCreatePr(
    target: Captured,
    snapshot: PrSnapshot,
    { title, body, draft }: { title: string; body: string; draft: boolean },
    cx: Context,
  ): void {
    if (!this.matchesTarget(target) || this.busy || this.loading) return;
    this.busy = true;
    this.busyReason = "Creating pull request…";
    this.note = null;
    cx.notify();
    const git = gitIn(target),
      gh = ghIn(target);
    cx.spawn(async (taskCx) => {
      try {
        const pr = await createPr({
          snapshot,
          git,
          gh,
          current: () => this.matchesTarget(target),
          title,
          body,
          draft,
        });
        if (this.matchesTarget(target)) this.note = `Created PR #${pr.number}: ${pr.url}`;
      } catch (e) {
        if (this.matchesTarget(target))
          this.note = String((e as { message?: unknown }).message || e);
      } finally {
        this.finishOperation(taskCx);
      }
    });
  }

  operationTarget(): Captured {
    return { root: this.root, on: this.on, context: this.context };
  }

  matchesTarget(expected: OperationTarget): boolean {
    return sameOperationTarget(expected, { ...this.operationTarget(), activeContext: key() });
  }

  prepareDiscard(
    target: Captured,
    paths: string[],
    cx: Context,
    open: (snapshot: string) => void,
  ): void {
    if (!this.matchesTarget(target) || this.busy || this.loading) return;
    this.busy = true;
    this.note = null;
    cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        const snapshot = await discardSnapshot(target, paths, exec);
        if (this.matchesTarget(target)) open(snapshot);
      } catch (e) {
        if (this.matchesTarget(target))
          this.note = `Cannot prepare discard: ${(e as { message?: unknown }).message || e}`;
      } finally {
        this.busy = false;
        taskCx.notify();
      }
    });
  }

  verifyDiscard(
    target: Captured,
    paths: string[],
    snapshot: string,
    cx: Context,
    perform: (cx: Context) => void,
  ): void {
    if (!this.matchesTarget(target) || this.busy || this.loading) {
      this.note = "Workspace or host changed, or an operation is in progress. Action cancelled.";
      cx.notify();
      return;
    }
    this.busy = true;
    this.note = null;
    cx.notify();
    cx.spawn(async (taskCx) => {
      let verified = false;
      try {
        await assertDiscardUnchanged(target, paths, snapshot, exec);
        verified = this.matchesTarget(target);
      } catch (e) {
        if (this.matchesTarget(target))
          this.note = `Discard cancelled: ${(e as { message?: unknown }).message || e}`;
      } finally {
        this.busy = false;
        taskCx.notify();
      }
      if (verified && this.matchesTarget(target)) perform(taskCx);
    });
  }

  apply(
    commands: string[][],
    cx: Context,
    done?: (() => void) | null,
    expected: OperationTarget = this.operationTarget(),
  ): void {
    if (!this.matchesTarget(expected) || this.busy || this.loading) {
      this.note = "Workspace or host changed, or an operation is in progress. Action cancelled.";
      cx.notify();
      return;
    }
    const root = this.root,
      on = this.on,
      context = this.context;
    this.busy = true;
    this.busyReason = commands[0]?.[0] === "commit" ? "Commit in progress…" : null;
    this.note = null;
    cx.spawn(async (taskCx) => {
      try {
        for (const args of commands) {
          if (key() !== context)
            throw new Error("Workspace or host changed; remaining actions were cancelled.");
          const r = await exec("git", [...READ, ...args], { cwd: root as string, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (key() === context && done) done();
      } catch (e) {
        if (key() === context) this.note = String(e).trim();
      } finally {
        this.finishOperation(taskCx);
      }
    });
    cx.notify();
  }

  stagePaths(paths: string[], cx: Context): void {
    this.apply(
      chunks(paths).map((c) => ["add", "--", ...c]),
      cx,
    );
  }

  unstagePaths(paths: string[], cx: Context): void {
    this.apply(
      chunks(paths).map((c) => ["reset", "--quiet", "--", ...c]),
      cx,
    );
  }

  actionButton(
    icon: string,
    t: Palette,
    onClick: () => void,
    title?: string,
    enabled = true,
  ): NativeElement {
    const label = title ?? icon.replace(/\.svg$/, "");
    return div()
      .w(24)
      .h(24)
      .flex()
      .flex_none()
      .items_center()
      .justify_center()
      .rounded(4)
      .role("button")
      .accessibility_label(label)
      .tooltip(label)
      .disabled(!enabled)
      .when(enabled, (s) =>
        s
          .cursor_pointer()
          .hover((x) => x.bg(themeColor(t.chrome)))
          .on_click((_e, eventCx) => {
            eventCx.stop_propagation();
            onClick();
          }),
      )
      .when(!enabled, (s) => s.opacity(0.5))
      .child(
        svg(sharedAsset(`mods/orca-changes/${icon}`))
          .size(14)
          .text_color(themeColor(t.muted)),
      );
  }

  rowButtons(f: Entry, name: string, t: Palette, cx: Context): NativeElement[] {
    const buttons: NativeElement[] = [];
    if (f.section === "changes") {
      buttons.push(
        this.actionButton(
          f.fresh ? "trash.svg" : "undo.svg",
          t,
          () => this.confirmDiscard(f, name, cx),
          f.fresh ? "Delete untracked file" : "Discard changes",
          !this.busy,
        ),
      );
      buttons.push(
        this.actionButton(
          "plus.svg",
          t,
          () => this.apply([["add", "--", f.path]], cx),
          "Stage",
          !this.busy,
        ),
      );
    } else if (f.section === "staged") {
      buttons.push(
        this.actionButton(
          "minus.svg",
          t,
          () => this.apply([["reset", "--quiet", "--", f.path]], cx),
          "Unstage",
          !this.busy,
        ),
      );
    } else if (f.section === "conflicts") {
      for (const r of conflictResolutions(f.xy)) {
        const [icon, title] = RESOLUTION[r];
        buttons.push(
          this.actionButton(
            icon,
            t,
            () => this.resolveConflict(f, r, cx),
            title,
            !this.busy && !isKeepDeletion(r),
          ),
        );
      }
    }
    return buttons;
  }

  fileRow(f: Entry, t: Palette, cx: Context): NativeElement {
    const id = `${f.section}-${f.path}`,
      parts = f.path.split("/"),
      name = parts.pop() as string;
    const hovered = this.hovered === id,
      buttons = this.rowButtons(f, name, t, cx);
    const selected = this.openTarget?.path === f.path && this.openTarget?.section === f.section;
    return h_flex()
      .id(id)
      .w_full()
      .h(24)
      .flex_none()
      .pl(20)
      .pr(12)
      .gap(4)
      .items_center()
      .relative()
      .hover((s) => s.bg(themeColor(`${t.hover}66`)))
      .when(selected, (e) => e.bg(themeColor(t.selected)))
      .on_hover((on, eventCx) => {
        if (on !== hovered) {
          this.hovered = on ? id : null;
          eventCx.notify();
        }
      })
      .on_click(() => this.openDiff(f))
      .on_mouse_down("right", (_e, eventCx) => {
        eventCx.stop_propagation();
        openOverlay({
          mod: "orca-changes",
          kind: "popup",
          width: 208,
          props: { tab: "entry-menu", entry: f, target: this.operationTarget() },
        });
      })
      .child(
        svg("mods/orca-assets/file.svg")
          .size(14)
          .flex_none()
          .text_color(themeColor(gitTone(f.status, t))),
      )
      .child(pathLabel(name, parts, t))
      .when(f.add > 0 || f.del > 0, (e) => e.child(changeCounts(f, t)))
      .when(f.section === "conflicts", (e) => e.child(unresolvedBadge(t)))
      .when(f.section !== "conflicts", (e) => e.child(statusLetter(f, t)))
      .when(hovered && buttons.length > 0, (e) => e.child(hoverActions(t, buttons)));
  }

  openDiff(
    f: EntryLike,
    root: string | null | undefined = this.root,
    on: string | null | undefined = location().on,
  ): void {
    if (f.section === "conflicts") return this.openEntry(f, root);
    if (!root) return;
    const target = {
      root,
      on,
      all: Boolean(f.all),
      sectionAll: Boolean(f.sectionAll),
      paths: f.paths,
      limited: Boolean(f.limited),
      path: f.path,
      section: f.section,
      status: f.status,
    };
    setShared("orca-diff.target", target);
    const tab = focused()?.tab,
      inTab = panes().filter((p) => p.tab === tab);
    if (inTab.some((p) => p.mod === "orca-diff")) {
      run("orca-diff.show");
      return;
    }
    const host = inTab.find((p) => p.focused && !p.mod) ?? inTab.find((p) => !p.mod);
    if (host)
      run("pane.split", { direction: "right", pane: host.pane, mod: "orca-diff", props: target });
    else run("tab.new", { mod: "orca-diff", props: target });
  }

  openEntry(f: EntryLike, root: string | null | undefined = this.root): void {
    const cwd = location().cwd;
    if (!root || !cwd) return;
    const file = relPath(cwd, `${root.replace(/\/+$/, "")}/${f.path}`);
    run("tab.new", { mod: "orca-files", props: { file } });
  }

  resolveConflict(
    f: Entry,
    resolution: Resolution,
    cx: Context,
    target: OperationTarget = this.operationTarget(),
  ): void {
    if (!this.matchesTarget(target) || this.busy || isKeepDeletion(resolution)) return;
    const { root, on, context } = target;
    const command = isKeepDeletion(resolution)
      ? ["rm", "--force", "--quiet", "--", f.path]
      : ["add", "--", f.path];
    this.busy = true;
    this.note = null;
    cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        const st = await exec(
          "git",
          [
            ...READ,
            "--literal-pathspecs",
            "status",
            "--porcelain=v2",
            "-z",
            "--untracked-files=no",
            "--",
            f.path,
          ],
          { cwd: root as string, on },
        );
        if (st.code !== 0) throw new Error((st.stderr || st.stdout).trim());
        const record = st.stdout.split("\0").find((line) => line.startsWith("u "));
        if (!record)
          throw new Error(`${f.path} is no longer in conflict. Refresh to see its current state.`);
        if (!isKeepDeletion(resolution) && record.split(" ")[6] === "000000")
          throw new Error(
            `${f.path} has changed since this list loaded. Refresh to see its current state.`,
          );
        if (!this.matchesTarget(target))
          throw new Error("Workspace changed; conflict resolution cancelled.");
        const r = await exec("git", [...READ, "--literal-pathspecs", ...command], {
          cwd: root as string,
          on,
        });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        if (mainChangesView) mainChangesView.refresh(taskCx);
        run("orca-changes.refresh");
      } catch (e) {
        if (key() === context) this.note = String(e).trim();
      } finally {
        this.busy = false;
        this.refresh(taskCx);
        taskCx.notify();
      }
    });
  }

  confirmDiscard(f: Entry, name: string, cx: Context): void {
    const t = theme(),
      target = this.operationTarget(),
      deleting = f.fresh;
    const copy = DISCARD_COPY[discardKind(f)];
    const command = deleting
      ? ["clean", "-f", "--", f.path]
      : ["restore", "--worktree", "--", f.path];
    this.prepareDiscard(target, [f.path], cx, (snapshot) =>
      windowHandle().open_dialog(() =>
        dialogShell(t, 360, copy.title(name))
          .child(
            div()
              .text_size(12)
              .text_color(themeColor(t.muted))
              .child(
                `${copy.text}\nRepository: ${target.root}\nHost: ${target.on ?? "local"}\nPath: ${f.path}`,
              ),
          )
          .child(
            h_flex()
              .justify_end()
              .gap(8)
              .child(discardCancelButton(t))
              .child(
                DialogButton("discard-confirm", copy.label, {
                  t: { foreground: themeColor(t.foreground) },
                  h: 24,
                  size: 11,
                  bg: themeColor(deleting ? t.blocked : t.done),
                  color: themeColor(t.canvas),
                  onClick: (_e, eventCx) => {
                    windowHandle().close_dialog();
                    this.verifyDiscard(target, [f.path], snapshot, eventCx, (callbackCx) =>
                      this.apply([command], callbackCx, null, target),
                    );
                  },
                }),
              ),
          ),
      ),
    );
  }

  confirmDiscardAll(sectionKey: string, paths: string[], cx: Context): void {
    if (!paths.length || this.busy) return;
    const t = theme(),
      target = this.operationTarget(),
      area = sectionKey === "staged" ? "staged" : "changes";
    const count = `${paths.length} ${paths.length === 1 ? "file" : "files"}`;
    this.prepareDiscard(target, paths, cx, (snapshot) =>
      windowHandle().open_dialog(() =>
        dialogShell(t, 360, "Discard all changes?")
          .child(
            div()
              .max_h(200)
              .overflow_y_scrollbar()
              .text_size(12)
              .text_color(themeColor(t.muted))
              .child(
                (area === "staged"
                  ? `This will unstage and discard the changes to ${count}. This cannot be undone.`
                  : `This will revert the unstaged changes to ${count}. This cannot be undone.`) +
                  `\nRepository: ${target.root}\nHost: ${target.on ?? "local"}\n${paths.join("\n")}`,
              ),
          )
          .child(
            h_flex()
              .justify_end()
              .gap(8)
              .child(discardCancelButton(t))
              .child(
                DialogButton("discard-all-confirm", "Discard all", {
                  t: { foreground: themeColor(t.foreground) },
                  h: 24,
                  size: 11,
                  bg: themeColor(t.blocked),
                  color: themeColor(t.canvas),
                  onClick: (_e, eventCx) => {
                    windowHandle().close_dialog();
                    this.verifyDiscard(target, paths, snapshot, eventCx, (callbackCx) =>
                      this.discardPaths(paths, area, callbackCx, target),
                    );
                  },
                }),
              ),
          ),
      ),
    );
  }

  discardPaths(
    paths: string[],
    area: string,
    cx: Context,
    expected: OperationTarget = this.operationTarget(),
  ): void {
    const root = this.root,
      on = this.on,
      context = this.context;
    if (!this.matchesTarget(expected) || this.busy || this.loading) {
      this.note = "Workspace or host changed, or an operation is in progress. Action cancelled.";
      cx.notify();
      return;
    }
    const git = async (args: string[]): Promise<string> => {
      if (key() !== context)
        throw new Error("Workspace or host changed; remaining actions were cancelled.");
      const r = await exec("git", [...READ, ...args], { cwd: root as string, on });
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
      return r.stdout;
    };
    this.busy = true;
    this.note = null;
    cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        if (area === "staged")
          for (const c of chunks(paths)) await git(["reset", "--quiet", "--", ...c]);
        const tracked = new Set<string>();
        for (const c of chunks(paths)) {
          for (const p of (await git(["ls-files", "-z", "--", ...c])).split("\0"))
            if (p) tracked.add(p);
        }
        for (const c of chunks(paths.filter((p) => tracked.has(p))))
          await git(["restore", "--worktree", "--", ...c]);
        for (const c of chunks(paths.filter((p) => !tracked.has(p))))
          await git(["clean", "-f", "--", ...c]);
      } catch (e) {
        if (key() === context) this.note = String(e).trim();
      } finally {
        this.busy = false;
        this.refresh(taskCx);
        taskCx.notify();
      }
    });
  }

  section(sectionKey: Section, label: string, t: Palette, cx: Context): NativeElement | null {
    const items = this.files.filter((f) => f.section === sectionKey);
    if (!items.length) return null;
    const collapsed = Boolean(this.collapsed[sectionKey]);
    const bulk = this.sectionBulkButtons(sectionKey, items, t, cx);
    const viewAll = () => {
      if (this.context !== JSON.stringify(location())) {
        this.note = "Workspace or host changed; action cancelled.";
        return;
      }
      this.openDiff(
        {
          sectionAll: true,
          section: sectionKey,
          paths: items.map((item) => item.path),
          limited: this.limited,
        },
        this.root,
        this.on,
      );
    };
    return div()
      .child(
        div()
          .pl(4)
          .pr(12)
          .pt(12)
          .pb(4)
          .child(
            h_flex()
              .rounded(6)
              .pr(4)
              .gap(4)
              .items_center()
              .child(this.sectionToggle(sectionKey, label, t, collapsed, items.length))
              .child(
                h_flex()
                  .flex_none()
                  .items_center()
                  .gap(6)
                  .children(bulk)
                  .when(sectionKey !== "conflicts", (e) =>
                    e.child(this.viewAllButton(sectionKey, label, t, viewAll)),
                  ),
              ),
          ),
      )
      .when(!collapsed, (e) =>
        e.child(v_flex().children(items.map((f) => this.fileRow(f, t, cx)))),
      );
  }

  sectionBulkButtons(
    sectionKey: Section,
    items: Entry[],
    t: Palette,
    cx: Context,
  ): NativeElement[] {
    const bulk: NativeElement[] = [];
    if (sectionKey !== "conflicts")
      bulk.push(
        this.actionButton(
          "undo.svg",
          t,
          () =>
            this.confirmDiscardAll(
              sectionKey,
              items.map((f) => f.path),
              cx,
            ),
          "Discard all",
          !this.busy,
        ),
      );
    if (sectionKey === "changes")
      bulk.push(
        this.actionButton(
          "plus.svg",
          t,
          () =>
            this.stagePaths(
              items.map((f) => f.path),
              cx,
            ),
          "Stage all",
          !this.busy,
        ),
      );
    if (sectionKey === "staged")
      bulk.push(
        this.actionButton(
          "minus.svg",
          t,
          () =>
            this.unstagePaths(
              items.map((f) => f.path),
              cx,
            ),
          "Unstage all",
          !this.busy,
        ),
      );
    return bulk;
  }

  sectionToggle(
    sectionKey: Section,
    label: string,
    t: Palette,
    collapsed: boolean,
    count: number,
  ): NativeElement {
    return div()
      .id(`section-${sectionKey}`)
      .flex_1()
      .min_w(0)
      .flex()
      .items_center()
      .gap(4)
      .cursor_pointer()
      .on_click((_e, eventCx) => {
        this.collapsed[sectionKey] = !collapsed;
        eventCx.notify();
      })
      .child(
        svg(
          sharedAsset(`mods/orca-changes/${collapsed ? "chevron-right.svg" : "chevron-down.svg"}`),
        )
          .size(14)
          .flex_none()
          .text_color(themeColor(t.muted)),
      )
      .child(
        div()
          .truncate()
          .text_size(12)
          .font_weight(600)
          .text_color(themeColor(t.muted))
          .child(label.toUpperCase()),
      )
      .child(div().flex_none().text_size(11).text_color(themeColor(t.muted)).child(String(count)));
  }

  viewAllButton(
    sectionKey: Section,
    label: string,
    t: Palette,
    viewAll: () => void,
  ): NativeElement {
    return div()
      .id(`view-all-${sectionKey}`)
      .h(24)
      .px(6)
      .flex()
      .items_center()
      .rounded(4)
      .text_size(11)
      .text_color(themeColor(t.muted))
      .cursor_pointer()
      .role("button")
      .accessibility_label(`View all ${label}`)
      .track_focus(this.sectionViewFocus[sectionKey])
      .tab_index(0)
      .when(this.sectionViewFocus[sectionKey].is_focused(), (el) =>
        el.border_1().border_color(themeColor(t.accent)),
      )
      .hover((el) => el.bg(themeColor(t.hover)))
      .on_click((_e, eventCx) => {
        eventCx.stop_propagation();
        viewAll();
        eventCx.notify();
      })
      .on_key_down((event, eventCx) => {
        if (
          this.sectionViewFocus[sectionKey].is_focused() &&
          !event.modifiers?.platform &&
          !event.modifiers?.control &&
          !event.modifiers?.alt &&
          !event.modifiers?.shift &&
          (event.key === "enter" || event.key === "space")
        ) {
          eventCx.stop_propagation();
          viewAll();
          eventCx.notify();
        }
      })
      .child("View all");
  }

  commitArea(t: Palette, action: Action, cx: Context): NativeElement {
    return v_flex()
      .flex_none()
      .px(12)
      .pt(12)
      .pb(8)
      .child(this.commitBox(t))
      .child(this.commitActions(t, action))
      .when(this.menuOpen, (e) => e.child(this.actionMenu(t, action, cx)));
  }

  commitBox(t: Palette): NativeElement {
    return div()
      .id("commit-message")
      .min_h(56)
      .rounded(6)
      .border_1()
      .border_color(themeColor(this.typing ? t.accent : t.input))
      .bg(themeColor(t.canvas))
      .px(8)
      .py(6)
      .cursor_text()
      .on_mouse_down("left", (_e, eventCx) => eventCx.stop_propagation())
      .child(Textarea.new(this.input).w_full().text_size(12).text_color(themeColor(t.foreground)));
  }

  commitActions(t: Palette, action: Action): NativeElement {
    return h_flex()
      .mt(4)
      .gap(4)
      .items_center()
      .child(
        h_flex()
          .rounded(6)
          .border_1()
          .border_color(themeColor(t.border))
          .items_stretch()
          .child(this.commitPrimary(t, action))
          .child(this.commitChevron(t)),
      )
      .when(Boolean(action.reason), (e) =>
        e.child(
          div()
            .text_size(11)
            .text_color(themeColor(t.dim))
            .child(action.reason as string),
        ),
      );
  }

  commitPrimary(t: Palette, action: Action): NativeElement {
    return div()
      .id("commit-primary")
      .h(24)
      .px(12)
      .flex()
      .flex_none()
      .items_center()
      .rounded_l(5)
      .text_size(11)
      .text_color(themeColor(action.disabled ? t.dim : t.foreground))
      .when(!action.disabled, (e) => e.cursor_pointer().hover((s) => s.bg(themeColor(t.hover))))
      .on_click((_e, eventCx) => {
        if (!action.disabled) this.runPrimary(eventCx);
      })
      .child(action.label);
  }

  commitChevron(t: Palette): NativeElement {
    return div()
      .id("commit-chevron")
      .h(24)
      .w(22)
      .flex()
      .flex_none()
      .items_center()
      .justify_center()
      .rounded_r(5)
      .border_l(1)
      .border_color(themeColor(t.border))
      .cursor_pointer()
      .hover((s) => s.bg(themeColor(t.hover)))
      .on_click((_e, eventCx) => {
        this.menuOpen = !this.menuOpen;
        eventCx.notify();
      })
      .child(
        svg("mods/orca-assets/chevron-down--orca-agent-settings.svg")
          .size(12)
          .text_color(themeColor(t.muted)),
      );
  }

  actionMenu(t: Palette, action: Action, cx: Context): NativeElement {
    const canCommit = !action.disabled && action.kind === "commit";
    return v_flex()
      .w_full()
      .mt(4)
      .p(4)
      .gap(2)
      .rounded(6)
      .border_1()
      .border_color(themeColor(t.border))
      .bg(themeColor(t.popover))
      .child(this.actionMenuItem(t, "Commit", canCommit, (eventCx) => this.runPrimary(eventCx)))
      .child(
        this.actionMenuItem(t, "Commit & Push · destination binding unavailable", false, () => {}),
      )
      .child(div().h(1).my(2).bg(themeColor(t.border)))
      .child(this.actionMenuItem(t, "Push · destination binding unavailable", false, () => {}))
      .child(
        this.actionMenuItem(t, "Force Push · destination binding unavailable", false, () => {}),
      )
      .child(
        this.actionMenuItem(
          t,
          "Create PR…",
          Boolean(this.root),
          (eventCx) => this.openCreatePrDialog(eventCx),
          "mods/orca-assets/git-pull-request.svg",
        ),
      )
      .child(
        this.actionMenuItem(
          t,
          "Push & Create PR · target unavailable",
          false,
          () => {},
          "mods/orca-assets/git-pull-request.svg",
        ),
      )
      .child(this.actionMenuItem(t, "Pull", Boolean(this.root), (eventCx) => this.runPull(eventCx)))
      .child(this.actionMenuItem(t, "Sync · target unavailable", false, () => {}))
      .child(this.actionMenuItem(t, "Rebase · base unavailable", false, () => {}))
      .child(
        this.actionMenuItem(t, "Fetch", Boolean(this.root), (eventCx) => this.runFetch(eventCx)),
      )
      .child(this.actionMenuItem(t, "Publish · target unavailable", false, () => {}));
  }

  actionMenuItem(
    t: Palette,
    label: string,
    enabled: boolean,
    onClick: (eventCx: Context) => void,
    icon?: string,
  ): NativeElement {
    return div()
      .h(26)
      .px(10)
      .flex()
      .items_center()
      .gap(6)
      .rounded(4)
      .text_size(11)
      .text_color(themeColor(enabled ? t.foreground : t.dim))
      .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg(themeColor(t.hover))))
      .on_click((_e, eventCx) => {
        if (!enabled) return;
        this.menuOpen = false;
        onClick(eventCx);
      })
      .when(Boolean(icon), (e) =>
        e.child(
          svg(icon as string)
            .size(12)
            .text_color(themeColor(enabled ? t.muted : t.dim)),
        ),
      )
      .child(label);
  }

  entryMenuView(t: Palette, cx: Context): NativeElement {
    const { entry, target } = hostProps() ?? {};
    if (!entry || !target) return div();
    const abs = absolutePath(target.root, entry.path);
    const close = overlayCloser(hostProps()?.overlay);
    const item = (spec: EntryItem) => entryMenuItem(t, close, spec);
    const revealLabel = platformRevealLabel();
    const resolutions = entry.section === "conflicts" ? conflictResolutions(entry.xy) : [];

    return v_flex()
      .id("orca-changes-entry-menu")
      .w_full()
      .min_h(0)
      .p(5)
      .bg(themeColor(t.popover))
      .text_size(12.8)
      .text_color(themeColor(t.foreground))
      .child(entryPathCaption(t, entry.path))
      .child(
        item({ id: 0, label: "View", icon: "eye", onClick: () => viewEntryDiff(target, entry) }),
      )
      .when(resolutions.length > 0, (el) =>
        el.child(menuSeparator(t)).children(this.resolutionItems(item, entry, target, resolutions)),
      )
      .child(menuSeparator(t))
      .child(
        item({
          id: 1,
          label: "Copy Path",
          icon: "copy",
          onClick: (clickCx) => void copyText(abs, clickCx),
        }),
      )
      .child(
        item({
          id: 2,
          label: "Copy Relative Path",
          icon: "copy",
          onClick: (clickCx) => void copyText(entry.path, clickCx),
        }),
      )
      .child(menuSeparator(t))
      .child(
        item({
          id: 3,
          label: revealLabel,
          icon: "external-link",
          onClick: () => void reveal(abs, false),
          enabled: entry.status !== "D",
        }),
      )
      .child(menuSeparator(t))
      .child(
        item({
          id: 4,
          label: "Open in File Explorer",
          icon: "folder-open",
          onClick: () => openEntryInExplorer(target, entry, abs),
        }),
      );
  }

  resolutionItems(
    item: (spec: EntryItem) => NativeElement,
    entry: Entry,
    target: OperationTarget,
    resolutions: Resolution[],
  ): NativeElement[] {
    return resolutions.map((r, idx) => {
      const [icon, title] = RESOLUTION[r];
      return item({
        id: `res-${idx}`,
        label: title,
        icon: icon.replace(/\.svg$/, ""),
        onClick: (clickCx) => {
          if (mainChangesView?.matchesTarget(target))
            mainChangesView.resolveConflict(entry, r, clickCx, target);
        },
        enabled: !isKeepDeletion(r),
      });
    });
  }

  render(cx: Context): NativeElement {
    return panelFrame(this.renderBody(cx));
  }

  renderBody(cx: Context): NativeElement {
    if (key() !== this.context) cx.timer.after(0, (timerCx) => this.refresh(timerCx));
    this.openTarget = shared("orca-diff.target") as OpenTarget | undefined;
    const t = theme(),
      action = this.primaryAction();
    if (hostProps()?.tab === "entry-menu") return this.entryMenuView(t, cx);
    return v_flex()
      .id("changes")
      .size_full()
      .min_h(0)
      .overflow_hidden()
      .text_color(themeColor(t.foreground))
      .text_size(13)
      .track_focus(this.handle)
      .on_key_down(rootKeyDown(this))
      .child(this.commitArea(t, action, cx))
      .when(this.limited, (e) => e.child(this.tooManyBanner(t, cx)))
      .child(
        v_flex()
          .id("changes-list")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .children(this.sectionNodes(t, cx))
          .when(!this.files.length, (e) => e.child(this.emptyState(t))),
      )
      .when(Boolean(this.note), (e) =>
        e.child(
          div()
            .px(12)
            .pb(8)
            .text_size(11)
            .text_color(themeColor(this.note === "Push completed." ? t.ansi2 : t.ansi1))
            .child(this.note as string),
        ),
      );
  }

  sectionNodes(t: Palette, cx: Context): NativeElement[] {
    const sections: [Section, string][] = [
      ["conflicts", "Conflicts"],
      ["changes", "Changes"],
      ["staged", "Staged Changes"],
    ];
    return sections
      .map(([sectionKey, label]) => this.section(sectionKey, label, t, cx))
      .filter((el): el is NativeElement => Boolean(el));
  }

  tooManyBanner(t: Palette, cx: Context): NativeElement {
    const amber = t.is_dark ? "#fbbf24" : "#d97706";
    return v_flex()
      .id("too-many-changes")
      .mx(12)
      .mb(8)
      .gap(6)
      .rounded(6)
      .border_1()
      .border_color("#f59e0b40")
      .bg("#f59e0b0d")
      .px(12)
      .py(8)
      .child(
        h_flex()
          .items_start()
          .gap(8)
          .child(svg("mods/orca-assets/triangle-alert.svg").size(16).flex_none().text_color(amber))
          .child(
            div()
              .flex_1()
              .min_w(0)
              .text_size(12)
              .text_color(themeColor(t.foreground))
              .child(
                `Too many changes detected. Only the first ${MAX_STATUS_ENTRIES.toLocaleString()} changes are shown.`,
              ),
          ),
      )
      .child(
        h_flex()
          .justify_end()
          .gap(8)
          .child(
            bannerButton(
              t,
              "Stage All",
              (_e, eventCx) => this.apply([["add", "--all", "--", "."]], eventCx),
              !this.busy,
            ),
          )
          .child(
            bannerButton(
              t,
              "Retry",
              (_e, eventCx) => this.refresh(eventCx),
              !this.loading && !this.busy,
            ),
          ),
      );
  }

  emptyState(t: Palette): NativeElement {
    if (this.error)
      return div().px(16).py(24).text_size(12).text_color(themeColor(t.muted)).child(this.error);
    if (this.loading)
      return div()
        .px(16)
        .py(24)
        .text_size(12)
        .text_color(themeColor(t.muted))
        .child("Loading changes…");
    if (!this.root)
      return div()
        .px(16)
        .py(24)
        .text_size(12)
        .text_color(themeColor(t.muted))
        .child("Select a workspace to view changes");
    return div()
      .px(16)
      .py(24)
      .child(
        div()
          .text_size(14)
          .font_weight(500)
          .text_color(themeColor(t.foreground))
          .child("No changes on this branch"),
      )
      .child(
        div()
          .mt(4)
          .text_size(12)
          .text_color(themeColor(t.muted))
          .child("This workspace is clean and this branch has no changes ahead of base"),
      );
  }
}

const SHARED_ASSET_PATHS: Record<string, string> = {
  "mods/orca-changes/chevron-down.svg": "mods/orca-assets/chevron-down--orca-agent-settings.svg",
  "mods/orca-changes/chevron-right.svg": "mods/orca-assets/chevron-right--orca-changes.svg",
  "mods/orca-changes/eye.svg": "mods/orca-assets/eye--orca-changes.svg",
  "mods/orca-changes/minus.svg": "mods/orca-assets/minus--orca-changes.svg",
  "mods/orca-changes/plus.svg": "mods/orca-assets/plus--orca-changes.svg",
};
function sharedAsset(path: string): string {
  return SHARED_ASSET_PATHS[path] ?? `mods/orca-assets/${path.slice(path.lastIndexOf("/") + 1)}`;
}
