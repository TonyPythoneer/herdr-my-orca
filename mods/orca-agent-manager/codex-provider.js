// Generated from shared/codex-provider.js by scripts/sync-shared.mjs. Edit that file, not this copy.
// The oMLX model provider for Codex: the one place that decides what a host is, what a `/models`
// answer means, and how a provider launch is spelled. Used by orca-agent-manager (setup and test)
// and agent-config (the Codex flyout and the launch).
//
// Pure: no herdr or gpui imports, so `node --test` runs it directly. Edit this file, then
// `node scripts/sync-shared.mjs` writes the copies the two mods import.

export const OMLX = "omlx";
/** In appHome(): holds the provider record, mode 0600. */
export const PROVIDER_FILE = "model-providers.json";

/** The fixed answers a failed test may show. No command output ever reaches the UI. */
export const TEST_ERRORS = {
  connect: "Cannot connect",
  key: "Key rejected",
  models: "No /models at this host",
  notModelServer: "Not a model server",
  empty: "No models",
};

/**
 * Runs as `sh -c <WRAPPER> -- <file> <command> ...`: reads the key out of the provider file into
 * OMLX_API_KEY, then becomes the agent. The key never appears in an argument list.
 */
export const WRAPPER = `export OMLX_API_KEY="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["omlx"]["apiKey"])' "$1")"; shift; exec "$@"`;

/** A base URL like http://127.0.0.1:8000/v1, or a fixed message. Trailing slashes are dropped. */
export function validateHost(text) {
  const host = String(text ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s"'`\\]+$/i.test(host)) return { error: "Enter a host like http://127.0.0.1:8000/v1" };
  try {
    new URL(host);
  } catch {
    return { error: "Enter a host like http://127.0.0.1:8000/v1" };
  }
  return { host };
}

/**
 * What a `GET <host>/models` answer means: `{ ok: true, models }` or `{ ok: false, error }` with
 * one of TEST_ERRORS. `status` is the HTTP status, 0 when the request never reached a server.
 */
export function judgeModels(status, body) {
  const code = Number(status);
  if (code === 200) {
    let answer;
    try {
      answer = JSON.parse(String(body ?? ""));
    } catch {
      return { ok: false, error: TEST_ERRORS.notModelServer };
    }
    const data = answer?.data;
    if (!Array.isArray(data)) return { ok: false, error: TEST_ERRORS.notModelServer };
    const models = data.map((entry) => (typeof entry === "string" ? entry : entry?.id)).filter((id) => typeof id === "string" && id !== "");
    if (models.length === 0) return { ok: false, error: TEST_ERRORS.empty };
    return { ok: true, models };
  }
  if (code === 401 || code === 403) return { ok: false, error: TEST_ERRORS.key };
  if (code === 404) return { ok: false, error: TEST_ERRORS.models };
  return { ok: false, error: TEST_ERRORS.connect };
}

/**
 * The argv a Codex launch runs. `baseArgv` is today's argv (the program first, then its arguments);
 * `provider` is a saved record plus `configPath`. With no provider the argv is unchanged.
 */
export function launchArgv(baseArgv, provider, model) {
  const argv = [...(baseArgv ?? [])];
  if (!provider) return argv;
  const [command, ...rest] = argv;
  return [
    "/bin/sh",
    "-c",
    WRAPPER,
    "--",
    provider.configPath,
    command,
    // Without this Codex writes the environment, key included, to ~/.codex/shell_snapshots/.
    "--disable",
    "shell_snapshot",
    ...rest,
    "-m",
    model,
    "-c",
    'model_provider="omlx"',
    "-c",
    'model_providers.omlx.name="oMLX"',
    "-c",
    `model_providers.omlx.base_url="${provider.host}"`,
    "-c",
    'model_providers.omlx.env_key="OMLX_API_KEY"',
  ];
}

/** model-providers.json: `{ providers }`, or a fixed message. A missing file is no providers. */
export function parseProviderFile(text) {
  if (text == null || String(text).trim() === "") return { providers: {} };
  let root;
  try {
    root = JSON.parse(text);
  } catch {
    return { error: "model-providers.json is not valid JSON." };
  }
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    return { error: "model-providers.json must contain a JSON object." };
  }
  return { providers: root };
}

export function serializeProviderFile(providers) {
  return `${JSON.stringify(providers ?? {}, null, 2)}\n`;
}
