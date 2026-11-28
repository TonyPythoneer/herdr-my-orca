import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import extension from "../../../src/mods/orca-agent-flyout/pi-provider.js";

const baseEnvironment = {
  HERDR_PI_BASE_URL: "https://models.example/v1",
  HERDR_PI_MODELS: '["herdr/model-a"]',
  HERDR_PI_MODEL_INFO: '{"herdr/model-a":{"contextWindow":32768,"maxTokens":8192}}',
  HERDR_PROVIDER_API_KEY: "secret",
};

function register(environment: Partial<typeof baseEnvironment> = {}) {
  vi.stubEnv("HERDR_PI_BASE_URL", baseEnvironment.HERDR_PI_BASE_URL);
  vi.stubEnv("HERDR_PI_MODELS", baseEnvironment.HERDR_PI_MODELS);
  vi.stubEnv("HERDR_PI_MODEL_INFO", baseEnvironment.HERDR_PI_MODEL_INFO);
  vi.stubEnv("HERDR_PROVIDER_API_KEY", baseEnvironment.HERDR_PROVIDER_API_KEY);
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[name];
    else vi.stubEnv(name, value);
  }
  const registerProvider = vi.fn();
  extension({ registerProvider });
  return registerProvider;
}

afterEach(() => vi.unstubAllEnvs());

describe("Pi provider extension", () => {
  it("registers the provider and preserves supported model metadata", () => {
    const registerProvider = register();
    expect(registerProvider).toHaveBeenCalledWith("herdr", {
      baseUrl: "https://models.example/v1",
      api: "openai-completions",
      apiKey: "secret",
      models: [
        {
          id: "herdr/model-a",
          name: "herdr/model-a",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 32768,
          maxTokens: 8192,
        },
      ],
    });
  });

  it("does not register when the base URL is absent or either JSON value is malformed", () => {
    for (const environment of [
      { HERDR_PI_BASE_URL: "" },
      { HERDR_PI_MODELS: "{" },
      { HERDR_PI_MODEL_INFO: "{" },
    ])
      expect(register(environment)).not.toHaveBeenCalled();
  });

  it("rejects invalid top-level model data and keeps valid empty model lists", () => {
    for (const environment of [
      { HERDR_PI_MODELS: "null" },
      { HERDR_PI_MODEL_INFO: "[]" },
      { HERDR_PI_MODEL_INFO: "null" },
    ])
      expect(register(environment)).not.toHaveBeenCalled();
    expect(register({ HERDR_PI_MODELS: "[]" })).toHaveBeenCalledWith(
      "herdr",
      expect.objectContaining({ models: [] }),
    );
  });

  it("defaults missing model environment values to an empty provider catalog", () => {
    expect(
      register({ HERDR_PI_MODELS: undefined, HERDR_PI_MODEL_INFO: undefined }),
    ).toHaveBeenCalledWith("herdr", expect.objectContaining({ models: [] }));
  });

  it("filters invalid ids and model metadata at real configuration boundaries", () => {
    const ids = JSON.stringify([
      "",
      5,
      "missing",
      "too-small",
      "unsafe-context",
      "zero-output",
      "output-too-large",
      "unsafe-output",
      "valid",
    ]);
    const info = JSON.stringify({
      "too-small": { contextWindow: 16384, maxTokens: 1 },
      "unsafe-context": { contextWindow: Number.MAX_SAFE_INTEGER + 1, maxTokens: 1 },
      "zero-output": { contextWindow: 32768, maxTokens: 0 },
      "output-too-large": { contextWindow: 32768, maxTokens: 32769 },
      "unsafe-output": { contextWindow: 32768, maxTokens: Number.MAX_SAFE_INTEGER + 1 },
      valid: { contextWindow: 32768, maxTokens: 32768 },
    });
    const registerProvider = register({ HERDR_PI_MODELS: ids, HERDR_PI_MODEL_INFO: info });
    expect(registerProvider).toHaveBeenCalledWith(
      "herdr",
      expect.objectContaining({
        models: [expect.objectContaining({ id: "valid", maxTokens: 32768 })],
      }),
    );
  });

  it("accepts safe integer limits immediately above the context threshold", () => {
    const registerProvider = register({
      HERDR_PI_MODELS: '["edge"]',
      HERDR_PI_MODEL_INFO: '{"edge":{"contextWindow":16385,"maxTokens":1}}',
    });
    expect(registerProvider).toHaveBeenCalledWith(
      "herdr",
      expect.objectContaining({
        models: [expect.objectContaining({ id: "edge", contextWindow: 16385, maxTokens: 1 })],
      }),
    );
  });
});
