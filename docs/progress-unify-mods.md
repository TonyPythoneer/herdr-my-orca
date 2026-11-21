# Progress: unify the Orca mods

| Phase | Status | PR |
|---|---|---|
| 1. Repo holds only our mods | done | #6 |
| 2. One source for helpers | todo | |
| 3. Split big files | todo | |

## Log
- Plan written.
- Phase 1: cloned the customised `confirm` as `orca-confirm` and pointed `orca-files` at it
  (stock `confirm` ignored `confirmShared`, so Delete in the file tree could not confirm the
  captured target). Removed the 11 Herdr-shipped mods from the repo; live keeps Herdr's copies.
  Tests 214 pass, every mod checks, status has no errors, screenshot shows the window intact.
  Live got `orca-confirm` and `orca-files/main.js` only; no live deletions.
