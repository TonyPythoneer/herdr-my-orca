---
name: herdr-app-dev-sync
description: Required before you create, edit or delete any Herdr App UI file (anything in mods/, layouts/ or themes/, or keys.json, programs.json, settings.json) in a herdr-my-orca checkout or worktree or in ~/.config/herdr-app/, even a one-line or temporary live edit. Every change must land in both the git repo and the live config.
---

# Herdr App dev sync

The running app reads only live `~/.config/herdr-app/`; git sees only the repo (this herdr-my-orca checkout, main or a worktree). Same relative paths, no automatic sync. Live also holds other worktrees' unmerged work, so the two already differ: never sync drift you didn't create.

1. Before your first edit to a file, run `diff <file> ~/.config/herdr-app/<file>` from the repo root. If they differ, stop: show the user and ask which side is current. Diff again right before copying; a hunk you didn't write means stop and ask, never overwrite.
2. Edit on either side, then copy each file you changed (yours only, not everything in `git status`) to the other side with a haiku subagent (Agent tool, `model: haiku`), prompting:
   > Copy exactly these files from `<absolute src root>` to `<absolute dest root>`, same relative path, one `cp` per file (`mkdir -p` a missing parent): `<files>`. Copy nothing else, delete nothing, run no git, load no skills, spawn no agents. Report each file you copied.
3. Done only when every changed file diffs empty, `herdr-app check ~/.config/herdr-app/mods/<mod>` exits 0 for each changed mod, and `herdr-app status` shows no errors from the files you changed. Tell the user which files went which way.

Never:
- rsync, copy a directory, or `--delete`. Live holds files the repo must never get and you must never remove: `gpui-kit.d.ts` and `jsconfig.json` (written by `herdr-app check`), `*.bak*`, `AGENTS.md`, `data/`, `icons/`, `layouts/.state/`, runtime `*.json` (installed, shared, view, agent-config...), other mods (skillshare, browser-url, `*-edited`).
- Mirror a deletion or rename; list it for the user instead.
- Leave your own probe mod (e.g. `zz-probe`) live: remove its dir, layout block and `layouts/.state` entry before finishing; never sync it.
- Commit unasked, or commit `AGENTS.md` or `.agentflow/` at all.
