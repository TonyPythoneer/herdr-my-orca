# Idea: move the sync header to the LAST line so Herdr error lines equal shared/ lines

Verdict: PASS for the line-number claim (probe). Header move itself is a multi-file change (list below), not applied.

Scratch root: /private/tmp/claude-501/rt-QvSR (S). Repo tracked files were not edited.

## Probe
- Mod copy: S/mods/orca-panel-gap = repo mods/orca-panel-gap, panel-motion.js rebuilt as shared/panel-motion.js + header as last line.
- throw `new Error("ORCA_PROBE_R")` inserted as first statement of panelFrame(inner) in both the scratch shared copy and the mod copy.
- nl -ba on scratch shared copy: throw at line 22 (function header at line 21).
- herdr check S/mods/orca-panel-gap: exit 1, output:
    ORCA_PROBE_R
        at panelFrame (.../mods/orca-panel-gap/panel-motion.js?v=1:22:13)
- 22 == 22 -> PASS.
- First attempt on the folder S (not the mod folder) and one connect attempt failed with "checker job did not connect" (xpcproxy stall). Retry on the mod folder worked. Logged in check-probe.txt.

## Healthy (no throw)
- check S/healthy/mods/orca-panel-gap: "check passed", exit 0. -> PASS.

## Lines that would need to change to move the header to the end (NOT changed)
1. scripts/sync-shared.mjs:20 header() puts header first; copies() line ~24 `header(name) + source` -> `source` (+ ensure trailing newline, then header).
2. scripts/where-error.mjs:30-31 `line > 1 ? at(shared, line - 1) : "header line"` -> `at(shared, line)`; drop the header-line branch; comment on line 30 ("prepends one header line") becomes wrong.
3. scripts/where-error.test.js:6 fixture frame `panel-motion.js?v=1:23:13` -> `:22:13` (expected 22:13 unchanged); test 1 and test 3 expectations stay 22:13.
4. Regenerate all 21 tracked copies via `node scripts/sync-shared.mjs` (header line 1 -> last line):
   clip.js (orca-changes, orca-files, orca-handoff, orca-menu); transcript.js (orca-handoff, orca-menu);
   review-store.js (orca-spaces); codex-provider.js (agent-config, orca-agent-manager);
   agent-flyout.js (agent-config, orca-new-menu); list-viewport.js (agent-config, orca-agent-manager);
   tasks.js (orca-chrome, orca-tasks); panel-motion.js (orca-files, orca-changes, orca-agents, orca-panel-gap, skillshare).
   Without regenerating, scripts/sync-shared.test.mjs "every copy matches" fails.
- No test asserts the header text. scripts/sync-shared.test.mjs only uses stale() and USES.
- scripts/build-orca-ui.mjs: no header or shared/ logic (copies bytes only). No change needed.
- Existing mods/*/panel-motion.test.js import ./panel-motion.js No change needed: grep for "Generated from" and "Edit that file" matches only sync-shared.mjs and the 21 copies.
