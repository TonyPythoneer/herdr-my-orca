# Latest custom Orca mod interactions

Main commit: **9912b690041cf4fa79fe999baa9394aeba0f778b**

Native App screenshots from a synthetic workspace on a disposable GitHub-hosted runner.
Full-resolution originals, before/after pairs, and machine-readable diagnostics remain in the Actions artifact.

[Open this Actions run / full artifact](https://github.com/TonyPythoneer/herdr-my-orca/actions/runs/45371638810)

Tracked configuration files verified after native launch: 612

captured: 24 · failed: 1 · blocked: 0 · not-run: 0

Only custom controls. Captured means a real interaction and visible change; semantic review is required. Closed frames show actual Escape or outside click, as indicated per operation.

## Mod coverage

Observed: orca-agent-manager, orca-agents, orca-changes, orca-chrome, orca-diff, orca-files, orca-menu, orca-nav, orca-new-menu, orca-panel-head, orca-spaces, orca-tabs, orca-tasks

Not observed: agent-config, orca-confirm, orca-float, orca-handoff, orca-landing, orca-pane, orca-panel-gap, orca-split-menu, orca-status, orca-worktree

## 01 — orca-nav: Workspace options popup

**captured** · native-mouse · expected-popup

Dismissal: native-keyboard-escape

Click: [204, 97]

**Before**

![Workspace options popup — before](01-before.jpg)

**After**

![Workspace options popup — after](01-after.jpg)

**Closed**

![Workspace options popup — closed](01-closed.jpg)

## 02 — orca-nav / orca-new-menu: New workspace menu

**captured** · native-mouse · expected-popup

Dismissal: native-keyboard-escape

Click: [260, 97]

**Before**

![New workspace menu — before](02-before.jpg)

**After**

![New workspace menu — after](02-after.jpg)

**Closed**

![New workspace menu — closed](02-closed.jpg)

## 03 — orca-nav / orca-spaces: Collapse project groups

**captured** · native-mouse · visible-change; manual semantic review required

Click: [76, 97]

**Before**

![Collapse project groups — before](03-before.jpg)

**After**

![Collapse project groups — after](03-after.jpg)

## 04 — orca-nav / orca-spaces: Expand project groups

**captured** · native-mouse · visible-change; manual semantic review required

Click: [76, 97]

**Before**

![Expand project groups — before](04-before.jpg)

**After**

![Expand project groups — after](04-after.jpg)

## 05 — orca-spaces: Project group disclosure

**captured** · native-mouse · visible-change; manual semantic review required

Click: [92, 136]

**Before**

![Project group disclosure — before](05-before.jpg)

**After**

![Project group disclosure — after](05-after.jpg)

## 06 — orca-spaces: Project group expand

**captured** · native-mouse · visible-change; manual semantic review required

Click: [92, 136]

**Before**

![Project group expand — before](06-before.jpg)

**After**

![Project group expand — after](06-after.jpg)

## 07 — orca-spaces / orca-menu: Project group context menu

**captured** · native-mouse · expected-popup

Dismissal: native-keyboard-escape

Click: [92, 136]

**Before**

![Project group context menu — before](07-before.jpg)

**After**

![Project group context menu — after](07-after.jpg)

**Closed**

![Project group context menu — closed](07-closed.jpg)

## 08 — orca-tabs / orca-new-menu: New terminal tab menu

**captured** · native-mouse · expected-popup

Dismissal: native-keyboard-escape

Click: [446, 16]

**Before**

![New terminal tab menu — before](08-before.jpg)

**After**

![New terminal tab menu — after](08-after.jpg)

**Closed**

![New terminal tab menu — closed](08-closed.jpg)

## 09 — orca-files: Explorer: expand src folder

**captured** · native-mouse · visible-change; manual semantic review required

Click: [716, 168]

**Before**

![Explorer: expand src folder — before](09-before.jpg)

**After**

![Explorer: expand src folder — after](09-after.jpg)

## 10 — orca-files: Explorer: select Contents search

**captured** · native-mouse · visible-change; manual semantic review required

Click: [930, 86]

**Before**

![Explorer: select Contents search — before](10-before.jpg)

**After**

![Explorer: select Contents search — after](10-after.jpg)

## 11 — orca-files: Explorer: search details

**captured** · native-mouse · visible-change; manual semantic review required

Click: [1005, 160]

**Before**

![Explorer: search details — before](11-before.jpg)

**After**

![Explorer: search details — after](11-after.jpg)

## 12 — orca-files: Explorer: return to Names search

**captured** · native-mouse · visible-change; manual semantic review required

Click: [765, 86]

**Before**

![Explorer: return to Names search — before](12-before.jpg)

**After**

![Explorer: return to Names search — after](12-after.jpg)

## 13 — orca-files: Explorer: open file

**captured** · native-mouse · visible-change; manual semantic review required

Click: [751, 216]

**Before**

![Explorer: open file — before](13-before.jpg)

**After**

![Explorer: open file — after](13-after.jpg)

## 14 — orca-panel-head / orca-changes: Source Control tab

**captured** · native-mouse · visible-change; manual semantic review required

Click: [763, 16]

**Before**

![Source Control tab — before](14-before.jpg)

**After**

![Source Control tab — after](14-after.jpg)

## 15 — orca-changes / orca-diff: Source Control: open changed file

**captured** · native-mouse · visible-change; manual semantic review required

Dismissal: native-outside-click

Click: [749, 178]

**Before**

![Source Control: open changed file — before](15-before.jpg)

**After**

![Source Control: open changed file — after](15-after.jpg)

**Closed**

![Source Control: open changed file — closed](15-closed.jpg)

## 16 — orca-panel-head / orca-agents: Agent history tab

**captured** · native-mouse · visible-change; manual semantic review required

Click: [731, 16]

**Before**

![Agent history tab — before](16-before.jpg)

**After**

![Agent history tab — after](16-after.jpg)

## 17 — orca-chrome / orca-agent-manager: Agent manager footer

**captured** · native-mouse · visible-change; manual semantic review required

Click: [20, 645]

**Before**

![Agent manager footer — before](17-before.jpg)

**After**

![Agent manager footer — after](17-after.jpg)

## 18 — orca-chrome / orca-agent-manager: Model providers footer

**captured** · native-mouse · visible-change; manual semantic review required

Click: [48, 645]

**Before**

![Model providers footer — before](18-before.jpg)

**After**

![Model providers footer — after](18-after.jpg)

## 19 — orca-agent-manager: Agent manager: global permissions dropdown

**captured** · native-mouse · visible-change; manual semantic review required

Dismissal: native-outside-click

Click: [550, 140]

**Before**

![Agent manager: global permissions dropdown — before](19-before.jpg)

**After**

![Agent manager: global permissions dropdown — after](19-after.jpg)

**Closed**

![Agent manager: global permissions dropdown — closed](19-closed.jpg)

## 20 — orca-agent-manager: Agent manager: provider editor

**captured** · accessibility-press · visible-change; manual semantic review required

**Before**

![Agent manager: provider editor — before](20-before.jpg)

**After**

![Agent manager: provider editor — after](20-after.jpg)

## 21 — orca-chrome / orca-tasks: Task management footer

**captured** · native-mouse · visible-change; manual semantic review required

Click: [76, 645]

**Before**

![Task management footer — before](21-before.jpg)

**After**

![Task management footer — after](21-after.jpg)

## 22 — orca-tasks: Task management: JSON editor

**failed** · native-mouse · not verified

Click: [612, 271]

Isolation recovery: succeeded

Incomplete operation; consult manifest.json in the full artifact.

**Before**

![Task management: JSON editor — before](22-before.jpg)

**After**

![Task management: JSON editor — after](22-after.jpg)

**Diagnostic**

![Task management: JSON editor — diagnostic](22-diagnostic.jpg)

## 23 — orca-tasks: Task management: back to terminals

**captured** · native-mouse · visible-change; manual semantic review required

Click: [318, 68]

**Before**

![Task management: back to terminals — before](23-before.jpg)

**After**

![Task management: back to terminals — after](23-after.jpg)

## 24 — orca-chrome / orca-tabs: Unified sidebar collapse

**captured** · native-mouse · visible-change; manual semantic review required

Click: [91, 15]

**Before**

![Unified sidebar collapse — before](24-before.jpg)

**After**

![Unified sidebar collapse — after](24-after.jpg)

## 25 — orca-panel-head / orca-tabs: Unified right panel collapse

**captured** · native-mouse · visible-change; manual semantic review required

Click: [1000, 15]

**Before**

![Unified right panel collapse — before](25-before.jpg)

**After**

![Unified right panel collapse — after](25-after.jpg)

