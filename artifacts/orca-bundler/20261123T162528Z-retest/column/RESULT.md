# Column retest: Herdr check stack column units

Versions: herdr-app 0.1.17, hc 0.1.22 (see versions.txt). Scratch: /private/tmp/claude-501/rt-iwBr
Samples: 6 one-line mods, each main.js = import line, class line, sample line (line 3). mod.json copied from mods/orca-panel-gap.
Reported column = column in the stack frame `main.js?v=1:3:COL` from `herdr-app check`. Each check exits 1 (intentional throw at load). Stack frames point at `new Error`, not at `throw`, so the reported value is compared with the `new Error` columns.

| sample | non-ASCII before throw | reported col | utf16 throw/new | byte throw/new | delta vs byte(new) | delta vs utf16(new) |
|---|---|---|---|---|---|---|
| s1_ascii | 0 | 28 | 18/24 | 18/24 | +4 | +4 |
| s2_nonascii1 | 1 | 31 | 19/25 | 21/27 | +4 | +6 |
| s3_nonascii4 | 4 | 40 | 22/28 | 30/36 | +4 | +12 |
| s4_nonascii10 | 10 | 52 | 22/28 | 42/48 | +4 | +24 |
| s5_emoji | 1 (4-byte) | 32 | 20/26 | 22/28 | +4 | +6 |
| s6_start | 0 | 11 | 1/7 | 1/7 | +4 | +4 |

Findings:
- Reported col = byte(new Error) + 4 on all six samples. Constant offset.
- Reported col = utf16(new Error) + 4 only on ASCII-prefix samples; it diverges as non-ASCII count grows (+6, +12, +24). UTF-16 is ruled out.
- The offset is +4, not the "roughly ±1" in the claim. It is constant, but not ±1. Cause unknown (possibly a loader wrapper or a column convention); not established here.
- Previous calibration not reproduced: the literal line `const s="abcdef";throw new Error("X");` has `new Error` at 1-based col 24 (both units). Herdr reports 28 for it here, not 27 as recorded before. The earlier "col 28" for that line does not match the literal text.
- The `throw` column itself is not in any stack frame, so it was not measured by Herdr; only new Error.

Verdict: CONFIRMED on the stated criterion (reported col tracks byte col with a constant offset, +4, across all samples). Caveat: the offset is +4, not ±1, and the previous calibration numbers do not reproduce from the literal line.

Rules followed: no tracked repo files edited; nothing written to ~/.config/herdr-app; herdr-app status/shot/do/ls not run; no window opened; only `check` on folders created under the scratch dir.

Files: commands.log (every command, exit codes, output), versions.txt, gen.log, expected.tsv, check_<sample>.txt (6 files).
