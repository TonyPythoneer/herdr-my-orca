# herdr-my-orca

My [Herdr](https://herdr.dev) config: an Orca-style window built from Herdr's layouts and mods.

- **Orca**: the `orca` layout (`layouts/orca.json`) and the `orca-*` mods are a re-creation of Orca's UI in Herdr.
- **skillshare**: the right sidebar icon opens the skillshare panel (`mods/skillshare/`, a mod this repo owns). Its CLI is also required for data and actions.
- **Usage**: the bottom bar shows Claude, Codex and opencode usage (`orca-status/`). Claude and
  Codex read what the CLIs already write on this computer; Claude's quota comes live from
  Claude Code's own `rate_limits` statusline feed, with Anthropic's usage API only as the idle
  fallback (its token is read from the macOS Keychain and never written anywhere). Cached in
  `~/.cache/herdr-usage/`.
- **Follow into a worktree**: an agent CLI that takes its own process into a linked git worktree
  (`claude --worktree`, `codex --worktree`, or a `cd` inside the CLI) takes its tab with it: the
  tab moves into that worktree's space, so the sidebar lists it under the branch, and the agent
  keeps running (`terminal.park` → `terminal.keep`, no restart). A space left without tabs gets
  one, a named tab keeps its name, and the window only follows when the moved tab was on screen.
  The watcher is `orca-status/wt-follow.js` in the always-mounted bottom bar: it reads each agent's
  own process folder (`hc get` → `foreground.cwd`) and polls every 3 s.
- **Custom**: `orca-new-menu` (the "Start an agent" menu with the `>` setup flyout), `agent-config` (model and effort chooser, cached per CLI version), `orca-tabs` and `orca-panel-gap` changes.
- **Refresh branches**: the Projects header's Workspace options popup starts with it. It asks
  `orca-spaces` (`orca-spaces.refresh`) to re-read every project it knows — open or closed —
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
- **Agent Manager**: the sidebar's bottom Agents button opens a Settings-style page with separately scrollable Installed and Available to install groups, each showing up to
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
  server. Herdr has none, so `orca-status/claude-statusline.sh` writes the same windows to
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
    "command": "sh ~/.config/herdr-app/mods/orca-status/claude-statusline.sh"
  }
}
```

The wrapper passes the payload on to `$HERDR_STATUSLINE`, then `ccstatusline` from `PATH`, then
`npx -y ccstatusline@latest`, so the status line you see does not change.

## How the repo is organized

- The repo holds only our own mods (`orca-*`, `agent-config`, and `skillshare`, which this repo
  owns even though it wraps a local CLI). Herdr ships its own mods and layouts (`confirm`,
  `picker`, `main`, `terminals`, …); they stay in the live config and are not tracked here.
- Orca UI starts at [orca-ui/app.mjs](orca-ui/app.mjs): a reading map. `features` lists each
  generated feature, the screen it draws and the files to follow next; `inPlace` lists every other
  mod (edited under `mods/<mod>/`) with its layout nodes, keys, what it opens or shares, tests and
  `next`. A test checks that all 24 mods are covered and that the entries match the repo. A feature is edited in
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
  `orca-agent-manager/{util,parts,views}.js`, `orca-spaces/{storage,cards}.js`,
  `orca-tabs/{drop-zone,tab-title}.js`). `scripts/gpui-stub-loader.mjs` stubs `gpui-kit`,
  `gpui-base` and `herdr`, so `render.test.js` renders the real `main.js` and compares it with
  `render.snap.json` (delete the snapshot to re-record after an intended view change).
- Live config is `~/.config/herdr-app`; changes are copied file by file, never mirrored
  (see [.agents/skills/herdr-app-dev-sync/SKILL.md](.agents/skills/herdr-app-dev-sync/SKILL.md)).
- Checks: `node --test mods scripts orca-ui/features`, `herdr-app check <mod>`, `herdr-app status`,
  `node scripts/build-orca-ui.mjs --check --out .`. Quality gates: `npx eslint@9 -c eslint.config.mjs mods scripts orca-ui`
  (complexity, nesting, function length, parameters, shadowing; generated files are skipped) and
  `node --test --experimental-test-coverage mods scripts orca-ui/features`.
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
  herdr-app 0.1.17 ignores them, so errors would name bundle lines
  ([evaluation](docs/plan-orca-bundler-evaluation.md)).

## Setup

Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/TonyPythoneer/herdr-my-orca/tree/main

In short: copy `layouts/`, `mods/`, `programs.json`, `keys.json`, `settings.json` and `themes/` into `~/.config/herdr-app/`, then switch to the `orca` layout.

## Not included

These are runtime state or files Herdr writes itself, so they are not in this repo:

- `data/`, `view.json`, `shared.json`, `seen.json`, `installed.json`, `window.json`, `agent-config.json` (the model cache)
- `layouts/.state/` (saved clicks), `icons/`, `frame/`, `avatars/`, `telemetry/`
- `AGENTS.md` (Herdr's own documentation), `*.d.ts`, `jsconfig.json`, `*.bak*`

## Things to check before using

- `programs.json` starts Claude and Codex with full-permission flags (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`). Remove them if you want the agents to ask first.
- The `orca` layout expects the `orca-*` mods in this repo. A mod that no layout lists may still be opened by another mod (`openOverlay({ mod: "orca-menu" })`, `run("mod.open", ...)`): grep for its name before deleting it.
