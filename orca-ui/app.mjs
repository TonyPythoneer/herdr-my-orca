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
import panelHead from "./features/right-sidebar/header/manifest.json" with { type: "json" };
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
    "mod": "orca-agent-flyout",
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
      "orca-agent-flyout"
    ],
    "tests": [
      "mods/orca-agent-flyout/agent-flyout.test.js",
      "mods/orca-agent-flyout/argv.golden.test.js",
      "mods/orca-agent-flyout/codex-provider.test.js",
      "mods/orca-agent-flyout/flyout.golden.test.js",
      "mods/orca-agent-flyout/launch.test.js",
      "mods/orca-agent-flyout/lists.test.js",
      "mods/orca-agent-flyout/quickstart-wrapper.test.js",
      "mods/orca-agent-flyout/render.golden.test.js",
      "mods/orca-agent-flyout/settings.flow.test.js"
    ],
    "next": [
      "mods/orca-files/main.js"
    ]
  },
  {
    "mod": "orca-agent-settings",
    "area": "center",
    "description": "Settings-style page for the agent catalog: installs, commands, permissions, model providers.",
    "layouts": [
      "orca#main-agents",
      "orca#main-providers"
    ],
    "props": "main-providers: props.page=providers; props.expand deep link via tab.new",
    "opens": [
      "layout.select"
    ],
    "reachedBy": [
      "tab: deep link tab.new {mod:orca-agent-settings, props:{expand}}"
    ],
    "shared": [
      "agent-manager.inventory",
      "agent-manager.selected",
      "agent-manager.open-agent",
      "agent-manager.toggle-agent"
    ],
    "tests": [
      "mods/orca-agent-settings/agent-rail.test.js",
      "mods/orca-agent-settings/install.test.js",
      "mods/orca-agent-settings/manager-flow.test.js",
      "mods/orca-agent-settings/manager-logic.test.js",
      "mods/orca-agent-settings/manager-page.test.js",
      "mods/orca-agent-settings/permission-menu.test.js",
      "mods/orca-agent-settings/permissions.flow.test.js",
      "mods/orca-agent-settings/permissions.test.js",
      "mods/orca-agent-settings/provider.flow.test.js",
      "mods/orca-agent-settings/render.test.js",
      "mods/orca-agent-settings/state.test.js",
      "mods/orca-agent-settings/util.test.js"
    ]
  },
  {
    "mod": "orca-right-sidebar-agents",
    "area": "panel-right",
    "description": "Agents panel: live agents above on-disk session history, with search and resume.",
    "layouts": [
      "orca#agent-sessions"
    ],
    "opens": [
      "terminal.open",
      "agent.focus"
    ],
    "tests": [
      "mods/orca-right-sidebar-agents/agents-flow.test.js"
    ]
  },
  {
    "mod": "orca-changes",
    "area": "panel-right",
    "description": "Source Control panel: changed files, stage, discard, commit, push and create PR.",
    "layouts": [
      "orca#changes"
    ],
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
      "mods/orca-changes/git-matrix.test.js",
      "mods/orca-changes/main.golden.test.js",
      "mods/orca-changes/operation-target.test.js",
      "mods/orca-changes/push-target.test.js",
      "mods/orca-changes/refresh.flow.test.js",
      "mods/orca-changes/section-view.test.js"
    ],
    "next": [
      "mods/orca-diff/main.js",
      "mods/orca-files/main.js"
    ]
  },
  {
    "mod": "orca-status-footer",
    "area": "status-bar",
    "description": "The status bar's leftmost footer with Agents, Providers, Tasks, Settings and Help buttons; also keeps the task runner alive.",
    "layouts": [
      "orca#status-footer"
    ],
    "opens": [
      "layout.select",
      "app.settings",
      "app.palette"
    ],
    "shared": [
      "tasks.config",
      "tasks.text",
      "tasks.state",
      "tasks.resets"
    ],
    "tests": [
      "mods/orca-status-footer/footer-flow.test.js"
    ],
    "next": [
      "mods/orca-status-footer/scheduler.js",
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
    ],
    "tests": [
      "mods/orca-confirm/confirm.flow.test.js",
      "mods/orca-confirm/render.flow.test.js"
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
      "mods/orca-diff/data.flow.test.js",
      "mods/orca-diff/diff-data.test.js",
      "mods/orca-diff/diff-load.test.js",
      "mods/orca-diff/diff.test.js",
      "mods/orca-diff/pane.flow.test.js",
      "mods/orca-diff/view.flow.test.js"
    ]
  },
  {
    "mod": "orca-files",
    "area": "panel-right",
    "description": "File explorer for the space folder: tree, previews, editing and a context menu.",
    "layouts": [
      "orca#files"
    ],
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
      "orca-right-sidebar-header reveals (search)"
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
      "mods/orca-files/files-data.flow.test.js",
      "mods/orca-files/files-ui.flow.test.js",
      "mods/orca-files/pure.flow.test.js",
      "mods/orca-files/save-queue.test.js",
      "mods/orca-files/tree-keys.test.js",
      "mods/orca-files/tree-nav.test.js"
    ],
    "next": [
      "mods/orca-confirm/main.js"
    ]
  },
  {
    "mod": "orca-float-workspace",
    "area": "overlay-or-menu",
    "description": "Floating bottom-right workspace panel toggled by Ctrl+Alt+A; opens new tabs.",
    "layouts": [
      "orca#float-workspace"
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
      "command:toggle (orca-float-workspace.toggle)"
    ],
    "shared": [
      "orca-float-workspace.open",
      "orca-float-workspace.attention"
    ],
    "tests": [
      "mods/orca-float-workspace/golden.test.js",
      "mods/orca-float-workspace/panel.flow.test.js",
      "mods/orca-float-workspace/workspace.flow.test.js"
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
      "overlay:dialog opened by orca-context-menu (handoff and fork items)"
    ],
    "tests": [
      "mods/orca-handoff/dialog.flow.test.js",
      "mods/orca-handoff/main.golden.test.js"
    ]
  },
  {
    "mod": "orca-landing",
    "area": "center",
    "description": "Welcome page shown with no workspace open; tiles start a new space or tab.",
    "layouts": [
      "orca#main-landing"
    ],
    "opens": [
      "space.new",
      "overlay:orca-new-menu"
    ],
    "tests": [
      "mods/orca-landing/buttons.flow.test.js",
      "mods/orca-landing/golden.test.js",
      "mods/orca-landing/shortcuts.test.js"
    ],
    "next": [
      "mods/orca-new-menu/main.js"
    ]
  },
  {
    "mod": "orca-context-menu",
    "area": "overlay-or-menu",
    "description": "Right-click context menu for panes, tabs, spaces and groups: split, close, copy, move.",
    "props": "root.terminal_menu='orca-context-menu' (not a node)",
    "opens": [
      "overlay:orca-header",
      "overlay:orca-handoff",
      "overlay:orca-worktree",
      "pane.split",
      "tab.close",
      "space.close"
    ],
    "reachedBy": [
      "overlay:popup props.tab pane|tab|space|group",
      "terminal_menu (root)"
    ],
    "shared": [
      "orca-sidebar-projects.forget",
      "spaces.unread.v1",
      "orca-header.action"
    ],
    "tests": [
      "mods/orca-context-menu/close-row.test.js",
      "mods/orca-context-menu/close-sides.test.js",
      "mods/orca-context-menu/close-space.test.js",
      "mods/orca-context-menu/menu.flow.test.js",
      "mods/orca-context-menu/menu.golden.test.js"
    ],
    "next": [
      "mods/orca-header/main.js",
      "mods/orca-handoff/main.js",
      "mods/orca-worktree/main.js"
    ]
  },
  {
    "mod": "orca-sidebar-top",
    "area": "sidebar-left",
    "description": "Sidebar top: search field, page rows (Tasks etc.), and the Projects header.",
    "layouts": [
      "orca#nav-top"
    ],
    "opens": [
      "mod.open:picker",
      "layout.select",
      "orca-sidebar-projects.expand-all",
      "orca-sidebar-projects.collapse-all",
      "space.new",
      "overlay:orca-new-menu"
    ],
    "reachedBy": [
      "overlay:popup props.navMenu=workspace-options"
    ],
    "shared": [
      "left-sidebar.openPx",
      "projects.allCollapsed",
      "projects.count"
    ],
    "tests": [
      "mods/orca-sidebar-top/refresh.test.js"
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
      "overlay:orca-agent-flyout"
    ],
    "reachedBy": [
      "overlay:popup 288x512 from the + buttons in orca-header, orca-landing, orca-sidebar-top, orca-float-workspace"
    ],
    "shared": [
      "agent-manager.inventory",
      "orca-agent-flyout"
    ],
    "tests": [
      "mods/orca-new-menu/inventory.test.js",
      "mods/orca-new-menu/menu.flow.test.js",
      "mods/orca-new-menu/menu.golden.test.js",
      "mods/orca-new-menu/rows.test.js"
    ],
    "next": [
      "mods/orca-worktree/main.js",
      "mods/orca-agent-flyout/main.js"
    ]
  },
  {
    "mod": "orca-pane-header",
    "area": "header",
    "description": "Pane title bar: on hover, split and close buttons; click focuses the pane.",
    "layouts": [
      "orca#main-terminals"
    ],
    "props": "pane.header on main-terminals (height 32, top); props {pane, terminal}",
    "opens": [
      "pane.focus",
      "pane.split",
      "agent.focus",
      "overlay:orca-context-menu",
      "overlay:orca-pane-header"
    ],
    "reachedBy": [
      "overlay:popup props.pane (orca-pane-header self)"
    ],
    "shared": [
      "orca-header.pane-drag",
      "orca-header.action"
    ],
    "tests": [
      "mods/orca-pane-header/crew.test.js",
      "mods/orca-pane-header/golden.test.js",
      "mods/orca-pane-header/interactions.flow.test.js"
    ],
    "next": [
      "mods/orca-context-menu/main.js"
    ]
  },
  {
    "mod": "orca-right-sidebar-placeholders",
    "area": "panel-right",
    "description": "Placeholder for panel tabs Herdr lacks: Workspaces, PR Checks, Checks and Ports.",
    "layouts": [
      "orca#workspaces",
      "orca#pr-checks",
      "orca#checks",
      "orca#ports"
    ],
    "props": "tab: workspaces|pr-checks|checks|ports",
    "tests": [
      "mods/orca-right-sidebar-placeholders/panel-motion.test.js"
    ]
  },
  {
    "mod": "orca-sidebar-projects",
    "area": "sidebar-left",
    "description": "Project tree of workspaces by repo and machine; click switches, drag reorders.",
    "layouts": [
      "orca#projects"
    ],
    "opens": [
      "space.new",
      "layout.select",
      "overlay:orca-context-menu"
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
      "orca-sidebar-projects.forget",
      "pr.cache.v2",
      "agent-manager.inventory",
      "agent-manager.selected",
      "agent-manager.open-agent",
      "agent-manager.toggle-agent"
    ],
    "tests": [
      "mods/orca-sidebar-projects/agent-rail.test.js",
      "mods/orca-sidebar-projects/card-agents.test.js",
      "mods/orca-sidebar-projects/git-refresh.test.js",
      "mods/orca-sidebar-projects/left-sidebar-agents.test.js",
      "mods/orca-sidebar-projects/render.test.js",
      "mods/orca-sidebar-projects/retained-row.test.js",
      "mods/orca-sidebar-projects/review-store.test.js",
      "mods/orca-sidebar-projects/storage.test.js",
      "mods/orca-sidebar-projects/worktree-plan.test.js"
    ],
    "next": [
      "mods/orca-context-menu/main.js"
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
    "tests": [
      "mods/orca-split-menu/actions.flow.test.js",
      "mods/orca-split-menu/menu.golden.test.js"
    ],
    "next": [
      "mods/orca-files/main.js",
      "mods/orca-changes/main.js"
    ]
  },
  {
    "mod": "orca-status-ports",
    "area": "status",
    "description": "Bottom bar plug button: counts the listening ports the open spaces own and opens the Ports popover.",
    "layouts": [
      "orca#status-ports"
    ],
    "opens": [
      "space.select",
      "overlay:popup"
    ],
    "reachedBy": [
      "command:open"
    ],
    "shared": [
      "orca-status-ports.scan",
      "orca-status-ports.overlay"
    ],
    "tests": [
      "mods/orca-status-ports/scan.test.js"
    ]
  },
  {
    "mod": "orca-status-bar",
    "area": "status",
    "description": "Bottom status bar: provider usage, maintenance segments, float toggle, updates.",
    "layouts": [
      "orca#status-bar"
    ],
    "opens": [
      "orca-float-workspace.toggle",
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
      "orca-float-workspace.open",
      "orca-float-workspace.attention"
    ],
    "tests": [
      "mods/orca-status-bar/claude-statusline.test.js",
      "mods/orca-status-bar/local-usage.test.js",
      "mods/orca-status-bar/status-flow.test.js",
      "mods/orca-status-bar/usage-edge.test.js",
      "mods/orca-status-bar/usage.test.js",
      "mods/orca-status-bar/wt-follow.test.js"
    ],
    "next": [
      "mods/orca-float-workspace/main.js"
    ]
  },
  {
    "mod": "orca-header",
    "area": "header",
    "description": "Tab strip with sidebar and panel toggles, drag-to-split, new tab and window controls.",
    "layouts": [
      "orca#tabs"
    ],
    "props": "motion:'native', pinSidebarTerminal:true",
    "keys": [
      "global:cmd-t",
      "global:cmd-b",
      "layout:orca:cmd-l",
      "layout:orca:ctrl-shift-b",
      "layout:orca:ctrl-shift-e"
    ],
    "opens": [
      "overlay:orca-context-menu",
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
      "orca-header.drop",
      "orca-header.action",
      "orca-header.pane-drag",
      "left-sidebar.collapsed",
      "left-sidebar.openPx",
      "panel.openPx"
    ],
    "tests": [
      "mods/orca-header/agent-settings-route.test.js",
      "mods/orca-header/close-plan.test.js",
      "mods/orca-header/drop-zone.test.js",
      "mods/orca-header/golden.test.js",
      "mods/orca-header/interactions.flow.test.js",
      "mods/orca-header/new-tab.test.js",
      "mods/orca-header/sidebar-motion.test.js",
      "mods/orca-header/sidebar-native.test.js",
      "mods/orca-header/tab-panes.test.js",
      "mods/orca-header/tab-strip-scroll.test.js",
      "mods/orca-header/tab-title.test.js",
      "mods/orca-header/unofficial-apps.test.js"
    ],
    "next": [
      "mods/orca-context-menu/main.js",
      "mods/orca-new-menu/main.js"
    ]
  },
  {
    "mod": "orca-tasks",
    "area": "center",
    "description": "Task page: scheduled tasks with toggles, New task, delete and a JSON view.",
    "layouts": [
      "orca#main-tasks"
    ],
    "opens": [
      "orca-status-footer.tasks-scan",
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
      "mods/orca-tasks/tasks-flow.test.js",
      "mods/orca-tasks/tasks.test.js"
    ],
    "next": [
      "mods/orca-status-footer/scheduler.js"
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
      "overlay:dialog with props.action new|open|remove (from orca-new-menu, orca-context-menu)"
    ],
    "tests": [
      "mods/orca-worktree/create.test.js",
      "mods/orca-worktree/dialog.flow.test.js",
      "mods/orca-worktree/helpers.test.js",
      "mods/orca-worktree/main.golden.test.js",
      "mods/orca-worktree/remove.test.js",
      "mods/orca-worktree/switch.test.js"
    ]
  }
];

// Not mapped here, on purpose: `keys.json`, `settings.json` and `programs.json` are seed-once user
// settings that the builder never writes, and the builder itself is `scripts/build-orca-ui.mjs`
// (`node scripts/build-orca-ui.mjs --check --out .` is the read-only drift check).
