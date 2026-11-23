# Agent Flyout Spec

*   **Author:** Tony Yang
*   **Status:** Draft (the change is already implemented and committed on `feature/wt-model-provider-setup` as `ccc6605`; this draft is for review before merge)
*   **Date:** 2026-11-23

--------------------------------------------------------------------------------

## Overview

The agent setup flyout is the popup that opens from the chevron on an agent's row in the New menu. It lets the user pick a model, an effort level and a few extra launch options, then starts the agent in a new tab with matching command-line arguments.

Before this change, `mods/agent-config/main.js` held three agents' worth of hard-coded screens (Claude, Codex, OpenCode). Each agent had its own model-listing code, its own select boxes, its own argument-building code in `launch()`, and its own saving code. `mods/orca-new-menu/models.js` kept a second hand-written list of which agents get a flyout.

This design replaces that with one **spec** per agent (plain data in `shared/agent-flyout.js`) and one renderer that draws any spec. The spec says which options an agent has, what command-line arguments each option becomes, how the model list is read, and which section each option sits in. Adding an agent is a new spec, plus a parser if its model list has a shape no existing parser reads.

The design also adds **pi** as the fourth flyout agent, and puts the flyout in three sections: Model source (Codex only), Harness CLI arguments, Harness CLI advanced arguments.

## The Problem

1.  **Every agent was a copy of the others.** Claude's Advisor and Output style selects, Codex's DISABLE checklist and OpenCode's group filter were each written once, inline, for one agent. A new agent meant copying a screen and a branch of `launch()`.
2.  **The argument each option becomes was spread over code.** To know what `claude` is started with, a reader had to follow `argsFor`, an `if (this.key === "claude")` block in `launch()`, and the saved-state code. The only test of this was the Codex provider launch.
3.  **Two lists of "which agents have a flyout" could disagree.** `MODELS[key].flyout` in the New menu and `AGENTS` in `agent-config` were edited separately.
4.  **pi had no flyout**, so its model, thinking level and `--no-*` switches could not be chosen from the New menu. pi is an official agent (`BUILTIN_DEFAULTS.pi`).

## Goals

*   G1. Each flyout agent is described by one spec, as data with no functions. A test proves the spec survives `JSON.stringify` and that every name it mentions (parser, hook) resolves in code.
*   G2. One renderer draws every option type. Adding an agent needs no new rendering code.
*   G3. The launch argv is built from the spec by one function. For Claude, Codex and OpenCode it is the same argv as before, in the same order, for every option combination the old code could produce (one deliberate exception, see Behavior Changes).
*   G4. What is saved in `agent-config.json` keeps its keys, so no migration runs and old files still load, including the older spellings `advisor: false` and `onlyFree: false`.
*   G5. The New menu decides which rows get a chevron from the same spec, with no second list.
*   G6. pi gets a flyout built only from options this design verified against the installed `pi` (see Technical Plan, pi).
*   G7. The three flyout sections appear in the same way for every agent, with a spacing rule that is data (`gap`), not per-agent code.

## Non-Goals

*   The agents that still pick a model inline in the New menu: gemini, grok, antigravity and omp. They keep `MODELS[key].models` / `probe`. This design does not verify their flags, and moving them would change their interaction from a list to a flyout.
*   The other official agents in `BUILTIN_DEFAULTS` (cursor, copilot, amp, goose and so on). They have no model flag the project has verified.
*   Remote Herdr spaces. The flyout still launches locally; the Model source row is greyed out there (unchanged from the Model providers design).
*   A visual redesign. Spacing and structure are meant to stay as they were, apart from the changes in "Behavior Changes".
*   Editing a spec from the UI. Specs are code-reviewed files.
*   Model providers beyond Codex. The Model providers design (`docs/designs/model-provider-setup.md`) is separate; this design only draws its select as part of the Codex spec.

## Open Questions

*   **Q1: Should gemini, grok, antigravity and omp move into the spec?** It would remove the New menu's second picker. The cost is that each needs a verified flag and a model-list parser, and their click behavior changes from "pick a model in a list, launch" to "open a flyout".
*   **Q2: pi thinking levels.** The spec offers `off, minimal, low, medium, high, xhigh, max` to every model whose `thinking` column is `yes`. pi lowers a level the model does not define (read in `pi-ai`, not run here). The screen therefore can show "Max" for a launch that runs at a lower level. Should the list be cut to what every thinking model accepts?
*   **Q3: `render.snap.json` is about 578 KiB.** It is a recorded render tree for ten flyout states. It is large and will conflict on merge. Should it be replaced by a short summary (node counts and ids per state)?
*   **Q4: Do all providers in Codex keep the name "oMLX"?** `launchArgv` uses a fixed alias on purpose (no data from the file is placed into a config string). Out of scope here, listed because the Model source select shows several providers.
*   **Q5: Is a row click that launches with saved values the right behavior for pi?** Claude, Codex and OpenCode already work this way. For pi it is new. With nothing saved the flyout selects the "Default" entry, which passes no `--model`, so a first click starts pi as before.

## Critical User Journeys (CUJs)

### CUJ 1: Launch Claude with advanced options

*   **Given**: Claude is installed and enabled. The user saved Advisor `opus`, Output style `eli5`, an Agents JSON and an appended system prompt.
*   **When**: The user opens the Claude flyout and presses Launch terminal.
*   **Then**: The tab starts with `<programs.json argv> --model … --effort … --advisor opus --settings {"outputStyle":"eli5"} --agents <json> --append-system-prompt <text>`, in that order. If the Agents text is invalid JSON, nothing launches and the editor shows `Invalid JSON · line N`.

### CUJ 2: Launch Codex with options switched off

*   **Given**: Codex is installed. The user ticked `apps` and `mcp` in DISABLE, and `~/.codex/config.toml` defines two MCP servers.
*   **When**: The user presses Launch terminal.
*   **Then**: The argv is `<argv> -m <model> -c model_reasoning_effort=<effort> --disable apps -c mcp_servers.<a>.enabled=false -c mcp_servers.<b>.enabled=false`. With a Model provider chosen, the argv is the provider launch from the Model providers design, with the same `--disable` flags and no effort.

### CUJ 3: Launch OpenCode

*   **Given**: OpenCode is installed. The model list shows the `free` group.
*   **When**: The user picks a model and an effort and launches.
*   **Then**: The argv is `env OPENCODE_CONFIG_CONTENT={"model":"<id>"} <argv> --standalone`, and the effort is written to `~/.local/state/opencode/model.json` before the tab opens.

### CUJ 4: Launch pi (new)

*   **Given**: pi is installed and has at least one logged-in provider, or none.
*   **When**: The user opens the pi flyout. Its model list starts with "Default", then `provider/model` entries. The user picks a thinking model, a THINKING level, ticks `session` and `offline` in TURN OFF, and launches.
*   **Then**: The argv is `pi --model <provider/id> --thinking <level> --no-session --offline`, in the order of the spec's `TURN OFF` items. Picking "Default" starts plain `pi`. If `pi --list-models` fails or prints no rows, the list is just "Default" and launching still works.

### CUJ 5: An existing settings file

*   **Given**: `agent-config.json` was written by the previous version, including `preset.advisor: false` or `onlyFree: false`.
*   **When**: A flyout opens.
*   **Then**: The saved model, effort, hidden models, group and preset load as before. No file is rewritten until the user changes something.

### CUJ 6: Adding an agent (developer)

*   **Given**: A new agent has a verified model flag and a list command.
*   **When**: A developer adds a spec in `shared/agent-flyout.js`, runs `node scripts/sync-shared.mjs`, and adds a parser if needed.
*   **Then**: The agent's row gets a chevron and a flyout with no change to `agent-config/main.js` or `orca-new-menu/main.js`.

## Technical Plan (Architecture)

### One source, two consumers

```text
shared/agent-flyout.js  ── node scripts/sync-shared.mjs ──►  mods/agent-config/agent-flyout.js
  SPECS (data)                                               mods/orca-new-menu/agent-flyout.js
  buildArgv, optionArgs, readValues, presetOf, readGroup, sectionsOf, parseModels, PARSERS

mods/orca-new-menu/models.js   MODELS = { ...every SPECS key → { flyout: true }, gemini…, grok…, omp…, antigravity… }
mods/agent-config/main.js      one View: reads SPECS[props.key], draws sections, builds the launch
```

`shared/agent-flyout.js` has no herdr or gpui imports, so `node --test` runs it directly.

### The spec

A spec is a plain object. Shape (all keys are data):

```text
spec = {
  label, command,
  models:  { shell, parser, default? },        # how the list is read; `default` adds a "no --model" first entry
  options: { <id>: option, … },
  launch:  [ <id>, … ],                        # the order options become arguments
  wrap?:   { env, suffix, after },             # OpenCode only: run through `env` and a suffix
  ui?:     { sections?, rows?, reset? }
}
```

Option types, each drawn once in `agent-config`:

| type | what it is | examples |
|---|---|---|
| `model` | model select + list; optional `groups` (a SHOW filter); models can be hidden | all four agents |
| `effort` | select over the chosen model's own `efforts` | EFFORT, THINKING |
| `select` | select over `choices`, or a hooked list (`source`) | Claude Advisor, Output style |
| `checklist` | ticked items, each a flag or a hooked expansion; optional all/clear links | Codex DISABLE, pi TURN OFF |
| `editor` | text editor with its own Save; `language: "json"` validates | Claude Agents, system prompt |
| `provider` | the Model source select (Codex only) | Codex MODEL PROVIDER |

### Arguments

An option's `argv` is a list of argv elements. `{v}` is the option's value, `{id}` a checklist item's id, and `{ json: <template> }` is `JSON.stringify` of the template with those filled in. Examples: `["--model","{v}"]`, `["-c","model_reasoning_effort={v}"]`, `["--settings",{"json":{"outputStyle":"{v}"}}]`.

`omit` lists values that add nothing (`"none"`, `"default"`). A blank value (empty, whitespace, null) always adds nothing. A checklist adds each ticked item's argv in item order; an item with `expand` takes its arguments from a hook.

`buildArgv(spec, base, values, { expansions, skip })` returns `base` followed by each `launch` option's arguments. `skip` leaves options out (a provider launch has its own model flag and no effort). A spec with `wrap` returns `["env", "NAME=value"…, ...base, ...args, ...suffix]`.

### What is saved

`agent-config.json` keeps, per agent: `model`, `effort`, `hidden`, `group` at the top, and every other option under `preset`, by option id. These are the keys the old code used (`advisorModel`, `outputStyle`, `agents`, `systemPrompt`, `codexOff`). `readValues` applies the old spellings: `advisor: false` becomes `"none"`; `codexOff` entries the spec does not list are dropped; `onlyFree: false` becomes group `all`. `presetOf` writes only the options the agent has (previously every agent's entry carried all five keys).

### Model lists

`models.shell` runs through `zsh -lic`. `models.parser` names one of four parsers, tested against output captured from the real CLIs:

*   `claudeInitialize`: reads the `control_response` line of Claude's stream-json `initialize` answer.
*   `codexCatalog`: `codex debug models`, visible models and their reasoning levels.
*   `opencodeCatalog`: `opencode api GET /api/model`, keeping the `opencode` and `omlx` providers, with group `free | paid | omlx` from cost.
*   `piTable`: `pi --list-models`. It finds each column from where its header word starts, so model names with dashes stay whole. A model whose `thinking` is `yes` gets efforts `["", off, minimal, low, medium, high, xhigh, max]`; others get none, which hides the effort select. The empty first level means "no `--thinking`".

A model-list parser is code, not data. A generic path language for four consumers was judged larger than the four functions (see Alternatives).

### Hooks (closed set)

Three names a spec can use, resolved in `agent-config/main.js`. A test checks every name in every spec is in these sets:

*   `source: "claudeOutputStyles"` on a select: the list is the built-in styles plus the `.md` files of `~/.claude/output-styles`, with a "+ New style…" entry that asks for a name and creates a file.
*   `expand: "codexMcp"` on a checklist item: reads `~/.codex/config.toml` and returns one `-c mcp_servers.<name>.enabled=false` per server.
*   `wrap.after: "opencodeVariant"`: writes the chosen effort to OpenCode's state file before launch.

The `provider` option type is a fourth special case; its launch goes through `launchArgv` from the Model providers design. A fifth hook would mean the option types are wrong.

### Sections and spacing

`sectionsOf(spec)` returns `ui.sections`, or two default sections: HARNESS CLI ARGUMENTS (the `model` and `effort` options) and, if there are more options, HARNESS CLI ADVANCED ARGUMENTS (the rest, in order). Codex declares three; its first is MODEL SOURCE. Each section has an optional `gap` (space between its controls; 8 when absent; the arguments section uses 4). `ui.rows` lists options that share one line (model and effort). `ui.reset` shows the Reset defaults button (Claude).

The renderer puts a label over each section, a one-pixel line between sections, and a 14 px gap above Launch.

### Launch flow

1.  `launch()` checks the agent is not disabled in Agent Manager (local spaces only).
2.  `buildLaunch()` reads the live editor text, blocks on invalid JSON, runs the hook for each ticked expansion, and for a Codex provider re-reads `model-providers.json` and re-validates the host.
3.  It returns `buildArgv(...)`, or for a provider `launchArgv(buildArgv(…, { skip: ["model","effort"] }), provider, model)`.
4.  `launch()` saves model/effort/hidden, runs `wrap.after` if any, opens the tab, closes the overlays.

### pi

Verified against pi 1.6.0 with `pi --help` and real runs (the model was a local oMLX model, so replies are meaningless; only acceptance of flags and exit status were checked):

*   `--model <provider/id>` accepted.
*   `--thinking` takes `off, minimal, low, medium, high, xhigh, max`. `--thinking bogus` prints `Warning: Invalid thinking level "bogus". Valid values: off, minimal, low, medium, high, xhigh, max`, which matches the spec's list.
*   All eight switches in TURN OFF are accepted together with exit 0: `--no-extensions`, `--no-mcp`, `--no-skills`, `--no-prompt-templates`, `--no-themes`, `--no-context-files`, `--no-session`, `--offline`.
*   A flag given twice (`--offline --offline`) is accepted.
*   `--thinking high` on a model whose `thinking` column is `no` is accepted without error; the spec hides THINKING for such models.
*   `--append-system-prompt` is accepted.

Deliberately not exposed: `--api-key` (a secret in argv), `--print`/`--mode`/`--export` (not interactive), `--session`, `--resume`, `--fork`, `--continue` (need a session id), and `--tools`/`--exclude-tools` (free-text lists; no list of tool names was verified).

### Behavior changes

The refactor aims for no visible change. These differ, on purpose:

1.  Codex with a model that has no reasoning levels no longer gets `-c model_reasoning_effort=undefined`; the argument is left out.
2.  OpenCode no longer has a divider line above Launch. The renderer draws a line between sections only, and OpenCode has one section.
3.  The ids of rendered controls changed (`advisor-select` is now `advisorModel-select`, `codex-off-*` is now `codexOff-*`, `save-prompt` is now `save-systemPrompt`). Nothing outside the file's tests reads them.
4.  Only one select list is open at a time (`this.open`). Before, opening the model list did not close the style or provider lists.
5.  A saved preset holds only the agent's own options.
6.  A plain row click on pi now opens its flyout and launches with the saved values, where before it started `pi` directly.

## Alternatives Considered

### Alternative A: Keep per-agent screens and add pi as a fourth

*   **Pros**: No refactor risk; smallest diff for pi.
*   **Cons**: A fourth copy of the model select and checklist code. The argument-building logic stays split between `argsFor` and `launch()`. Two agent lists stay.
*   **Reason for Rejection**: Rejected by author: it repeats the cost the change exists to remove, and each later agent adds another copy.

### Alternative B: Spec files as `.json` with a path language for model lists

*   **Pros**: Specs are readable by other tools. Model-list mapping would also be data.
*   **Cons**: No existing mod in the repo imports a `.json` file, so loader support in Herdr was unverified. A mapping language (jsonpath, filters, column tables, line-delimited JSON) for four consumers is more code than the four parsers.
*   **Reason for Rejection**: Rejected by author: the spec is exported from a JS module as plain data, with a test that it round-trips through JSON, which keeps the option of moving to `.json` later. Parsers stay as named code with captured-output fixtures.

### Alternative C: Build the spec from each CLI's `--help`

*   **Pros**: New flags would appear without a change.
*   **Cons**: Help text has no stable shape across CLIs, no types, and no way to tell which flags make sense in an interactive tab (`--api-key`, `--print`, `--export`).
*   **Reason for Rejection**: Rejected by author: which options to expose is a product decision, not something to read from help output.

### Alternative D: One generic option type with per-agent render functions

*   **Pros**: Fewer type names.
*   **Cons**: The per-agent code returns, one level down.
*   **Reason for Rejection**: Rejected by author: a closed set of six option types, each drawn once, is what makes adding an agent need no renderer code.

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Compatibility**: `agent-config.json` keys unchanged. Old spellings read. A test covers each.
*   **Security**: Arguments are argv elements, never shell words, so a prompt or JSON cannot be re-parsed by a shell. `--api-key` is not offered for pi. The provider key still comes from the provider file through the wrapper, not argv (Model providers design). Hooks are a fixed set; a spec cannot name code to run.
*   **Rollout and rollback**: Live files in `~/.config/herdr-app/` were replaced by the new set. To roll back, `git revert ccc6605` and copy the reverted `mods/agent-config/main.js`, `mods/orca-new-menu/models.js` back to the live folder, and delete the two live `agent-flyout.js` copies. The revert also removes the section layout and spacing, which are in the same commit.
*   **Performance**: A model list is cached in `agent-config.json` for ten minutes. After the cache expires, the list is re-read and the CLI version is checked in the background.

### Additional Resources

*   `docs/designs/model-provider-setup.md` (the Model providers design, whose Codex select this design draws).
*   `mods/orca-new-menu/models.js` (the inline-picker agents that remain).

### Future Improvements

*   **Move the inline-picker agents into the spec**, once each has a verified model flag and parser.
*   **Per-model thinking levels for pi**, if pi exposes them in `--list-models`.
*   **A shorter render snapshot** (see Q3).

--------------------------------------------------------------------------------

## Detailed Implementation Plan

All of this is implemented; the list is what a reviewer should open.

### Target Files to Create/Modify

#### 1. `shared/agent-flyout.js` (Create)

*   **Type / Scope**: Pure JavaScript module, the single source.
*   **Proposed Changes**: Exports `SPECS` (claude, codex, opencode, pi), `hasFlyout`, `sectionsOf`, `optionArgs`, `buildArgv`, `defaultValues`, `readValues`, `presetOf`, `readGroup`, `PARSERS`, `parseModels`, `PI_THINKING`, `DEFAULT_AGENTS_TEXT`, `DEFAULT_PROMPT`. Template filling, `omit` and blank rules, the `wrap` form for OpenCode.

#### 2. `mods/agent-config/agent-flyout.js` and `mods/orca-new-menu/agent-flyout.js` (Create, generated)

*   **Type / Scope**: Copies of the shared file with a generated header.
*   **Proposed Changes**: Written by `node scripts/sync-shared.mjs`; never edited by hand.

#### 3. `scripts/sync-shared.mjs` (Modify)

*   **Type / Scope**: Build script.
*   **Proposed Changes**: Register `agent-flyout.js` for `agent-config` and `orca-new-menu` in `USES`.

#### 4. `mods/agent-config/main.js` (Modify)

*   **Type / Scope**: The flyout View.
*   **Proposed Changes**: Remove `AGENTS`, `CODEX_FLAGS`, `OPENCODE_GROUPS`, `AGENT_LABEL`, the advisor constants and per-agent state (`advisorModel`, `codexOff`, `modelOpen`, `effortOpen`, `styleOpen`, `advisorOpen`, `providerOpen`). Add `spec`, `values`, `editors`, `open`. Add renderers by type (`selectControl`, `selectRow`, `checklist`, `editorElements`, `sectionBody`), `buildLaunch`, `setValue`, `toggleItem`, `setAllItems`, `saveEditor`, `listModels`. Keep the model list, hidden-model, provider and output-style code.

#### 5. `mods/orca-new-menu/models.js` (Modify)

*   **Type / Scope**: The New menu's per-agent model table.
*   **Proposed Changes**: Mark every `SPECS` key as `{ flyout: true }`; keep the inline pickers for the other agents.

#### 6. `scripts/gpui-stub-loader.mjs` (Modify)

*   **Type / Scope**: Test-only module hooks.
*   **Proposed Changes**: Add a `home()` stub so launch flows that read `~/.codex/config.toml` can run under `node --test`.

#### 7. `mods/agent-config/agent-flyout.test.js` (Create)

*   **Type / Scope**: Unit test for the shared module.
*   **Proposed Changes**: Spec is JSON-safe and names only resolvable hooks and parsers; `hasFlyout`; sections per agent; argv per agent; omit and blank rules; saved-settings read and write with old spellings; parsers against captured real output (Codex, OpenCode, pi) and a synthetic Claude line.

#### 8. `mods/agent-config/argv.golden.test.js` (Create)

*   **Type / Scope**: Flow test of `launch()`.
*   **Proposed Changes**: The argv each flyout agent hands to `tab.new`: Claude (defaults, no effort, full set, blanks, invalid JSON), Codex (`--disable` order, MCP from a fake `config.toml`, none ticked), OpenCode (env + `--standalone` + variant file), pi (full, Default, non-thinking model), and the `listModels` fallback. The Claude, Codex and OpenCode cases were written against the pre-spec code and passed unchanged afterwards.

#### 9. `mods/agent-config/render.golden.test.js` and `render.snap.json` (Create)

*   **Type / Scope**: Characterization test of the render tree for each agent state.
*   **Proposed Changes**: Records ten states (Codex ×3, Claude ×2, pi ×2, OpenCode ×3). The snapshot was re-recorded after the refactor; a script compared the old and new trees by counting identical style operations per node type. The only differences were the ones in "Behavior Changes", plus a wrapper element per section.

#### 10. `mods/agent-config/launch.test.js` (Modify)

*   **Type / Scope**: Existing Codex provider launch tests.
*   **Proposed Changes**: Build the view from the Codex spec; the section test now checks Codex and Claude.

#### 11. `docs/designs/model-provider-setup.md` (Modify)

*   **Type / Scope**: Documentation.
*   **Proposed Changes**: The launch site is `buildLaunch()`.

### Verification Plan

*   **Unit and flow tests**: `node --test mods/agent-config/*.test.js mods/orca-agent-manager/*.test.js mods/orca-new-menu/*.test.js scripts/*.test.mjs` (139 pass).
*   **Shared copies**: `node scripts/sync-shared.mjs --check` exits 0.
*   **Live config**: `herdr-app check ~/.config/herdr-app/mods/agent-config` and `…/orca-new-menu` pass; `herdr-app status` shows no errors.
*   **pi, real runs**: with `--model omlx/mlx-community--LFM2-VL-450M-4bit`, all TURN OFF switches plus `--append-system-prompt` exit 0; `--thinking bogus` prints the valid list.
*   **Not verified**: the rendered screens in the running app, in light or dark theme; a pi run on a thinking model with a real provider; any launch of Claude, Codex or OpenCode from the real menu. These need a person at the app.

--------------------------------------------------------------------------------

<!-- Provenance: Indicates initial structural drafting via EGM. -->

*Drafted with EGM*
