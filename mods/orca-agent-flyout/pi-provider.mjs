// Temporary Pi provider for the Model Provider selected in Herdr. Loaded explicitly per launch.
export default function (pi) {
  const baseUrl = process.env.HERDR_PI_BASE_URL;
  let ids;
  try {
    ids = JSON.parse(process.env.HERDR_PI_MODELS ?? "[]");
  } catch {
    return;
  }
  if (!baseUrl || !Array.isArray(ids)) return;

  pi.registerProvider("herdr", {
    baseUrl,
    api: "openai-completions",
    apiKey: "HERDR_PROVIDER_API_KEY",
    models: ids.filter((id) => typeof id === "string" && id).map((id) => ({ id, name: id, input: ["text"] })),
  });
}
