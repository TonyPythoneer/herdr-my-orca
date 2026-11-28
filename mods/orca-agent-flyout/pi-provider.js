function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isModelMetadata(value) {
	return isRecord(value) && Number.isSafeInteger(value.contextWindow) && value.contextWindow > 16384 && Number.isSafeInteger(value.maxTokens) && value.maxTokens > 0 && value.maxTokens <= value.contextWindow;
}
function pi_provider_default(pi) {
	const baseUrl = process.env.HERDR_PI_BASE_URL;
	let ids;
	let info;
	try {
		ids = JSON.parse(process.env.HERDR_PI_MODELS ?? "[]");
		info = JSON.parse(process.env.HERDR_PI_MODEL_INFO ?? "{}");
	} catch {
		return;
	}
	if (!baseUrl || !Array.isArray(ids) || !isRecord(info)) return;
	pi.registerProvider("herdr", {
		baseUrl,
		api: "openai-completions",
		apiKey: process.env.HERDR_PROVIDER_API_KEY,
		models: ids.flatMap((value) => {
			if (typeof value !== "string" || !value || !isModelMetadata(info[value])) return [];
			const metadata = info[value];
			return [{
				id: value,
				name: value,
				reasoning: false,
				input: ["text"],
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0
				},
				contextWindow: metadata.contextWindow,
				maxTokens: metadata.maxTokens
			}];
		})
	});
}

export { pi_provider_default as default };
