const DEFAULT_AGENTS = {
	scout: {
		description: "Research repository and documentation",
		model: "haiku",
		tools: [
			"Read",
			"Grep",
			"Glob"
		],
		prompt: "Investigate the codebase. Return concise findings. Do not modify files."
	},
	checker: {
		description: "Review significant code changes",
		model: "opus",
		tools: [
			"Read",
			"Grep",
			"Glob"
		],
		prompt: "Review changes for correctness, bugs, and risks. Do not modify files."
	}
};
const DEFAULT_AGENTS_TEXT = JSON.stringify(DEFAULT_AGENTS, null, 2);
const DEFAULT_PROMPT = [
	"You are the primary implementation agent.",
	"",
	"Delegate research to scout.",
	"Write and test code yourself.",
	"Ask checker to review significant changes.",
	"",
	"Consult the advisor:",
	"1. Before finalizing complex plans.",
	"2. When the same error occurs twice.",
	"3. Before declaring complex work complete.",
	"",
	"Before finishing, verify the change by running checks on the edge cases that matter for it. Then reply with only: your answer, the one or two checks that best prove it, anything that failed or remains risky, and decisions only a human can make. Leave out the rest of your process."
].join("\n");
const CODEX_ITEMS = [
	"plugins",
	"apps",
	"remote_plugin",
	"plugin_sharing",
	"browser_use",
	"browser_use_external",
	"computer_use",
	"image_generation",
	"in_app_browser",
	"skill_search",
	"skill_mcp_dependency_install"
].map((id) => ({
	id,
	argv: ["--disable", "{id}"]
}));
const PI_ITEMS = [
	{
		id: "extensions",
		argv: ["--no-extensions"]
	},
	{
		id: "mcp",
		argv: ["--no-mcp"]
	},
	{
		id: "skills",
		argv: ["--no-skills"]
	},
	{
		id: "prompt_templates",
		argv: ["--no-prompt-templates"]
	},
	{
		id: "themes",
		argv: ["--no-themes"]
	},
	{
		id: "context_files",
		argv: ["--no-context-files"]
	},
	{
		id: "session",
		argv: ["--no-session"]
	},
	{
		id: "offline",
		argv: ["--offline"]
	}
];
const PI_THINKING = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
const SPECS = {
	claude: {
		label: "Claude",
		command: "claude",
		models: {
			shell: `printf '%s\\n' '{"type":"control_request","request_id":"orca-agent-flyout","request":{"subtype":"initialize"}}' | claude -p --input-format stream-json --output-format stream-json --verbose`,
			parser: "claudeInitialize"
		},
		options: {
			provider: {
				type: "provider",
				label: "MODEL SOURCE"
			},
			model: {
				type: "model",
				label: "MODEL",
				argv: ["--model", "{v}"]
			},
			effort: {
				type: "effort",
				label: "EFFORT",
				argv: ["--effort", "{v}"],
				omit: [""]
			},
			fast: {
				type: "toggle",
				label: "FAST",
				argv: ["--fast-mode"],
				default: false
			},
			advisorModel: {
				type: "select",
				label: "ADVISOR",
				choices: [
					"none",
					"opus",
					"haiku",
					"fable",
					"sonnet"
				],
				default: "opus",
				argv: ["--advisor", "{v}"],
				omit: ["none"]
			},
			outputStyle: {
				type: "select",
				label: "OUTPUT STYLE",
				source: "claudeOutputStyles",
				default: "default",
				argv: ["--settings", { json: { outputStyle: "{v}" } }],
				omit: ["default"]
			},
			agents: {
				type: "editor",
				label: "Agents",
				language: "json",
				default: DEFAULT_AGENTS_TEXT,
				argv: ["--agents", "{v}"]
			},
			systemPrompt: {
				type: "editor",
				label: "Append system prompt",
				default: DEFAULT_PROMPT,
				argv: ["--append-system-prompt", "{v}"]
			}
		},
		launch: [
			"model",
			"effort",
			"fast",
			"advisorModel",
			"outputStyle",
			"agents",
			"systemPrompt"
		],
		ui: {
			sections: [{
				title: "HARNESS CLI ARGUMENTS",
				options: [
					"provider",
					"model",
					"effort",
					"fast"
				],
				gap: 4
			}, {
				title: "HARNESS CLI ADVANCED ARGUMENTS",
				options: [
					"advisorModel",
					"outputStyle",
					"agents",
					"systemPrompt"
				]
			}],
			rows: [
				["provider", "model"],
				["effort", "fast"],
				["advisorModel", "outputStyle"]
			],
			reset: true
		}
	},
	codex: {
		label: "Codex",
		command: "codex",
		models: {
			shell: "codex debug models",
			parser: "codexCatalog"
		},
		options: {
			provider: {
				type: "provider",
				label: "MODEL SOURCE"
			},
			model: {
				type: "model",
				label: "MODEL",
				argv: ["-m", "{v}"]
			},
			effort: {
				type: "effort",
				label: "EFFORT",
				argv: ["-c", "model_reasoning_effort={v}"],
				omit: ["", null]
			},
			fast: {
				type: "toggle",
				label: "FAST",
				argv: ["-c", "service_tier=\"priority\""],
				default: false
			},
			codexOff: {
				type: "checklist",
				label: "DISABLE",
				bulk: true,
				items: [...CODEX_ITEMS, {
					id: "mcp",
					expand: "codexMcp"
				}]
			}
		},
		launch: [
			"model",
			"effort",
			"fast",
			"codexOff"
		],
		ui: {
			sections: [{
				title: "HARNESS CLI ARGUMENTS",
				options: [
					"provider",
					"model",
					"effort",
					"fast"
				],
				gap: 4
			}, {
				title: "HARNESS CLI ADVANCED ARGUMENTS",
				options: ["codexOff"]
			}],
			rows: [["effort", "fast"]]
		}
	},
	opencode: {
		label: "OpenCode",
		command: "opencode",
		models: {
			shell: "opencode api GET /api/model",
			parser: "opencodeCatalog"
		},
		options: {
			provider: {
				type: "provider",
				label: "MODEL SOURCE"
			},
			model: {
				type: "model",
				label: "MODEL",
				groups: [
					{
						id: "all",
						label: "All"
					},
					{
						id: "free",
						label: "Free"
					},
					{
						id: "paid",
						label: "Paid"
					},
					{
						id: "omlx",
						label: "OMLX"
					}
				],
				group: "free"
			},
			effort: {
				type: "effort",
				label: "EFFORT"
			}
		},
		launch: ["model", "effort"],
		wrap: {
			env: { OPENCODE_CONFIG_CONTENT: { json: { model: "{model}" } } },
			suffix: ["--standalone"],
			after: "opencodeVariant"
		},
		ui: { sections: [{
			title: "HARNESS CLI ARGUMENTS",
			options: [
				"provider",
				"model",
				"effort"
			],
			gap: 4
		}] }
	},
	pi: {
		label: "Pi",
		command: "pi",
		models: {
			shell: "pi --list-models",
			parser: "piTable",
			default: "Default"
		},
		options: {
			provider: {
				type: "provider",
				label: "MODEL SOURCE"
			},
			model: {
				type: "model",
				label: "MODEL",
				argv: ["--model", "{v}"]
			},
			effort: {
				type: "effort",
				label: "THINKING",
				argv: ["--thinking", "{v}"],
				omit: [""]
			},
			off: {
				type: "checklist",
				label: "TURN OFF",
				bulk: true,
				items: PI_ITEMS
			},
			systemPrompt: {
				type: "editor",
				label: "Append system prompt",
				default: "",
				argv: ["--append-system-prompt", "{v}"]
			}
		},
		launch: [
			"model",
			"effort",
			"off",
			"systemPrompt"
		],
		ui: { sections: [{
			title: "HARNESS CLI ARGUMENTS",
			options: [
				"provider",
				"model",
				"effort"
			],
			gap: 4
		}, {
			title: "HARNESS CLI ADVANCED ARGUMENTS",
			options: ["off", "systemPrompt"]
		}] }
	}
};
const hasFlyout = (key) => Object.hasOwn(SPECS, key);
function sectionsOf(spec) {
	if (spec.ui?.sections) return spec.ui.sections;
	const ids = Object.keys(spec.options);
	const head = ids.filter((id) => spec.options[id].type === "model" || spec.options[id].type === "effort");
	const rest = ids.filter((id) => !head.includes(id));
	return [{
		title: "HARNESS CLI ARGUMENTS",
		options: head,
		gap: 4
	}, ...rest.length ? [{
		title: "HARNESS CLI ADVANCED ARGUMENTS",
		options: rest
	}] : []];
}
function fill(template, vars) {
	if (typeof template === "string") return template.replace(/\{(\w+)\}/g, (_m, name) => String(vars[name] ?? ""));
	if (Array.isArray(template)) return template.map((part) => fill(part, vars));
	if (template && typeof template === "object") {
		if ("json" in template) return JSON.stringify(fill(template.json, vars));
		return Object.fromEntries(Object.entries(template).map(([key, part]) => [key, fill(part, vars)]));
	}
	return template;
}
const blank = (value) => value === void 0 || value === null || typeof value === "string" && value.trim() === "";
function filledArgs(template, vars) {
	const filled = fill(template ?? [], vars);
	if (!Array.isArray(filled) || filled.some((item) => typeof item !== "string")) throw new TypeError("argument templates must produce strings");
	return filled.filter((item) => typeof item === "string");
}
function optionArgs(option, value, expansions = {}) {
	if (option.type === "checklist") {
		const on = new Set(Array.isArray(value) ? value : []);
		return (option.items ?? []).flatMap((item) => {
			if (!on.has(item.id)) return [];
			if (item.expand) return expansions[item.expand] ?? [];
			return filledArgs(item.argv, { id: item.id });
		});
	}
	if (option.type === "toggle") return value ? filledArgs(option.argv, { v: value }) : [];
	if (!option.argv || blank(value) || (option.omit ?? []).includes(value)) return [];
	return filledArgs(option.argv, { v: value });
}
function buildArgv(spec, base, values, { expansions = {}, skip = [] } = {}) {
	const args = spec.launch.filter((id) => !skip.includes(id)).flatMap((id) => optionArgs(spec.options[id], values[id], expansions));
	if (!spec.wrap) return [...base, ...args];
	return [
		"env",
		...Object.entries(spec.wrap.env ?? {}).map(([name, template]) => `${name}=${fill(template, { model: values.model })}`),
		...base,
		...args,
		...spec.wrap.suffix ?? []
	];
}
const TOP = ["model", "effort"];
function defaultValues(spec) {
	const values = {};
	for (const [id, option] of Object.entries(spec.options)) if (option.type === "checklist") values[id] = [];
	else if (option.type === "toggle") values[id] = option.default ?? false;
	else if (option.type === "editor" || option.type === "select") values[id] = option.default ?? "";
	return values;
}
function readValues(spec, saved = {}) {
	const values = defaultValues(spec);
	const preset = isRecord(saved.preset) ? saved.preset : {};
	for (const [id, option] of Object.entries(spec.options)) if (TOP.includes(id)) {
		if (typeof saved[id] === "string") values[id] = saved[id];
	} else if (option.type === "checklist") values[id] = readChecklist(option, preset[id]);
	else if (option.type === "toggle") values[id] = preset[id] === true;
	else if (option.type === "select") values[id] = readSelect(id, option, preset, values[id]);
	else if (option.type === "editor") values[id] = readText(preset[id], values[id]);
	return values;
}
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const readText = (stored, fallback) => typeof stored === "string" ? stored : fallback;
function readChecklist(option, stored) {
	const known = new Set((option.items ?? []).map((item) => item.id));
	return Array.isArray(stored) ? stored.filter((item) => typeof item === "string" && known.has(item)) : [];
}
function readSelect(id, option, preset, fallback) {
	if (id === "advisorModel" && preset.advisor === false) return "none";
	const stored = preset[id];
	return typeof stored === "string" && option.choices?.includes(stored) || option.source && typeof stored === "string" ? stored : fallback;
}
function presetOf(spec, values) {
	return Object.fromEntries(Object.entries(spec.options).filter(([id, option]) => !TOP.includes(id) && [
		"select",
		"checklist",
		"editor",
		"toggle"
	].includes(option.type)).filter(([id]) => values[id] !== void 0).map(([id, option]) => {
		const value = values[id];
		return [id, option.type === "checklist" && Array.isArray(value) ? [...value] : value];
	}));
}
function readGroup(option, saved = {}) {
	const groups = option.groups ?? [];
	if (typeof saved.group === "string" && groups.some((group) => group.id === saved.group)) return saved.group;
	return saved.onlyFree === false ? "all" : option.group;
}
function catalogGroup(model, free) {
	if (model.providerID === "omlx") return "omlx";
	return free ? "free" : "paid";
}
const DEFAULT_FALLBACK_EFFORT = "high";
const jsonObject = (stdout) => {
	let parsed;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		parsed = JSON.parse(stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1));
	}
	if (!isRecord(parsed)) throw new TypeError("model catalog must be a JSON object");
	return parsed;
};
const PARSERS = {
	claudeInitialize(stdout) {
		for (const line of stdout.split("\n")) {
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				continue;
			}
			if (!isRecord(message) || message.type !== "control_response") continue;
			const outer = isRecord(message.response) ? message.response : {};
			const response = isRecord(outer.response) ? outer.response : {};
			return (Array.isArray(response.models) ? response.models.filter(isRecord) : []).map((model) => ({
				id: String(model.value ?? ""),
				label: String(model.displayName ?? ""),
				efforts: Array.isArray(model.supportedEffortLevels) ? model.supportedEffortLevels.filter((effort) => typeof effort === "string") : [],
				fallbackEffort: DEFAULT_FALLBACK_EFFORT,
				fast: Boolean(model.supportsFastMode)
			}));
		}
		throw new Error("claude did not list its models");
	},
	codexCatalog(stdout) {
		const models = jsonObject(stdout).models;
		return (Array.isArray(models) ? models.filter(isRecord) : []).filter((model) => model.visibility === "list").map((model) => ({
			id: String(model.slug ?? ""),
			label: String(model.display_name ?? ""),
			efforts: Array.isArray(model.supported_reasoning_levels) ? model.supported_reasoning_levels.filter(isRecord).map((level) => String(level.effort ?? "")) : [],
			fallbackEffort: typeof model.default_reasoning_level === "string" ? model.default_reasoning_level : void 0,
			fast: Array.isArray(model.service_tiers) && model.service_tiers.filter(isRecord).some((tier) => tier.id === "priority")
		}));
	},
	opencodeCatalog(stdout) {
		const models = jsonObject(stdout).data;
		return (Array.isArray(models) ? models.filter(isRecord) : []).filter((model) => model.providerID === "opencode" || model.providerID === "omlx").map((model) => {
			const cost = Array.isArray(model.cost) ? model.cost.filter(isRecord) : [];
			const free = cost.length > 0 && cost.every((item) => (item.input ?? 0) === 0 && (item.output ?? 0) === 0);
			return {
				id: `${String(model.providerID)}/${String(model.modelID ?? model.id ?? "")}`,
				label: String(model.name ?? model.modelID ?? model.id ?? ""),
				group: catalogGroup(model, free),
				efforts: Array.isArray(model.variants) && model.variants.length ? ["", ...model.variants.filter(isRecord).map((variant) => String(variant.id ?? ""))] : [],
				fallbackEffort: DEFAULT_FALLBACK_EFFORT,
				free
			};
		});
	},
	piTable(stdout) {
		const lines = stdout.split("\n").filter((line) => line.trim() !== "");
		const header = lines.findIndex((line) => /^provider\s+model\s/.test(line));
		if (header === -1) return [];
		const at = (word) => lines[header].indexOf(word);
		const [provider, model, context, thinking] = [
			"provider",
			"model",
			"context",
			"thinking"
		].map(at);
		const next = lines[header].indexOf("images");
		return lines.slice(header + 1).flatMap((line) => {
			const p = line.slice(provider, model).trim();
			const m = line.slice(model, context).trim();
			if (!p || !m) return [];
			const thinks = line.slice(thinking, next === -1 ? void 0 : next).trim() === "yes";
			return [{
				id: `${p}/${m}`,
				label: m,
				group: p,
				efforts: thinks ? ["", ...PI_THINKING] : [],
				fallbackEffort: ""
			}];
		});
	}
};
function parseModels(parser, stdout) {
	const parse = PARSERS[parser];
	if (!parse) throw new Error(`no model parser named ${parser}`);
	return parse(String(stdout ?? ""));
}

export { DEFAULT_AGENTS, DEFAULT_AGENTS_TEXT, DEFAULT_PROMPT, PARSERS, PI_THINKING, SPECS, buildArgv, defaultValues, hasFlyout, optionArgs, parseModels, presetOf, readGroup, readValues, sectionsOf };
