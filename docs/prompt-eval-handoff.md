# Handoff: Herdr default Claude prompt (2026-11-20)

Resume after the weekly quota reset (2026-11-21 13:00 Taipei). The 7-day window was at 98% when this was written.

## Goal
The smallest `--append-system-prompt` that gives the intent below with no loss in output quality.
Intent: verify thoroughly inside, deliver only the converged result. One answer, the one or two checks that best prove it, what failed or stays risky, and only decisions a human must make. Self-verification is process, not report content.

## Applied now (Herdr desktop, live and repo)
`DEFAULT_PROMPT` and `.claude.preset.systemPrompt` = config `M4` (51 words):
```
Before finishing, verify the change by running checks on the edge cases that matter for it. Then reply with only: your answer, the one or two checks that best prove it, anything that failed or remains risky, and decisions only a human can make. Leave out the rest of your process.
```
`.claude.preset.outputStyle` = `"default"` (eli5 removed). `agents` unchanged (scout haiku, checker opus, read-only tools).
The old P0 lines (delegate to scout, ask checker, consult the advisor) were dropped: N0 (no prompt) matched P0 on every measured goal, and scout, checker and advisor never fired in 80+ runs. To restore them, append the 48-word P0 text.

## Evidence (interactive TTY runs, sonnet, effort max, advisor none, style default; s2-feature)
| config | words | pass | checks run after last edit | median reply size | $/run |
|---|---|---|---|---|---|
| P0 | 48 | 3/3 | 0 | ~107 | 0.26 |
| M4 | 51 | 3/3 | 2 | ~200 | 0.20 |
| V3 | 163 | 3/3 | 4-5 | 491 | 0.90 |
- V3 failed the intent: its rule "include each edge case and the check that covered it" makes the model report its process, and its fixed edge-case list forces irrelevant checks (a 29-item script, 40 parallel processes for a stateless CLI). It also timed out on 2 of 3 s5-research runs.
- M4 keeps part of V3's depth (2 checks after the edit) at about 40% of V3's reply size and 22% of its cost.
- P0 and N0 ran at effort medium in earlier batches; the P0/N0/V2b numbers on s5 are not comparable to V3 and M4 unless re-run at max.

## What is NOT proven
- M4 was run only on s2-feature (3 runs). s1, s3, s4 regression and s5-research were not run for M4.
- M4 did not find the hidden bug V3 found (a 400-digit input printing `Infinity`). Depth is lower than V3's. Whether that matters is the open quality question.
- "Persuasive" and "deliberate thinking" cannot be measured by script. Judge a few real replies by eye.
- Delegation (scout, checker, advisor) is still untested: no fixture needs it, and the `POS-deleg` positive control ran with the advisor disabled.
- Live install: `herdr-app check` fails on the original mod too (`props().key` in `init`); the failure is pre-existing. The flyout was not confirmed closed when the preset was edited.

## Next steps
1. `cd ~/prompt-eval && ./quota.sh` (needs the 7-day figure low).
2. Regression for M4 at max: `RUNS_DIR=$TMPDIR/pe EFFORT=max ADVISOR=none ./run-tty.sh M4 s1-fix 1` (also s3-cleanup, s4-blocked), then s5-research x3 for M4, P0 and N0 at max for a fair comparison.
3. Optional shorter variants: `M1` (21 words, verify only) and `M3` (27 words). Keep the shortest one that holds M4's depth.
4. If M4 loses depth, try one sentence naming the single most decisive check. Do not bring back a fixed edge-case list.
5. Add a fixture that really needs delegation, then re-test the P0 lines against M4.

Harness lives outside the repo at `~/prompt-eval` (`run-tty.sh`, `report.mjs`, `score.mjs`, `quota.sh`, `configs/`, `results/`; `results-backup-1120/` holds the overwritten earlier TTY rows). Keep `RUNS_DIR` short, and never run two runs at once.
