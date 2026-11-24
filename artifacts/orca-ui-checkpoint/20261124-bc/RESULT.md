# B/C checkpoint result (2026-11-24)

Rule, prompt, hidden test and scripts are in this folder; `RULES.md` was written before any run.
Start commit `1bb8e1e`. Model `claude-haiku-5-5`, tools Bash/Read/Edit/Write, no MCP, skills, memory or hooks
(init event checked). The hidden test failed on both untouched trees (7 of 9) and passed on reference solutions (9 of 9).

| Run | Correct | Tool calls | Seconds | Direct edits to managed files |
|---|---|---|---|---|
| B1 | yes | 25 | 138 | none |
| C1 | yes | 28 | 146 | none |
| B2 | yes | 26 | 151 | none |
| C2 | yes | 26 | 131 | none |
| B3 | yes | 32 | 166 | none |
| C3 | yes | 26 | 126 | none |

B correct 3/3, C correct 3/3. Median tool calls: B 26, C 26. B is not at most 80% of C.
The bash-write candidates the scorer flagged were builder runs and read-only greps (reviewed by hand).

Decision by the plan's rule: stop migrating. Keep panel-head, the shared-JS builder, `app.mjs` and `where-error`; keep the other mods in place
and give them map entries in `app.mjs`. 3b is not started. Limits: one model, n=3 per group, a task that touches one migrated feature.
