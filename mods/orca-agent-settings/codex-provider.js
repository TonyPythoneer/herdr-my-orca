const OMLX = "omlx";
const PI_COMPACTION_RESERVE = 16384;
const UNKNOWN_OUTPUT_CAP = 8192;
const PROVIDER_FILE = "model-providers.json";
const TEST_ERRORS = {
	connect: "Cannot connect",
	key: "Key rejected",
	models: "No /models at this host",
	notModelServer: "Not a model server",
	empty: "No models"
};
const KEY_FROM_PROVIDER = `key="$(python3 -c 'import json,sys; r=json.load(open(sys.argv[1]))[sys.argv[2]]; sys.exit(1) if r.get("host") != sys.argv[3] else None; print(r.get("apiKey", ""))' "$1" "$2" "$3")" || exit 1; [ -n "$key" ] || exit 1;`;
const WRAPPER = `${KEY_FROM_PROVIDER} export OMLX_API_KEY="$key"; unset key; shift 3; exec "$@"`;
const PROVIDER_KEY_WRAPPER = `${KEY_FROM_PROVIDER} export HERDR_PROVIDER_API_KEY="$key"; unset key; shift 3; exec "$@"`;
const CLAUDE_PROVIDER_WRAPPER = `${KEY_FROM_PROVIDER} export ANTHROPIC_AUTH_TOKEN="$key"; unset key; shift 3; exec "$@"`;
const KEY_FROM_ENV = `key="$(python3 -c 'import re,sys; t=open(sys.argv[1]).read(); k=re.findall(r"^\\s*LITELLM_MASTER_KEY=(.*)$", t, re.M); p=re.findall(r"^\\s*LITELLM_PORT=(.*)$", t, re.M); base="http://127.0.0.1:"+((p[-1].strip() if p else "") or "4000"); sys.exit(1) if not k or sys.argv[2].rstrip("/") not in (base, base+"/v1") else print(k[-1].strip())' "$1" "$3")" || exit 1; [ -n "$key" ] || exit 1;`;
function wrapperFor(provider, name) {
	return `${String(provider?.configPath ?? "").endsWith(".env") ? KEY_FROM_ENV : KEY_FROM_PROVIDER} export ${name}="$key"; unset key; shift 3; exec "$@"`;
}
const HOST_ERROR = "Enter a host like http://127.0.0.1:8000/v1";
function validateHost(text) {
	const host = String(text ?? "").trim().replace(/\/+$/, "");
	if (!/^https?:\/\/[^\s"'`\\]+$/i.test(host)) return { error: HOST_ERROR };
	try {
		new URL(host);
	} catch {
		return { error: HOST_ERROR };
	}
	return { host };
}
function supportsCodingModel(info) {
	if (!info || typeof info !== "object") return true;
	if (Array.isArray(info.inputModalities) && !info.inputModalities.includes("text")) return false;
	if (Array.isArray(info.outputModalities) && !info.outputModalities.includes("text")) return false;
	if (Array.isArray(info.supportedFeatures) && !info.supportedFeatures.some((feature) => feature === "tools" || feature === "tool_use")) return false;
	return true;
}
function piModelLimits(info) {
	const contextWindow = info?.contextWindow;
	if (typeof contextWindow !== "number" || !Number.isSafeInteger(contextWindow) || contextWindow <= PI_COMPACTION_RESERVE) return null;
	const reportedMaxTokens = info?.maxTokens;
	const maxTokens = typeof reportedMaxTokens === "number" && Number.isSafeInteger(reportedMaxTokens) && reportedMaxTokens > 0 ? reportedMaxTokens : Math.min(UNKNOWN_OUTPUT_CAP, contextWindow);
	return maxTokens <= contextWindow ? {
		contextWindow,
		maxTokens
	} : null;
}
function launchPiArgv(baseArgv, provider, model, extensionPath) {
	const argv = [...baseArgv ?? []];
	if (!provider) return argv;
	const [command, ...rest] = argv;
	const models = [...new Set([...provider.models ?? [], model].filter((id) => typeof id === "string" && id && supportsCodingModel(provider.modelInfo?.[id])))];
	const modelInfo = Object.fromEntries(models.flatMap((id) => {
		const info = provider.modelInfo && Object.hasOwn(provider.modelInfo, id) ? provider.modelInfo[id] : null;
		const limits = piModelLimits(info);
		if (!limits) return [];
		return [[id, {
			...info,
			...limits
		}]];
	}));
	return [
		"/bin/sh",
		"-c",
		wrapperFor(provider, "HERDR_PROVIDER_API_KEY"),
		"--",
		provider.configPath,
		provider.id,
		provider.host,
		"env",
		`HERDR_PI_BASE_URL=${provider.host}`,
		`HERDR_PI_MODELS=${JSON.stringify(models)}`,
		`HERDR_PI_MODEL_INFO=${JSON.stringify(modelInfo)}`,
		command,
		...rest,
		"--provider",
		"herdr",
		"--model",
		model,
		"--extension",
		extensionPath
	];
}
function launchClaudeArgv(baseArgv, provider, model) {
	const argv = [...baseArgv ?? []];
	if (!provider) return argv;
	const [command, ...rest] = argv;
	return [
		"/bin/sh",
		"-c",
		wrapperFor(provider, "ANTHROPIC_AUTH_TOKEN"),
		"--",
		provider.configPath,
		provider.id,
		provider.host,
		"env",
		`ANTHROPIC_BASE_URL=${provider.host}`,
		command,
		...rest,
		"--model",
		model
	];
}
function providerModelIds(provider, model) {
	return [...new Set([...provider.models ?? [], model].filter((id) => typeof id === "string" && id && supportsCodingModel(provider.modelInfo?.[id])))];
}
function openCodeModelLimits(info) {
	const context = info?.contextWindow;
	if (typeof context !== "number" || !Number.isSafeInteger(context) || context <= 0) return void 0;
	const reported = info?.maxTokens;
	return {
		context,
		output: Math.min(typeof reported === "number" && Number.isSafeInteger(reported) && reported > 0 ? reported : UNKNOWN_OUTPUT_CAP, context)
	};
}
function openCodeModelEntry(provider, id, index) {
	const limit = openCodeModelLimits(provider.modelInfo && Object.hasOwn(provider.modelInfo, id) ? provider.modelInfo[id] : {});
	return [`model-${index + 1}`, {
		name: id,
		modelID: id,
		capabilities: {
			tools: true,
			input: ["text"],
			output: ["text"]
		},
		...limit ? { limit } : {}
	}];
}
function launchOpenCodeArgv(baseArgv, provider, model) {
	const argv = [...baseArgv ?? []];
	if (!provider) return argv;
	const modelIds = providerModelIds(provider, model);
	const selected = modelIds.indexOf(model);
	const entries = Object.fromEntries(modelIds.map((id, index) => openCodeModelEntry(provider, id, index)));
	const config = {
		$schema: "https://opencode.ai/config.json",
		model: `herdr/model-${selected + 1}`,
		providers: { herdr: {
			name: provider.name,
			env: ["HERDR_PROVIDER_API_KEY"],
			package: "@opencode/ai/providers/openai-compatible",
			settings: { baseURL: provider.host },
			models: entries
		} }
	};
	return [
		"/bin/sh",
		"-c",
		wrapperFor(provider, "HERDR_PROVIDER_API_KEY"),
		"--",
		provider.configPath,
		provider.id,
		provider.host,
		"env",
		`OPENCODE_CONFIG_CONTENT=${JSON.stringify(config)}`,
		...argv.slice(2)
	];
}
const GITHUB_OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const GITHUB_REPO = /^[A-Za-z0-9._-]{1,100}$/;
const LINK_ERROR = "Enter a link like https://github.com/owner/repo or https://example.com";
const AVATAR_SIZE = 64;
function parseLinkUrl(value) {
	try {
		return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
	} catch {
		return null;
	}
}
function githubInfo(url) {
	const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
	if (!owner || !GITHUB_OWNER.test(owner)) return { error: LINK_ERROR };
	const repo = rawRepo?.replace(/\.git$/, "");
	const named = repo && GITHUB_REPO.test(repo) ? repo : "";
	return {
		link: `https://github.com/${owner}${named ? `/${named}` : ""}`,
		name: named || owner,
		iconUrl: `https://github.com/${owner}.png?size=${AVATAR_SIZE}`
	};
}
function linkInfo(text) {
	const value = String(text ?? "").trim();
	if (value === "") return {
		link: "",
		name: "",
		iconUrl: ""
	};
	const url = parseLinkUrl(value);
	if (!url) return { error: LINK_ERROR };
	const host = url.hostname.toLowerCase().replace(/^www\./, "");
	if (url.protocol !== "https:" || url.username || url.password || !host.includes(".")) return { error: LINK_ERROR };
	if (host === "github.com") return githubInfo(url);
	return {
		link: `https://${url.host}`,
		name: host.split(".").at(-2),
		iconUrl: `https://${url.host}/favicon.ico`
	};
}
function iconFromHtml(html, baseUrl) {
	const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
	const resolve = (href) => {
		try {
			if (!href.trim()) return null;
			const url = new URL(href, base);
			return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
		} catch {
			return null;
		}
	};
	const hrefOf = (tag) => {
		const m = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
		return m ? resolve(m[1] ?? m[2] ?? m[3]) : null;
	};
	const links = [...html.matchAll(/<link\b[^>]*?\brel\s*=\s*(?:"[^"]*icon[^"]*"|'[^']*icon[^']*'|[^\s>]*icon[^\s>]*)[^>]*?>/gi)];
	for (const [tag] of links) if (/\btype\s*=\s*["']?image\/svg\+xml(?:["'\s>])/i.test(tag)) {
		const resolved = hrefOf(tag);
		if (resolved) return resolved;
	}
	for (const [tag] of links) {
		const resolved = hrefOf(tag);
		if (resolved) return resolved;
	}
	return null;
}
function recordLink(record) {
	return record?.link ?? (record?.githubOwner ? `https://github.com/${record.githubOwner}` : "");
}
const PORT_PRESETS = {
	8e3: {
		name: "oMLX",
		link: "https://github.com/jundot/omlx"
	},
	11434: {
		name: "Ollama",
		link: "https://github.com/ollama/ollama"
	}
};
function presetFor(host) {
	let url;
	try {
		url = new URL(host);
	} catch {
		return null;
	}
	if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return null;
	const preset = PORT_PRESETS[url.port];
	return preset ? { ...preset } : null;
}
function slugId(name, taken) {
	const base = String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "provider";
	let id = base;
	for (let n = 2; taken.includes(id) || id in {} || id === "none"; n += 1) id = `${base}-${n}`;
	return id;
}
const KEY_HINT_DOTS = "•".repeat(12);
const KEY_HINT_MIN_LENGTH = 8;
function keyHint(key) {
	const text = String(key ?? "");
	return text.length >= KEY_HINT_MIN_LENGTH ? `${KEY_HINT_DOTS}${text.slice(-4)}` : KEY_HINT_DOTS;
}
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const positiveInteger = (...values) => values.find((value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0);
const stringList = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : void 0;
function modelCapabilities(entry) {
	const architecture = isRecord(entry.architecture) ? entry.architecture : {};
	const inputModalities = stringList(entry.input_modalities ?? architecture.input_modalities);
	const outputModalities = stringList(entry.output_modalities ?? architecture.output_modalities);
	const info = {};
	if (inputModalities) info.inputModalities = inputModalities;
	if (outputModalities) info.outputModalities = outputModalities;
	let features;
	if (Array.isArray(entry.supported_features)) features = entry.supported_features.filter((value) => typeof value === "string");
	else if (Array.isArray(entry.supported_parameters)) features = entry.supported_parameters.includes("tools") ? ["tools"] : [];
	if (features) info.supportedFeatures = features;
	return info;
}
function modelMetadata(entry) {
	const topProvider = isRecord(entry.top_provider) ? entry.top_provider : {};
	const contextWindow = positiveInteger(entry.context_window, entry.contextWindow, entry.max_model_len, entry.context_length, topProvider.context_length);
	const maxTokens = positiveInteger(entry.max_completion_tokens, entry.max_tokens, entry.maxTokens, entry.max_output_length, topProvider.max_completion_tokens);
	const info = {};
	if (contextWindow) info.contextWindow = contextWindow;
	if (maxTokens) info.maxTokens = maxTokens;
	Object.assign(info, modelCapabilities(entry));
	return Object.keys(info).length ? info : null;
}
function modelInfoFor(entries, models) {
	const modelInfo = Object.create(null);
	for (const entry of entries) {
		if (typeof entry === "string" || !isRecord(entry) || typeof entry.id !== "string" || !models.includes(entry.id)) continue;
		const info = modelMetadata(entry);
		if (info) modelInfo[entry.id] = info;
	}
	return modelInfo;
}
function modelsFromAnswer(answer) {
	if (!isRecord(answer)) return null;
	if (!Array.isArray(answer?.data)) return null;
	const entries = answer.data.filter((entry) => typeof entry === "string" || isRecord(entry));
	return {
		entries,
		models: [...new Set(entries.map((entry) => typeof entry === "string" ? entry : entry.id).filter((id) => typeof id === "string" && id !== ""))]
	};
}
function modelResponseError(code) {
	if (code === 401 || code === 403) return TEST_ERRORS.key;
	if (code === 404) return TEST_ERRORS.models;
	return TEST_ERRORS.connect;
}
function judgeModels(status, body) {
	const code = Number(status);
	if (code !== 200) return {
		ok: false,
		error: modelResponseError(code)
	};
	let answer;
	try {
		answer = JSON.parse(String(body ?? ""));
	} catch {
		return {
			ok: false,
			error: TEST_ERRORS.notModelServer
		};
	}
	const result = modelsFromAnswer(answer);
	if (!result) return {
		ok: false,
		error: TEST_ERRORS.notModelServer
	};
	const { entries, models } = result;
	if (models.length === 0) return {
		ok: false,
		error: TEST_ERRORS.empty
	};
	const modelInfo = modelInfoFor(entries, models);
	return {
		ok: true,
		models,
		...Object.keys(modelInfo).length ? { modelInfo } : {}
	};
}
function launchArgv(baseArgv, provider, model) {
	const argv = [...baseArgv ?? []];
	if (!provider) return argv;
	const [command, ...rest] = argv;
	const contextWindow = provider.modelInfo?.[model]?.contextWindow;
	const contextOverride = typeof contextWindow === "number" && Number.isSafeInteger(contextWindow) && contextWindow > 0 ? ["-c", `model_context_window=${contextWindow}`] : [];
	return [
		"/bin/sh",
		"-c",
		wrapperFor(provider, "OMLX_API_KEY"),
		"--",
		provider.configPath,
		provider.id ?? "omlx",
		provider.host,
		command,
		"--disable",
		"shell_snapshot",
		...rest,
		"-m",
		model,
		"-c",
		"model_provider=\"omlx\"",
		...contextOverride,
		"-c",
		"model_providers.omlx.name=\"oMLX\"",
		"-c",
		`model_providers.omlx.base_url="${provider.host}"`,
		"-c",
		"model_providers.omlx.env_key=\"OMLX_API_KEY\""
	];
}
function parseProviderFile(text) {
	if (text == null || String(text).trim() === "") return { providers: {} };
	let root;
	try {
		root = JSON.parse(String(text));
	} catch {
		return { error: "model-providers.json is not valid JSON." };
	}
	if (!isRecord(root)) return { error: "model-providers.json must contain a JSON object." };
	return { providers: root };
}
function serializeProviderFile(providers) {
	return `${JSON.stringify(providers ?? {}, null, 2)}\n`;
}
async function replaceProviderFile(exec, paths, expected) {
	const { lock, file, staged, expectedFile } = paths;
	if ((await exec("python3", [
		"-c",
		[
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
			"    os.replace(staged, target)"
		].join("\n"),
		lock,
		file,
		staged,
		expected == null ? "" : expectedFile,
		expected == null ? "1" : "0"
	]))?.code !== 0) throw new Error("Provider file changed or could not be installed.");
}
async function requireProviderMode(exec, mode, path, message) {
	if ((await exec("chmod", [mode, path]))?.code !== 0) throw new Error(message);
}
async function writeProviderFile({ appHome, exec, writeTextFile }, text, expected) {
	const home = typeof appHome === "function" ? appHome() : appHome;
	const file = `${home}/${PROVIDER_FILE}`;
	const lock = `${file}.lock`;
	const made = await exec("mktemp", ["-d", `${home}/.provider-write.XXXXXX`]);
	const dir = String(made?.stdout ?? "").trim();
	if (made?.code !== 0 || !dir.startsWith(`${home}/.provider-write.`)) throw new Error("Could not create private provider staging directory.");
	const staged = `${dir}/${PROVIDER_FILE}`;
	const expectedFile = `${dir}/expected`;
	try {
		await requireProviderMode(exec, "700", dir, "Could not secure provider staging directory.");
		await writeTextFile(staged, text, null);
		await requireProviderMode(exec, "600", staged, "Could not secure staged provider file.");
		if (expected != null) {
			await writeTextFile(expectedFile, expected, null);
			await requireProviderMode(exec, "600", expectedFile, "Could not secure provider snapshot.");
		}
		await replaceProviderFile(exec, {
			lock,
			file,
			staged,
			expectedFile
		}, expected);
	} finally {
		await exec("rm", ["-rf", dir]).catch(() => {});
	}
}

export { CLAUDE_PROVIDER_WRAPPER, OMLX, PROVIDER_FILE, PROVIDER_KEY_WRAPPER, TEST_ERRORS, WRAPPER, iconFromHtml, judgeModels, keyHint, launchArgv, launchClaudeArgv, launchOpenCodeArgv, launchPiArgv, linkInfo, parseProviderFile, piModelLimits, presetFor, recordLink, serializeProviderFile, slugId, supportsCodingModel, validateHost, wrapperFor, writeProviderFile };
