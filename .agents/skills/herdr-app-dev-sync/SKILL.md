---
name: herdr-app-dev-sync
description: Required before you create, edit or delete any Herdr App UI file (anything in mods/, layouts/ or themes/, or keys.json, programs.json, settings.json) in a herdr-my-orca checkout or worktree or in ~/.config/herdr-app/, even a one-line or temporary live edit. Every change must land in both the git repo and the live config.
---

# Herdr App dev sync

The active herdr-my-orca checkout is the source of truth for the files you edit. The running app reads `~/.config/herdr-app/`. Edit in the repo first, then apply the changed files to the matching live paths.

1. Review the repo-to-live diff for each file you changed. The repo version takes precedence for those files, including existing differences in live.
2. Copy each changed file from the repo to the matching live path with one `cp` per file. Create missing parent directories as needed. Limit the copy to files changed for the current task.
3. Done only when every changed file diffs empty, `herdr-app check ~/.config/herdr-app/mods/<mod>` exits 0 for each changed mod, and `herdr-app status` shows no errors from the files you changed. Tell the user which files went which way.

Never:
- rsync, copy a directory, or `--delete`. Live holds files the repo must never get and you must never remove: `gpui-kit.d.ts` and `jsconfig.json` (written by `herdr-app check`), `*.bak*`, `AGENTS.md`, `data/`, `icons/`, `layouts/.state/`, runtime `*.json` (installed, shared, view, agent-config...), other mods (browser-url, `*-edited`).
- Mirror a deletion or rename; list it for the user instead.
- Leave your own probe mod (e.g. `zz-probe`) live: remove its dir, layout block and `layouts/.state` entry before finishing; never sync it.
- Commit unasked.
- Edit a file that has a copy under `shared/` in `shared/` only, run `node scripts/sync-shared.mjs`, then copy the regenerated files; `node scripts/sync-shared.mjs --check` must exit 0.
- Delete or rename Herdr-shipped mods, layouts or the `*-edited` folders in live: list them for the user instead.
