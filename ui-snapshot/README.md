# Main UI Snapshot observer

`main` is the source of truth for the workflows, observer and tests. Pull requests into `ci/main` run the native UI E2E workflow (`.github/workflows/native-ui-e2e.yml`), which validates the verified CI delivery in a real Herdr app. Ordinary PRs into `main` run only the CI logic checks.

## Run

For a local macOS run, explicitly opt in to controlling the foreground desktop:

```sh
python3 ui-snapshot/capture.py --target . --out /tmp/herdr-ui-snapshot --local
```

The observer uses a temporary HOME, app configuration, Git configuration and unique core session. It opens and focuses its own Herdr window, sends real input, and stops if that window loses focus. Keep the desktop unlocked during the run. After a fixture paste it restores the clipboard if another process has not changed it; an interrupted paste can leave fixture text there. The report records failures and incomplete observations; a local pass does not replace the macOS CI run.

PRs into `ci/main` run the complete custom UI scenario inventory. The runner uploads PNGs, a manifest and browser-ready gallery; no generated files are committed to a branch.

Open or update a PR targeting `ci/main`. Native capture runs only for PRs into `ci/main`; no manual dispatch, schedule, main push or ordinary PR triggers it.

Open the browser-gallery artifact from the Full CI PR run and open index.html. The full-process-ui-snapshot artifact retains original PNGs. Every attempted operation has an ordered before/after PNG (or diagnostic on failure), command or AX label, native status, and image metadata/hash in manifest.json. The report identifies candidate and observer SHAs and upstream app/core versions. Actual native AXPress attempts are distinguished from command-driven navigation; these are not physical mouse clicks, and blocked AX permissions/ambiguous labels are reported as incomplete coverage rather than fabricated successes. GUI runner failure is also reported. This is an observational suite, not a guarantee of visual correctness.

Scope: repository-owned mod interactions only. Upstream terminal, pane and layout commands are fixture setup; no native startup screenshots are saved or published. scenarios.py lists individual controls, expected popups and mod ownership. AXPress is preferred, with guarded mouse fallback calibrated from real CI screenshots where possible. Unsupported interactions fail explicitly. A visible change alone is not semantic correctness. Each popup's closed image is produced by actual Escape key input and checked for a visible change. Coverage reports observed and unobserved repository mods; it is not exhaustive.

## Startup fixture

The runner seeds Herdr's own `shared.json` with `frame.welcomed: true` and the Orca layout, as previously demonstrated by the native isolated probe recorded on main. Release notes are marked presented for the detected app version; a remaining startup overlay gets one bounded relaunch. The capture fails if the configured native window remains obstructed. No coordinate guesses, no product source changes.

## Deployment evidence and popup hygiene

Onboarding is seeded before native launch; no native default/startup screenshots are exported. The observer exits, restores the exact tracked candidate files, applies the proven onboarding state, and relaunches. Every tracked layout, mod, theme and configuration file is checked by SHA-256 after native launch; the artifact includes deployment.json. The configured UI must be Orca without any blocking overlay. Native mod.open is used only for fixture cleanup; tested popups must be opened by actual custom UI interaction. The synthetic tasks fixture disables scheduled agent invocations without changing tracked product files. Toasts are not classified as modal overlays; visual review can still identify them.

## Isolation recovery

Every scenario normalizes its required layout, project and file-search state. A failed click is recorded, then the isolated App is relaunched so subsequent cases are not skipped by the earlier popup. Popup dismissal records actual Escape and outside-click attempts; relaunch is recovery only, never successful dismissal. Calibrated mouse fallback is scoped to the expected 1024x681 foreground window; the two Agents buttons use distinct coordinates. The upstream update toast is dismissed during setup; it is not an observed custom feature. Pointer is parked before evidence capture.

## Deep interaction evidence

The macOS Vision framework reads text from the actual screenshot to locate unique visible controls and check expected content. No external OCR service or synthetic rendering is used. The full scenario set can scroll a specified pane, paste synthetic JSON, and verify persisted fixture values. All intermediate images correspond to actual actions; no startup/stock screenshots. A preview-only dialog is explicitly distinguished from a live agent workflow. No credentials, real providers or external agent runs are used.

Exact duplicate images are linked once in the browser gallery; the full artifact retains the original evidence. Coverage inventory includes every repository mod with explicit dialog-only and passive-panel limitations. The full-process pull request gate verifies the complete native screenshot inventory.
