# Handoff: finishing the mod unification

State on `main` (896d011, pushed): phases 1 and 2 are done, phase 3 is partly done.
Read `plan-unify-mods.md` for the goal and `progress-unify-mods.md` for the log first.
This file is only what is left and what will bite you.

## Ground rules (they cost time when forgotten)
- A mod may import only files inside its own folder. `../x.js` and symlinks fail
  `herdr-app check`. Share by copying (`shared/` + `scripts/sync-shared.mjs`).
  Asset paths such as `mods/<other>/x.svg` are not restricted.
- Work in this worktree, keep it local; ask before pushing or opening a PR.
- Live is `~/.config/herdr-app`. Follow `.agents/skills/herdr-app-dev-sync/SKILL.md`: diff
  before copying, copy only the files you changed with a haiku subagent, never mirror deletions.
- Another agent may be writing in the main checkout. Check with `lsof +D` before touching it.
- Verify every step: `node --test mods scripts`, `herdr-app check <mod>` for each changed mod,
  `herdr-app status` (errors empty), `node scripts/sync-shared.mjs --check`, and a screenshot
  with `herdr-app shot x.png` read back. Quote globs in zsh.

## Not done, in order of value

### 1. `orca-tabs` split (1127 lines) - now unblocked
It was held back because live carried an unreviewed auto-close-tabs feature. That was removed
from live on 2026-11-22, and live `orca-tabs/main.js` equals the repo again, so a split is safe
to sync. Pure candidates: drop-geometry and tab-pane selection helpers (`selectTabPanes`,
`matchUnofficialApp`, `unofficialByTerminal`), each with a test like `tab-panes.test.js`.
Before starting: `diff mods/orca-tabs/main.js ~/.config/herdr-app/mods/orca-tabs/main.js` must be empty.

### 2. `orca-spaces` split (1436 lines)
Why it was skipped: `storage.test.js` slices `main.js` by character offset
(`const _storedCache =` ... `export default class Spaces`) and three tests evaluate `main.js`
with a stubbed scope (`card-agents`, `git-refresh`, `retained-row`). Moving `stored` and
`workspaceOptions` (about 50 lines) means rewriting those tests first: make `storage.test.js`
import a real `storage.js`, add the new names to each fixture scope. `orca-menu` has its own copy
of `stored` (same test slices it): decide whether to share it through `shared/`. `card()` is 340
lines and reads `this` everywhere; leave it unless you add a render test harness.

### 3. `orca-agent-manager` stateful render methods
`row` (about 117 lines), `editor` (about 214), `uninstallSection` (about 90) read `this`. Moving
them means turning them into functions of `(owner, ...)`. There is no render test: `herdr-app
check` only builds the first frame. Add a fake-builder test (see `orca-spaces/card-agents.test.js`)
before moving anything.

## Live leftovers (decisions for the owner; do not delete without asking)
- `~/.config/herdr-app/layouts/main.json`, `terminals.json`, `layouts/.state/win98.json`,
  `*-edited` mod folders, `*.bak*` and `orca.json.orig`. Whether Herdr restores deleted shipped
  mods or layouts has never been tested.
- Live `orca-changes/review-store.js` is an old copy with no importer (the repo deleted its copy).
- `layouts/.state/orca.json` remembers `panel-body: skillshare`. `skillshare` is tracked in the repo
  again (commit 09ae041, not made in these sessions).
- The live `orca.json` was once wrapped in a row by something unknown at 2026-11-21 23:26, which
  brought the system titlebar back. It was restored from the repo. `scripts/layout.test.js` guards
  the repo file only. If it happens again, note what was clicked before touching anything.

## Housekeeping
- `backup/main-before-rebase` is the old local `main` (with three merge commits). Delete it once
  nobody needs it.
- Not planned: a bundler (saves about 3%, breaks edit-live-then-sync) and SVG de-duplication.
