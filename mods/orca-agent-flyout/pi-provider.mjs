// Temporary Pi provider for the Model Provider selected in Herdr. Loaded explicitly per launch.
export default function (pi) {
  const baseUrl = process.env.HERDR_PI_BASE_URL;
  let ids;
  let info;
  try {
    ids = JSON.parse(process.env.HERDR_PI_MODELS ?? "[]");
    info = JSON.parse(process.env.HERDR_PI_MODEL_INFO ?? "{}");
  } catch {
    return;
  }
  if (!baseUrl || !Array.isArray(ids) || !info || typeof info !== "object" || Array.isArray(info)) return;

  pi.registerProvider("herdr", {
    baseUrl,
    api: "openai-completions",
    apiKey: process.env.HERDR_PROVIDER_API_KEY,
    models: ids.filter((id) => typeof id === "string" && id && Number.isSafeInteger(info[id]?.contextWindow) && info[id].contextWindow > 16384 && Number.isSafeInteger(info[id]?.maxTokens) && info[id].maxTokens > 0 && info[id].maxTokens <= info[id].contextWindow).map((id) => ({
      id,
      name: id,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: info[id].contextWindow,
      maxTokens: info[id].maxTokens,
    })),
  });
}
