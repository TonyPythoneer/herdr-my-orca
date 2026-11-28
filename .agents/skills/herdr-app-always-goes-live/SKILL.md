---
name: herdr-app-always-goes-live
description: Required before you create, edit, rename or delete any Herdr App UI file (mods/, layouts/, themes/, keys.json, programs.json, settings.json) in a herdr-my-orca checkout or worktree, or in ~/.config/herdr-app/. The repo is the owner: its new result is always applied to live, even when live differs. Use the aggressive form only when the user asks for it.
---

# Herdr App always goes live

The repo is the owner. Live (`~/.config/herdr-app/`) is a copy that the repo overwrites. Sync only authorized, verified delivery changes when a live target is available; a remote PR does not imply live deployment.

## Normal sync (default)

1. Edit and test in the repo first. Build managed outputs (see Never).
2. For each deliverable file the repo changed (`git status`: M, R, A or ??; skip tests and `*.golden.json`), `mkdir -p` the parent, then `cp` repo to live, one file per `cp`. The repo wins even when live differs.
3. When the repo renamed or deleted a file or mod, delete the old live path in the same task: one `rm` per file, `rm -r` per old mod folder. Remove its layout blocks and `layouts/.state` entries too.
4. Verify: `cmp` each file, `stat -f %Lp` on both sides for the same mode, and `herdr-app status` shows no new error. Run `herdr-app check` only on the repo tree, never on the live path.
5. Report: which files went which way, which were deleted, and what could not be checked (for example a locked desktop).

## Aggressive sync (only when the user asks, for example "砍掉 live" or "live 全部照 repo")

1. Say what will be deleted (the owned trees: `mods/orca-*`, `layouts/`, `themes/`) and get a yes first, because it removes live work.
2. Delete those trees, then copy the repo set back with one `cp` per file. No `rsync`, no `--delete`.
3. Keep these unless the user names them: `data/`, `icons/`, `layouts/.state/`, runtime `*.json` (installed, shared, view, agent-manager and similar), `gpui-kit.d.ts`, `jsconfig.json`, `*.bak*`, `AGENTS.md`, and Herdr-shipped mods (`new-menu`, `*-edited*`). List them for the user.
4. Then run steps 4 and 5 of the normal sync.

## Never

- Edit generated delivery JavaScript, build by hand or publish an unverified result.
- Use stale legacy source paths as instructions for new architecture; follow AGENTS.md and the actual current build mapping.
- Sync or delete live files without the user's authorization and an available, verified local target. Preserve user runtime data and Herdr-shipped mods.
- Create cross-mod runtime imports or substitute a custom compiler. Report build-readiness blockers.
- Commit unasked or leave a probe mod live.
