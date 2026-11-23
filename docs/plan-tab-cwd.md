# New tabs open at the space's work directory

- **Worktree:** `wt-tab-cwd` (branch `feature/wt-tab-cwd`, based on `main` @ `d01e931`)
- **Status:** Implemented and verified in the live app (see Verification); plan text kept as the record.
- **Ask:** "If I open a tab, it should always go to the work directory — the worktree for a worktree space, the project root for the main space — not somewhere else."

## The problem (verified on this machine, live app)

`herdr-app do tab.new --space <id>` does **not** start the new terminal in the space's `folder`. It starts it in the **target space's focused terminal's live cwd**. So after a `cd` in the focused terminal, every new tab drifts with it:

1. Worktree space `wt-panel-slide-zoom` (`speae1510…`, folder `/Users/tonyyang/git/herdr-my-orca.worktrees/wt-panel-slide-zoom`), its only terminal `t176` at the worktree root → `herdr-app do tab.new --space speae1510… --focus false` opened `t178` at the worktree root. Looks right, but only because the shell had not moved.
2. `cd /tmp` in `t176` (the space's focused terminal) → the same `tab.new` opened the next tab at `/private/tmp`.
3. `herdr-app do tab.new --space speae1510… --folder /Users/tonyyang/git/herdr-my-orca.worktrees/wt-panel-slide-zoom --focus false` → new tab at the worktree root, regardless of `t176` being at `/tmp`. **`folder` pins the cwd; that is the fix.**
4. In between, `herdr-app ls` kept reporting the space's `folder` as the worktree path the whole time. The space's location is stable; only the default for a new tab follows the live shell.

The app's own docs agree on the intent but not on the behavior:

- `herdr-app commands` for `tab.new`: "folder (default: the focused terminal's)".
- `herdr.d.ts`, `SpaceInfo.folder`: "Where its new terminals start".
- `~/.config/herdr-app/AGENTS.md`: "Where a space is now is its terminals' live folders … new tabs start where its focused pane is".

So the host default is the focused pane's cwd, and `space.folder` is the worktree/project directory the sidebar is built from. The bug is that the tab paths rely on the host default instead of saying `folder`.

## What each tab-creating path does today

All of these run `tab.new` with a space but **no folder**, so they drift with the focused shell:

| Path | File |
|---|---|
| ⌘T (`cmd-t`) is the raw host command | `keys.json:6` (no layout override — verified) |
| Tab strip "+" → **New Terminal** | `mods/orca-new-menu/main.js:203-204` |
| "+" menu → an agent row (**Claude**, **Codex**, …) | `mods/orca-new-menu/main.js:357-363` |
| Agent launch from the agent flyout | `mods/agent-config/main.js:552` |
| Floating workspace empty state → **New Terminal** | `mods/orca-float/main.js:178` |

Already correct, for reference:

- `mods/orca-tabs/close-plan.js:20` already sends `folder: space.folder` when it replaces a space's last tab.
- `mods/orca-spaces` opens an unopened worktree at its own path (`g.top` is the worktree for a linked row, the repo root for the main row).
- `mods/orca-worktree` creates the space at the new worktree path.

Not a tab, deliberately unchanged:

- `mods/orca-handoff/main.js:124,152,164` opens the handoff tab at the source pane's cwd. Handoff continues *that* session in *that* directory, so it must not be re-rooted.
- `pane.split` keeps the pane's cwd. A split is a sibling of the pane you split, not a fresh tab.

## Decision

A tab opened by the UI starts in its space's `folder` — the worktree checkout for a worktree space, the repo root for the main space — even if the focused shell has `cd`'d elsewhere.

- Pass `folder: space.folder` explicitly on every UI path that creates a **terminal** tab.
- If `space.folder` is empty, omit `folder` and let the host fall back (machine home). Never send `folder: ""`.
- `cmd-t` must go through a mod command, because `keys.json` can only run host commands and cannot pass arguments. `tab.new` stays available as a host command (`herdr-app do tab.new`, other mods), so "a tab right here" is still one command away.
- Agent tabs follow the same rule: an agent started from a worktree space starts at that worktree's root, not at a drifted shell's cwd.

## Implementation

### 1. `mods/orca-tabs/new-tab.js` (new, pure)

```js
// The arguments for a tab that must start in its space's work directory, not in
// whatever directory the space's focused shell happens to be in (see docs/plan-tab-cwd.md).
// A space with no folder keeps the host default (its machine's home).
export function newTabArgs(space) {
  if (!space?.id) return {};
  return { space: space.id, ...(space.folder ? { folder: space.folder } : {}) };
}
```

### 2. `mods/orca-tabs/main.js` — the `new-tab` command

The command loop is currently inside `if (props()?.unified)` (`:386-395`), so it does not exist in the plain `orca` layout. Widen the loop and handle `new-tab` before the drawer commands:

```js
cx.spawn(async (cx) => {
  for (;;) {
    const command = await nextCommand();
    if (command === "new-tab") {
      run("tab.new", newTabArgs(spaces().find((s) => s.active)));
      continue;
    }
    if (!props()?.unified) continue;          // the drawer toggles stay unified-only
    if (command === "toggle-sidebar") this.wantToggle = (this.wantToggle ?? 0) + 1;
    if (command === "toggle-panel") this.wantPanelToggle = (this.wantPanelToggle ?? 0) + 1;
    if (command === "toggle-sidebar" || command === "toggle-panel") cx.notify();
  }
});
```

`init()` returns early for the dialog and drag-overlay copies, so exactly one instance listens (same reason the existing loop is safe). Import `newTabArgs` next to `closePlan`.

Do not add `focus`: the host's default is the current ⌘T behavior (new tab shown at once).

### 3. `keys.json`

```json
"cmd-t": "orca-tabs.new-tab",
```

Only `global` has `cmd-t`; `layout:orca` and `layout:orca-unified` have no `cmd-t` override (checked with a JSON walk).

### 4. `mods/orca-new-menu/main.js`

- `createRows()` **New Terminal** (`:203-204`):

  ```js
  { label: "New Terminal", icon: "square-terminal", hint: shortcut("orca-tabs.new-tab"),
    run: () => run("tab.new", space ? { space: space.id, ...(space.folder ? { folder: space.folder } : {}) } : {}) },
  ```

  The hint is read from `keys.json`, so it must name the new action or the chip disappears.

- `launch(agent, model, unofficial)` (`:357-363`) — add the space folder:

  ```js
  run("tab.new", {
    space: space?.id,
    ...(space?.folder ? { folder: space.folder } : {}),
    argv: seed && model ? [...agent.run, seed.flag, model] : agent.run,
  });
  ```

### 5. `mods/agent-config/main.js:552`

The method already resolves `space` (`p.space` or the active space) for the availability check; use it for the launch too:

```js
run("tab.new", {
  space: space?.id,
  ...(space?.folder ? { folder: space.folder } : {}),
  argv: built.argv,
});
```

### 6. `mods/orca-float/main.js`

- Import `spaces` from `herdr` (line 21).
- `:166` the hint: `chordOf("orca-tabs.new-tab")`.
- `:178` the row:

  ```js
  .on_click((_e, cx) => {
    const space = spaces().find((s) => s.active);
    run("tab.new", space ? { space: space.id, ...(space.folder ? { folder: space.folder } : {}) } : {});
    this.setOpen(false, cx);
  })
  ```

## Tests

- `mods/orca-tabs/new-tab.test.js` (new, `node --test`): a normal space → `{ space, folder }`; a space with `folder: ""` → `{ space }`; `null`/`undefined` → `{}`.
- Keep `mods/orca-tabs/close-plan.test.js` green.
- `node --test mods scripts`.
- `herdr-app check ~/.config/herdr-app/mods/{orca-tabs,orca-new-menu,agent-config,orca-float}` (or the worktree copies) — all exit 0.
- `herdr-app status` — no errors from these mods.

## Acceptance (live app)

1. Worktree space, focused shell `cd /tmp`, then ⌘T → new tab's `hc get <t>` cwd is the worktree path.
2. Same in the main space (repo root): after `cd /tmp`, ⌘T → repo root.
3. "+" → **New Terminal** in a worktree space after `cd /tmp` → worktree path.
4. "+" → **Claude**/other agent in a worktree space after `cd /tmp` → agent starts in the worktree path (its tab's shell cwd before the agent takes over).
5. Floating workspace → **New Terminal** → space work directory.
6. `layout.switch orca` (non-unified): ⌘T works, sidebar/panel toggles unchanged.
7. A space created with no folder: a new tab still opens (machine home), no error.
8. Mod tabs (files, changes, diff) and handoff are unchanged.

## Risks / open points

- **Live sync collision.** `~/.config/herdr-app/mods/orca-tabs/main.js` and `keys.json` currently differ from `main`: the live side carries the unmerged `feature/wt-panel-slide-zoom` drawer work. Do not copy this branch's `orca-tabs/main.js` or `keys.json` over live before that decision — it would revert the other worktree. Implement and test in this worktree; verify live only after rebasing onto (or merging) `wt-panel-slide-zoom`, or with the user's explicit choice of which side is current. The other four files (`orca-new-menu`, `agent-config`, `orca-float`, the new `new-tab.js`) are identical live today.
- **⌘T semantics change.** ⌘T no longer means "a tab here"; it means "a tab at this space's root". The host command is still reachable for "here". If the user wants both, add a second binding (e.g. `cmd-shift-t`) to the raw `tab.new` later; not in this change.
- Spaces created without a folder (`space.new {}`) have `folder: ""`; the fallback keeps today's behavior.
- Remote spaces: `space.folder` is a path on that space's machine, and the host routes by `space` — the same shape `close-plan.js` already relies on.
- The space's `folder` is its creation folder, not a live location (verified above). If a checkout is moved, the host already retries at home; this change does not make that worse.

## Verification (done)

- `node --test mods/orca-tabs` → 35/35 pass (includes `new-tab.test.js`).
- `node --test mods/orca-new-menu mods/agent-config mods/orca-float` → 68/68 pass.
- `herdr-app check` on `orca-tabs`, `orca-new-menu`, `agent-config`, `orca-float` → all pass; `herdr-app status` → no errors.
- Live, space `wt-panel-slide-zoom`, focused shell `cd /tmp`, then `herdr-app do orca-tabs.new-tab` (the ⌘T command): the new terminal opened at `/Users/tonyyang/git/herdr-my-orca.worktrees/wt-panel-slide-zoom`, not `/tmp`.
- The probe tab was closed and the shell put back at the worktree root.
- `node --test mods scripts` still reports the same pre-existing failures it reports on `main` (virtual-list and `scripts/titlebar-height.test.js`); none are in the changed files.

## Flow (required before editing mods)

Load `.agents/skills/herdr-app-dev-sync/SKILL.md`. Diff each file against `~/.config/herdr-app/<path>` before the first edit and again before copying; on a hunk you did not write, stop and ask the user. Copy only the changed files (one `cp` each, no directories, no `--delete`), run `herdr-app check` per changed mod and `herdr-app status`, and tell the user which files went which way. No push, no PR (local first).
