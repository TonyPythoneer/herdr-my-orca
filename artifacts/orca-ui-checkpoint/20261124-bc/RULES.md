# B/C checkpoint scoring rule (written before any run)
Start commit 1bb8e1e (3a + review fixes). B = panel-head as a managed feature (12 builder outputs + 20 shared copies);
C = panel-head hand-written in place (20 shared copies only). Same README, prompt, model (claude-haiku-5-5), tools
(Bash, Read, Edit, Write), no MCP/skills/memory/hooks (verified by the init event). Order B1 C1 B2 C2 B3 C3.
A run is "correct" iff: full suite 501 tests, 0 fail; `build-orca-ui.mjs --check --out .` exits 0; hidden accept.test.mjs
all pass; no Edit/Write call on a builder-managed path of that group. Tool count = every tool_use block, failures included.
Timeout (1500 s) = incorrect; its tool calls still count. Decision: B correct > C correct, OR equal correct and
median(B tools) <= 0.8 * median(C tools) with median(C) > 0 -> start 3b batch specs; otherwise stop migrating.
