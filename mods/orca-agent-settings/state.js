import { normalizePermissions } from "./permissions.js";
import { FULL_ROWS, VISIBLE_ROWS, viewportHeight } from "./list-viewport.js";

                                        
const BUILTIN_DEFAULTS = {
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
	boldcreate: ["boldcreate"],
	empryo: ["empryo"],
	swival: ["swival"],
	crush: ["crush"],
	"dsh-tui": ["dsh-tui"],
	goose: ["goose"],
	hermes: ["hermes"],
	kimi: ["kimi"],
	kiro: ["kiro-cli"],
	omp: ["omp"],
	pig: ["pig"],
	qoder: ["qodercli"]
};
const HOMEPAGES = {
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
	boldcreate: "https://docs.boldcreate.ai/cli/getting-started/installation",
	empryo: "https://empryo.com/docs/installation",
	swival: "https://github.com/Swival/swival#quick-start",
	pig: "https://www.pi-in-go.dev/install/",
	crush: "https://github.com/charmbracelet/crush",
	"dsh-tui": "https://github.com/ccch1mneyyy/dsh-TUI#quick-start",
	goose: "https://goose-docs.ai/docs/quickstart/",
	hermes: "https://hermes-agent.nousresearch.com/docs/",
	kimi: "https://www.kimi.com/code/docs/en/kimi-code-cli/getting-started.html",
	kiro: "https://kiro.dev/docs/cli/",
	omp: "https://omp.sh",
	qoder: "https://docs.qoder.com/cli/overview"
};
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const SAFE_ARG = /^[A-Za-z0-9_@%+=:,./-]+$/;
function quoteArg(arg) {
	if (arg !== "" && SAFE_ARG.test(arg)) return arg;
	return `'${String(arg).replaceAll("'", `'\\''`)}'`;
}
function formatArgv(argv) {
	return (argv ?? []).map(quoteArg).join(" ");
}
function argsToText(argv) {
	return (argv ?? []).join("\n");
}
function argsFromText(text) {
	const lines = String(text ?? "").replaceAll("\r\n", "\n").split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	return lines.filter((line) => line !== "");
}
function validateExecutable(command) {
	const cmd = String(command ?? "").trim();
	if (!cmd) return { error: "Enter the executable name or path." };
	if (/[\n\r]/.test(cmd)) return { error: "The executable cannot contain a line break." };
	if (cmd.includes("\0")) return { error: "The executable cannot contain a NUL character." };
	return { command: cmd };
}
function validateDraft(command, argsText) {
	const checked = validateExecutable(command);
	if ("error" in checked) return checked;
	const args = argsFromText(argsText);
	if (args.some((arg) => arg.includes("\0"))) return { error: "An argument cannot contain a NUL character." };
	return { run: [checked.command, ...args] };
}
function argsEditable(argv) {
	return Array.isArray(argv) && argv.every((arg) => typeof arg === "string" && arg !== "" && !/[\r\n]/.test(arg));
}
function draftRun(command, argsText, originalArgs) {
	const original = Array.isArray(originalArgs) ? originalArgs : [];
	if (!argsEditable(original)) {
		const checked = validateExecutable(command);
		return "error" in checked ? checked : { run: [checked.command, ...original] };
	}
	return validateDraft(command, argsText);
}
function programsUpdate(current, next, hasDirtyDrafts) {
	if (next === void 0 || next === current) return { kind: "none" };
	if (hasDirtyDrafts) return {
		kind: "conflict",
		text: next
	};
	return {
		kind: "apply",
		text: next
	};
}
function programsTextError(text) {
	const parsed = parseRoot(text);
	return "error" in parsed ? parsed.error : null;
}
function defaultRun(key) {
	return hasOwn(BUILTIN_DEFAULTS, key) ? [...BUILTIN_DEFAULTS[key]] : null;
}
function isBuiltinAgent(key) {
	return hasOwn(BUILTIN_DEFAULTS, key);
}
function homepageFor(key) {
	return HOMEPAGES[key] ?? null;
}
function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function parseJsonObject(text, label) {
	let value;
	try {
		value = JSON.parse(String(text));
	} catch (error) {
		return { error: `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (!isRecord(value)) return { error: `${label} must contain a JSON object.` };
	return { value };
}
function parseRoot(text) {
	if (text == null || String(text).trim() === "") return { root: { programs: {} } };
	const parsed = parseJsonObject(text, "programs.json");
	if ("error" in parsed) return { error: parsed.error };
	const record = parsed.value;
	if (record.programs !== void 0 && !isRecord(record.programs)) return { error: "programs.json's `programs` must be an object." };
	if (record.programs === void 0) record.programs = {};
	return { root: record };
}
function readRunOverride(text, key) {
	return readParsedRunOverride(parseRoot(text), key);
}
function createRunOverrideReader(text) {
	const parsed = parseRoot(text);
	return (key) => readParsedRunOverride(parsed, key);
}
function readParsedRunOverride(parsed, key) {
	if ("error" in parsed) return { error: parsed.error };
	const entry = parsed.root.programs[key];
	if (entry === void 0) return {
		run: null,
		entry: null
	};
	if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return { error: `programs.json's \`${key}\` entry must be an object.` };
	const record = entry;
	if (!hasOwn(record, "run")) return {
		run: null,
		entry: record
	};
	const run = record.run;
	if (!Array.isArray(run) || run.length === 0 || run.some((part) => typeof part !== "string")) return { error: `programs.json's \`${key}.run\` must be a non-empty array of strings.` };
	return {
		run: [...run],
		entry: record
	};
}
function writeRunOverrides(text, entries) {
	const parsed = parseRoot(text);
	if ("error" in parsed) return { error: parsed.error };
	const root = parsed.root;
	const problem = entries.map(([key, run]) => runEntryProblem(root.programs[key], key, run)).find((value) => Boolean(value));
	if (problem) return { error: problem };
	let changed = false;
	for (const [key, run] of entries) changed = applyRunEntry(root.programs, key, run) || changed;
	return {
		text: `${JSON.stringify(root, null, 2)}\n`,
		changed
	};
}
function runEntryProblem(existing, key, run) {
	if (existing !== void 0 && (existing === null || typeof existing !== "object" || Array.isArray(existing))) return `programs.json's \`${key}\` entry must be an object; nothing was changed.`;
	if (run !== null && (!Array.isArray(run) || run.length === 0 || run.some((part) => typeof part !== "string"))) return "A command needs an executable and string arguments.";
	return null;
}
function applyRunEntry(programs, key, run) {
	const existing = programs[key];
	if (run !== null) {
		programs[key] = {
			...existing !== null && typeof existing === "object" && !Array.isArray(existing) ? existing : {},
			run: [...run]
		};
		return true;
	}
	if (existing === void 0) return false;
	const entry = { ...existing };
	delete entry.run;
	if (Object.keys(entry).length === 0) delete programs[key];
	else programs[key] = entry;
	return true;
}
function writeRunOverride(text, key, run) {
	return writeRunOverrides(text, [[key, run]]);
}
function validDisabledKeys(value) {
	return value === void 0 || Array.isArray(value) && value.every((key) => typeof key === "string");
}
function managerConfig(record) {
	const permissions = normalizePermissions(record.permissions);
	if ("error" in permissions) return { error: permissions.error };
	if (record.herdrEnv !== void 0 && typeof record.herdrEnv !== "boolean") return { error: "agent-manager.json's `herdrEnv` must be a boolean." };
	if (!validDisabledKeys(record.disabled)) return { error: "agent-manager.json's `disabled` must be an array of agent keys." };
	return {
		disabled: new Set(record.disabled ?? []),
		permissions,
		herdrEnv: record.herdrEnv !== false
	};
}
function parseManagerConfig(text) {
	if (text == null || String(text).trim() === "") return {
		disabled:                 new Set(),
		permissions: {
			default: "own",
			overrides: {}
		},
		herdrEnv: true
	};
	const parsed = parseJsonObject(text, "agent-manager.json");
	return "error" in parsed ? { error: parsed.error } : managerConfig(parsed.value);
}
function compareKeys(left, right) {
	if (left < right) return -1;
	return left > right ? 1 : 0;
}
function serializeManagerConfig(disabled, permissions = {
	default: "own",
	overrides: {}
}, herdrEnv = true) {
	const root = {
		version: 1,
		disabled: [...disabled].filter((key) => typeof key === "string").sort()
	};
	if (!herdrEnv) root.herdrEnv = false;
	const overrides = Object.fromEntries(Object.entries(permissions.overrides ?? {}).filter(([, choice]) => typeof choice === "string").sort(([left], [right]) => compareKeys(left, right)));
	if (permissions.default !== "own" || Object.keys(overrides).length > 0) root.permissions = {
		default: permissions.default ?? "own",
		overrides
	};
	return `${JSON.stringify(root, null, 2)}\n`;
}
function splitInventory(agents, disabled =                 new Set()) {
	const withEnabled = (agents ?? []).map((agent) => ({
		...agent,
		enabled: Boolean(agent.installed) && !disabled.has(agent.key)
	}));
	return {
		installed: withEnabled.filter((agent) => agent.installed),
		available: withEnabled.filter((agent) => !agent.installed)
	};
}
function applyFreshInstalled(agents, freshByKey) {
	return (agents ?? []).map((agent) => freshByKey.has(agent.key) ? {
		...agent,
		installed: freshByKey.get(agent.key)
	} : agent);
}
function isFish(shellPath) {
	return /(^|[/\\])fish$/.test(String(shellPath ?? ""));
}
const LIST_ROW_HEIGHT = 56;
const LIST_HEADER_HEIGHT = 42;
const LIST_VISIBLE_ROWS = VISIBLE_ROWS;
function listViewportHeight(rowCount, expanded = false) {
	return rowCount > 5 || expanded ? viewportHeight(5 + 1, 56) + 2 : null;
}
function commandPathScript(shellPath) {
	if (isFish(shellPath)) return "command -v -- $argv[1]";
	return "command -v -- \"$1\"";
}
function parseCommandPath(stdout) {
	return String(stdout ?? "").split("\n").map((part) => part.trim()).find((part) => part.startsWith("/")) ?? null;
}
function commandCheckScript(shellPath) {
	if (isFish(shellPath)) return "for c in $argv; if command -v -- $c >/dev/null 2>&1; printf 'HERDRAM:1\\n'; else; printf 'HERDRAM:0\\n'; end; end";
	return "for c in \"$@\"; do if command -v -- \"$c\" >/dev/null 2>&1; then printf 'HERDRAM:1\\n'; else printf 'HERDRAM:0\\n'; fi; done";
}
function checkArgs(shellPath, script, commands, interactive = true) {
	const args = [interactive ? "-lic" : "-lc", script];
	if (!isFish(shellPath)) args.push("herdr-agent-manager");
	for (const command of commands) args.push(command);
	return args;
}
function parseCommandCheck(stdout, expected) {
	const values = String(stdout ?? "").split("\n").filter((line) => line.startsWith("HERDRAM:")).map((line) => line.slice(8).trim()).map((value) => value === "1");
	if (values.length !== expected) throw new Error(`install check answered ${values.length} of ${expected} commands`);
	return values;
}
function checkCommands(agents) {
	return (agents ?? []).map((agent) => agent.run[0]);
}

export { BUILTIN_DEFAULTS, HOMEPAGES, LIST_HEADER_HEIGHT, LIST_ROW_HEIGHT, LIST_VISIBLE_ROWS, applyFreshInstalled, argsEditable, argsFromText, argsToText, checkArgs, checkCommands, commandCheckScript, commandPathScript, createRunOverrideReader, defaultRun, draftRun, formatArgv, homepageFor, isBuiltinAgent, isFish, listViewportHeight, parseCommandCheck, parseCommandPath, parseManagerConfig, programsTextError, programsUpdate, quoteArg, readRunOverride, serializeManagerConfig, splitInventory, validateDraft, validateExecutable, writeRunOverride, writeRunOverrides };
