# herdr-my-orca

My [Herdr](https://herdr.dev) config: an Orca-style window built from Herdr's layouts and mods.

- **Orca**: the `orca` layout (`layouts/orca.json`) and the `orca-*` mods are a re-creation of Orca's UI in Herdr.
- **Names**: [docs/naming.md](docs/naming.md) maps what you see on screen to mod names, layout node ids and commands.
- **Ports**: the bottom bar's plug button (`orca-status-ports/`) counts the listening ports the open
  spaces own, and opens Orca's Ports popover above it: a `Ports` header with the two counts, one
  section per space that owns a listener (its name, a folder button that goes there, the count),
  the rows with the port, the process and the address, and the collapsed **External ports**
  list. Attribution is Orca's: `lsof` reports each listener's pid, a second `lsof` reports that
  process's folder, and a folder inside a space's checkout (or its panes' live folders) makes it
  that space's port; everything else is external. Rows reveal open-in-browser, copy and, for a
  port one of the spaces owns, Stop. The bar scans every 30 seconds; `herdr-app do orca-status-ports.open`
  opens the popover from a key.
- **Usage**: the bottom bar shows Claude, Codex and opencode usage (`orca-status-bar/`). Claude and
  Codex read what the CLIs already write on this computer; Claude's quota comes live from
  Claude Code's own `rate_limits` statusline feed, with Anthropic's usage API only as the idle
  fallback (its token is read from the macOS Keychain and never written anywhere). Cached in
  `~/.cache/herdr-usage/`.
- **Follow into a worktree**: an agent CLI that takes its own process into a linked git worktree
  (`claude --worktree`, `codex --worktree`, or a `cd` inside the CLI) takes its tab with it: the
  tab moves into that worktree's space, so the sidebar lists it under the branch, and the agent
  keeps running (`terminal.park` → `terminal.keep`, no restart). A space left without tabs gets
  one, a named tab keeps its name, and the window only follows when the moved tab was on screen.
  The watcher is `orca-status-bar/wt-follow.js` in the always-mounted bottom bar: it reads each agent's
  own process folder (`hc get` → `foreground.cwd`) and polls every 3 s.
- **Custom**: `orca-new-menu` (the "Start an agent" menu with the `>` setup flyout), `orca-agent-flyout` (model and effort chooser, cached per CLI version), `orca-header` and `orca-right-sidebar-placeholders` changes.
- **Refresh branches**: the Projects header's Workspace options popup starts with it. It asks
  `orca-sidebar-projects` (`orca-sidebar-projects.refresh`) to re-read every project it knows — open or closed —
  instead of waiting for the 60-second fallback or a filesystem wake: each project's branch and
  its `git worktree list`, so a checkout or worktree changed elsewhere shows up. Rows are still
  worktrees, as in Orca, so a branch with no checkout (say `main` while the main checkout sits on
  a feature branch) has no card; only a space of its own brings one.
- **Checkout branch**: a card's right-click menu has Checkout branch, which lists the repo's local
  branches and runs `git switch` in that checkout. Orca switches from its Source Control panel,
  which this layout does not port, so the dialog ports that picker's rules instead: the current
  branch and a branch another worktree holds are not offered, and a working agent or uncommitted
  changes stop the switch with the reason shown (Git is re-checked on every attempt). The card's
  branch follows the switch, so returning the main checkout to `main` after a merge needs no
  terminal.
- **Agent Settings**: the sidebar's bottom Agents button opens a Settings-style page with separately scrollable Installed and Available to install groups, each showing up to
  5.5 rows. It lists the Agent CLIs Herdr detects,
  turns availability on/off for installed CLIs, and edits each CLI's executable and launch
  arguments. Commands are written to `programs.json`; the on/off choice lives in
  `agent-manager.json`. Refresh re-checks this computer by running a login-shell `command -v`
  probe, because `knownAgents()` caches for a minute and offers no force option.
- **Permissions**: a Permissions card on the same page sets how much every agent may do without
  asking — Ask for approval, Approve for me, Full access, or each agent's own settings — and each
  agent row has its own permission menu beside the command. The choice is stored in
  `agent-manager.json` (`permissions.default` + `permissions.overrides`) and written into
  `programs.json`'s `run` as that agent's flag recipe (`--permission-mode auto`,
  `--dangerously-skip-permissions`, `--approve-for-me`, …), so every launcher honors it. Agents
  that have no permission flag stay on their own settings, and a command that sets unfamiliar
  permission flags shows as Custom and is never rewritten by an all-agents change.
- **Install/uninstall**: Install opens the official guide for the user to follow. Uninstall is
  only automated when the executable belongs to its verified npm-global package; it asks for
  confirmation, refuses while a live session uses it, and never touches settings, sessions or
  command overrides.
- **Start an agent**: the Orca menu shows only installed and enabled official agents. Disabled and
  uninstalled entries are absent, not greyed out. When nothing official and no FreeBuff is
  available it shows one **Open Agent Settings** action. FreeBuff is the only unofficial row and
  appears only when its executable is detected, with an Unofficial divider.

## How the quota bar gets its numbers

Same core as Orca desktop (MIT, Lovecast Inc.), read from its public source:

- **Claude, live.** Claude Code hands its `statusLine` command a JSON payload on every turn;
  that payload includes the 5-hour and weekly `rate_limits` the Messages API returned, so it
  costs no extra request and no usage-endpoint budget. Orca's script forwards it to a local
  server. Herdr has none, so `orca-status-bar/claude-statusline.sh` writes the same windows to
  `~/.cache/herdr-usage/claude-statusline.json` and then runs the status line you already had.
  Every Claude session shares that one file, and each reports from its own last response, so the
  wrapper merges per window — newer `resets_at` wins, and inside one window the larger
  percentage wins — instead of letting the last writer (often a quiet pane still on an old
  number) replace the pane you are watching.
- **Claude, idle fallback.** When no session has changed the windows for 5 minutes, the bar polls
  `api.anthropic.com/api/oauth/usage` (15-minute cache) for the same windows plus per-model
  pools such as Fable.
- **Codex.** Codex appends `token_count`/`rate_limits` to its session JSONL every turn; the bar
  reads the newest session that has them. (Orca gets the same values from `codex app-server`'s
  `account/rateLimits/read`, the chatgpt.com backend, or a hidden `/status` PTY when those fail.)
- **opencode.** Its SQLite database, tokens since the daily reset.

Herdr mods cannot receive a process's output directly, so the push channel is the folder that
process writes into: `watchFolder` wakes the bar the moment Claude, Codex or opencode write
(`main.js`), with a 5-minute timer only as a fallback for a missing folder and the idle OAuth
refresh.

To enable the live Claude feed, point `statusLine` in `~/.claude/settings.json` at the wrapper:

```json
{
  "statusLine": {
    "type": "command",
    "command": "sh ~/.config/herdr-app/mods/orca-status-bar/claude-statusline.sh"
  }
}
```

The wrapper passes the payload on to `$HERDR_STATUSLINE`, then `ccstatusline` from `PATH`, then
`npx -y ccstatusline@latest`, so the status line you see does not change.

## How the repo is organized

- The repo holds only our own mods (`orca-*` and `orca-agent-flyout`). Herdr ships its own mods and layouts (`confirm`,
  `picker`, `main`, `terminals`, …); they stay in the live config and are not tracked here.
- Orca UI starts at [orca-ui/app.mjs](orca-ui/app.mjs): a reading map. `features` lists each
  generated feature, the screen it draws and the files to follow next; `inPlace` lists every other
  mod (edited under `mods/<mod>/`) with its layout nodes, keys, what it opens or shares, tests and
  `next`. A test checks that all 23 mods are covered and that the entries match the repo. A feature is edited in
  `orca-ui/features/<area>/<feature>/` and regenerated with
  `node scripts/build-orca-ui.mjs --out .`. Its `manifest.json` lists every managed output, test,
  layout slot and key section, so the copy under `mods/` is delivery format, not an edit location.
  `node scripts/build-orca-ui.mjs --check --out .` reports drift and undeclared files in a feature's
  mod folder. A build stops, writing nothing, when a copy that differs is newer than its source
  (a likely hand edit, or a fresh `git checkout`); compare, then rerun with `--force` to overwrite.
  Run `--check` before you start editing to find existing drift. Anything no manifest lists is
  still edited in place.
- On a Herdr error (`herdr-app check`, `status`, or the window's Copy details), do not open the
  `mods/` file it names: `herdr-app check mods/<mod> 2>&1 | node scripts/where-error.mjs` prints the
  file and line to edit (a shared copy has the same line numbers as its source in
  [orca-ui/shared/](orca-ui/shared/)), plus the feature, tests, layouts and `next` hint that own it.
- A mod may import only files inside its own folder: `../x.js` and symlinks fail
  `herdr-app check`. Code several mods need lives in [orca-ui/shared/](orca-ui/shared/); its
  `manifest.json` lists the mods each helper is copied into, and the same builder writes the copies
  with a generated-file line as the last line, so error line numbers match the source. `--check`
  (and a test) fails on drift. Edit only the file in `orca-ui/shared/`, never a copy. Asset paths
  such as `mods/<other>/x.svg` may cross folders.
- Big mods are split into pure logic files, each with its own test (for example
  `orca-agent-settings/{util,parts,views}.js`, `orca-sidebar-projects/{storage,cards}.js`,
  `orca-header/{drop-zone,tab-title}.js`). `scripts/gpui-stub-loader.mjs` stubs `gpui-kit`,
  `gpui-base` and `herdr`, so `render.test.js` renders the real `main.js` and compares it with
  `render.snap.json` (delete the snapshot to re-record after an intended view change).
- Live config is `~/.config/herdr-app`; changes are copied file by file, never mirrored
  (see [.agents/skills/herdr-app-dev-sync/SKILL.md](.agents/skills/herdr-app-dev-sync/SKILL.md)).
- Checks: `node --test mods scripts orca-ui/features`, `herdr-app check <mod>`, `herdr-app status`,
  `node scripts/build-orca-ui.mjs --check --out .`. Quality gates: `npx eslint@9 -c eslint.config.mjs mods scripts orca-ui`
  (complexity, nesting, function length, parameters, shadowing; generated files are skipped) and
  `node --test --experimental-test-coverage mods scripts orca-ui/features`.
  CI runs unit/contract and behavior suites separately; the aggregate check requires both.
  The synthetic Git branch-header benchmark (`python3 scripts/benchmark-git-status.py`) reports paired p50/p95 timings, not native UI latency.
- CI runs the full suite: `.github/workflows/quality.yml` runs the tests, coverage, lint and the drift
  check on every pull request and on pushes to `main`, `plan/**` and `refactor/**`. It posts one
  comment on the pull request (updated in place) and uploads `report.json` and `report.md` as the
  `quality-report` artifact; `report.json` has a stable schema (`schemaVersion`) meant for an AI to
  read, with a `nextActions` list for the next improvement step. Agents and local runs only need
  `node --test mods/<mod>` for the mod they touched. `node scripts/metrics.mjs --out <dir>` produces
  the same report locally; `--update-baseline` rewrites `metrics/baseline.json` after a deliberate,
  reviewed improvement. A pull request fails when tests fail, the drift check fails, lint findings
  rise above the baseline, or line coverage drops more than 1 point.
- Not used: a bundler. Measured on two sample mods with Vite+, source maps doubled the output and
  herdr-app 0.1.17 ignores them, so errors would name bundle lines.

## Setup

Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/TonyPythoneer/herdr-my-orca/tree/main

In short: copy `layouts/`, `mods/`, `programs.json`, `keys.json`, `settings.json` and `themes/` into `~/.config/herdr-app/`, then switch to the `orca` layout.

`mods/orca-assets/` is a static, config-relative resource directory, not an installable mod. Copy it before the dependent mods. Shared SVGs are referenced by their canonical path (no runtime copy, symlink or subprocess); immutable shared UI policy is authored in `orca-ui/shared/ui-settings.js` and delivered as generated mod-local modules because Herdr isolates JavaScript imports. Native `shared()`/`setShared()` remains the channel for mutable cross-mod state. Individual consumer mods now need this directory when installed outside the full config. The initial migration covers the refresh icon and spinner timing; identical-looking icons with different bytes are not interchangeable.

## Not included

These are runtime state or files Herdr writes itself, so they are not in this repo:

- `data/`, `view.json`, `shared.json`, `seen.json`, `installed.json`, `window.json`, `agent-config.json` (the model cache)
- `layouts/.state/` (saved clicks), `icons/`, `frame/`, `avatars/`, `telemetry/`
- `AGENTS.md` (Herdr's own documentation), `*.d.ts`, `jsconfig.json`, `*.bak*`

## Things to check before using

- `programs.json` starts Claude and Codex with full-permission flags (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`). Remove them if you want the agents to ask first.
- The `orca` layout expects the `orca-*` mods in this repo. A mod that no layout lists may still be opened by another mod (`openOverlay({ mod: "orca-context-menu" })`, `run("mod.open", ...)`): grep for its name before deleting it.

### Retired Skillshare panel

The Skillshare UI was removed from both layouts and is no longer shipped. For an existing live config, update both layout files and the panel-head mod together, and remove only the obsolete repo-owned `mods/skillshare` directory after checking for local edits. This does not uninstall the external Skillshare CLI or delete any installed skills or their data.

## Page performance benchmark

The native desktop benchmark is intentionally separate from deterministic CI. CI runs the
benchmark harness tests without a GUI. The benchmark itself needs an active desktop session,
`herdr-app`, `hc`, Python 3.10+ and Pillow (install into a disposable virtual environment).
It creates its own app home, core session, and local Git/folder fixtures. It does not use your
real workspace, terminal sessions, agent accounts, or API keys.

```sh
# Inspect coverage without installing anything:
python3 scripts/benchmark-pages.py --plan

# One-time dependency (optional, for native screenshots only):
python3 -m venv /tmp/herdr-bench-venv
/tmp/herdr-bench-venv/bin/pip install Pillow

# Collect candidate reference images. Start with one page, then capture both layouts.
# Keep the display/viewport/zoom and Herdr version identical between runs.
/tmp/herdr-bench-venv/bin/python scripts/benchmark-pages.py --capture \
  --layout orca --page main-agents --output /tmp/herdr-bench-reference
```

Open the reference PNGs, verify the actual requested page and that the expected local data is
loaded (not an error, placeholder, or spinner), and edit `approved.json`: set `approved` to
`true` only for valid images, and adjust the normalized ROI `[left, top, right, bottom]` to
include distinguishing page content but exclude unrelated animated areas and unstable paths.
Do not approve a page redirected by its gating logic. Recollect references when the intended UI,
fixture, screen geometry, theme or upstream version changes.

```sh
/tmp/herdr-bench-venv/bin/python scripts/benchmark-pages.py \
  --references /tmp/herdr-bench-reference --layout orca --page main-agents \
  --samples 30 --output /tmp/herdr-bench-result
```

Omit `--layout` and `--page` to cover all stack children in both layouts (24 route/layout
pairs today). Git and ordinary-folder scenarios are deliberately distinct; SSH-only Ports is
explicitly unmeasured until a disposable SSH fixture is available. Contextual menus, second-level
agent dropdowns, popups, real provider/agent discovery, and keyboard/scroll interactions need
separate context-aware scenarios; they are not silently counted as tested by this route suite.

**Report:** `report.json` contains raw samples, reference-match failures, first observed visit
(not a guaranteed cold cache), warm P50/P95/max, metadata, screenshot overhead and per-page
settled CPU-frame aggregates. `summary.csv` is the AI-review-friendly table, `frames.jsonl`
contains Herdr's upstream per-second counters, and `app.log` contains isolated app diagnostics.
A failed or indistinguishable transition is never converted to zero. No approved successful
measurement exits nonzero. Unmeasured pages are marked separately, not treated as passing.

### Performance budgets and review policy

| Metric | Project target | Measurement contract |
| --- | --- | --- |
| First visible feedback | <=100 ms; investigate >200 ms | CLI dispatch to first distinguishable screenshot change; proxy, may include unrelated changes |
| Warm page transition | P95 <=200 ms; investigate >500 ms | CLI dispatch to approved reference match, including capture overhead |
| Local data ready | P95 <=500 ms; investigate >1000 ms | Reference match only where reviewed ROI proves relevant content is loaded; not a general data-ready event |
| Cold startup | <=1000 ms; investigate >2000 ms | Process launch to first successful screenshot, not proof of fully interactive app |
| 60 Hz frame budget | 16.7 ms | Actual individual frames need native tracing; upstream aggregate CPU-frame mean is diagnostic only |
| Frozen frame | >=700 ms, target zero | Requires individual frame timing; not inferable from per-second aggregates |

References: [NN/g response time](https://www.nngroup.com/articles/powers-of-10-time-scales-in-ux/),
[Google INP](https://web.dev/articles/inp), [Android startup timing](https://developer.android.com/topic/performance/vitals/launch-time),
[Android slow rendering](https://developer.android.com/topic/performance/issues/render),
[Herdr native benchmark](https://github.com/herdrdev/herdr-app/blob/master/scripts/bench.py).

These are engineering targets, not Herdr guarantees or browser Web Vitals. Screenshot timings are
observation upper bounds, not physical click-to-display timing. Do not subtract guessed IPC or
capture overhead. A warning above budget needs confirmation using native traces. For PR regression
review compare the same hardware, app build, layout, viewport, fixture, ROI, sample count and
reference policy; collect at least 30 warm samples, compare P50/P95/max and failure rate, and
repeat suspected regressions. Investigate a repeatable P95 increase of both >20% and >20 ms.
Do not gate merge on noisy hosted-runner wall-clock timings until a representative baseline exists.
No claimed result for GPU presentation, scroll jank, real network/CLI latency, or data not included
in the approved ROI. Use Herdr's frame counter and Instruments/native tracing to diagnose those
separately.


### Diagnose and compare

Run the latency baseline without probes; use a separate diagnostic run for attribution:

```sh
python scripts/benchmark-pages.py --references /tmp/herdr-bench-reference \
  --layout orca --page main-agents --samples 30 --output /tmp/baseline

python scripts/benchmark-pages.py --references /tmp/herdr-bench-reference \
  --layout orca --page main-agents --samples 5 --diagnostic --output /tmp/diagnostic

# After a targeted change, use the exact same fixture, reference and device:
python scripts/benchmark-pages.py --references /tmp/herdr-bench-reference \
  --layout orca --page main-agents --samples 30 --output /tmp/candidate
python scripts/benchmark-compare.py /tmp/baseline/report.json /tmp/candidate/report.json \
  --output /tmp/comparison.json
```

The optional diagnostic run instruments only temporary mod copies, not the tracked source or
your live configuration. It records completed JS init/render and host `exec`, `hc`,
`readTextFile` and `knownAgents` calls, with counts, median, maximum, and elapsed-duration
sums by module and operation. Only whitelisted executable families are named; arguments,
paths, results and exception text are not emitted by these probes. Target-module and
background events are separated. Overlapping calls are **not** additive wall-clock time;
spans crossing a measurement boundary are excluded. Missing events or unsupported exports
are not proof of zero cost. Render duration is JS execution, not native layout or GPU paint.
Check `instrumentation` and the raw app log before trusting a diagnostic report.
Instrumentation and logging can affect performance; never compare instrumented timings
against an ordinary baseline.

`--fixture-files 10`, `100` (default), or `1000` tests file-count scalability; capture matching
references for each size. This is not workspace-count scalability. The comparator checks
reported environment parameters, same page/fixture/from-page, reference SHA-256, ROI, viewport,
30+ warm samples and complete successful metrics. It rejects instrumented/incomplete runs and
reports P50/P95/max, absolute and relative P95 changes, and overhead warnings.
A repeatable increase of both >20 ms and >20% is a regression candidate, not proof of causation.
Use the same physical machine (metadata alone cannot verify that), display and power state.
If the intended visual output changes, establish a new approved baseline rather than comparing
different reference images as though equivalent.

Review order for AI: (1) verify coverage, errors and screenshot overhead; (2) rank slow/changed
pages; (3) use diagnostic spans to identify expensive modules and repeated host calls;
(4) inspect the actual source and confirm unnecessary work before changing it; (5) rerun
functional tests and compare a non-instrumented benchmark. Call counts alone cannot prove
duplicates. Per-frame GPU timing, async critical path tracing, idle CPU/RSS, leak testing,
and contextual interaction scenarios still require native validation or additional probes.


### Idle CPU and retained memory

Each matched page settles for the configured interval, then measures the app process's
CPU-time delta and resident memory over `--idle-seconds 10` (default; minimum 3).
100% means one CPU core, not the entire machine. This excludes herdr-core, spawned
terminals and other processes. The report also records RSS after successful visits;
with at least six observations it compares the median of the first and last three.
Growth above both 16 MiB and 10% is a diagnostic candidate, not a proven leak:
allocator retention, caches, other mods and normal warming can increase RSS.
Repeat the same route on the same device and inspect trends before modifying code.
Raw observations and before/after differences are preserved; a missing observation is
not zero. Do not gate PRs on hosted-runner CPU or memory thresholds.

The separate **Native benchmark smoke** workflow runs on relevant same-repository PRs
and supports manual dispatch. It installs the current official Herdr release on
macOS ARM64 and attempts two real native reference captures with resource sampling,
uploading the screenshots and logs even on failure. The workflow checks that the
images differ, not that the intended content is fully loaded; candidates remain
unapproved. It is an integration smoke test, not a representative latency baseline.
A runner without a usable desktop must fail explicitly rather than fabricate data.

### Native benchmark fixture requirements

The Providers transition starts from Agents rather than a nearly empty terminal, so its screenshot distance is distinguishable without lowering the threshold. References must stabilize, all 30 warm samples must match, and failed screenshots are retained. Never approve an error-state reference. Candidate timings remain provisional until visual review.

### CI → AI performance feedback loop

Relevant mod/config/benchmark PRs trigger the native matrix. Each job captures an
uninstrumented 30-visit provisional baseline, preserves images and raw timings, and
runs **at most one** separate five-visit diagnostic candidate (first incomplete
route, otherwise slowest P95). Diagnostic failure or missing spans are reported,
not treated as zero cost or used in the primary latency measurements.

A final Linux job runs even after a failed matrix, downloads the raw artifacts, checks
checkout SHA, exact route coverage, sample counts, reference evidence and runner
outcomes, then publishes:
- **ai-benchmark-report/ai-report.json**: versioned machine-readable route metrics,
  failures, environment, diagnostic hot groups and evidence pointers.
- **report.md**: ranked compact Markdown with complete/provisional/invalid/missing
  distinctions, budget warnings and suggested next actions.
- **next-actions.json**: evidence-linked P0 measurement blockers, P1 budget
  candidates and P2 retention candidates, with source path hints and acceptance steps.
- One sticky PR comment (updated each run) and a GitHub Actions job summary. Raw
  matrix artifacts retain screenshots, logs and samples for 30 days.

No external LLM API or subscription is used by CI. AI reviewers start with
`ai-report.json`, resolve P0 before optimizing, inspect actual evidence, choose a
small source patch, add a functional regression test, and rerun. A successful CI
means complete **provisional** evidence, not approved screenshot content or a
proven speed improvement. Use the existing strict comparator for approved,
controlled before/after runs; hosted machine changes are not a valid regression
baseline. The reporter neither edits product code nor merges PRs. A stale or
closed PR does not receive a comment.

### First evidence-driven optimization

Native run 45347252667 measured all 24 local routes. The Landing and Unified
Agents feedback P95 warnings had paired sample capture durations accounting for
much of the observation interval; they are not proof of slow JS. Inspecting the
Agents render path revealed duplicate inventory derivation and one JSON parse
per row. The inventory now parses one snapshot per derivation, and the permission
card reuses the already-derived rows. Tests assert one parse and equivalent
permission results, including configuration changes and malformed files. No UI,
permission policy, CLI launch behavior or persistent format changes.

Every visit now records the origin screenshot as a no-transition control and
the number/duration of transition captures, per-observation distances and match
state. Reports expose paired capture share and first-capture match rate. These
are measurement-attribution signals, not a subtraction-based latency estimate.
Hosted P95 values cannot prove that the code patch speeds up the UI; retain
before/after evidence and use a controlled comparison for that claim.

### Current coverage after layout changes

Skillshare was removed from the product on main. The benchmark follows the current layouts: 5 main and 7 panel routes per layout, 22 measurable local routes and 2 explicitly excluded SSH Ports routes. Historical 24-local-route runs above predate this removal and are not directly comparable. No Skillshare CLI or workload is required.
