// Orca UI entry point. Start reading here.
//
// This is the reading map for the Orca interface: each entry names the screen area a feature draws
// and points at the next files to follow. The feature's `manifest.json` says which source files it
// owns, the mod they build into, the layout slots that mount it, the keys it uses and its tests.
// Herdr loads the built copies under `mods/`; those are delivery format, not edit locations.
//
// Only panel-head is a generated feature. Every other mod is edited in place under `mods/<mod>/`
// and listed in `inPlace` below, with its layout mounts, keys, hand-offs and tests. Helpers several
// mods import live in `orca-ui/shared/`; the builder copies each one into every mod that lists it.
//
// Herdr errors name the built copy (`mods/<mod>/<file>?v=1:<line>:<col>`). Do not open it: pipe
// the error to `node scripts/where-error.mjs`, which prints the file and line to edit and the
// entry below that owns it.
import panelHead from "./features/panel/head/manifest.json" with { type: "json" };
import shared from "./shared/manifest.json" with { type: "json" };

export const features = [
  {
    manifest: panelHead,
    area: "panel",
    // Right panel header: title strip, close button, and the view switcher that reveals
    // files, changes, ports, or the harness panels.
    description: "Right panel header and view switcher.",
    // A reveal ends in another mod: search selects `files`, then dispatches orca-files.search.
    next: ["mods/orca-files/main.js"],
  },
  {
    manifest: shared,
    area: "shared",
    description: "Shared helpers copied into each mod that imports them; edit orca-ui/shared/<name>, never the copies.",
    next: [],
  },
];

// Mods no manifest owns: edited in place under `mods/<mod>/`. Each entry is the reading map for one
// mod: the layout nodes that mount it, the keys and commands that reach it, what it opens or shares
// with other mods (the receivers are not discoverable from the layout), its tests and what to read
// next. `opens`, `reachedBy` and `shared` are a reading aid, not exhaustive; layouts, keys, tests and
// `next` are checked against the repo by scripts/orca-ui-manifests.test.js.
export const inPlace = [
  {
    "mod": "agent-config",
    "area": "overlay-or-menu",
    "description": "Agent setup flyout with model, effort and option pickers beside a chosen agent row.",
    "opens": [
      "tab.new(mod:orca-files)",
      "tab.new",
      "layout.select"
    ],
    "reachedBy": [
      "overlay:flyout opened from an orca-new-menu row chevron, props {menu,space,name,key,argv}"
    ],
    "shared": [
      "agent-config"
    ],
    "tests": [
      "mods/agent-config/agent-flyout.test.js",
      "mods/agent-config/argv.golden.test.js",
      "mods/agent-config/codex-provider.test.js",
      "mods/agent-config/launch.test.js",
      "mods/agent-config/lists.test.js",
      "mods/agent-config/render.golden.test.js"
    ],
    "next": [
      "mods/orca-files/main.js"
    ]
  },
  {
    "mod": "orca-agent-manager",
    "area": "center",
    "description": "Settings-style page for the agent catalog: installs, commands, permissions, model providers.",
    "layouts": [
      "orca#main-agents",
      "orca#main-providers",
      "orca-unified#main-agents",
      "orca-unified#main-providers"
    ],
    "props": "main-providers: props.page=providers; props.expand deep link via tab.new",
    "opens": [
      "layout.select"
    ],
    "reachedBy": [
      "tab: deep link tab.new {mod:orca-agent-manager, props:{expand}}"
    ],
    "shared": [
      "agent-manager.inventory"
    ],
    "tests": [
      "mods/orca-agent-manager/install.test.js",
      "mods/orca-agent-manager/manager-flow.test.js",
      "mods/orca-agent-manager/manager-logic.test.js",
      "mods/orca-agent-manager/manager-page.test.js",
      "mods/orca-agent-manager/permission-menu.test.js",
      "mods/orca-agent-manager/permissions.flow.test.js",
      "mods/orca-agent-manager/permissions.test.js",
      "mods/orca-agent-manager/provider.flow.test.js",
      "mods/orca-agent-manager/render.test.js",
      "mods/orca-agent-manager/state.test.js",
      "mods/orca-agent-manager/util.test.js"
    ]
  },
  {
    "mod": "orca-agents",
    "area": "panel-right",
    "description": "Agents panel: live agents above on-disk session history, with search and resume.",
    "layouts": [
      "orca#vault",
      "orca-unified#vault"
    ],
    "props": "unified:true (unified layout only)",
    "opens": [
      "terminal.open",
      "agent.focus"
    ]
  },
  {
    "mod": "orca-changes",
    "area": "panel-right",
    "description": "Source Control panel: changed files, stage, discard, commit, push and create PR.",
    "layouts": [
      "orca#changes",
      "orca-unified#changes"
    ],
    "props": "unified:true (unified layout only)",
    "opens": [
      "orca-diff.show",
      "pane.split(mod:orca-diff)",
      "tab.new(mod:orca-files)",
      "orca-changes.refresh",
      "overlay:orca-changes"
    ],
    "reachedBy": [
      "command:refresh",
      "pane/tab opened by orca-split-menu (mod:orca-changes)"
    ],
    "shared": [
      "orca-diff.target"
    ],
    "tests": [
      "mods/orca-changes/commit-push.test.js",
      "mods/orca-changes/conflict-safety.test.js",
      "mods/orca-changes/create-pr.test.js",
      "mods/orca-changes/discard-snapshot.test.js",
      "mods/orca-changes/operation-target.test.js",
      "mods/orca-changes/push-target.test.js",
      "mods/orca-changes/section-view.test.js"
    ],
    "next": [
      "mods/orca-diff/main.js",
      "mods/orca-files/main.js"
    ]
  },
  {
    "mod": "orca-chrome",
    "area": "sidebar-left",
    "description": "Sidebar top bar with collapse toggle; footer with Agents, Tasks, Settings and Help rows.",
    "layouts": [
      "orca#brand",
      "orca#sidebar-footer",
      "orca-unified#sidebar-footer"
    ],
    "props": "footer:true (both); unified:true on the unified footer; brand node is orca-only",
    "opens": [
      "layout.select",
      "app.settings",
      "app.palette",
      "mod.open:picker"
    ],
    "shared": [
      "sidebar.collapsed",
      "sidebar.openPx",
      "tasks.config",
      "tasks.text",
      "tasks.state",
      "tasks.resets"
    ],
    "next": [
      "mods/orca-chrome/runner.js",
      "mods/orca-tasks/main.js"
    ]
  },
  {
    "mod": "orca-confirm",
    "area": "overlay-or-menu",
    "description": "Confirm dialog for destructive actions; Enter runs the command, Esc cancels.",
    "opens": [
      "props.command.name (dynamic run)"
    ],
    "reachedBy": [
      "overlay:dialog opened by orca-files with props {title,detail,command}"
    ],
    "shared": [
      "props.confirmShared.key (dynamic set)"
    ]
  },
  {
    "mod": "orca-diff",
    "area": "center",
    "description": "Diff pane beside the terminals showing one file's change or all changes.",
    "opens": [
      "pane.close"
    ],
    "reachedBy": [
      "command:show",
      "pane:pane.split(mod:orca-diff) from orca-changes"
    ],
    "shared": [
      "orca-diff.target"
    ],
    "tests": [
      "mods/orca-diff/diff-data.test.js",
      "mods/orca-diff/diff-load.test.js",
      "mods/orca-diff/diff.test.js"
    ]
  },
  {
    "mod": "orca-files",
    "area": "panel-right",
    "description": "File explorer for the space folder: tree, previews, editing and a context menu.",
    "layouts": [
      "orca#files",
      "orca-unified#files"
    ],
    "props": "unified:true (unified layout only)",
    "opens": [
      "orca-files.refresh",
      "orca-files.view",
      "orca-files.filters",
      "terminal.open",
      "overlay:orca-confirm",
      "overlay:orca-files (popup)"
    ],
    "reachedBy": [
      "command:search",
      "command:refresh",
      "command:remove-<name>",
      "tab/pane mod:orca-files from orca-new-menu, orca-split-menu, orca-changes",
      "orca-panel-head reveals (search)"
    ],
    "shared": [
      "orca-files.filters",
      "orca-files.viewFile",
      "orca-files.openIn",
      "orca-files.target.<token>"
    ],
    "tests": [
      "mods/orca-files/delete-target.test.js",
      "mods/orca-files/editor-drafts.test.js",
      "mods/orca-files/editor-path.test.js",
      "mods/orca-files/file-mutation.test.js",
      "mods/orca-files/save-queue.test.js",
      "mods/orca-files/tree-keys.test.js",
      "mods/orca-files/tree-nav.test.js"
    ],
    "next": [
      "mods/orca-confirm/main.js"
    ]
  },
  {
    "mod": "orca-float",
    "area": "overlay-or-menu",
    "description": "Floating bottom-right workspace panel toggled by Ctrl+Alt+A; opens new tabs.",
    "layouts": [
      "orca#float-workspace",
      "orca-unified#float-workspace"
    ],
    "props": "floating: edge bottom, align end",
    "keys": [
      "layout:orca:ctrl-alt-a"
    ],
    "opens": [
      "overlay:orca-new-menu",
      "tab.new",
      "agent.focus"
    ],
    "reachedBy": [
      "command:toggle (orca-float.toggle)"
    ],
    "shared": [
      "orca-float.open",
      "orca-float.attention"
    ],
    "next": [
      "mods/orca-new-menu/main.js"
    ]
  },
  {
    "mod": "orca-handoff",
    "area": "overlay-or-menu",
    "description": "Dialog to hand off or fork the agent session into a new tab.",
    "opens": [
      "tab.new"
    ],
    "reachedBy": [
      "overlay:dialog opened by orca-menu (handoff and fork items)"
    ]
  },
  {
    "mod": "orca-landing",
    "area": "center",
    "description": "Welcome page shown with no workspace open; tiles start a new space or tab.",
    "layouts": [
      "orca#main-landing",
      "orca-unified#main-landing"
    ],
    "opens": [
      "space.new",
      "overlay:orca-new-menu"
    ],
    "next": [
      "mods/orca-new-menu/main.js"
    ]
  },
  {
    "mod": "orca-menu",
    "area": "overlay-or-menu",
    "description": "Right-click context menu for panes, tabs, spaces and groups: split, close, copy, move.",
    "props": "root.terminal_menu='orca-menu' in both layouts (not a node)",
    "opens": [
      "overlay:orca-tabs",
      "overlay:orca-handoff",
      "overlay:orca-worktree",
      "pane.split",
      "tab.close",
      "space.close"
    ],
    "reachedBy": [
      "overlay:popup props.tab pane|tab|space|group",
      "terminal_menu (root, both layouts)"
    ],
    "shared": [
      "orca-spaces.forget",
      "spaces.unread.v1",
      "orca-tabs.action"
    ],
    "tests": [
      "mods/orca-menu/close-row.test.js",
      "mods/orca-menu/close-sides.test.js",
      "mods/orca-menu/close-space.test.js"
    ],
    "next": [
      "mods/orca-tabs/main.js",
      "mods/orca-handoff/main.js",
      "mods/orca-worktree/main.js"
    ]
  },
  {
    "mod": "orca-nav",
    "area": "sidebar-left",
    "description": "Sidebar top: search field, page rows (Tasks etc.), and the Projects header.",
    "layouts": [
      "orca#nav-top",
      "orca-unified#nav-top"
    ],
    "props": "unified:true (unified layout only)",
    "opens": [
      "mod.open:picker",
      "layout.select",
      "orca-spaces.expand-all",
      "orca-spaces.collapse-all",
      "space.new",
      "overlay:orca-new-menu"
    ],
    "reachedBy": [
      "overlay:popup props.navMenu=workspace-options"
    ],
    "shared": [
      "sidebar.openPx",
      "projects.allCollapsed",
      "projects.count"
    ],
    "tests": [
      "mods/orca-nav/refresh.test.js"
    ],
    "next": [
      "mods/orca-new-menu/main.js"
    ]
  },
  {
    "mod": "orca-new-menu",
    "area": "overlay-or-menu",
    "description": "The + dropdown: omnibox, new terminal, worktree rows and agent launch entries.",
    "opens": [
      "tab.new",
      "tab.new(mod:orca-files)",
      "pane.split",
      "terminal.open",
      "overlay:orca-worktree",
      "overlay:agent-config"
    ],
    "reachedBy": [
      "overlay:popup 288x512 from the + buttons in orca-tabs, orca-landing, orca-nav, orca-float"
    ],
    "shared": [
      "agent-manager.inventory",
      "agent-config"
    ],
    "tests": [
      "mods/orca-new-menu/inventory.test.js",
      "mods/orca-new-menu/rows.test.js"
    ],
    "next": [
      "mods/orca-worktree/main.js",
      "mods/agent-config/main.js"
    ]
  },
  {
    "mod": "orca-pane",
    "area": "header",
    "description": "Pane title bar: on hover, split and close buttons; click focuses the pane.",
    "layouts": [
      "orca#main-terminals",
      "orca-unified#main-terminals"
    ],
    "props": "pane.header on main-terminals (height 32, top); props {pane, terminal}",
    "opens": [
      "pane.focus",
      "pane.split",
      "agent.focus",
      "overlay:orca-menu",
      "overlay:orca-pane"
    ],
    "reachedBy": [
      "overlay:popup props.pane (orca-pane self)"
    ],
    "shared": [
      "orca-tabs.pane-drag",
      "orca-tabs.action"
    ],
    "tests": [
      "mods/orca-pane/crew.test.js"
    ],
    "next": [
      "mods/orca-menu/main.js"
    ]
  },
  {
    "mod": "orca-panel-gap",
    "area": "panel-right",
    "description": "Placeholder for panel tabs Herdr lacks: Workspaces, PR Checks, Checks and Ports.",
    "layouts": [
      "orca#workspaces",
      "orca#pr-checks",
      "orca#checks",
      "orca#ports",
      "orca-unified#workspaces",
      "orca-unified#pr-checks",
      "orca-unified#checks",
      "orca-unified#ports"
    ],
    "props": "tab: workspaces|pr-checks|checks|ports; unified:true (unified only)",
    "tests": [
      "mods/orca-panel-gap/panel-motion.test.js"
    ]
  },
  {
    "mod": "orca-spaces",
    "area": "sidebar-left",
    "description": "Project tree of workspaces by repo and machine; click switches, drag reorders.",
    "layouts": [
      "orca#spaces",
      "orca-unified#spaces"
    ],
    "props": "unified:true (unified only)",
    "opens": [
      "space.new",
      "layout.select",
      "overlay:orca-menu"
    ],
    "reachedBy": [
      "command:focus",
      "command:collapse-all",
      "command:expand-all"
    ],
    "shared": [
      "t3-focus",
      "space.colors",
      "projects.allCollapsed",
      "projects.count",
      "orca-spaces.forget",
      "pr.cache.v2"
    ],
    "tests": [
      "mods/orca-spaces/card-agents.test.js",
      "mods/orca-spaces/git-refresh.test.js",
      "mods/orca-spaces/render.test.js",
      "mods/orca-spaces/retained-row.test.js",
      "mods/orca-spaces/review-store.test.js",
      "mods/orca-spaces/storage.test.js",
      "mods/orca-spaces/worktree-plan.test.js"
    ],
    "next": [
      "mods/orca-menu/main.js"
    ]
  },
  {
    "mod": "orca-split-menu",
    "area": "overlay-or-menu",
    "description": "Split Terminal popup: directional splits, zoom and close for terminal or pane.",
    "keys": [
      "layout:orca:ctrl-shift-s"
    ],
    "opens": [
      "pane.split",
      "pane.swap",
      "pane.zoom",
      "pane.close",
      "pane.split(mod:orca-files)",
      "pane.split(mod:orca-changes)"
    ],
    "reachedBy": [
      "mod.open:orca-split-menu (keys.json)"
    ],
    "next": [
      "mods/orca-files/main.js",
      "mods/orca-changes/main.js"
    ]
  },
  {
    "mod": "orca-status",
    "area": "status",
    "description": "Bottom status bar: provider usage, maintenance segments, float toggle, updates.",
    "layouts": [
      "orca#status",
      "orca-unified#status"
    ],
    "opens": [
      "orca-float.toggle",
      "space.new",
      "tab.new",
      "space.select",
      "terminal.park",
      "app.settings"
    ],
    "reachedBy": [
      "command:refresh"
    ],
    "shared": [
      "wt-follow.moved",
      "orca-float.open",
      "orca-float.attention"
    ],
    "tests": [
      "mods/orca-status/claude-statusline.test.js",
      "mods/orca-status/local-usage.test.js",
      "mods/orca-status/usage.test.js",
      "mods/orca-status/wt-follow.test.js"
    ],
    "next": [
      "mods/orca-float/main.js"
    ]
  },
  {
    "mod": "orca-tabs",
    "area": "header",
    "description": "Tab strip with sidebar and panel toggles, drag-to-split, new tab and window controls.",
    "layouts": [
      "orca#tabs",
      "orca-unified#tabs"
    ],
    "props": "unified:true, motion:'native', pinSidebarTerminal:true (unified only)",
    "keys": [
      "global:cmd-t",
      "global:cmd-b",
      "layout:orca:cmd-l",
      "layout:orca:ctrl-shift-b",
      "layout:orca:ctrl-shift-e"
    ],
    "opens": [
      "overlay:orca-menu",
      "overlay:orca-new-menu",
      "tab.new",
      "terminal.park",
      "terminal.keep",
      "layout.toggle"
    ],
    "reachedBy": [
      "command:new-tab",
      "command:toggle-sidebar",
      "command:toggle-panel"
    ],
    "shared": [
      "orca-tabs.drop",
      "orca-tabs.action",
      "orca-tabs.pane-drag",
      "sidebar.collapsed",
      "sidebar.openPx",
      "panel.openPx"
    ],
    "tests": [
      "mods/orca-tabs/close-plan.test.js",
      "mods/orca-tabs/drop-zone.test.js",
      "mods/orca-tabs/new-tab.test.js",
      "mods/orca-tabs/sidebar-motion.test.js",
      "mods/orca-tabs/sidebar-native.test.js",
      "mods/orca-tabs/tab-panes.test.js",
      "mods/orca-tabs/tab-strip-scroll.test.js",
      "mods/orca-tabs/tab-title.test.js",
      "mods/orca-tabs/unofficial-apps.test.js"
    ],
    "next": [
      "mods/orca-menu/main.js",
      "mods/orca-new-menu/main.js"
    ]
  },
  {
    "mod": "orca-tasks",
    "area": "center",
    "description": "Task page: scheduled tasks with toggles, New task, delete and a JSON view.",
    "layouts": [
      "orca#main-tasks",
      "orca-unified#main-tasks"
    ],
    "opens": [
      "orca-chrome.tasks-scan",
      "layout.select"
    ],
    "shared": [
      "tasks.config",
      "tasks.resets",
      "tasks.state",
      "tasks.text",
      "tasks.error",
      "tasks.request"
    ],
    "tests": [
      "mods/orca-tasks/tasks.test.js"
    ],
    "next": [
      "mods/orca-chrome/runner.js"
    ]
  },
  {
    "mod": "orca-worktree",
    "area": "overlay-or-menu",
    "description": "Worktree dialog: create, open or remove a git worktree for a folder or space.",
    "opens": [
      "space.new",
      "space.select"
    ],
    "reachedBy": [
      "overlay:dialog with props.action new|open|remove (from orca-new-menu, orca-menu)"
    ],
    "tests": [
      "mods/orca-worktree/create.test.js",
      "mods/orca-worktree/helpers.test.js",
      "mods/orca-worktree/remove.test.js",
      "mods/orca-worktree/switch.test.js"
    ]
  },
  {
    "mod": "skillshare",
    "area": "panel-right",
    "description": "Skills and agents panel: sync status, updates, install from URL, source sync.",
    "layouts": [
      "orca#skillshare",
      "orca-unified#skillshare"
    ],
    "props": "unified:true (unified layout only)",
    "opens": [
      "layout.toggle",
      "layout.hide",
      "agent.focus",
      "overlay:skillshare dialogs (install, audit, source, syncboth, upgrade)"
    ],
    "reachedBy": [
      "command:focus",
      "overlay:dialog by props.role (install, audit, source, syncboth, upgrade, preview)",
      "toggle: layout node skillshare-panel"
    ],
    "shared": [
      "skillshare.panelUpdate.v1",
      "skillshare.inSyncView.v1",
      "skillshare.recent.v1"
    ]
  }
];

// Not mapped here, on purpose: `keys.json`, `settings.json` and `programs.json` are seed-once user
// settings that the builder never writes, and the builder itself is `scripts/build-orca-ui.mjs`
// (`node scripts/build-orca-ui.mjs --check --out .` is the read-only drift check).
