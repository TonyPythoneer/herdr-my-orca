# Handoff: finishing the shared-component work in the Orca UI

This is what is left and what will bite you. Read `AGENTS.md` and `.agents/skills/orca-ui/SKILL.md`
first; they say where things live. `.claude/skills` is a symlink to `.agents/skills`, so both paths work.

## State

- Branch `fix/sidebar-branch-tooltip`, tracking `origin/fix/sidebar-branch-tooltip`. The four commits
  after `f2b61c2` are local only; nothing was pushed. No pull request is open. Ask the owner before
  opening one or pushing.
- Thirteen commits on top of `main`, oldest first:
  1. `9011451` AI discovery and live-driving tools (`scripts/ui.mjs`, `AGENTS.md`, the skill)
  2. `bdfcb32` LiteLLM gateway quickstart and shared agent selection (mixed in one commit)
  3. `e912bf1` shared ghost icon button (`IconButton`) and index support for call sites
  4. `5725aba` titlebar icon buttons through `IconButton`
  5. `4b18974` pane header buttons through `IconButton`
  6. `59c6a8b` dialog and tasks text buttons through `DialogButton`
  7. `9cea965` outline icon buttons through `IconButton` (floating workspace, ports close)
  8. `a403f18` audit skips the shared-control helper files
  9. `f2b61c2` review fixes: changes harness, pane theme, index labels and roles
  10. `2679403` the verification tools and this document (see "Tools" below)
  11. `601fd58` strict golden diffs now walk keyed records, not only a tree's `c`
  12. `5fa355d` handoff and changes dialog footers through `DialogButton`
  13. this document's dialog footer record
- Guardrails, current values: shared sources 13, shared copies 41, managed files 45.
  Enforced by `scripts/sync-shared.test.mjs`, `scripts/build-orca-ui.test.js` and
  `scripts/orca-ui-manifests.test.js`.
- Audit (`node scripts/ui.mjs audit`): 125 interactive builders, 38 without a stable id.
  The helper internals are excluded; the shared-control call sites are counted by their literal id.
- Decisions already made by the owner:
  - keep the pointer cursor on the titlebar buttons;
  - keep `flex_none` on `proj-add-repo` and `proj-new`;
  - never re-record a stale golden silently. Say which keys changed, and why, first.

## Tools (verification bar)

The bar used for every family: a semantic diff, a strict diff where order matters, the failing-name
diff, an isolated host check, a live sync check, and updated guardrails. The tools are in the repo:

- `scripts/golden-diff.mjs semantic <base> <now> [--key a.b.c ...] [--noid]`
  per case or key, the set of calls each element makes, order ignored. `--noid` also ignores which
  element a call sits on. Use it when a control gains an id: it then shows only the added calls.
- `scripts/golden-diff.mjs strict <base> <now> [--key a.b.c ...]`
  the first order-sensitive difference, with the nearest element id.
- `scripts/failing-tests.sh [repo] [out.tsv]`
  runs every test file alone and lists each failing test. Compare two outputs with `comm -23`.

Dumps, per suite (run from the repo root, one suite at a time):

- Sidebar-top nav: `DUMP=/path/nav.json node --test mods/orca-sidebar-top/refresh.test.js`
- Header, pane, float: `GOLDEN_DUMP=/path/dir node --test mods/<mod>/golden.test.js`, which writes
  `orca-header-golden.json`, `orca-pane-golden.json` or `orca-float-golden.json` into that directory
  (many cases, each with `name` and `trees`).
- Changes: `GOLDEN_FULL=/path/full.json node --test mods/orca-changes/main.golden.test.js`
  (keyed record with the top-level keys `renders`, `flows`, `handlers`; use `--key flows.<name>`).

Get the base dump from `git archive <previous commit> | tar -x -C <dir>` and run the same command there.

## Ground rules (they cost time when forgotten)

- **Shared helpers.** Edit `orca-ui/shared/<name>.js`, never a copy in `mods/`. Then
  `node scripts/build-orca-ui.mjs --out .` and `node scripts/build-orca-ui.mjs --check --out .` (must exit 0).
  A new consumer needs an output line in `orca-ui/shared/manifest.json`.
  Every new copy changes the copy and managed-file counts. Update them to the real values:
  `scripts/sync-shared.test.mjs` (copy count), `scripts/build-orca-ui.test.js` (managed files, in the test
  name and in the assertion), `scripts/orca-ui-manifests.test.js` (shared sources, table size, shared
  copies). A new shared source also changes the `shared.files` count.
- **Shared controls.** A new control name goes in `SHARED_CONTROLS` and its helper file in
  `SHARED_CONTROL_FILES` (both in `scripts/ui-index.mjs`), with a test in `scripts/ui-index.test.mjs`.
  Call sites pass the literal id and label as the first two arguments, so the index can read them.
  A dynamic label is reported empty, never borrowed from a sibling.
- **Live sync.** Live is `~/.config/herdr-app`.
  1. Check each file you will overwrite: `cmp <(git show HEAD:<f>) ~/.config/herdr-app/<f>`.
     If it differs, stop and look: someone changed live.
  2. One `cp` per file (no rsync, no directory copy, no delete).
  3. `cmp` each file against the repo, and `stat -f %Lp` both (mode 644).
  4. `herdr-app status`, and check that `errors` is `[]`.
  5. `diff -rq orca-ui ~/.config/herdr-app/orca-ui` must print nothing.
  Test files under `mods/` are mirrored to live too (`refresh.test.js`, `main.golden.test.js`, goldens).
- **Host check.** Run `herdr-app check` only on an isolated copy, never on the live path:
  `cp -R mods orca-ui layouts themes programs.json keys.json settings.json <tmp>`, then
  `cd <tmp> && herdr-app check mods/<mod>`. Grep the output for `check passed`: the last line can be a WARN.
- **Baseline failures.** Every suite has failures that predate the work (list below). A change is
  acceptable when the failing names are the same as the previous commit's. Compare with
  `scripts/failing-tests.sh` on the current tree and on a detached worktree of the previous commit:
  `git worktree add --detach /tmp/base <commit>`. A `git archive` copy has no `.git`, so the script's
  `git ls-files` finds no tests and writes an empty list; that is the "0 failures" trap below.
  Never run `comm` against a file that does not exist: `2>/dev/null` makes it print 0, which means nothing.
- **Goldens depend on call order.** The sidebar-top nav golden is green and must stay strictly identical
  to the previous commit (`golden-diff.mjs strict`, all five `nav-*` keys, zero differences).
  The IconButton call order is load-bearing; it is, in order:
  id, size (or w/h), flex_none, flex, items_center, justify_center, rounded (corners last),
  border_1 and border_color, bg, text_size, cursor_pointer (unless disabled), role,
  accessibility_label, tooltip (if any), on_click, child, then text_color and hover
  (or the active or disabled variant).
- **Shell traps.** zsh does no word splitting: put lists in arrays, or use `bash -c` or a script file.
  Unquoted globs such as `--include=*.js` break. BSD `sed -i` needs an empty suffix (`sed -i ''`).
  Nested `bash -c "…"` quoting broke repeatedly: write patch scripts to files with a quoted heredoc (`<<'EOF'`).
- **Screenshots.** `node scripts/ui.mjs shot|tree|click` fail on the window check ("found 0" visible
  windows), even though `herdr-app shot file.png` writes the file. Use `herdr-app shot`, then crop with
  `sips -c <height> <width> --cropOffset <y> <x> in.png --out out.png` (offsets are y then x). A
  screenshot shown at a smaller size must be multiplied by the scale factor to get original coordinates
  (2786 by 1878 original, shown at 2327 wide: ×1.2).
- **Other agents.** The worktree may have another Claude session in it. Check with
  `lsof +D .` and `ps aux | grep -i claude` before editing. Do not touch files another agent is writing.
- **Push and PR.** Ask first, both times.

## Plan

Counts are grep estimates unless a line says otherwise. Start each phase with an exact inventory:
`node scripts/ui.mjs find <term>`, `node scripts/ui.mjs audit`, and a read of the builders.

Native components: `~/.config/herdr-app/gpui-kit.d.ts`, module `gpui-base`, starts at line 20681.
Declarations: Checkbox 20754, Switch 20756, Tabs 20804, Tab 20806, Accordion 20911, Radio 21032,
Toggle 21041, Table 21068, Popover 21160, HoverCard 21169, Popup 21194, Select 21239, Combobox 21247,
Input 21504, v_virtual_list 21364, h_virtual_list 21373.

Four native components have never been used in this repo: Switch, Select, Tabs and Popup. For each one,
do an API spike before any design work: read its typings (controlled state, children, focus, role),
migrate one real consumer, and write the finding into this document under "Findings".
`Button` gives behaviour but no styling, and a native swap changes focus and tab order: check the tab
order before and after.

**A. Buttons, the rest**
- Dialog footers: done in `5fa355d` for handoff copy and start, force-push cancel and force push,
  create-PR cancel and create. `DialogButton` gained `h: null`, `py`, `rounded`, `icon`, `gap` and
  `hoverOpacity`. The confirm dialog is left as its local two-line helper: its green strict golden
  would need a re-record for no behaviour gain (six builders, and the border colour is keyed by id).
- Hand-built `role("button")`: still about 64 call sites (grep, excluding shared helper files and tests).
  Largest: `orca-sidebar-projects` (about 18), `orca-files` (5), `orca-status-bar` (4). Not started.
- `orca-ui/shared/agent-config-view.js` is the only source. The two copies, in `mods/orca-agent-flyout/`
  and `mods/orca-agent-settings/`, are generated: never edit them.

**B. Tooltip**
- Native `.tooltip(text)` is used about 60 times. Keep it.
- About 15 hand-built tip helpers, mostly in agent-config. Replace them with a shared wrapper:
  `.tooltip` for text, `HoverCard` (4 uses today) for rich content. Check `HoverCard` first.

**C. Toggle, Switch, Checkbox, Radio**
- Native: none used. Hand-built `role("switch")`: 4 call sites. Toggle-named builders: about 34,
  and each must be classified as a switch, a checkbox or a pressed toggle before choosing a native
  element. `Switch` has no styling (typings line 20756), so the shared piece is a styled row over it.

**D. Select and Dropdown**
- Native: none used. Hand-built select and picker builders: about 17, mostly agent flyout (model,
  effort, permission) and the provider picker. Start with the flyout. Native `Select` (line 21239) and
  `Combobox` (21247). Check whether a native popup can host the flyout's controls first.

**E. Tabs**
- Native: none used. Tab-named builders: about 53, but most are the terminal tab strip. **The tab strip is
  an exception unless the owner says otherwise:** it has drag, zoom and split behaviour that `Tabs` does
  not offer. The segmented controls (right-sidebar `toolGroup`, settings sub-pages) are candidates.
  `Tabs` keeps the selected index in the script (line 20804 comment).

**F. Input**
- Native already: `Input.new` 13, `InputState` 19, `Textarea` 7 call sites. Find the hand-built text fields
  (not counted yet) and move them. Low risk.

**G. Context menu**
- About 17 menu builders: `orca-context-menu`, `orca-new-menu`, the sidebar options, pane menus.
  Native `Popup` (line 21194) through `openOverlay({ kind: "popup" })`, which the mods already use.
  Shared `MenuRow` and `MenuList`.

**H. List and list item**
- About 102 row builders (grep, broad). `orca-ui/shared/list-viewport.js` exists and about 23 call sites use
  virtual lists or the viewport. Native `v_virtual_list` (line 21364) and `h_virtual_list` (21373).
  This is the largest phase: split it by mod (sidebar-projects, files, changes, agents), one commit each.

**I. Sidebar, header, footer, panel, card**
- Panel: `panelFrame` is in 8 places; the header of each panel is still hand-built. Shared `PanelHeader`.
- Header about 20 builders, footer about 7 (status footer and status bar), sidebar about 15,
  card about 45 (grep is broad: inventory first).

**J. Scroll container**
- Native `overflow_y_scrollbar` is used 14 times. Find the hand-built scroll areas first. Low priority.

**K. Loading, empty and error states**
- No shared `StateView` yet. Each mod writes its own text. Count with a narrower grep first (the
  word "error" matches too much). **Decision needed:** in scope or not.

**L. Miscellaneous**
- Layout primitives `h_flex` and `v_flex` are native and stay as they are.
- Fix the window check in `scripts/ui.mjs` (`tree`, `click`, `shot`). Correct the AGENTS.md claim that
  they work while the Mac is locked, once that is verified.
- `sharedAsset` in `mods/orca-sidebar-top/main.js` is dead code (it was dead at HEAD before this work).
- Lint: `orca-ui/shared/agent-config-view.js` has complexity and nested-ternary warnings.

**Order and decisions.** Do A first (it is the smallest). Then C or D, once the owner has decided which.
Do not start K or L until the owner says they are in scope. Do not start E's tab strip.

**Definition of done, for every family**
1. An inventory from `ui.mjs find` and `audit`, and a read of each builder.
2. `golden-diff.mjs semantic` and, where order matters, `strict`, against the previous commit.
   Every difference explained, and nothing removed that was not meant to be.
3. `scripts/failing-tests.sh` on the current tree and on the previous commit; `comm -23` must print nothing.
4. An isolated `herdr-app check` for every changed mod, with `check passed` in the output.
5. Live sync for every changed file (`cmp`, modes, `status`, `diff -rq orca-ui`).
6. Guardrails updated to the real values.
7. One commit per family, with the same kind of message as the existing ones.
8. An independent review of the commit's diff, by someone who did not write it.

## Known gaps

- `ui.mjs tree`, `click`, `shot` fail on the window check. AGENTS.md says the live commands work while
  locked; that is not verified.
- Dialogs are not visually verified: the changes discard and create-PR dialogs, the handoff dialog,
  close-dialog and the tasks buttons were checked by tests and semantic diffs only. Opening them needs the
  owner's session.
- Multi-button builders: when a label is a variable (for example `close-confirm`), the index reports it
  empty. Only literal labels are read.
- Goldens that are stale at baseline (they fail before any of this work): `orca-changes`
  (`main.golden.test.js`, digests missing for `renders/clean` and others), `orca-header`,
  `orca-pane-header`, `orca-float-workspace`. Do not re-record them silently. Their failing keys are in the
  list below.
- The titlebar buttons show a pointer cursor now (owner decision: keep).
- The pane title close button has the id `ph-x-title-<pane>`, a template, so `ui.mjs where` does not find it
  by a literal id. The other pane ids are templates too.

## Findings

Add one dated entry per finding: what was tried, the exact result, and the file it changed. A native API
finding (Switch, Select, Tabs, Popup) goes here too.

### 2026-11-27 — Dialog footers, first part of A

- `DialogButton` (`orca-ui/shared/dialog-button.js`) gained `icon` + `gap`, `py`, `rounded`,
  `h: null` and `hoverOpacity`. Its default call order is unchanged for the header and tasks copies:
  the 71-case header dump is identical in both `semantic` and `strict` mode.
- Migrated the handoff copy/start pair (`mods/orca-handoff/main.js`) and the changes force-push and
  create-PR pairs (`mods/orca-changes/main.js`). Handoff gained a generated `dialog-button.js` copy;
  its golden test now loads that file, as the changes test already did.
- Handoff diff: `semantic --noid` has 0 base-only and 7 now-only calls (`flex_none`, `border_1`,
  `role("button")`, four dynamic label values). The strict first difference is call order inside
  `btn-copy-prompt` (`h` before `px`), which layout ignores. The 50 of 70 differing strict cases are
  all this same footer.
- Changes diff: `semantic --noid` shows the two force-push ids and `Force Push`; strict first difference
  is the new id before `h`. The create-PR footer has no golden flow (its flows record actions, not the
  footer), so it is covered by the host check and a read, not a diff.
- Confirm was left local: its strict golden is green, and a shared box would change `h_flex` to `div`,
  add role/label/flex calls and force a re-record for no behaviour gain.
- Failing names: 34 on the working tree and 34 on the `2679403` worktree, no name added or removed.
- Host checks passed for orca-handoff, orca-changes, orca-header and orca-tasks. Live sync: 9 files,
  `errors []`, `diff -rq orca-ui` empty.
- Independent review is still open: no second reviewer was available. I re-read the diff, but that is
  not the independent review item 8 asks for.

## Baseline: the 34 pre-existing failing tests

Each file was run alone (`scripts/failing-tests.sh`) at commit `2679403`. The list is the same as the
whole-suite run at the start of this branch (34 failures, 927 of 961 passing). Use it as the comparison base.

- `mods/orca-changes/main.golden.test.js`
  - main.js behaves as recorded: renders, handlers and flows

- `mods/orca-context-menu/menu.flow.test.js`
  - context rows keep command-specific icons and separators

- `mods/orca-context-menu/menu.golden.test.js`
  - every menu records as before

- `mods/orca-float-workspace/golden.test.js`
  - golden render of the floating workspace

- `mods/orca-handoff/main.golden.test.js`
  - handoff dialog behaves as recorded: renders, handlers and flows

- `mods/orca-header/agent-settings-route.test.js`
  - settings renders one narrowing motion and restores from the saved width after a reload

- `mods/orca-header/golden.test.js`
  - golden render and commands over the state matrix

- `mods/orca-header/interactions.flow.test.js`
  - a pane dragged out of a split becomes its own tab once it has been parked
  - a press that travels down over its own tab hands over and the tab stops reacting
  - a render with an idle layout resets the terminal width once
  - a split drop parks the terminal, keeps it beside the active tab and swaps it for left and up
  - a tab press, move and release reorders along the strip and selects on a plain click
  - a tab's hover, middle click, right click, close and collapse buttons act on that tab
  - the header's buttons act on the sidebar, the panel, the new-tab menu and the window

- `mods/orca-landing/golden.test.js`
  - golden render of the landing page

- `mods/orca-pane-header/golden.test.js`
  - golden render over the pane header and popup states

- `mods/orca-sidebar-projects/card-agents.test.js`
  - a lone agent is a collapsed list; other tabs are only counted, never listed
  - collapsed cards bound work by visible icons, even for large agent groups
  - collapsed clusters choose the first three valid icons and skip agents without icons
  - expanded list shows every agent row with a singular or plural label
  - mixed-state summary keeps state order, bounds each icon cluster, and counts hidden states without filtering mine
  - prototype property names use the ordinary agent icon fallback

- `mods/orca-sidebar-projects/left-sidebar-agents.test.js`
  - Global uses robot and gear, and FreeBuff keeps its brand icon

- `mods/orca-sidebar-projects/render.test.js`
  - card renders as recorded
  - the header, machine, status, badge and body views render as recorded

- `mods/orca-sidebar-projects/retained-row.test.js`
  - mods/orca-sidebar-projects/retained-row.test.js

- `mods/orca-sidebar-projects/storage.test.js`
  - stored reads and workspace options invalidate when another mod writes

- `mods/orca-split-menu/menu.golden.test.js`
  - every layout records as before

- `mods/orca-status-bar/status-flow.test.js`
  - refresh command, folder watch and timers use the callback context

- `mods/orca-status-footer/footer-flow.test.js`
  - the footer offers the model providers and never fades or slides with the left sidebar

- `mods/orca-tasks/tasks-flow.test.js`
  - task page owns every referenced icon and renders without sibling mods

- `scripts/perf-spaces-virtual.test.js`
  - scripts/perf-spaces-virtual.test.js

- `scripts/shared-agent-flyout.test.mjs`
  - defaultValues: checklists start empty, selects and editors at their default, models and effort unset

- `scripts/shared-config-assets.test.mjs`
  - visual assets have one canonical config path and a consumer manifest
