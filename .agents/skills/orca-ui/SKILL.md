---
name: orca-ui
description: Use for any change to the Orca UI (mods/orca-*, orca-ui/, layouts/orca.json) or to the AI discovery and live-driving tools. Finds existing components and source before editing, then verifies on the running app.
---

# Orca UI change workflow

Goal: an agent goes from a user goal to a verified UI change without reading the repository.
The index is derived from source; never maintain a parallel component document.

## 1. Understand before editing

```sh
node scripts/ui.mjs find <what the user asked for>     # components, ids, labels, mods
node scripts/ui.mjs outline <mod> --ui                  # builders that render, by file/line
node scripts/ui.mjs where <id or label>                 # exact source + call sites
node scripts/ui.mjs pages                               # which page mounts the mod
node scripts/ui.mjs open main-agents                    # show it in the running app
node scripts/ui.mjs tree --map                          # current window + which builder drew each text
```

Read only the files those commands name. If `find` already returns a matching builder, reuse
it or extend it; a second implementation is a bug. Check `orca-ui/shared/` before writing a
helper that another mod may need.

## 2. Decide where the change belongs

- Shared behaviour/UI used by more than one mod -> `orca-ui/shared/<name>.js`, then
  `npx --no-install vp pack && npx --no-install vpx src/tooling/build-orca-ui.ts --out .`. Never edit the generated copy in `mods/`.
- A generated feature mod -> its `orca-ui/features/<area>/<feature>/` source, then the builder.
- A hand-written mod -> `mods/<mod>/`, its own file. Keep pure logic in its own module with a
  test (the surrounding mods show the pattern).

Every interactive element needs a stable id and an accessible label:

```js
div().id("am-back").role("button").accessibility_label("Back to terminals").on_click(...)
```

Id shape: `<mod short name>-<name>`. Dynamic rows may use a template (`am-toggle-${key}`).
`node scripts/ui.mjs audit` lists controls that still lack an id, and literal ids a second builder reuses.

## 3. Implement and test

```sh
node --test mods/<mod>
herdr-app check mods/<mod>          # isolated tree, not the live path
npx --no-install vp pack && npx --no-install vpx src/tooling/build-orca-ui.ts --check --out .
```

If a render snapshot changed on purpose, delete it and let the test re-record, then review the
diff. If `herdr-app check` reports an error, resolve the file/line with:

```sh
herdr-app check mods/<mod> 2>&1 | node scripts/where-error.mjs
```

## 4. Verify on the real app

```sh
node scripts/ui.mjs open <page>
node scripts/ui.mjs tree                      # OCR + geometry, no guessing from pixels
node scripts/ui.mjs click --id <id>           # prints before/after shots and text that changed
node scripts/ui.mjs type "value" --enter
node scripts/ui.mjs key escape
node scripts/ui.mjs scroll down --text "Files"
```

`click` is the assertion: it reports `+`/`-` text after the action. For a visual-only change,
compare the before/after PNGs. If the desktop is locked, `click` fails with that reason; fall
back to `open` + `shot`/`tree` and say what was not verified.

## 5. Sync the live config

Follow `.agents/skills/herdr-app-always-goes-live/SKILL.md` for every changed file in `mods/`,
`layouts/`, `themes/`, or the JSON config. Repo first, then one `cp` per file, then `cmp`.

## Rules that save the next agent time

- Herdr native API first (`herdr-app`, `hc`, `herdr.run/shared/exec/openOverlay`).
- No new abstraction with one consumer; no option nobody asked for.
- Keep the `orca-ui/app.mjs` reading map in sync when adding a mod: the tests check coverage.
- Do not add prose docs for components; if discovery is missing something, extend
  `scripts/ui-index.mjs` and its test so the answer comes from code.
