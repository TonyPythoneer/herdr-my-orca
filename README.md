# herdr-my-orca

My [Herdr](https://herdr.dev) config: an Orca-style window built from Herdr's layouts and mods.

- **Orca**: the `orca` layout (`layouts/orca.json`) and the `orca-*` mods are a re-creation of Orca's UI in Herdr.
- **Usage**: the bottom bar shows Claude, Codex and opencode usage (`orca-status/`). Claude and
  Codex read what the CLIs already write on this computer; Claude's quota comes live from
  Claude Code's own `rate_limits` statusline feed, with Anthropic's usage API only as the idle
  fallback (its token is read from the macOS Keychain and never written anywhere). Cached in
  `~/.cache/herdr-usage/`.
- **Custom**: `orca-new-menu` (the "Start an agent" menu with the `>` setup flyout), `agent-config` (model and effort chooser, cached per CLI version), `orca-tabs` and `orca-panel-gap` changes.

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
  reads the newest one. (Orca gets the same values from `codex app-server`'s
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

## Workflow (Planning → Development → Tuning → Ready)

A small workflow runner sits beside the Orca UI. You plan in a normal agent tab, then a
background Runner drives the tasks one at a time and shows progress as four lights in the
sidebar.

- `my-orca/my-orca.mjs` — one zero-dependency Node file: `init`, `start`, `run`, `stop`,
  `status`, `config set`. The Runner never commits or pushes; each dev/Tuning stage does
  its own commit and plain `git push`.
- `skills/herdr-planning/SKILL.md` — `/herdr-planning`. It writes `handoff.md` and
  `tasks.json`, shows you every task and `test` command, waits for your approval, then
  calls `my-orca init` in the Planning tab.
- `mods/orca-workflow/` — the four-light strip (28px above the sidebar footer) and the
  inspector dialog: task states, acceptance, Peek, Resume/Stop, and the rework limit.
- `layouts/orca.json` — the `workflow-strip` block that mounts the strip.

Install the CLI and skill, then copy the mod and layout as usual:

```sh
sh skills/herdr-planning/install.sh
cp -R mods/orca-workflow ~/.config/herdr-app/mods/
cp layouts/orca.json ~/.config/herdr-app/layouts/
```

The install script writes only `~/.agents/skills/herdr-planning`, a copy under
`~/.codex/skills`, and a symlink at `~/.local/bin/my-orca`. It does not touch
`programs.json`, `settings.json`, `keys.json` or the Herdr core.

Start a run from the Planning tab (so `HC_TERMINAL_ID` is set):

```
/herdr-planning
my-orca init --handoff handoff.md --tasks tasks.json
my-orca status          # progress
my-orca stop            # stop the Runner (add --workers to stop workers too)
my-orca start           # Resume after needs_user
```

State lives in `~/.config/herdr-app/my-orca/`:

```
config.json                 # max_rework_cycles, close_planning_tab, timeouts
index.json                  # absolute git-dir -> wt-id
<wt-id>/state.json          # the only execution state
<wt-id>/events.jsonl        # append-only transitions
<wt-id>/{handoff.md,tasks.json,dispatch/,results/,reviews/,logs/}
archive/                    # old runs, never deleted
```

`init` refuses a detached HEAD, a bare repo, an upstream that is the repository's default
branch (for example `main`), a missing section/task/acceptance, obvious empty tests, a
dependency cycle, and common secret patterns in the two files. If the branch has no
upstream it runs `git push -u origin <branch>`; it then requires `git push --dry-run` to
succeed. A dirty worktree is allowed and recorded as `dirty_at_start`; the first stage
commits and pushes those files.

The four lights use fixed stage colours (`#7E66CC`, `#367CE9`, `#C38B35`, `#139D78`) and
the same colours in light and dark themes. State is not colour-only: complete is a check,
working pulses, pending is a hollow ring, `needs_user` is a warning triangle, failed is an
error circle. Counts are accepted/total; Planning is the `1/1` gate; Ready is `0/1` or
`1/1`.

Known limitations, on purpose:

- The Runner verifies only this worktree's branch, `HEAD` ancestry, a clean tree and that
  the stage's commit reached `@{u}`. It cannot see behind the local ref, a remote rewritten
  by someone else, ignored files, other branches/worktrees, or anything outside the
  worktree. A full-permission agent can do those things; the dispatch file forbids them.
- User edits while a worker is running are not reliably detectable; work in an isolated
  worktree.
- Moving the whole repository changes the git-dir and therefore the `wt-id`; old state is
  left behind. Moving a linked worktree is handled.
- `/model` changed mid-session is not observable; `init` prints the Tuning profile it will
  use, so read that line.
- The Planning tab is kept by default (`close_planning_tab=false`). When enabled, it is
  closed only after the nine checks in the spec; the last tab in a space and tabs with
  other work are always kept.
- Secrets scanning is best effort; `state.json` and `events.jsonl` never store the full
  argv, environment or terminal screen, and screens go only to `logs/` (64 KiB, `0600`).
- Tests are not judged for quality. Planning must get your approval for every command,
  and at least one acceptance criterion must have a machine-runnable `verify`.
- Peek shows a background worker without a tab. If you use keep-as-tab on a worker, it is
  still workflow-owned and is killed at the end of its task.
- There is no reduced-motion setting in this platform; the pulsing lamp is the only
  animation.

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
- The `orca` layout expects the `orca-*` mods in this repo. Mods that are not used by any layout can be deleted.
