// Pure state for the Agent Manager. No herdr or gpui imports: `node --test` runs this file
// directly, and the mod imports it from main.js.
//
// Command source of truth: programs.json's `run` array (executable first, then its arguments).
// Nothing here splits a shell string, so an argument keeps its spaces, quotes and backslashes.

// Herdr's built-in `run` for the agents it offers, read from a clean app home (no programs.json)
// on Herdr 0.1.16 (`knownAgents()`); a key missing here is a program the user added in
// programs.json, which has no built-in command to reset to.
export const BUILTIN_DEFAULTS = {
  claude: ["claude"],
  codex: ["codex", "--no-daemon"],
  pi: ["pi"],
  opencode: ["opencode"],
  cursor: ["agent"],
  copilot: ["copilot"],
  amp: ["amp"],
  gemini: ["gemini"],
  grok: ["grok"],
  antigravity: ["agy"],
  crush: ["crush"],
  "dsh-tui": ["dsh-tui"],
  goose: ["goose"],
  hermes: ["hermes"],
  kimi: ["kimi"],
  kiro: ["kiro-cli"],
  omp: ["omp"],
  pig: ["pig"],
  qoder: ["qodercli"],
};

// Install documentation verified against Orca's agent catalog. `pig` has no catalog entry, so
// the manager says no guide is known instead of guessing a URL.
export const HOMEPAGES = {
  claude: "https://code.claude.com/docs",
  codex: "https://github.com/openai/codex",
  pi: "https://pi.dev",
  opencode: "https://opencode.ai/docs/cli/",
  cursor: "https://cursor.com/cli",
  copilot: "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli",
  amp: "https://ampcode.com/manual#install",
  gemini: "https://github.com/google-gemini/gemini-cli",
  grok: "https://x.ai/cli",
  antigravity: "https://antigravity.google/docs/cli-overview",
  crush: "https://github.com/charmbracelet/crush",
  "dsh-tui": "https://github.com/ccch1mneyyy/dsh-TUI#quick-start",
  goose: "https://goose-docs.ai/docs/quickstart/",
  hermes: "https://hermes-agent.nousresearch.com/docs/",
  kimi: "https://www.kimi.com/code/docs/en/kimi-code-cli/getting-started.html",
  kiro: "https://kiro.dev/docs/cli/",
  omp: "https://omp.sh",
  qoder: "https://docs.qoder.com/cli/overview",
};

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const SAFE_ARG = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** Preview only. Saving never goes through this text. */
export function quoteArg(arg) {
  if (arg !== "" && SAFE_ARG.test(arg)) return arg;
  return `'${String(arg).replaceAll("'", `'\\''`)}'`;
}

/** A shell-looking line for people to read, never a string this mod parses back. */
export function formatArgv(argv) {
  return (argv ?? []).map(quoteArg).join(" ");
}

/** One argument per line: the line is the argument, byte for byte (blank lines are ignored). */
export function argsToText(argv) {
  return (argv ?? []).join("\n");
}

export function argsFromText(text) {
  const lines = String(text ?? "").replaceAll("\r\n", "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.filter((line) => line !== "");
}

/** A draft's executable (one element) and arguments (kept apart from it). */
export function validateDraft(command, argsText) {
  const cmd = String(command ?? "").trim();
  if (!cmd) return { error: "Enter the executable name or path." };
  if (/[\n\r]/.test(cmd)) return { error: "The executable cannot contain a line break." };
  if (cmd.includes("\0")) return { error: "The executable cannot contain a NUL character." };
  const args = argsFromText(argsText);
  if (args.some((arg) => arg.includes("\0"))) {
    return { error: "An argument cannot contain a NUL character." };
  }
  return { run: [cmd, ...args] };
}

export function programsTextError(text) {
  return parseRoot(text).error ?? null;
}

export function defaultRun(key) {
  return hasOwn(BUILTIN_DEFAULTS, key) ? [...BUILTIN_DEFAULTS[key]] : null;
}

export function isBuiltinAgent(key) {
  return hasOwn(BUILTIN_DEFAULTS, key);
}

export function homepageFor(key) {
  return HOMEPAGES[key] ?? null;
}

function parseRoot(text) {
  if (text == null || String(text).trim() === "") return { root: { programs: {} } };
  let root;
  try {
    root = JSON.parse(text);
  } catch (error) {
    return { error: `programs.json is not valid JSON: ${error.message}` };
  }
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    return { error: "programs.json must contain a JSON object." };
  }
  if (root.programs !== undefined && (root.programs === null || typeof root.programs !== "object" || Array.isArray(root.programs))) {
    return { error: "programs.json's `programs` must be an object." };
  }
  return { root };
}

/** The `run` this mod wrote/reads in programs.json, or null when the built-in command is used. */
export function readRunOverride(text, key) {
  const parsed = parseRoot(text);
  if (parsed.error) return { error: parsed.error };
  const entry = parsed.root.programs?.[key];
  if (entry === undefined) return { run: null, entry: null };
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return { error: `programs.json's \`${key}\` entry must be an object.` };
  }
  if (!hasOwn(entry, "run")) return { run: null, entry };
  if (!Array.isArray(entry.run) || entry.run.length === 0 || entry.run.some((part) => typeof part !== "string")) {
    return { error: `programs.json's \`${key}.run\` must be a non-empty array of strings.` };
  }
  return { run: [...entry.run], entry };
}

/**
 * Writes one agent's `run` and leaves every other field and entry alone. `run: null` removes the
 * override (and the entry itself when `run` was its only field).
 */
export function writeRunOverride(text, key, run) {
  const parsed = parseRoot(text);
  if (parsed.error) return { error: parsed.error };
  const root = parsed.root;
  if (root.programs === undefined) root.programs = {};
  const existing = root.programs[key];
  if (existing !== undefined && (existing === null || typeof existing !== "object" || Array.isArray(existing))) {
    return { error: `programs.json's \`${key}\` entry must be an object; nothing was changed.` };
  }
  if (run === null) {
    if (existing === undefined) return { text: text == null ? "" : String(text) };
    const entry = { ...existing };
    delete entry.run;
    if (Object.keys(entry).length === 0) delete root.programs[key];
    else root.programs[key] = entry;
  } else {
    if (!Array.isArray(run) || run.length === 0 || run.some((part) => typeof part !== "string")) {
      return { error: "A command needs an executable and string arguments." };
    }
    root.programs[key] = { ...(existing ?? {}), run: [...run] };
  }
  return { text: `${JSON.stringify(root, null, 2)}\n` };
}

/** `agent-manager.json`: only the agents the person turned off are stored. */
export function parseManagerConfig(text) {
  if (text == null || String(text).trim() === "") return { disabled: new Set() };
  let root;
  try {
    root = JSON.parse(text);
  } catch (error) {
    return { error: `agent-manager.json is not valid JSON: ${error.message}` };
  }
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    return { error: "agent-manager.json must contain a JSON object." };
  }
  if (root.disabled === undefined) return { disabled: new Set() };
  if (!Array.isArray(root.disabled) || root.disabled.some((key) => typeof key !== "string")) {
    return { error: "agent-manager.json's `disabled` must be an array of agent keys." };
  }
  return { disabled: new Set(root.disabled) };
}

export function serializeManagerConfig(disabled) {
  const keys = [...disabled].filter((key) => typeof key === "string").sort();
  return `${JSON.stringify({ version: 1, disabled: keys }, null, 2)}\n`;
}

/** Installed and Available keep Herdr's order; a disabled installed agent stays installed. */
export function splitInventory(agents, disabled = new Set()) {
  // A CLI that is not installed cannot start, so its switch is unavailable even when the stored
  // disabled list does not contain it. Installing it makes the switch active again.
  const withEnabled = (agents ?? []).map((agent) => ({
    ...agent,
    enabled: Boolean(agent.installed) && !disabled.has(agent.key),
  }));
  return {
    installed: withEnabled.filter((agent) => agent.installed),
    available: withEnabled.filter((agent) => !agent.installed),
  };
}

/** A forced install check can only change the installed flag, never the identity or command. */
export function applyFreshInstalled(agents, freshByKey) {
  return (agents ?? []).map((agent) =>
    freshByKey.has(agent.key) ? { ...agent, installed: freshByKey.get(agent.key) } : agent,
  );
}

export function isFish(shellPath) {
  return /(^|[/\\])fish$/.test(String(shellPath ?? ""));
}

/**
 * Prints one marked line per command so login-shell startup noise on stdout cannot shift the
 * results. Commands arrive as positional arguments, never interpolated into the script.
 */
export function commandCheckScript(shellPath) {
  if (isFish(shellPath)) {
    return "for c in $argv; if command -v -- $c >/dev/null 2>&1; printf 'HERDRAM:1\\n'; else; printf 'HERDRAM:0\\n'; end; end";
  }
  return 'for c in "$@"; do if command -v -- "$c" >/dev/null 2>&1; then printf \'HERDRAM:1\\n\'; else printf \'HERDRAM:0\\n\'; fi; done';
}

/** Parse the marked lines from `commandCheckScript`; a short/long answer is a failed check. */
export function parseCommandCheck(stdout, expected) {
  const values = String(stdout ?? "")
    .split("\n")
    .filter((line) => line.startsWith("HERDRAM:"))
    .map((line) => line.slice("HERDRAM:".length).trim())
    .map((value) => value === "1");
  if (values.length !== expected) {
    throw new Error(`install check answered ${values.length} of ${expected} commands`);
  }
  return values;
}

/** First executable per agent, in the same order the agents were given. */
export function checkCommands(agents) {
  return (agents ?? []).map((agent) => agent.run[0]);
}
