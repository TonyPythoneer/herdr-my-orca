# CI: main with full process

All PR targets run change-aware logical validation. Only PRs targeting `ci/main-with-full-process` run Git and workspace microbenchmarks, native mod checks, full native page benchmark, 100-interaction retention on both routes, and complete native UI capture. No heavyweight jobs run on main pushes or manual dispatches. Snapshot artifacts are read-only candidate evidence, not commits.

Create the full-process branch from the same main history, keep it synchronized with main, and open a PR with the desired candidate changes targeting it. Do not merge generated artifacts into main. The previous protected snapshot branch remains historical; its reusable workflow skips runs after migration.

Repository administrator: add a branch ruleset targeting `refs/heads/ci/main-with-full-process` with deletion and non-fast-forward protections. After a successful full-process PR, optionally require stable checks Tests and config validation, Herdr native mod check (isolated), AI benchmark feedback, Full retention checks, and the reusable snapshot check (copy the exact check label from the PR). Do not impose those heavyweight checks on main. The GitHub connector cannot write rulesets.
