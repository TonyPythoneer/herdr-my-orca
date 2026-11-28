import { normalizePermissions, type Permissions, type PermissionChoice } from "./permissions.js";
import { FULL_ROWS, VISIBLE_ROWS, viewportHeight } from "../../primitives/list-viewport.js";

export const BUILTIN_DEFAULTS: Record<string, string[]> = {
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
  qoder: ["qodercli"],
};

export const HOMEPAGES: Record<string, string> = {
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
  qoder: "https://docs.qoder.com/cli/overview",
};

type JsonRecord = Record<string, unknown>;

interface ProgramsFile {
  programs: Record<string, unknown>;
  [key: string]: unknown;
}

interface ManagerFile {
  version: number;
  disabled: string[];
  herdrEnv?: boolean;
  permissions?: Permissions;
}

export interface ManagerConfig {
  disabled: Set<string>;
  permissions: Permissions;
  herdrEnv: boolean;
}

export type ManagerParse = ManagerConfig | { error: string };
export type RunRead = { run: string[] | null; entry: unknown } | { error: string };
export type RunWrite = { text: string; changed: boolean } | { error: string };
export type ProgramsUpdate =
  | { kind: "none" }
  | { kind: "conflict"; text: string }
  | { kind: "apply"; text: string };
export type ExecutableCheck = { command: string } | { error: string };
export type RunDraft = { run: string[] } | { error: string };

const hasOwn = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

const SAFE_ARG = /^[A-Za-z0-9_@%+=:,./-]+$/;

export function quoteArg(arg: string): string {
  if (arg !== "" && SAFE_ARG.test(arg)) return arg;
  return `'${String(arg).replaceAll("'", `'\\''`)}'`;
}

export function formatArgv(argv: readonly string[] | null | undefined): string {
  return (argv ?? []).map(quoteArg).join(" ");
}

export function argsToText(argv: readonly string[] | null | undefined): string {
  return (argv ?? []).join("\n");
}

export function argsFromText(text: unknown): string[] {
  const lines = String(text ?? "")
    .replaceAll("\r\n", "\n")
    .split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.filter((line) => line !== "");
}

export function validateExecutable(command: unknown): ExecutableCheck {
  const cmd = String(command ?? "").trim();
  if (!cmd) return { error: "Enter the executable name or path." };
  if (/[\n\r]/.test(cmd)) return { error: "The executable cannot contain a line break." };
  if (cmd.includes("\0")) return { error: "The executable cannot contain a NUL character." };
  return { command: cmd };
}

export function validateDraft(command: unknown, argsText: unknown): RunDraft {
  const checked = validateExecutable(command);
  if ("error" in checked) return checked;
  const args = argsFromText(argsText);
  if (args.some((arg) => arg.includes("\0"))) {
    return { error: "An argument cannot contain a NUL character." };
  }
  return { run: [checked.command, ...args] };
}

export function argsEditable(argv: unknown): boolean {
  return (
    Array.isArray(argv) &&
    argv.every((arg) => typeof arg === "string" && arg !== "" && !/[\r\n]/.test(arg))
  );
}

export function draftRun(command: unknown, argsText: unknown, originalArgs: unknown): RunDraft {
  const original = Array.isArray(originalArgs) ? (originalArgs as string[]) : [];
  if (!argsEditable(original)) {
    const checked = validateExecutable(command);
    return "error" in checked ? checked : { run: [checked.command, ...original] };
  }
  return validateDraft(command, argsText);
}

export function programsUpdate(
  current: string | undefined,
  next: string | undefined,
  hasDirtyDrafts: boolean,
): ProgramsUpdate {
  if (next === undefined || next === current) return { kind: "none" };
  if (hasDirtyDrafts) return { kind: "conflict", text: next };
  return { kind: "apply", text: next };
}

export function programsTextError(text: unknown): string | null {
  const parsed = parseRoot(text);
  return "error" in parsed ? parsed.error : null;
}

export function defaultRun(key: string): string[] | null {
  return hasOwn(BUILTIN_DEFAULTS, key) ? [...BUILTIN_DEFAULTS[key]] : null;
}

export function isBuiltinAgent(key: string): boolean {
  return hasOwn(BUILTIN_DEFAULTS, key);
}

export function homepageFor(key: string): string | null {
  return HOMEPAGES[key] ?? null;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(text: unknown, label: string): { value: JsonRecord } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(String(text));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { error: `${label} is not valid JSON: ${detail}` };
  }
  if (!isRecord(value)) return { error: `${label} must contain a JSON object.` };
  return { value };
}

function parseRoot(text: unknown): { root: ProgramsFile } | { error: string } {
  if (text == null || String(text).trim() === "") return { root: { programs: {} } };
  const parsed = parseJsonObject(text, "programs.json");
  if ("error" in parsed) return { error: parsed.error };
  const record = parsed.value;
  if (record.programs !== undefined && !isRecord(record.programs)) {
    return { error: "programs.json's `programs` must be an object." };
  }
  if (record.programs === undefined) record.programs = {};
  return { root: record as ProgramsFile };
}

export function readRunOverride(text: unknown, key: string): RunRead {
  return readParsedRunOverride(parseRoot(text), key);
}

export function createRunOverrideReader(text: unknown): (key: string) => RunRead {
  const parsed = parseRoot(text);
  return (key: string) => readParsedRunOverride(parsed, key);
}

function readParsedRunOverride(
  parsed: { root: ProgramsFile } | { error: string },
  key: string,
): RunRead {
  if ("error" in parsed) return { error: parsed.error };
  const entry = parsed.root.programs[key];
  if (entry === undefined) return { run: null, entry: null };
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return { error: `programs.json's \`${key}\` entry must be an object.` };
  }
  const record = entry as JsonRecord;
  if (!hasOwn(record, "run")) return { run: null, entry: record };
  const run = record.run;
  if (!Array.isArray(run) || run.length === 0 || run.some((part) => typeof part !== "string")) {
    return { error: `programs.json's \`${key}.run\` must be a non-empty array of strings.` };
  }
  return { run: [...run] as string[], entry: record };
}

export function writeRunOverrides(
  text: unknown,
  entries: readonly (readonly [string, readonly string[] | null])[],
): RunWrite {
  const parsed = parseRoot(text);
  if ("error" in parsed) return { error: parsed.error };
  const root = parsed.root;

  const problem = entries
    .map(([key, run]) => runEntryProblem(root.programs[key], key, run))
    .find((value): value is string => Boolean(value));
  if (problem) return { error: problem };
  let changed = false;
  for (const [key, run] of entries) changed = applyRunEntry(root.programs, key, run) || changed;
  return { text: `${JSON.stringify(root, null, 2)}\n`, changed };
}

function runEntryProblem(
  existing: unknown,
  key: string,
  run: readonly string[] | null,
): string | null {
  if (
    existing !== undefined &&
    (existing === null || typeof existing !== "object" || Array.isArray(existing))
  ) {
    return `programs.json's \`${key}\` entry must be an object; nothing was changed.`;
  }
  if (
    run !== null &&
    (!Array.isArray(run) || run.length === 0 || run.some((part) => typeof part !== "string"))
  ) {
    return "A command needs an executable and string arguments.";
  }
  return null;
}

function applyRunEntry(
  programs: Record<string, unknown>,
  key: string,
  run: readonly string[] | null,
): boolean {
  const existing = programs[key];
  if (run !== null) {
    const record =
      existing !== null && typeof existing === "object" && !Array.isArray(existing)
        ? (existing as JsonRecord)
        : {};
    programs[key] = { ...record, run: [...run] };
    return true;
  }
  if (existing === undefined) return false;
  const entry = { ...(existing as JsonRecord) };
  delete entry.run;
  if (Object.keys(entry).length === 0) delete programs[key];
  else programs[key] = entry;
  return true;
}

export function writeRunOverride(
  text: unknown,
  key: string,
  run: readonly string[] | null,
): RunWrite {
  return writeRunOverrides(text, [[key, run]]);
}

function validDisabledKeys(value: unknown): boolean {
  return (
    value === undefined || (Array.isArray(value) && value.every((key) => typeof key === "string"))
  );
}

function managerConfig(record: JsonRecord): ManagerParse {
  const permissions = normalizePermissions(record.permissions);
  if ("error" in permissions) return { error: permissions.error };
  if (record.herdrEnv !== undefined && typeof record.herdrEnv !== "boolean") {
    return { error: "agent-manager.json's `herdrEnv` must be a boolean." };
  }
  if (!validDisabledKeys(record.disabled)) {
    return { error: "agent-manager.json's `disabled` must be an array of agent keys." };
  }
  return {
    disabled: new Set((record.disabled as string[] | undefined) ?? []),
    permissions,
    herdrEnv: record.herdrEnv !== false,
  };
}

export function parseManagerConfig(text: unknown): ManagerParse {
  if (text == null || String(text).trim() === "") {
    return { disabled: new Set(), permissions: { default: "own", overrides: {} }, herdrEnv: true };
  }
  const parsed = parseJsonObject(text, "agent-manager.json");
  return "error" in parsed ? { error: parsed.error } : managerConfig(parsed.value);
}

function compareKeys(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

export function serializeManagerConfig(
  disabled: Iterable<string>,
  permissions: Permissions = { default: "own", overrides: {} },
  herdrEnv = true,
): string {
  const keys = [...disabled].filter((key) => typeof key === "string").sort();
  const root: ManagerFile = { version: 1, disabled: keys };
  if (!herdrEnv) root.herdrEnv = false;
  const overrides: Record<string, PermissionChoice> = Object.fromEntries(
    Object.entries(permissions.overrides ?? {})
      .filter(([, choice]) => typeof choice === "string")
      .sort(([left], [right]) => compareKeys(left, right)),
  );

  if (permissions.default !== "own" || Object.keys(overrides).length > 0) {
    root.permissions = { default: permissions.default ?? "own", overrides };
  }
  return `${JSON.stringify(root, null, 2)}\n`;
}

export function splitInventory<T extends { key: string; installed: boolean }>(
  agents: readonly T[] | null | undefined,
  disabled: ReadonlySet<string> = new Set(),
): { installed: Array<T & { enabled: boolean }>; available: Array<T & { enabled: boolean }> } {
  const withEnabled = (agents ?? []).map((agent) => ({
    ...agent,
    enabled: Boolean(agent.installed) && !disabled.has(agent.key),
  }));
  return {
    installed: withEnabled.filter((agent) => agent.installed),
    available: withEnabled.filter((agent) => !agent.installed),
  };
}

export function applyFreshInstalled<T extends { key: string }>(
  agents: readonly T[] | null | undefined,
  freshByKey: ReadonlyMap<string, boolean>,
): T[] {
  return (agents ?? []).map((agent) =>
    freshByKey.has(agent.key) ? { ...agent, installed: freshByKey.get(agent.key) } : agent,
  );
}

export function isFish(shellPath: unknown): boolean {
  return /(^|[/\\])fish$/.test(String(shellPath ?? ""));
}

export const LIST_ROW_HEIGHT = 56;
export const LIST_HEADER_HEIGHT = 42;
export const LIST_VISIBLE_ROWS = VISIBLE_ROWS;

export function listViewportHeight(rowCount: number, expanded = false): number | null {
  return rowCount > FULL_ROWS || expanded
    ? viewportHeight(FULL_ROWS + 1, LIST_ROW_HEIGHT) + 2
    : null;
}

export function commandPathScript(shellPath: unknown): string {
  if (isFish(shellPath)) return "command -v -- $argv[1]";
  return 'command -v -- "$1"';
}

export function parseCommandPath(stdout: unknown): string | null {
  const line = String(stdout ?? "")
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.startsWith("/"));
  return line ?? null;
}

export function commandCheckScript(shellPath: unknown): string {
  if (isFish(shellPath)) {
    return "for c in $argv; if command -v -- $c >/dev/null 2>&1; printf 'HERDRAM:1\\n'; else; printf 'HERDRAM:0\\n'; end; end";
  }
  return "for c in \"$@\"; do if command -v -- \"$c\" >/dev/null 2>&1; then printf 'HERDRAM:1\\n'; else printf 'HERDRAM:0\\n'; fi; done";
}

export function checkArgs(
  shellPath: unknown,
  script: string,
  commands: readonly string[],
  interactive = true,
): string[] {
  const args = [interactive ? "-lic" : "-lc", script];
  if (!isFish(shellPath)) args.push("herdr-agent-manager");
  for (const command of commands) args.push(command);
  return args;
}

export function parseCommandCheck(stdout: unknown, expected: number): boolean[] {
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

export function checkCommands(
  agents: readonly { run: readonly string[] }[] | null | undefined,
): string[] {
  return (agents ?? []).map((agent) => agent.run[0]);
}
