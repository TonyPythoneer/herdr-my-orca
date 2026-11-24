# Installer check: does first launch with empty temp HOME run `curl releases.herdr.dev | sh`?

## Verdict
**Does not run** (in a controlled launch, 2026-11-24 00:35-00:39, 180 s). The app makes one version-check `curl` to `releases.herdr.dev/app/latest.json`, which exits within 10 s. No `sh`, no installer, no core under the temp HOME.

Run 1's installer claim (`20261123T160823Z-window`) has **no raw evidence** in the artifacts: it appears only in `observations.md` ("Caveats (1)"). Its temp dir was deleted and no process list, app.log line, or curl trace from that moment was saved. Its own `iso-first-launch-and-note/ps-test.txt` shows the core already present in temp HOME at launch (`.local/bin/herdr-core --hc-launchd` and `connect` both started 00:09:57), so run 1 did not start from a clean HOME as its notes state.

## Raw evidence (this run)
- `samples.txt` t=10s: `pid=41839 ppid=36760 start=Tue 24 Nov 00:36:07 2026 cmd=curl -fsSL --max-time 30 https://releases.herdr.dev/app/latest.json`
- `samples.txt` t=20s to t=180s: `(descendants=0 tagged=0)` every sample.
- `tree-180s.txt`: under `T/h` only `.local/bin/herdr-app` (symlink to the app). No herdr-core, no installer, no sh.
- `app.log`: only `error messaging the mach port for IMKCFRunLoopWakeUpReliable`.
- `T/app/installed.json` lists the seeded mods (agents, changes, files, ...), so the app seeded its own home but installed no core.

## Differences between runs
- Env: same `env -i` set in all runs. Run 2 and run 1 scripts added `HC_LAUNCHD_DIRECT=1`; this controlled launch did not (it is the exact env spec). Not the cause: run 2 used it and also got no installer.
- Core presence: run 1's temp HOME already had a core at first launch (ps evidence above); this run's and run 2's did not. The installer is the most likely source, but the claim cannot be confirmed from run 1's artifacts.
- Wait time: run 2 `status` returned "the window did not answer" after ~70 s, which matches a fresh app with no core. Run 2's child check was broken (`ps: Invalid (zero-length) process id`, `CONNECT=` empty), so its "no curl child" is only lsof-based.

## Caveats
- One launch only. An installer triggered later by a user action, or by a different env, was not tested.
- Test core was not started in this launch (no core), so orca-agents credential isolation was not re-checked.

## Live PIDs
- `live-before.txt` and `live-after.txt`: 84630, 86842, 86847, 90861 unchanged (same lstart). Own app PID 36760 killed (TERM, exited), no descendants, `$T` (hp.fU79) deleted.
