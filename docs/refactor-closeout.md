# Refactor closeout — PR #16

## Acceptance and decisions

| TODO | Disposition |
|---|---|
| 1. CI, re-baseline | Quality and CI previously passed; the measured zero-lint report was promoted without lowering thresholds (896/896 tests, line 95.99%, branch 89.27%, functions 92.02%). The PR checks for its latest HEAD are authoritative. |
| 2. Lint | All 15 residual findings removed; regression tests retained. Timer and benchmark anchors updated together. |
| 3. Native validation | CI now archives the PR tree into an isolated HERDR_APP_HOME and invokes the real upstream herdr-app check on every mod. Run 45355786542, job 138313378166: all 24 passed. Check the latest PR run for subsequent changes. |
| 4. Live sync | Script implemented and tested using an isolated fixture; actual owner's desktop not accessed. |
| 5. Human click-through | Not performed. Native check and Node characterization do not prove visual or interactive parity on the owner's desktop. |
| 6. Ledger | [100-row final ledger](../artifacts/orca-refactor/reports/final-ledger.md), all 100 numbered rows verified present. |
| 7. Bugs | All eight named defects addressed in separate commits with tests; additional prototype-key, stale panel state, missing-folder, tree navigation and overlay props cases addressed. |
| 8. Herdr API candidates | Implemented native knownAgents catalog, live pane CWD, panel-header Button controls, and agent-manager action/provider/refresh Button controls. Reviewed remaining candidates below; no unsupported API calls or speculative behavior replacements. |
| 9. Panel-head ownership | Keep panel-head managed in orca-ui/features/panel/head, as specified by the measured B/C checkpoint. Generated files remain delivery copies; do not reverse the migration without new evidence. |

The B/C experiment had 3/3 correct runs in both groups and equal median tool calls. It explicitly retained panel-head and the shared builder, so there is no new evidence to justify moving panel-head back. This also retains drift checks and error-to-source mapping.

## Upstream API audit

Reference: [Herdr mod guide](https://github.com/herdrdev/herdr-app/blob/2d1464e02ddad5484eaaf9a5b59b594e3930aeba/defaults/AGENTS.md), [herdr.d.ts](https://github.com/herdrdev/herdr-app/blob/2d1464e02ddad5484eaaf9a5b59b594e3930aeba/defaults/herdr.d.ts), and [GPUI shell typings generator](https://github.com/herdrdev/herdr-app/blob/2d1464e02ddad5484eaaf9a5b59b594e3930aeba/vendor/gpui-kit/crates/shell/src/typings.rs). These describe the public JavaScript API, not every internal Rust widget.

| Report / candidate | Decision and boundary |
|---|---|
| changes-wt-handoff: agent catalog | Implemented knownAgents({on}) with installed filtering and configured argv; source-space identity retained; discovery failure has an explicit fallback. |
| status-misc: live terminal cwd | Implemented panes().cwd first, hc get fallback only when unavailable. Git checkout identification still needs Git; no typed git/worktree-status event. |
| shared-head-scripts: panel-head tool and collapse buttons | Migrated to native Button.new with native selected state. Kept the custom colors, sizes, tooltip and command actions; updated only the affected characterization records. |
| agent-manager: button, field, banner | Input and Textarea already use native state/components. The shared action button, provider-add and key-reveal controls, and refresh control now use Button.new with native disabled semantics; characterization tests normalize only the constructor and disabled flag so every previous style/handler remains checked. Compound permission menus and other custom surfaces require their own GUI focus checks. No turnkey Field or Alert/Banner equivalent is exposed for these exact forms. |
| agent-manager: icon downloads, chmod/stat, fresh install checks, realpath/npm root | Native fetch and restricted file IO are not a drop-in for image conversion/validation, permission modes or machine-specific shell probing. knownAgents already supplies catalog data but caches checks and does not expose a force option. Retain guarded shell paths. |
| config-menus: scrollList, viewportHeight, keyboard menus, flyout geometry | Native Scrollbar/scroll primitives already used where suitable. Popup.new can anchor within the same rendered tree; it cannot replace cross-mod openOverlay positioning without changing ownership/lifecycle. Select/Combobox own only part of focus/open semantics; the candidate is not a complete menu implementation. |
| config-menus: persistent shared/store, shortcut labels | shared/setShared and per-mod localStorage are distinct. No documented transactional persistent replacement or display-ready shortcut formatter for the custom grammar. Retain behavior. |
| changes-wt-handoff: confirmation, context menu, worktree picker | Already use native window.open_dialog/openOverlay/Input/Scrollbar. Native Select/Combobox still require caller-owned options, content, active descendant, and keyboard list logic; not equivalent to the existing cross-mod dialogs. |
| changes-wt-handoff: remote home | home() is local only. Keep remote shell and PowerShell fallback. |
| files-diff: popup menus and positioning | Native openOverlay is already used; no cross-mod anchor/placement parameter in OverlaySpec. Same-tree Popup does not replace it. |
| files-diff: directory/file listing and safe edits | fs/promises.readdir is local and its typed Dirent exposes only name/isDirectory, not symlink metadata or remote-machine semantics. The current shell paths support both; readTextFile/writeTextFile do not supply directory-handle mutation protection. No drop-in replacement. |
| files-diff: dismiss self | pane.close exists, but no typed own-pane identity accessor for a mod instance; focused() is not sufficient for an unfocused pane. Retain explicit identity lookup. |
| shared-head-scripts: clipboard and reveal | Context.write_to_clipboard already used; OS/display-server clipboard fallback intentionally covers host synchronization. No equivalent file-manager reveal API. |
| shared-head-scripts: repo status, review persistence, rate-limit reset | No typed repo membership, cross-mod durable transaction or usage-reset API; retain guarded existing implementations. |
| spaces-nav: saved projects, menus, focus, tooltips, machine reconnect, avatars, Git watch | pickFolder, native focus handles, HoverCard and watchFolder already used where supported. No complete native project catalog, reconnect mutation, remote Git event or avatar conversion API. No verified equivalent to T3 focus-visible or rich hover content. |
| status-misc: agent Git cache, runner scheduler | No typed Git cache or app-wide durable scheduler; retain existing state and native timer/command consumer. |
| tabs-pane: debug trace, window buttons, pane drag, panel persistence | Native window commands already used. A generic log would not replace structured benchmark traces; pointer and persistent-state contracts do not offer a complete equivalent. Keep behavior; GUI verification required for drag and focus. |
| skillshare | Progress log describes custom machine, audit, install and synchronization dialogs. Existing native controls retained; no host API for Skillshare's external CLI operations. |

The remaining native UI substitutions are **not marked as implemented**. They require verified equivalence (especially focus, cross-mod overlays and rendering), not merely a similarly named GPUI component. The native mod checker renders each mod once; it does not exercise all dialogs or mouse/keyboard interactions.

## Owner desktop sync

The original pre-refactor commit is preserved on branch backup/pr-16-before-rebase-f85f0a2. If that history is missing locally, fetch the backup branch first.

```sh
git fetch origin backup/pr-16-before-rebase-f85f0a2
python3 scripts/sync-refactor-live.py
# Only when the dry run is clean and the intended checkout is selected:
python3 scripts/sync-refactor-live.py --apply
```

The script compares all changed mod files to the original version and HEAD, reports live-only edits and missing tracked files, skips new test artifacts, refuses symlink paths, lists deletions/renames without mirroring, verifies builder drift before any copies, copies one file at a time, checks bytes and mode, and compares actual Herdr status errors before and after. A conflict stops the whole preflight. No desktop operation has been executed from the remote PR environment.

### Human click-through acceptance

- Both layouts: tab focus, scroll arrows, drag/reorder, side drawer shortcuts Cmd+B / Cmd+Shift+F; verify no terminal reflow flicker.
- Right panel: Files, Changes, Agents, Skillshare; native header tool selection and collapse; keyboard navigation and dark/light appearance.
- New tab, worktree and split dialogs; explicit left/up targets and handoff into the original workspace.
- Tasks and agent manager, including permissions/provider controls and safe file context actions.

Record observed behavior and `herdr-app status` from the actual running desktop before declaring these two items done. Never run native mod check against the live home.

## Evidence

- [Initial all-green PR quality](https://github.com/TonyPythoneer/herdr-my-orca/actions/runs/45353763235)
- [Zero-lint measured quality](https://github.com/TonyPythoneer/herdr-my-orca/actions/runs/45356146984)
- [First all-24 isolated native validation](https://github.com/TonyPythoneer/herdr-my-orca/actions/runs/45355786542)
- Current [PR checks and report](https://github.com/TonyPythoneer/herdr-my-orca/pull/16/checks).
