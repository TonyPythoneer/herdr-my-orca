// Shared model-provider helpers: Codex can use compatible model servers, while Pi uses its built-in
// Groq provider. Used by orca-agent-settings (setup and test) and orca-agent-flyout (selection/launch).
//
// Pure: no herdr or gpui imports, so `node --test` runs it directly. Edit this file, then
// `node scripts/build-orca-ui.mjs --out .` writes the copies the two mods import.

export const OMLX = "omlx";
const PI_COMPACTION_RESERVE = 16384;
const UNKNOWN_OUTPUT_CAP = 8192;
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
 * Reads the key only when the provider file still has the host selected in the UI, then becomes the
 * agent. A failed lookup or a changed record stops the launch; the key never appears in argv.
 */
const KEY_FROM_PROVIDER = `key="$(python3 -c 'import json,sys; r=json.load(open(sys.argv[1]))[sys.argv[2]]; sys.exit(1) if r.get("host") != sys.argv[3] else None; print(r.get("apiKey", ""))' "$1" "$2" "$3")" || exit 1; [ -n "$key" ] || exit 1;`;
export const WRAPPER = `${KEY_FROM_PROVIDER} export OMLX_API_KEY="$key"; unset key; shift 3; exec "$@"`;
export const PROVIDER_KEY_WRAPPER = `${KEY_FROM_PROVIDER} export HERDR_PROVIDER_API_KEY="$key"; unset key; shift 3; exec "$@"`;
export const CLAUDE_PROVIDER_WRAPPER = `${KEY_FROM_PROVIDER} export ANTHROPIC_AUTH_TOKEN="$key"; unset key; shift 3; exec "$@"`;

const HOST_ERROR = "Enter a host like http://127.0.0.1:8000/v1";

/** A base URL like http://127.0.0.1:8000/v1, or a fixed message. Trailing slashes are dropped. */
export function validateHost(text) {
  const host = String(text ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s"'`\\]+$/i.test(host)) return { error: HOST_ERROR };
  try {
    new URL(host);
  } catch {
    return { error: HOST_ERROR }; // the shape matched but the URL parser still refuses it
  }
  return { host };
}
/** Drop only models whose catalog explicitly rules out text chat or tool calls. */
export function supportsCodingModel(info) {
  if (!info || typeof info !== "object") return true;
  if (Array.isArray(info.inputModalities) && !info.inputModalities.includes("text")) return false;
  if (Array.isArray(info.outputModalities) && !info.outputModalities.includes("text")) return false;
  if (Array.isArray(info.supportedFeatures) && !info.supportedFeatures.some((feature) => feature === "tools" || feature === "tool_use")) return false;
  return true;
}

export function piModelLimits(info) {
  const contextWindow = info?.contextWindow;
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= PI_COMPACTION_RESERVE) return null;
  // shortcut: when /models omits an output cap, bound it to 8K or the known context, until the provider publishes one.
  const maxTokens = Number.isSafeInteger(info.maxTokens) && info.maxTokens > 0 ? info.maxTokens : Math.min(UNKNOWN_OUTPUT_CAP, contextWindow);
  return maxTokens <= contextWindow ? { contextWindow, maxTokens } : null;
}

/** Launch Pi through a one-run provider extension, keeping the saved key out of argv/config files. */
export function launchPiArgv(baseArgv, provider, model, extensionPath) {
  const argv = [...(baseArgv ?? [])];
  if (!provider) return argv;
  const [command, ...rest] = argv;
  const models = [...new Set([...(provider.models ?? []), model].filter((id) => typeof id === "string" && id && supportsCodingModel(provider.modelInfo?.[id])))];
  const modelInfo = Object.fromEntries(models.flatMap((id) => {
    const info = provider.modelInfo && Object.hasOwn(provider.modelInfo, id) ? provider.modelInfo[id] : null;
    const limits = piModelLimits(info);
    if (!limits) return [];
    return [[id, { ...info, ...limits }]];
  }));
  return [
    "/bin/sh", "-c", PROVIDER_KEY_WRAPPER, "--", provider.configPath, provider.id, provider.host,
    "env", `HERDR_PI_BASE_URL=${provider.host}`, `HERDR_PI_MODELS=${JSON.stringify(models)}`, `HERDR_PI_MODEL_INFO=${JSON.stringify(modelInfo)}`,
    command, ...rest, "--provider", "herdr", "--model", model, "--extension", extensionPath,
  ];
}

/** Claude Code expects an Anthropic-compatible endpoint and bearer token for the selected provider. */
export function launchClaudeArgv(baseArgv, provider, model) {
  const argv = [...(baseArgv ?? [])];
  if (!provider) return argv;
  const [command, ...rest] = argv;
  return [
    "/bin/sh", "-c", CLAUDE_PROVIDER_WRAPPER, "--", provider.configPath, provider.id, provider.host,
    "env", `ANTHROPIC_BASE_URL=${provider.host}`, command, ...rest, "--model", model,
  ];
}

/** Build OpenCode's per-run custom OpenAI-compatible provider without persisting credentials. */
export function launchOpenCodeArgv(baseArgv, provider, model) {
  const argv = [...(baseArgv ?? [])];
  if (!provider) return argv;
  const models = [...new Set([...(provider.models ?? []), model].filter((id) => typeof id === "string" && id && supportsCodingModel(provider.modelInfo?.[id])))];
  const selected = models.indexOf(model);
  const entries = Object.fromEntries(models.map((id, index) => {
    const info = provider.modelInfo && Object.hasOwn(provider.modelInfo, id) ? provider.modelInfo[id] : {};
    const context = Number.isSafeInteger(info?.contextWindow) && info.contextWindow > 0 ? info.contextWindow : undefined;
    // shortcut: OpenCode requires both limits; cap unknown output at 8K or the known context until /models reports it.
    const output = context ? (Number.isSafeInteger(info?.maxTokens) && info.maxTokens > 0 ? Math.min(info.maxTokens, context) : Math.min(UNKNOWN_OUTPUT_CAP, context)) : undefined;
    return [`model-${index + 1}`, {
      name: id,
      modelID: id,
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      ...(context && output ? { limit: { context, output } } : {}),
    }];
  }));
  const config = {
    "$schema": "https://opencode.ai/config.json",
    model: `herdr/model-${selected + 1}`,
    providers: {
      herdr: {
        name: provider.name,
        env: ["HERDR_PROVIDER_API_KEY"],
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: provider.host },
        models: entries,
      },
    },
  };
  // The normal OpenCode wrapper is `env OPENCODE_CONFIG_CONTENT=... opencode ...`; replace only
  // that default config while keeping the command and standalone suffix from the spec.
  return [
    "/bin/sh", "-c", PROVIDER_KEY_WRAPPER, "--", provider.configPath, provider.id, provider.host,
    "env", `OPENCODE_CONFIG_CONTENT=${JSON.stringify(config)}`, ...argv.slice(2),
  ];
}

const GITHUB_OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const GITHUB_REPO = /^[A-Za-z0-9._-]{1,100}$/;
const LINK_ERROR = "Enter a link like https://github.com/owner/repo or https://example.com";
const AVATAR_SIZE = 64;

// The URL a pasted link means (a bare `example.com` is https), or null when it is not one.
function parseLinkUrl(value) {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null; // the caller answers with the fixed LINK_ERROR
  }
}

// A github.com link: the repo when the path names a valid one, else the owner alone.
function githubInfo(url) {
  const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
  if (!owner || !GITHUB_OWNER.test(owner)) return { error: LINK_ERROR };
  const repo = rawRepo?.replace(/\.git$/, "");
  const named = repo && GITHUB_REPO.test(repo) ? repo : "";
  return { link: `https://github.com/${owner}${named ? `/${named}` : ""}`, name: named || owner, iconUrl: `https://github.com/${owner}.png?size=${AVATAR_SIZE}` };
}

/**
 * What a pasted project link gives: `{ link, name, iconUrl }` (all empty for no link) or `{ error }`.
 * A GitHub link names the repo and takes the owner's avatar; any other https link names its site
 * and takes `/favicon.ico`. `link` is the normalized form, so two spellings compare equal.
 */
export function linkInfo(text) {
  const value = String(text ?? "").trim();
  if (value === "") return { link: "", name: "", iconUrl: "" };
  const url = parseLinkUrl(value);
  if (!url) return { error: LINK_ERROR };
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.protocol !== "https:" || url.username || url.password || !host.includes(".")) return { error: LINK_ERROR };
  if (host === "github.com") return githubInfo(url);
  return { link: `https://${url.host}`, name: host.split(".").at(-2), iconUrl: `https://${url.host}/favicon.ico` };
}

/** The link a saved record stands for. Older records kept only a GitHub owner. */
export function recordLink(record) {
  return record?.link ?? (record?.githubOwner ? `https://github.com/${record.githubOwner}` : "");
}

const PORT_PRESETS = {
  8000: { name: "oMLX", link: "https://github.com/jundot/omlx" },
  11434: { name: "Ollama", link: "https://github.com/ollama/ollama" },
};

/** A name and link to offer for a well-known local server, by its port. Only ever a suggestion. */
export function presetFor(host) {
  let url;
  try {
    url = new URL(host);
  } catch {
    return null; // a suggestion only: an unparsable host just gets none
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return null;
  const preset = PORT_PRESETS[url.port];
  return preset ? { ...preset } : null;
}

/** An id for a new record: the name as a slug, unique among `taken`, never an Object.prototype key. */
export function slugId(name, taken) {
  const base = String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "provider";
  let id = base;
  // "none" is the flyout's own word for "no provider".
  for (let n = 2; taken.includes(id) || id in {} || id === "none"; n += 1) id = `${base}-${n}`;
  return id;
}

const KEY_HINT_DOTS = "•".repeat(12);
const KEY_HINT_TAIL = 4;
// A key this short would be mostly shown by its last characters, so none are.
const KEY_HINT_MIN_LENGTH = 8;

/** What a saved key looks like on screen: dots and its last four characters. */
export function keyHint(key) {
  const text = String(key ?? "");
  return text.length >= KEY_HINT_MIN_LENGTH ? `${KEY_HINT_DOTS}${text.slice(-KEY_HINT_TAIL)}` : KEY_HINT_DOTS;
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
    const entries = data.filter((entry) => typeof entry === "string" || (entry && typeof entry === "object" && !Array.isArray(entry)));
    const models = [...new Set(entries.map((entry) => (typeof entry === "string" ? entry : entry.id)).filter((id) => typeof id === "string" && id !== ""))];
    if (models.length === 0) return { ok: false, error: TEST_ERRORS.empty };
    const modelInfo = Object.create(null);
    for (const entry of entries) {
      if (typeof entry === "string" || !models.includes(entry.id)) continue;
      const positive = (...values) => values.find((value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0);
      const topProvider = entry.top_provider && typeof entry.top_provider === "object" ? entry.top_provider : {};
      const architecture = entry.architecture && typeof entry.architecture === "object" ? entry.architecture : {};
      const contextWindow = positive(entry.context_window, entry.contextWindow, entry.max_model_len, entry.context_length, topProvider.context_length);
      const maxTokens = positive(entry.max_completion_tokens, entry.max_tokens, entry.maxTokens, entry.max_output_length, topProvider.max_completion_tokens);
      const inputValues = entry.input_modalities ?? architecture.input_modalities;
      const outputValues = entry.output_modalities ?? architecture.output_modalities;
      const inputModalities = Array.isArray(inputValues) ? inputValues.filter((value) => typeof value === "string") : undefined;
      const outputModalities = Array.isArray(outputValues) ? outputValues.filter((value) => typeof value === "string") : undefined;
      const features = Array.isArray(entry.supported_features) ? entry.supported_features.filter((value) => typeof value === "string")
        : Array.isArray(entry.supported_parameters) ? (entry.supported_parameters.includes("tools") ? ["tools"] : []) : undefined;
      if (contextWindow || maxTokens || inputModalities || outputModalities || features) modelInfo[entry.id] = {
        ...(contextWindow ? { contextWindow } : {}),
        ...(maxTokens ? { maxTokens } : {}),
        ...(inputModalities ? { inputModalities } : {}),
        ...(outputModalities ? { outputModalities } : {}),
        ...(features ? { supportedFeatures: features } : {}),
      };
    }
    return { ok: true, models, ...(Object.keys(modelInfo).length ? { modelInfo } : {}) };
  }
  if (code === 401 || code === 403) return { ok: false, error: TEST_ERRORS.key };
  if (code === 404) return { ok: false, error: TEST_ERRORS.models };
  return { ok: false, error: TEST_ERRORS.connect };
}

/**
 * The argv a Codex launch runs. `baseArgv` is today's argv (the program first, then its arguments);
 * `provider` is a saved record plus its `id` and `configPath`. With no provider the argv is unchanged.
 */
export function launchArgv(baseArgv, provider, model) {
  const argv = [...(baseArgv ?? [])];
  if (!provider) return argv;
  const [command, ...rest] = argv;
  const contextWindow = provider.modelInfo?.[model]?.contextWindow;
  const contextOverride = Number.isSafeInteger(contextWindow) && contextWindow > 0 ? ["-c", `model_context_window=${contextWindow}`] : [];
  return [
    "/bin/sh",
    "-c",
    WRAPPER,
    "--",
    provider.configPath,
    provider.id ?? OMLX,
    provider.host,
    command,
    // Without this Codex writes the environment, key included, to ~/.codex/shell_snapshots/.
    "--disable",
    "shell_snapshot",
    ...rest,
    "-m",
    model,
    // The Codex name is a fixed alias, never a record id: nothing from the file is spelled into a
    // config string. Only the wrapper's argument (data) carries the id.
    "-c",
    'model_provider="omlx"',
    ...contextOverride,
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

/** Compare and replace the key file under one persistent lock inode. */
export async function writeProviderFile({ appHome, exec, writeTextFile }, text, expected) {
  const home = typeof appHome === "function" ? appHome() : appHome;
  const file = `${home}/${PROVIDER_FILE}`;
  const lock = `${file}.lock`;
  const made = await exec("mktemp", ["-d", `${home}/.provider-write.XXXXXX`]);
  const dir = String(made?.stdout ?? "").trim();
  if (made?.code !== 0 || !dir.startsWith(`${home}/.provider-write.`)) throw new Error("Could not create private provider staging directory.");
  const staged = `${dir}/${PROVIDER_FILE}`;
  const expectedFile = `${dir}/expected`;
  try {
    const privateDir = await exec("chmod", ["700", dir]);
    if (privateDir?.code !== 0) throw new Error("Could not secure provider staging directory.");
    await writeTextFile(staged, text, null);
    const privateFile = await exec("chmod", ["600", staged]);
    if (privateFile?.code !== 0) throw new Error("Could not secure staged provider file.");
    if (expected !== null) {
      await writeTextFile(expectedFile, expected, null);
      const privateExpected = await exec("chmod", ["600", expectedFile]);
      if (privateExpected?.code !== 0) throw new Error("Could not secure provider snapshot.");
    }
    const python = [
      "import fcntl, os, sys",
      "lock_path, target, staged, expected_path, absent = sys.argv[1:]",
      "fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)",
      "os.fchmod(fd, 0o600)",
      "with os.fdopen(fd, 'r+b') as lock_file:",
      "    fcntl.flock(lock_file, fcntl.LOCK_EX)",
      "    if absent == '1':",
      "        try: os.stat(target)",
      "        except FileNotFoundError: pass",
      "        else: raise SystemExit('provider file already exists')",
      "    else:",
      "        with open(target, 'rb') as current_file: current = current_file.read()",
      "        with open(expected_path, 'rb') as expected_file: previous = expected_file.read()",
      "        if current != previous: raise SystemExit('provider file changed')",
      "    os.replace(staged, target)",
    ].join("\n");
    const replaced = await exec("python3", ["-c", python, lock, file, staged, expected === null ? "" : expectedFile, expected === null ? "1" : "0"]);
    if (replaced?.code !== 0) throw new Error("Provider file changed or could not be installed.");
  } finally {
    await exec("rm", ["-rf", dir]).catch(() => {});
  }
}
