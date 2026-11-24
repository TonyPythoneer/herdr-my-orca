// The oMLX model provider for Codex: the one place that decides what a host is, what a `/models`
// answer means, and how a provider launch is spelled. Used by orca-agent-settings (setup and test)
// and orca-agent-flyout (the Codex flyout and the launch).
//
// Pure: no herdr or gpui imports, so `node --test` runs it directly. Edit this file, then
// `node scripts/build-orca-ui.mjs --out .` writes the copies the two mods import.

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
 * Runs as `sh -c <WRAPPER> -- <file> <id> <command> ...`: reads the key of the `<id>` record out of
 * the provider file into OMLX_API_KEY, then becomes the agent. The key never appears in an argument
 * list, and it always comes from the same record as the host.
 */
export const WRAPPER = `export OMLX_API_KEY="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]]["apiKey"])' "$1" "$2")"; shift 2; exec "$@"`;

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
 * `provider` is a saved record plus its `id` and `configPath`. With no provider the argv is unchanged.
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
    provider.id ?? OMLX,
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
// Generated from orca-ui/shared/codex-provider.js by scripts/build-orca-ui.mjs. Edit that file, not this copy.
