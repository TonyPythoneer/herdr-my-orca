type ModelMetadata = {
  contextWindow: number;
  maxTokens: number;
};

type PiProvider = {
  baseUrl: string;
  api: "openai-completions";
  apiKey?: string;
  models: {
    id: string;
    name: string;
    reasoning: false;
    input: ["text"];
    cost: { input: 0; output: 0; cacheRead: 0; cacheWrite: 0 };
    contextWindow: number;
    maxTokens: number;
  }[];
};

type PiExtension = {
  registerProvider(id: "herdr", provider: PiProvider): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isModelMetadata(value: unknown): value is ModelMetadata {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.contextWindow) &&
    (value.contextWindow as number) > 16384 &&
    Number.isSafeInteger(value.maxTokens) &&
    (value.maxTokens as number) > 0 &&
    (value.maxTokens as number) <= (value.contextWindow as number)
  );
}

export default function (pi: PiExtension): void {
  const baseUrl = process.env.HERDR_PI_BASE_URL;
  let ids: unknown;
  let info: unknown;
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
      return [
        {
          id: value,
          name: value,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: metadata.contextWindow,
          maxTokens: metadata.maxTokens,
        },
      ];
    }),
  });
}
