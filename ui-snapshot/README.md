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

Scope: repository-owned mod interactions only. Upstream terminal, pane and layout commands are fixture setup; no native startup screenshots are saved or published. scenarios.py lists individual controls, expected popups and mod ownership. AXPress is preferred, with guarded mouse fallback calibrated from real CI screenshots where possible. Unsupported interactions fail explicitly. A visible change alone is not semantic correctness. Each popup's closed image is fixture cleanup. Coverage reports observed and unobserved repository mods; it is not exhaustive.

## Startup fixture
The runner seeds Herdr's own `shared.json` with `frame.welcomed: true` and the Orca layout, as previously demonstrated by the native isolated probe recorded on main. Release notes are marked presented for the detected app version; a remaining startup overlay gets one bounded relaunch. The capture fails if the configured native window remains obstructed. No coordinate guesses, no product source changes.

## Deployment evidence and popup hygiene
Onboarding is seeded before native launch; no native default/startup screenshots are exported. The observer exits, restores the exact tracked main files, applies the proven onboarding state, and relaunches. Every tracked layout, mod, theme and configuration file is checked by SHA-256 after native launch; the artifact includes deployment.json. The configured UI must be Orca without any blocking overlay. Native mod.open is used only for fixture cleanup; tested popups must be opened by actual custom UI interaction. The synthetic tasks fixture disables scheduled agent invocations without changing tracked product files. Toasts are not classified as modal overlays; visual review can still identify them.
