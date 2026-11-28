const NPM_INSTALLS = {
	claude: "@anthropic-ai/claude-code",
	codex: "@openai/codex",
	gemini: "@google/gemini-cli",
	copilot: "@github/copilot",
	opencode: "opencode-ai",
	pi: "@mariozechner/pi-coding-agent",
	amp: "@sourcegraph/amp"
};
const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
function installMethodFor(key) {
	const pkg = NPM_INSTALLS[key];
	if (!pkg || !PACKAGE_NAME.test(pkg)) return null;
	return {
		kind: "npm",
		package: pkg
	};
}
function uninstallCommand(method) {
	if (!method || method.kind !== "npm" || !method.package || !PACKAGE_NAME.test(method.package)) return null;
	return {
		executable: "npm",
		args: [
			"uninstall",
			"-g",
			method.package
		]
	};
}
function norm(path) {
	return String(path ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
}
function under(path, root) {
	const p = norm(path);
	const r = norm(root);
	return Boolean(p && r && (p === r || p.startsWith(`${r}/`)));
}
function npmManaged(executable, realTarget, npmRoot, packageName) {
	if (!PACKAGE_NAME.test(packageName ?? "")) return false;
	return under(realTarget ?? executable, `${norm(npmRoot)}/${packageName}`);
}
function resolveLinkTarget(linkPath, target) {
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
function activeSessions(terminals, key, run) {
	const executable = base(run?.[0] ?? key);
	return (terminals ?? []).filter((terminal) => {
		if (!terminal || terminal.state === "closed") return false;
		if (terminal.program?.key === key) return true;
		const argv = Array.isArray(terminal.argv) ? terminal.argv : [];
		return Boolean(executable && argv.length && base(argv[0]) === executable);
	});
}

export { NPM_INSTALLS, activeSessions, installMethodFor, npmManaged, resolveLinkTarget, uninstallCommand };
