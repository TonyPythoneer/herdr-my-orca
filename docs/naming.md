# Semantic naming contract

The binding policy is in [AGENTS.md](../AGENTS.md). The target vocabulary is defined by [#38](https://github.com/TonyPythoneer/herdr-my-orca/issues/38). Existing legacy identifiers in the mapping below describe the current runtime, not permission to introduce new ones.

| Behavior | Preferred anatomy |
|---|---|
| Execute a command | Button, IconButton, MenuItem |
| Choose one value | Select, RadioGroup |
| Choose multiple values | CheckboxGroup |
| Text input with value selection | Combobox |
| Anchored complex content | Popover |
| Grouped actions | Toolbar |
| Expandable content | CollapsibleRoot, CollapsibleTrigger, CollapsiblePanel |
| Boolean track/thumb | SwitchRoot, SwitchTrack, SwitchThumb |
| Pressable state without track/thumb | Toggle, ToggleGroup |
| Context-dependent commands | ContextMenu |
| Short hover hint / rich content | Tooltip / HoverCard |
| Scrollable content | ScrollArea, Viewport, Scrollbar, Thumb |

Actual native behavior determines the name. Do not add a web dependency or claim unsupported anatomy. IDs: scope--semantic-identifier[-stable-target-identity], e.g. left-sidebar--search-worktrees-trigger, agent-settings--group-trigger-official. Native external IDs and persisted keys must be migrated deliberately. Use handleMouseDown for a raw event, onSelect for a callback and selectAgent for the domain action; distinguish isHovered from hoveredItemId and selectedModelId. Configuration uses COMPONENT__PROPERTY_UNIT. Preserve agent/provider logos; use verified native icons for equivalent generic controls.

## Legacy runtime location map


Say the words in the first column to a person or an AI and they land on the right mod, layout node and file.
Mod names follow `orca-<screen area>-<what it draws>`. Layout node ids are older and shorter; the third column maps them.

| What you see                                                                                       | Mod (`mods/…`)                                                                     | Layout node id                               | Notes                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| The header across the top (tabs, sidebar and right-sidebar toggles, window buttons, "Back to app") | `orca-header`                                                                      | `tabs`                                       | Commands: `orca-header.toggle-sidebar`, `orca-header.toggle-panel`, `orca-header.new-tab`, `orca-header.agent-settings` |
| Left sidebar: search, Tasks row, Projects header                                                   | `orca-sidebar-top`                                                                 | `nav-top`                                    |                                                                                                                         |
| Left sidebar: the project / workspace list and the agent rail                                      | `orca-sidebar-projects`                                                            | `projects`                                   | "workspace", "space" and "worktree" are Herdr/Orca words for the rows in it                                             |
| Terminal pane title bar (split and close buttons)                                                  | `orca-pane-header`                                                                 | pane `header` of `main-terminals`            | A **pane** is one terminal; not the right sidebar                                                                       |
| Right sidebar (the whole column)                                                                   | `orca-right-sidebar-header` draws the view switcher; `orca-header` owns its toggle | `panel`, `panel-head`, `panel-body`          | The UI says "right sidebar"; the node ids still say `panel`                                                             |
| Right sidebar › Explorer                                                                           | `orca-files`                                                                       | `files`                                      |                                                                                                                         |
| Right sidebar › Agents (live agents and session history)                                           | `orca-right-sidebar-agents`                                                        | `agent-sessions`                             | Not the Agent Settings page                                                                                             |
| Right sidebar › Source Control                                                                     | `orca-changes`                                                                     | `changes`                                    |                                                                                                                         |
| Right sidebar › Attached worktrees, PR Checks, Checks, Ports                                       | `orca-right-sidebar-placeholders`                                                  | `workspaces`, `pr-checks`, `checks`, `ports` | Placeholders for tabs Herdr lacks; this Ports tab is **not** the bottom-bar Ports button                                |
| Centre: Agent Settings page ("Global Agent Settings") and Model providers page                     | `orca-agent-settings`                                                              | `main-agents`, `main-providers`              | The footer's **Agents** button opens it. Data: `agent-manager.json`, `agent-config.json`                                |
| Centre: Tasks page                                                                                 | `orca-tasks`                                                                       | `main-tasks`                                 |                                                                                                                         |
| Centre: Welcome page, Diff pane                                                                    | `orca-landing`, `orca-diff`                                                        | `main-landing`                               |                                                                                                                         |
| Bottom bar, leftmost buttons (Agents, Model providers, Tasks, Settings, Help)                      | `orca-status-footer`                                                               | `status-footer`                              | Also runs the task scheduler (`scheduler.js`): only a block that is always on screen starts at launch                   |
| Bottom bar: usage, updates, float toggle                                                           | `orca-status-bar`                                                                  | `status-bar`                                 |                                                                                                                         |
| Bottom bar: Ports button and popover                                                               | `orca-status-ports`                                                                | `status-ports`                               |                                                                                                                         |
| Floating workspace (Ctrl+Alt+A)                                                                    | `orca-float-workspace`                                                             | float `float-workspace`                      |                                                                                                                         |
| Right-click menu                                                                                   | `orca-context-menu`                                                                | root `terminal_menu`                         |                                                                                                                         |
| `+` menu, Split Terminal menu                                                                      | `orca-tab-dropdown`, `orca-split-menu`                                                 | popups                                       |                                                                                                                         |
| Agent options flyout beside an agent row                                                           | `orca-agent-flyout`                                                                | popup                                        |                                                                                                                         |
| Dialogs: confirm, handoff, worktree                                                                | `orca-confirm`, `orca-handoff`, `orca-worktree`                                    | popups                                       |                                                                                                                         |

Three things the UI calls "Agents" or "Ports" are different on purpose; always say which one:

- **Agents button (bottom bar)** → Agent Settings page. **Agents tab (right sidebar)** → live agents and history. **Agent rail (left sidebar)** → the per-agent shortcuts in the projects list.
- **Ports button (bottom bar)** → `orca-status-ports`. **Ports tab (right sidebar)** → placeholder.

Stored data keeps its original names on purpose, so nothing the person saved is lost: `agent-config.json`, `agent-manager.json`, and the `localStorage` / shared keys such as `projects.saved.v1`.
