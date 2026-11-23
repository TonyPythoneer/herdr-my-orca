// Derived from Herdr App's defaults/mods/menu/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
// Context menus (Herdr's items). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "group", target }.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// a command "worktree" opens the worktree dialog instead.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, exec, hc, home, shared, setShared } from "herdr";
import { copyText } from "./clip.js";
import { buildBoundedSessionTranscript } from "./transcript.js";
import { closeSideTabs } from "./close-sides.js";
import { closeRows } from "./close-space.js";

const _storedCache = new Map();
function stored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    const cached = _storedCache.get(key);
    if (cached && cached.raw === raw) return cached.value;
    const v = JSON.parse(raw ?? "null");
    const value = v && typeof v === "object" ? v : fallback;
    _storedCache.set(key, { raw, value });
    return value;
  } catch { return fallback; }
}

// Where a space is: its designated workspace folder (GLOSSARY.md:
// "The space is the scope; the terminal is only where keystrokes go").
function place(s) {
  return s?.folder ?? null;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

function items(p, git) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": {
      // A kept sub-agent can go back under its parent, still running.
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      // Orca's close row names the tab when this is its last pane
      // (terminal-pane-close-affordance.ts:16).
      const own = panes().find((x) => x.pane === tg.pane);
      const alone = own && panes().filter((x) => x.tab === own.tab).length < 2;
      const curTab = spaces().flatMap((s) => s.tabs ?? []).find((t) => t.id === own?.tab);
      const isAgent = Boolean(own?.program?.agent || own?.status === "working" || own?.status === "blocked" || term?.agent);
      return [
        // Orca's order (TerminalContextMenu.tsx:204-370): Copy, Add to chat, Select All, Paste,
        // Quick Commands, agent rows, split section, title/ID block, close, clear, reset.
        // Add to chat (:209) stays out: Herdr has no chat.
        ["Copy", "terminal.copy", {}],
        // Herdr cannot select the buffer; this copies up to 10,000 lines instead.
        ...(term ? [["Copy Terminal Buffer", "orca-menu.select-all", { terminal: term.address, pane: tg.pane }]] : []),
        ["Paste", "terminal.paste", {}],
        // Orca's Quick Commands menu (:227) is its command surface; Herdr's is the palette.
        ["Quick Commands", "app.palette", {}],
        // Orca's agent rows (TerminalContextMenu.tsx:236-246):
        // Hand Off to Another Agent (:236, canContinueAgentSessionInNewSession / isTuiAgent),
        // Fork Agent Session… (:239), Copy Context (:246).
        ...(term
          ? [
              ...(isAgent ? [["Hand off to agent", "orca-menu.handoff", { terminal: term.address, pane: tg.pane }]] : []),
              ["Fork Agent Session…", "orca-menu.fork", { terminal: term.address, pane: tg.pane }],
              ["Copy Context", "orca-menu.copy-context", { terminal: term.address, pane: tg.pane }],
            ]
          : []),
        // Orca's split section (TerminalContextMenu.tsx:265-302, TabWorkspaceLayoutMenuSection.tsx:14-41).
        // Equalize Pane Sizes (:281) has no equivalent: panes are content inside one layout node.
        ["Split Terminal Right", "pane.split", { direction: "right", pane: tg.pane }],
        ["Split Terminal Left", "orca-menu.split-left", { pane: tg.pane }],
        ["Split Terminal Down", "pane.split", { direction: "down", pane: tg.pane }],
        ["Split Terminal Up", "orca-menu.split-up", { pane: tg.pane }],
        ...(own && panes().filter((x) => x.tab === own.tab).length > 1
          ? [
              ["Move to New Tab", "orca-menu.unsplit-to-tab", { pane: tg.pane, terminal: term?.address }],
              ["Swap with Left", "pane.swap", { pane: tg.pane, direction: "left" }],
              ["Swap with Right", "pane.swap", { pane: tg.pane, direction: "right" }],
              ["Swap with Above", "pane.swap", { pane: tg.pane, direction: "up" }],
              ["Swap with Below", "pane.swap", { pane: tg.pane, direction: "down" }],
            ]
          : []),
        [own?.zoomed ? "Collapse Pane" : "Expand Pane", "pane.zoom", { pane: tg.pane }],
        // Orca's title/ID block (:307-347). Orca's pane title is the tab's custom title
        // (`ClaudeAccountSwitchSessionTree.tsx:276` = `customTitle || title`), so `tab.rename`
        // names it, and an empty name drops it (`commands.rs:40`). Clear Pane Title is gated
        // on menuPaneHasCustomTitle (TerminalPaneSurface.tsx:317).
        ...(own?.tab
          ? [
              ["Set Title…", "tab.rename", { id: own.tab }],
              ...(curTab?.named ? [["Clear Pane Title", "tab.rename", { id: own.tab, name: "" }]] : []),
            ]
          : []),
        // Herdr-only: Orca has no right-click routing or park command; kept where the
        // title/ID block sits.
        ...(term
          ? [
              toProgram
                ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
                : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
            ]
          : []),
        ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
        // Copy Session/Terminal/Pane ID (:329-347): Herdr ids go to the clipboard through
        // `clip.js`. The session id has no counterpart.
        ...(term ? [["Copy Terminal ID", "orca-menu.copy-terminal", { id: term.address }]] : []),
        ["Copy Pane ID", "orca-menu.copy-pane-id", { id: tg.pane ?? "" }],
        // TerminalContextMenu.tsx:348-357: Close Pane / Close tab. Gated on canCloseTerminalPane
        // (terminal-pane-close-affordance.ts:6-14: true if paneCount > 1, or !isTabPinned).
        ...(!(alone && curTab?.settled)
          ? [[alone ? "Close tab" : "Close Pane", alone ? "tab.close" : "pane.close", alone ? { id: own?.tab } : { pane: tg.pane }]]
          : []),
        // Clear Screen (:359) and Reset Terminal (:363): no command sends input, so the
        // terminal is driven through `hc` — Ctrl+L for a clear, `reset` for a full one.
        ...(term
          ? [
              ["Clear Screen", "orca-menu.clear-screen", { terminal: term.address, pane: tg.pane }],
              ["Reset Terminal", "orca-menu.reset-terminal", { terminal: term.address, pane: tg.pane }],
            ]
          : []),
      ];
    }
    case "tab": {
      // Orca's order (SortableTabContextMenu.tsx:152-251): split section (:157-166,
      // TabWorkspaceLayoutMenuSection.tsx:42-93 and TerminalTabSplitMenuSection.tsx:46-77), then
      // "Continue with Terminal Agent" (:167-178, chat view only) and the
      // TabSessionSurfaceSwitchMenuItems rows (:179-185), separator (:186), Pin/Unpin
      // (:187-196), Allow Auto-Close (:197-205), Copy Tab ID (:206), separator (:207),
      // Close (:208-212), Close Others (:213-215), Close split pane (:216, CloseSplitPaneMenuItem.tsx:21-24), separator (:217),
      // Change Title (:218-222). Orca's Tab Color palette (:223-250) is left out: the tab takes
      // its colour from the strip's own state, and this menu no longer writes one. The chat-view
      // and session-switch rows
      // stay out: Herdr has no chat. Allow Auto-Close has no counterpart either: Herdr keeps a
      // tab until `tab.close`, and `hc keep --off` ends a lost terminal but closes no tab.
      const own = spaces().find((s) => (s.tabs ?? []).some((x) => x.id === tg.id));
      const list = own?.tabs ?? [];
      const tab = list.find((x) => x.id === tg.id);
      const mine = panes().filter((x) => x.tab === tg.id);
      const pane = (mine.find((x) => x.focused) ?? mine[0])?.pane;
      return [
        ...(list.length > 1
          ? [
              // TabWorkspaceLayoutMenuSection.tsx:42-93 — Move Tab to Split across 4 directions
              ["Move Tab to Split Right", "orca-menu.move-tab-split", { id: tg.id, direction: "right" }],
              ["Move Tab to Split Left", "orca-menu.move-tab-split", { id: tg.id, direction: "left" }],
              ["Move Tab to Split Down", "orca-menu.move-tab-split", { id: tg.id, direction: "down" }],
              ["Move Tab to Split Up", "orca-menu.move-tab-split", { id: tg.id, direction: "up" }],
            ]
          : []),
        ...(pane
          ? [
              // TerminalTabSplitMenuSection.tsx:46-77 — Split terminal right and down
              ["Split terminal right", "pane.split", { direction: "right", pane }],
              ["Split terminal down", "pane.split", { direction: "down", pane }],
            ]
          : []),
        // SortableTabContextMenu.tsx:187-196 — Orca's Pin/Unpin.
        [tab?.settled ? "Unpin Tab" : "Pin Tab", tab?.settled ? "tab.unsettle" : "tab.settle", { id: tg.id }],
        // SortableTabContextMenu.tsx:206 & CopyTabIdMenuItem.tsx:16 — Copy Tab ID.
        ["Copy Tab ID", "orca-menu.copy-tab-id", { id: tg.id }],
        // SortableTabContextMenu.tsx:208-212 — Close.
        ["Close", "tab.close", { id: tg.id }],
        // SortableTabContextMenu.tsx:213 — inset, disabled when `tabCount <= 1`; with one tab
        // the loop in choose() would close nothing, so leave the row out.
        ...(list.length > 1 ? [["Close Others", "orca-menu.close-others", { id: tg.id }]] : []),
        // Herdr's own, not an Orca port (SortableTabContextMenu.tsx has no such rows): the same
        // inset block as Close Others, one side of this tab at a time, and left out on a side
        // that has no unpinned tab - the rule Close Others follows with `tabCount <= 1`.
        ...(closeSideTabs(own, tg.id, "right").length
          ? [["Close Tabs to the Right", "orca-menu.close-right", { id: tg.id }]]
          : []),
        ...(closeSideTabs(own, tg.id, "left").length
          ? [["Close Tabs to the Left", "orca-menu.close-left", { id: tg.id }]]
          : []),
        // Close split pane (CloseSplitPaneMenuItem.tsx:21-24) closes other panes in the split group
        ...(mine.length > 1 ? [["Close split pane", "orca-menu.close-split-panes", { id: tg.id }]] : []),
        // SortableTabContextMenu.tsx:218-222 — Change Title.
        ["Change Title", "tab.rename", { id: tg.id }],
      ];
    }
    // `RepoHeaderProjectActionsMenu` (repo-header-project-actions.tsx:121-186) &
    // `ProjectGroupHeaderMenu` (project-group-header-actions.tsx:25-95):
    // the ellipsis or right-click on a project group header. Its rows are project
    // actions. In Herdr, open spaces belonging to the group can be renamed or closed.
    case "group": {
      const open = spaces().some((s) => s.id === tg.id);
      const groupSpaces = spaces().filter((s) => s.id === tg.id || (tg.path && (s.folder === tg.path || s.folder?.startsWith(tg.path + "/"))));
      // The sidebar's own grouping (`tg.spaces`, from orca-spaces) knows the linked worktrees
      // stored outside the project folder; the folder-prefix match above misses them.
      // Only live spaces: a row git lists with no space open carries a made-up id
      // (`repo:`/`wt:`), and `space.close` would fail with `no space "repo:[...]"`.
      const groupIds = (tg.spaces?.length ? tg.spaces : groupSpaces.map((s) => s.id))
        .filter((id) => spaces().some((s) => s.id === id));
      const openSpace = groupSpaces[0];
      const folder = tg.path ?? (openSpace ? place(openSpace) : null);
      const args = { ...(open ? { space: tg.id } : openSpace ? { space: openSpace.id } : {}), ...(folder ? { folder } : {}), ...(tg.machine ? { machine: tg.machine } : {}) };
      return [
        ["New worktree", "worktree", { ...args, action: "new" }],
        ["Open worktree", "worktree", { ...args, action: "open" }],
        ["Copy Path", "orca-menu.copy-path", { path: folder, id: tg.id }],
        ...(openSpace ? [["Rename workspace", "space.rename", { id: openSpace.id }]] : []),
        // Every unpinned tab of the project: the main checkout and every linked worktree, from the
        // sidebar's own grouping (`spaces`), which knows worktrees outside the project folder.
        ["Delete all tabs", "orca-menu.delete-all-tabs", { ids: tg.spaces ?? [], disabled: !unpinnedTabs(tg.spaces ?? []).length }],
        // `space.close` needs `confirmed` (the host refuses it otherwise), and a group closes
        // as one command (close-space.js).
        ...closeRows(groupIds),
        // A project with no open space is only the sidebar's catalog entry: nothing to close,
        // so Orca's Remove Project (`repo-header-project-actions.tsx:204`) is the row that
        // makes its cards go away. With a space open, close that instead.
        ...(tg.repo && groupIds.length === 0 ? [["Remove Project from Sidebar", "orca-menu.forget-project", { repo: tg.repo }]] : []),
      ];
    }
    case "space": {
      // Orca keys the menu on the worktree, not a tab (`worktree-card-surface.tsx:139-146`):
      // Update and Close belong to a tab, while Open in / Copy Path / Copy Worktree Name and
      // the worktree work are unconditional (`WorktreeContextMenuView.tsx:165-298`). A card
      // with no open space still shows the latter, from the facts its opener passes.
      const open = spaces().some((s) => s.id === tg.id);
      // The opener carries `linked`; `git` is the probe's fallback for a row whose git state
      // had not loaded, or for a caller that sends only { id, path }.
      const linked = typeof tg.linked === "boolean" ? tg.linked : git === "linked";
      const repo = typeof tg.linked === "boolean" || git !== null;
      const folder = tg.top || tg.folder || tg.path || null;
      // The worktree dialog takes a space when one is open, `{ folder, machine }` otherwise
      // (defaults/mods/worktree/main.js:158).
      const args = { ...(open ? { space: tg.id } : {}), ...(folder ? { folder } : {}), ...(tg.machine ? { machine: tg.machine } : {}) };
      return [
        ...(open ? [["Update", "space.rename", { id: tg.id }]] : []),
        // Orca's "Open in" is a submenu of external editors (WorktreeOpenInMenu.tsx:295-325);
        // Herdr has no external-open command, so this opens a Herdr terminal in the
        // worktree's folder instead (terminal.open, commands.md:277).
        ["Open in Terminal", "terminal.open", folder ? { folder } : {}],
        ["Copy Path", "orca-menu.copy-path", { path: folder, id: tg.id }],
        // The display name is custom, else the branch, else the folder's last segment
        // (`worktree-default-display-name.ts:13-25`).
        ["Copy Worktree Name", "orca-menu.copy-name", { id: tg.id, name: tg.branch ?? null, folder }],
        // WorktreeContextMenuView.tsx:203-214 — Mark Read / Mark Unread
        ["Mark " + (tg.unread ? "Read" : "Unread"), "orca-menu.toggle-unread", { id: tg.id }],
        // Not an Orca row: Orca's card menu has no branch switch because Source Control owns it,
        // and this layout ports no Source Control. The dialog ports that picker's behaviour — one
        // checkout, in place, behind the agent and uncommitted-change blockers.
        ...(repo ? [["New worktree", "worktree", { ...args, action: "new" }], ["Open worktree", "worktree", { ...args, action: "open" }], ["Checkout branch", "worktree", { ...args, action: "switch" }]] : []),
        ...(linked ? [["Remove worktree", "worktree", { ...args, action: "remove" }]] : []),
        // Every unpinned tab on this worktree's spaces; greyed out when there is none.
        ["Delete all tabs", "orca-menu.delete-all-tabs", { ids: [tg.id], disabled: !unpinnedTabs([tg.id]).length }],
        ...(open ? closeRows([tg.id], "Close") : []),
        // The card has no space of its own: its project's catalog entry is what draws it, so
        // the same Remove Project row the group header has takes the project out of the list.
        ...(!open && tg.repo ? [["Remove Project from Sidebar", "orca-menu.forget-project", { repo: tg.repo }]] : []),
      ];
    }
    default:
      return [
        ["New space", "space.new", {}],
        ["Keybinds", "app.help", {}],
        ["Theme: graphite", "app.theme", { name: "graphite" }],
        ["Theme: ink", "app.theme", { name: "ink" }],
        ["Theme: moss", "app.theme", { name: "moss" }],
        ["Theme: atom one dark", "app.theme", { name: "atom-one-dark" }],
      ];
  }
}

// Orca's lucide glyph for each row, taken from the component named in the citation.
// Tabs of those spaces and of any other space on the same checkout (one card), minus pinned
// ones, without duplicates. Takes one id or a list of ids: a card, or a whole project group.
function unpinnedTabs(ids) {
  const all = spaces();
  const out = [];
  const seen = new Set();
  for (const id of Array.isArray(ids) ? ids : ids == null ? [] : [ids]) {
    const me = all.find((s) => s.id === id);
    if (!me) continue;
    for (const s of all) {
      if (s.machine !== me.machine || place(s) !== place(me)) continue;
      for (const t of s.tabs ?? []) {
        if (t.settled || seen.has(t.id)) continue;
        seen.add(t.id);
        out.push(t.id);
      }
    }
  }
  return out;
}

function menuIcon(it, zoomed) {
  const [, command, args] = it;
  // Orca's Remove Project is the trash glyph (repo-header-project-actions.tsx:204).
  if (command === "orca-menu.forget-project") return "mods/orca-menu/trash.svg";
  if (it[0] === "Clear Pane Title") return "mods/orca-menu/x.svg";
  if (command === "mod.open" && args?.name === "orca-split-menu") return "mods/orca-menu/panel-right-close.svg";
  if (command === "pane.split") return `mods/orca-menu/${args?.direction === "down" ? "panel-bottom-close" : "panel-right-close"}.svg`;
  if (command === "orca-menu.split-left") return "mods/orca-menu/arrow-left.svg";
  if (command === "orca-menu.split-up") return "mods/orca-menu/arrow-up.svg";
  if (command === "orca-menu.move-tab-split") return `mods/orca-menu/arrow-${args?.direction ?? "right"}.svg`;
  if (command === "orca-menu.unsplit-to-tab") return "mods/orca-menu/plus.svg";
  if (command === "pane.swap") return `mods/orca-menu/arrow-${args?.direction ?? "right"}.svg`;
  if (command === "pane.zoom") return `mods/orca-menu/${zoomed ? "minimize-2" : "maximize-2"}.svg`;
  if (command === "worktree") return `mods/orca-menu/${args?.action === "new" ? "git-branch-plus" : args?.action === "open" ? "workflow" : args?.action === "switch" ? "git-fork" : "unlink"}.svg`;
  if (command === "tab.move") return `mods/orca-menu/${it[0] === "Move Left" ? "arrow-left" : "arrow-right"}.svg`;
  if (command === "orca-menu.close-others" || command === "orca-menu.delete-all-tabs" || command === "orca-menu.close-split-panes") return "mods/orca-menu/x.svg";
  if (command === "tab.settle" || command === "tab.unsettle") return `mods/orca-menu/${command === "tab.unsettle" ? "pin-off" : "pin"}.svg`;
  if (command === "orca-menu.handoff") return "mods/orca-menu/message-square-plus.svg";
  if (command === "orca-menu.fork") return "mods/orca-menu/git-fork.svg";
  if (command === "orca-menu.copy-context") return "mods/orca-menu/copy.svg";
  // TerminalContextMenu.tsx:218, 360, 364
  if (command === "orca-menu.select-all") return "mods/orca-menu/text-select.svg";
  if (command === "orca-menu.clear-screen") return "mods/orca-menu/eraser.svg";
  if (command === "orca-menu.reset-terminal") return "mods/orca-menu/rotate-ccw.svg";
  // WorktreeContextMenuView.tsx:204-208 — BellOff when isUnread, Bell otherwise
  if (command === "orca-menu.toggle-unread") return it[0] === "Mark Read" ? "mods/orca-menu/bell-off.svg" : "mods/orca-menu/bell.svg";
  const name = command === "orca-menu.copy-path" || command === "orca-menu.copy-name" || command === "orca-menu.copy-terminal" || command === "orca-menu.copy-pane-id" || command === "terminal.copy" ? "copy"
    : command === "terminal.paste" ? "clipboard"
    : command === "terminal.open" ? "folder-open"
    : (command.endsWith(".close") || command === "orca-menu.close-group") ? "x"
    : command.endsWith(".rename") ? "pencil"
    : command.endsWith(".new") ? "plus"
    : command === "app.help" ? "terminal" : command === "app.theme" ? "settings" : "terminal";
  return `mods/orca-menu/${name}.svg`;
}

// Orca's separators, by menu: DropdownMenuSeparator at mx-10 my-5
// (dropdown-menu.tsx:208).
function section(p, list, i) {
  const it = list[i], prev = list[i - 1];
  if (!prev) return false;
  // Close starts its own group in every menu (dropdown-menu.tsx:208): pane
  // (TerminalContextMenu.tsx:355), tab (SortableTabContextMenu.tsx:207), space (:196).
  if (it[1] === "orca-menu.delete-all-tabs") return true;
  if (it[1].endsWith(".close") || it[1] === "orca-menu.close-group") return prev[1] !== "orca-menu.delete-all-tabs";
  // Orca's pane menu separates the Copy/Paste block from the split section
  // (TerminalContextMenu.tsx:263), and separates swap/move and zoom blocks.
  if (p?.tab === "pane") {
    const isSplit = (x) => x && (x[1] === "pane.split" || x[1] === "orca-menu.split-left" || x[1] === "orca-menu.split-up" || x[1] === "orca-menu.unsplit-to-tab");
    if (isSplit(it) && !isSplit(prev)) return true;
    if (it[1] === "pane.swap" && prev[1] !== "pane.swap") return true;
    if (it[1] === "pane.zoom" && prev[1] !== "pane.zoom") return true;
    // TerminalContextMenu.tsx:308 — separator before title/id block
    const isTitleId = (x) => x && (x[0] === "Set Title…" || x[1] === "tab.rename" || x[1] === "terminal.right_click" || x[1] === "terminal.park" || x[1] === "orca-menu.copy-terminal" || x[1] === "orca-menu.copy-pane-id");
    if (isTitleId(it) && !isTitleId(prev)) return true;
    // TerminalContextMenu.tsx:358 — separator before clear screen
    if (it[1] === "orca-menu.clear-screen") return true;
  }
  if (p?.tab === "tab") {
    // SortableTabContextMenu.tsx:186 — separator before Pin/Unpin Tab
    if (it[1] === "tab.settle" || it[1] === "tab.unsettle") return true;
    // CloseSplitPaneMenuItem.tsx:20 — separator before Close split pane
    if (it[1] === "orca-menu.close-split-panes") return true;
    // SortableTabContextMenu.tsx:217 — separator before Change Title
    if (it[0] === "Change Title") return true;
  }
  if (p?.tab === "space") {
    // WorktreeContextMenuView.tsx:177, 196, 218, 350
    if (it[1] === "terminal.open") return true;
    if (it[1] === "orca-menu.toggle-unread") return true;
    if (it[1] === "worktree" && prev[1] !== "worktree") return true;
    // Orca's Remove Project closes the menu with a destructive block of its own.
    if (it[1] === "orca-menu.forget-project") return true;
  }
  if (p?.tab === "group") {
    if (it[1] === "orca-menu.copy-path") return true;
    if (it[1] === "space.rename") return true;
    if (it[1] === "orca-menu.forget-project") return true;
  }
  // The global list is Herdr's own; keep its rows apart as before.
  if (!p?.tab || p.tab === "global") return it[1] === "app.help" || (it[1] === "app.theme" && prev[1] !== "app.theme");
  return false;
}

// Orca's destructive row is --destructive: #ff6568 dark, #e40014 light (main.css:474,437);
// Herdr has no such token.
function destructive() {
  return window.appearance() === "dark" ? "#ff6568" : "#e40014";
}

// Orca marks pane close, close split pane (CloseSplitPaneMenuItem.tsx:21-24), and workspace close rows destructive;
// the tab's Close is plain (TerminalContextMenu.tsx:351, WorktreeContextMenuView.tsx:353, SortableTabContextMenu.tsx:208, repo-header-project-actions.tsx:181).
function isDestructive(p, it) {
  return it[1] === "pane.close" || (p?.tab === "pane" && it[1] === "tab.close") || it[1] === "orca-menu.close-split-panes" || it[1] === "orca-menu.delete-all-tabs" || it[1] === "orca-menu.forget-project" || ((p?.tab === "space" || p?.tab === "group") && (it[1] === "space.close" || it[1] === "orca-menu.close-group"));
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = (keys() ?? []).find((b) => b.action === name || b.action === `${name}:${value}`);
  return k ? k.keys : "";
}

// The key the way the tab menu writes it: `keys()` spells a chord `cmd-shift-d`, and a person
// reads it ⇧⌘D (ShortcutKeyCombo.tsx:52-66 shows one cap per key). A key with no modifier keeps
// its own name, so f2 stays f2, and an unbound command keeps the empty string, which draws
// nothing.
const MODIFIER_GLYPHS = [["ctrl", "⌃"], ["alt", "⌥"], ["shift", "⇧"], ["cmd", "⌘"]];
function keyHint(chord) {
  let rest = String(chord ?? "");
  const held = new Set();
  for (let m; (m = /^(cmd|ctrl|alt|shift)-/.exec(rest));) {
    held.add(m[1]);
    rest = rest.slice(m[0].length);
  }
  if (held.size === 0) return rest;
  return MODIFIER_GLYPHS.filter(([name]) => held.has(name)).map(([, glyph]) => glyph).join("") + rest.toUpperCase();
}

// The tab menu's own header: which tab these rows act on. A right-click can land on a background
// tab, while Orca's menu belongs to the tab it acts on (SortableTabContextMenu.tsx), so Herdr
// needs to say it. It is not a row - ↑/↓ skip it and Enter never runs it.
function contextHeader(p, t) {
  const tg = p?.target ?? {};
  const space = spaces().find((s) => s.id === tg.space) ??
    spaces().find((s) => (s.tabs ?? []).some((x) => x.id === tg.id));
  const tab = (space?.tabs ?? []).find((x) => x.id === tg.id);
  if (!tab) return div();
  // SortableTab.tsx:130-131 — a named tab shows its name, an unnamed one shows what runs in it.
  const mine = panes().filter((x) => x.tab === tab.id);
  const pane = mine.find((x) => x.program?.agent) ?? mine[0];
  const label = tab.named ? (tab.name ?? "Terminal") : (pane?.title || pane?.program?.name || tab.name || "Terminal");
  const where = [space?.name, space?.branch].filter(Boolean).join(" · ");
  return v_flex().px(8).pt(6).pb(8).gap(3)
    .child(h_flex().items_center().gap(7)
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(label))
      // Pinned: Herdr's `settled`, the state the Pin/Unpin row below toggles.
      .when(Boolean(tab.settled), (el) => el.child(h_flex().flex_none().items_center().justify_center()
        .p(4).rounded(5).border_1().border_color(t.border)
        .child(svg("mods/orca-menu/pin.svg").size(10).text_color(t.muted)))))
    .when(Boolean(where), (el) => el.child(div().truncate().text_size(10).text_color(t.muted).child(where)));
}

// Orca's tab Close is plain there (SortableTabContextMenu.tsx:208) and Herdr closes several tabs
// from one menu, so these rows wear Orca's destructive colour only while they are the current row
// (hover, ↑/↓): the red is a warning about what Enter is about to do, not decoration.
function closeRow(p, it) {
  return p?.tab === "tab" && (it[1] === "tab.close" || it[1] === "orca-menu.close-others" ||
    it[1] === "orca-menu.close-right" || it[1] === "orca-menu.close-left");
}

export default class Menu extends View {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props();
    const tg = p?.target ?? {};
    const space = p?.tab === "space" && spaces().find((s) => s.id === tg.id);
    // A card hands over the worktree's own `linked`, so only a space whose git state has not
    // loaded needs the checkout probe.
    const folder = space ? place(space) : tg.folder ?? tg.top ?? null;
    if (p?.tab === "space" && folder && typeof tg.linked !== "boolean")
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, tg.machine ?? space?.machine ?? null).catch(() => null);
        cx.notify();
      });
  }

  choose(i, cx) {
    const pProps = props();
    const it = items(pProps, this.git)[i];
    if (!it || it[2]?.disabled) return;
    const overlayId = pProps?.overlay;
    // `terminal.copy`/`terminal.paste` act on the focused terminal (commands.md:285-287), so
    // focus the pane that was right-clicked before the overlay gives focus back.
    if (it[1] === "terminal.copy" || it[1] === "terminal.paste") {
      const tg = pProps?.target ?? {};
      if (tg.pane || tg.terminal) run("pane.focus", tg.pane ? { pane: tg.pane } : { terminal: tg.terminal });
      run(it[1], it[2]);
      closeOverlay(overlayId);
      return;
    }
    if (it[1].startsWith("orca-menu.")) {
      const target = pProps?.target ?? {};
      const space = spaces().find((s) => s.id === (target.id ?? ""));
      const folder = space ? place(space) : "";
      // CopyTabIdMenuItem.tsx:16 — writeClipboardText(`orcaTabId: ${unifiedTabId}`)
      if (it[1] === "orca-menu.copy-tab-id") copyText(`orcaTabId: ${it[2].id ?? ""}`, cx);
      if (it[1] === "orca-menu.copy-path") {
        const p = it[2]?.path || target.path || target.folder || target.top || folder || (space ? home() : "");
        copyText(p, cx);
      }
      // Display name: explicit custom name (space.named), else branch name, else folder basename
      // (Orca spec: worktree-default-display-name.ts:13-25 resolveWorktreeDisplayName).
      if (it[1] === "orca-menu.copy-name") {
        const customName = (space?.named || target.named) ? (space?.name || target.name) : null;
        const branchName = it[2]?.name || target.branch || null;
        const folderPath = String(it[2]?.folder ?? target.folder ?? target.path ?? folder ?? "");
        const fallback = folderPath.replace(/\/+$/, "").split("/").pop() || space?.name || "";
        const name = customName || branchName || fallback;
        copyText(name, cx);
      }
      if (it[1] === "orca-menu.close-group") {
        for (const id of (it[2]?.ids ?? [])) {
          run("space.close", { id, confirmed: true });
        }
        closeOverlay(overlayId);
        return;
      }
      // Remove Project from Sidebar: the catalog and the rows drawn from it belong to
      // orca-spaces, so hand the repo over through the shared store and ping its loop
      // (setShared alone does not wake another mod, AGENTS.md rule 10).
      if (it[1] === "orca-menu.forget-project") {
        if (it[2]?.repo) {
          setShared("orca-spaces.forget", { repo: it[2].repo, at: Date.now() });
          run("orca-spaces.forget-project");
        }
        closeOverlay(overlayId);
        return;
      }
      // WorktreeContextMenuView.tsx:203-214 — toggle read / unread
      if (it[1] === "orca-menu.toggle-unread") {
        try {
          const list = stored("spaces.unread.v1", []);
          const set = new Set(Array.isArray(list) ? list : []);
          set.has(it[2].id) ? set.delete(it[2].id) : set.add(it[2].id);
          const updated = [...set];
          localStorage.setItem("spaces.unread.v1", JSON.stringify(updated));
          setShared("spaces.unread.v1", updated);
        } catch {}
        closeOverlay(overlayId);
        return;
      }
      // Close Others — SortableTabContextMenu.tsx:213 & useBulkTabCloseConfirmation (bulk-tab-close-confirmation.ts:5-15)
      if (it[1] === "orca-menu.close-others") {
        const owner = spaces().find((s) => (s.tabs ?? []).some((x) => x.id === it[2].id));
        const targetIds = (owner?.tabs ?? []).filter((x) => x.id !== it[2].id && !x.settled).map((x) => x.id);
        if (targetIds.length > 0) {
          openOverlay({
            mod: "orca-tabs",
            kind: "dialog",
            modal: true,
            width: 384,
            height: 180,
            props: {
              confirmClose: {
                kind: "bulk",
                scope: "others",
                tabIds: targetIds,
              }
            }
          });
        }
        closeOverlay(overlayId);
        return;
      }
      // Herdr's own rows (Orca has none). The same confirmation as Close Others, and the ids are
      // read again here rather than taken from the row, so a tab closed or pinned while the menu
      // was open is honored.
      if (it[1] === "orca-menu.close-right" || it[1] === "orca-menu.close-left") {
        const side = it[1] === "orca-menu.close-right" ? "right" : "left";
        const owner = spaces().find((s) => (s.tabs ?? []).some((x) => x.id === it[2].id));
        const targetIds = closeSideTabs(owner, it[2].id, side);
        if (targetIds.length > 0) {
          openOverlay({
            mod: "orca-tabs",
            kind: "dialog",
            modal: true,
            width: 384,
            height: 180,
            props: {
              confirmClose: {
                kind: "bulk",
                scope: side,
                tabIds: targetIds,
              }
            }
          });
        }
        closeOverlay(overlayId);
        return;
      }
      // Same confirmation as Close Others; pinned tabs were left out of `tabIds` already.
      if (it[1] === "orca-menu.delete-all-tabs") {
        // Spaces may have changed since the menu opened: ask again, not the list it carried.
        const ids = unpinnedTabs(it[2].ids ?? [it[2].id]);
        if (ids.length > 0) {
          // A project group spans several checkouts; say so in the dialog. One checkout needs no
          // extra line, since the worktree-level dialog says the same thing.
          const wanted = new Set(ids);
          const owners = new Set();
          for (const s of spaces()) {
            if ((s.tabs ?? []).some((t) => wanted.has(t.id)))
              owners.add(`${s.machine ?? ""}\u0000${place(s)}`);
          }
          const detail = owners.size > 1 ? `${ids.length} tabs in ${owners.size} worktrees` : undefined;
          openOverlay({ mod: "orca-tabs", kind: "dialog", modal: true, width: 384, height: 180,
            props: { confirmClose: { kind: "bulk", scope: "all", tabIds: ids, ...(detail ? { detail } : {}) } } });
        }
        closeOverlay(overlayId);
        return;
      }
      if (it[1] === "orca-menu.move-tab-split") {
        setShared("orca-tabs.action", {
          kind: "move-tab-split",
          tab: it[2].id,
          direction: it[2].direction,
        });
        closeOverlay(overlayId);
        return;
      }
      if (it[1] === "orca-menu.unsplit-to-tab") {
        setShared("orca-tabs.action", {
          kind: "unsplit-to-tab",
          terminal: it[2].terminal,
          pane: it[2].pane,
        });
        closeOverlay(overlayId);
        return;
      }
      if (it[1] === "orca-menu.close-split-panes") {
        const mine = panes().filter((x) => x.tab === it[2].id);
        const keep = mine.find((x) => x.focused) ?? mine[0];
        for (const x of mine) if (x !== keep) run("pane.close", { pane: x.pane });
        closeOverlay(overlayId);
        return;
      }
      if (it[1] === "orca-menu.split-left") {
        if (it[2]?.pane) run("pane.focus", { pane: it[2].pane });
        run("pane.split", { direction: "right", ...(it[2]?.pane ? { pane: it[2].pane } : {}) });
        run("pane.swap", { direction: "left" });
        closeOverlay(overlayId);
        return;
      }
      if (it[1] === "orca-menu.split-up") {
        if (it[2]?.pane) run("pane.focus", { pane: it[2].pane });
        run("pane.split", { direction: "down", ...(it[2]?.pane ? { pane: it[2].pane } : {}) });
        run("pane.swap", { direction: "up" });
        closeOverlay(overlayId);
        return;
      }
      if (it[1] === "orca-menu.copy-terminal" || it[1] === "orca-menu.copy-pane-id") {
        copyText(it[2].id ?? "", cx);
        closeOverlay(overlayId);
        return;
      }
      // Copy Context (terminal-pane-menu-agent-session-actions.ts:58-65 & terminal-agent-session-fork.ts:139):
      // Extracts up to 1000 lines scrollback, cleans and bounds transcript to clipboard.
      if (it[1] === "orca-menu.copy-context" && it[2].terminal) {
        if (it[2]?.pane) run("pane.focus", { pane: it[2].pane });
        hc(["read", "--lines", "1000", it[2].terminal]).then((r) => {
          if (!r?.stdout) return;
          const clean = buildBoundedSessionTranscript(r.stdout);
          if (clean) copyText(clean, cx);
        }).catch(() => {});
        closeOverlay(overlayId);
        return;
      }
      // Hand Off to Another Agent (AgentSessionContinuationDialog.tsx:59)
      if (it[1] === "orca-menu.handoff") {
        if (it[2]?.pane) run("pane.focus", { pane: it[2].pane });
        openOverlay({
          mod: "orca-handoff",
          kind: "dialog",
          width: 480,
          height: 380,
          props: { action: "handoff", terminal: it[2].terminal, pane: it[2].pane }
        });
        closeOverlay(overlayId);
        return;
      }
      // Fork Agent Session (TerminalAgentSessionForkDialog.tsx:25)
      if (it[1] === "orca-menu.fork") {
        if (it[2]?.pane) run("pane.focus", { pane: it[2].pane });
        openOverlay({
          mod: "orca-handoff",
          kind: "dialog",
          width: 480,
          height: 320,
          props: { action: "fork", terminal: it[2].terminal, pane: it[2].pane }
        });
        closeOverlay(overlayId);
        return;
      }
      // Select All: Herdr cannot select, so the screen and scrollback buffer go to the clipboard (TerminalContextMenu.tsx:217).
      if (it[1] === "orca-menu.select-all" && it[2].terminal) {
        if (it[2]?.pane) run("pane.focus", { pane: it[2].pane });
        hc(["read", "--lines", "10000", it[2].terminal]).then((r) => {
          if (r?.code === 0 && r.stdout.trim()) copyText(r.stdout, cx);
        }).catch(() => {});
        closeOverlay(overlayId);
        return;
      }
      // Clear Screen / Reset Terminal: `hc` writes to the terminal; Ctrl+L clears the screen,
      // `reset` restores the terminal modes (TerminalContextMenu.tsx:359-369).
      if (it[1] === "orca-menu.clear-screen" && it[2].terminal) {
        if (it[2]?.pane) run("pane.focus", { pane: it[2].pane });
        void hc(["keys", it[2].terminal, "ctrl+l"]);
        closeOverlay(overlayId);
        return;
      }
      if (it[1] === "orca-menu.reset-terminal" && it[2].terminal) {
        if (it[2]?.pane) run("pane.focus", { pane: it[2].pane });
        void hc(["send", it[2].terminal, "reset"]);
        closeOverlay(overlayId);
        return;
      }
      closeOverlay(overlayId);
      return;
    }
    if (it[1] === "pane.swap") {
      if (it[2]?.pane) run("pane.focus", { pane: it[2].pane });
      run("pane.swap", { direction: it[2].direction, ...(it[2]?.pane ? { pane: it[2].pane } : {}) });
      closeOverlay(overlayId);
      return;
    }
    if (it[1] === "pane.zoom") {
      if (it[2]?.pane) run("pane.focus", { pane: it[2].pane });
      run("pane.zoom", it[2]);
      closeOverlay(overlayId);
      return;
    }
    if (it[1] === "pane.split") {
      // TerminalTabSplitMenuSection.tsx:37-39: activate inactive tab before splitting
      if (props()?.tab === "tab" && props()?.target?.id) {
        run("tab.select", { id: props().target.id });
      }
      if (it[2]?.pane) run("pane.focus", { pane: it[2].pane });
      run("pane.split", it[2]);
      closeOverlay(overlayId);
      return;
    }
    if (it[1] === "terminal.open" && props()?.tab === "space") {
      const tg = props()?.target ?? {};
      const isOpen = spaces().some((s) => s.id === tg.id);
      if (isOpen) {
        // Activate target space, then open the terminal tab in it (WorktreeRowOpenInSubMenu.tsx:11-28)
        run("space.select", { id: tg.id });
        run("terminal.open", it[2]);
        run("layout.select", { stack: "main", child: "main-terminals" });
      } else {
        // Unopened worktree card: create a space for it and switch to terminals layout
        // (matching orca-spaces/main.js:1062 & 1153)
        const targetFolder = it[2]?.folder || tg.folder || tg.top || tg.path;
        run("space.new", { ...(targetFolder ? { folder: targetFolder } : {}), ...(tg.machine ? { machine: tg.machine } : {}) });
        run("layout.select", { stack: "main", child: "main-terminals" });
      }
      closeOverlay(overlayId);
      return;
    }
    if (it[1] === "worktree") {
      openOverlay({ mod: "orca-worktree", kind: "dialog", ...(it[2].action === "open" || it[2].action === "switch" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
      closeOverlay(overlayId);
    } else if (it[1] === "tab.close") {
      // Close tab confirmation — terminal-tab-actions.ts:121-131 & running-terminal-close-guard.ts:56-97
      const owner = spaces().find((s) => (s.tabs ?? []).some((x) => x.id === it[2].id));
      const tab = (owner?.tabs ?? []).find((x) => x.id === it[2].id);
      if (tab) {
        if (tab.settled) {
          let skipPinned = false;
          try { skipPinned = localStorage.getItem("orca.confirmClosePinnedTab") === "false"; } catch {}
          if (!skipPinned) {
            const tabPanes = panes().filter((p) => p.tab === tab.id);
            const pane = tabPanes.find((p) => p.program?.agent) ?? tabPanes[0];
            const program = pane?.program;
            const name = tab.named ? (tab.name ?? "Terminal") : (pane?.title || program?.name || tab.name || "Terminal");
            openOverlay({
              mod: "orca-tabs",
              kind: "dialog",
              modal: true,
              width: 384,
              height: 200,
              props: { confirmClose: { kind: "pinned", tabId: tab.id, tabLabel: name } }
            });
            closeOverlay(overlayId);
            return;
          }
        }
        const tabPanes = panes().filter((p) => p.tab === tab.id);
        const isAgent = tabPanes.some((p) => p.program?.agent || p.status === "working" || p.status === "blocked") ||
                        tab.status === "working" || tab.status === "blocked";
        const isRunningCommand = tabPanes.some((p) => p.program && !p.program.shell && !p.program.agent);
        let skipRunning = false;
        try { skipRunning = localStorage.getItem("orca.skipCloseTerminalWithRunningProcessConfirm") === "true"; } catch {}
        if (!skipRunning && (isAgent || isRunningCommand)) {
          const pane = tabPanes.find((p) => p.program?.agent) ?? tabPanes[0];
          const program = pane?.program;
          const name = tab.named ? (tab.name ?? "Terminal") : (pane?.title || program?.name || tab.name || "Terminal");
          openOverlay({
            mod: "orca-tabs",
            kind: "dialog",
            modal: true,
            width: 384,
            height: isAgent ? 240 : 208,
            props: { confirmClose: { kind: isAgent ? "agent" : "command", tabId: tab.id, tabLabel: name } }
          });
          closeOverlay(overlayId);
          return;
        }
      }
      run("tab.close", it[2]);
      closeOverlay(overlayId);
    } else {
      run(it[1], it[2]);
      closeOverlay(overlayId);
    }
  }

  render(cx) {
    const t = theme();
    const p = props();
    const list = items(p, this.git);
    const zoomed = panes().find((x) => x.pane === p?.target?.pane)?.zoomed;
    const bad = destructive();
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      // Content: rounded-[11px] border p-[4px] min-w-[11rem] (dropdown-menu.tsx:80). The
      // overlay frame owns radius, border and shadow, and it stays that way on purpose:
      // `frame: "none"` hands them to this mod, but a popup's window is exactly its content box,
      // so a `.shadow_*()` here is clipped away (measured) and the menu would end up flat and out
      // of step with the pane, space and group menus, which keep the host frame.
      .p(4)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "home") this.at = 0;
        else if (e.key === "end") this.at = list.length - 1;
        // Radix activates with Enter or Space (context-menu.tsx:31-62). Type-ahead and
        // ChevronRight submenus have no flat-list equivalent here.
        else if (e.key === "enter" || e.key === "space") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props()?.overlay);
        else return;
        cx.notify();
      })
      .children([
        // Orca labels the card section only for a multi-selection; a single highlighted
        // card already names the worktree (WorktreeContextMenuView.tsx:147-152). Herdr has
        // no multi-select yet, so this stays off unless a caller asks for it.
        ...(p?.tab === "space" && p?.multi
          ? [div().px(10).pt(5).pb(3).text_size(11).font_semibold().text_color(t.muted).child("Workspace")]
          : []),
        ...(p?.tab === "tab" ? [contextHeader(p, t)] : []),
        ...list.map((it, i) => {
          const off = Boolean(it[2]?.disabled);
          const red = !off && isDestructive(p, it);
          const current = i === this.at && !off;
          // A close row turns red only as the current row (see closeRow).
          const warn = closeRow(p, it) && current;
          // Orca's Copy Tab ID and Close Others are `inset`: no icon, 32px left pad
          // (CopyTabIdMenuItem.tsx:24, SortableTabContextMenu.tsx:208). Herdr's Close to the
          // Right/Left sit in the same block.
          const inset = it[1] === "orca-menu.copy-tab-id" || it[1] === "orca-menu.close-others" ||
            it[1] === "orca-menu.close-right" || it[1] === "orca-menu.close-left";
          return v_flex()
            // Separator: mx-2.5 my-[5px] h-px (dropdown-menu.tsx:208).
            .when(section(p, list, i), (el) => el.child(div().mx(10).my(5).h(1).bg(t.border)))
            .child(h_flex()
            .id(`mi-${i}`)
            // Item: gap-2 rounded-md px-2.5 py-1 text-[13px] leading-4 = 24px row
            // (dropdown-menu.tsx:115); icon 3.5 = 14. The tab menu is Herdr's only menu whose
            // rows carry a title, a shortcut and long labels ("Move Tab to Split Right"), so it
            // gets 30px rows; the others keep Orca's 24.
            .h(p?.tab === "tab" ? 30 : 24)
            .px(10)
            .when(inset, (el) => el.pl(32))
            .gap(8)
            .rounded(6)
            .items_center()
            .justify_between()
            .line_height("16px")
            // Orca's rows are whitespace-nowrap (TerminalContextMenu.tsx:265,273); the label
            // gives way with an ellipsis rather than wrapping inside the fixed popup.
            .whitespace_nowrap()
            .text_color(red || warn ? bad : off ? t.muted : t.foreground)
            // One current row: pointer hover moves `this.at`, so hover, keyboard and Enter
            // agree (dropdown-menu.tsx:115 data-[current=true]).
            .when(current, (el) => el.bg(red || warn ? `${bad}1a` : t.selected))
            .on_hover((hovered, cx) => { if (hovered && !off && this.at !== i) { this.at = i; cx.notify(); } })
            .on_click((_e, cx) => this.choose(i, cx))
            .when(!inset, (el) => el.child(svg(menuIcon(it, zoomed)).size(14).flex_none()
              .text_color(red || warn ? bad : t.muted)))
            .child(div().flex_1().min_w(0).truncate().child(it[0]))
            // Shortcut: ml-auto shrink-0 whitespace-nowrap pl-4 text-muted-foreground
            // (dropdown-menu.tsx:219). The tab menu writes the chord as a person reads it
            // (⌘W, ⇧⌘D, f2); the other menus keep Herdr's own spelling.
            .child(div().pl(16).flex_none().whitespace_nowrap().text_color(t.muted)
              .child(p?.tab === "tab" ? keyHint(shortcut(it[1], it[2])) : shortcut(it[1], it[2]))));
        }),
      ]);
  }
}
