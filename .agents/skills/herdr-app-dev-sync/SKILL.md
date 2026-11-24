---
name: herdr-app-dev-sync
description: Required before you create, edit or delete any Herdr App UI file (anything in mods/, layouts/ or themes/, or keys.json, programs.json, settings.json) in a herdr-my-orca checkout or worktree or in ~/.config/herdr-app/, even a one-line or temporary live edit. Every change must land in both the git repo and the live config.
---

# Herdr App dev sync

The active herdr-my-orca checkout is the source of truth for the files you edit. The running app reads `~/.config/herdr-app/`. Edit in the repo first, then apply the changed files to the matching live paths.

1. Review the repo-to-live diff for each file you changed. The repo version takes precedence for those files, including existing differences in live (the repo is the owner; live is only a copy of what the repo owns).
2. Copy each changed file from the repo to the matching live path with one `cp` per file. Create missing parent directories as needed. Limit the copy to files changed for the current task.
3. Done only when every changed file diffs empty (`cmp` each one) and has the same file mode (`stat -f %Lp` on both; `cmp` ignores the executable bit) and the owner's window shows no new error in `herdr-app status` for the files you changed. Do not run `herdr-app check` against the live path: it runs a mod's subprocesses with this terminal's environment (for example `OMP_CODING_AGENT_DIR`), which can differ from the app's and can read personal sessions. Run `check` only on an isolated copy of the tree. Tell the user which files went which way, and whether host `check` is still pending.

Never:
- Edit a `mods/` file that a manifest under `orca-ui/features/` lists: edit the source there, run `node scripts/build-orca-ui.mjs --out .`, and require `node scripts/build-orca-ui.mjs --check --out .` to exit 0 before syncing the regenerated files. If the build stops because a copy is newer than its source, diff the copy first; `--force` overwrites it (not allowed with `--check`).
- rsync, copy a directory, or `--delete`. Live holds files the repo must never get and you remove only when the user names them: `gpui-kit.d.ts` and `jsconfig.json` (written by `herdr-app check`), `*.bak*`, `AGENTS.md`, `data/`, `icons/`, `layouts/.state/`, runtime `*.json` (installed, shared, view, agent-config...), other mods (browser-url, `*-edited`).
- Leave a stale copy of a file the repo owns. The repo owns every layout, mod dir and file that `git log --all -- <path>` shows it ever tracked (an orca-* mod, `layouts/orca.json`, retired mods like `skillshare`). When the repo deletes or renames one, delete the live path in the same task, one `rm` per file or `rm -r` per mod dir, and also remove its layout blocks and `layouts/.state` entries. Stale files the repo never tracked (old `*.bak*`, `.orig`, `layouts/.state` entries of layouts that no longer exist) are removed only when the user names them: list them first, then delete exactly that list, one `rm` per file.
- Leave your own probe mod (e.g. `zz-probe`) live: remove its dir, layout block and `layouts/.state` entry before finishing; never sync it.
- Commit unasked.
- Edit a copy of a file under `orca-ui/shared/`: edit the source there, run `node scripts/build-orca-ui.mjs --out .`, require `node scripts/build-orca-ui.mjs --check --out .` to exit 0, then copy each regenerated file.
- Delete or rename Herdr-shipped mods, layouts or the `*-edited` folders in live: list them for the user instead.
