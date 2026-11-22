// Stateful view builders of the Agent Manager page: each takes the page (`owner`) and reads its state.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, Textarea, Link } from "gpui-base";
import { settings } from "herdr";
import { LIST_ROW_HEIGHT, argsEditable, draftRun, formatArgv } from "./state.js";
import { installMethodFor } from "./install.js";
import { sameRun } from "./util.js";
import { PERMISSION_AGENT_LABELS, PERMISSION_LABELS, permissionChoices } from "./permissions.js";
import { badge, icon, permissionBadge } from "./parts.js";

/**
 * A dropdown built from inline children, so it needs no popup: the trigger reads like an input and
 * the menu opens straight below it. Items pick through their own handler.
 */
export function permissionSelect(spec, t) {
  const tone = spec.tone ?? t.foreground;
  return v_flex()
    .flex_none()
    .items_end()
    .gap(6)
    .child(
      h_flex()
        .id(`am-perm-${spec.id}`)
        .h(28)
        .px(10)
        .gap(8)
        .flex_none()
        .items_center()
        .justify_between()
        .rounded(6)
        .border_1()
        .border_color(spec.open ? t.ring : t.input)
        .bg(t.raised)
        .cursor_pointer()
        .role("button")
        .accessibility_label(`${spec.label}: choose permission`)
        .tooltip("Choose how much this agent may do without asking")
        .on_click((_event, cx) => spec.onToggle(cx))
        .child(
          h_flex()
            .min_w(0)
            .gap(6)
            .items_center()
            .child(div().text_size(12).font_medium().text_color(tone).child(spec.label)),
        )
        .child(svg("mods/orca-agent-manager/chevron-down.svg").size(12).flex_none().text_color(t.muted)),
    )
    .when(spec.open, (el) =>
      el.child(
        v_flex()
          .w(spec.width ?? 320)
          .p(4)
          .gap(1)
          .rounded(8)
          .border_1()
          .border_color(t.border)
          .bg(t.popover)
          .children(
            spec.items.map((item) =>
              v_flex()
                .id(`am-perm-${spec.id}-${item.id}`)
                .w_full()
                .px(8)
                .py(6)
                .gap(2)
                .rounded(6)
                .cursor_pointer()
                .hover((style) => style.bg(t.hover))
                .role("button")
                .accessibility_label(item.label)
                .on_click((_event, cx) => item.onPick(cx))
                .child(
                  h_flex()
                    .gap(6)
                    .items_center()
                    .child(div().size(5).flex_none().rounded_full().bg(item.selected ? t.foreground : "#00000000"))
                    .child(div().text_size(12).font_medium().text_color(item.tone ?? t.foreground).child(item.label)),
                )
                .when(item.description, (inner) =>
                  inner.child(div().pl(11).text_size(11).text_color(t.muted).child(item.description)),
                )
                .when(item.detail, (inner) =>
                  inner.child(div().pl(11).text_size(10).text_color(t.dim).child(item.detail)),
                ),
            ),
          ),
      ),
    );
}

/** The effective permission for one agent, right above the command it is written into. */
export function permissionRow(owner, row, t) {
  const choices = permissionChoices(row.key) ?? [];
  const permissions = owner.currentPermissions();
  const override = Boolean(row.permissionOverride);
  const items = [];
  if (override && choices.includes(permissions.default)) {
    items.push({
      id: "default",
      label: `Same as all agents · ${PERMISSION_LABELS[permissions.default]}`,
      onPick: (cx) => owner.setAgentPermission(row, "default", cx),
    });
  }
  for (const choice of choices) {
    items.push({
      id: choice,
      label: PERMISSION_AGENT_LABELS[choice],
      selected: row.permission === choice,
      tone: choice === "full-access" ? t.blocked : null,
      onPick: (cx) => owner.setAgentPermission(row, choice, cx),
    });
  }
  const note =
    row.permission === "custom"
      ? "This command sets its own permission flags; a choice here replaces them."
      : override
        ? `Set for this agent; every other agent follows ${PERMISSION_LABELS[permissions.default].toLowerCase()}.`
        : `Follows all agents (${PERMISSION_LABELS[permissions.default].toLowerCase()}).`;
  return v_flex()
    .w_full()
    .gap(6)
    .child(div().text_size(10).font_semibold().text_color(t.dim).child("PERMISSION"))
    .child(
      h_flex()
        .w_full()
        .gap(10)
        .items_center()
        .flex_wrap()
        .child(
          permissionSelect(
            {
              id: row.key,
              open: owner.permissionOpen === row.key,
              label: PERMISSION_AGENT_LABELS[row.permission] ?? "Custom",
              tone: row.permission === "full-access" ? t.blocked : t.foreground,
              width: 260,
              items,
              onToggle: (cx) => owner.togglePermissionMenu(row.key, cx),
            },
            t,
          ),
        )
        .child(div().flex_1().min_w(140).text_size(11).text_color(t.muted).child(note)),
    );
}

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
        .child(
          h_flex()
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
            .child(icon(row, 18, t)),
        )
        .child(
          v_flex()
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
            .child(owner.commandLine(row, t, quiet)),
        )
        .child(
          h_flex()
            .ml_auto()
            .flex_none()
            .items_center()
            .gap(10)
            .child(owner.toggle(row, t))
            .when(!row.installed && row.homepage, (el) =>
              el.child(
                Link.new(`am-install-open-${row.key}`)
                  .href(row.homepage)
                  .tooltip(`Open ${row.name} installation guide`)
                  .child(
                    h_flex().h(24).px(8).flex_none().items_center().justify_center().rounded(6)
                      .border_1().border_color(t.border).text_size(12).font_medium()
                      .text_color(t.foreground).cursor_pointer().hover((style) => style.bg(t.hover))
                      .child("Install"),
                  ),
              ),
            )
            .when(!row.installed && !row.homepage, (el) =>
              el.child(div().text_size(11).text_color(t.dim).child("No install guide")),
            )
            .when(row.installed, (el) => el.child(
              div()
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
                .child(svg(`mods/orca-agent-manager/${open ? "chevron-down" : "chevron-right"}.svg`).size(14)),
            )),
        ),
    )
    .when(open && editor, (el) => el.child(owner.editor(row, editor, t)));
}

export function editorView(owner, row, editor, t) {
  const mono = settings()?.font_family ?? "JetBrains Mono";
  const unsafeArgs = !argsEditable(editor.originalArgs);
  const draft = draftRun(editor.command.value(), editor.args.value(), editor.originalArgs);
  const preview = draft.run ? formatArgv(draft.run) : "";
  const saveLabel = editor.conflict ? "Overwrite" : "Save";
  const dirty = draft.run ? !sameRun(draft.run, row.run) : true;
  return v_flex()
    .w_full()
    .pl(52)
    .pr(2)
    .pb(14)
    .gap(8)
    .when(editor.conflict, (el) =>
      el.child(
        v_flex()
          .gap(6)
          .p(10)
          .rounded(8)
          .border_1()
          .border_color(t.blocked)
          .bg("#ef444414")
          .child(
            div()
              .text_size(11)
              .text_color(t.blocked)
              .child("programs.json changed on disk. Your draft is kept; reload or overwrite this agent's command."),
          )
          .child(
            h_flex()
              .gap(8)
              .child(owner.button(`am-reload-${row.key}`, "Reload", t, (_event, cx) => owner.reloadRow(row, cx), { height: 24, px: 8 }))
              .child(owner.button(`am-force-${row.key}`, "Overwrite", t, (_event, cx) => {
                editor.force = true;
                owner.save(row, cx);
              }, { height: 24, px: 8, color: t.blocked })),
          ),
      ),
    )
    .when(!row.installed, (el) =>
      el.child(
        h_flex()
          .gap(6)
          .items_center()
          .flex_wrap()
          .child(div().text_size(11).text_color(t.dim).child("This CLI is not installed."))
          .when(row.homepage, (inner) =>
            inner.child(
              Link.new(`am-guide-${row.key}`)
                .href(row.homepage)
                .text_size(11)
                .text_color(t.accent)
                .underline()
                .tooltip(row.homepage)
                .child("Install guide ↗"),
            ),
          ),
      ),
    )
    .when(row.supports, (el) => el.child(permissionRow(owner, row, t)))
    .child(div().text_size(10).font_semibold().text_color(t.dim).child("EXECUTABLE"))
    .child(
      h_flex()
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
        ),
    )
    .on_key_down((event, cx) => {
      if (event.key !== "escape") return;
      cx.stop_propagation();
      owner.typing = false;
      owner.cancelEdit(row, cx);
      owner.handle.focus();
    })
    .child(
      div()
        .text_size(11)
        .text_color(t.dim)
        .child("A name from PATH or an absolute path. Spaces are allowed; quotes are literal."),
    )
    .child(div().text_size(10).font_semibold().text_color(t.dim).child("LAUNCH ARGUMENTS"))
    .when(unsafeArgs, (el) =>
      el.child(
        v_flex()
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
            div()
              .text_size(11)
              .text_color(t.dim)
              .child(
                "These arguments contain an empty or multi-line value, which this line editor cannot change without losing data. Only the executable is editable here; edit programs.json to change the arguments.",
              ),
          ),
      ),
    )
    .when(!unsafeArgs, (el) =>
      el.child(
        v_flex()
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
          ),
      ),
    )
    .on_key_down((event, cx) => {
      if (event.keystroke === "cmd-enter" || event.keystroke === "ctrl-enter") {
        cx.stop_propagation();
        owner.typing = false;
        owner.save(row, cx);
      } else if (event.key === "escape") {
        cx.stop_propagation();
        owner.typing = false;
        owner.cancelEdit(row, cx);
        owner.handle.focus();
      }
    })
    .when(!unsafeArgs, (el) =>
      el.child(div().text_size(11).text_color(t.dim).child("One argument per line; spaces, quotes and backslashes stay literal. Blank lines are ignored.")),
    )
    .child(
      div()
        .min_w(0)
        .truncate()
        .font_family(mono)
        .text_size(11)
        .text_color(preview ? t.muted : draft.error ? t.blocked : t.dim)
        .child(preview ? `Runs: ${preview}` : draft.error ?? "Runs: (nothing yet)"),
    )
    .when(row.customized && row.builtin, (el) =>
      el.child(
        h_flex()
          .gap(6)
          .items_center()
          .child(div().font_family(mono).text_size(11).text_color(t.dim).child(`Default: ${formatArgv(row.defaultCmd)}`))
          .child(
            owner.button(`am-reset-${row.key}`, "Reset to default", t, (_event, cx) => owner.reset(row, cx), {
              height: 24,
              px: 8,
              color: t.muted,
            }),
          ),
      ),
    )
    .when(row.customized && !row.builtin, (el) =>
      el.child(div().text_size(11).text_color(t.dim).child("This agent was added in programs.json; there is no built-in command to reset to.")),
    )
    .when(row.entryError, (el) => el.child(div().text_size(11).text_color(t.blocked).child(row.entryError)))
    .when(editor.error, (el) => el.child(div().text_size(11).text_color(t.blocked).child(editor.error)))
    .when(owner.writeError && editor.conflict, (el) => el.child(div().text_size(11).text_color(t.blocked).child(owner.writeError)))
    .child(
      h_flex()
        .w_full()
        .flex_wrap()
        .gap(8)
        .items_center()
        .justify_end()
        .when(owner.savedKey === row.key, (el) =>
          el.child(div().text_size(11).text_color(t.done).child("Saved · commands re-checked")),
        )
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
            disabled: !dirty && !editor.conflict,
          }),
        ),
    )
    .when(row.installed, (el) => el.child(owner.uninstallSection(row, t)));
}

export function uninstallSectionView(owner, row, t) {
  const request = owner.uninstall?.key === row.key ? owner.uninstall : null;
  const method = installMethodFor(row.key);
  const action = owner.action?.key === row.key && owner.action.kind === "uninstall" ? owner.action : null;
  return v_flex()
    .w_full()
    .gap(6)
    .pt(12)
    .mt(4)
    .border_t(1)
    .border_color(t.border)
    .child(div().text_size(10).font_semibold().text_color(t.dim).child("UNINSTALL"))
    .when(!method, (el) =>
      el
        .child(div().text_size(11).text_color(t.muted).child("No verified automatic uninstall is defined for this CLI. Use its official install guide to remove it."))
        .when(row.homepage, (inner) =>
          inner.child(
            Link.new(`am-uninstall-guide-${row.key}`)
              .href(row.homepage)
              .text_size(11)
              .text_color(t.accent)
              .underline()
              .tooltip(row.homepage)
              .child("Official guide ↗"),
          ),
        ),
    )
    .when(Boolean(method) && (!request || request.phase === "error"), (el) =>
      el.child(
        h_flex()
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
          .when(row.homepage, (inner) =>
            inner.child(
              Link.new(`am-uninstall-guide-${row.key}`)
                .href(row.homepage)
                .text_size(11)
                .text_color(t.accent)
                .underline()
                .tooltip(row.homepage)
                .child("Official guide ↗"),
            ),
          ),
      ),
    )
    .when(request?.phase === "confirm", (el) =>
      el.child(
        v_flex()
          .gap(8)
          .p(10)
          .rounded(8)
          .border_1()
          .border_color(t.blocked)
          .bg("#ef444414")
          .child(
            div()
              .text_size(11)
              .text_color(t.blocked)
              .child(`Remove ${row.name}? This runs npm uninstall -g ${request.status.method.package}. It does not delete settings, sessions, or your command override.`),
          )
          .child(
            h_flex()
              .gap(8)
              .child(owner.button(`am-uninstall-cancel-${row.key}`, "Cancel", t, (_event, cx) => owner.cancelUninstall(cx), { height: 24, px: 8, color: t.muted }))
              .child(owner.button(`am-uninstall-confirm-${row.key}`, "Confirm uninstall", t, (_event, cx) => owner.confirmUninstall(row, cx), { height: 24, px: 8, color: t.blocked })),
          ),
      ),
    )
    .when(request?.phase === "checking" || request?.phase === "running", (el) =>
      el.child(
        h_flex()
          .gap(6)
          .items_center()
          .child(div().text_size(11).text_color(t.accent).frames(["◐", "◓", "◑", "◒"], 120))
          .child(div().text_size(11).text_color(t.muted).child(request.phase === "checking" ? "Checking the installation method…" : "Uninstalling…")),
      ),
    )
    .when(request?.phase === "error", (el) => el.child(div().text_size(11).text_color(t.blocked).child(request.message)))
    .when(Boolean(action) && action.phase !== "running", (el) =>
      el.child(div().text_size(11).text_color(action.phase === "done" ? t.muted : t.blocked).child(action.message)),
    );
}
