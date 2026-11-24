# Main UI Snapshot observer

`main` is the source of truth for the reusable workflow, Python/Swift observer, tests and documentation. `ci/main-ui-snapshot` is the execution and gallery branch, never merge its generated output into main. Its stable launcher calls the reusable workflow from main; both the product configuration and observer scripts are checked out from the same latest main commit for each new run. The native capture job uses a read-only token; only the gallery publisher may write, and only to the CI branch.

## Run
Push an empty commit to ci/main-ui-snapshot:
```sh
git switch ci/main-ui-snapshot
git commit --allow-empty -m "snapshot: observe current main"
git push
```
Or select **Run workflow** in Actions and choose `ci/main-ui-snapshot`. The launcher and reusable jobs both enforce this exact branch; selecting main will skip the snapshot. No schedule, main push or pull-request event triggers native snapshot capture. Re-running old workflow executions may retain their old workflow definition; trigger a fresh run to use the latest workflow.

Open [the latest browser gallery](https://github.com/TonyPythoneer/herdr-my-orca/tree/ci/main-ui-snapshot/ui-snapshot/gallery) directly on GitHub once a run publishes it. For original PNGs, download the main-ui-snapshot artifact and open index.html. Every attempted operation has an ordered before/after PNG (or diagnostic on failure), command or AX label, native status, and image metadata/hash in manifest.json. The report identifies main and observer SHAs and upstream app/core versions. Actual native AXPress attempts are distinguished from command-driven navigation; these are not physical mouse clicks, and blocked AX permissions/ambiguous labels are reported as incomplete coverage rather than fabricated successes. GUI runner failure is also reported. This is an observational suite, not a guarantee of visual correctness.

Scope: both layouts, landing, workspace, tabs, split panes, sidebars, panel views, menus, agent manager, providers, tasks, actual AX navigation. No authenticated agent calls, push/PR creation, real user data, or destructive external operations. Coverage remains incomplete for controls without accessible labels, drag/drop, context menus, agent setup flyouts, file-edit flows and other nested interactions; extend scenarios as main evolves. Native screenshots only; no GPUI stubs.

## Startup fixture
The runner seeds Herdr's own `shared.json` with `frame.welcomed: true` and the Orca layout, as previously demonstrated by the native isolated probe recorded on main. Release notes are marked presented for the detected app version; a remaining startup overlay gets one bounded relaunch. The capture fails if the configured native window remains obstructed. No coordinate guesses, no product source changes.

## Deployment evidence and popup hygiene
The first unseeded launch is captured separately if it has a startup overlay or the default layout. The observer exits, restores the exact tracked main files, applies the proven onboarding state, and relaunches. Every tracked layout, mod, theme and configuration file is checked by SHA-256 after native launch; the artifact includes deployment.json. The configured UI must be Orca without any blocking overlay. Named menus use the native documented mod.open toggle, and expected overlay transitions are asserted. The synthetic tasks fixture disables scheduled agent invocations without changing tracked product files. Toasts are not classified as modal overlays; visual review can still identify them.
