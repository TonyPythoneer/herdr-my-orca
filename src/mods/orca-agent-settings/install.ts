export const NPM_INSTALLS: Record<string, string> = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  gemini: "@google/gemini-cli",
  copilot: "@github/copilot",
  opencode: "opencode-ai",
  pi: "@mariozechner/pi-coding-agent",
  amp: "@sourcegraph/amp",
};

const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export interface InstallMethod {
  kind: "npm";
  package: string;
}

export interface UninstallCommand {
  executable: string;
  args: string[];
}

export interface Terminal {
  address?: string;
  state?: string;
  program?: { key?: string };
  argv?: readonly string[];
}

export function installMethodFor(key: string): InstallMethod | null {
  const pkg = NPM_INSTALLS[key];
  if (!pkg || !PACKAGE_NAME.test(pkg)) return null;
  return { kind: "npm", package: pkg };
}

export function uninstallCommand(
  method: { kind?: string; package?: string } | null | undefined,
): UninstallCommand | null {
  if (!method || method.kind !== "npm" || !method.package || !PACKAGE_NAME.test(method.package))
    return null;
  return { executable: "npm", args: ["uninstall", "-g", method.package] };
}

function norm(path: unknown): string {
  return String(path ?? "")
    .replaceAll("\\", "/")
    .replace(/\/+$/, "");
}

function under(path: unknown, root: unknown): boolean {
  const p = norm(path);
  const r = norm(root);
  return Boolean(p && r && (p === r || p.startsWith(`${r}/`)));
}

export function npmManaged(
  executable: unknown,
  realTarget: unknown,
  npmRoot: unknown,
  packageName: string | null | undefined,
): boolean {
  if (!PACKAGE_NAME.test(packageName ?? "")) return false;
  return under(realTarget ?? executable, `${norm(npmRoot)}/${packageName}`);
}

export function resolveLinkTarget(linkPath: unknown, target: unknown): string | null {
  const text = String(target ?? "").trim();
  if (!text) return null;
  const absolute = text.startsWith("/")
    ? text
    : `${String(linkPath ?? "").replace(/[^/]*$/, "")}${text}`;
  const parts: string[] = [];
  for (const part of absolute.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function base(word: unknown): string | undefined {
  return String(word ?? "")
    .split(/[\\/]/)
    .pop();
}

export function activeSessions(
  terminals: readonly Terminal[] | null | undefined,
  key: string,
  run: readonly string[] | null | undefined,
): Terminal[] {
  const executable = base(run?.[0] ?? key);
  return (terminals ?? []).filter((terminal) => {
    if (!terminal || terminal.state === "closed") return false;
    if (terminal.program?.key === key) return true;
    const argv = Array.isArray(terminal.argv) ? terminal.argv : [];
    return Boolean(executable && argv.length && base(argv[0]) === executable);
  });
}
