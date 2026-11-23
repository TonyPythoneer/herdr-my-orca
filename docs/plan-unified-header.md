# Unified header + synced sidebar motion (working notes)

Branch `fix/wt-header-ux-improvement`. Checkpoint to revert to: commit `0ba0499` (joined-tab + strip glide, live already runs it).
Reference video: `~/Downloads/s4pSbu2qb9QTaHlD.mp4`. Motion prototype (user-approved feel): https://claude.ai/artifact/SSbrY7agTk9jsR2RgF9zh4

## What the user wants (decided)

1. The sidebar's own header (`brand`) goes away; one header row spans sidebar + work column and is drawn by `orca-tabs`.
2. Sidebar collapse/expand: ONE progress drives sidebar width, strip position, sidebar-content fade/shift. Interruptible.
3. Active tab is joined to the terminal card (done, commit 0ba0499). First tab flush on the card edge: no left fillet, no corner notch.
4. Sidebar toggle stays at x=75, mr 4 (user-approved, never change). Right panel column is unchanged.
5. 30fps stepped resize was accepted in the prototype, BUT terminal reflow was not part of that test.

## Decisions / constraints

- Layout is nested, new file `layouts/orca-unified.json`; `orca` stays untouched (revert = `layout.switch orca`).
  `body` = row[ column[header, row[sidebar, work-body]], panel ]; keep `float-workspace` on the outermost workspace row.
- `orca-tabs` gates new behaviour on `props().unified`. Old layout behaviour must not change.
- Bar, sidebar and fillets use ONE colour (pick `surface`); sidebar node + orca-nav/orca-spaces/footer backgrounds follow.
- Sidebar `min` must be 0 in the unified layout (default 220 clamps the resize).
- Header must follow the width the LAYOUT reports (`layout()` sidebar px), not its own JS progress: `layout.resize` lands one frame late.
- Motion numbers (copy exactly): drawer cubic-bezier(.32,.72,0,1); duration `(320+120d)*(0.5+0.5d)+60` ms, d = |distance| 0..1 (full = 500ms);
  content opacity `clamp((k-.15)/.85)`, content shift `-(1-k)*28px`, k = px/W. Step 33ms. Default curve drawer (user never picked one).
- First-tab merge is geometric: merge when the active shape's left edge lands on the card's left edge (also the docked overlay copy); slot `pl(0)` then.
  Left flare + card corner opacity = clamp(gap/14).
- Card's rounded top-left corner must be a separate piece (gpui only animates opacity/width/height/left/top). Open question: who can draw it
  (header mod probably cannot paint into the terminal block; else `orca-pane` header; else static radius, tell user).
- `keys.json`: `cmd-b`, `ctrl-shift-b` are bound to `layout.toggle:sidebar` and bypass any animation. Rebind to a mod command only if bindings can be scoped per layout; check first. Only the main orca-tabs instance may act on the command (overlay copies also get nextCommand).
- `herdr-app-dev-sync`: diff before every copy, copy with a haiku subagent, `herdr-app check` each changed mod, `herdr-app status` no errors. `keys.json`/layouts are global live files: diff first.
- Never leave probes live. Never commit AGENTS.md / .agentflow. Do not push or open PRs (local first). Commit only when it is a phase checkpoint the user asked for; user said "write notes and finish all phases", so phase commits are local only.
- Known unmeasured risks: D3 (sidebar content reflow while narrowing), D4 (PTY reflow count / Claude Code flicker during stepped resize). D4 is the go/no-go for phase 3.

## Measured facts (probe, clean run)

- `layout.resize` on sidebar works down to 0 when `min: 0`; call returns at once; `layout()` reports the new px one frame later; cadence 18-30 ms.
- `layout.resize` applies to a HIDDEN node: hide -> resize to 259 -> later show comes back at 259. Expand: resize to 1 while hidden -> show -> step up works.
- Plain hide/show changes the PTY size exactly once each (122 -> 153 -> 122 cols).
- `transition("left")` only animates changes made after the element carried it: fresh element ids per glide (`-g<n>`) were the fix for the old strip glide.
- Screen recording works (`screencapture -v -V 6 f.mov`, then AVFoundation frame extraction in scratchpad `ex2.swift`); Herdr window must be frontmost (`open -a Herdr`) and the main stack must show `main-terminals`.
- Live tests disturb whatever the user is doing in the window (tab/page switches). D4 needs a 1-minute hands-off window.

## Phases

| # | Scope | Status |
|---|---|---|
| 0 | Read-only checks + clone-layout probes (D1 resize-while-hidden, D2 min floor, D3 content reflow, D4 PTY reflow) | D1, D2 done; D3, D4, block-clipping, key scoping open |
| 1 | Static unified header in `orca-unified`, snap collapse; retest drop-to-split, window drag, traffic-light pad, old `orca` | DONE (drop-to-split and window drag not exercised by hand; code paths unchanged: `panelRect` left=sidebar px still right, header block keeps `window_drag`) |
| 2 | First-tab flush merge + card corner piece | todo |
| 3 | Layout-driven synced animation + key rebinding (needs D4 go) | todo |
| 4 | Sliding active-tab indicator + hover pill opacity | todo |

Each phase ends usable and revertible: check, diff, haiku copy, `check`, `status`, then record the result below.

## Log

- 2026-11-23: plan written. Checkpoint 0ba0499. Phase 0 partially done (see above).
- Phase 1: `layouts/orca-unified.json` = orca.json with `brand` removed, `sidebar.min` 0, new `left` column [tabs(header, props unified), under row[sidebar, work-body]]. `orca-tabs` `props().unified`: bar colour `t.chrome`, leftPad ignores sidebar px, toggle always drawn, `unified-gap` spacer keeps the strip on the sidebar's right edge, strip glide off. Verified by screenshot (shown/hidden) and `layout.switch orca` unchanged. Bar is `chrome` not `surface` (right panel head stays `surface`: small tone step at the panel boundary).
