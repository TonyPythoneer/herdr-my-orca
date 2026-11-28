import { div, svg, type NativeElement } from "gpui-kit";
import {
  v_flex,
  h_flex,
  Input,
  Textarea,
  Link,
  type InputState,
  type TextareaState,
} from "gpui-base";
import { LIST_ROW_HEIGHT, argsEditable, draftRun, formatArgv } from "./state.js";
import { installMethodFor } from "./install.js";
import { sameRun } from "./util.js";
import { permissionRow } from "./permission-menu.js";
import { badge, icon, monoFont, permissionBadge, type PartsTheme } from "./parts.js";
import { themeColor } from "../../shared/theme-color.js";

type ViewOwner = Record<string, unknown>;
type ViewRow = Record<string, unknown> & {
  homepage?: string;
  icon?: string;
  tint?: boolean;
  name?: string;
};
type EditorLike = Record<string, unknown> & {
  command: InputState;
  args: TextareaState;
  originalArgs: unknown;
  conflict?: boolean;
};
type ButtonOptions = {
  height?: number;
  px?: number;
  color?: unknown;
  primary?: boolean;
  disabled?: boolean;
};
type SettingsButton = (
  id: string,
  label: string,
  t: PartsTheme,
  handler: (_event: unknown, cx: unknown) => void,
  opts?: ButtonOptions,
) => NativeElement;

const note = (color: unknown, text: string): NativeElement =>
  div().text_size(11).text_color(themeColor(color)).child(text);

const label = (text: string, t: PartsTheme): NativeElement =>
  div().text_size(10).font_semibold().text_color(t.dim).child(text);

const guideLink = (id: string, text: string, row: ViewRow, t: PartsTheme): NativeElement =>
  Link.new(id)
    .href(row.homepage ?? "")
    .text_size(11)
    .text_color(themeColor(t.accent))
    .underline()
    .tooltip(row.homepage ?? "")
    .child(text);

export function rowView(
  owner: ViewOwner,
  row: ViewRow,
  t: PartsTheme,
  last = false,
): NativeElement {
  const open = (owner as { expanded?: Set<string> }).expanded?.has(row.key as string) ?? false;
  const editor = (owner as { editors?: Map<string, EditorLike> }).editors?.get(row.key as string);
  const quiet = !(row.enabled as boolean);
  return v_flex()
    .id(`am-row-${row.key}`)
    .relative()
    .w_full()
    .flex_none()
    .when(!last, (el) => el.border_b(1).border_color(t.border))
    .child(
      h_flex()
        .id(`am-row-highlight-${row.key}`)
        .w_full()
        .rounded(8)
        .hover((s) => s.bg(t.hover))
        .h(LIST_ROW_HEIGHT - 12)
        .my(6)
        .px(8)
        .min_w(0)
        .gap(12)
        .py(0)
        .items_center()
        .overflow_hidden()
        .child(rowIconTile(row, t, quiet))
        .child(rowTitle(owner, row, t, open, quiet))
        .child(rowActions(owner, row, t, open)),
    )
    .when(open && editor !== undefined, (el) =>
      editor === undefined
        ? el
        : el.child(
            (
              owner as {
                editor: (row: ViewRow, editor: EditorLike, t: PartsTheme) => NativeElement;
              }
            ).editor(row, editor, t),
          ),
    );
}

function rowIconTile(row: ViewRow, t: PartsTheme, quiet: boolean): NativeElement {
  return h_flex()
    .w(32)
    .h(32)
    .flex_none()
    .items_center()
    .justify_center()
    .rounded(8)
    .border_1()
    .border_color(t.border)
    .bg(t.surface)
    .when(quiet, (el) => el.opacity(0.5))
    .child(icon(row as { icon?: string; tint?: boolean; name?: string }, 18, t));
}

function rowTitle(
  owner: ViewOwner,
  row: ViewRow,
  t: PartsTheme,
  open: boolean,
  quiet: boolean,
): NativeElement {
  return v_flex()
    .flex_1()
    .min_w(100)
    .gap(3)
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .flex_wrap()
        .child(
          div()
            .id(`am-name-${row.key}`)
            .rounded(3)
            .cursor_pointer()
            .text_size(13)
            .font_medium()
            .text_color(t.foreground)
            .when(quiet, (el) => el.opacity(0.45))
            .role("button")
            .accessibility_label(`${row.name}: edit command`)
            .tooltip(open ? "Hide command editor" : "Edit command and arguments")
            .on_click((_event: unknown, cx: { notify(): void }) =>
              (
                owner as { toggleExpand: (row: ViewRow, cx: { notify(): void }) => void }
              ).toggleExpand(row, cx),
            )
            .child(row.name as string),
        )
        .when(row.customized, (el) =>
          el.child(badge("Customized", t, { color: t.accent, border: true })),
        )
        .when(row.entryError, (el) =>
          el.child(badge("Invalid command", t, { color: t.blocked, border: true })),
        )
        .when(
          (row.supports as boolean) &&
            ((row.permission as string) !== "own" || (row.permissionOverride as boolean)),
          (el) => el.child(permissionBadge((row.permission as string) ?? "own", t)),
        ),
    )
    .child(
      (
        owner as { commandLine: (row: ViewRow, t: PartsTheme, quiet: boolean) => NativeElement }
      ).commandLine(row, t, quiet),
    );
}

function installLink(row: ViewRow, t: PartsTheme): NativeElement {
  return Link.new(`am-install-open-${row.key}`)
    .href(row.homepage ?? "")
    .tooltip(`Open ${row.name} installation guide`)
    .child(
      h_flex()
        .h(24)
        .px(8)
        .flex_none()
        .items_center()
        .justify_center()
        .rounded(6)
        .border_1()
        .border_color(t.border)
        .text_size(12)
        .font_medium()
        .text_color(t.foreground)
        .cursor_pointer()
        .hover((style) => style.bg(t.hover))
        .child("Install"),
    );
}

function editToggle(owner: ViewOwner, row: ViewRow, t: PartsTheme, open: boolean): NativeElement {
  return div()
    .id(`am-more-${row.key}`)
    .size(26)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(6)
    .text_color(t.muted)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .role("button")
    .accessibility_label(open ? `Hide ${row.name} command` : `Edit ${row.name} command`)
    .tooltip(open ? "Hide command editor" : "Edit command and arguments")
    .on_click((_event: unknown, cx: { notify(): void; stop_propagation(): void }) => {
      cx.stop_propagation();
      (owner as { toggleExpand: (row: ViewRow, cx: { notify(): void }) => void }).toggleExpand(
        row,
        cx,
      );
    })
    .child(
      svg(
        sharedAsset(
          `mods/orca-agent-settings/${open ? "chevron-down" : "chevron-right"}.svg`,
        ) as `#${string}`,
      ).size(14),
    );
}

function rowActions(owner: ViewOwner, row: ViewRow, t: PartsTheme, open: boolean): NativeElement {
  return h_flex()
    .ml_auto()
    .flex_none()
    .items_center()
    .gap(10)
    .child((owner as { toggle: (row: ViewRow, t: PartsTheme) => NativeElement }).toggle(row, t))
    .when(!(row.installed as boolean) && (row.homepage as string), (el) =>
      el.child(installLink(row, t)),
    )
    .when(!(row.installed as boolean) && !(row.homepage as string), (el) =>
      el.child(note(t.dim, "No install guide")),
    )
    .when(row.installed, (el) => el.child(editToggle(owner, row, t, open)));
}

type DraftResult = { run: string[] } | { error: string };

function draftSummary(
  editor: EditorLike,
  row: ViewRow,
): { draft: DraftResult; preview: string; dirty: boolean; saveLabel: string } {
  const cmd = (editor as { command: { value(): string } }).command;
  const args = (editor as { args: { value(): string } }).args;
  const draft = draftRun(cmd.value(), args.value(), editor.originalArgs);
  const hasRun = "run" in draft;
  return {
    draft,
    preview: hasRun ? formatArgv(draft.run) : "",
    dirty: hasRun ? !sameRun(draft.run, row.run as string[]) : true,
    saveLabel: editor.conflict ? "Overwrite" : "Save",
  };
}

function handleEditorEscapeKey(
  owner: ViewOwner,
  row: ViewRow,
  cx: { stop_propagation(): void; notify(): void; focus(): void },
): void {
  cancelEditing(owner, row, cx);
}

function handleEditorSubmitKey(
  owner: ViewOwner,
  row: ViewRow,
  cx: { stop_propagation(): void; notify(): void },
): void {
  cx.stop_propagation();
  (owner as { typing: boolean }).typing = false;
  (
    owner as { save: (row: ViewRow, cx: { stop_propagation(): void; notify(): void }) => void }
  ).save(row, cx);
}

function cancelEditing(
  owner: ViewOwner,
  row: ViewRow,
  cx: { stop_propagation(): void; notify(): void; focus(): void },
): void {
  cx.stop_propagation();
  (owner as { typing: boolean }).typing = false;
  (
    owner as {
      cancelEdit: (
        row: ViewRow,
        cx: { stop_propagation(): void; notify(): void; focus(): void },
      ) => void;
    }
  ).cancelEdit(row, cx);
  (owner as { handle: { focus(): void } }).handle.focus();
}

export function editorView(
  owner: ViewOwner,
  row: ViewRow,
  editor: EditorLike,
  t: PartsTheme,
): NativeElement {
  const mono = monoFont();
  const unsafeArgs = !argsEditable(editor.originalArgs);
  const { draft, preview, dirty, saveLabel } = draftSummary(editor, row);
  const fields = v_flex()
    .w_full()
    .pl(52)
    .pr(2)
    .pb(14)
    .gap(8)
    .when(editor.conflict, (el) => el.child(conflictBox(owner, row, editor, t)))
    .when(!(row.installed as boolean), (el) => el.child(notInstalledNotice(row, t)))
    .when(row.supports as boolean, (el) =>
      el.child(
        permissionRow(
          owner as {
            permissions: { default: string };
            setAgentPermission: (row: ViewRow, choice: string | null, cx: unknown) => void;
          },
          row,
          t,
        ),
      ),
    )
    .child(label("EXECUTABLE", t))
    .child(executableField(editor as { command: InputState }, mono, t))
    .on_key_down((_event: { key: string }, cx: { stop_propagation(): void }) => {
      handleEditorEscapeKey(
        owner,
        row,
        cx as { stop_propagation(): void; notify(): void; focus(): void },
      );
    })
    .child(
      note(t.dim, "A name from PATH or an absolute path. Spaces are allowed; quotes are literal."),
    )
    .child(label("LAUNCH ARGUMENTS", t))
    .when(unsafeArgs, (el) => el.child(unsafeArgsBox(editor as { originalArgs: unknown }, mono, t)))
    .when(!unsafeArgs, (el) => el.child(argsField(editor as { args: TextareaState }, mono, t)));
  return editorFooter(fields, {
    owner,
    row,
    editor,
    t,
    mono,
    unsafeArgs,
    draft,
    preview,
    dirty,
    saveLabel,
  });
}

type EditorFooterOptions = {
  owner: ViewOwner;
  row: ViewRow;
  editor: EditorLike;
  t: PartsTheme;
  mono: string;
  unsafeArgs: boolean;
  draft: DraftResult;
  preview: string;
  dirty: boolean;
  saveLabel: string;
};

function editorFooter(fields: NativeElement, options: EditorFooterOptions): NativeElement {
  const { owner, row, t, mono, unsafeArgs, draft, preview } = options;
  const footer = fields
    .on_key_down(
      (
        _event: { key: string; keystroke?: string },
        cx: { stop_propagation(): void; notify(): void },
      ) => {
        if (_event.keystroke === "cmd-enter" || _event.keystroke === "ctrl-enter") {
          handleEditorSubmitKey(owner, row, cx);
        } else if (_event.key === "escape") {
          handleEditorEscapeKey(
            owner,
            row,
            cx as { stop_propagation(): void; notify(): void; focus(): void },
          );
        }
      },
    )
    .when(!unsafeArgs, (el) =>
      el.child(
        note(
          t.dim,
          "One argument per line; spaces, quotes and backslashes stay literal. Blank lines are ignored.",
        ),
      ),
    )
    .child(previewLine(draft, preview, mono, t))
    .when((row.customized as boolean) && (row.builtin as boolean), (el) =>
      el.child(resetRow(owner, row, mono, t)),
    )
    .when((row.customized as boolean) && !(row.builtin as boolean), (el) =>
      el.child(
        note(
          t.dim,
          "This agent was added in programs.json; there is no built-in command to reset to.",
        ),
      ),
    );
  return editorFooterActions(footer, options);
}

function editorFooterActions(footer: NativeElement, options: EditorFooterOptions): NativeElement {
  const { owner, row, t } = options;
  return footer
    .when(row.entryError as string, (el) => el.child(note(t.blocked, row.entryError as string)))
    .when((options.editor as { error?: string }).error, (el) =>
      el.child(note(t.blocked, (options.editor as { error?: string }).error as string)),
    )
    .when((owner as { writeError?: string }).writeError && options.editor.conflict, (el) =>
      el.child(note(t.blocked, (owner as { writeError?: string }).writeError as string)),
    )
    .child(
      editorActions(
        owner,
        row,
        {
          saveLabel: options.saveLabel,
          disabled: !(options.dirty as boolean) && !(options.editor.conflict as boolean),
        },
        t,
      ),
    )
    .when(row.installed as boolean, (el) =>
      el.child(
        (
          owner as { uninstallSection: (row: ViewRow, t: PartsTheme) => NativeElement }
        ).uninstallSection(row, t),
      ),
    );
}

function conflictBox(
  owner: ViewOwner,
  row: ViewRow,
  editor: EditorLike,
  t: PartsTheme,
): NativeElement {
  return v_flex()
    .gap(6)
    .p(10)
    .rounded(8)
    .border_1()
    .border_color(t.blocked)
    .bg("#ef444414")
    .child(
      note(
        t.blocked,
        "programs.json changed on disk. Your draft is kept; reload or overwrite this agent's command.",
      ),
    )
    .child(conflictActions(owner, row, editor, t));
}

function conflictActions(
  owner: ViewOwner,
  row: ViewRow,
  editor: EditorLike,
  t: PartsTheme,
): NativeElement {
  const button = (owner as { button: SettingsButton }).button;
  return h_flex()
    .gap(8)
    .child(
      button(
        `am-reload-${row.key}`,
        "Reload",
        t,
        (_event, cx) =>
          (owner as { reloadRow: (row: ViewRow, cx: unknown) => void }).reloadRow(row, cx),
        { height: 24, px: 8 },
      ),
    )
    .child(
      button(
        `am-force-${row.key}`,
        "Overwrite",
        t,
        (_event, cx) => {
          (editor as { force?: boolean }).force = true;
          (owner as { save: (row: ViewRow, cx: unknown) => void }).save(row, cx);
        },
        { height: 24, px: 8, color: t.blocked },
      ),
    );
}

function notInstalledNotice(row: ViewRow, t: PartsTheme): NativeElement {
  return h_flex()
    .gap(6)
    .items_center()
    .flex_wrap()
    .child(note(t.dim, "This CLI is not installed."))
    .when(row.homepage as string, (inner) =>
      inner.child(guideLink(`am-guide-${row.key}`, "Install guide ↗", row, t)),
    );
}

function executableField(
  editor: { command: InputState },
  mono: string,
  t: PartsTheme,
): NativeElement {
  return h_flex()
    .w_full()
    .h(30)
    .px(8)
    .rounded(6)
    .border_1()
    .border_color(t.input)
    .bg(t.background)
    .child(
      Input.new(editor.command)
        .w_full()
        .font_family(mono)
        .text_size(12)
        .text_color(t.foreground)
        .bg("#00000000"),
    );
}

function unsafeArgsBox(
  editor: { originalArgs: unknown },
  mono: string,
  t: PartsTheme,
): NativeElement {
  return v_flex()
    .w_full()
    .gap(6)
    .p(8)
    .rounded(6)
    .border_1()
    .border_color(t.border)
    .bg(t.background)
    .child(
      div()
        .font_family(mono)
        .text_size(11)
        .text_color(t.muted)
        .child(formatArgv(editor.originalArgs as string[]) || "No arguments"),
    )
    .child(
      note(
        t.dim,
        "These arguments contain an empty or multi-line value, which this line editor cannot change without losing data. Only the executable is editable here; edit programs.json to change the arguments.",
      ),
    );
}

function argsField(editor: { args: TextareaState }, mono: string, t: PartsTheme): NativeElement {
  return v_flex()
    .w_full()
    .h(76)
    .px(8)
    .py(6)
    .rounded(6)
    .border_1()
    .border_color(t.input)
    .bg(t.background)
    .child(
      Textarea.new(editor.args)
        .size_full()
        .font_family(mono)
        .text_size(11)
        .text_color(t.foreground)
        .bg("#00000000"),
    );
}

function previewColor(
  draft: DraftResult,
  preview: string,
  t: PartsTheme,
): ReturnType<typeof themeColor> {
  if (preview) return t.muted;
  return themeColor("error" in draft ? t.blocked : t.dim);
}

function previewText(draft: DraftResult, preview: string): string {
  if (preview) return `Runs: ${preview}`;
  if ("error" in draft) return draft.error;
  return "Runs: (nothing yet)";
}

function previewLine(
  draft: DraftResult,
  preview: string,
  mono: string,
  t: PartsTheme,
): NativeElement {
  return div()
    .min_w(0)
    .truncate()
    .font_family(mono)
    .text_size(11)
    .text_color(previewColor(draft, preview, t))
    .child(previewText(draft, preview));
}

function resetRow(owner: ViewOwner, row: ViewRow, mono: string, t: PartsTheme): NativeElement {
  return h_flex()
    .gap(6)
    .items_center()
    .child(
      div()
        .font_family(mono)
        .text_size(11)
        .text_color(t.dim)
        .child(`Default: ${formatArgv((row.defaultCmd as string[] | undefined) ?? [])}`),
    )
    .child(
      (
        owner as {
          button: (
            id: string,
            label: string,
            t: PartsTheme,
            handler: (_event: unknown, cx: unknown) => void,
            opts?: { height?: number; px?: number; color?: unknown },
          ) => NativeElement;
        }
      ).button(
        `am-reset-${row.key}`,
        "Reset to default",
        t,
        (_event: unknown, cx: unknown) =>
          (owner as { reset: (row: ViewRow, cx: unknown) => void }).reset(row, cx),
        {
          height: 24,
          px: 8,
          color: t.muted,
        },
      ),
    );
}

function editorActions(
  owner: ViewOwner,
  row: ViewRow,
  opts: { saveLabel: string; disabled: boolean },
  t: PartsTheme,
): NativeElement {
  const button = (owner as { button: SettingsButton }).button;
  return h_flex()
    .w_full()
    .flex_wrap()
    .gap(8)
    .items_center()
    .justify_end()
    .when((owner as { savedKey?: string }).savedKey === row.key, (el) =>
      el.child(note(t.done, "Saved · commands re-checked")),
    )
    .child(
      button(
        `am-cancel-${row.key}`,
        "Cancel",
        t,
        (_event: unknown, cx: unknown) =>
          (owner as { cancelEdit: (row: ViewRow, cx: unknown) => void }).cancelEdit(row, cx),
        {
          height: 26,
          px: 10,
          color: t.muted,
        },
      ),
    )
    .child(
      button(
        `am-save-${row.key}`,
        opts.saveLabel,
        t,
        (_event: unknown, cx: unknown) =>
          (owner as { save: (row: ViewRow, cx: unknown) => void }).save(row, cx),
        {
          height: 26,
          px: 12,
          primary: true,
          disabled: opts.disabled,
        },
      ),
    );
}

function uninstallState(
  owner: ViewOwner,
  row: ViewRow,
): { request: unknown; action: unknown; phase: string | undefined; method: unknown } {
  const uninstall = (
    owner as { uninstall?: { key?: string; phase?: string; message?: string; status?: unknown } }
  ).uninstall;
  const request = uninstall?.key === row.key ? uninstall : null;
  const action = (
    owner as { action?: { key?: string; kind?: string; phase?: string; message?: string } }
  ).action;
  const actionMatch = action?.key === row.key && action?.kind === "uninstall" ? action : null;
  return {
    request,
    action: actionMatch,
    phase: request?.phase,
    method: installMethodFor(row.key as string),
  };
}

export function uninstallSectionView(owner: ViewOwner, row: ViewRow, t: PartsTheme): NativeElement {
  const { request, action, phase, method } = uninstallState(owner, row);
  return v_flex()
    .w_full()
    .gap(6)
    .pt(12)
    .mt(4)
    .border_t(1)
    .border_color(t.border)
    .child(label("UNINSTALL", t))
    .when(!method, (el) =>
      el
        .child(
          note(
            t.muted,
            "No verified automatic uninstall is defined for this CLI. Use its official install guide to remove it.",
          ),
        )
        .when(row.homepage as string, (inner) =>
          inner.child(guideLink(`am-uninstall-guide-${row.key}`, "Official guide ↗", row, t)),
        ),
    )
    .when(Boolean(method) && (!request || phase === "error"), (el) =>
      el.child(uninstallButtonRow(owner, row, t)),
    )
    .when(phase === "confirm", (el) => el.child(confirmBox(owner, row, request, t)))
    .when(phase === "checking" || phase === "running", (el) => el.child(progressRow(request, t)))
    .when(phase === "error", (el) =>
      el.child(note(t.blocked, (request as { message?: string }).message as string)),
    )
    .when(
      (action as { phase?: string }) && (action as { phase?: string }).phase !== "running",
      (el) =>
        el.child(
          note(
            (action as { phase?: string }).phase === "done" ? t.muted : t.blocked,
            (action as { message?: string }).message as string,
          ),
        ),
    );
}

function uninstallButtonRow(owner: ViewOwner, row: ViewRow, t: PartsTheme): NativeElement {
  return h_flex()
    .gap(8)
    .items_center()
    .child(
      (
        owner as {
          button: (
            id: string,
            label: string,
            t: PartsTheme,
            handler: (_event: unknown, cx: unknown) => void,
            opts?: { height?: number; px?: number; color?: unknown; disabled?: boolean },
          ) => NativeElement;
        }
      ).button(
        `am-uninstall-${row.key}`,
        "Uninstall…",
        t,
        (_event: unknown, cx: unknown) =>
          (owner as { requestUninstall: (row: ViewRow, cx: unknown) => void }).requestUninstall(
            row,
            cx,
          ),
        {
          height: 26,
          px: 10,
          color: t.blocked,
          disabled:
            (owner as { action?: { phase?: string }; uninstall?: { phase?: string } }).action
              ?.phase === "running" ||
            (owner as { action?: { phase?: string }; uninstall?: { phase?: string } }).uninstall
              ?.phase === "checking",
        },
      ),
    )
    .when(row.homepage as string, (inner) =>
      inner.child(guideLink(`am-uninstall-guide-${row.key}`, "Official guide ↗", row, t)),
    );
}

function confirmBox(
  owner: ViewOwner,
  row: ViewRow,
  request: unknown,
  t: PartsTheme,
): NativeElement {
  return v_flex()
    .gap(8)
    .p(10)
    .rounded(8)
    .border_1()
    .border_color(t.blocked)
    .bg("#ef444414")
    .child(
      note(
        t.blocked,
        `Remove ${row.name}? This runs npm uninstall -g ${(request as { status?: { method?: { package?: string } } }).status?.method?.package as string}. It does not delete settings, sessions, or your command override.`,
      ),
    )
    .child(confirmActions(owner, row, t));
}

function confirmActions(owner: ViewOwner, row: ViewRow, t: PartsTheme): NativeElement {
  const button = (owner as { button: SettingsButton }).button;
  return h_flex()
    .gap(8)
    .child(
      button(
        `am-uninstall-cancel-${row.key}`,
        "Cancel",
        t,
        (_event, cx) => (owner as { cancelUninstall: (cx: unknown) => void }).cancelUninstall(cx),
        { height: 24, px: 8, color: t.muted },
      ),
    )
    .child(
      button(
        `am-uninstall-confirm-${row.key}`,
        "Confirm uninstall",
        t,
        (_event, cx) =>
          (owner as { confirmUninstall: (row: ViewRow, cx: unknown) => void }).confirmUninstall(
            row,
            cx,
          ),
        { height: 24, px: 8, color: t.blocked },
      ),
    );
}

function progressRow(request: unknown, t: PartsTheme): NativeElement {
  return h_flex()
    .gap(6)
    .items_center()
    .child(div().text_size(11).text_color(t.accent).frames(["◐", "◓", "◑", "◒"], 120))
    .child(
      note(
        t.muted,
        (request as { phase?: string }).phase === "checking"
          ? "Checking the installation method…"
          : "Uninstalling…",
      ),
    );
}

const SHARED_ASSET_PATHS: Record<string, string> = Object.freeze({
  "mods/orca-agent-settings/chevron-down.svg":
    "mods/orca-assets/chevron-down--orca-agent-settings.svg",
  "mods/orca-agent-settings/chevron-left.svg":
    "mods/orca-assets/chevron-left--orca-agent-settings.svg",
  "mods/orca-agent-settings/chevron-right.svg":
    "mods/orca-assets/chevron-right--orca-agent-settings.svg",
  "mods/orca-agent-settings/eye.svg": "mods/orca-assets/eye--orca-agent-flyout.svg",
  "mods/orca-agent-settings/square-terminal.svg":
    "mods/orca-assets/square-terminal--orca-agent-settings.svg",
});
function sharedAsset(path: string): string {
  return SHARED_ASSET_PATHS[path] ?? `mods/orca-assets/${path.slice(path.lastIndexOf("/") + 1)}`;
}
