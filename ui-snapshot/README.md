# Main UI Snapshot observer — do not merge

This permanent branch is an observation harness, not a product feature. Each branch push (or a re-run of an existing Actions run) checks out the current main in a separate directory, installs the official macOS Herdr app/core and loads its tracked configuration. It never syncs observer files into main ; it publishes only compressed synthetic screenshot previews to this CI branch. Only the disposable GitHub-hosted runner is supported.

## Run
Push an empty commit to ci/main-ui-snapshot:
```sh
git switch ci/main-ui-snapshot
git commit --allow-empty -m "snapshot: observe current main"
git push
```
Or re-run the existing workflow in Actions. No schedule or workflow_dispatch is assumed: GitHub requires these workflow definitions on the default branch; no default-branch changes are wanted.

Open [the latest browser gallery](gallery/README.md) directly on GitHub once a run publishes it. For original PNGs, download the main-ui-snapshot artifact and open index.html. Every attempted operation has an ordered before/after PNG (or diagnostic on failure), command or AX label, native status, and image metadata/hash in manifest.json. The report identifies main and observer SHAs and upstream app/core versions. Actual native AXPress attempts are distinguished from command-driven navigation; these are not physical mouse clicks, and blocked AX permissions/ambiguous labels are reported as incomplete coverage rather than fabricated successes. GUI runner failure is also reported. This is an observational suite, not a guarantee of visual correctness.

Scope: both layouts, landing, workspace, tabs, split panes, sidebars, panel views, menus, agent manager, providers, tasks, actual AX navigation. No authenticated agent calls, push/PR creation, real user data, or destructive external operations. Coverage remains incomplete for controls without accessible labels, drag/drop, context menus, agent setup flyouts, file-edit flows and other nested interactions; extend scenarios as main evolves. Native screenshots only; no GPUI stubs.

## Startup fixture
The runner seeds Herdr's own `shared.json` with `frame.welcomed: true` and the Orca layout, as previously demonstrated by the native isolated probe recorded on main. Release notes are marked presented for the detected app version; a remaining startup overlay gets one bounded relaunch. The capture fails if the configured native window remains obstructed. No coordinate guesses, no product source changes.
