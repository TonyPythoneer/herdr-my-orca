# map-ext retest: external source map

Verdict: **CONFIRMED** (per the rule: frame points to main.js line 5 in both runs, not orig.js:42).

Versions: herdr-app 0.1.17, hc 0.1.22 (versions.txt).
Scratch dir: /private/tmp/claude-501/rt-IFDF (probe folder: /private/tmp/claude-501/rt-IFDF/mods/probe-ext). Herdr.app binary used directly; no status/shot/do/ls, no window, nothing written to ~/.config/herdr-app.

## Runs
| Run | Map file | Command exit | Frame (exact) |
|---|---|---|---|
| 1 | main.js.map present | 1 | `    at <anonymous> (/private/tmp/claude-501/rt-IFDF/mods/probe-ext/main.js?v=1:5:11)` |
| 2 (control) | main.js.map removed | 1 | `    at <anonymous> (/private/tmp/claude-501/rt-IFDF/mods/probe-ext/main.js?v=1:5:11)` |

Both runs also printed: `ORCA_PROBE_EXT` and `check failed: /private/tmp/claude-501/rt-IFDF/mods/probe-ext`.

Files: run1-with-map.txt, run2-control-no-map.txt, control-setup.txt, probe-folder-listing-after-runs.txt, versions.txt, main.js.input, main.js.map.input, probe-ext-with-map-input/ (copy of the probe folder as created).

## Notes
- Frame column is 5:11 (the `Error` token of line 5), i.e. generated coordinates, identical with and without the map. The external map had no observable effect.
- Herdr `check` writes gpui-kit.d.ts and jsconfig.json into the probe folder (seen in control setup listing); these are Herdr-generated, not from my input.
- Exit code 1 in both runs is the expected result of the probe's deliberate throw.
