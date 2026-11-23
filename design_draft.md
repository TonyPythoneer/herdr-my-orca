# Close all tabs: fix the "Close space?" prompt, add a project-level close

- **Author:** Tony Yang
- **Status:** Ready for handoff (author approved, Alternatives and Implementation written for the handoff)
- **Worktree:** `wt-close-all-tabs` (branch `feature/wt-close-all-tabs`)
- **Implementer:** DeepSeek V4. The plan must be detailed enough that it makes no design decisions of its own.

## The Problem

1. **Bug.** In the sidebar, right-click a worktree card and choose **Delete all tabs**, then confirm the "Close tabs?" dialog. A second dialog, "Close space?", then appears. The user did not ask to close the space. Orca keeps a worktree card with no tabs (the landing page shows), so closing the last tab must not ask about the space.
2. **Missing feature.** There is no way to close every tab of every worktree in one project. The project header's menu only has **Close workspace**, which closes the spaces themselves, not their tabs.

## What we know today (from the code)

- **Delete all tabs** is `orca-menu.delete-all-tabs` (`mods/orca-menu/main.js:237`). It lists the unpinned tabs of the card (`unpinnedTabs`, line 255), opens the "Close tabs?" dialog in `orca-tabs`, and on confirm runs `tab.close` once per tab (`mods/orca-tabs/main.js:677`).
- `commands.md` says `tab.close` takes `id` and `confirmed`, and that `space.close` "asks first unless confirmed". So the "Close space?" prompt most likely comes from the host when the last `tab.close` runs on a space. **This is not yet verified.** It is the first thing the implementer must confirm (see Open Questions).
- A space with zero tabs is a state this repo already handles: `mods/orca-tabs/main.js:423` shows the landing page when the active space has no tabs.
- The sidebar already knows which spaces belong to which project. `mods/orca-spaces/worktree-plan.js` builds `plan.groups`, each with `repo` (the git common directory) and `rows`, and each row holds its space (`r.w`) plus merged spaces on the same checkout (`r.also`).
- The project header menu (`case "group"` in `mods/orca-menu/main.js:190`) receives only `{ id, path, machine }`. It finds the project's spaces by checking whether a space's folder starts with the project path. That check **misses linked worktrees**, because they live in a sibling folder (`herdr-my-orca.worktrees/...`), not inside `herdr-my-orca/`.
- Herdr has no project catalog and no call that lists tabs by project. `spaces()` returns each space with its `folder` and `tabs`, in memory, so there is no search to run and no process to start.

## Overview

- Fix the worktree menu so **Delete all tabs** never closes or asks about the space: the space always keeps at least one tab. If every tab would close, the command first opens one fresh empty terminal tab.
- Add a **Delete all tabs** row to the project header menu. It closes every unpinned tab of every open space that belongs to the project, using the grouping the sidebar already computed. It shows the same confirmation dialog, with the number of tabs and worktrees in it.

## Goals

1. After **Delete all tabs** on a worktree, no "Close space?" prompt appears and the space stays in the sidebar. A space left with no unpinned tab gets one fresh empty terminal tab (decided by the author: closing tabs must not close a space).
2. The project header menu has **Delete all tabs**. It covers the main checkout and all linked worktrees of that project, including worktrees outside the project folder.
3. Pinned tabs (`settled`) stay open in both commands, as they do now.
4. Finding the project's tabs does not run `git` or any other process at click time. It reuses the sidebar's existing grouping.
5. The row is greyed out when the project has no unpinned tab, like the worktree row.

## Non-Goals

- Changing **Close workspace** or **Close** (they still close the space).
- Closing pinned tabs.
- A project-level action for worktrees that are not open as spaces (they have no tabs).
- Changing the "Close tabs?" dialog's look, except the text that says how many tabs and worktrees it covers.
- Remote machines: a project group is per machine, and the command only touches spaces of the group's own machine.

## Open Questions (to settle before Technical Plan)

1. **What does the host do when the last tab of a space is closed?** Answered from the host source (`src/window.rs:3450-3458`, `defaults/AGENTS.md:594`): `tab.close` on a space's only tab turns into `space.close` and asks "Close space?" unless `confirmed: true` is passed. A space with zero tabs cannot be reached through `tab.close`. This is a host rule, and this repo only holds mods, so a space cannot be left with zero tabs. **Decided by the author:** closing tabs must not close the space (so closing the space together with the last tab was rejected), and changing the host is out of scope. The command therefore leaves one fresh terminal tab.

## Technical Plan

### Rule

`tab.close` is never sent for the only tab of a space, and `confirmed` is never passed. If the host's last-tab rule ever fires by mistake, the host asks "Close space?" and nothing is destroyed without a person answering.

### Worktree-level: Delete all tabs

The confirm button of the bulk dialog (`mods/orca-tabs/main.js:668-678`) runs the same list of tab ids. It changes in one place, a helper that decides the order of commands:

1. Group the ids by the space that owns them (look each id up in `spaces()`).
2. For a space whose tabs are **all** in the list (nothing pinned stays): remember it needs a fresh tab.
3. For each such space, run `tab.new { space: <id>, folder: <space folder>, focus: false }` **before** closing that space's tabs. The space has one more tab than before, so no close ever touches a lone tab.
4. Run `tab.close { id }` for every id in the list, as today.

`close-others`, `left` and `right` always leave a tab open, so they skip step 2-3 (the helper finds nothing to add).

### Project-level: Delete all tabs

1. **Which spaces belong to the project.** `orca-spaces` already builds `plan.groups` (`worktree-plan.js:383-392`); each group's rows hold a space (`r.w`) and merged spaces on the same checkout (`r.also`). When the group header opens its menu (`orca-spaces/main.js:840, 886, 890`), add `spaces: [ids]` to the target: every `r.w.id` and `r.also[].w.id` of the group that is a real space (skip ids that start with `wt:`, the unopened worktrees). This is a list read from memory. No `git` call, no search, no path matching. The path-prefix check used by "Close workspace" (`orca-menu/main.js:193`) is not reused, because it misses linked worktrees.
2. **The menu row.** In `case "group"` (`orca-menu/main.js:190-206`) add `["Delete all tabs", "orca-menu.delete-all-tabs", { ids: target.spaces, disabled: <no unpinned tab> }]` above "Close workspace".
3. **One handler for both levels.** `unpinnedTabs(id)` (line 255) takes one space id and returns the tabs of that space and its same-checkout siblings. Generalise it to take a list of ids and return the union (duplicates removed). The delete handler (line 459) passes `it[2].ids ?? [it[2].id]`.
4. **Confirmation text.** The dialog gets one extra line when more than one space is involved: "N tabs in M worktrees". It is passed in `confirmClose.detail` and drawn under the description in `renderConfirmDialog`.
5. **Machines.** A group is per machine (`target.machine`), so only that machine's spaces are listed. Nothing extra to do.

### Why no search is needed

`spaces()` is the host's in-memory list. The project's spaces come from the sidebar's own grouping, which is already computed for drawing. Closing N tabs is N host commands, which is the cost of the feature itself.

### Risks

- **Command order.** The fix needs `tab.new` to take effect before the closes that follow it. The implementer must check this first (Step 0 below). If `run` does not apply commands in order, close all but one tab, then `tab.new`, then close the last old tab.
- **Extra shells.** A project with 6 open worktrees gets 6 new shells. This is the price of "never close a space".
- **Pinned tabs.** If a space has a pinned tab, it is never emptied, so no fresh tab is made.
- **Remote spaces.** The host routes `tab.new` and `tab.close` by the space's machine (`src/window.rs:3201-3206`), so the same code works for them.

### Step 0 for the implementer (spike, no code kept)

In a probe mod that is deleted afterwards: open a throwaway space with 2 tabs, run `tab.new` followed at once by `tab.close` on both old tabs, and check that the space survives with 1 tab and no prompt appears.

## Alternatives Considered

- **Close the space together with the last tab, with one confirmation.** Rejected by author: closing tabs must not close a space. It would also remove the `main` card and possibly the whole project from the sidebar (`worktree-plan.js:340` skips the main checkout when listing unopened worktrees).
- **Keep one existing tab (for example the active one).** Rejected by author: "Delete all tabs" would leave a running agent behind, and the name would be wrong.
- **Change the host so a space can have zero tabs.** Rejected by author: the host source is not in this repo, so the change could not be committed or merged with the mods.
- **Find the project's spaces by folder path.** Rejected by author: it misses linked worktrees stored in `<repo>.worktrees/`. Asking git for each space's common directory at click time is slower and the sidebar already has the answer.

## Detailed Implementation

All paths are relative to the repo root. After editing, copy each changed file to `~/.config/herdr-app/` (see the `herdr-app-dev-sync` skill) and run `herdr-app check ~/.config/herdr-app/mods/<mod>` for each changed mod.

1. **`mods/orca-tabs/close-plan.js` (new).** One pure function `closePlan(spaces, tabIds)` that returns the ordered commands: first a `["tab.new", { space, folder, focus: false }]` for every space whose tabs are all in `tabIds`, then a `["tab.close", { id }]` for every id. It reads only its arguments (no host imports), so it can be tested with `node --test`. It is a new file because the logic has branches and the mod files cannot be imported by tests.
2. **`mods/orca-tabs/close-plan.test.js` (new).** Cases: a space with 2 tabs and both closed gets one `tab.new` first; a space with a pinned tab left gets none; "others" (one tab kept) gets none; two spaces in one list each get their own `tab.new`; an id that no space owns is still closed; an empty list gives no commands.
3. **`mods/orca-tabs/main.js`.** In `confirm()` of `renderConfirmDialog` (lines 668-678), replace the loop `for (const id of cfg.tabIds) run("tab.close", { id })` with: build `closePlan(spaces(), cfg.tabIds)` and run each command in order. Keep the single `cfg.tabId` path unchanged (a lone tab still asks, by design). Draw `cfg.detail`, when present, as one muted line under the description (same style as the description).
4. **`mods/orca-menu/main.js`.**
   - `unpinnedTabs(id)` (line 255): accept a list of ids; return the union of unpinned tab ids of those spaces and their same-checkout siblings, without duplicates.
   - `case "group"` (line 190): add the row `["Delete all tabs", "orca-menu.delete-all-tabs", { ids: tg.spaces ?? [], disabled: !unpinnedTabs(tg.spaces ?? []).length }]` above "Close workspace".
   - `case "space"` (line 237): pass `ids: [tg.id]` so one handler serves both.
   - Handler (line 459): `const ids = unpinnedTabs(it[2].ids ?? [it[2].id])`. When `it[2].ids` holds more than one space, set `detail: "${ids.length} tabs in ${n} worktrees"` in `confirmClose`. Keep re-reading `spaces()` at click time, as the existing comment says.
   - Check `menuIcon` (line 276), the destructive-row test (line 351) and the separator rule (line 305): they key on the command name, so the new group row gets the icon and red style with no change. Confirm by looking at the menu.
   - Group menu popup height: the `openOverlay` calls in `orca-spaces` use `height: 220`. One more row needs about 28 px more. Raise it and check that nothing is clipped.
5. **`mods/orca-spaces/main.js`.** In the three places that open the group menu (lines 840, 886, 890), add `spaces: <ids>` to `target`, where `<ids>` comes from one small helper `groupSpaceIds(g)` in this file: every `r.w.id` and `r.also[].w.id` of `g.rows`, dropping ids that start with `wt:`. `g` is already in scope at those lines.
6. **`mods/orca-menu/mod.json`, `mods/orca-tabs/mod.json`:** no change expected; only check that a new `.js` file in a mod folder is picked up without being listed.

### Done when

- `node --test mods/orca-tabs/` passes with the new tests.
- In the app: **Delete all tabs** on a worktree with 3 tabs leaves 1 fresh shell tab, no "Close space?" dialog. The same on a project header covers the main checkout and a linked worktree stored outside the project folder.
- A space with a pinned tab keeps it and gets no fresh tab.
- The group menu shows the new row, red, with the icon, and nothing is clipped.
- Step 0 (the order spike) was done first; its probe mod is removed from `~/.config/herdr-app/` (mod folder, layout block and `layouts/.state` entry).
