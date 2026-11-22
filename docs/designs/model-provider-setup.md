# Model Provider Setup (Codex first)

*   **Author:** Tony Yang
*   **Status:** Draft (round 3: review fixes; open items are listed in Open Questions with a check for each)
*   **Date:** 2026-11-22

--------------------------------------------------------------------------------

## Overview

Herdr can start the Codex CLI against a second model source, oMLX, a local server on this Mac. Codex keeps only one active provider at a time, and its `/model` list does not merge providers. So Herdr makes the choice before it opens the tab. The user adds a provider once in Herdr, Herdr checks that it works, and then each Codex launch can use `None` (the original OpenAI source, unchanged) or `oMLX`.

This spec covers the setup screen, the verification test, secure storage of the key, the Codex flyout's provider row, and the Codex launch arguments. v1 supports Codex only.

Where things live today (read from the code at commit `0362780`):

*   The **Codex flyout** (title, MODEL and EFFORT selects, DISABLE list, Launch terminal) is the `agent-config` mod, a 300px popup. `orca-new-menu` opens it from the Codex row's chevron (`mods/orca-new-menu/main.js:415-437`) and passes `argv: agent.run` (`:432`). Codex is a `flyout: true` agent (`mods/orca-new-menu/models.js`), so `orca-new-menu`'s own `launch()` (`:359-362`) never launches Codex.
*   The only Codex launch is `AgentConfig.launch()` in `mods/agent-config/main.js` (argv built at `:561`, `run("tab.new", …)` at `:570`). Both the flyout's Launch button and a click on the Codex row (`launchNow`) end there.
*   The **Agent Settings page** is the `orca-agent-manager` mod (layout child `main-agents`, `layouts/orca.json:158-161`).

## Decisions (answered in round 2; D6-D10 added in round 3)

*   **D1 Name**: "Model provider". Not "BYOK". oMLX on localhost may need no key, so "BYOK" would mislead.
*   **D2 Placement**: The Codex flyout (`agent-config`) gets a **"Model provider" dropdown directly under the "Codex" title**. A new divider comes next. Below it are the existing controls: MODEL and EFFORT (side by side), the existing divider, DISABLE, and the Launch button. The MODEL list shows the models of the selected provider.
*   **D3 Network test and icon fetch use `exec curl`.** For the test, the curl config (which holds the key) is fed through a named pipe (FIFO). The runtime's `fetch` is not granted to mods (see Q-A). The FIFO keeps the key out of argument lists and off disk. See Technical Plan.
*   **D4 Re-test is event-driven only.** No timers, no polling. See "Event Triggers".
*   **D5 Icon download is https only.** This is a choice made for this feature, not a platform limit. The oMLX host itself is `http://127.0.0.1` and is allowed. Only icon URLs are restricted to https.
*   **D6 Setup screen location (default, author can change)**: a "Model providers" section in the Agent Settings page (`mods/orca-agent-manager`). Not in `agent-config`: that mod is a 300px popup that closes on Esc or a click outside, which would drop a half-typed key and cancel a test in flight. A page that is hidden or switched away from is not closed (`gpui-kit.d.ts:564-568`), so a running save finishes.
*   **D7 Provider records get their own file (default)**: `appHome()/model-providers.json`. The flyout's selection stays in `agent-config.json`. Every write to `model-providers.json` reads the file fresh, changes it, and calls `writeTextFile(path, next, textJustRead)`. If that rejects (stale snapshot), it reads and applies the change once more. A second rejection shows "Settings changed elsewhere. Try again." This is one bounded re-apply, not a retry loop. The existing `persist()` in `agent-config` (`mods/agent-config/main.js:334-345`) swallows write errors, so provider writes must not go through it.
*   **D8 One provider in v1 (default)**: the only provider id is `omlx`, name `oMLX`, env name `OMLX_API_KEY`. "Test and save" on the setup form creates the `omlx` record or replaces it. Two records with the same id cannot exist. A key is required in v1 (keyless servers are NG7).
*   **D9 Where the provider row works (default)**: local spaces on macOS and Linux only. When the target space has a `machine` (a remote host, where neither the Keychain item nor `127.0.0.1` would be the user's), the row is greyed out and shows `None`. On Windows (`window().platform === "windows"`) the setup section and the row are not shown: the design needs `sh`, `mkfifo` and `chmod`.
*   **D10 No effort for provider models (default)**: oMLX model rows have `efforts: []`. The flyout already hides EFFORT for a model with no efforts (`mods/agent-config/main.js:797`, `:814`), and the launch adds no `model_reasoning_effort` override.

## Goals

*   G1. A "Model providers" section in the Agent Settings page (D6) takes an API host, an API key, and an optional GitHub or website link.
*   G2. A provider counts as set up only after a live test passes. A failed test saves nothing.
*   G3. The key is stored in macOS Keychain. On Linux, it is stored in a file readable only by the owner (mode 0600) inside a directory with mode 0700.
*   G4. The Codex flyout has a "Model provider" dropdown under the title (see D2). It lists `None` plus every set-up provider.
*   G5. With zero set-up providers, or a remote target space (D9), that dropdown is greyed out and shows `None`.
*   G6. Choosing `None` launches Codex exactly as it does today, with no added arguments.
*   G7. Choosing a provider launches Codex with `-c` overrides only. `~/.codex/config.toml` is never written.
*   G8. The key never appears in any command-line argument list (`ps`, tab command logs, or process listings).
*   G9. Nothing runs on a timer. Every network call and Keychain access starts from a user action or from a mod copy opening (see Event Triggers).

## Non-Goals

*   NG1. Claude, opencode, or any agent other than Codex. Their flyouts do not show the row in v1.
*   NG2. Merging OpenAI and oMLX into one `/model` list inside Codex.
*   NG3. Ollama, LM Studio, or any second local provider. The data model allows more, but no UI is built for them in v1.
*   NG4. Rotating a key in place. Changing a key means editing the provider, which runs the test again (see Event Triggers).
*   NG5. Changing oMLX itself, or reading oMLX's own key store.
*   NG6. Background health checks.
*   NG7. Providers that need no key. v1 requires a key (D8).
*   NG8. Remote spaces and Windows (D9).
*   NG9. Reasoning effort for provider models (D10).

## Open Questions

Resolved:

*   **Q-A (resolved: `fetch` is not used)**: `herdr-app check` on a probe mod returns `HTTP request ... is not granted` for both `127.0.0.1` and `github.com`. Four `capabilities.network` shapes in `mod.json` were tried, and none took effect. No mod declares capabilities (no `mod.json` under `~/.config/herdr-app/mods/` mentions one). The design therefore uses `exec curl`. More than 30 live mods call `exec` with a `mod.json` of only `{ "place": "none" }`, for example `mods/agent-config/main.js:38`, so `exec` needs no declared capability.
*   **Q-B (resolved in the shell; runtime part is Q-F)**: `exec` takes only `cwd`, `on` and `timeout` (`herdr.d.ts:14`): no stdin, no env. A FIFO (named pipe) carries the data instead. Author-verified in the shell: a key containing `"`, `\`, and `$` round-trips exactly through `security -i` and `security find-generic-password`. Re-checked in round 3 with a dummy key: a curl config read from a FIFO sends `Authorization: Bearer d"u\m$my` when the config line is `header = "Authorization: Bearer d\"u\\m$my"` (curl escapes are `\"` and `\\`; `$` is literal), and oMLX answers 401 `Invalid API key`.
*   **Q-C (resolved: masked input exists)**: `InputState.set_masked(true)` draws the text as a password (`gpui-kit.d.ts:21413`). `InputState.new` takes only `placeholder` and `value` (`:21422`), so call `set_masked(true)` right after creating it.
*   **Q-D (resolved: the tab runs argv in a login interactive zsh)**: a Codex/Claude tab opened with `tab.new {argv}` runs as `/bin/zsh -lic '"$@"; exec "$0" -li' /bin/zsh <argv...>` under `herdr-core hold` (seen with `ps -o pid,ppid,args` on a running agent tab). So: argv elements arrive as separate words with no splitting; PATH is the login shell's, so `codex` resolves as it does today; `/usr/bin/security` is on every macOS PATH and the wrapper uses the absolute path anyway; and when the command exits, the tab becomes a login shell, so a wrapper error message stays visible.
*   **Q-E (resolved: test runner)**: `node --test mods scripts` (`docs/handoff.md:15`). Tests are `*.test.js` next to the code, using `node:test`. A mod cannot import outside its own folder, so `shared/<name>.js` is copied into each mod listed in `USES` in `scripts/sync-shared.mjs`; `node scripts/sync-shared.mjs --check` fails on a stale copy. `node --test mods scripts` does not run tests in `shared/`, so tests import the copy inside a mod (as `mods/orca-spaces/review-store.test.js` does).

Open, each with its check:

*   **Q-F (open, blocks implementation): can the mod write into a FIFO?** The plan writes the key into the FIFO with `fs/promises.writeFile`. It is declared in `gpui-kit.d.ts:22192-22204`, but `mods/orca-spaces/project.js:78` says "QuickJS lacks Node's `fs/promises`". `writeTextFile` must never be used on the FIFO: it "replaces existing files atomically" (`herdr.d.ts:30-32`), which would put a regular file holding the key on disk. Also unknown: whether opening a FIFO with no reader blocks the JS thread. Check, in a separate app home so the live layout is untouched:
    1.  `P=$(mktemp -d); mkdir -p "$P/mods/fifo-probe"; echo '{ "place": "none" }' > "$P/mods/fifo-probe/mod.json"`
    2.  Write `$P/mods/fifo-probe/main.js`: in `init`, inside `cx.spawn`: `exec("mkfifo", ["-m","600", appHome()+"/p.fifo"])`; start, without awaiting, `exec("sh", ["-c", 'cat "$1" > "$2"', "x", appHome()+"/p.fifo", appHome()+"/p.out"], { timeout: 5000 })`; `await import("fs/promises")` and `await writeFile(appHome()+"/p.fifo", "probe-ok")` inside try/catch; record `"ok"` or the error text with `writeTextFile(appHome()+"/p.how", …, null)`; then `exec("sh", ["-c", 'stat -f %HT "$1" > "$2"', "x", appHome()+"/p.fifo", appHome()+"/p.type"])`.
    3.  `HERDR_APP_HOME="$P" herdr-app check "$P/mods/fifo-probe"`, then `cat "$P/p.how" "$P/p.out" "$P/p.type"`.
    4.  Pass: `p.how` is `ok`, `p.out` is `probe-ok`, `p.type` is `Fifo File`. A second run that calls `writeFile` *before* starting the reader must also finish; if `check` does not return within 20 seconds, the write blocks the JS thread and the reader-first order becomes mandatory.
    5.  `herdr-app check` "does not check … asynchronous states" (`herdr-app check --help`). If the files are missing because it exited early, a human repeats the probe in the app with `HERDR_APP_HOME="$P" herdr-app`. Delete `$P` afterwards.
    6.  If `fs/promises` is missing or the FIFO is replaced: stop and ask the author. Fallback (needs author approval, it re-introduces a key on disk for well under a second): `writeTextFile` a regular file in the 0700 `secrets/` directory, consumed and removed by the reader in one command (`security -i < "$1"; rm -f "$1"`), with the same leftover cleanup as FIFOs.
*   **Q-G (open, blocks shipping, needs live oMLX and a human with the key): does Codex 0.171.0 run with only the four overrides?** oMLX's own launcher passes a fifth override, `model_catalog_json`, pointing at a catalog file it writes under `~/.codex/` with base instructions, context window and reasoning levels per model (`/Applications/oMLX.app/Contents/Resources/omlx/integrations/codex.py:356-360`, `:262-280`). This spec passes four (D10, G7). Check in the user's own terminal: `OMLX_API_KEY=$(security find-generic-password -s herdr-provider-omlx -a omlx -w) codex exec --skip-git-repo-check -m <model-id> -c 'model_provider="omlx"' -c 'model_providers.omlx.name="oMLX"' -c 'model_providers.omlx.base_url="http://127.0.0.1:8000/v1"' -c 'model_providers.omlx.env_key="OMLX_API_KEY"' 'Reply with OK'`. Pass: a reply arrives. If Codex refuses the model or warns about missing model metadata, record the exact message and ask the author whether to add a Herdr-written `model_catalog_json` under `appHome()` (spec revision, not an implementation choice). Do not add `wire_api` without a reproduced failure.
*   **Q-H (open, needs live oMLX): does anything log the key?** After Q-G and verification step 4, run `security find-generic-password -s herdr-provider-omlx -a omlx -w | grep -rlFf /dev/stdin ~/.codex ~/.config/herdr-app 2>/dev/null`. The key reaches `grep` through stdin, not argv. Pass: no output. Any file listed is a leak to report before shipping.
*   **Q-I (open, does not block): when does `orca-agent-manager` start?** If its `init` runs at app start rather than on first navigation, the leftover cleanup (Event Triggers) runs at app start. That is still one pass, not a timer, so both outcomes are acceptable and no check is needed before implementation. The answer shows up in verification step 11.

## Critical User Journeys (CUJs)

### CUJ 1: Set up oMLX successfully

*   **Given**: oMLX is running at `http://127.0.0.1:8000/v1` and requires a key. No provider is set up.
*   **When**: The user opens Agent Settings, goes to Model providers, enters the host and key, optionally adds `https://github.com/<owner>`, and presses "Test and save".
*   **Then**: Herdr runs `curl` with its config (URL, `Authorization` header, limits) read from a named pipe, against `GET {host}/models`. The response is 200 and `data[]` is not empty. The key is written to Keychain and read back to confirm it. The icon is saved as PNG under appHome (best effort). `{id, name, host, link, iconPath, models, verifiedAt}` is written to `model-providers.json` last. The key field is cleared. The provider appears in the Codex "Model provider" dropdown the next time the flyout opens.

### CUJ 2: Test fails, nothing is saved

*   **Given**: The host is wrong, the key is wrong, or the server is down.
*   **When**: The user presses "Test and save".
*   **Then**: The setup shows one fixed message: "Cannot connect", "Key rejected" (401 or 403), "No /models at this host. Does it need /v1?" (404), "Not a model server" (200 without a `data` array), "No models" (empty `data`), or "Server answered <status>". It never shows curl's stderr or the command. No Keychain item is created. Nothing is written to `model-providers.json`. No pipe is left in `secrets/`. The user can fix the fields and try again.

### CUJ 3: Zero providers set up

*   **Given**: No provider has passed its test.
*   **When**: The user opens the Codex flyout.
*   **Then**: The "Model provider" dropdown is greyed out and shows `None`. It cannot be opened.

### CUJ 4: Launch Codex with oMLX

*   **Given**: oMLX is set up. The user chose `oMLX` in the dropdown and a model from its list.
*   **When**: The user presses Launch terminal (or clicks the Codex row, which launches with the saved choice).
*   **Then**: The tab runs Codex with `-m <model>` and the four `-c` overrides from the Technical Plan, plus today's DISABLE arguments. No `model_reasoning_effort` override is added (D10). Inside the tab, `/bin/sh` reads the key from Keychain into `OMLX_API_KEY` and `exec`s Codex. The key appears in no argument list. No test runs at launch.

### CUJ 5: Launch Codex with None

*   **Given**: Any state.
*   **When**: The user launches with `None`.
*   **Then**: The argument list is identical to today's. No Keychain read happens. No `-c` override is added.

### CUJ 6: Provider edited

*   **Given**: oMLX is set up.
*   **When**: The user changes the host or the key in setup and presses "Test and save". The key field starts empty with the placeholder "Saved in Keychain. Leave empty to keep it."
*   **Then**: The new values are tested first. An empty key field tests with the saved key (read from Keychain into the mod) and skips the Keychain write. On pass, the new values replace the saved ones (Keychain item, then the JSON record). On fail, the saved values stay as they were and the reason is shown.

### CUJ 7: Provider deleted while selected

*   **Given**: Codex's selected provider is `oMLX`.
*   **When**: The user deletes oMLX in setup.
*   **Then**: The record is removed from `model-providers.json` first, then the Keychain item (or Linux key file), then the icon file. The dropdown shows `None` the next time the flyout opens. The saved model for `omlx` in `agent-config.json` is left in place and ignored; it is reused only if oMLX is set up again and still lists that model (default, author can change).

### CUJ 8: Provider is down at launch

*   **Given**: oMLX is set up but its server is stopped.
*   **When**: The user launches Codex with `oMLX`.
*   **Then**: The launch still runs. Codex's error appears in the new tab. Herdr does not retry, and does not fall back to `None`. This is accepted for v1.

### CUJ 9: Provider deleted while a flyout is open

*   **Given**: A Codex flyout is open with `oMLX` selected. The user deletes oMLX in Agent Settings.
*   **When**: The user presses Launch terminal in that flyout.
*   **Then**: Launch re-reads `model-providers.json` (as it already re-reads `agent-manager.json`, `mods/agent-config/main.js:519`). The record is gone, so nothing launches, the row switches to `None`, and the flyout shows "oMLX was removed. Pick a model provider." (default, author can change).

### CUJ 10: Remote space

*   **Given**: oMLX is set up. The active space runs on another machine (`space.machine` is set).
*   **When**: The user opens the Codex flyout.
*   **Then**: The row is greyed out and shows `None` (D9). Launch behaves as CUJ 5.

## Event Triggers (no polling)

Every network call, Keychain access and secret-file change in this feature starts from one of these events. Nothing else.

| Event | What runs | Notes |
|---|---|---|
| User presses "Test and save" | Validate fields, curl test through a pipe, Keychain write and read-back (skipped when the key field is empty on edit), icon fetch, `model-providers.json` write | CUJ 1, 2, 6. The button is disabled while it runs. |
| User presses "Delete" on a provider | `model-providers.json` write, Keychain delete (or key file delete), icon file delete | CUJ 7 |
| Agent Settings page starts (its `init`, skipped when `checking()`) | One pass of leftover cleanup: remove `secrets/agent-manager-*.fifo`; if there is no `omlx` record, also delete the Keychain item, the key file and the icon | Covers a quit between the Keychain write and the JSON write. Q-I |
| Codex flyout starts | Read `model-providers.json` and `agent-config.json`; `test -s` on the icon file; remove `secrets/agent-config-*.fifo` | No network call |
| User opens the Codex MODEL list with a provider selected | Read the model list from the provider record in memory | No network call |
| User presses "Refresh models" at the end of that list | Keychain read into the mod, curl `GET {host}/models` through a pipe, `model-providers.json` write (D7 rule) | Only way to refresh the list. No time-based expiry. |
| User presses Launch terminal (or clicks the Codex row) | Re-read `model-providers.json`; Keychain read inside the tab's shell; Codex starts | No test runs |

Timeouts in this feature are `exec`'s own `timeout` option, which ends a child process. No step uses `cx.timer`, `setTimeout` or `setInterval`.

The OpenAI catalog for `None` keeps its existing ten-minute reuse window (`CATALOG_TTL_MS`, `mods/agent-config/main.js:115`, checked at `:294`). It is checked only when the flyout opens, which is a user action, and changing it would change the `None` path (G6). Provider model lists never use it and are never stored in `catalog`. `MODELS_FRESH_MS` (`mods/orca-new-menu/main.js:41`) applies only to probed agents (omp, antigravity), not to Codex, and is not touched.

"Verified" in the saved record means "passed at setup". It does not mean "reachable now". A provider that goes down later shows its error when Codex launches (CUJ 8).

## Technical Plan (Architecture)

Four data stores, each with one job:

| Data | Where | Why there |
|---|---|---|
| Provider id, name, host, link, icon path, model list, verified time | `appHome()/model-providers.json` | One file for provider records, written only through the D7 rule |
| Codex's chosen provider and its model | `appHome()/agent-config.json`, under `codex` | Already the home of the flyout's per-agent choices, written by its `persist()` |
| Key | macOS Keychain, service `herdr-provider-omlx`, account `omlx` (Linux: `appHome()/secrets/omlx.key`, mode 0600, directory 0700) | Keeps the secret out of plain JSON |
| Icon | `appHome()/provider-icons/omlx.png` | Local copy, so the UI never fetches at render time. `image()` takes a path under the app folder and decodes PNG only (`mods/orca-spaces/project.js:76-80`) |

Storage shapes:

```text
model-providers.json:
{ "providers": [ { "id": "omlx", "name": "oMLX", "host": "http://127.0.0.1:8000/v1",
                   "link": "https://github.com/<owner>",            // optional
                   "iconPath": "provider-icons/omlx.png",            // relative to appHome; absent = letter badge
                   "models": [ { "id": "<model-id>", "label": "<model-id>", "efforts": [] } ],
                   "verifiedAt": "2026-11-22T10:00:00Z" } ] }

agent-config.json (added keys only):
"codex": { ..., "provider": "omlx",                    // absent = None
                "providerModels": { "omlx": "<model-id>" } }   // model per provider
```

`appHome()/secrets/` is created on first use with `exec("/bin/sh", ["-c", 'umask 077 && mkdir -p "$1" && chmod 700 "$1"', "herdr-provider", dir])`. It holds the pipes and the Linux key file. None of these runtime files are part of the repo or the live-config sync.

### Input rules

*   Host: matches `^https?://([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$` after trailing slashes are stripped. This rejects spaces, quotes, user info, query strings and fragments, so the host is safe inside a curl config line and a TOML string. A path is allowed and kept; `/v1` is not added automatically (a 404 shows the hint in CUJ 2).
*   Key: 1 to 4096 characters, each in `0x21-0x7E` (printable ASCII, no spaces, no line breaks).
*   Model ids from the server: kept only when they match `^[\x21-\x7E]{1,200}$`; label = id.
*   Link: optional; `https://github.com/<owner>` with `<owner>` matching `^[A-Za-z0-9-]+$`, or any https URL that passes the host rule.

### Test: curl through a named pipe

```text
[Setup form] key and host in memory
     |
     v
exec("mkfifo", ["-m", "600", <pipe>])         <pipe> = secrets/<mod>-<unique>.fifo
reader = exec("curl", ["--config", <pipe>], { timeout: 10000 })     (not awaited yet)
write into <pipe> (Q-F):  url = "<host>/models"
                          header = "Authorization: Bearer <key, with \ and " escaped>"
                          max-time = 5
                          silent
                          show-error
                          write-out = "\n%{http_code}"
     |  curl exit 0, HTTP 200, data[] non-empty?
     +-- no  --> show the fixed reason (CUJ 2), write nothing
     |
     yes
     v
(continue to Keychain write)
finally: exec("rm", ["-f", <pipe>])
```

The key goes through the pipe, where curl reads it as its config. It is never an argument to a process and never a file's content. The config has no `location` line, so curl never follows a redirect with the key. curl exit 6, 7 or 28 maps to "Cannot connect"; any other non-zero exit maps to "Request failed". The last stdout line is the status; the rest is the body.

Pipe rules, shared by every pipe in this feature:

*   The reader `exec` is started first. If it settles (exits or fails to start) before the write finishes, unblock the writer by opening the pipe once for reading: `exec("/bin/sh", ["-c", 'cat "$1" >/dev/null', "herdr-provider", <pipe>], { timeout: 5000 })`.
*   The pipe is removed in `finally`, and also from the mod's `close()` hook, which may still start `exec` at quit (`gpui-kit.d.ts:564-567`).
*   Each mod names its pipes with its own prefix (`agent-manager-` or `agent-config-`) and removes only its own leftovers when it starts. Only one copy of each mod uses pipes at a time, so a leftover is never a pipe in use.

### Keychain write: named pipe plus `security -i`

`security -i` reads its commands from stdin. `exec` cannot pass stdin, so a FIFO stands in for it:

```text
1. exec("mkfifo", ["-m", "600", <pipe>])
2. reader = exec("/bin/sh", ["-c", 'security -i < "$1"', "herdr-provider", <pipe>], { timeout: 10000 })
3. write into <pipe>:  add-generic-password -U -s herdr-provider-omlx -a omlx -w "<escaped key>"
4. remove the pipe in finally, whether or not steps 2 and 3 passed
5. read back: exec("/usr/bin/security", ["find-generic-password", "-s", "herdr-provider-omlx", "-a", "omlx", "-w"])
   stdout without its one trailing newline must equal the key; otherwise show "Could not save the key" and stop
```

`-U` updates an item that already exists, including one left by an interrupted save. Escaping follows Q-B. `security -i` may exit 0 even when a command inside it fails, so step 5 is the success check, and it also catches an escaping mistake. The item is created by `/usr/bin/security`, so it lists that program as trusted, and the same program reads it in step 5 and at launch without a prompt. A locked keychain makes macOS ask for the login password; the read waits up to `exec`'s default 30 seconds.

Linux: `exec("rm", ["-f", path])`, then `writeTextFile(path, key, null)`, then `exec("chmod", ["600", path])`, then check the mode with `exec("/bin/sh", ["-c", 'stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"', "herdr-provider", path])` equals `600`. `writeTextFile` cannot set a mode, so the file may exist with the runtime's default mode for a moment. The 0700 `secrets/` directory keeps other users out during that moment. Read-back uses `readTextFile`.

Delete: `exec("/usr/bin/security", ["delete-generic-password", "-s", "herdr-provider-omlx", "-a", "omlx"])`. Exit 44 (not found) counts as success. Linux: `rm -f` the key file. No secret is involved.

### Codex launch flow

```text
Row = None:    argv = [...p.argv, ...argsFor(model, effort), ...extra]      (unchanged, main.js:561)
Row = omlx (macOS):
               argv = ["/bin/sh", "-c", WRAPPER_MAC, "herdr-provider",
                       "herdr-provider-omlx", "omlx",
                       ...p.argv,
                       "-m", <model>,
                       "-c", 'model_provider="omlx"',
                       "-c", 'model_providers.omlx.name="oMLX"',
                       "-c", 'model_providers.omlx.base_url=' + JSON.stringify(<host>),
                       "-c", 'model_providers.omlx.env_key="OMLX_API_KEY"',
                       ...extra]                                            (extra = today's DISABLE args)
Row = omlx (Linux):
               argv = ["/bin/sh", "-c", WRAPPER_LINUX, "herdr-provider",
                       appHome() + "/secrets/omlx.key", ...same as above from p.argv on]

WRAPPER_MAC   = 'k=$(/usr/bin/security find-generic-password -s "$1" -a "$2" -w) || { echo "Herdr: no key for this model provider. Set it up again in Agent Settings." >&2; exit 1; }; shift 2; OMLX_API_KEY=$k; export OMLX_API_KEY; exec "$@"'
WRAPPER_LINUX = 'k=$(cat -- "$1") || { echo "Herdr: no key for this model provider. Set it up again in Agent Settings." >&2; exit 1; }; shift; OMLX_API_KEY=$k; export OMLX_API_KEY; exec "$@"'
```

The wrappers are constant strings. The service, account and key path are positional arguments, never spliced into the script, so no value can inject shell code. In `sh -c`, the word after the script is `$0`, so `herdr-provider` is `$0` and the service is `$1`. Checked on macOS `/bin/sh` (bash 3.2): positional order and the exported variable reach the `exec`'d program. When `security` fails, the message stays on screen because the tab falls back to a login shell (Q-D).

The values are JSON strings, which TOML reads as basic strings; this is how oMLX's launcher builds them (`codex.py:64-74`). oMLX sets no `wire_api`, so this spec sets none. oMLX's launcher also passes `model_catalog_json`; this spec does not (Q-G).

The key read goes into a shell variable, never into an argument. Precedent to avoid copying: `mods/orca-status/local-usage.js:29`, which passes a token to `curl -H` in argv.

There is one Codex launch site (`mods/agent-config/main.js:561-570`), so there is nothing to keep in sync across mods. At launch, for a selected provider: re-read `model-providers.json` (CUJ 9), check the target space is local (D9), then build argv as above.

### Flyout layout (Codex)

```text
+------------------------------------+
| Codex                              |
| Model provider  [ None        ▾ ]  |   <- new row, greyed if 0 providers or remote space
| ---------------------------------- |   <- new divider
| [ MODEL GPT-6.1 Terra ▾ ] [ EFFORT Low ▾ ]   <- list = selected provider's models;
|                                    |      EFFORT hidden for provider models (D10)
| ---------------------------------- |   <- existing divider (main.js:1106)
| DISABLE  all  clear                |
|   [ ] plugins   [ ] apps  ...      |
| [ Launch terminal            ↵ ]   |
+------------------------------------+
```

The provider row renders for Codex whether or not the OpenAI catalog has loaded (today the header renders only when `this.models` is set, `mods/agent-config/main.js:1102`). With a provider selected, `this.models` is the provider's list. The MODEL list for a provider ends with a "Refresh models" row.

### Edge cases (defaults the author can change)

| Case | Decision |
|---|---|
| Two providers with the same id | Cannot happen: v1 has one fixed id (D8). |
| Host with a trailing path or slash | Path kept, trailing slashes stripped, `/models` appended. No automatic `/v1`. |
| Chosen model disappears from the server | Without a refresh, the saved id is launched and Codex shows the server's error (as CUJ 8). After "Refresh models", a missing saved model falls back to the first listed model, as the existing `pickSaved` does (`mods/agent-config/main.js:271-275`). |
| Keychain item already exists | `-U` overwrites it. |
| User leaves the page mid-test | No Cancel button. A hidden page is not closed, so the save runs to the end. The button stays disabled until it does. |
| Popup closes during "Refresh models" | Pending calls may be cancelled; nothing is written; `close()` removes the pipe; any leftover is removed at the next flyout start. |
| App quits between the Keychain write and the JSON write | The Keychain item has no record. The next Agent Settings start deletes it (Event Triggers). |
| JSON write fails after the Keychain write on an edit | The new key is in Keychain and the old host stays in JSON. Show "Key saved, settings not saved. Press Test and save again." Accepted for v1. |
| Icon path missing on disk | `test -s` when the view starts; missing shows the letter badge (first letter of the name). No download until the next "Test and save". |
| Deleted provider still selected in an open flyout | CUJ 9. |
| Selected provider absent when the flyout starts | Row shows `None`; the stale `codex.provider` value is ignored, not rewritten. |
| Two Agent Settings or flyout writes race on `model-providers.json` | D7 rule. |
| User's `~/.codex/config.toml` gains a `[model_providers.omlx]` table | Codex merges `-c` keys over it, so extra keys there apply too. Not handled in v1; it has none today. |

## Alternatives Considered

### Alternative A: Write `~/.codex/config.toml` with a provider block

*   **Pros**: Codex reads it natively; `/model` would show the provider.
*   **Cons**: Changes the user's global Codex config. Two Herdr tabs cannot use different providers at once.
*   **Reason for Rejection**: Rejected by author: the choice must be per tab.

### Alternative B: Pass the key in the launch argument (`env OMLX_API_KEY=... codex`)

*   **Pros**: One line, matches the opencode precedent in this repo (`mods/agent-config/main.js:566`).
*   **Cons**: The key shows in `ps` and in tab command logs.
*   **Reason for Rejection**: Rejected by author: violates G8.

### Alternative C: Store the key in the JSON file with mode 0600

*   **Pros**: Simple, works on every platform.
*   **Cons**: Plain text on disk, readable by any process running as the user, and the first secret in the repo.
*   **Reason for Rejection**: Rejected by author for macOS. Kept as the Linux fallback only, in its own file under a 0700 directory.

### Alternative D: Let oMLX's own `launch codex` do the work

*   **Pros**: Already exists.
*   **Cons**: Herdr cannot read its state, cannot choose `None` in the same flow, and oMLX writes a model catalog file under `~/.codex/`.
*   **Reason for Rejection**: Rejected by author: no per-tab choice.

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Security & Privacy**: The key reaches Keychain only through a named pipe read by `security -i`. The test sends the key only through a curl config on a named pipe. Icon downloads are https only, time-limited (5 seconds), size-capped at 256 KB, type-checked, and stored as PNG. Each place the key could leak, and how it is prevented:

    | Place | Prevention |
    |---|---|
    | Process argv (`ps`, `hc ls --json`, tab command text) | Key goes only through pipes and, at launch, a shell variable. Wrappers are constant; argv holds the service name, account, key path and host. |
    | Disk | No temp file. Pipes hold no data at rest. Linux key file is 0600 in a 0700 directory. `writeTextFile` is never called on a pipe (Q-F). |
    | `model-providers.json`, `agent-config.json` | Hold host, link, model ids and icon path only. |
    | Icon path and file | Named after the provider id; the icon request carries no key. |
    | UI error messages | Fixed strings only (CUJ 2). Never `e.message`, stdout, stderr, or the command of an `exec`. Do not copy the existing `Could not list models: ${e?.message}` pattern (`mods/agent-config/main.js:315`). |
    | Logs and crash output | No `console.*` call receives the key, the curl config, the `security -i` line, or the stdout of a key read. Thrown errors never include them. |
    | curl output | No `verbose` or `trace` in the config; curl's stderr never prints request headers otherwise. |
    | Redirects | The test config has no `location`, so the key is never sent to a second URL. |
    | Mod memory | The key field is cleared with `set_value("")` after a save. |
    | Codex process environment | `OMLX_API_KEY` is in Codex's environment, as any `env_key` provider requires. Processes of the same user can read it (`ps -E`). Accepted residual. |
    | Same-user processes | A process running as the user could open a pipe in `secrets/` before the intended reader. Accepted residual: such a process can already read the user's files. |
    | Codex or oMLX logs | Unknown; Q-H checks it. |

*   **Performance & Latency**: The test is one request with a 5-second limit inside a 10-second process timeout. The model list is read from the saved record, so opening the dropdown makes no network call.
*   **Rollout & Rollback**: Ship behind the Codex row only. With no providers saved, behavior matches today. Rollback: delete `appHome()/model-providers.json`, `appHome()/provider-icons/`, and `appHome()/secrets/`, and run `security delete-generic-password -s herdr-provider-omlx -a omlx`. A leftover `codex.provider` in `agent-config.json` is ignored once the providers file is gone.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

### Target Files to Create/Modify

#### 1. `shared/codex-provider.js` (Create)

*   **Type / Scope**: Pure JavaScript, no Herdr API calls, so it can be unit tested. Copied into `agent-config` and `orca-agent-manager` (add to `USES` in `scripts/sync-shared.mjs`).
*   **Proposed Changes**:
    *   `validateHost(text)`, `validateKey(text)`, `validLink(text)`: the Input rules above. Each returns the normalized value or an error string.
    *   `curlConfig(host, key)`: returns the config text for the test, escaping `\` and `"`.
    *   `judgeModels(curlExit, status, body)`: returns `{ok: true, models}` only when the exit is 0, status is 200, `data` is an array, and at least one id passes the model-id rule. Otherwise returns the fixed message from CUJ 2.
    *   `keychainLine(service, account, key)`: returns the one-line `security -i` command with the Q-B escaping.
    *   `codexProviderArgs(provider, model)`: returns the ten argv items (`-m` and four `-c` pairs). The `name` value comes from the provider record; the host goes through `JSON.stringify`.
    *   `launchArgv(platform, baseArgv, provider, model, extra, keyPath)`: returns the full argv for a provider launch with the constant wrapper for `platform` (`"macos"` or `"linux"`). Returns `null` for `"windows"`.
    *   Shortcut: one provider id (`omlx`) maps to a fixed env name, service and account; upgrade the constant map when a second provider is added.
*   **Tests**: `mods/agent-config/codex-provider.test.js`, importing the copy. Cases: 200 with models passes; 200 with empty `data` fails with "No models"; 401 gives "Key rejected"; curl exit 7 gives "Cannot connect"; `ftp:` scheme, a host with a space, `user@host` and `?q=` are rejected; a trailing slash is stripped; `None` adds no arguments; `omlx` gives exactly ten items; `curlConfig` and `keychainLine` escape a key containing `"`, `\`, and `$`; a key with a space or newline is rejected; `launchArgv("macos", …)` contains no key and puts the service at `$1`.

#### 2. `shared/provider-exec.js` (Create; was `shared/keychain.js`)

*   **Type / Scope**: Wrapper over `exec`, `writeTextFile`, `readTextFile`, and the pipe write chosen in Q-F. Copied into `agent-config` and `orca-agent-manager`.
*   **Proposed Changes**:
    *   `withPipe(prefix, startReader, text)`: creates `secrets/` (0700) and the pipe, starts the reader, writes `text`, unblocks a writer whose reader has settled, removes the pipe in `finally`, and returns the reader's result. All pipe rules above live here.
    *   `requestModels(host, key)`: `withPipe` with `curl --config`, then `judgeModels`.
    *   `saveKey(platform, key)`: macOS `withPipe` with `security -i`, then the read-back. Linux: the file steps and the mode check.
    *   `readKey(platform)`: macOS `security find-generic-password … -w` stdout; Linux `readTextFile`. Used by "Refresh models" and by an edit with an empty key field.
    *   `deleteKey(platform)`: `security delete-generic-password` (exit 44 is success) or `rm -f`.
    *   `cleanLeftovers(prefix, hasRecord)`: the start-up cleanup from Event Triggers.
*   **Tests**: `mods/agent-config/provider-exec.test.js` with a recording `exec` stub (`scripts/gpui-stub-loader.mjs` stubs `herdr`). Cases: no recorded `exec` argument contains the key; the pipe is removed after success and after a forced failure; when the reader rejects, the drain reader runs; a read-back mismatch returns an error and no JSON write follows; Linux path runs `chmod 600` and fails when the mode check returns anything else.

#### 3. `shared/provider-icon.js` (Create)

*   **Type / Scope**: Best-effort icon fetch through `exec curl` (no key involved, so plain arguments are fine). Copied into `orca-agent-manager` only.
*   **Proposed Changes**:
    *   GitHub link `https://github.com/<owner>`: fetch `https://github.com/<owner>.png?size=64` (same form as `avatarUrlFor`, `mods/orca-spaces/project.js:66-68`).
    *   Website link: fetch the page, read `<link rel="icon">`, else `/favicon.ico`. Resolve relative URLs.
    *   curl arguments: `-sS -L --proto =https --proto-redir =https --max-redirs 3 --max-time 5 --max-filesize 262144 -o provider-icons/omlx.tmp <url>`. Then check the size is at most 262144 bytes and `file -b --mime-type` is one of `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/x-icon`, `image/vnd.microsoft.icon`.
    *   PNG is moved into place. Other types are converted on macOS with `sips -s format png <tmp> --out provider-icons/omlx.png`; on Linux, or if `sips` fails, there is no icon. The `.tmp` file is always removed. Any failure returns `null` and the UI shows a letter badge; it never fails the save.
*   **Tests**: `mods/orca-agent-manager/provider-icon.test.js`. PNG passes; `text/html` is rejected; an `http:` link is rejected; a GitHub owner with `/` is rejected.

#### 4. `mods/orca-agent-manager/main.js` and `views.js` (Modify)

*   **Type / Scope**: Herdr mod, the Agent Settings page (D6).
*   **Proposed Changes**:
    *   Add a "Model providers" section: host, key (`set_masked(true)`, Q-C), optional link, "Test and save", the set-up provider with its icon, and "Delete". Styling follows `editorView` in `mods/orca-agent-manager/views.js:133`. Hidden on Windows.
    *   Implement the save order: validate, test, Keychain write and read-back, icon, `model-providers.json` write last (D7 rule). Disable the button while it runs.
    *   Implement delete in the CUJ 7 order.
    *   In `init`, after the `checking()` guard, run `cleanLeftovers("agent-manager-", …)`.

#### 5. `mods/agent-config/main.js` (Modify)

*   **Type / Scope**: Herdr mod, the Codex flyout (300px popup).
*   **Proposed Changes**:
    *   Read `model-providers.json` in the existing `init` load (next to `SETTINGS`, line 156; load at `:254`), and `codex.provider` / `codex.providerModels` from `agent-config.json`. Save the row and model choice through the existing `persist()`.
    *   Add the "Model provider" row under the title, then a divider (D2, layout above). Greyed with `None` for zero providers or a remote space (D9).
    *   With a provider selected, the MODEL list is the provider's `models`, EFFORT is hidden (D10), and a "Refresh models" row runs `readKey` and `requestModels`, then writes the list (D7 rule).
    *   In `launch()` (line 561), for Codex with a provider: re-read `model-providers.json` (CUJ 9), then use `launchArgv`. For `None`, argv stays exactly as today.
    *   In `init`, after the `checking()` guard, run `cleanLeftovers("agent-config-", …)`; add a `close()` hook that removes an in-use pipe.
    *   Do not change `CATALOG_TTL_MS`.

#### 6. `mods/orca-new-menu/main.js` (No change)

*   Codex launches only from `agent-config`. `MODELS_FRESH_MS` stays.

#### 7. `scripts/sync-shared.mjs` (Modify)

*   Add `"codex-provider.js": ["agent-config", "orca-agent-manager"]`, `"provider-exec.js": ["agent-config", "orca-agent-manager"]`, `"provider-icon.js": ["orca-agent-manager"]` to `USES`, then run `node scripts/sync-shared.mjs`.

#### 8. Live config and repo sync (Modify, both locations)

*   **Type / Scope**: Herdr App UI files.
*   **Proposed Changes**: Every edit to `mods/` lands in the repo and in `~/.config/herdr-app/`, per `herdr-app-dev-sync`. No temporary probe mods in the live layout (the Q-F probe uses its own `HERDR_APP_HOME`).

### Verification Plan

Order matters. Each step must pass before the next starts. Tags: **[auto]** runs without a server or a person; **[oMLX]** needs oMLX running at `http://127.0.0.1:8000/v1`; **[human]** needs a person at the app (and the real key where noted).

1.  **Runtime pipe write (Q-F)** [auto; a human only if `check` exits early]: the probe steps in Q-F. Blocks everything after it.
2.  **Unit and load** [auto]: `node --test mods scripts` passes; `node scripts/sync-shared.mjs --check` exits 0; `herdr-app check mods/agent-config` and `herdr-app check mods/orca-agent-manager` exit 0.
3.  **Live test** [oMLX, human with key]: setup with the real key passes. A wrong key shows "Key rejected". With oMLX stopped, "Cannot connect". After a first-time failure: `security find-generic-password -s herdr-provider-omlx -a omlx >/dev/null 2>&1; echo $?` prints `44`; `grep -c '"omlx"' ~/.config/herdr-app/model-providers.json` prints `0` or the file is absent; `find ~/.config/herdr-app/secrets -name '*.fifo' 2>/dev/null` prints nothing.
4.  **Argument check** [oMLX, human]: launch with `oMLX`, then `ps -axww -o args= | grep -cFf <(security find-generic-password -s herdr-provider-omlx -a omlx -w)` prints `0`. Before the change, record `ps -axww -o args= | grep -F '/bin/zsh -lic' | grep -F codex` for a `None` launch; after the change, a `None` launch prints the same line.
5.  **Codex runs (Q-G)** [oMLX, human with key]: the Q-G command, then the same through the flyout: the tab answers a one-line prompt.
6.  **No key in logs (Q-H)** [oMLX]: the Q-H command prints nothing.
7.  **Event-only check** [auto]: `git diff main -- mods shared | grep -nE '^\+.*(setTimeout|setInterval|cx\.timer)'` prints nothing. `grep -n "requestModels\|readKey" mods/agent-config/main.js` shows calls only inside the "Refresh models" handler; `init`, `render` and `launch()` call neither.
8.  **Edit fail keeps old values** [oMLX, human]: record `security find-generic-password -s herdr-provider-omlx -a omlx -w | shasum` and the host in `model-providers.json`; edit with a wrong host; both are unchanged.
9.  **Delete** [human]: with oMLX selected, delete it. `security find-generic-password -s herdr-provider-omlx -a omlx >/dev/null 2>&1; echo $?` prints `44`; `ls ~/.config/herdr-app/provider-icons/` has no `omlx.png`; the flyout shows `None`.
10. **Deleted while a flyout is open (CUJ 9)** [human]: open the Codex flyout with oMLX, delete oMLX in Agent Settings, press Launch: no tab opens and the message shows.
11. **Leftover cleanup** [oMLX, human]: after a successful setup, quit the app, remove the `omlx` record from `model-providers.json` by hand, start the app and open Agent Settings: the step-3 `security` check prints `44`.
12. **Zero-provider and remote states** [human]: with no provider, the row is greyed with `None`. With a remote space (skip if none is configured), the row is greyed with `None`.
13. **Linux path** [auto]: unit tests with `platform = "linux"` against a temp app home cover the key file, mode check and `WRAPPER_LINUX`. A run on a real Linux machine is out of scope for v1.

--------------------------------------------------------------------------------

*Drafted with EGM*
