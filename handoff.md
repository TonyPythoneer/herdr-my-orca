# Handoff: LiteLLM connectivity check is the wrong shape

**Status:** open. This is the only remaining LiteLLM work. Do not add more UI polish before fixing the probe.
**Branch:** `feat/litellm-local-provider-observability`
**Baseline:** `8f82510` (after `6587d20`); working tree clean.
**Owner:** next AI.
**Read first:** `docs/designs/litellm-local-provider-observability.md`.

## 1. Why this file exists

The Managed/Existing split, empty-catalog handling, activation warning, and live sync are already shipped. The user's remaining objection is: **how we check LiteLLM is wrong.** Do not treat this as a copy tweak. The current check asks one endpoint one question and uses the answer for everything.

Current shape:

- one authenticated `GET /v1/models`;
- one `healthy` boolean plus a `models` array;
- one global `litellmCheckedAt` timestamp;
- activation and launch both inferred from that same result.

That is too little information and the wrong endpoint for liveness. The recommendation is three independent probes: liveness, readiness, and catalog/auth. Keep health, activation, and launch readiness separate.

**Do not revert the empty-catalog fix.** An authenticated 200 with `data: []` must remain reachable/alive. That part is correct, not the bug.

## 2. Current implementation

- `mods/orca-agent-settings/main.js`
  - `readLiteLLMStatus()` runs `python3 .../litellm_gateway.py <appHome> status` with a 15 s timeout.
  - `refreshLiteLLMStatus()` is the Check button.
  - `toggleLiteLLM()` reads cached `litellmStatus.remote.healthy` and `models.length`.
  - `litellmCheckedAt` is set in `finally` for every status read.
- `mods/orca-agent-flyout/litellm_gateway.py`
  - `remote_health()` builds `GET <root>/v1/models` with a Bearer key, 8 s timeout, no redirects, and `json.load`.
  - `status()` calls it when mode is `remote`.
  - `enable()` rechecks it and blocks zero models.
  - `prepare()` rechecks it and rejects a selected model missing from the catalog.
  - `local_status()` may spawn the managed CLI and Python metadata checks.
- `mods/orca-agent-settings/page-view.js`
  - `gatewayCardView()` derives one `health` string and shows the same global timestamp in both Managed and Existing panels.
- Existing coverage: `scripts/litellm-gateway-e2e.py` empty-catalog test and `manager-page.test.js` empty-catalog UI test.

## 3. Why it is wrong

### 3.1 `/v1/models` is catalog, not liveness

It can be empty, 401/403, disabled by a reverse proxy, or forbidden to an inference-only key while the server is alive. A 401 proves TCP/TLS/API was reached, but current code collapses it into `healthy: false`. A 200 with an empty list is now treated as healthy, which is right, but liveness still depends on a catalog endpoint. Listing a model also does not prove that model can answer.

### 3.2 The real server already exposes better signals

Actual Docker server at `http://127.0.0.1:4000` (master key from `~/litellm-gateway/.env`):

```text
/health/liveliness -> 200 I am alive
/health/readiness  -> 200 status healthy, db connected
/v1/models         -> 200 data: [] (empty)
/health            -> 500 Model list not initialized
```

Meaning:

- liveness = `/health/liveliness`;
- readiness = `/health/readiness`;
- catalog/auth = `/v1/models` with the key;
- do **not** use `/health` as liveness: it can return 500 when the model list is empty even though the server is alive.

In this server, `/health/liveliness` and `/health/readiness` work without a key; `/v1/models` requires it. Auth therefore has to be a separate result, not a network result.

### 3.3 One boolean loses the useful distinctions

The UI cannot distinguish:

- server unreachable (DNS/TCP/TLS/timeout);
- server alive, API key rejected (401/403);
- server alive, not ready (readiness 5xx);
- server alive, catalog empty (200 with `data: []`);
- server alive, catalog forbidden (403 on `/v1/models`);
- server alive, invalid/oversized response.

All become `healthy: false` or `healthy: true`, so the user cannot tell what to fix. This is why the check still feels wrong after empty catalog became green.

### 3.4 The timestamp is misleading

`litellmCheckedAt` is global and set in `finally` on:

- page initialization;
- a local CLI check;
- a remote check;
- a failed status read;
- a mode switch.

`timeLabel(owner.litellmCheckedAt)` is then shown under both panels. `Checked` means a process ended, not that the visible host/key was successfully checked. It advances on failure and stays next to edited fields. This is a concrete bug, not a wording issue.

### 3.5 The check is coupled to lifecycle and races

- Page initialization spawns the status process; it can take 8-15 s and has no abort.
- `refreshLiteLLMStatus()` has a busy guard but no generation token. An older init/mode-switch result can overwrite a newer check.
- There is no teardown guard; an async result can notify a disposed view.
- `python3` comes from PATH. Existing mode should not need a managed venv, but it still depends on a working system Python.
- A failed status read replaces the last good status with `{ error }`; a transient blip loses the known catalog.
- Toggle uses cached status. The backend rechecks, but the UI gate can be stale (block a recovered server, or attempt a server that just died).

### 3.6 Robustness and security

- `json.load(response)` has no body-size cap; a remote or broken server can return a huge body.
- The timeout is fixed at 8 s and does not distinguish connect, TLS, or read timeout.
- `NoRedirect` is correct for not leaking the key, but legitimate redirects fail; keep that security choice and document it.
- Error text conflates auth and network; the UI does not show the HTTP status.
- There is no Content-Type check and only a loose shape check for `data`.

### 3.7 Activation policy is mixed into health

`toggleLiteLLM()` blocks when `models.length === 0` while the server is green. That is a deliberate safety choice, but it currently looks like a health failure. Keep these concepts separate even if the resulting policy stays the same:

- health: alive, ready, authenticated;
- catalog readiness: at least one model;
- launch: selected model exists.

## 4. Recommended contract

### 4.1 Backend probe

Add a `check_remote(config)` (or a `check-remote` action) that returns independent results, never the key:

```text
host
checkedAt
fingerprint = sha256(host + NUL + key)
liveness  = { ok, http, error }
readiness = { ok, http, error }
catalog   = { ok, http, models, error }
auth      = { ok, http, error }
```

Exact field names are yours; the separation is the requirement.

Probe order:

1. `GET /health/liveliness` (short timeout, about 3 s).
2. `GET /health/readiness`; 404/405 means unknown, not fatal.
3. `GET /v1/models` with the key; 401/403 means auth/catalog unavailable, not dead.
4. Fall back to `/health` or `/v1/models` only if the liveness endpoint is 404/405; mark that result as fallback.

Rules:

- 2xx liveness = alive, regardless of catalog.
- 401 on catalog = alive + key rejected.
- 403 on catalog = alive + catalog permission problem, not dead.
- 5xx on liveness = reachable but unhealthy, not unreachable.
- Network/DNS/TLS timeout = unreachable.
- Cap response bytes (for example 1 MiB); default TLS verification; do not follow redirects with a key.
- Never call `/health` alone as liveness; the actual 500 with empty models is the proof.

### 4.2 UI

Show independent lines, not one badge:

```text
Server     Reachable - HTTP 200
Readiness  Ready - HTTP 200
Catalog    No models advertised
Key        Accepted - HTTP 200
Last check 12:34:56 - this host/key
```

- Unreachable: red.
- Alive but auth failed: amber, with `Fix API key`, not `Could not connect`.
- Alive, catalog empty: green liveness plus a separate readiness warning.
- Ready: green, and only then the normal enable path.
- Timestamp only with the host/key fingerprint. Edit host/key, then clear or mark the result as stale; a small note is not enough.
- Keep the last successful check visible on failure, labelled `Last successful: ...` and `Last attempt failed at ...`.
- Page init should use cached status or a background probe; do not make first render wait on the network.
- Disable Check while a check is in flight; ignore stale responses with a generation token; do not notify after teardown.

### 4.3 Policy recommendation

- Keep launch fail-closed.
- Keep enable blocked when the catalog is known empty, because every new launch would fail. But base it on a fresh `catalog` result and say `Add a model before enabling`; do not present it as an unhealthy server.
- If the product explicitly wants to arm before models exist, remove only the empty-catalog gate. Do not weaken launch.
- For catalog 403, recommend blocking and telling the user to use a key that can list models, unless product accepts an explicit `catalog unknown` mode. Do not call the server dead.

## 5. Implementation plan

1. Backend: add structured `check_remote`; keep `status` cheap (config/cache) or persist the last probe keyed by fingerprint. Reuse it in `enable`/`prepare`.
2. Backend: bounded response reader, split timeouts, structured error kinds; keep no-redirect and no key logging.
3. UI: replace the single `health` string with the independent rows; per-probe/fingerprint timestamp; stale-edit handling; generation token.
4. Tests: mock HTTP server for 200, 401, 403, 500, timeout, empty catalog, 404 liveness fallback, invalid body, oversized body. UI tests for auth vs unreachable, timestamp, stale edit, and race.
5. Docs: update the design contract from `verifies authenticated /v1/models` to independent probes and the empty-catalog policy.
6. Sync live with the required `herdr-app-dev-sync` skill; run build check and `herdr-app status`.

## 6. Acceptance criteria

- [ ] Empty catalog: liveness/readiness green; catalog says no models; server is not called unreachable; enable behavior is explicit.
- [ ] A 401/403 shows alive plus key/catalog error, not `Could not connect`.
- [ ] `/health/liveliness` 200 plus `/v1/models` 401 shows `key rejected`.
- [ ] `/health` 500 with an empty model list does not mark the server dead.
- [ ] Liveness 404 falls back without treating catalog as liveness.
- [ ] Timeout/network is distinct; last success is preserved; failure has its own timestamp.
- [ ] Editing host/key invalidates the displayed green result.
- [ ] A stale async result cannot overwrite a newer check; no notify after teardown.
- [ ] Response body is capped; no key in logs, errors, or committed files.
- [ ] Persisted `local`/`remote` values and the Managed/Existing labels stay unchanged.
- [ ] Settings tests, backend test, build check, live `cmp`, and `herdr-app status` pass.

## 7. Reproduction

Environment: macOS, Docker compose under `~/litellm-gateway`, server on `127.0.0.1:4000`, master key in `~/litellm-gateway/.env`.

```bash
set -a; . $HOME/litellm-gateway/.env; set +a
for p in /health/liveliness /health/readiness /v1/models /health; do
  curl -sS -o /dev/null -w $p:%{http_code} -H 'Authorization: Bearer '$LITELLM_MASTER_KEY http://127.0.0.1:4000$p
  echo
done
```

Expected now: liveness 200, readiness 200, models 200 with empty data, health 500. Do not print or commit the key.

Current `remote_health()` returns `{healthy: true, models: []}` for this server. That is correct for liveness, but it is still the only check.

Useful commands:

```bash
node --test mods/orca-agent-settings/*.test.js
python3 scripts/litellm-gateway-e2e.py
node scripts/build-orca-ui.mjs --check --out .
```

## 8. Do not

- Do not revert `healthy: true` for an empty authenticated catalog.
- Do not change persisted `local`/`remote` values or the Managed/Existing labels.
- Do not add Docker orchestration, auto-discovery, or managed venv installation.
- Do not use `/v1/models` as the only liveness check.
- Do not use `/health` alone; it can be 500 when the model list is empty.
- Do not follow redirects with the API key.
- Do not log the key, put it in a checked-in file, or include it in error text.
- Do not silently fall back to a direct provider launch.

## 9. Open decisions

1. Enable with zero catalog? Recommendation: block, but as a catalog gate, not a health failure.
2. Catalog 403? Recommendation: block; ask for a key that can list models. Revisit only if inference-only keys commonly cannot list models.
3. Persist the last probe on disk? Optional. If yes, key it by host+key hash, mode 600, no secret. Per-session is acceptable if labelled.
4. Is `/health/liveliness` present on the pinned managed version? The Docker server proves it here; verify the pinned `1.111.0` gateway and keep the fallback.

## 10. Primary files

- `mods/orca-agent-flyout/litellm_gateway.py` - probes, status, enable, prepare.
- `mods/orca-agent-settings/main.js` - check lifecycle, toggle, status state.
- `mods/orca-agent-settings/page-view.js` - health rows and timestamp UI.
- `mods/orca-agent-settings/manager-page.test.js` - UI checks.
- `scripts/litellm-gateway-e2e.py` - backend checks.
- `docs/designs/litellm-local-provider-observability.md` - contract.

---

One-line recommendation: **probe liveness with `/health/liveliness`, readiness with `/health/readiness`, catalog/auth with `/v1/models`; keep the empty-catalog fix; stop using one `healthy` boolean and one global timestamp.**
