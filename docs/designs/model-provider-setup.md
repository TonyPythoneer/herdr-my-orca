# Model Provider Setup (Codex first)

*   **Author:** Tony Yang
*   **Status:** Draft, round 4 (simplified: plain config file, no Keychain, no named pipe)
*   **Date:** 2026-11-22

--------------------------------------------------------------------------------

## Overview

Herdr can start the Codex CLI against a second model source: oMLX, a local server on this Mac at `http://127.0.0.1:8000/v1`. Codex keeps one provider per run, so Herdr chooses the provider before it opens the tab.

The user sets up oMLX once in Herdr. Setup is saved only after a live test passes. Then each Codex launch can use `None` (the original OpenAI source, unchanged) or `oMLX`.

v1 supports Codex only. Several providers can be saved; each is one record with its own host, key, name and icon.

## Decisions

*   **D1 Name**: "Model provider".
*   **D2 Storage**: one plain JSON file, `appHome()/model-providers.json`, mode 0600. It holds the host, the API key, the project link, the icon path, the model list, and the verified time. No Keychain, no pipes. This follows how pi (`~/.pi/agent/models.json`) and opencode (`~/.config/opencode/opencode.jsonc`) already store oMLX settings.
*   **D3 Accepted risk**: the key is readable by any process running as the same user. It is also visible in the Codex session files if the environment is captured (see Risks). The author accepted this.
*   **D4 Setup location**: its own "Model providers" page in the main stack (`main-providers`, the hard-drive button in the sidebar footer), drawn by `mods/orca-agent-manager` with `props.page = "providers"`. The page is a list of provider cards plus a dashed "Add provider" card. A card opens into an editor (name, host, key, project link, Test and save, Delete).
*   **D5 Flyout row**: the Codex flyout (`mods/agent-config`) gets a "Model provider" dropdown directly under the "Codex" title, then a divider, then MODEL and EFFORT. The row shows `None` until a provider is chosen. Its list ends with an "Add More" row (plus icon) that opens the Model providers page and closes the menu and flyout, so it works with no provider saved.
*   **D6 Name and icon from one project link** (optional). A GitHub link names the provider by its repo and takes the owner's avatar (`https://github.com/<owner>.png?size=64`). Any other https link names it by its site and takes `<origin>/favicon.ico` (converted to PNG with `sips`). The name field stays editable: a link only fills it while it is empty or still holds the earlier suggestion. The icon is downloaded once into `appHome()/provider-icons/icon-<unique>.png` and read from there; a new link fetches again when its field is left, or at save if that has not happened. No link, or a failed fetch, means the default drive icon. A well-known local port (8000, 11434) offers a name and link as a suggestion.
*   **D7 Test**: `curl` with the key in an `Authorization` header, 5-second timeout. Passes on HTTP 200 with a non-empty `data` array. No timers, no polling.
*   **D8 No `shell_snapshot`**: Codex is started with `--disable shell_snapshot`. Without it, Codex writes the environment, including `OMLX_API_KEY`, into `~/.codex/shell_snapshots/` as plain text (tested).
*   **D9 Model choice per provider**: the chosen model is stored per (agent, provider), so a GPT model name is never sent to oMLX.
*   **D10 No effort for provider models**: the EFFORT control is hidden for oMLX models.

## Goals

*   G1. Setup page: a card per provider with name, host, key (shown as dots and its last four characters until Replace), project link (optional), "Test and save".
*   G2. Save only after the test passes. A failed test writes nothing.
*   G3. Codex flyout shows the "Model provider" row (D5).
*   G4. `None` launches Codex exactly as today.
*   G5. A provider launch adds `-m <model>` and four `-c` overrides, and does not change `~/.codex/config.toml`.
*   G6. The key never appears in a command-line argument at launch.
*   G7. No timers, no background checks.

## Non-Goals

*   Claude, opencode, or other agents (v1 is Codex only).
*   Merging OpenAI and oMLX models into one Codex `/model` list.
*   Provider kinds other than an OpenAI-compatible `/models` server. 
*   Key rotation UI beyond "edit and test again".
*   Remote Herdr spaces (`machine` set): the row is greyed out there.

## Critical User Journeys

### CUJ 1: Set up oMLX

*   **Given**: oMLX runs at `http://127.0.0.1:8000/v1` and requires a key.
*   **When**: The user enters host and key on the Model providers page, optionally a project link, and presses "Test and save".
*   **Then**: The test passes (HTTP 200, non-empty `data`). The icon is saved under `appHome()/provider-icons/`. `model-providers.json` is written. The Codex flyout row now lists oMLX.

### CUJ 2: Test fails

*   **When**: Host or key is wrong, or the server is down.
*   **Then**: One of these messages shows: "Cannot connect", "Key rejected" (401 or 403), "No /models at this host" (404), "Not a model server" (200 without `data`), "No models" (empty list). Nothing is written.

### CUJ 3: Zero providers

*   **Then**: The Codex "Model provider" row shows `None`. Its list holds `None` and "Add More", which opens the Model providers page.

### CUJ 4: Launch Codex with oMLX

*   **When**: The user presses Launch terminal with oMLX and a model selected.
*   **Then**: The tab runs the launch wrapper (below). The wrapper reads the key from `model-providers.json` into the `OMLX_API_KEY` environment variable, then `exec`s Codex. The key is not in the argument list.

### CUJ 5: Launch Codex with None

*   **Then**: Argument list identical to today's. No file read, no `-c` override.

### CUJ 6: Edit a provider

*   **When**: The user changes host or key and presses "Test and save".
*   **Then**: The new values are tested first. On pass they replace the saved record. On fail the saved record stays.

### CUJ 7: Delete a provider

*   **Then**: The record is removed from `model-providers.json` and the icon file is deleted. The Codex row shows `None` the next time the flyout opens. If a flyout is open with the deleted provider selected, Launch is blocked and the row switches to `None`.

## Storage

`appHome()/model-providers.json`:

```json
{
  "<provider id, a slug of the name, never changed>": {
    "name": "oMLX",
    "host": "http://127.0.0.1:8000/v1",
    "apiKey": "<key>",
    "link": "<normalized project link or empty>",
    "iconPath": "<appHome()>/provider-icons/icon-<unique>.png or empty",
    "verifiedAt": "2026-11-22T10:00:00Z",
    "models": ["<model-id>", "..."],
    "selectedModel": { "codex": "<model-id>" }
  }
}
```

*   The file is written only after a passing test (or on delete).
*   Create the file with mode 0600 if possible. Herdr's `writeTextFile` may reset the mode on replace, so run `exec("chmod", ["600", path])` after every write and check it with `stat`.
*   Keep the `appHome()/provider-icons/` directory and the file inside `appHome()`, which is already the user's private Herdr folder.

## Launch

For `oMLX`, the tab runs this argument list. `WRAPPER` is a constant string:

```text
WRAPPER = export OMLX_API_KEY="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]]["apiKey"])' "$1" "$2")"; shift 2; exec "$@"
(tested with a key containing ", \, and $: the value arrives intact, and the key is not in argv)

argv = [ "/bin/sh", "-c", WRAPPER, "--",
         "<appHome>/model-providers.json",
         "<provider id>",
         "codex", "--disable", "shell_snapshot", ...today's args,
         "-m", "<model-id>",
         "-c", 'model_provider="omlx"',
         "-c", 'model_providers.omlx.name="oMLX"',
         "-c", 'model_providers.omlx.base_url="http://127.0.0.1:8000/v1"',
         "-c", 'model_providers.omlx.env_key="OMLX_API_KEY"' ]
```

*   The key is read inside the shell, so it is not in argv. The wrapper looks it up by the record's
    own id, so the key and the host always come from the same record.
*   The Codex name `omlx` in the `-c` overrides is a fixed alias: no value from the file is ever
    spelled into a config string.
*   `None` keeps today's argv exactly.
*   There is one launch site for every flyout agent: `mods/agent-config/main.js` `buildLaunch()` builds the argv from the agent's spec (`shared/agent-flyout.js`), and `launch()` hands it to `run("tab.new", …)`. The provider case is the branch of `buildLaunch()` that skips the spec's model and effort options and passes the rest through `launchArgv`.

## Risks

| Risk | Handling |
|---|---|
| Key readable by same-user processes | Accepted (D3). Same as pi and opencode. |
| Key in Codex shell snapshot | `--disable shell_snapshot` (D8). Tested: no new snapshot, no key in new session files. |
| Key in old Codex session file (2026-11-20 rollout) | Left in place at the author's request. |
| Key in curl argv during the test (5 seconds, visible to `ps`) | Accepted. Same user can read the file anyway. |
| Herdr write resets file mode | `chmod 600` after each write (Storage). |
| Codex model metadata missing | Small models may fail with "ran out of room in the model's context window". Not in v1. Test model is `mlx-community--LFM2-VL-450M-4bit`. |
| Host down at launch | Codex shows its own error in the tab. No retry (accepted). |

## Verification

1.  [auto] `curl` test passes for oMLX with the real key, fails with a wrong key ("Key rejected").
2.  [auto] A failed test leaves `model-providers.json` unchanged.
3.  [oMLX, auto] Ping-pong: run the Codex command from the Launch section with `mlx-community--LFM2-VL-450M-4bit` and the prompt "Reply with the single word OK." Pass: exit 0 and a reply. Result on 2026-11-22: exit 0, reply received.
4.  [oMLX, auto] After step 3: `ls ~/.codex/shell_snapshots` shows no new files, and no new session file under `~/.codex/sessions` contains the key.
5.  [human] Launch from the flyout: the tab opens Codex with oMLX selected.
6.  [auto] With `None`, the argv equals the argv from before the change.
7.  [auto] Zero providers: the row shows `None` and opens a list with Add More; Add More opens the Model providers page.
8.  [auto] Delete: record removed, icon removed, row shows `None`.

## Implementation Files

1.  `mods/agent-config/main.js` (modify): `buildLaunch()` argv for a provider; the Model source section (a select, like MODEL and EFFORT); read `model-providers.json`. The sections and controls are drawn from the agent's spec in `shared/agent-flyout.js`.
2.  `mods/orca-agent-manager/` (modify): "Model providers" section in Agent Settings; save order (test, write file, chmod, icon); delete.
3.  `mods/agent-config/codex-provider.js` (create): pure functions: `validateHost`, `judgeModels(status, body)`, `launchArgv(baseArgv, provider, model)`. Imported by the mods.
4.  `mods/agent-config/codex-provider.test.js` (create): unit tests for the functions above.
5.  Icon fetch: `exec curl` to `https://github.com/<owner>.png?size=64`, save only if the first bytes are PNG, 256 KB cap, 5-second timeout.
6.  Both repo and `~/.config/herdr-app/` get the same change (`herdr-app-dev-sync`).

--------------------------------------------------------------------------------

*Drafted with EGM*
