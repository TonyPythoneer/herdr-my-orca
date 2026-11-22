# Plan: ORCA-style agent permissions in the Herdr Agents page

Status: spec, not implemented. Awaiting design approval.

## What ORCA does (the model worth copying)

ORCA stores a typed choice, not flag text:

- `agentPermissionDefault` — one choice for every agent.
- `agentPermissionOverrides` — agent → choice, for agents set differently.

Choices: `own`, `ask`, `accept-edits`, `auto`, `full-access`
(`src/shared/agent-launch/permissions/tui-agent-permission-choice.ts`).

Each choice maps to a per-agent flag recipe (`tui-agent-permissions.ts`):

| choice | recipe |
| --- | --- |
| ask | `--permission-mode default` (claude, grok), `-a on-request -s read-only -c approvals_reviewer=user` (codex) |
| accept-edits | `--permission-mode acceptEdits` (claude only) |
| auto | `--permission-mode auto` (claude), `--approve-for-me` (codex) |
| full-access | `--dangerously-skip-permissions` (claude), `--dangerously-bypass-approvals-and-sandbox` (codex), `--yolo` (gemini, copilot, crush, cursor, hermes, …), `--auto` (kimi), `--dangerously-allow-all` (amp), `--trust-all-tools` (kiro), `--permission-mode bypassPermissions` (grok) |

Rules ORCA enforces:

- A choice an agent cannot express is omitted from that agent's menu, never faked.
- `own` means no permission flag; the agent's own config decides.
- Bulk changes never rewrite custom launch arguments. `applyAgentPermissionMode` only
  touches args that are empty or equal to a known recipe.
- `auto` only changes auto-capable agents, then a secondary control covers the rest.
- Stored intent is re-read live, so the UI always shows what the current args mean.

UI, for reference: Settings → Agents. A top-level "Permissions" dropdown
(Ask for approval / Approve for me / Full access / Each agent's own settings) plus a
per-agent permission menu on each row; the current Herdr screenshot target is the
same page without the top card and without per-agent rows.

## Design for Herdr

Store the intent in `agent-manager.json` and materialize it into `programs.json`'s
`run` on every change. `run` stays the only thing a launcher reads, so
`orca-new-menu`, `agent-config`, and any future launcher need no changes.

Rejected alternatives:

- **A (flags only in `run`)**: a top-level value degenerates into a bulk setter; it
  cannot distinguish "follows the default" from "pinned", so a later global change
  cannot preserve per-agent overrides.
- **B (compose args at launch)**: three launch paths plus a one-minute
  `knownAgents()` cache would all need to learn the config, and their argv would
  diverge from what `programs.json` shows.

Consistency rule: **`run` wins.** On refresh, if a managed agent's `run` disagrees
with its stored effective choice, pin the observed choice as an override. Loading
never rewrites a command.

## Data model

`~/.config/herdr-app/agent-manager.json`:

```json
{
  "version": 1,
  "disabled": [],
  "permissions": {
    "default": "ask",
    "overrides": { "claude": "full-access" }
  }
}
```

- Missing `permissions` ⇒ `{ default: "own", overrides: {} }`.
- Effective choice = `overrides[key] ?? default ?? "own"`.
- Invalid shape or unknown choice ⇒ parse error with the same banner treatment as
  `disabled`; permission edits pause until fixed.
- Unknown agent keys in `overrides` are ignored.
- Omit `permissions` entirely while the default is `own` and no overrides exist, so
  untouched installs keep today's file.

## Recipes (Herdr)

A recipe is a list of argument **groups**, so removing a choice removes a flag and
its value together (`--permission-mode auto`, `-c approvals_reviewer=user`).
Values verified against the installed CLIs (`claude --permission-mode default|auto`
accepted, `codex --approve-for-me`, `opencode --auto`).

| agent | ask | approve for me | full access |
| --- | --- | --- | --- |
| claude | `--permission-mode default` | `--permission-mode auto` | `--dangerously-skip-permissions` |
| codex | `-a on-request -s read-only -c approvals_reviewer=user` | `--approve-for-me` | `--dangerously-bypass-approvals-and-sandbox` |
| opencode | — | `--auto` | — |
| grok | `--permission-mode default` | — | `--permission-mode bypassPermissions` |
| gemini | — | — | `--yolo` |
| amp | — | — | `--dangerously-allow-all` |
| antigravity | — | — | `--dangerously-skip-permissions` |
| copilot | — | — | `--yolo` |
| crush | — | — | `--yolo` |
| cursor | — | — | `--yolo` |
| hermes | — | — | `--yolo` |
| kimi | — | — | `--auto` |
| kiro | — | — | `--trust-all-tools` |
| qoder | — | — | `--dangerously-skip-permissions` |

- `own` = strip every known permission group for that agent, append nothing.
- No recipe (pi, omp, goose, dsh-tui, swival, boldcreate, empryo, pig): `own` only,
  no permission row. Goose's bypass is `GOOSE_MODE=auto` and `run` is argv-only.
- `accept-edits` is out of v1: Claude-only, and the top level has four choices.

## Behavior

Top level (new card after the intro, before "Official support"):

- Title `Permissions`, one-line explanation, right-aligned dropdown showing the
  current default.
- Picking an option writes the recipe to every managed agent that supports it.
  Unsupported and custom agents are left alone; a muted line reports
  "Applied to 3 agents; 10 don't support this setting."
- Overrides survive a default change. If any remain:
  "2 agents keep their own permission: Claude (Full access), Codex (Ask for approval)"
  with a `Use Ask for approval for all` action that clears them.
- `Each agent's own settings` = default `own` and clear overrides; it strips known
  permission flags from recognized agents and leaves custom command lines alone.

Per agent (inside the expanded editor, above the command fields):

- Trigger shows the effective choice, with a dim `(default)` when there is no override.
- Menu lists the choices the agent supports; with an override, the first entry is
  `Same as all agents (Ask for approval)`.
- Choosing it deletes the override and applies the current default.
- Any permission write goes `programs.json` first, then `agent-manager.json`; if the
  programs write fails, nothing else is written.
- Editing the command directly still works and the permission row follows the run:
  a recognized recipe becomes that choice, no flags becomes `own`, anything else
  (`--permission-mode plan`, `-a never`) reads `Custom` and is never rewritten or
  bulk-changed.

Collapsed row: small badge after the name — `Ask`, `Approve`, `Full access`
(blocked color), `Own` only when overridden, `Custom` when unrecognized. No badge
for plain `own`.

Migration: existing files have no `permissions`, so the default starts as `own`.
The first refresh observes Claude and Codex as full and pins both as overrides, so
the card reads `Each agent's own settings` with
`2 agents keep their own permission: Claude (Full access), Codex (Full access)`.
Nothing is rewritten; aligning them is one click.

## Files

1. `mods/orca-agent-manager/permissions.js` (new, pure):
   `PERMISSION_CHOICES`, `PERMISSION_LABELS`, `PERMISSION_RECIPES`,
   `permissionChoices(key)`, `permissionArgs(key, choice)`, `readPermission(key, run)`,
   `withPermission(key, run, choice)`, `reconcilePermissions(rows, permissions)`.
2. `mods/orca-agent-manager/permissions.test.js` (new): recipe round-trip, group
   stripping (`-c` value), order preservation, `own`, unsupported choice, custom
   detection, idempotence, reconciliation.
3. `mods/orca-agent-manager/state.js`: `parseManagerConfig` /
   `serializeManagerConfig` carry `permissions`; new `writeRunOverrides(text, runs)`
   batching many `programs.json` edits in one parse, dropping a `run` when it equals
   the built-in default; `writeRunOverride` delegates to it.
4. `mods/orca-agent-manager/main.js`: `this.permissions`, `this.permissionOpen`,
   `this.permissionNotice`; permission fields in `rowInfo`; `setDefaultPermission`,
   `setAgentPermission`, `useDefaultForAll`, `reconcileAfterEdit`; reconcile after
   refresh and after a command save; render the top card.
5. `mods/orca-agent-manager/views.js`: row badge; editor permission row using the
   inline dropdown pattern already in `agent-config.groupSelect` (no popup/overlay).
6. `mods/orca-agent-manager/parts.js`: reuse `badge`, add `permissionBadge` only if
   the color logic repeats.
7. Tests: update `state.test.js` for the new config shape and the batch writer;
   re-record `render.snap.json` after the badge/editor block; add
   `permission`/`supports`/`permissionOverride` to test rows.
8. Docs: a Permissions paragraph in README's Agent Manager section.
9. Verify and sync: `node --test mods`, `herdr-app check mods/orca-agent-manager`,
   `herdr-app status`, then copy only changed files to `~/.config/herdr-app/` per
   `.agents/skills/herdr-app-dev-sync/SKILL.md`, and screenshot the page.

## Out of scope

`mods/orca-handoff/main.js` has its own hardcoded `AGENT_CATALOG` and ignores
`programs.json`, so handoff launches will not honor permission settings. That
predates this work (it also ignores model flags and has stale keys such as
`agy`/`cursor-agent`).

## Open approvals

1. `Each agent's own settings` is a reset, not a no-op: it strips known permission
   flags from recognized agents (custom command lines untouched).
2. `accept-edits` is omitted from v1.
