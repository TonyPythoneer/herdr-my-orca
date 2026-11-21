// Verified install/uninstall metadata for the official agent catalog.
//
// This is deliberately not another agent registry: the supported agents still come from
// knownAgents(). Only the agents whose upstream project publishes an npm package we could verify
// get an automatic npm path. Every other supported agent falls back to its official install guide.
//
// Commands are argv arrays built from the allowlisted package names below. Nothing here is ever
// run through a shell, and a package string cannot carry shell syntax.

export const NPM_INSTALLS = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  gemini: "@google/gemini-cli",
  copilot: "@github/copilot",
  opencode: "opencode-ai",
  pi: "@mariozechner/pi-coding-agent",
  amp: "@sourcegraph/amp",
};

const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/** The npm method for an official agent, or null when only its install guide is verified. */
export function installMethodFor(key) {
  const pkg = NPM_INSTALLS[key];
  if (!pkg || !PACKAGE_NAME.test(pkg)) return null;
  return { kind: "npm", package: pkg };
}

/** An argv to run, never a shell string. */
export function installCommand(method) {
  if (!method || method.kind !== "npm" || !PACKAGE_NAME.test(method.package)) return null;
  return { executable: "npm", args: ["install", "-g", `${method.package}@latest`] };
}

export function uninstallCommand(method) {
  if (!method || method.kind !== "npm" || !PACKAGE_NAME.test(method.package)) return null;
  return { executable: "npm", args: ["uninstall", "-g", method.package] };
}

function norm(path) {
  return String(path ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
}

function under(path, root) {
  const p = norm(path);
  const r = norm(root);
  return Boolean(p && r && (p === r || p.startsWith(`${r}/`)));
}

/** True when an executable's real file lives under npm's global module root. */
export function npmManaged(executable, realTarget, npmRoot) {
  return under(realTarget ?? executable, npmRoot);
}

/** Resolve a readlink target against the directory holding the link. Handles `.` and `..`. */
export function resolveLinkTarget(linkPath, target) {
  const text = String(target ?? "").trim();
  if (!text) return null;
  const absolute = text.startsWith("/") ? text : `${String(linkPath ?? "").replace(/[^/]*$/, "")}${text}`;
  const parts = [];
  for (const part of absolute.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function base(word) {
  return String(word ?? "").split(/[\\/]/).pop();
}

/**
 * Live terminals that already run this agent. The program table's key is the reliable signal;
 * the argv check is a fallback for a custom command whose key the program table may not know.
 * Sub-agents and manager pages are not terminals with this program.
 */
export function activeSessions(terminals, key, run) {
  const executable = base(run?.[0] ?? key);
  return (terminals ?? []).filter((terminal) => {
    if (!terminal || terminal.state === "closed") return false;
    if (terminal.program?.key === key) return true;
    const argv = Array.isArray(terminal.argv) ? terminal.argv : [];
    return Boolean(executable && argv.length && base(argv[0]) === executable);
  });
}
