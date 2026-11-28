import { LIST_ROW_HEIGHT, argsEditable, draftRun, formatArgv } from "./state.js";
import { installMethodFor } from "./install.js";
import { sameRun } from "./util.js";
import { permissionRow } from "./permission-menu.js";
import { badge, icon, monoFont, permissionBadge } from "./parts.js";
import { themeColor } from "./theme-color.js";
import { div, svg } from "gpui-kit";
import { Input, Link, Textarea, h_flex, v_flex } from "gpui-base";

                                        
const note = (color, text) => div().text_size(11).text_color(themeColor(color)).child(text);
const label = (text, t) => div().text_size(10).font_semibold().text_color(t.dim).child(text);
const guideLink = (id, text, row, t) => Link.new(id).href(row.homepage ?? "").text_size(11).text_color(themeColor(t.accent)).underline().tooltip(row.homepage ?? "").child(text);
function rowView(owner, row, t, last = false) {
	const open = owner.expanded?.has(row.key) ?? false;
	const editor = owner.editors?.get(row.key);
	const quiet = !row.enabled;
	return v_flex().id(`am-row-${row.key}`).relative().w_full().flex_none().when(!last, (el) => el.border_b(1).border_color(t.border)).child(h_flex().id(`am-row-highlight-${row.key}`).w_full().rounded(8).hover((s) => s.bg(t.hover)).h(56 - 12).my(6).px(8).min_w(0).gap(12).py(0).items_center().overflow_hidden().child(rowIconTile(row, t, quiet)).child(rowTitle(owner, row, t, open, quiet)).child(rowActions(owner, row, t, open))).when(open && editor !== void 0, (el) => editor === void 0 ? el : el.child(owner.editor(row, editor, t)));
}
function rowIconTile(row, t, quiet) {
	return h_flex().w(32).h(32).flex_none().items_center().justify_center().rounded(8).border_1().border_color(t.border).bg(t.surface).when(quiet, (el) => el.opacity(.5)).child(icon(row, 18, t));
}
function rowTitle(owner, row, t, open, quiet) {
	return v_flex().flex_1().min_w(100).gap(3).child(h_flex().gap(6).items_center().flex_wrap().child(div().id(`am-name-${row.key}`).rounded(3).cursor_pointer().text_size(13).font_medium().text_color(t.foreground).when(quiet, (el) => el.opacity(.45)).role("button").accessibility_label(`${row.name}: edit command`).tooltip(open ? "Hide command editor" : "Edit command and arguments").on_click((_event, cx) => owner.toggleExpand(row, cx)).child(row.name)).when(row.customized, (el) => el.child(badge("Customized", t, {
		color: t.accent,
		border: true
	}))).when(row.entryError, (el) => el.child(badge("Invalid command", t, {
		color: t.blocked,
		border: true
	}))).when(row.supports && (row.permission !== "own" || row.permissionOverride), (el) => el.child(permissionBadge(row.permission ?? "own", t)))).child(owner.commandLine(row, t, quiet));
}
function installLink(row, t) {
	return Link.new(`am-install-open-${row.key}`).href(row.homepage ?? "").tooltip(`Open ${row.name} installation guide`).child(h_flex().h(24).px(8).flex_none().items_center().justify_center().rounded(6).border_1().border_color(t.border).text_size(12).font_medium().text_color(t.foreground).cursor_pointer().hover((style) => style.bg(t.hover)).child("Install"));
}
function editToggle(owner, row, t, open) {
	return div().id(`am-more-${row.key}`).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).role("button").accessibility_label(open ? `Hide ${row.name} command` : `Edit ${row.name} command`).tooltip(open ? "Hide command editor" : "Edit command and arguments").on_click((_event, cx) => {
		cx.stop_propagation();
		owner.toggleExpand(row, cx);
	}).child(svg(sharedAsset(`mods/orca-agent-settings/${open ? "chevron-down" : "chevron-right"}.svg`)).size(14));
}
function rowActions(owner, row, t, open) {
	return h_flex().ml_auto().flex_none().items_center().gap(10).child(owner.toggle(row, t)).when(!row.installed && row.homepage, (el) => el.child(installLink(row, t))).when(!row.installed && !row.homepage, (el) => el.child(note(t.dim, "No install guide"))).when(row.installed, (el) => el.child(editToggle(owner, row, t, open)));
}
function draftSummary(editor, row) {
	const cmd = editor.command;
	const args = editor.args;
	const draft = draftRun(cmd.value(), args.value(), editor.originalArgs);
	const hasRun = "run" in draft;
	return {
		draft,
		preview: hasRun ? formatArgv(draft.run) : "",
		dirty: hasRun ? !sameRun(draft.run, row.run) : true,
		saveLabel: editor.conflict ? "Overwrite" : "Save"
	};
}
function handleEditorEscapeKey(owner, row, cx) {
	cancelEditing(owner, row, cx);
}
function handleEditorSubmitKey(owner, row, cx) {
	cx.stop_propagation();
	owner.typing = false;
	owner.save(row, cx);
}
function cancelEditing(owner, row, cx) {
	cx.stop_propagation();
	owner.typing = false;
	owner.cancelEdit(row, cx);
	owner.handle.focus();
}
function editorView(owner, row, editor, t) {
	const mono = monoFont();
	const unsafeArgs = !argsEditable(editor.originalArgs);
	const { draft, preview, dirty, saveLabel } = draftSummary(editor, row);
	return editorFooter(v_flex().w_full().pl(52).pr(2).pb(14).gap(8).when(editor.conflict, (el) => el.child(conflictBox(owner, row, editor, t))).when(!row.installed, (el) => el.child(notInstalledNotice(row, t))).when(row.supports, (el) => el.child(permissionRow(owner, row, t))).child(label("EXECUTABLE", t)).child(executableField(editor, mono, t)).on_key_down((_event, cx) => {
		handleEditorEscapeKey(owner, row, cx);
	}).child(note(t.dim, "A name from PATH or an absolute path. Spaces are allowed; quotes are literal.")).child(label("LAUNCH ARGUMENTS", t)).when(unsafeArgs, (el) => el.child(unsafeArgsBox(editor, mono, t))).when(!unsafeArgs, (el) => el.child(argsField(editor, mono, t))), {
		owner,
		row,
		editor,
		t,
		mono,
		unsafeArgs,
		draft,
		preview,
		dirty,
		saveLabel
	});
}
function editorFooter(fields, options) {
	const { owner, row, t, mono, unsafeArgs, draft, preview } = options;
	return editorFooterActions(fields.on_key_down((_event, cx) => {
		if (_event.keystroke === "cmd-enter" || _event.keystroke === "ctrl-enter") handleEditorSubmitKey(owner, row, cx);
		else if (_event.key === "escape") handleEditorEscapeKey(owner, row, cx);
	}).when(!unsafeArgs, (el) => el.child(note(t.dim, "One argument per line; spaces, quotes and backslashes stay literal. Blank lines are ignored."))).child(previewLine(draft, preview, mono, t)).when(row.customized && row.builtin, (el) => el.child(resetRow(owner, row, mono, t))).when(row.customized && !row.builtin, (el) => el.child(note(t.dim, "This agent was added in programs.json; there is no built-in command to reset to."))), options);
}
function editorFooterActions(footer, options) {
	const { owner, row, t } = options;
	return footer.when(row.entryError, (el) => el.child(note(t.blocked, row.entryError))).when(options.editor.error, (el) => el.child(note(t.blocked, options.editor.error))).when(owner.writeError && options.editor.conflict, (el) => el.child(note(t.blocked, owner.writeError))).child(editorActions(owner, row, {
		saveLabel: options.saveLabel,
		disabled: !options.dirty && !options.editor.conflict
	}, t)).when(row.installed, (el) => el.child(owner.uninstallSection(row, t)));
}
function conflictBox(owner, row, editor, t) {
	return v_flex().gap(6).p(10).rounded(8).border_1().border_color(t.blocked).bg("#ef444414").child(note(t.blocked, "programs.json changed on disk. Your draft is kept; reload or overwrite this agent's command.")).child(conflictActions(owner, row, editor, t));
}
function conflictActions(owner, row, editor, t) {
	const button = owner.button;
	return h_flex().gap(8).child(button(`am-reload-${row.key}`, "Reload", t, (_event, cx) => owner.reloadRow(row, cx), {
		height: 24,
		px: 8
	})).child(button(`am-force-${row.key}`, "Overwrite", t, (_event, cx) => {
		editor.force = true;
		owner.save(row, cx);
	}, {
		height: 24,
		px: 8,
		color: t.blocked
	}));
}
function notInstalledNotice(row, t) {
	return h_flex().gap(6).items_center().flex_wrap().child(note(t.dim, "This CLI is not installed.")).when(row.homepage, (inner) => inner.child(guideLink(`am-guide-${row.key}`, "Install guide ↗", row, t)));
}
function executableField(editor, mono, t) {
	return h_flex().w_full().h(30).px(8).rounded(6).border_1().border_color(t.input).bg(t.background).child(Input.new(editor.command).w_full().font_family(mono).text_size(12).text_color(t.foreground).bg("#00000000"));
}
function unsafeArgsBox(editor, mono, t) {
	return v_flex().w_full().gap(6).p(8).rounded(6).border_1().border_color(t.border).bg(t.background).child(div().font_family(mono).text_size(11).text_color(t.muted).child(formatArgv(editor.originalArgs) || "No arguments")).child(note(t.dim, "These arguments contain an empty or multi-line value, which this line editor cannot change without losing data. Only the executable is editable here; edit programs.json to change the arguments."));
}
function argsField(editor, mono, t) {
	return v_flex().w_full().h(76).px(8).py(6).rounded(6).border_1().border_color(t.input).bg(t.background).child(Textarea.new(editor.args).size_full().font_family(mono).text_size(11).text_color(t.foreground).bg("#00000000"));
}
function previewColor(draft, preview, t) {
	if (preview) return t.muted;
	return themeColor("error" in draft ? t.blocked : t.dim);
}
function previewText(draft, preview) {
	if (preview) return `Runs: ${preview}`;
	if ("error" in draft) return draft.error;
	return "Runs: (nothing yet)";
}
function previewLine(draft, preview, mono, t) {
	return div().min_w(0).truncate().font_family(mono).text_size(11).text_color(previewColor(draft, preview, t)).child(previewText(draft, preview));
}
function resetRow(owner, row, mono, t) {
	return h_flex().gap(6).items_center().child(div().font_family(mono).text_size(11).text_color(t.dim).child(`Default: ${formatArgv(row.defaultCmd ?? [])}`)).child(owner.button(`am-reset-${row.key}`, "Reset to default", t, (_event, cx) => owner.reset(row, cx), {
		height: 24,
		px: 8,
		color: t.muted
	}));
}
function editorActions(owner, row, opts, t) {
	const button = owner.button;
	return h_flex().w_full().flex_wrap().gap(8).items_center().justify_end().when(owner.savedKey === row.key, (el) => el.child(note(t.done, "Saved · commands re-checked"))).child(button(`am-cancel-${row.key}`, "Cancel", t, (_event, cx) => owner.cancelEdit(row, cx), {
		height: 26,
		px: 10,
		color: t.muted
	})).child(button(`am-save-${row.key}`, opts.saveLabel, t, (_event, cx) => owner.save(row, cx), {
		height: 26,
		px: 12,
		primary: true,
		disabled: opts.disabled
	}));
}
function uninstallState(owner, row) {
	const uninstall = owner.uninstall;
	const request = uninstall?.key === row.key ? uninstall : null;
	const action = owner.action;
	return {
		request,
		action: action?.key === row.key && action?.kind === "uninstall" ? action : null,
		phase: request?.phase,
		method: installMethodFor(row.key)
	};
}
function uninstallSectionView(owner, row, t) {
	const { request, action, phase, method } = uninstallState(owner, row);
	return v_flex().w_full().gap(6).pt(12).mt(4).border_t(1).border_color(t.border).child(label("UNINSTALL", t)).when(!method, (el) => el.child(note(t.muted, "No verified automatic uninstall is defined for this CLI. Use its official install guide to remove it.")).when(row.homepage, (inner) => inner.child(guideLink(`am-uninstall-guide-${row.key}`, "Official guide ↗", row, t)))).when(Boolean(method) && (!request || phase === "error"), (el) => el.child(uninstallButtonRow(owner, row, t))).when(phase === "confirm", (el) => el.child(confirmBox(owner, row, request, t))).when(phase === "checking" || phase === "running", (el) => el.child(progressRow(request, t))).when(phase === "error", (el) => el.child(note(t.blocked, request.message))).when(action && action.phase !== "running", (el) => el.child(note(action.phase === "done" ? t.muted : t.blocked, action.message)));
}
function uninstallButtonRow(owner, row, t) {
	return h_flex().gap(8).items_center().child(owner.button(`am-uninstall-${row.key}`, "Uninstall…", t, (_event, cx) => owner.requestUninstall(row, cx), {
		height: 26,
		px: 10,
		color: t.blocked,
		disabled: owner.action?.phase === "running" || owner.uninstall?.phase === "checking"
	})).when(row.homepage, (inner) => inner.child(guideLink(`am-uninstall-guide-${row.key}`, "Official guide ↗", row, t)));
}
function confirmBox(owner, row, request, t) {
	return v_flex().gap(8).p(10).rounded(8).border_1().border_color(t.blocked).bg("#ef444414").child(note(t.blocked, `Remove ${row.name}? This runs npm uninstall -g ${request.status?.method?.package}. It does not delete settings, sessions, or your command override.`)).child(confirmActions(owner, row, t));
}
function confirmActions(owner, row, t) {
	const button = owner.button;
	return h_flex().gap(8).child(button(`am-uninstall-cancel-${row.key}`, "Cancel", t, (_event, cx) => owner.cancelUninstall(cx), {
		height: 24,
		px: 8,
		color: t.muted
	})).child(button(`am-uninstall-confirm-${row.key}`, "Confirm uninstall", t, (_event, cx) => owner.confirmUninstall(row, cx), {
		height: 24,
		px: 8,
		color: t.blocked
	}));
}
function progressRow(request, t) {
	return h_flex().gap(6).items_center().child(div().text_size(11).text_color(t.accent).frames([
		"◐",
		"◓",
		"◑",
		"◒"
	], 120)).child(note(t.muted, request.phase === "checking" ? "Checking the installation method…" : "Uninstalling…"));
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

export { editorView, rowView, uninstallSectionView };
