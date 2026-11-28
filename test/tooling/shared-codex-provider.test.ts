import { it } from "vite-plus/test";
import assert from "node:assert/strict";

type ProviderApi = typeof import("../../src/shared/codex-provider.ts");
const api: ProviderApi = await import("../../src/shared/codex-provider.ts");

it("canonical providers launch local models safely and clean up provider writes", async () => {
  const provider = {
    id: "local",
    name: "Local",
    host: "http://127.0.0.1:8000/v1",
    configPath: "/app/model-providers.json",
    models: ["text", "image-only"],
    modelInfo: { text: { contextWindow: 32_000 }, "image-only": { inputModalities: ["image"] } },
    apiKey: "private-key-not-argv",
  };
  assert.deepEqual(api.launchPiArgv(["pi"], null, "m", "/extension"), ["pi"]);
  const pi = api.launchPiArgv(["pi", "--offline"], provider, "text", "/extension");
  assert.deepEqual(
    JSON.parse(
      pi
        .find((arg) => arg.startsWith("HERDR_PI_MODELS="))!
        .split("=")
        .slice(1)
        .join("="),
    ) as unknown,
    ["text"],
  );
  assert.equal(
    pi.some((arg) => arg.includes(provider.apiKey)),
    false,
  );
  assert.ok(
    api
      .launchClaudeArgv(["claude"], provider, "text")
      .some((arg) => arg.includes("ANTHROPIC_AUTH_TOKEN")),
  );
  const openCode = api.launchOpenCodeArgv(["opencode", "run", "prompt"], provider, "text");
  const configText = openCode
    .find((arg) => arg.startsWith("OPENCODE_CONFIG_CONTENT="))!
    .slice("OPENCODE_CONFIG_CONTENT=".length);
  const config = JSON.parse(configText) as {
    model: string;
    providers: {
      herdr: { models: Record<string, { limit: { context: number; output: number } }> };
    };
  };
  assert.equal(config.model, "herdr/model-1");
  assert.deepEqual(config.providers.herdr.models["model-1"].limit, {
    context: 32_000,
    output: 8_192,
  });
  assert.equal(Object.keys(config.providers.herdr.models).length, 1);
  assert.equal(api.launchArgv(["codex"], null, "m")[0], "codex");
  assert.ok(api.launchArgv(["codex"], provider, "text").includes("model_context_window=32000"));
  assert.deepEqual(api.piModelLimits({ contextWindow: 16_384 }), null);
  assert.equal(api.supportsCodingModel({ outputModalities: ["audio"] }), false);
  assert.deepEqual(api.judgeModels(401, ""), { ok: false, error: "Key rejected" });
  const verdict = api.judgeModels(
    200,
    JSON.stringify({
      data: [{ id: "m", context_window: 64_000, max_tokens: 8_000, supported_features: ["tools"] }],
    }),
  );
  assert.ok(verdict.ok);
  assert.deepEqual(
    { ...verdict, modelInfo: { ...verdict.modelInfo } },
    {
      ok: true,
      models: ["m"],
      modelInfo: { m: { contextWindow: 64_000, maxTokens: 8_000, supportedFeatures: ["tools"] } },
    },
  );
  assert.deepEqual(api.parseProviderFile(null), { providers: {} });
  assert.match((api.validateHost("http://:8000") as { error: string }).error, /Enter a host/);

  const calls: unknown[][] = [];
  const writes: unknown[][] = [];
  const home = "/app";
  const exec = async (command: string, args: string[]) => {
    calls.push([command, args]);
    return command === "mktemp"
      ? { code: 0, stdout: `${home}/.provider-write.copy\n` }
      : { code: 0, stdout: "", stderr: "" };
  };
  await api.writeProviderFile(
    {
      appHome: () => home,
      exec,
      writeTextFile: async (...args: unknown[]) => {
        writes.push(args);
      },
    },
    '{"m":{}}\n',
    null,
  );
  assert.deepEqual(
    writes.map(([file]) => file),
    [`${home}/.provider-write.copy/model-providers.json`],
  );
  assert.deepEqual(calls.at(-1), ["rm", ["-rf", `${home}/.provider-write.copy`]]);

  const conflictCalls: unknown[][] = [];
  const conflict = async (command: string, args: string[]) => {
    conflictCalls.push([command, args]);
    return command === "mktemp"
      ? { code: 0, stdout: `${home}/.provider-write.conflict` }
      : command === "python3"
        ? { code: 1, stdout: "provider file changed" }
        : { code: 0, stdout: "" };
  };
  await assert.rejects(
    api.writeProviderFile(
      { appHome: () => home, exec: conflict, writeTextFile: async () => {} },
      "{}",
      "old",
    ),
    /changed or could not be installed/,
  );
  assert.deepEqual(conflictCalls.at(-1), ["rm", ["-rf", `${home}/.provider-write.conflict`]]);
});
