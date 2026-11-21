# Plan: unify the Orca mods

Goal: the repo holds only our own mods, the duplicated helper code has one source,
and the big mods are split into readable files. Herdr loads each mod from its own
folder, so nothing here may import across folders (verified: `herdr-app check` rejects
`../shared/x.js` and a symlinked shared dir).

## Facts that shape the plan
- 11 repo mods are Herdr-shipped (`confirm help machine-add menu new-menu peek picker
  prompt toast workspace-chrome worktree`). Herdr supplies them; editing them makes
  Herdr move the file to `<name>-edited`. Their source is compiled into the binary, so
  the unedited copy in `~/.config/herdr-app/mods/` is the reference.
- The orca layout opens only `orca-*` mods, except `orca-files` -> `confirm` and
  `orca-nav` -> `picker`. `orca-files` passes a `confirmShared` prop that the stock
  `confirm` ignores, so that flow is broken in live today.
- Mods may share asset paths (`mods/<other>/x.svg`) but not JS.

## Phase 1: repo holds only our mods
- Clone the customised `confirm` as `orca-confirm`; point `orca-files` at it.
- Remove the 11 shipped mods from the repo (Herdr keeps providing them live).
- Live: add `orca-confirm`, update `orca-files`. Never delete live shipped mods.
Done when: tests pass, every repo mod passes `herdr-app check`, `herdr-app status` has
no errors, a screenshot shows the Orca window intact.

## Phase 2: one source for the duplicated helpers (option 1a)
- `shared/<file>.js` is the only place a helper is edited.
- `scripts/sync-shared.mjs` copies it into each mod that uses it, with a header line.
- A test fails if a copy differs from its source. `shared/` is never copied to live.
Done when: the test passes and all copies are identical to their sources.

## Phase 3: split big files inside their own folder
- Only pure logic moves out, each piece with its own test, like `orca-files`.
- One mod per PR: `orca-agent-manager`, then `orca-spaces`.
- `orca-tabs` waits: live holds uncommitted close-tabs work that the repo lacks.
- `skillshare` is third-party and is not touched.

## Not doing
- Bundler (option 1b): saves about 3% duplication, costs a build step and the
  edit-live-then-sync workflow.
- Shared SVG de-duplication: little gain, makes mods less self-contained.

## Rules for every phase
- Fresh branch from `origin/main` in `wt-unify-mods`, one PR per phase.
- Follow `herdr-app-dev-sync`: copy only changed files to live, never mirror deletions.
- Verify: `node --test mods scripts`, `herdr-app check` on every mod,
  `herdr-app status`, and `herdr-app shot`.
