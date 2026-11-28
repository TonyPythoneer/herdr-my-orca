export const COMMAND = {
  appHelp: "app.help",
  appPalette: "app.palette",
  appTheme: "app.theme",
  clearScreen: "orca-context-menu.clear-screen",
  closeGroup: "orca-context-menu.close-group",
  closeLeft: "orca-context-menu.close-left",
  closeOthers: "orca-context-menu.close-others",
  closeRight: "orca-context-menu.close-right",
  closeSplitPanes: "orca-context-menu.close-split-panes",
  copyContext: "orca-context-menu.copy-context",
  copyName: "orca-context-menu.copy-name",
  copyPaneId: "orca-context-menu.copy-pane-id",
  copyPath: "orca-context-menu.copy-path",
  copyTabId: "orca-context-menu.copy-tab-id",
  copyTerminal: "orca-context-menu.copy-terminal",
  deleteAllTabs: "orca-context-menu.delete-all-tabs",
  forgetProject: "orca-context-menu.forget-project",
  fork: "orca-context-menu.fork",
  handoff: "orca-context-menu.handoff",
  layoutSelect: "layout.select",
  modOpen: "mod.open",
  moveTabSplit: "orca-context-menu.move-tab-split",
  paneClose: "pane.close",
  paneFocus: "pane.focus",
  paneSplit: "pane.split",
  paneSwap: "pane.swap",
  paneZoom: "pane.zoom",
  projectsForgetProject: "orca-sidebar-projects.forget-project",
  resetTerminal: "orca-context-menu.reset-terminal",
  selectAll: "orca-context-menu.select-all",
  spaceClose: "space.close",
  spaceNew: "space.new",
  spaceRename: "space.rename",
  spaceSelect: "space.select",
  splitLeft: "orca-context-menu.split-left",
  splitUp: "orca-context-menu.split-up",
  tabClose: "tab.close",
  tabMove: "tab.move",
  tabRename: "tab.rename",
  tabSelect: "tab.select",
  tabSettle: "tab.settle",
  tabUnsettle: "tab.unsettle",
  terminalCopy: "terminal.copy",
  terminalOpen: "terminal.open",
  terminalPark: "terminal.park",
  terminalPaste: "terminal.paste",
  terminalRightClick: "terminal.right_click",
  toggleUnread: "orca-context-menu.toggle-unread",
  unsplitToTab: "orca-context-menu.unsplit-to-tab",
  worktree: "worktree",
} as const;

export const KEY = {
  confirmClosePinnedTab: "orca.confirmClosePinnedTab",
  headerAction: "orca-header.action",
  projectsForget: "orca-sidebar-projects.forget",
  rightClickLabel: "herdr.right-click",
  skipCloseRunningProcess: "orca.skipCloseTerminalWithRunningProcessConfirm",
  unreadStorage: "spaces.unread.v1",
} as const;

export const MENU = {
  pane: "pane",
  tab: "tab",
  group: "group",
  space: "space",
  global: "global",
} as const;

export const STATUS = {
  working: "working",
  blocked: "blocked",
} as const;

export const LABEL = {
  changeTitle: "Change Title",
  clearPaneTitle: "Clear Pane Title",
  markRead: "Mark Read",
  moveLeft: "Move Left",
  setTitle: "Set Title…",
} as const;

export const CONFIRM_KIND = {
  agent: "agent",
  bulk: "bulk",
  command: "command",
  pinned: "pinned",
} as const;

export const OVERLAY_KIND = {
  dialog: "dialog",
} as const;
