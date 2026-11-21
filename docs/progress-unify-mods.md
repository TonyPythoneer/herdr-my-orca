# Progress: unify the Orca mods

| Phase | Status | PR |
|---|---|---|
| 1. Repo holds only our mods | done | #6 |
| 2. One source for helpers | done | #7 |
| 3. Split big files | in progress (agent-manager done) | #8 |

## Log
- Plan written.
- Phase 1: cloned the customised `confirm` as `orca-confirm` and pointed `orca-files` at it
  (stock `confirm` ignored `confirmShared`, so Delete in the file tree could not confirm the
  captured target). Removed the 11 Herdr-shipped mods from the repo; live keeps Herdr's copies.
  Tests 214 pass, every mod checks, status has no errors, screenshot shows the window intact.
  Live got `orca-confirm` and `orca-files/main.js` only; no live deletions.
- Phase 2: `shared/{clip,transcript,review-store}.js` are the only sources; `scripts/sync-shared.mjs`
  copies them into 4 + 2 + 2 mod folders with a header line, `--check` and a test fail on drift
  (verified by editing a copy). `helpers.js` and `remove.js` were only in `orca-worktree` after
  phase 1, so nothing to share. Live got 7 of the 8 copies; live `orca-changes/review-store.js`
  is an older version that lacks the repo's cache cap, left untouched.
- Phase 3, orca-agent-manager: `util.js` (4 pure helpers, with tests) and `parts.js` (5 stateless view
  builders) moved out; `main.js` 1629 -> 1536 lines. Tests 220 pass, check passes, live synced.
  The class's stateful render methods (`row`, `editor`, `uninstallSection`) read `this`, so they
  stay: moving them needs a wider refactor with no test net.
