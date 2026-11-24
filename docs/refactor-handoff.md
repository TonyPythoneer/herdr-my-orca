> **Update (2026-11-24):** The original handoff below is historical. See [refactor closeout](refactor-closeout.md) for the current decisions, verified CI evidence, upstream API audit and the two steps that require the owner's running desktop. The original TODO list is kept here as the acceptance contract, not as current status.

# Refactor handoff: state and TODO

Written 2026-11-24 for the next executor (GPT 6.2, high effort). Everything below is on branch
`plan/orca-ui-package` (this PR). Nothing has been synced to the live Herdr config and nobody has clicked
through the windows yet.

## What is done

- **Orca UI package** (plan: [plan-orca-ui-package.md](plan-orca-ui-package.md)): steps 2a, 2b, 3a, the B/C checkpoint (stop migrating; result in
  `artifacts/orca-ui-checkpoint/20261124-bc/RESULT.md`), the in-place map for the other 23 mods in `orca-ui/app.mjs`, the completion acceptance.
- **Repo-wide clean-code refactor** of all 24 mods, the 8 shared helpers, panel-head and the scripts, driven by the 100-item list
  (`artifacts/orca-refactor/tools/principles.md`). Rules every batch followed: no test, no refactor; new tests pass on the old code first;
  no `*.snap.json` change; command names, `shared()` keys, props, layout ids and file names unchanged.
- **Numbers** (`metrics/baseline.json`, regenerate with `node scripts/metrics.mjs --out <dir>`): 884 tests pass, line coverage 95.7 %
  (was about 67 %), eslint findings 697 -> 15, `node scripts/build-orca-ui.mjs --check --out .` clean, 0 snapshot changes.
- **CI** (`.github/workflows/quality.yml`): full tests, coverage, lint and drift check; PR comment; `quality-report` artifact with an AI-readable
  `report.json`. Written and exercised locally only, **never run on GitHub**.
- Who did what: `metrics/WORKERS.md`. Per-batch reports with lint/coverage before and after, the 100-item ledger, kept items, Herdr API
  candidates and bugs found: `artifacts/orca-refactor/reports/*.md`.

## TODO (in this order)

1. **Make the first CI run green.** Watch the `quality` workflow on this PR (`gh run watch`). It runs on `macos-latest` with Node 24 and a
   `herdr-app` stand-in. Fix anything that differs from the local run (paths, Node version, `npx eslint@9` network access). Then re-baseline
   with `node scripts/metrics.mjs --out metrics-out --update-baseline` only if the numbers are better.
2. **Finish the lint gate (15 findings left).**
   - `mods/skillshare/main.js`: nested ternaries at 433, 1585, 1587, 1627, 1668; complexity at `renderSource` (1400), an async arrow (1553),
     `renderProgress` (28, at 1579) and `renderInstall` (1634). Keep the render output byte-identical (golden tests in `mods/skillshare`).
   - `mods/orca-spaces/main.js` 300, 301, 304: three `no-shadow` of `cx` in the `init()` timer. `scripts/perf-spaces.py` and
     `scripts/perf-spaces-virtual.py` replace those exact lines, so change the scripts' anchors and the code together and keep
     `scripts/perf-spaces-virtual.test.js` green. The same anchors pin parts of `renderBody` (kept as is).
3. **Isolated `herdr-app check` of all 24 mods.** `git archive HEAD` into a fresh folder (use `pwd -P`), set its own `HERDR_APP_HOME`, then
   `herdr-app check mods/<mod>` for every mod. Never run `check` on `~/.config/herdr-app`: it runs mod subprocesses with the terminal's
   environment. 14 mods were checked at an earlier commit (all passed); the refactor changed most of them since.
4. **Live sync** (skill `herdr-app-dev-sync`, `.agents/skills/herdr-app-dev-sync/SKILL.md`). For each changed file under `mods/` compare live with
   the **pre-refactor repo version** (`git show 94cdf6f:<path>`). If live differs from that (a live edit, `main.js.orig`, a stale test), stop and list
   it for the owner. Otherwise one `cp` per file, then compare bytes and mode (`stat -f %Lp`). Do not copy test files that live does not have. Do
   not mirror deletions or renames: list them. After syncing, `herdr-app status` must show no new errors.
5. **Human click-through** (cannot be automated here): tab strip and drawer animation with ⌘B in `orca-unified`, ⌘⇧F in `orca`, the right panel
   (Files, Changes, Agents, Skillshare), the new-tab menu and the worktree dialog, Tasks page, agent manager page, file context menu.
6. **Final ledger.** Merge the nine ledgers in `artifacts/orca-refactor/reports/*.md` into one table with a row per item 1-100 (applied with
   `file:function`, or not applicable with a one-line reason). Contradictions are settled in `principles.md` (YAGNI over patterns, no Yoda,
   no formatter pass).
7. **Decide, do not guess, on the bugs the batches found and did not fix** (behavior changes; each needs its own commit and test). Section (e)
   of each report has the full list. The main ones: `orca-split-menu` / `orca-menu` call `pane.swap` without a `pane` argument (swaps the
   focused pane); `mods/orca-files/main.js` ~261 command loop throws `undefined.catch` after some commands, pinned by a golden test;
   `orca-spaces/main.js` ~1196 operator-precedence bug throws when a space has no folder; `orca-nav/main.js` ~189 unguarded `JSON.parse`;
   `orca-spaces/cards.js` ~50 object lookup by app name (`constructor`); `orca-tabs/header-controls.js` ~60 stale `renderCx` in a click handler;
   `orca-tasks/main.js` imports assets from other mods' folders; `orca-status/main.js` ~47 `resetIn` prints `NaNd NaNh` for unparsable times.
8. **Herdr API candidates** (section (d) of each report): use the Herdr API for any UI that it can build, as its own commit with its own test.
9. **Owner decision still open:** put panel-head back to in-place maintenance (codex's architecture review suggests it; the plan keeps it).

## How to run things

```sh
export HOME="$(mktemp -d)" HERDR_APP_HOME="$(mktemp -d)" STUB_LOG="$HOME/stub.log"
export PATH="<dir with a herdr-app stand-in that accepts only 'do orca-status.refresh'>:$PATH"
node --test --test-timeout=60000 mods scripts orca-ui/features      # about 15 s
node scripts/build-orca-ui.mjs --check --out .                      # must print 32 managed files match
npx --yes eslint@9 -c eslint.config.mjs mods scripts orca-ui       # nothing is installed in the repo
node scripts/metrics.mjs --out metrics-out                          # the CI report, locally
```

Gotchas that already cost time:

- Do not add entries to `scripts/gpui-stub-loader.mjs`: tests such as `orca-tabs/golden.test.js` and `orca-float/*.test.js` replace its
  `nextCommand` by string, and an extra entry makes `orca-spaces`'s command loop spin forever. A test that needs `panes`, `focused` or
  `nextCommand` installs them with `registerHooks` (see `mods/orca-diff/pane.flow.test.js`).
- A new `*.test.js` in a mod must be listed in `orca-ui/app.mjs` (`inPlace[].tests`). `node artifacts/orca-refactor/tools/regen-map.mjs <repo root>` rewrites the lists.
- Do not set a temporary `HOME` in the same shell that runs `git commit` (git loses the author identity).
- Generated shared copies under `mods/*/` end with a "Generated from orca-ui/shared/..." line: edit `orca-ui/shared/`, run
  `node scripts/build-orca-ui.mjs --out .`, never edit the copies.
