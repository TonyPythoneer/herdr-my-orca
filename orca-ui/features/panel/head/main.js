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
  { id: "vault", icon: "agent-session-history", title: "Agents" },
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

// Glass chip per icon, the same capsule language as the tab pills: 24px tall, 8px radius,
// frosted foreground-tinted fill when active and a fainter one on hover. This replaces
// `activity-bar-buttons.tsx:175-177`'s 2px bottom bar, which the capsule supersedes.
function toolButton(t, { id, icon, title }, isActive) {
  return Button.new(`panel-${id}`).selected(isActive).w(32).h(24).flex_none().flex().items_center().justify_center().relative().rounded(8)
    .text_color(isActive ? t.foreground : INACTIVE_ICON)
    .when(isActive, el => el.bg(tint(t.foreground, TINT_ACTIVE)))
    .when(!isActive, el => el.hover(s => s.bg(tint(t.foreground, TINT_HOVER)).text_color(t.muted)))
    .role("button").accessibility_label(title).tooltip(title)
    .on_mouse_down("left", (_e, eventCx) => eventCx.stop_propagation())
    .on_click(() => run("layout.select", { stack: "panel-body", child: id }))
    .child(svg(`mods/orca-panel-head/${icon}.svg`).size(16));
}

// This header is the panel's own row, so it is only ever drawn while the panel is open: the
// toggle carries `PanelRightClose` (arrow out of the panel) for that state, and `orca-tabs`
// carries the matching open glyph for the hidden one.
function collapseButton(t) {
  return Button.new("panel-toggle").mr(3).w(32).h(24).flex_none().flex().items_center().justify_center().rounded(8)
    .text_color(t.muted).hover(s => s.bg(tint(t.foreground, TINT_ACTIVE)).text_color(t.foreground))
    .role("button").accessibility_label("Collapse right sidebar").tooltip("Collapse right sidebar")
    .on_mouse_down("left", (_e, eventCx) => eventCx.stop_propagation())
    .on_click(() => run("orca-tabs.toggle-panel"))
    .child(svg("mods/orca-panel-head/panel-right-close.svg").size(16));
}

export default class PanelHead extends View {
  // Orca reveals a right-sidebar view from one shortcut; Herdr needs show + select, so
  // keys.json calls `orca-panel-head.<view>` and this bridge runs the commands.
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
    // `right-sidebar-top-activity-bar.tsx:40` is a bare `h-[36px] border-b border-border`
    // wrapper with NO background; it shows the panel surface #171717
    // (`right-sidebar/index.tsx:158` -> `--sidebar`, main.css:392). The strip starts at pl-2 = 8
    // (`right-sidebar-titlebar-drag-regions.ts:5`). Each button is 32px wide here with a
    // 16px glyph; inactive is text-muted-foreground/60 and hover text-muted-foreground
    // (`activity-bar-buttons.tsx:156-157`) — a colour change, not element opacity.
    // The panel spans the full window height, so this header sits in the titlebar row. Orca moves the
    // `.sidebar-toggle` into it while the panel is open (`right-sidebar/index.tsx:124-144`); `orca-tabs`
    // draws its copy only while the panel is hidden, so one toggle is ever on screen.
    return h_flex().w_full().h_full().items_center().pl(8).pr(4).border_b(1).border_color(t.border)
      .children(tools.map(tool => toolButton(t, tool, active === tool.id)))
      .child(div().flex_1())
      .child(collapseButton(t));
  }
}
