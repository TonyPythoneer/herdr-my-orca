# Herdr App: how JS errors surface (isolated window) — run 20261123T160823Z

Herdr App 0.x at /Users/tonyyang/Applications/Herdr.app, hc 0.1.22. Scratch root was /private/tmp/claude-501/hp.r8j5gU (deleted after the run).

## Isolation proof (hard gate, passed before any window command)
- Launch env was `env -i` + HOME=<tmp>/h, HERDR_APP_HOME=<tmp>/app, HC_SESSION=p, OMP_/PI_CODING_AGENT_DIR=<empty tmp dirs> (tenv.sh). No inherited HC_SCOPE / HC_TERMINAL_*.
- Test app holds `<tmp>/app/herdr-app.sock`; test core (own PID) holds `<tmp>/h/.local/state/herdr-core/p/p.sock` + core.lock + core.log, binary `<tmp>/h/.local/share/herdr-core/...`.
- User's live: app PID 27291 holds `~/.config/herdr-app/herdr-app.sock`; core 84630/90861 hold `~/.local/state/herdr-core/default/...`. Disjoint. See `*/isolation.txt`, `iso-first-launch-and-note/`.
- User PID lists before/after: user-pids-before.txt / user-pids-after.txt. All 24 original PIDs present; one transient PID (47881) appeared in the after list and was gone seconds later (not mine).
- Caveats (honest): (1) first launch found no core under the temp HOME and ran the official installer (curl releases.herdr.dev | sh) into the temp HOME only. (2) The test core is started via launchd (HC_LAUNCHD_DIRECT=1 did not prevent that) and its process env shows HOME=/Users/tonyyang, with no OMP_/PI_ vars. Anything the core `exec`s would therefore NOT be credential-isolated. Because of that, orca-agents (which calls exec) was NOT mounted; only orca-panel-gap. (3) A launchd label "dev.herdr.check.*" visible in `launchctl list` belongs to a process that is not mine.
- Layout: one block, orca-panel-gap props.tab="ports" (probe-layout.json); shared.json = {"layout":"probe","frame.welcomed":true}. Each probe = fresh app launch (killed by recorded PID); core reused.

## Results
| Probe | True source (nl -ba) | `herdr-app check` | live `status` errors | window |
|---|---|---|---|---|
| Baseline | - | - | [] | "Ports" + plug icon + body (00-baseline/shot.png) |
| L load | panel-gap/main.js:14 `throw new Error("ORCA_PROBE_L");` (Error at col 11) | exit 1: `ORCA_PROBE_L\n at <anonymous> (<abs>/mods/orca-panel-gap/main.js?v=1:14:11)` | `"mod orca-panel-gap: ORCA_PROBE_L\n    at <anonymous> (<abs>/main.js?v=1:14:11)"` | full-window red text "orca-panel-gap did not load:" + same message/stack |
| R render | panel-gap/panel-motion.js:23 (copy; `throw` col 3, Error col 13). shared/panel-motion.js equivalent line is 22: header offset +1 confirmed (function decl copy:22 vs shared:21) | exit 1: `at panelFrame (<abs>/panel-motion.js?v=1:23:13)\n at render (<abs>/main.js?v=1:40:37)` | `errors: []` — NOTHING | card "This view could not be rendered" with the same 2-frame stack + "Copy details" button |
| E click | panel-gap/main.js:49 (Ports title `.on_click`) | exit 0 (not triggered at load/render) | [] | normal (30-E/shot.png) |
| E click triggered | - | - | - | BLOCKED |

Classification: L = exact file+line+col (file is the deployed copy, not source of truth; stack frame function is `<anonymous>`). R = exact file+line+col for both frames, native function names, but points at the deployed copy (line 23), 1 higher than shared/panel-motion.js (22); render-time errors appear only in check output and in the in-window error card, NOT in `status` (status is empty). E = BLOCKED.

E blocker: `herdr-app commands` (77 commands, logs/commands.json) has no command that clicks or activates a mod element (only terminal.right_click, a routing setting for terminal programs). Clicking would require desktop automation, which is forbidden. Click-time error reporting therefore remains UNTESTED. Do not infer it from L/R.

## Notes for the bundler plan
- Host reports raw runtime coords `path?v=1:line:col`, not source-mapped. Stack gives real function names, so unminified output is far more debuggable than minified. Whether source maps help was not testable here (no bundled artifact was loaded).
- Detect render errors via `check` or `shot`, not `status`.

## Files
probe patches `*/probe.patch`, `*/truth.txt`, `*/check.out`, `*/status.txt`, `*/shot.png`, `*/isolation.txt`, `*/env-app.txt`, scripts `tenv.sh launch.sh probe.sh mypids.sh`, healthy copies `main.js.healthy panel-motion.js.healthy`, `test-core.log`.
