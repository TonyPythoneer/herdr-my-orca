# AGENTS.md

This repo is a Herdr config: the Orca-style window, built from Herdr layouts and `orca-*` mods.
Mods render a declarative GPUI tree (not HTML/DOM), so a screen reader or a browser DevTools
cannot describe the UI. The commands below are how an agent sees, finds and drives it.

Read this file once. For a UI task, load `.agents/skills/orca-ui/SKILL.md` before editing.

## First move: ask the code, don't read everything

| You need | Run |
| --- | --- |
| what already exists for a button/list/dialog | `node scripts/ui.mjs find button` |
| the source line of a visible control | `node scripts/ui.mjs where am-back` |
| a mod's builders, ids and labels | `node scripts/ui.mjs outline orca-files` |
| which layout page mounts a mod | `node scripts/ui.mjs pages` |
| the running window, with the builder of each text | `node scripts/ui.mjs tree --map` |
| click, type, scroll and see what changed | `node scripts/ui.mjs click --id agent-settings-back` |

The index is built from source on every run (`scripts/ui-index.mjs`), so it cannot go stale.
Discovery and inspection commands accept `--json`. Prefer one of these over grepping the repo or reading the
README (28 KB); only open the files the command names. The README is for people installing the
config, not for changing it.

## Three layers of context

1. `orca-ui/app.mjs` — the mod reading map: screen, area, keys, tests, `next` file. Start here
   when you need the big picture, not for a single control.
2. `scripts/ui.mjs` — the component index: every top-level builder and class method with its
   stable id, accessible label, role, description, line and call sites.
3. the running app — `status`, `open`, `shot`, `tree`, `find-text`, `click`, `type`, `key`,
   `scroll`, through Herdr's own `herdr-app` CLI and the macOS helpers in `ui-snapshot/`.

## Workflow for a UI or feature change

1. State the goal as the change a person would see.
2. `find` / `outline` / `where` before writing. If the component exists, reuse or extend it;
   do not create a second implementation.
3. Locate the page: `pages`, then `open <node>`; `tree` shows what is currently on screen.
4. Edit the file the index names. Add or keep a stable id (`.id("<mod>-<name>")`) and an
   accessible label (`.accessibility_label("what it does")`) on every interactive control.
5. Test the mod, rebuild managed outputs, then open the page and verify with `tree`/`click`.
6. Report the commands you ran and anything you could not verify (for example a locked Mac).

## Editing rules

- Herdr native API first: `herdr-app` (`shot`, `do`, `status`, `ls`, `check`), `hc`, and the
  `herdr` module (`run`, `shared`, `setShared`, `openOverlay`, `exec`, `nextCommand`). Do not
  add a custom bridge, parser or window helper for something Herdr already exposes.
- Edit `orca-ui/shared/<file>.js`, never a copy in `mods/`: the last line of a copy says
  `Generated from ...`. Run `node scripts/build-orca-ui.mjs --out .` after the edit.
- A mod listed under `orca-ui/features/**/manifest.json` is edited in its feature folder, then
  regenerated; see `README.md` > How the repo is organized.
- A mod may import only files in its own folder. Cross-mod code belongs in `orca-ui/shared/`.
- Never edit a generated copy to "try" something. Re-run the builder.
- Before changing UI files, follow `.agents/skills/herdr-app-dev-sync/SKILL.md` (repo and live
  config must match). Live input needs an unlocked Mac with Herdr frontmost; `open`, `shot` and
  `tree` work while locked.

## Checks (run the narrowest set that covers the change)

```sh
node --test mods/<mod>                 # that mod
node --test scripts/ui-index.test.mjs  # after touching the index or CLI
herdr-app check mods/<mod>             # load the mod once; never against the live path
node scripts/build-orca-ui.mjs --check --out .
npm ci && npx --no-install vp lint mods scripts orca-ui
```

Quality gates, CI and the error-to-file lookup (`scripts/where-error.mjs`) are described in
`README.md` > How the repo is organized.

## Where things are

| Path | What |
| --- | --- |
| `layouts/orca.json` | the window, and which mod mounts in each block |
| `mods/orca-*` | delivered mods (generated copies included) |
| `orca-ui/features/**` | source of generated mods + their manifest |
| `orca-ui/shared/` | helpers copied into mods; edit here |
| `scripts/ui.mjs` | the discovery + live-drive CLI |
| `scripts/ui-index.mjs` | source parser behind the CLI |
| `ui-snapshot/` | native screenshot/OCR/AX suite used by CI |

## Deliberate gaps (do not re-invent)

- No DOM, no browser. `tree` is OCR + geometry, not a semantic accessibility tree: macOS
  exposes only Herdr's menu bar to AX, and GPUI does not publish per-node accessibility.
- `tree --map` matches exact normalized text, so terminal output can collide with a UI string.
  Confirm a match with `where` before editing.
- `click`/`type` need an unlocked desktop. Use `open` and `do` for navigation in automation.
- Component composition is per-mod by design: a shared helper is copied, not imported, because
  Herdr rejects cross-folder imports. Edit the single source in `orca-ui/shared/`.
