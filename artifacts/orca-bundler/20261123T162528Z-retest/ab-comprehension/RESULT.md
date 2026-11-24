# A/B/C comprehension test (Haiku 5.5 medium, 2 runs per cell)

Groups: A = main (no orca-ui/); B = plan/orca-ui-package working tree (app.mjs + migrated panel/head + builder);
C = main + groupC-app.mjs (map only, files edited in place). Plan docs removed from all copies.
Start: README.md only. Grading: diff inspection + build --check (B).

| Task | Group | Correct | Tool uses | Seconds |
|---|---|---|---|---|
| T1 ⌘⇧F: focus only, no rerun (target unmigrated mods/orca-files) | A | 2/2 | 23, 19 | 167, 130 |
| | B | 2/2 | 13, 18 | 76, 105 |
| | C | 2/2 | 16, 18 | 119, 141 |
| T2 remove Ports switcher button + ⌘⇧I (target migrated panel/head) | A | 2/2 | 17, 19 | 105, 179 |
| | B | 2/2 (edited orca-ui source, rebuilt, --check clean) | 21, 19 | 101, 129 |
| | C | 2/2 | 30, 23 | 168, 198 |

Confounder: A and C baselines have 16 pre-existing failing tests (fixed only on the branch), so their
agents spent extra steps ruling them out. n=2 per cell; differences are within noise.
