# Retest: load-time throw -> check exit 1 + ORCA_PROBE_L frame (retest 20261123T162528Z)

Scratch dir: /private/tmp/claude-501/rt-fTWP (scratch copies only; no tracked file edited; ~/.config/herdr-app not touched; no status/shot/do/ls/window).
Versions: herdr-app 0.1.17, hc 0.1.22 (versions.txt).
Source copied: mods/orca-panel-gap (all files) -> $S/mods/orca-panel-gap.
Insertion point: after last import, line 13 (`import { panelFrame } from "./panel-motion.js";`).

| Run | Line | Exit | Frame |
|---|---|---|---|
| Healthy | - | 0 | "check passed" (healthy.txt) |
| A: no indent | 14 | 1 | `at <anonymous> (/private/tmp/claude-501/rt-fTWP/mods/orca-panel-gap/main.js?v=1:14:11)` |
| B: 4-space indent | 14 | 1 | `at <anonymous> (/private/tmp/claude-501/rt-fTWP/variantB/orca-panel-gap/main.js?v=1:14:15)` |

Columns (1-based, from awk index on line 14):
- A: throw=1, new=7, Error=11. Reported 11 = `Error`.
- B: throw=5, new=11, Error=15. Reported 15 = `Error`.

Verdict vs claim:
- Exit 1 and ORCA_PROBE_L printed: CONFIRMED.
- Line number exact (14): CONFIRMED.
- `?v=1` suffix still present: CONFIRMED.
- Column: CHANGED. Reported column is the `Error` identifier, not `throw` or `new`. In the indented case the reported column is 15, not 11, so "col 11" is not a stable value for a throw.
