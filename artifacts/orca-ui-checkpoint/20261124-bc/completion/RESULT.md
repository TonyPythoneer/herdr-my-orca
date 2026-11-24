# Completion acceptance (2026-11-24, HEAD ca639c6 for the README runs)

1. Entry matrix: `orca-ui/app.mjs` maps all 24 mods (1 feature, 23 in `inPlace`). `scripts/orca-ui-manifests.test.js` requires each mod
   to be owned once and checks layout mounts (both layouts, pane headers included), keys, tests and next files against the repo.
2. README-only locate runs (claude-haiku-5-5, Read and Bash only, no edits, docs/egm/artifacts removed from the copy):
   - "Contents search key on standard orca": named keys.json layout:orca, panel-views.js (bridge), mods/orca-files/main.js command("search"). 6 tool calls.
   - "native animation of the unified left sidebar only": named mods/orca-tabs/drawer.js and main.js (native clock, toggleSidebarNative),
     layouts/orca-unified.json motion, and the sidebar.openPx publishers and readers. 9 tool calls.
3. Rollback drill: 3a rolled back to f41b70c in a temporary checkout using that commit's builder and sync-shared; rebuilt tree equals the
   commit byte for byte and mode for mode; 482 tests pass; extra live paths to remove: none (`rollback-extra-paths.txt`, empty).
4. Frame-to-source errors: on a staging copy, `herdr-app check` of a throwing shared copy mapped to `orca-ui/shared/panel-motion.js:22:13`.
   `herdr-app check` passed for panel-head and the 13 shared-consumer mods on the staging copy.
Pending a human: clicking through the windows, and a fresh-window check on the live app.
