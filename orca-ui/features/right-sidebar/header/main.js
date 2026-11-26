// Derived from Herdr App's defaults/mods/changes/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
import { View, div, svg } from "gpui-kit";
import { Button, h_flex } from "gpui-base";
import { theme, run, layout, panes, spaces, focused, exec, nextCommand } from "herdr";
import { visibleTools, fallbackChild } from "./panel-gating.js";
import { viewCommands } from "./panel-views.js";

const findNode = (node, id) => {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) { const hit = findNode(child, id); if (hit) return hit; }
  return null;
};

const TINT_ACTIVE = 0.1;
const TINT_HOVER = 0.06;
const INACTIVE_ICON = "#acacac99";

// Glass surfaces for the header (the reference design's "liquid glass" look): translucent fills
// derived from the theme's own foreground, so both the dark and the light theme tint correctly.
function tint(hex, alpha) {
  const alphaHex = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0");
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alphaHex}` : hex;
}

// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

const activeSpace = () => (spaces() ?? []).find(s => s.active);
const isInside = (path, folder) => path === folder || path.startsWith(`${folder}/`);

// The machine the focused thing runs on: a host terminal names it before the first "/" of its
// title; a pane belongs to its workspace's machine.
function hostOf(focus, space) {
  if (focus?.pane === null) return focus.terminal?.includes("/") ? focus.terminal.split("/")[0] : null;
  return space?.machine ?? null;
}

function scopeToProject(live, project) {
  if (live && project && !isInside(live, project)) return project;
  return live || project;
}

// Orca scopes the panel to the project, not to whatever folder the focused
// terminal happens to sit in: a terminal in /tmp must not empty the tree.
function location() {
  const space = activeSpace();
  const focus = focused();
  const pane = focus?.pane ? (panes() ?? []).find(p => p.pane === focus.pane) : null;
  const live = pane?.cwd || focus?.cwd;
  return { cwd: scopeToProject(live, space?.folder || live), on: hostOf(focus, space) };
}

// How long a `git rev-parse` answer is trusted before the next render asks again.
const PROBE_TTL_MS = 5000;
const emptyGitCache = resolved => ({ cwd: null, on: null, at: 0, ok: false, resolved, pending: false });
let gitCache = emptyGitCache(false);

// Starts a probe when the target changed or the answer expired with none in flight. A folder-less
// window counts as resolved: there is no repo to wait for.
function refreshRepoState(cx, { cwd, on }) {
  if (!cwd) { gitCache = emptyGitCache(true); return; }
  const isSameTarget = gitCache.cwd === cwd && gitCache.on === on;
  const isExpired = Date.now() - gitCache.at > PROBE_TTL_MS;
  if (isSameTarget && !(isExpired && !gitCache.pending)) return;
  gitCache = { cwd, on, at: Date.now(), ok: isSameTarget && gitCache.ok, resolved: isSameTarget && gitCache.resolved, pending: true };
  // The probe runs inside `cx.spawn`: a `cx` is valid only for the call that made it, so
  // `cx.notify()` after an `await` on render's `cx` throws and Herdr draws its render banner.
  cx.spawn(async (spawnCx) => {
    // A git that cannot start is the same answer as "not a repository".
    const result = await exec("git", [...READ, "rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
    if (gitCache.cwd !== cwd || gitCache.on !== on) return; // the target moved on while git ran
    gitCache.pending = false;
    const ok = result?.code === 0;
    const changed = !gitCache.resolved || gitCache.ok !== ok;
    gitCache.ok = ok;
    gitCache.resolved = true;
    if (changed) spawnCx.notify();
  });
}

// `use-right-sidebar-activity-items.ts:74-128`, in order. `gating` is Orca's own flag:
//   gitOnly hides the item for a folder repo; folderOnly shows it only for a folder
//   workspace; sshOnly shows it only for a workspace on an SSH host.
// `id` is this panel's stack child; `title` is Orca's translated label.
const ITEMS = [
  { id: "files", icon: "files", title: "Explorer" },
  { id: "agent-sessions", icon: "agent-session-history", title: "Agents" },
  { id: "workspaces", icon: "workflow", title: "Attached worktrees", gating: "folderOnly" },
  { id: "pr-checks", icon: "list-checks", title: "PR Checks", gating: "folderOnly" },
  { id: "changes", icon: "git-branch", title: "Source Control", gating: "gitOnly" },
  { id: "checks", icon: "list-checks", title: "Checks", gating: "gitOnly" },
  { id: "ports", icon: "plug", title: "Ports", gating: "sshOnly" }
];

// Orca falls back to the first visible item when the active tab is gated out
// (`right-sidebar-effective-tab.ts:28-32`). Deferred: selecting a stack child mutates
// state, which render itself may not do.
function selectFallback(cx, tools, active) {
  const fallback = fallbackChild(tools, active);
  if (fallback && fallback !== active) {
    cx.spawn(() => { run("layout.select", { stack: "panel-body", child: fallback }); });
  }
}

// Each segment takes an equal share of the available row width; the centered glyph remains 16px.
function toolButton(t, { id, icon, title }, isActive) {
  return Button.new(`panel-${id}`).selected(isActive).h(24).flex_1().min_w(0).flex().items_center().justify_center().relative().rounded(6)
    .text_color(isActive ? t.foreground : INACTIVE_ICON)
    .when(isActive, el => el.bg(tint(t.foreground, TINT_ACTIVE)))
    .when(!isActive, el => el.hover(s => s.bg(tint(t.foreground, TINT_HOVER)).text_color(t.muted)))
    .role("button").accessibility_label(title).tooltip(title)
    .on_mouse_down("left", (_e, eventCx) => eventCx.stop_propagation())
    .on_click(() => run("layout.select", { stack: "panel-body", child: id }))
    .child(svg(sharedAsset(`mods/orca-right-sidebar-header/${icon}.svg`)).size(16));
}

// Stretch one segmented track across the panel; its buttons divide the row equally.
function toolGroup(t, tools, active) {
  return div().id("panel-tools").flex_1().min_w(0).flex().items_center().gap(1).p(1).rounded(8)
    .bg(tint(t.foreground, 0.05))
    .children(tools.map(tool => toolButton(t, tool, active === tool.id)));
}

export default class PanelHead extends View {
  // Orca reveals a right-sidebar view from one shortcut; Herdr needs show + select, so
  // keys.json calls `orca-right-sidebar-header.<view>` and this bridge runs the commands.
  init(_props, cx) {
    cx.spawn(async (spawnCx) => {
      for (;;) {
        const command = await nextCommand();
        if (!command) continue;
        const commands = viewCommands(command);
        if (commands) for (const { name, args } of commands) run(name, args);
        spawnCx.notify();
      }
    });
  }

  render(cx) {
    const t = theme();
    const stack = findNode(layout(), "panel-body");
    const active = stack?.active ?? "files";
    const { cwd, on } = location();
    refreshRepoState(cx, { cwd, on });
    // Gating (`right-sidebar/right-sidebar-activity-visibility.ts:14-20`): gitOnly is hidden
    // when the project is a folder (no repo); folderOnly only appears in a folder workspace;
    // sshOnly only on an SSH host. Herdr has no separate folder-workspace record, so a non-git
    // folder is that case; a workspace on a machine (`space.machine`) is the SSH case.
    const isFolder = gitCache.resolved && !gitCache.ok;
    const onSshHost = Boolean(on || activeSpace()?.machine);
    const tools = visibleTools(ITEMS, { isFolder, onSshHost });
    selectFallback(cx, tools, active);
    // The equal-width segments keep the glyph centered as the sidebar resizes.
    // The right-sidebar toggle stays in the tab header in both states, beside the left-sidebar toggle.
    return h_flex().w_full().h_full().items_center().pl(8).pr(4)
      .child(toolGroup(t, tools, active));
  }
}

const SHARED_ASSET_PATHS = Object.freeze({
  "mods/orca-right-sidebar-header/files.svg": "mods/orca-assets/files--orca-right-sidebar-header.svg",
  "mods/orca-right-sidebar-header/git-branch.svg": "mods/orca-assets/git-branch--orca-right-sidebar-header.svg",
  "mods/orca-right-sidebar-header/list-checks.svg": "mods/orca-assets/list-checks--orca-right-sidebar-header.svg",
  "mods/orca-right-sidebar-header/panel-right-close.svg": "mods/orca-assets/panel-right-close--orca-right-sidebar-header.svg",
  "mods/orca-right-sidebar-header/plug.svg": "mods/orca-assets/plug--orca-right-sidebar-header.svg",
  "mods/orca-right-sidebar-header/workflow.svg": "mods/orca-assets/workflow--orca-right-sidebar-header.svg"
});
function sharedAsset(path) {
  return SHARED_ASSET_PATHS[path] ?? `mods/orca-assets/${path.slice(path.lastIndexOf("/") + 1)}`;
}
