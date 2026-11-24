# where-error retest

Scratch root: recorded in `S_PATH.txt`; all probe edits are under that fresh temporary directory. The original `mods/` and `shared/` files were not edited.

| probe | truth | Herdr raw frame | where-error output | result |
|---|---|---|---|---|
| L (load) | `mods/orca-panel-gap/main.js:14` | `mods/orca-panel-gap/main.js?v=1:14:11` | `mods/orca-panel-gap/main.js:14:11` | PASS |
| R (render, shared helper) | `shared/panel-motion.js:22` | `mods/orca-panel-gap/panel-motion.js?v=1:22:13` | `shared/panel-motion.js:22:13` | PASS |
| M (migrated feature) | `orca-ui/features/panel/head/main.js:8` (`panel/head`) | `mods/orca-panel-head/main.js?v=1:8:11` | `orca-ui/features/panel/head/main.js:8:11` | PASS |
| no frame | none | none | `no mods/<mod>/<file>:<line> frame found in the input` (exit 1) | PASS |

Columns are 1-based UTF-8 byte positions and point to the `Error` token (L/M: 11; R: 13). Full commands, exit codes and captured output are in `commands.log`; numbered shared helper copy is in `shared-panel-motion-numbered.txt`.
