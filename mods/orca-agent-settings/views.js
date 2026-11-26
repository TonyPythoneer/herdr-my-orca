// Stateful view builders of the Agent Settings page: each takes the page (`owner`) and reads its state.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, Textarea, Link } from "gpui-base";
import { LIST_ROW_HEIGHT, argsEditable, draftRun, formatArgv } from "./state.js";
import { installMethodFor } from "./install.js";
import { sameRun } from "./util.js";
import { permissionRow } from "./permission-menu.js";
import { badge, icon, monoFont, permissionBadge } from "./parts.js";

// A small line of text under a field or a button.
const note = (color, text) => div().text_size(11).text_color(color).child(text);
// The section label above a field.
const label = (text, t) => div().text_size(10).font_semibold().text_color(t.dim).child(text);

// A link to the agent's install guide; `text` says which guide.
const guideLink = (id, text, row, t) =>
  Link.new(id)
    .href(row.homepage)
    .text_size(11)
    .text_color(t.accent)
    .underline()
    .tooltip(row.homepage)
    .child(text);

export function rowView(owner, row, t, last = false) {
  const open = owner.expanded.has(row.key);
  const editor = owner.editors.get(row.key);
  const quiet = !row.enabled;
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
    .when(open && editor, (el) => el.child(owner.editor(row, editor, t)));
}

function rowIconTile(row, t, quiet) {
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
    .child(icon(row, 18, t));
}

function rowTitle(owner, row, t, open, quiet) {
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
            .on_click((_event, cx) => owner.toggleExpand(row, cx))
            .child(row.name),
        )
        .when(row.customized, (el) => el.child(badge("Customized", t, { color: t.accent, border: true })))
        .when(row.entryError, (el) => el.child(badge("Invalid command", t, { color: t.blocked, border: true })))
        // A plain `own` is the default, so only a pinned or custom permission gets a badge.
        .when(
          row.supports && (row.permission !== "own" || row.permissionOverride),
          (el) => el.child(permissionBadge(row.permission, t)),
        ),
    )
    .child(owner.commandLine(row, t, quiet));
}

// The "Install" link of an agent that is not installed.
function installLink(row, t) {
  return Link.new(`am-install-open-${row.key}`)
    .href(row.homepage)
    .tooltip(`Open ${row.name} installation guide`)
    .child(
      h_flex().h(24).px(8).flex_none().items_center().justify_center().rounded(6)
        .border_1().border_color(t.border).text_size(12).font_medium()
        .text_color(t.foreground).cursor_pointer().hover((style) => style.bg(t.hover))
        .child("Install"),
    );
}

// The chevron that opens and closes the command editor.
function editToggle(owner, row, t, open) {
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
    .on_click((_event, cx) => {
      cx.stop_propagation();
      owner.toggleExpand(row, cx);
    })
    .child(svg(sharedAsset(`mods/orca-agent-settings/${open ? "chevron-down" : "chevron-right"}.svg`)).size(14));
}

function rowActions(owner, row, t, open) {
  return h_flex()
    .ml_auto()
    .flex_none()
    .items_center()
    .gap(10)
    .child(owner.toggle(row, t))
    .when(!row.installed && row.homepage, (el) => el.child(installLink(row, t)))
    .when(!row.installed && !row.homepage, (el) => el.child(note(t.dim, "No install guide")))
    .when(row.installed, (el) => el.child(editToggle(owner, row, t, open)));
}

// What the draft would run, whether it differs from the saved command, and what to call Save.
function draftSummary(editor, row) {
  const draft = draftRun(editor.command.value(), editor.args.value(), editor.originalArgs);
  return {
    draft,
    preview: draft.run ? formatArgv(draft.run) : "",
    dirty: draft.run ? !sameRun(draft.run, row.run) : true,
    saveLabel: editor.conflict ? "Overwrite" : "Save",
  };
}

// Escape inside an input closes the editor and gives the page its keys back.
function cancelEditing(owner, row, cx) {
  cx.stop_propagation();
  owner.typing = false;
  owner.cancelEdit(row, cx);
  owner.handle.focus();
}

export function editorView(owner, row, editor, t) {
  const mono = monoFont();
  const unsafeArgs = !argsEditable(editor.originalArgs);
  const { draft, preview, dirty, saveLabel } = draftSummary(editor, row);
  return v_flex()
    .w_full()
    .pl(52)
    .pr(2)
    .pb(14)
    .gap(8)
    .when(editor.conflict, (el) => el.child(conflictBox(owner, row, editor, t)))
    .when(!row.installed, (el) => el.child(notInstalledNotice(row, t)))
    .when(row.supports, (el) => el.child(permissionRow(owner, row, t)))
    .child(label("EXECUTABLE", t))
    .child(executableField(editor, mono, t))
    .on_key_down((event, cx) => {
      if (event.key === "escape") cancelEditing(owner, row, cx);
    })
    .child(note(t.dim, "A name from PATH or an absolute path. Spaces are allowed; quotes are literal."))
    .child(label("LAUNCH ARGUMENTS", t))
    .when(unsafeArgs, (el) => el.child(unsafeArgsBox(editor, mono, t)))
    .when(!unsafeArgs, (el) => el.child(argsField(editor, mono, t)))
    .on_key_down((event, cx) => {
      if (event.keystroke === "cmd-enter" || event.keystroke === "ctrl-enter") {
        cx.stop_propagation();
        owner.typing = false;
        owner.save(row, cx);
      } else if (event.key === "escape") {
        cancelEditing(owner, row, cx);
      }
    })
    .when(!unsafeArgs, (el) =>
      el.child(note(t.dim, "One argument per line; spaces, quotes and backslashes stay literal. Blank lines are ignored.")),
    )
    .child(previewLine(draft, preview, mono, t))
    .when(row.customized && row.builtin, (el) => el.child(resetRow(owner, row, mono, t)))
    .when(row.customized && !row.builtin, (el) =>
      el.child(note(t.dim, "This agent was added in programs.json; there is no built-in command to reset to.")),
    )
    .when(row.entryError, (el) => el.child(note(t.blocked, row.entryError)))
    .when(editor.error, (el) => el.child(note(t.blocked, editor.error)))
    .when(owner.writeError && editor.conflict, (el) => el.child(note(t.blocked, owner.writeError)))
    .child(editorActions(owner, row, { saveLabel, disabled: !dirty && !editor.conflict }, t))
    .when(row.installed, (el) => el.child(owner.uninstallSection(row, t)));
}

// The draft was made before programs.json changed on disk: reload it or overwrite the file.
function conflictBox(owner, row, editor, t) {
  return v_flex()
    .gap(6)
    .p(10)
    .rounded(8)
    .border_1()
    .border_color(t.blocked)
    .bg("#ef444414")
    .child(note(t.blocked, "programs.json changed on disk. Your draft is kept; reload or overwrite this agent's command."))
    .child(
      h_flex()
        .gap(8)
        .child(owner.button(`am-reload-${row.key}`, "Reload", t, (_event, cx) => owner.reloadRow(row, cx), { height: 24, px: 8 }))
        .child(owner.button(`am-force-${row.key}`, "Overwrite", t, (_event, cx) => {
          editor.force = true;
          owner.save(row, cx);
        }, { height: 24, px: 8, color: t.blocked })),
    );
}

function notInstalledNotice(row, t) {
  return h_flex()
    .gap(6)
    .items_center()
    .flex_wrap()
    .child(note(t.dim, "This CLI is not installed."))
    .when(row.homepage, (inner) => inner.child(guideLink(`am-guide-${row.key}`, "Install guide ↗", row, t)));
}

function executableField(editor, mono, t) {
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

// Arguments that hold an empty or multi-line value cannot be edited line by line without losing data.
function unsafeArgsBox(editor, mono, t) {
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
        .child(formatArgv(editor.originalArgs) || "No arguments"),
    )
    .child(
      note(
        t.dim,
        "These arguments contain an empty or multi-line value, which this line editor cannot change without losing data. Only the executable is editable here; edit programs.json to change the arguments.",
      ),
    );
}

function argsField(editor, mono, t) {
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

function previewColor(draft, preview, t) {
  if (preview) return t.muted;
  return draft.error ? t.blocked : t.dim;
}

// "Runs: ..." in muted text, or why the draft cannot run in the error colour.
function previewLine(draft, preview, mono, t) {
  return div()
    .min_w(0)
    .truncate()
    .font_family(mono)
    .text_size(11)
    .text_color(previewColor(draft, preview, t))
    .child(preview ? `Runs: ${preview}` : draft.error ?? "Runs: (nothing yet)");
}

function resetRow(owner, row, mono, t) {
  return h_flex()
    .gap(6)
    .items_center()
    .child(div().font_family(mono).text_size(11).text_color(t.dim).child(`Default: ${formatArgv(row.defaultCmd)}`))
    .child(
      owner.button(`am-reset-${row.key}`, "Reset to default", t, (_event, cx) => owner.reset(row, cx), {
        height: 24,
        px: 8,
        color: t.muted,
      }),
    );
}

function editorActions(owner, row, { saveLabel, disabled }, t) {
  return h_flex()
    .w_full()
    .flex_wrap()
    .gap(8)
    .items_center()
    .justify_end()
    .when(owner.savedKey === row.key, (el) => el.child(note(t.done, "Saved · commands re-checked")))
    .child(
      owner.button(`am-cancel-${row.key}`, "Cancel", t, (_event, cx) => owner.cancelEdit(row, cx), {
        height: 26,
        px: 10,
        color: t.muted,
      }),
    )
    .child(
      owner.button(`am-save-${row.key}`, saveLabel, t, (_event, cx) => owner.save(row, cx), {
        height: 26,
        px: 12,
        primary: true,
        disabled,
      }),
    );
}

// This agent's uninstall request and last action, if the page holds any, and its verified npm method.
function uninstallState(owner, row) {
  const request = owner.uninstall?.key === row.key ? owner.uninstall : null;
  const action = owner.action?.key === row.key && owner.action.kind === "uninstall" ? owner.action : null;
  return { request, action, phase: request?.phase, method: installMethodFor(row.key) };
}

export function uninstallSectionView(owner, row, t) {
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
        .child(note(t.muted, "No verified automatic uninstall is defined for this CLI. Use its official install guide to remove it."))
        .when(row.homepage, (inner) => inner.child(guideLink(`am-uninstall-guide-${row.key}`, "Official guide ↗", row, t))),
    )
    .when(Boolean(method) && (!request || phase === "error"), (el) => el.child(uninstallButtonRow(owner, row, t)))
    .when(phase === "confirm", (el) => el.child(confirmBox(owner, row, request, t)))
    .when(phase === "checking" || phase === "running", (el) => el.child(progressRow(request, t)))
    .when(phase === "error", (el) => el.child(note(t.blocked, request.message)))
    .when(Boolean(action) && action.phase !== "running", (el) =>
      el.child(note(action.phase === "done" ? t.muted : t.blocked, action.message)),
    );
}

function uninstallButtonRow(owner, row, t) {
  return h_flex()
    .gap(8)
    .items_center()
    .child(
      owner.button(`am-uninstall-${row.key}`, "Uninstall…", t, (_event, cx) => owner.requestUninstall(row, cx), {
        height: 26,
        px: 10,
        color: t.blocked,
        disabled: owner.action?.phase === "running" || owner.uninstall?.phase === "checking",
      }),
    )
    .when(row.homepage, (inner) => inner.child(guideLink(`am-uninstall-guide-${row.key}`, "Official guide ↗", row, t)));
}

function confirmBox(owner, row, request, t) {
  return v_flex()
    .gap(8)
    .p(10)
    .rounded(8)
    .border_1()
    .border_color(t.blocked)
    .bg("#ef444414")
    .child(
      note(t.blocked, `Remove ${row.name}? This runs npm uninstall -g ${request.status.method.package}. It does not delete settings, sessions, or your command override.`),
    )
    .child(
      h_flex()
        .gap(8)
        .child(owner.button(`am-uninstall-cancel-${row.key}`, "Cancel", t, (_event, cx) => owner.cancelUninstall(cx), { height: 24, px: 8, color: t.muted }))
        .child(owner.button(`am-uninstall-confirm-${row.key}`, "Confirm uninstall", t, (_event, cx) => owner.confirmUninstall(row, cx), { height: 24, px: 8, color: t.blocked })),
    );
}

function progressRow(request, t) {
  return h_flex()
    .gap(6)
    .items_center()
    .child(div().text_size(11).text_color(t.accent).frames(["◐", "◓", "◑", "◒"], 120))
    .child(note(t.muted, request.phase === "checking" ? "Checking the installation method…" : "Uninstalling…"));
}

const SHARED_ASSET_PATHS = Object.freeze({
  "mods/orca-agent-settings/chevron-down.svg": "mods/orca-assets/chevron-down--orca-agent-settings.svg",
  "mods/orca-agent-settings/chevron-left.svg": "mods/orca-assets/chevron-left--orca-agent-settings.svg",
  "mods/orca-agent-settings/chevron-right.svg": "mods/orca-assets/chevron-right--orca-agent-settings.svg",
  "mods/orca-agent-settings/eye.svg": "mods/orca-assets/eye--orca-agent-flyout.svg",
  "mods/orca-agent-settings/square-terminal.svg": "mods/orca-assets/square-terminal--orca-agent-settings.svg"
});
function sharedAsset(path) {
  return SHARED_ASSET_PATHS[path] ?? `mods/orca-assets/${path.slice(path.lastIndexOf("/") + 1)}`;
}
