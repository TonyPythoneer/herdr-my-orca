// Derived from Herdr App's defaults/mods/menu/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
// Context menus (Herdr's items). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "group", target }.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// a command "worktree" opens the worktree dialog instead.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, exec, hc, home, setShared } from "herdr";
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


const tabsOf = (space) => space?.tabs ?? [];
const owningSpace = (tabId) => spaces().find((s) => tabsOf(s).some((x) => x.id === tabId));
const panesOfTab = (tabId) => panes().filter((x) => x.tab === tabId);
const LAYOUT_CHILD = { stack: "main", child: "main-terminals" };

// A row that acts on a terminal: its address and the pane it sits in.
const terminalRow = (label, command, term, tg) => [label, command, { terminal: term.address, pane: tg.pane }];

// The rows from Copy to Copy Context. Orca's order (TerminalContextMenu.tsx:204-370): Copy,
// Add to chat, Select All, Paste, Quick Commands, agent rows, split section, title/ID block,
// close, clear, reset. Add to chat (:209) stays out: Herdr has no chat.
function paneClipboardRows(tg, term, isAgent) {
  return [
    ["Copy", "terminal.copy", {}],
    // Herdr cannot select the buffer; this copies up to 10,000 lines instead.
    ...(term ? [terminalRow("Copy Terminal Buffer", "orca-context-menu.select-all", term, tg)] : []),
    ["Paste", "terminal.paste", {}],
    // Orca's Quick Commands menu (:227) is its command surface; Herdr's is the palette.
    ["Quick Commands", "app.palette", {}],
    // Orca's agent rows (TerminalContextMenu.tsx:236-246):
    // Hand Off to Another Agent (:236, canContinueAgentSessionInNewSession / isTuiAgent),
    // Fork Agent Session… (:239), Copy Context (:246).
    ...(term
      ? [
          ...(isAgent ? [terminalRow("Hand off to agent", "orca-context-menu.handoff", term, tg)] : []),
          terminalRow("Fork Agent Session…", "orca-context-menu.fork", term, tg),
          terminalRow("Copy Context", "orca-context-menu.copy-context", term, tg),
        ]
      : []),
  ];
}

// Orca's split section (TerminalContextMenu.tsx:265-302, TabWorkspaceLayoutMenuSection.tsx:14-41).
// Equalize Pane Sizes (:281) has no equivalent: panes are content inside one layout node.
function paneSplitRows(tg, term, hasSiblings) {
  return [
    ["Split Terminal Right", "pane.split", { direction: "right", pane: tg.pane }],
    ["Split Terminal Left", "orca-context-menu.split-left", { pane: tg.pane }],
    ["Split Terminal Down", "pane.split", { direction: "down", pane: tg.pane }],
    ["Split Terminal Up", "orca-context-menu.split-up", { pane: tg.pane }],
    ...(hasSiblings
      ? [
          ["Move to New Tab", "orca-context-menu.unsplit-to-tab", { pane: tg.pane, terminal: term?.address }],
          ["Swap with Left", "pane.swap", { pane: tg.pane, direction: "left" }],
          ["Swap with Right", "pane.swap", { pane: tg.pane, direction: "right" }],
          ["Swap with Above", "pane.swap", { pane: tg.pane, direction: "up" }],
          ["Swap with Below", "pane.swap", { pane: tg.pane, direction: "down" }],
        ]
      : []),
  ];
}

// Orca's title/ID block (:307-347). Orca's pane title is the tab's custom title
// (`ClaudeAccountSwitchSessionTree.tsx:276` = `customTitle || title`), so `tab.rename`
// names it, and an empty name drops it (`commands.rs:40`). Clear Pane Title is gated
// on menuPaneHasCustomTitle (TerminalPaneSurface.tsx:317).
function paneTitleRows(own, curTab) {
  if (!own?.tab) return [];
  return [
    ["Set Title…", "tab.rename", { id: own.tab }],
    ...(curTab?.named ? [["Clear Pane Title", "tab.rename", { id: own.tab, name: "" }]] : []),
  ];
}

// Herdr-only: Orca has no right-click routing or park command; kept where the title/ID block
// sits. Copy Session/Terminal/Pane ID (:329-347): Herdr ids go to the clipboard through
// `clip.js`. The session id has no counterpart.
function paneIdentityRows(term, parent, toProgram) {
  if (!term) return [];
  return [
    toProgram
      ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
      : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
    ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
    ["Copy Terminal ID", "orca-context-menu.copy-terminal", { id: term.address }],
  ];
}

// TerminalContextMenu.tsx:348-357: Close Pane / Close tab. Gated on canCloseTerminalPane
// (terminal-pane-close-affordance.ts:6-14: true if paneCount > 1, or !isTabPinned). Orca's
// close row names the tab when this is its last pane (terminal-pane-close-affordance.ts:16).
function paneCloseRows(tg, own, alone, curTab) {
  if (alone && curTab?.settled) return [];
  return alone ? [["Close tab", "tab.close", { id: own?.tab }]] : [["Close Pane", "pane.close", { pane: tg.pane }]];
}

// The terminal behind the pane, the parent it can go back under, and where its right-click goes.
function paneTerminal(tg) {
  // A kept sub-agent can go back under its parent, still running.
  const all = terminals();
  const term = all.find((t) => t.address === tg.terminal);
  const parent = term?.parent && all.find((t) => t.address === term.parent);
  // Once they go to the program, Shift+right-click still opens this menu.
  const toProgram = term?.labels?.["herdr.right-click"] === "program";
  return { term, parent, toProgram };
}

const isWorking = (x) => x?.status === "working" || x?.status === "blocked";
const paneIsAgent = (own, term) => Boolean(own?.program?.agent || isWorking(own) || term?.agent);

function paneItems(tg) {
  const { term, parent, toProgram } = paneTerminal(tg);
  const own = panes().find((x) => x.pane === tg.pane);
  const paneCount = own ? panesOfTab(own.tab).length : 0;
  const alone = Boolean(own) && paneCount < 2;
  const curTab = spaces().flatMap(tabsOf).find((t) => t.id === own?.tab);
  return [
    ...paneClipboardRows(tg, term, paneIsAgent(own, term)),
    ...paneSplitRows(tg, term, Boolean(own) && paneCount > 1),
    [own?.zoomed ? "Collapse Pane" : "Expand Pane", "pane.zoom", { pane: tg.pane }],
    ...paneTitleRows(own, curTab),
    ...paneIdentityRows(term, parent, toProgram),
    ["Copy Pane ID", "orca-context-menu.copy-pane-id", { id: tg.pane ?? "" }],
    ...paneCloseRows(tg, own, alone, curTab),
    // Clear Screen (:359) and Reset Terminal (:363): no command sends input, so the
    // terminal is driven through `hc` — Ctrl+L for a clear, `reset` for a full one.
    ...(term
      ? [terminalRow("Clear Screen", "orca-context-menu.clear-screen", term, tg), terminalRow("Reset Terminal", "orca-context-menu.reset-terminal", term, tg)]
      : []),
  ];
}

// TabWorkspaceLayoutMenuSection.tsx:42-93 — Move Tab to Split across 4 directions.
const moveTabRows = (tg) => ["right", "left", "down", "up"].map((direction) => [
  `Move Tab to Split ${direction[0].toUpperCase()}${direction.slice(1)}`, "orca-context-menu.move-tab-split", { id: tg.id, direction },
]);

// Herdr's own, not an Orca port (SortableTabContextMenu.tsx has no such rows): the same
// inset block as Close Others, one side of this tab at a time, and left out on a side
// that has no unpinned tab - the rule Close Others follows with `tabCount <= 1`.
function closeSideRows(owner, tg) {
  return [
    ...(closeSideTabs(owner, tg.id, "right").length ? [["Close Tabs to the Right", "orca-context-menu.close-right", { id: tg.id }]] : []),
    ...(closeSideTabs(owner, tg.id, "left").length ? [["Close Tabs to the Left", "orca-context-menu.close-left", { id: tg.id }]] : []),
  ];
}

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
function tabItems(tg) {
  const owner = owningSpace(tg.id);
  const several = tabsOf(owner).length > 1;
  const tab = tabsOf(owner).find((x) => x.id === tg.id);
  const mine = panesOfTab(tg.id);
  const pane = (mine.find((x) => x.focused) ?? mine[0])?.pane;
  return [
    ...(several ? moveTabRows(tg) : []),
    ...(pane
      ? [
          // TerminalTabSplitMenuSection.tsx:46-77 — Split terminal right and down
          ["Split terminal right", "pane.split", { direction: "right", pane }],
          ["Split terminal down", "pane.split", { direction: "down", pane }],
        ]
      : []),
    // SortableTabContextMenu.tsx:187-196 — Orca's Pin/Unpin.
    tab?.settled ? ["Unpin Tab", "tab.unsettle", { id: tg.id }] : ["Pin Tab", "tab.settle", { id: tg.id }],
    // SortableTabContextMenu.tsx:206 & CopyTabIdMenuItem.tsx:16 — Copy Tab ID.
    ["Copy Tab ID", "orca-context-menu.copy-tab-id", { id: tg.id }],
    // SortableTabContextMenu.tsx:208-212 — Close.
    ["Close", "tab.close", { id: tg.id }],
    // SortableTabContextMenu.tsx:213 — inset, disabled when `tabCount <= 1`; with one tab
    // the loop in choose() would close nothing, so leave the row out.
    ...(several ? [["Close Others", "orca-context-menu.close-others", { id: tg.id }]] : []),
    ...closeSideRows(owner, tg),
    // Close split pane (CloseSplitPaneMenuItem.tsx:21-24) closes other panes in the split group
    ...(mine.length > 1 ? [["Close split pane", "orca-context-menu.close-split-panes", { id: tg.id }]] : []),
    // SortableTabContextMenu.tsx:218-222 — Change Title.
    ["Change Title", "tab.rename", { id: tg.id }],
  ];
}

// What the worktree dialog is opened with: the space when one is open, `{ folder, machine }`
// otherwise (defaults/mods/worktree/main.js:158).
const worktreeArgs = (space, folder, machine) =>
  ({ ...(space ? { space } : {}), ...(folder ? { folder } : {}), ...(machine ? { machine } : {}) });

// `RepoHeaderProjectActionsMenu` (repo-header-project-actions.tsx:121-186) &
// `ProjectGroupHeaderMenu` (project-group-header-actions.tsx:25-95):
// the ellipsis or right-click on a project group header. Its rows are project
// actions. In Herdr, open spaces belonging to the group can be renamed or closed.
function groupItems(tg) {
  const open = spaces().some((s) => s.id === tg.id);
  const inGroup = (s) => s.id === tg.id || (tg.path && (s.folder === tg.path || s.folder?.startsWith(tg.path + "/")));
  const groupSpaces = spaces().filter(inGroup);
  // The sidebar's own grouping (`tg.spaces`, from orca-sidebar-projects) knows the linked worktrees
  // stored outside the project folder; the folder-prefix match above misses them.
  // Only live spaces: a row git lists with no space open carries a made-up id
  // (`repo:`/`wt:`), and `space.close` would fail with `no space "repo:[...]"`.
  const groupIds = (tg.spaces?.length ? tg.spaces : groupSpaces.map((s) => s.id))
    .filter((id) => spaces().some((s) => s.id === id));
  const openSpace = groupSpaces[0];
  const folder = tg.path ?? (openSpace ? place(openSpace) : null);
  const args = worktreeArgs(open ? tg.id : openSpace?.id, folder, tg.machine);
  return [
    ["New worktree", "worktree", { ...args, action: "new" }],
    ["Open worktree", "worktree", { ...args, action: "open" }],
    ["Copy Path", "orca-context-menu.copy-path", { path: folder, id: tg.id }],
    ...(openSpace ? [["Rename workspace", "space.rename", { id: openSpace.id }]] : []),
    // Every unpinned tab of the project: the main checkout and every linked worktree, from the
    // sidebar's own grouping (`spaces`), which knows worktrees outside the project folder.
    ["Delete all tabs", "orca-context-menu.delete-all-tabs", { ids: tg.spaces ?? [], disabled: !unpinnedTabs(tg.spaces ?? []).length }],
    // `space.close` needs `confirmed` (the host refuses it otherwise), and a group closes
    // as one command (close-space.js).
    ...closeRows(groupIds),
    // A project with no open space is only the sidebar's catalog entry: nothing to close,
    // so Orca's Remove Project (`repo-header-project-actions.tsx:204`) is the row that
    // makes its cards go away. With a space open, close that instead.
    ...(tg.repo && groupIds.length === 0 ? [["Remove Project from Sidebar", "orca-context-menu.forget-project", { repo: tg.repo }]] : []),
  ];
}

// Not an Orca row: Orca's card menu has no branch switch because Source Control owns it,
// and this layout ports no Source Control. The dialog ports that picker's behaviour — one
// checkout, in place, behind the agent and uncommitted-change blockers.
const worktreeRows = (args, repo, linked) => [
  ...(repo ? [["New worktree", "worktree", { ...args, action: "new" }], ["Open worktree", "worktree", { ...args, action: "open" }], ["Checkout branch", "worktree", { ...args, action: "switch" }]] : []),
  ...(linked ? [["Remove worktree", "worktree", { ...args, action: "remove" }]] : []),
];

// The opener carries `linked`; `git` is the probe's fallback for a row whose git state
// had not loaded, or for a caller that sends only { id, path }.
function worktreeFacts(tg, git) {
  const known = typeof tg.linked === "boolean";
  return { linked: known ? tg.linked : git === "linked", repo: known || git !== null };
}

// Orca keys the menu on the worktree, not a tab (`worktree-card-surface.tsx:139-146`):
// Update and Close belong to a tab, while Open in / Copy Path / Copy Worktree Name and
// the worktree work are unconditional (`WorktreeContextMenuView.tsx:165-298`). A card
// with no open space still shows the latter, from the facts its opener passes.
function spaceItems(tg, git) {
  const open = spaces().some((s) => s.id === tg.id);
  const { linked, repo } = worktreeFacts(tg, git);
  const folder = tg.top || tg.folder || tg.path || null;
  const args = worktreeArgs(open ? tg.id : null, folder, tg.machine);
  return [
    ...(open ? [["Update", "space.rename", { id: tg.id }]] : []),
    // Orca's "Open in" is a submenu of external editors (WorktreeOpenInMenu.tsx:295-325);
    // Herdr has no external-open command, so this opens a Herdr terminal in the
    // worktree's folder instead (terminal.open, commands.md:277).
    ["Open in Terminal", "terminal.open", folder ? { folder } : {}],
    ["Copy Path", "orca-context-menu.copy-path", { path: folder, id: tg.id }],
    // The display name is custom, else the branch, else the folder's last segment
    // (`worktree-default-display-name.ts:13-25`).
    ["Copy Worktree Name", "orca-context-menu.copy-name", { id: tg.id, name: tg.branch ?? null, folder }],
    // WorktreeContextMenuView.tsx:203-214 — Mark Read / Mark Unread
    ["Mark " + (tg.unread ? "Read" : "Unread"), "orca-context-menu.toggle-unread", { id: tg.id }],
    ...worktreeRows(args, repo, linked),
    // Every unpinned tab on this worktree's spaces; greyed out when there is none.
    ["Delete all tabs", "orca-context-menu.delete-all-tabs", { ids: [tg.id], disabled: !unpinnedTabs([tg.id]).length }],
    ...(open ? closeRows([tg.id], "Close") : []),
    // The card has no space of its own: its project's catalog entry is what draws it, so
    // the same Remove Project row the group header has takes the project out of the list.
    ...(!open && tg.repo ? [["Remove Project from Sidebar", "orca-context-menu.forget-project", { repo: tg.repo }]] : []),
  ];
}

const globalItems = () => [
  ["New space", "space.new", {}],
  ["Keybinds", "app.help", {}],
  ["Theme: graphite", "app.theme", { name: "graphite" }],
  ["Theme: ink", "app.theme", { name: "ink" }],
  ["Theme: moss", "app.theme", { name: "moss" }],
  ["Theme: atom one dark", "app.theme", { name: "atom-one-dark" }],
];

function items(p, git) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": return paneItems(tg);
    case "tab": return tabItems(tg);
    case "group": return groupItems(tg);
    case "space": return spaceItems(tg, git);
    default: return globalItems();
  }
}

// Tabs of those spaces and of any other space on the same checkout (one card), minus pinned
// ones, without duplicates. Takes one id or a list of ids: a card, or a whole project group.
function unpinnedTabs(ids) {
  const all = spaces();
  const out = [];
  const seen = new Set();
  for (const id of toList(ids)) {
    const me = all.find((s) => s.id === id);
    if (!me) continue;
    const sameCheckout = all.filter((s) => s.machine === me.machine && place(s) === place(me));
    for (const t of sameCheckout.flatMap(tabsOf)) {
      if (t.settled || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t.id);
    }
  }
  return out;
}

function toList(ids) {
  if (Array.isArray(ids)) return ids;
  return ids == null ? [] : [ids];
}

// Orca's lucide glyph for each row, taken from the component named in the citation.
const iconPath = (name) => `mods/orca-context-menu/${name}.svg`;
const arrowIcon = (args) => `arrow-${args?.direction ?? "right"}`;
const WORKTREE_ICONS = { new: "git-branch-plus", open: "workflow", switch: "git-fork" };
const ICON_BY_COMMAND = new Map([
  // Orca's Remove Project is the trash glyph (repo-header-project-actions.tsx:204).
  ["orca-context-menu.forget-project", () => "trash"],
  ["mod.open", (_label, args) => (args?.name === "orca-split-menu" ? "panel-right-close" : undefined)],
  ["pane.split", (_label, args) => (args?.direction === "down" ? "panel-bottom-close" : "panel-right-close")],
  ["orca-context-menu.split-left", () => "arrow-left"],
  ["orca-context-menu.split-up", () => "arrow-up"],
  ["orca-context-menu.move-tab-split", (_label, args) => arrowIcon(args)],
  ["orca-context-menu.unsplit-to-tab", () => "plus"],
  ["pane.swap", (_label, args) => arrowIcon(args)],
  ["pane.zoom", (_label, _args, zoomed) => (zoomed ? "minimize-2" : "maximize-2")],
  ["worktree", (_label, args) => WORKTREE_ICONS[args?.action] ?? "unlink"],
  ["tab.move", (label) => (label === "Move Left" ? "arrow-left" : "arrow-right")],
  ["orca-context-menu.close-others", () => "x"],
  ["orca-context-menu.delete-all-tabs", () => "x"],
  ["orca-context-menu.close-split-panes", () => "x"],
  ["tab.settle", () => "pin"],
  ["tab.unsettle", () => "pin-off"],
  ["orca-context-menu.handoff", () => "message-square-plus"],
  ["orca-context-menu.fork", () => "git-fork"],
  ["orca-context-menu.copy-context", () => "copy"],
  // TerminalContextMenu.tsx:218, 360, 364
  ["orca-context-menu.select-all", () => "text-select"],
  ["orca-context-menu.clear-screen", () => "eraser"],
  ["orca-context-menu.reset-terminal", () => "rotate-ccw"],
  // WorktreeContextMenuView.tsx:204-208 — BellOff when isUnread, Bell otherwise
  ["orca-context-menu.toggle-unread", (label) => (label === "Mark Read" ? "bell-off" : "bell")],
  ...["orca-context-menu.copy-path", "orca-context-menu.copy-name", "orca-context-menu.copy-terminal", "orca-context-menu.copy-pane-id", "terminal.copy"].map((c) => [c, () => "copy"]),
  ["terminal.paste", () => "clipboard"],
  ["terminal.open", () => "folder-open"],
  ["orca-context-menu.close-group", () => "x"],
  ["app.theme", () => "settings"],
]);
// A command no row above names still gets a glyph from its verb.
const ICON_BY_SUFFIX = [[".close", "x"], [".rename", "pencil"], [".new", "plus"]];

function menuIcon(it, zoomed) {
  const [label, command, args] = it;
  if (label === "Clear Pane Title") return iconPath("x");
  const named = ICON_BY_COMMAND.get(command)?.(label, args, zoomed);
  return iconPath(named ?? ICON_BY_SUFFIX.find(([suffix]) => command.endsWith(suffix))?.[1] ?? "terminal");
}

// Orca's separators, by menu: DropdownMenuSeparator at mx-10 my-5
// (dropdown-menu.tsx:208). Each menu names the rows that start a new block.
const isSplitRow = (x) => x && ["pane.split", "orca-context-menu.split-left", "orca-context-menu.split-up", "orca-context-menu.unsplit-to-tab"].includes(x[1]);
const TITLE_BLOCK_COMMANDS = ["tab.rename", "terminal.right_click", "terminal.park", "orca-context-menu.copy-terminal", "orca-context-menu.copy-pane-id"];
const isTitleRow = (x) => x && (x[0] === "Set Title…" || TITLE_BLOCK_COMMANDS.includes(x[1]));

// Orca's pane menu separates the Copy/Paste block from the split section
// (TerminalContextMenu.tsx:263), and separates swap/move and zoom blocks.
function paneBreak(it, prev) {
  if (isSplitRow(it) && !isSplitRow(prev)) return true;
  if (it[1] === "pane.swap" && prev[1] !== "pane.swap") return true;
  if (it[1] === "pane.zoom" && prev[1] !== "pane.zoom") return true;
  // TerminalContextMenu.tsx:308 — separator before title/id block
  if (isTitleRow(it) && !isTitleRow(prev)) return true;
  // TerminalContextMenu.tsx:358 — separator before clear screen
  return it[1] === "orca-context-menu.clear-screen";
}

function tabBreak(it) {
  // SortableTabContextMenu.tsx:186 — separator before Pin/Unpin Tab
  // CloseSplitPaneMenuItem.tsx:20 — separator before Close split pane
  // SortableTabContextMenu.tsx:217 — separator before Change Title
  return ["tab.settle", "tab.unsettle", "orca-context-menu.close-split-panes"].includes(it[1]) || it[0] === "Change Title";
}

function spaceBreak(it, prev) {
  // WorktreeContextMenuView.tsx:177, 196, 218, 350
  if (it[1] === "worktree") return prev[1] !== "worktree";
  // Orca's Remove Project closes the menu with a destructive block of its own.
  return ["terminal.open", "orca-context-menu.toggle-unread", "orca-context-menu.forget-project"].includes(it[1]);
}

const groupBreak = (it) => ["orca-context-menu.copy-path", "space.rename", "orca-context-menu.forget-project"].includes(it[1]);

// The global list is Herdr's own; keep its rows apart as before.
const globalBreak = (it, prev) => it[1] === "app.help" || (it[1] === "app.theme" && prev[1] !== "app.theme");

const BREAK_BY_MENU = { pane: paneBreak, tab: tabBreak, space: spaceBreak, group: groupBreak, global: globalBreak };

function section(p, list, i) {
  const it = list[i], prev = list[i - 1];
  if (!prev) return false;
  // Close starts its own group in every menu (dropdown-menu.tsx:208): pane
  // (TerminalContextMenu.tsx:355), tab (SortableTabContextMenu.tsx:207), space (:196).
  if (it[1] === "orca-context-menu.delete-all-tabs") return true;
  if (it[1].endsWith(".close") || it[1] === "orca-context-menu.close-group") return prev[1] !== "orca-context-menu.delete-all-tabs";
  const menu = p?.tab || "global";
  return Object.hasOwn(BREAK_BY_MENU, menu) ? BREAK_BY_MENU[menu](it, prev) : false;
}

// Orca's destructive row is --destructive: #ff6568 dark, #e40014 light (main.css:474,437);
// Herdr has no such token.
function destructive() {
  return window.appearance() === "dark" ? "#ff6568" : "#e40014";
}

// Orca marks pane close, close split pane (CloseSplitPaneMenuItem.tsx:21-24), and workspace close rows destructive;
// the tab's Close is plain (TerminalContextMenu.tsx:351, WorktreeContextMenuView.tsx:353, SortableTabContextMenu.tsx:208, repo-header-project-actions.tsx:181).
const ALWAYS_DESTRUCTIVE = ["pane.close", "orca-context-menu.close-split-panes", "orca-context-menu.delete-all-tabs", "orca-context-menu.forget-project"];
function isDestructive(p, it) {
  if (ALWAYS_DESTRUCTIVE.includes(it[1])) return true;
  if (p?.tab === "pane") return it[1] === "tab.close";
  return (p?.tab === "space" || p?.tab === "group") && (it[1] === "space.close" || it[1] === "orca-context-menu.close-group");
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

// SortableTab.tsx:130-131 — a named tab shows its name, an unnamed one shows what runs in it.
function tabLabel(tab, pane) {
  return tab.named ? (tab.name ?? "Terminal") : (pane?.title || pane?.program?.name || tab.name || "Terminal");
}

// The pane a tab is known by: the one running an agent, else its first.
const leadPane = (tabId) => {
  const mine = panesOfTab(tabId);
  return mine.find((x) => x.program?.agent) ?? mine[0];
};

// The tab menu's own header: which tab these rows act on. A right-click can land on a background
// tab, while Orca's menu belongs to the tab it acts on (SortableTabContextMenu.tsx), so Herdr
// needs to say it. It is not a row - ↑/↓ skip it and Enter never runs it.
function contextHeader(p, t) {
  const tg = p?.target ?? {};
  const space = spaces().find((s) => s.id === tg.space) ?? owningSpace(tg.id);
  const tab = tabsOf(space).find((x) => x.id === tg.id);
  if (!tab) return div();
  const label = tabLabel(tab, leadPane(tab.id));
  const where = [space?.name, space?.branch].filter(Boolean).join(" · ");
  return v_flex().px(8).pt(6).pb(8).gap(3)
    .child(h_flex().items_center().gap(7)
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(label))
      // Pinned: Herdr's `settled`, the state the Pin/Unpin row below toggles.
      .when(Boolean(tab.settled), (el) => el.child(h_flex().flex_none().items_center().justify_center()
        .p(4).rounded(5).border_1().border_color(t.border)
        .child(svg("mods/orca-context-menu/pin.svg").size(10).text_color(t.muted)))))
    .when(Boolean(where), (el) => el.child(div().truncate().text_size(10).text_color(t.muted).child(where)));
}

// Orca's tab Close is plain there (SortableTabContextMenu.tsx:208) and Herdr closes several tabs
// from one menu, so these rows wear Orca's destructive colour only while they are the current row
// (hover, ↑/↓): the red is a warning about what Enter is about to do, not decoration.
const CLOSE_ROW_COMMANDS = ["tab.close", "orca-context-menu.close-others", "orca-context-menu.close-right", "orca-context-menu.close-left"];
function closeRow(p, it) {
  return p?.tab === "tab" && CLOSE_ROW_COMMANDS.includes(it[1]);
}

// Orca's Copy Tab ID and Close Others are `inset`: no icon, 32px left pad
// (CopyTabIdMenuItem.tsx:24, SortableTabContextMenu.tsx:208). Herdr's Close to the
// Right/Left sit in the same block.
const INSET_COMMANDS = ["orca-context-menu.copy-tab-id", "orca-context-menu.close-others", "orca-context-menu.close-right", "orca-context-menu.close-left"];

// What a row asks of the host. Each action gets the row's args and { p, cx, command }; choose()
// closes the overlay once it returns.
const ORCA_PREFIX = "orca-context-menu.";
const CONFIRM_DIALOG = { width: 384, height: 180 };
const PINNED_CLOSE_DIALOG = { width: 384, height: 200 };
const AGENT_CLOSE_DIALOG = { width: 384, height: 240 };
const COMMAND_CLOSE_DIALOG = { width: 384, height: 208 };
const WORKTREE_PICKER_DIALOG = { width: 560, height: 480 };
const WORKTREE_CONFIRM_DIALOG = { width: 440, height: 260 };
const HANDOFF_DIALOG = { width: 480, height: 380 };
const FORK_DIALOG = { width: 480, height: 320 };
// Lines of scrollback taken from a terminal: Copy Context cleans and bounds its text, the
// buffer copy takes everything Herdr will give.
const CONTEXT_LINES = 1000;
const BUFFER_LINES = 10000;

const openConfirmClose = (confirmClose, size = CONFIRM_DIALOG) =>
  openOverlay({ mod: "orca-header", kind: "dialog", modal: true, ...size, props: { confirmClose } });
// Focus the pane that was right-clicked, so a command meant for the focused pane lands there.
const focusPane = (args) => { if (args?.pane) run("pane.focus", { pane: args.pane }); };
const paneArg = (args) => (args?.pane ? { pane: args.pane } : {});

function targetSpace(p) {
  const target = p?.target ?? {};
  const space = spaces().find((s) => s.id === (target.id ?? ""));
  return { target, space, folder: space ? place(space) : "" };
}

function copyPath(args, { p, cx }) {
  const { target, space, folder } = targetSpace(p);
  copyText(args?.path || target.path || target.folder || target.top || folder || (space ? home() : ""), cx);
}

// Display name: explicit custom name (space.named), else branch name, else folder basename
// (Orca spec: worktree-default-display-name.ts:13-25 resolveWorktreeDisplayName).
const customName = ({ target, space }) => ((space?.named || target.named) ? (space?.name || target.name) : null);

function folderName(args, { target, space, folder }) {
  const folderPath = String(args?.folder ?? target.folder ?? target.path ?? folder ?? "");
  return folderPath.replace(/\/+$/, "").split("/").pop() || space?.name || "";
}

const displayName = (args, at) => customName(at) || args?.name || at.target.branch || folderName(args, at);

const copyName = (args, { p, cx }) => copyText(displayName(args, targetSpace(p)), cx);

// Remove Project from Sidebar: the catalog and the rows drawn from it belong to
// orca-sidebar-projects, so hand the repo over through the shared store and ping its loop
// (setShared alone does not wake another mod, AGENTS.md rule 10).
function forgetProject(args) {
  if (!args?.repo) return;
  setShared("orca-sidebar-projects.forget", { repo: args.repo, at: Date.now() });
  run("orca-sidebar-projects.forget-project");
}

// WorktreeContextMenuView.tsx:203-214 — toggle read / unread
function toggleUnread(args) {
  try {
    const list = stored("spaces.unread.v1", []);
    const set = new Set(Array.isArray(list) ? list : []);
    if (!set.delete(args.id)) set.add(args.id);
    const updated = [...set];
    localStorage.setItem("spaces.unread.v1", JSON.stringify(updated));
    setShared("spaces.unread.v1", updated);
  } catch { /* storage is unavailable: the unread mark stays as it was */ }
}

// Close Others — SortableTabContextMenu.tsx:213 & useBulkTabCloseConfirmation (bulk-tab-close-confirmation.ts:5-15)
function closeOthers(args) {
  const tabIds = tabsOf(owningSpace(args.id)).filter((x) => x.id !== args.id && !x.settled).map((x) => x.id);
  if (tabIds.length > 0) openConfirmClose({ kind: "bulk", scope: "others", tabIds });
}

// Herdr's own rows (Orca has none). The same confirmation as Close Others, and the ids are
// read again here rather than taken from the row, so a tab closed or pinned while the menu
// was open is honored.
const closeSide = (side) => (args) => {
  const tabIds = closeSideTabs(owningSpace(args.id), args.id, side);
  if (tabIds.length > 0) openConfirmClose({ kind: "bulk", scope: side, tabIds });
};

// Same confirmation as Close Others; pinned tabs were left out of `tabIds` already.
function deleteAllTabs(args) {
  // Spaces may have changed since the menu opened: ask again, not the list it carried.
  const ids = unpinnedTabs(args.ids ?? [args.id]);
  if (ids.length === 0) return;
  // A project group spans several checkouts; say so in the dialog. One checkout needs no
  // extra line, since the worktree-level dialog says the same thing.
  const wanted = new Set(ids);
  const owners = new Set(spaces().filter((s) => tabsOf(s).some((t) => wanted.has(t.id))).map((s) => `${s.machine ?? ""}\u0000${place(s)}`));
  const detail = owners.size > 1 ? `${ids.length} tabs in ${owners.size} worktrees` : undefined;
  openConfirmClose({ kind: "bulk", scope: "all", tabIds: ids, ...(detail ? { detail } : {}) });
}

function closeSplitPanes(args) {
  const mine = panesOfTab(args.id);
  const keep = mine.find((x) => x.focused) ?? mine[0];
  for (const x of mine) if (x !== keep) run("pane.close", { pane: x.pane });
}

// Split on one side, then swap the original pane with its newly created neighbor.
const splitThenSwap = (direction) => (args) => {
  const pane = args?.pane ?? panes().find((p) => p.focused)?.pane;
  if (!pane) return;
  focusPane({ pane });
  run("pane.split", { direction, pane });
  run("pane.swap", { direction, pane });
};

// Copy Context (terminal-pane-menu-agent-session-actions.ts:58-65 & terminal-agent-session-fork.ts:139):
// Extracts up to 1000 lines scrollback, cleans and bounds transcript to clipboard.
function copyContext(args, { cx }) {
  if (!args.terminal) return;
  focusPane(args);
  hc(["read", "--lines", String(CONTEXT_LINES), args.terminal]).then((r) => {
    if (!r?.stdout) return;
    const clean = buildBoundedSessionTranscript(r.stdout);
    if (clean) copyText(clean, cx);
  }).catch(() => { /* an unreadable terminal copies nothing */ });
}

// Select All: Herdr cannot select, so the screen and scrollback buffer go to the clipboard (TerminalContextMenu.tsx:217).
function selectAll(args, { cx }) {
  if (!args.terminal) return;
  focusPane(args);
  hc(["read", "--lines", String(BUFFER_LINES), args.terminal]).then((r) => {
    if (r?.code === 0 && r.stdout.trim()) copyText(r.stdout, cx);
  }).catch(() => { /* an unreadable terminal copies nothing */ });
}

// Clear Screen / Reset Terminal: `hc` writes to the terminal; Ctrl+L clears the screen,
// `reset` restores the terminal modes (TerminalContextMenu.tsx:359-369).
const writeToTerminal = (hcArgs) => (args) => {
  if (!args.terminal) return;
  focusPane(args);
  void hc(hcArgs(args.terminal));
};

// A dialog that acts on a terminal: the handoff and fork rows of the pane menu.
const terminalDialog = (size, action) => (args) => {
  focusPane(args);
  openOverlay({ mod: "orca-handoff", kind: "dialog", ...size, props: { action, terminal: args.terminal, pane: args.pane } });
};

const copyId = (args, { cx }) => copyText(args.id ?? "", cx);

const ORCA_ACTIONS = new Map([
  // CopyTabIdMenuItem.tsx:16 — writeClipboardText(`orcaTabId: ${unifiedTabId}`)
  ["orca-context-menu.copy-tab-id", (args, { cx }) => copyText(`orcaTabId: ${args.id ?? ""}`, cx)],
  ["orca-context-menu.copy-path", copyPath],
  ["orca-context-menu.copy-name", copyName],
  ["orca-context-menu.close-group", (args) => { for (const id of (args?.ids ?? [])) run("space.close", { id, confirmed: true }); }],
  ["orca-context-menu.forget-project", forgetProject],
  ["orca-context-menu.toggle-unread", toggleUnread],
  ["orca-context-menu.close-others", closeOthers],
  ["orca-context-menu.close-right", closeSide("right")],
  ["orca-context-menu.close-left", closeSide("left")],
  ["orca-context-menu.delete-all-tabs", deleteAllTabs],
  ["orca-context-menu.move-tab-split", (args) => setShared("orca-header.action", { kind: "move-tab-split", tab: args.id, direction: args.direction })],
  ["orca-context-menu.unsplit-to-tab", (args) => setShared("orca-header.action", { kind: "unsplit-to-tab", terminal: args.terminal, pane: args.pane })],
  ["orca-context-menu.close-split-panes", closeSplitPanes],
  ["orca-context-menu.split-left", splitThenSwap("right")],
  ["orca-context-menu.split-up", splitThenSwap("down")],
  ["orca-context-menu.copy-terminal", copyId],
  ["orca-context-menu.copy-pane-id", copyId],
  ["orca-context-menu.copy-context", copyContext],
  // Hand Off to Another Agent (AgentSessionContinuationDialog.tsx:59)
  ["orca-context-menu.handoff", terminalDialog(HANDOFF_DIALOG, "handoff")],
  // Fork Agent Session (TerminalAgentSessionForkDialog.tsx:25)
  ["orca-context-menu.fork", terminalDialog(FORK_DIALOG, "fork")],
  ["orca-context-menu.select-all", selectAll],
  ["orca-context-menu.clear-screen", writeToTerminal((terminal) => ["keys", terminal, "ctrl+l"])],
  ["orca-context-menu.reset-terminal", writeToTerminal((terminal) => ["send", terminal, "reset"])],
]);

// `terminal.copy`/`terminal.paste` act on the focused terminal (commands.md:285-287), so
// focus the pane that was right-clicked before the overlay gives focus back.
function copyOrPaste(args, { p, command }) {
  const tg = p?.target ?? {};
  if (tg.pane || tg.terminal) run("pane.focus", tg.pane ? { pane: tg.pane } : { terminal: tg.terminal });
  run(command, args);
}

// TerminalTabSplitMenuSection.tsx:37-39: activate inactive tab before splitting
function splitPane(args, { p }) {
  if (p?.tab === "tab" && p?.target?.id) run("tab.select", { id: p.target.id });
  focusPane(args);
  run("pane.split", args);
}

function openTerminalInSpace(args, { p, command }) {
  if (p?.tab !== "space") return run(command, args);
  const tg = p?.target ?? {};
  if (spaces().some((s) => s.id === tg.id)) {
    // Activate target space, then open the terminal tab in it (WorktreeRowOpenInSubMenu.tsx:11-28)
    run("space.select", { id: tg.id });
    run("terminal.open", args);
  } else {
    // Unopened worktree card: create a space for it and switch to terminals layout
    // (matching orca-sidebar-projects/main.js:1062 & 1153)
    const folder = args?.folder || tg.folder || tg.top || tg.path;
    run("space.new", worktreeArgs(null, folder, tg.machine));
  }
  run("layout.select", { ...LAYOUT_CHILD });
}

const openWorktreeDialog = (args) => {
  const picker = args.action === "open" || args.action === "switch";
  openOverlay({ mod: "orca-worktree", kind: "dialog", ...(picker ? WORKTREE_PICKER_DIALOG : WORKTREE_CONFIRM_DIALOG), props: args });
};

// Close tab confirmation — terminal-tab-actions.ts:121-131 & running-terminal-close-guard.ts:56-97
function closeTab(args) {
  const tab = tabsOf(owningSpace(args.id)).find((x) => x.id === args.id);
  if (tab && !confirmCloseTab(tab)) return;
  run("tab.close", args);
}

// Ask first when closing would lose something; true when the tab can close without asking.
function confirmCloseTab(tab) {
  const tabPanes = panesOfTab(tab.id);
  const pane = tabPanes.find((x) => x.program?.agent) ?? tabPanes[0];
  const label = tabLabel(tab, pane);
  if (tab.settled && !storageFlag("orca.confirmClosePinnedTab", "false")) {
    openConfirmClose({ kind: "pinned", tabId: tab.id, tabLabel: label }, PINNED_CLOSE_DIALOG);
    return false;
  }
  const isAgent = tabPanes.some((x) => x.program?.agent || x.status === "working" || x.status === "blocked") ||
    tab.status === "working" || tab.status === "blocked";
  const isRunningCommand = tabPanes.some((x) => x.program && !x.program.shell && !x.program.agent);
  if (storageFlag("orca.skipCloseTerminalWithRunningProcessConfirm", "true") || !(isAgent || isRunningCommand)) return true;
  openConfirmClose({ kind: isAgent ? "agent" : "command", tabId: tab.id, tabLabel: label }, isAgent ? AGENT_CLOSE_DIALOG : COMMAND_CLOSE_DIALOG);
  return false;
}

// Whether a stored setting has this value; an unreadable store counts as not set.
function storageFlag(key, value) {
  try { return localStorage.getItem(key) === value; } catch { return false; }
}

const HOST_ACTIONS = new Map([
  ["terminal.copy", copyOrPaste],
  ["terminal.paste", copyOrPaste],
  ["pane.swap", (args) => { focusPane(args); run("pane.swap", { direction: args.direction, ...paneArg(args) }); }],
  ["pane.zoom", (args) => { focusPane(args); run("pane.zoom", args); }],
  ["pane.split", splitPane],
  ["terminal.open", openTerminalInSpace],
  ["worktree", openWorktreeDialog],
  ["tab.close", closeTab],
]);

// A red row, else muted when greyed out, else plain.
function rowColor(accent, off, { t, bad }) {
  if (accent) return bad;
  return off ? t.muted : t.foreground;
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
      cx.spawn(async (taskCx) => {
        this.git = await checkout(folder, tg.machine ?? space?.machine ?? null).catch(() => null);
        taskCx.notify();
      });
  }

  choose(i, cx) {
    const p = props();
    const it = items(p, this.git)[i];
    if (!it || it[2]?.disabled) return;
    const [, command, args] = it;
    const isOrca = command.startsWith(ORCA_PREFIX);
    const action = (isOrca ? ORCA_ACTIONS : HOST_ACTIONS).get(command);
    if (action) action(args, { p, cx, command });
    else if (!isOrca) run(command, args);
    closeOverlay(p?.overlay);
  }

  onKey(e, cx, count) {
    if (e.key === "down") this.at = (this.at + 1) % count;
    else if (e.key === "up") this.at = (this.at + count - 1) % count;
    else if (e.key === "home") this.at = 0;
    else if (e.key === "end") this.at = count - 1;
    // Radix activates with Enter or Space (context-menu.tsx:31-62). Type-ahead and
    // ChevronRight submenus have no flat-list equivalent here.
    else if (e.key === "enter" || e.key === "space") this.choose(this.at, cx);
    else if (e.key === "escape") closeOverlay(props()?.overlay);
    else return;
    cx.notify();
  }

  // One row. A close row turns red only as the current row (see closeRow).
  row(p, list, i, look) {
    const { t, zoomed, bad } = look;
    const it = list[i];
    const off = Boolean(it[2]?.disabled);
    const red = !off && isDestructive(p, it);
    const current = i === this.at && !off;
    const warn = closeRow(p, it) && current;
    const inset = INSET_COMMANDS.includes(it[1]);
    const accent = red || warn;
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
      .text_color(rowColor(accent, off, look))
      // One current row: pointer hover moves `this.at`, so hover, keyboard and Enter
      // agree (dropdown-menu.tsx:115 data-[current=true]).
      .when(current, (el) => el.bg(accent ? `${bad}1a` : t.selected))
      .on_hover((hovered, cx) => { if (hovered && !off && this.at !== i) { this.at = i; cx.notify(); } })
      .on_click((_e, cx) => this.choose(i, cx))
      .when(!inset, (el) => el.child(svg(menuIcon(it, zoomed)).size(14).flex_none()
        .text_color(accent ? bad : t.muted)))
      .child(div().flex_1().min_w(0).truncate().child(it[0]))
      // Shortcut: ml-auto shrink-0 whitespace-nowrap pl-4 text-muted-foreground
      // (dropdown-menu.tsx:219). The tab menu writes the chord as a person reads it
      // (⌘W, ⇧⌘D, f2); the other menus keep Herdr's own spelling.
      .child(div().pl(16).flex_none().whitespace_nowrap().text_color(t.muted)
        .child(p?.tab === "tab" ? keyHint(shortcut(it[1], it[2])) : shortcut(it[1], it[2]))));
  }

  render() {
    const t = theme();
    const p = props();
    const list = items(p, this.git);
    const look = { t, bad: destructive(), zoomed: panes().find((x) => x.pane === p?.target?.pane)?.zoomed };
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
      .on_key_down((e, cx) => this.onKey(e, cx, list.length))
      .children([
        // Orca labels the card section only for a multi-selection; a single highlighted
        // card already names the worktree (WorktreeContextMenuView.tsx:147-152). Herdr has
        // no multi-select yet, so this stays off unless a caller asks for it.
        ...(p?.tab === "space" && p?.multi
          ? [div().px(10).pt(5).pb(3).text_size(11).font_semibold().text_color(t.muted).child("Workspace")]
          : []),
        ...(p?.tab === "tab" ? [contextHeader(p, t)] : []),
        ...list.map((_it, i) => this.row(p, list, i, look)),
      ]);
  }
}
