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

## Not done
- `orca-tabs` split is done in the repo (drop-zone.js, tab-title.js) but not synced: live `main.js`
  differs from the repo (`mr(10)` on the sidebar toggle, x 88 vs 80). Decide which is current, then
  sync `main.js`, `drop-zone.js`, `tab-title.js`. Live also differs in `agent-config/main.js`,
  `orca-agent-manager/state.test.js`, `orca-chrome/main.js`, `orca-pane/crew.js`.
- `orca-spaces` `card()` (340 lines) and `orca-agent-manager` `row`/`editor`/`uninstallSection` read
  `this`; moving them needs a fake-builder render test first (see `orca-spaces/card-agents.test.js`).

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
