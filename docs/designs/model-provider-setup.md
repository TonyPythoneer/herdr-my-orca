# Model Provider Setup (Codex first)

*   **Author:** Tony Yang
*   **Status:** Draft (round 2: open questions answered, see Decisions)
*   **Date:** 2026-11-22

--------------------------------------------------------------------------------

## Overview

Herdr can start the Codex CLI against a second model source, oMLX, a local server on this Mac. Codex keeps only one active provider at a time, and its `/model` list does not merge providers. So Herdr makes the choice before it opens the tab. The user adds a provider once in Herdr, Herdr checks that it works, and then each Codex launch can use `None` (the original OpenAI source, unchanged) or `oMLX`.

This spec covers the setup screen, the verification test, secure storage of the key, the Codex flyout's provider row, and the Codex launch arguments. v1 supports Codex only.

## Decisions (answered in round 2)

*   **D1 Name**: "Model provider". Not "BYOK". oMLX on localhost may need no key, so "BYOK" would mislead.
*   **D2 Placement**: The Codex flyout (the screen that opens when a user picks Codex in the New menu) gets a **"Model provider" dropdown directly under the "Codex" title**. A divider line comes next. Below the divider are the existing controls: MODEL, EFFORT, DISABLE, and the Launch button. The MODEL list shows the models of the selected provider.
*   **D3 Network test and icon fetch use `exec curl`, with the curl config fed through a named pipe (FIFO).** The runtime's `fetch` is blocked by a network grant that could not be set (see Q-A). The FIFO keeps the key out of argument lists and off disk. See Technical Plan.
*   **D4 Re-test is event-driven only.** No timers, no polling. See "Event Triggers".
*   **D5 Icon download is https only.** This is a choice made for this feature, not a platform limit. The oMLX host itself is `http://127.0.0.1` and is allowed. Only icon URLs are restricted to https.

## Goals

*   G1. A "Model provider setup" screen in `agent-config` takes an API host, an API key, and an optional GitHub or website link.
*   G2. A provider counts as set up only after a live test passes. A failed test saves nothing.
*   G3. The key is stored in macOS Keychain. On non-macOS, it is stored in a file readable only by the owner (mode 0600).
*   G4. The Codex flyout has a "Model provider" dropdown under the title (see D2). It lists `None` plus every set-up provider.
*   G5. With zero set-up providers, that dropdown is greyed out and shows `None`.
*   G6. Choosing `None` launches Codex exactly as it does today, with no added arguments.
*   G7. Choosing a provider launches Codex with `-c` overrides only. `~/.codex/config.toml` is never written.
*   G8. The key never appears in any command-line argument list (`ps`, tab command logs, or process listings).
*   G9. Nothing runs on a timer. Every check starts from a user action.

## Non-Goals

*   NG1. Claude, opencode, or any agent other than Codex. Their flyouts do not show the row in v1.
*   NG2. Merging OpenAI and oMLX into one `/model` list inside Codex.
*   NG3. Ollama, LM Studio, or any second local provider. The data model allows more, but no UI is built for them in v1.
*   NG4. Rotating a key in place. Changing a key means editing the provider, which runs the test again (see Event Triggers).
*   NG5. Changing oMLX itself, or reading oMLX's own key store.
*   NG6. Background health checks.

## Open Questions

*   **Q-A (resolved: `fetch` is not used)**: `herdr-app check` on a probe mod returns `HTTP request ... is not granted` for both `127.0.0.1` and `github.com`. Four `capabilities.network` shapes in `mod.json` were tried, and none took effect. No existing mod declares capabilities. The design therefore uses `exec curl`. Existing mods already call `exec` without declaring anything (`mods/agent-config/main.js:38`).
*   **Q-B (resolved: named pipe for stdin)**: `exec` takes no stdin option (`~/.config/herdr-app/herdr.d.ts`). A FIFO (named pipe) carries the data instead. The key moves through the pipe buffer and never becomes a file's content. Verified in the shell: a key containing `"`, `\`, and `$` round-trips exactly through `security find-generic-password`.
*   **Q-C (masked input)**: Whether the gpui `Input` has a password mode is still unchecked.
*   **Q-D (login shell)**: Existing mods run `exec("zsh", ["-lic", …])` for CLI calls, so PATH resolves there. The tab created by `tab.new` still needs a check, because the launch wrapper calls `security` and `codex` inside it.
*   **Q-E (test runner)**: The repo's test convention is not yet checked.

## Critical User Journeys (CUJs)

### CUJ 1: Set up oMLX successfully

*   **Given**: oMLX is running at `http://127.0.0.1:8000/v1` and requires a key. No provider is set up.
*   **When**: The user opens Model provider setup, enters the host and key, optionally adds `https://github.com/<owner>`, and presses "Test and save".
*   **Then**: Herdr calls `GET {host}/models` with the key through `fetch`. The response is 200 and `data[]` is not empty. The key is written to Keychain. The icon is saved under appHome. `{name, host, iconPath, verifiedAt}` is written to `agent-config.json`. The provider appears in the Codex "Model provider" dropdown.

### CUJ 2: Test fails, nothing is saved

*   **Given**: The host is wrong, or the key is wrong.
*   **When**: The user presses "Test and save".
*   **Then**: The setup shows the reason: cannot connect, 401 or 403 (key rejected), or empty model list. No Keychain item is created. No entry is written to `agent-config.json`. The user can fix the fields and try again.

### CUJ 3: Zero providers set up

*   **Given**: No provider has passed its test.
*   **When**: The user opens the Codex flyout.
*   **Then**: The "Model provider" dropdown is greyed out and shows `None`. It cannot be opened.

### CUJ 4: Launch Codex with oMLX

*   **Given**: oMLX is set up. The user chose `oMLX` in the dropdown and a model from its list.
*   **When**: The user presses Launch terminal.
*   **Then**: The tab runs Codex with `-m <model>` and the four `-c` overrides from the Technical Plan. Inside the shell, the key is read from Keychain into `OMLX_API_KEY`, and Codex starts. The key appears in no argument list. No test runs at launch.

### CUJ 5: Launch Codex with None

*   **Given**: Any state.
*   **When**: The user launches with `None`.
*   **Then**: The argument list is identical to today's. No Keychain read happens. No `-c` override is added.

### CUJ 6: Provider edited

*   **Given**: oMLX is set up.
*   **When**: The user changes the host or the key in setup and presses "Test and save".
*   **Then**: The new values are tested first. On pass, they replace the saved values (Keychain item and JSON entry). On fail, the saved values stay as they were and the reason is shown.

### CUJ 7: Provider deleted while selected

*   **Given**: Codex's selected provider is `oMLX`.
*   **When**: The user deletes oMLX in setup.
*   **Then**: The Keychain item and the icon file are removed. The dropdown falls back to `None`. The stored model for `(codex, omlx)` is removed.

### CUJ 8: Provider is down at launch

*   **Given**: oMLX is set up but its server is stopped.
*   **When**: The user launches Codex with `oMLX`.
*   **Then**: The launch still runs. Codex's error appears in the new tab. Herdr does not retry, and does not fall back to `None`. This is accepted for v1.

## Event Triggers (no polling)

Every network call and every Keychain write in this feature starts from one of these events. Nothing else.

| Event | What runs | Notes |
|---|---|---|
| User presses "Test and save" | Test (`fetch`), then Keychain write, icon fetch, JSON write | CUJ 1, 2, 6 |
| User presses "Delete" on a provider | Keychain delete, file delete, JSON write | CUJ 7 |
| User opens the Codex model dropdown with a provider selected | Read the cached model list from the saved provider record | No network call on open |
| User presses "Refresh models" in the dropdown | `GET {host}/models` | Only way to refresh the list. No time-based expiry. |
| User presses Launch terminal | Keychain read inside the tab shell, then Codex starts | No test runs |

The existing `MODELS_FRESH_MS` ten-minute expiry in `mods/orca-new-menu/main.js:41` is time-based. It is removed for this feature and replaced by the explicit refresh above.

"Verified" in the saved record means "passed at setup". It does not mean "reachable now". A provider that goes down later shows its error when Codex launches (CUJ 8).

## Technical Plan (Architecture)

Three data stores, each with one job:

| Data | Where | Why there |
|---|---|---|
| Host, name, icon path, verified time | `appHome()/agent-config.json` (new `providers` array) | Already the home of per-agent settings |
| Key | macOS Keychain, service `herdr-provider-<id>` (non-macOS: `appHome()/secrets/<id>.key`, mode 0600) | Keeps the secret out of plain JSON |
| Icon | `appHome()/provider-icons/<id>.<ext>` | Local copy, so the UI never fetches at render time |

Storage shape in `agent-config.json`:

```text
providers: [ { id: "omlx", name: "oMLX", host: "http://127.0.0.1:8000/v1",
               iconPath: "...", verifiedAt: "2026-11-22T10:00:00Z" } ]
selectedProvider: { codex: "omlx" }        // absent = None
models: { "codex|omlx": "<model-id>" }      // model is per (agent, provider)
```

### Test: curl through a named pipe

```text
[Setup form] key and host in memory
     |
     v
mkfifo <pipe>                                   (mode 600)
exec("sh", ["-c", 'curl --config "$1" ...', "--", <pipe>])   (reader starts first)
write into <pipe>:  url = "<host>/models"
                    header = "Authorization: Bearer <key>"
                    max-time = 5
     |  HTTP 200 and data[] non-empty?
     +-- no  --> show reason, write nothing
     |
     yes
     v
(continue to Keychain write)
```

The key goes through the pipe, where curl reads it as its config. It is never an argument to a process and never a file's content. Verified in the shell against oMLX with a dummy key: the header reached the server, and oMLX answered `Invalid API key`, so the transport works.

### Keychain write: named pipe plus `security -i`

`security -i` reads its commands from stdin. `exec` cannot pass stdin, so a FIFO stands in for it:

```text
1. exec("mkfifo", ["-m", "600", <pipe path>])
2. exec("sh", ["-c", 'security -i < "$1"', "--", <pipe path>])   (started first, blocks until data arrives)
3. write into <pipe>:  add-generic-password -U -s herdr-provider-omlx -a omlx -w "<escaped key>"
4. delete the pipe in a finally block, whether or not steps 2 and 3 passed
```

Keys containing `"`, `\`, or `$` are escaped for the `security -i` line. Verified in the shell. Residual risk: if the reader never opens the pipe, the write waits. The reader is started first, so this only happens if `sh` fails to start, and the implementation needs a timeout for that case.

Non-macOS: `fs/promises.writeFile` writes `appHome()/secrets/<id>.key`. It cannot set a mode, so `exec("chmod", ["600", path])` runs right after, and the mode is checked.

### Codex launch flow

```text
Row = None:    argv = [codex, ...today's args]                          (unchanged)
Row = omlx:    argv = [sh, -c, WRAPPER, --, codex, ...today's args,
                       -m, <model>,
                       -c, model_provider="omlx",
                       -c, model_providers.omlx.name="oMLX",
                       -c, model_providers.omlx.base_url="<host>",
                       -c, model_providers.omlx.env_key="OMLX_API_KEY"]

WRAPPER = 'OMLX_API_KEY=$(security find-generic-password -s herdr-provider-omlx -w) exec "$@"'
```

The four `-c` overrides match oMLX's own launcher (`omlx/integrations/codex.py:_provider_overrides`). oMLX sets no `wire_api`, so this spec sets none.

The `security find-generic-password -w` output goes into the shell variable, never into an argument. Precedent to avoid copying: `mods/orca-status/local-usage.js:28`.

Both launch paths use one shared argument builder. The agent-config launch (`mods/agent-config/main.js:561`) and the New menu flyout (`mods/orca-new-menu/main.js:361`, `:432`) must not drift.

### Flyout layout (Codex)

```text
+------------------------------------+
| Codex                              |
| Model provider  [ None        ▾ ]  |   <- new row, greyed if 0 providers
| ----------------------------------  |   <- new divider
| MODEL   [ GPT-6.1 Terra       ▾ ]  |   <- list = selected provider's models
| EFFORT  [ Low                 ▾ ]  |
| DISABLE  all  clear                 |
|   [ ] plugins   [ ] apps  ...       |
| [ Launch terminal            ↵ ]    |
+------------------------------------+
```

## Alternatives Considered

### Alternative A: Write `~/.codex/config.toml` with a provider block

*   **Pros**: Codex reads it natively; `/model` would show the provider.
*   **Cons**: Changes the user's global Codex config. Two Herdr tabs cannot use different providers at once.
*   **Reason for Rejection**: Rejected by author: the choice must be per tab.

### Alternative B: Pass the key in the launch argument (`env OMLX_API_KEY=... codex`)

*   **Pros**: One line, matches the opencode precedent in this repo.
*   **Cons**: The key shows in `ps` and in tab command logs.
*   **Reason for Rejection**: Rejected by author: violates G8.

### Alternative C: Store the key in the JSON file with mode 0600

*   **Pros**: Simple, works on every platform.
*   **Cons**: Plain text on disk, readable by any process running as the user, and the first secret in the repo.
*   **Reason for Rejection**: Rejected by author for macOS. Kept as the non-macOS fallback only.

### Alternative D: Let oMLX's own `launch codex` do the work

*   **Pros**: Already exists.
*   **Cons**: Herdr cannot read its state, cannot choose `None` in the same flow, and oMLX rewrites Codex config.
*   **Reason for Rejection**: Rejected by author: no per-tab choice.

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Security & Privacy**: The key reaches Keychain only through a named pipe read by `security -i`. It never goes into an argument list, a file, or a log. The test sends the key only through a curl config on a named pipe. Icon downloads are https only, time-limited (5 seconds), size-capped at 256 KB, and checked for PNG, JPEG, GIF, WebP, or ICO magic bytes before they are saved.
*   **Performance & Latency**: The test is one request with a 5-second timeout. The model list is read from the saved record, so opening the dropdown makes no network call.
*   **Rollout & Rollback**: Ship behind the Codex row only. With no providers saved, behavior matches today. Rollback: remove the `providers` key and delete the `herdr-provider-*` Keychain items.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

### Target Files to Create/Modify

#### 1. `shared/codex-provider.js` (Create)

*   **Type / Scope**: Pure JavaScript, no Herdr API calls, so it can be unit tested.
*   **Proposed Changes**:
    *   `validateHost(url)`: requires `http:` or `https:`, no spaces, strips a trailing slash. Returns the normalized host or an error string.
    *   `judgeModels(status, body)`: returns `{ok: true, models}` only when status is 200, `data` is an array, and it is non-empty. Maps 401 and 403 to "key rejected", a network error to "cannot connect", and empty data to "no models".
    *   `codexProviderArgs(provider, model)`: returns `-m` and the four `-c` pairs. The `name` value comes from the provider record.
    *   `launchWrapper(envName, keychainService)`: returns the `sh -c` string. Both values come from the provider record, never from free text, to avoid shell injection.
    *   `keychainLine(service, account, key)`: returns the one-line `security -i` command with escaping for `"`, `\`, `$`.
    *   Shortcut: one provider id (`omlx`) maps to a fixed env name; upgrade the constant map when a second provider is added.
*   **Tests**: `shared/codex-provider.test.js`. Cases: 200 with models passes; 200 with empty `data` fails; 401 gives "key rejected"; `ftp:` scheme rejected; `None` gives an empty argument list; `omlx` gives exactly the five items; `keychainLine` escapes a key containing `"`, `\`, and `$`.

#### 2. `shared/keychain.js` (Create)

*   **Type / Scope**: Wrapper over `exec` and `fs/promises`.
*   **Proposed Changes**:
    *   `saveKey(service, account, key)`: creates the pipe (`mkfifo`, mode 600), starts `sh -c 'security -i < "$1"'` on it, writes the escaped command line into it, and removes the pipe in `finally`. Includes a timeout for the reader-never-opens case.
    *   `deleteKey(service, account)`: `security delete-generic-password -s <service> -a <account>`. Contains no secret.
    *   Non-macOS: `writeFile` then `exec("chmod", ["600", path])`, and check the mode.
    *   `readKeyFragment(service)`: returns the shell fragment used by the launch wrapper.
*   **Tests**: The argument list of each `exec` call contains no key. The temp file is gone after success and after a forced failure. Non-macOS path against a temp `appHome`.

#### 3. `shared/provider-icon.js` (Create)

*   **Type / Scope**: Best-effort icon fetch through `exec curl` (no key involved, so plain arguments are fine).
*   **Proposed Changes**:
    *   GitHub link `https://github.com/<owner>`: fetch `https://github.com/<owner>.png`.
    *   Website link: fetch the page, read `<link rel="icon">`, else `/favicon.ico`. Resolve relative URLs.
    *   https only; magic-byte check; 256 KB cap; 5-second timeout. Any failure returns `null` and the UI shows a letter badge.
*   **Tests**: PNG passes; HTML error page is rejected; non-https URL is rejected.

#### 4. `mods/agent-config/main.js` (Modify)

*   **Type / Scope**: Herdr mod, the Agent Settings page.
*   **Proposed Changes**:
    *   Add the `providers` array and `selectedProvider` map to the settings loader (`SETTINGS`, line 156), read with the same optimistic-concurrency snapshot used for `model`.
    *   Add `providerSetupView()`: host, key (masked, Q-C), optional link, "Test and save", the list of set-up providers, and "Delete" per provider. Styling follows `editorView` in `mods/orca-agent-manager/views.js:133`.
    *   Implement the save order: test, Keychain write, icon, JSON write last.
    *   In the launch function (line 561), for Codex with a selected provider, use `codexProviderArgs` and `launchWrapper`. For `None`, argv stays exactly as today.

#### 5. `mods/orca-new-menu/main.js` (Modify)

*   **Type / Scope**: Herdr mod, New menu Codex flyout.
*   **Proposed Changes**:
    *   Add the "Model provider" dropdown directly under the Codex title, then a divider, then the existing MODEL, EFFORT, DISABLE controls (D2). The row is disabled with `None` when zero providers are set up.
    *   MODEL list = the selected provider's cached models. "Refresh models" triggers `GET {host}/models` (event trigger).
    *   Remove the time-based `MODELS_FRESH_MS` expiry for this path (line 41).
    *   At launch (lines 361 and 432), use the shared builder. No duplicate argument logic.
    *   If the saved selection points to a deleted provider, fall back to `None` and show a one-line notice.

#### 6. Catalog cache (Modify, if needed)

*   **Type / Scope**: Model list storage.
*   **Proposed Changes**: Keep the model list per provider id, so switching provider never reuses GPT model names for oMLX.

#### 7. Live config and repo sync (Modify, both locations)

*   **Type / Scope**: Herdr App UI files.
*   **Proposed Changes**: Every edit lands in the repo and in `~/.config/herdr-app/`, per `herdr-app-dev-sync`. No temporary probe mods in the live layout.

#### 8. Tests (Create)

*   `shared/codex-provider.test.js`, `shared/keychain.test.js`, `shared/provider-icon.test.js`, as listed above. Runner per Q-E.

### Verification Plan

Order matters. Each step must pass before the next starts.

1.  **Transport (Q-A, Q-B)**: Verified in the shell already: a pipe-fed curl reaches oMLX, and a pipe-fed `security -i` write round-trips a special-character key. Re-run both from inside the mod runtime once the code exists.
2.  **Unit**: `shared/*.test.js` pass, including the "no key in argv" and "temp file removed" tests.
3.  **Live test against oMLX**: Setup with the real key passes. Wrong key fails with "key rejected". Stopped server fails with "cannot connect". A failed run leaves no Keychain item (`security find-generic-password -s herdr-provider-omlx` returns not found), no JSON entry, and no pipe left behind.
4.  **Argument check**: With `oMLX` selected, capture the process argument list (`ps -o args= -p <pid>`). It must not contain the key. With `None`, the list matches the pre-change output exactly.
5.  **Codex runs**: `codex exec` with the oMLX provider completes one request. This confirms the nested `-c` works on Codex 0.171.0. If it fails, stop and report. Do not change `wire_api` without a reproduced failure.
6.  **Event-only check**: `grep -n "setInterval\|setTimeout" shared/codex-provider.js shared/keychain.js shared/provider-icon.js` returns nothing, and the flyout code added here has no timer. Opening the dropdown makes no network call (check the network log).
7.  **Edit fails keeps old values**: Edit a saved provider with a wrong host. The saved host and key are unchanged.
8.  **Delete**: Selected provider deleted. Dropdown falls back to `None`; Keychain item, icon file, and model entry are gone.
9.  **Zero-provider state**: Dropdown greyed out with `None`.
10. **Non-macOS path**: Simulate `os.platform() !== "darwin"` in a unit test.

Risky: `exec` itself. Existing mods call `exec` with no declared capability, so it is expected to work. If a mod's `exec` is refused, the design changes and this spec is revised before implementation.

--------------------------------------------------------------------------------

*Drafted with EGM*
