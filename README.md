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

## One UI profile

The Orca UI is now described by **one manifest**: [ui/orca.profile.json](ui/orca.profile.json).
It lists the shell, workspaces, sidebar panels, menus and supporting mods that together
form this layout. These are *components*, not 25 copies of the same UI: Herdr requires
each mod's own named entrypoint, so the source folders stay independent. The manifest is
the single entry point for knowing which pieces belong to **my UI**.

- Edit **layouts/orca.json** for placement and sizes, **themes/orca-dark.json** for colors,
  and the relevant **mods/<name>/** for behavior. The manifest declares the composition,
  not an additional competing copy of those settings.
- Run **node scripts/ui-profile.mjs list** to see grouped modules and
  **node scripts/ui-profile.mjs check** to validate layout, theme, shortcuts, overlays
  and declared paths.
- Run **node --test scripts/ui-profile.test.mjs** for the profile's automated checks.
- The stock **layouts/main.json** and other legacy mods are left untouched. In particular
  **orca-pane-status** is not part of this profile; the installer does not copy unused mods.

### Installing this UI

From this checkout:

```sh
node scripts/ui-profile.mjs check
node scripts/ui-profile.mjs install --dry-run
node scripts/ui-profile.mjs install
```

The destination defaults to **~/.config/herdr-app/**. Use **--target /other/config**
if needed. Installation does **not** overwrite existing files or mod directories, making
the first run safe for an existing Herdr configuration. For later updates, back up your
configuration and explicitly use **install --force**; this updates the profile's files
and mods, but does not delete unrelated mods or Herdr's runtime state. Then select the
**orca** layout in Herdr.

## Setup

Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/TonyPythoneer/herdr-my-orca/tree/main

The UI profile installer above is the preferred setup path. For a manual setup, copy only the paths declared in `ui/orca.profile.json` and then switch to `orca`.

## Not included

These are runtime state or files Herdr writes itself, so they are not in this repo:

- `data/`, `view.json`, `shared.json`, `seen.json`, `installed.json`, `window.json`, `agent-config.json` (the model cache)
- `layouts/.state/` (saved clicks), `icons/`, `frame/`, `avatars/`, `telemetry/`
- `AGENTS.md` (Herdr's own documentation), `*.d.ts`, `jsconfig.json`, `*.bak*`

## Things to check before using

- `programs.json` starts Claude and Codex with full-permission flags (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`). Remove them if you want the agents to ask first.
- The `orca` layout expects the `orca-*` mods in this repo. Mods that are not used by any layout can be deleted.
