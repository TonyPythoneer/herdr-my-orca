# herdr-my-orca

My [Herdr](https://herdr.dev) config: an Orca-style window built from Herdr's layouts and mods.

- **Orca**: the `orca` layout (`layouts/orca.json`) and the `orca-*` mods are a re-creation of Orca's UI in Herdr.
- **Usage**: the bottom bar shows Claude, Codex and opencode usage (`orca-status/`). Claude and
  Codex read what the CLIs already write on this computer; Claude's quota comes live from
  Claude Code's own `rate_limits` statusline feed, with Anthropic's usage API only as the idle
  fallback (its token is read from the macOS Keychain and never written anywhere). Cached in
  `~/.cache/herdr-usage/`.
- **Custom**: `orca-new-menu` (the "Start an agent" menu with the `>` setup flyout), `agent-config` (model and effort chooser, cached per CLI version), `orca-tabs` and `orca-panel-gap` changes.
- **Agent Manager**: the sidebar's bottom Agents button (or `Start an agent` → `Manage agents…`) opens
  a Settings-style page. It lists the Agent CLIs Herdr detects and the ones it supports but cannot
  find, turns availability on/off for the launch menu, and edits each CLI's executable and launch
  arguments. Commands are written to `programs.json`; the on/off choice lives in
  `agent-manager.json` and never uninstalls or stops an agent. Refresh re-checks this computer by
  running a login-shell `command -v` probe, because `knownAgents()` caches for a minute and offers
  no force option.

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
