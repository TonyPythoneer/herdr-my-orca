# Progress: unify the Orca mods

| Phase | Status | PR |
|---|---|---|
| 1. Repo holds only our mods | done | #6 |
| 2. One source for helpers | done | #7 |
| 3. Split big files | agent-manager done; spaces and tabs deferred | #8 |

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
- Phase 3, orca-spaces: not split. Its pure helpers (`stored`, `workspaceOptions`, about 50 lines)
  are cut out of `main.js` by character-offset slicing in `storage.test.js`, and `orca-menu`
  carries its own copy of `stored`; the three tests that evaluate `main.js` also stub its scope.
  Moving them means rewriting those tests for roughly 3% of the file. `card()` (340 lines) reads
  `this` throughout. Worth doing only together with a render test harness.
- Phase 3, orca-tabs: not split (not worth it on its own). The close-tabs feature that lived only in
  live `orca-tabs` (auto `tab.close {confirmed:true}` for tabs whose worktree is gone) was removed
  from live on 2026-11-22; live `orca-tabs` now equals the repo.
- Not done on purpose: option 1b (bundler) and shared SVG de-duplication.

## After the Opus review (second pass)
- Removed `orca-changes/review-store.js` (no importer since an earlier refactor; verified by grep)
  and `orca-pane-status` (referenced nowhere). Live copies are left alone.
- Fixed the README (skillshare is tracked here; "unused mods can be deleted" was unsafe).
- Open, needs the owner: live `layouts/orca.json` was re-wrapped in a row at 23:26 on 2026-11-21,
  which moves `titlebar`/`traffic_lights` off the root (left as is on request); live
  `orca-new-menu/main.js` has inventory-merge and freebuff changes that are in no repo commit.

## Third pass (2026-11-22)
- orca-tabs: `drop-zone.js` (`edgeZone`) and `tab-title.js` (`stripLeadingAgentTitleDecoration`) moved
  out with tests; `main.js` 1127 -> 1092. Live `orca-tabs/main.js` had drifted (toggle margin `mr(10)`,
  x 88 instead of 80), so it was NOT synced: needs the owner to say which side is current.
- orca-spaces: `storage.js` (`stored`, `workspaceOptions`) moved out; `storage.test.js` imports it,
  and the vm-based tests (`retained-row`, `perf-spaces-virtual`) inject the two names. Synced live.
  `orca-menu` keeps its own `stored` copy (its test slices that file).
- Render net: `scripts/gpui-stub-loader.mjs` (node module hooks) turns `gpui-kit`/`gpui-base`/`herdr` into
  recorders, so `render.test.js` in `orca-agent-manager` and `orca-spaces` imports the real `main.js`,
  renders `row`/`editor`/`uninstallSection`/`card` in 22 + 14 states and compares with `render.snap.json`
  (delete the snapshot to re-record after an intended view change).
- orca-agent-manager: `views.js` (`rowView`, `editorView`, `uninstallSectionView`), `main.js` 1536 -> 1148.
  orca-spaces: `cards.js` (`cardView`), `main.js` 1436 -> 1056. The class methods delegate. The snapshot
  caught two slips of the mechanical `this` -> `owner` rewrite (prose containing "this", a bare `stop(this`).
- `orca-menu` keeps its own `stored`: it differs (accepts any object, no array/fallback match), so sharing would change behaviour.
- Tests 228 pass, `herdr-app check` passes for the three mods. Live got orca-spaces and orca-agent-manager.

