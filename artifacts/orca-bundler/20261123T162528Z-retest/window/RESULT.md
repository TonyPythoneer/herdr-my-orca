# Herdr App window retest (isolated) — 20261123T162528Z

Previous run: `artifacts/orca-bundler/20261123T160823Z-window/`. Temp dir (hp.VJUo) deleted after the run.

## Results

| Claim | Previous | Now | Verdict |
|---|---|---|---|
| 1. First launch with no core in temp HOME runs the official installer (`curl releases.herdr.dev \| sh`) | Yes (app ran installer into temp HOME) | No. App launched, window socket up, no curl/installer child, no core created; `status` said "the window did not answer" for ~70 s. Seeded app home (mods, frame, AGENTS.md) but nothing under h/.local except the herdr-app symlink. | CHANGED |
| 2. Test core env: HOME and OMP_/PI_ | Core HOME=/Users/tonyyang, no OMP_/PI_ | Same: core HOME=/Users/tonyyang (launchd), no OMP_/PI_. App HOME=temp h. | CONFIRMED |
| 3. Baseline: errors [] and shot shows "Ports" | errors [], shows Ports | errors [], shows Ports (03-baseline). The first baseline (02) was covered by a "What's new in Herdr" overlay; relaunch cleared it. | CONFIRMED (with overlay caveat) |
| 4. L probe: errors non-empty; shot red text | errors non-empty `ORCA_PROBE_L`; red "orca-panel-gap did not load:" | errors non-empty, same message and stack (`main.js?v=1:14:11`); red text shown | CONFIRMED |
| 5. R probe: errors EMPTY; shot shows "could not be rendered" card | errors []; card with `panelFrame` + `render` frames | errors []; card "This view could not be rendered" with `panelFrame (panel-motion.js?v=1:23:13)` and `render (main.js?v=1:40:37)`; `check` exit 1 with the same frames | CONFIRMED |
| 6. Command list unchanged, no new click/activate command | 77 commands | 77 commands, byte-identical to logs/commands-previous.json. Nearest to activation: `mod.open` ("toggle a mod as the overlay its mod.json describes") — opens an overlay, does not click a mod element. Still no click command. | CONFIRMED |

Also: `overlay.close` (default and `--id frame-whatsnew`) returned ok but did NOT close the what's-new overlay in the first instance; the overlay did not come back after relaunch (update-notes.json recorded `presented: ["0.1.17"]`).

## Isolation proof
- App (10725, later 13982/15421/16600) listed `/private/tmp/claude-501/hp.VJUo/app/herdr-app.sock`; core connect/core (10731/10737; 13994; 15441/15447; 16606/16612) listed `.../hp.VJUo/h/.local/state/herdr-core/p/p.sock` and `core.lock`/`core.log` under the temp dir.
- Core binary is a COPY of the user's active core placed in temp HOME (`cp -Rp` from `~/.local/share/herdr-core/active`); the user's install was only read, never written.
- Each probe ran `lsof` before any status/shot/do command (02-baseline/isolation.txt, 03-baseline/isolation.txt, etc.).
- Live PIDs 86842, 86847, 84630, 90861: `ps -o pid,lstart,command` identical before and after (same PIDs and start times). Live socket `~/.config/herdr-app/herdr-app.sock` was never touched by test commands.
- No test processes left (`ps` grep for hp.VJUo: none). Temp dir deleted.

## Caveats
- Core copied from the user's install (not the installer), to avoid the network install path. Same version (hc 0.1.22).
- Test core still started through launchd with real HOME (Q2): launchd-started core is not credential-isolated; orca-agents still not mounted.
- Mod copy was the repo `mods/orca-panel-gap` (identical, verified by diff -r). Probe edits applied with the saved patches to the temp copy, then restored from the repo copy before the next probe.
- Click-time errors (E) remain UNTESTED: no command clicks a mod element.
- `herdr-app check` for the R probe was run via tenv only.

## Files
- Scripts: tenv.sh, launch.sh, probe.sh, mypids.sh, run.env (paths updated to this run)
- Probes: 01-first-launch/, 02-baseline/, 03-baseline/, 04-L/, 05-R/ (app.log, status.txt, shot.png, isolation.txt, env files, check.out)
- Patches: L-probe.patch, R-probe.patch; healthy copies main.js.healthy, panel-motion.js.healthy
- Commands: logs/commands-previous.json, logs/commands-now.txt
- Live PIDs: live-before.txt, live-after.txt, live-tree-before.txt
