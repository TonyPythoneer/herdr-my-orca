const PERMISSION_CHOICES = [
	"own",
	"ask",
	"auto",
	"full-access"
];
const PERMISSION_LABELS = {
	own: "Each agent's own settings",
	ask: "Ask for approval",
	auto: "Approve for me",
	"full-access": "Full access",
	custom: "Custom"
};
const PERMISSION_SHORT_LABELS = {
	own: "Own",
	ask: "Ask",
	auto: "Approve",
	"full-access": "Full access",
	custom: "Custom"
};
const PERMISSION_DESCRIPTIONS = {
	own: "Every agent uses the permission flags in its own command.",
	ask: "Asks before edits or commands it isn't already allowed to make.",
	auto: "Reviews approval requests for you.",
	"full-access": "Never asks before edits or commands."
};
const RECIPES = {
	claude: {
		ask: [["--permission-mode", "default"]],
		auto: [["--permission-mode", "auto"]],
		"full-access": [["--dangerously-skip-permissions"]]
	},
	codex: {
		ask: [
			["-a", "on-request"],
			["-s", "read-only"],
			["-c", "approvals_reviewer=user"]
		],
		auto: [["--approve-for-me"]],
		"full-access": [["--dangerously-bypass-approvals-and-sandbox"]]
	},
	opencode: { auto: [["--auto"]] },
	grok: {
		ask: [["--permission-mode", "default"]],
		"full-access": [["--permission-mode", "bypassPermissions"]]
	},
	amp: { "full-access": [["--dangerously-allow-all"]] },
	antigravity: { "full-access": [["--dangerously-skip-permissions"]] },
	copilot: { "full-access": [["--yolo"]] },
	crush: { "full-access": [["--yolo"]] },
	cursor: { "full-access": [["--yolo"]] },
	gemini: { "full-access": [["--yolo"]] },
	hermes: { "full-access": [["--yolo"]] },
	kimi: { "full-access": [["--auto"]] },
	kiro: { "full-access": [["--trust-all-tools"]] },
	qoder: { "full-access": [["--dangerously-skip-permissions"]] }
};
const PERMISSION_AGENTS = Object.keys(RECIPES);
const EXTRA_CARRIERS = {
	claude: [
		"--permission-mode",
		"--allow-dangerously-skip-permissions",
		"--permission-prompt-tool"
	],
	codex: [
		"-a",
		"--ask-for-approval",
		"-s",
		"--sandbox"
	],
	grok: ["--permission-mode", "--always-approve"],
	gemini: ["--approval-mode", "-y"],
	kimi: [
		"-y",
		"--yolo",
		"--yes",
		"--auto-approve"
	]
};
const CODEX_CONFIG_ROOTS = [
	"approval_policy",
	"sandbox_mode",
	"sandbox_workspace_write"
];
function isChoice(value) {
	return PERMISSION_CHOICES.includes(value);
}
function supportsPermissions(key) {
	return Object.prototype.hasOwnProperty.call(RECIPES, key);
}
function permissionChoices(key) {
	if (!supportsPermissions(key)) return null;
	const recipes = RECIPES[key];
	return PERMISSION_CHOICES.filter((choice) => choice === "own" || Object.prototype.hasOwnProperty.call(recipes, choice));
}
function permissionArgs(key, choice) {
	if (choice === "own" && supportsPermissions(key)) return [];
	if (choice === "custom") return null;
	const groups = RECIPES[key]?.[choice];
	return groups ? groups.flat() : null;
}
function permissionGroups(key) {
	return Object.values(RECIPES[key] ?? {}).flat();
}
function stripGroups(groups, args) {
	const kept = [];
	for (let index = 0; index < args.length; index += 1) {
		const group = groups.find((candidate) => candidate.every((token, offset) => args[index + offset] === token));
		if (group) {
			index += group.length - 1;
			continue;
		}
		kept.push(args[index]);
	}
	return kept;
}
function stripPermission(key, run) {
	const argv = Array.isArray(run) ? run : [];
	if (!supportsPermissions(key) || argv.length === 0) return [...argv];
	return [argv[0], ...stripGroups(permissionGroups(key), argv.slice(1))];
}
const optionName = (token) => /^-/.test(token) ? token.split("=", 1)[0] : token;
function carrierNames(key) {
	const names = new Set(EXTRA_CARRIERS[key] ?? []);
	for (const token of permissionGroups(key).flat()) if (/^-/.test(token)) names.add(optionName(token));
	return names;
}
function isCarrier(key, args, index) {
	const token = args[index];
	if (typeof token !== "string" || !/^-/.test(token)) return false;
	const name = optionName(token);
	if (["-c", "--config"].includes(name)) {
		if (key !== "codex") return false;
		const value = token.includes("=") ? token.slice(token.indexOf("=") + 1) : args[index + 1];
		if (typeof value !== "string" || !value.includes("=")) return false;
		const root = value.slice(0, value.indexOf("=")).trim().split(".")[0];
		return CODEX_CONFIG_ROOTS.includes(root);
	}
	return carrierNames(key).has(name);
}
function withPermission(key, run, choice) {
	const argv = Array.isArray(run) ? run : [];
	const args = permissionArgs(key, choice);
	if (args === null || argv.length === 0) return null;
	return [...stripPermission(key, argv), ...args];
}
function readPermission(key, run) {
	const argv = Array.isArray(run) ? run : [];
	if (!supportsPermissions(key) || argv.length === 0) return "own";
	const rest = stripPermission(key, argv).slice(1);
	if (rest.some((_token, index) => isCarrier(key, rest, index))) return "custom";
	for (const choice of permissionChoices(key) ?? []) {
		const candidate = withPermission(key, argv, choice);
		if (candidate && candidate.length === argv.length && candidate.every((part, i) => part === argv[i])) return choice;
	}
	return "custom";
}
function effectiveChoice(permissions, key) {
	const stored = permissions?.overrides?.[key];
	if (isChoice(stored)) return stored;
	return isChoice(permissions?.default) ? permissions.default : "own";
}
function normalizePermissions(value) {
	if (value === void 0 || value === null) return {
		default: "own",
		overrides: {}
	};
	if (typeof value !== "object" || Array.isArray(value)) return { error: "agent-manager.json's `permissions` must be an object." };
	const stored = value;
	const fallback = stored.default ?? "own";
	if (!isChoice(fallback)) return { error: `agent-manager.json's \`permissions.default\` must be one of ${PERMISSION_CHOICES.join(", ")}.` };
	const overrides = normalizeOverrides(stored.overrides);
	if ("error" in overrides) return { error: overrides.error };
	return {
		default: fallback,
		overrides: overrides.overrides
	};
}
function normalizeOverrides(stored) {
	if (stored === void 0 || stored === null) return { overrides: {} };
	if (typeof stored !== "object" || Array.isArray(stored)) return { error: "agent-manager.json's `permissions.overrides` must be an object." };
	const overrides = {};
	for (const [key, choice] of Object.entries(stored)) {
		if (!isChoice(choice)) return { error: `agent-manager.json's \`permissions.overrides.${key}\` must be one of ${PERMISSION_CHOICES.join(", ")}.` };
		overrides[key] = choice;
	}
	return { overrides };
}
function reconcilePermissions(rows, permissions) {
	const base = normalizePermissions(permissions);
	if ("error" in base) return {};
	const overrides = {};
	for (const row of rows ?? []) {
		if (!row || !supportsPermissions(row.key)) continue;
		const observed = readPermission(row.key, row.run);
		if (observed === "custom" || observed === base.default) continue;
		const choices = permissionChoices(row.key) ?? [];
		if (observed === "own" && !choices.includes(base.default)) continue;
		overrides[row.key] = observed;
	}
	return overrides;
}

export { PERMISSION_AGENTS, PERMISSION_CHOICES, PERMISSION_DESCRIPTIONS, PERMISSION_LABELS, PERMISSION_SHORT_LABELS, effectiveChoice, normalizePermissions, permissionArgs, permissionChoices, readPermission, reconcilePermissions, stripPermission, supportsPermissions, withPermission };
