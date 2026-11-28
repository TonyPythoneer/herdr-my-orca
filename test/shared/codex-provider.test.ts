import { it as test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  iconFromHtml,
  judgeModels,
  keyHint,
  launchArgv,
  launchClaudeArgv,
  launchOpenCodeArgv,
  launchPiArgv,
  linkInfo,
  parseProviderFile,
  piModelLimits,
  presetFor,
  recordLink,
  serializeProviderFile,
  slugId,
  supportsCodingModel,
  validateHost,
  writeProviderFile,
  wrapperFor,
} from "../../src/shared/codex-provider.ts";

const ERROR = { error: "Enter a link like https://github.com/owner/repo or https://example.com" };
const NONE = { link: "", name: "", iconUrl: "" };

test("linkInfo: no link is empty, not an error", () => {
  for (const text of [undefined, null, "", "   "]) assert.deepEqual(linkInfo(text), NONE);
});

test("linkInfo: a GitHub link names the repo and takes the owner's avatar", () => {
  const repo = {
    link: "https://github.com/o/r",
    name: "r",
    iconUrl: "https://github.com/o.png?size=64",
  };
  for (const text of [
    "https://github.com/o/r",
    "github.com/o/r",
    "https://www.github.com/o/r/",
    "HTTPS://GitHub.com/o/r.git",
    "https://github.com/o/r/tree/main",
  ]) {
    assert.deepEqual(linkInfo(text), repo, text);
  }
  const owner = {
    link: "https://github.com/o",
    name: "o",
    iconUrl: "https://github.com/o.png?size=64",
  };
  assert.deepEqual(linkInfo("https://github.com/o"), owner);
  assert.deepEqual(linkInfo("https://github.com/o/"), owner);
  assert.deepEqual(
    linkInfo("https://github.com/o/bad name"),
    owner,
    "an unusable repo falls back to the owner",
  );
  assert.deepEqual(
    linkInfo(`https://github.com/o/${"r".repeat(101)}`),
    owner,
    "a repo name is at most 100 characters",
  );
  assert.equal(linkInfo(`https://github.com/o/${"r".repeat(100)}`).name, "r".repeat(100));
});

test("linkInfo: a GitHub owner must be a valid login", () => {
  assert.deepEqual(linkInfo("https://github.com/"), ERROR);
  assert.deepEqual(linkInfo("https://github.com"), ERROR);
  assert.deepEqual(linkInfo("https://github.com/-bad/r"), ERROR);
  assert.deepEqual(linkInfo("https://github.com/bad_owner/r"), ERROR);
  assert.deepEqual(
    linkInfo(`https://github.com/${"o".repeat(40)}/r`),
    ERROR,
    "a login is at most 39 characters",
  );
  assert.equal(linkInfo(`https://github.com/${"o".repeat(39)}/r`).name, "r");
});

test("linkInfo: any other https link names its site and takes /favicon.ico", () => {
  assert.deepEqual(linkInfo("example.com"), {
    link: "https://example.com",
    name: "example",
    iconUrl: "https://example.com/favicon.ico",
  });
  assert.deepEqual(linkInfo("https://www.Docs.Example.com:8443/a/b?q=1"), {
    link: "https://www.docs.example.com:8443",
    name: "example",
    iconUrl: "https://www.docs.example.com:8443/favicon.ico",
  });
});

test("linkInfo: only plain https links with a dotted host are accepted", () => {
  for (const text of [
    "http://example.com",
    "ftp://example.com",
    "https://localhost",
    "https://user@example.com",
    "https://user:pw@example.com",
    "https://",
    "https://exa mple.com",
    "mailto:x@example.com",
  ]) {
    assert.deepEqual(linkInfo(text), ERROR, text);
  }
});

test("iconFromHtml: an SVG link icon wins", () => {
  const html =
    '<html><head><link rel="icon" type="image/svg+xml" href="/logo.svg" sizes="any"><link rel="icon" href="/favicon.ico"></head></html>';
  assert.equal(iconFromHtml(html, "https://example.com/"), "https://example.com/logo.svg");
});

test("iconFromHtml: the first rel=icon link wins when there is no SVG", () => {
  const html =
    '<html><head><link rel="icon" href="/second.ico"><link rel="icon" href="/first.ico"></head></html>';
  assert.equal(iconFromHtml(html, "https://example.com/"), "https://example.com/second.ico");
});

test("iconFromHtml: a shortcut icon still counts as an icon", () => {
  const html = '<html><head><link rel="shortcut icon" href="/favicon.ico"></head></html>';
  assert.equal(iconFromHtml(html, "https://example.com/"), "https://example.com/favicon.ico");
});

test("iconFromHtml: relative hrefs resolve against the site origin", () => {
  const html =
    '<html><head><link rel="icon" type="image/svg+xml" href="icons/logo.svg"></head></html>';
  assert.equal(
    iconFromHtml(html, "https://example.com/site/"),
    "https://example.com/site/icons/logo.svg",
  );
});

test("iconFromHtml: an SVG without href is skipped", () => {
  const html =
    '<html><head><link rel="icon" type="image/svg+xml"><link rel="icon" href="/favicon.ico"></head></html>';
  assert.equal(iconFromHtml(html, "https://example.com/"), "https://example.com/favicon.ico");
});

test("iconFromHtml: quoted attributes and unsafe URLs", () => {
  assert.equal(
    iconFromHtml(
      "<link rel = 'icon' type = 'image/svg+xml' href = '/logo.svg'>",
      "https://example.com/",
    ),
    "https://example.com/logo.svg",
  );
  assert.equal(
    iconFromHtml(
      '<link rel="icon" href="file:///etc/passwd"><link rel="icon" href="/safe.png">',
      "https://example.com/",
    ),
    "https://example.com/safe.png",
  );
});

test("iconFromHtml: no icon link means null", () => {
  assert.equal(iconFromHtml("<html><head></head></html>", "https://example.com/"), null);
  assert.equal(
    iconFromHtml(
      '<html><head><link rel="stylesheet" href="/a.css"></head></html>',
      "https://example.com/",
    ),
    null,
  );
});

test("recordLink, presetFor, slugId, keyHint and validateHost", () => {
  assert.equal(recordLink({ link: "L", githubOwner: "o" }), "L");
  assert.equal(recordLink({ githubOwner: "o" }), "https://github.com/o");
  assert.equal(recordLink({}), "");
  assert.equal(recordLink(undefined), "");
  assert.deepEqual(presetFor("http://127.0.0.1:8000/v1"), {
    name: "oMLX",
    link: "https://github.com/jundot/omlx",
  });
  assert.deepEqual(presetFor("http://localhost:11434"), {
    name: "Ollama",
    link: "https://github.com/ollama/ollama",
  });
  assert.equal(presetFor("http://localhost:9"), null);
  assert.equal(presetFor("http://example.com:8000"), null);
  assert.equal(presetFor("not a url"), null);
  assert.equal(slugId("My Host!", []), "my-host");
  assert.equal(slugId("My Host!", ["my-host", "my-host-2"]), "my-host-3");
  assert.equal(slugId("", []), "provider");
  assert.equal(slugId("None", []), "none-2");
  assert.equal(slugId("constructor", []), "constructor-2", "never an Object.prototype key");
  assert.equal(keyHint("12345678"), "••••••••••••5678");
  assert.equal(keyHint("1234567"), "••••••••••••");
  assert.equal(keyHint(undefined), "••••••••••••");
  assert.deepEqual(validateHost(" http://127.0.0.1:8000/v1// "), {
    host: "http://127.0.0.1:8000/v1",
  });
  assert.match(validateHost("ftp://x").error, /Enter a host/);
  assert.match(validateHost("http://exa mple").error, /Enter a host/);
  assert.match(validateHost("http://").error, /Enter a host/);
  assert.match(validateHost("http://:8000").error, /Enter a host/);
});

test("provider launch builders keep credentials out of argv and respect real model capabilities", () => {
  const provider = {
    id: "local",
    name: "Local",
    host: "http://127.0.0.1:8000/v1",
    configPath: "/app/model-providers.json",
    models: ["text", "unknown-cap", "image-only"],
    modelInfo: {
      text: { contextWindow: 100_000, maxTokens: 20_000 },
      "unknown-cap": { contextWindow: 20_000 },
      "image-only": { inputModalities: ["image"] },
    },
    apiKey: "never-put-this-in-argv",
  };
  assert.deepEqual(launchPiArgv(["pi", "--version"], null, "m", "/ext"), ["pi", "--version"]);
  const pi = launchPiArgv(["pi", "--version"], provider, "text", "/ext");
  assert.deepEqual(
    JSON.parse(
      pi.find((arg) => arg.startsWith("HERDR_PI_MODELS=")).slice("HERDR_PI_MODELS=".length),
    ),
    ["text", "unknown-cap"],
  );
  assert.deepEqual(
    JSON.parse(
      pi.find((arg) => arg.startsWith("HERDR_PI_MODEL_INFO=")).slice("HERDR_PI_MODEL_INFO=".length),
    ),
    {
      text: { contextWindow: 100_000, maxTokens: 20_000 },
      "unknown-cap": { contextWindow: 20_000, maxTokens: 8_192 },
    },
  );
  assert.equal(pi.at(-1), "/ext");
  assert.equal(
    pi.some((arg) => arg.includes(provider.apiKey)),
    false,
  );

  assert.deepEqual(launchClaudeArgv(["claude", "--print"], null, "m"), ["claude", "--print"]);
  const claude = launchClaudeArgv(["claude", "--print"], provider, "text");
  assert.ok(claude.some((arg) => arg.includes("ANTHROPIC_AUTH_TOKEN")));
  assert.ok(claude.includes("ANTHROPIC_BASE_URL=http://127.0.0.1:8000/v1"));
  assert.equal(
    claude.some((arg) => arg.includes(provider.apiKey)),
    false,
  );

  assert.deepEqual(launchOpenCodeArgv(["opencode", "run", "hello"], null, "m"), [
    "opencode",
    "run",
    "hello",
  ]);
  const openCode = launchOpenCodeArgv(["opencode", "run", "hello"], provider, "text");
  const config = JSON.parse(
    openCode
      .find((arg) => arg.startsWith("OPENCODE_CONFIG_CONTENT="))
      .slice("OPENCODE_CONFIG_CONTENT=".length),
  );
  assert.equal(config.model, "herdr/model-1");
  assert.deepEqual(config.providers.herdr.models["model-1"].limit, {
    context: 100_000,
    output: 20_000,
  });
  assert.deepEqual(config.providers.herdr.models["model-2"].limit, {
    context: 20_000,
    output: 8_192,
  });
  assert.equal(Object.keys(config.providers.herdr.models).length, 2);
  assert.equal(
    openCode.some((arg) => arg.includes(provider.apiKey)),
    false,
  );
});

test("model metadata handles provider schema variants and rejects incompatible text/tool models", () => {
  assert.equal(supportsCodingModel(undefined), true);
  assert.equal(supportsCodingModel({ inputModalities: ["image"] }), false);
  assert.equal(supportsCodingModel({ outputModalities: ["audio"] }), false);
  assert.equal(supportsCodingModel({ supportedFeatures: ["vision"] }), false);
  assert.equal(supportsCodingModel({ supportedFeatures: ["tool_use"] }), true);
  assert.equal(piModelLimits({ contextWindow: 16_384 }), null);
  assert.equal(piModelLimits({ contextWindow: Number.MAX_SAFE_INTEGER + 1 }), null);
  assert.deepEqual(piModelLimits({ contextWindow: 20_000, maxTokens: 25_000 }), null);
  assert.deepEqual(piModelLimits({ contextWindow: 20_000, maxTokens: 0 }), {
    contextWindow: 20_000,
    maxTokens: 8_192,
  });

  const result = judgeModels(
    200,
    JSON.stringify({
      data: [
        "string-model",
        {
          id: "nested",
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
          top_provider: { context_length: 32_000, max_completion_tokens: 4_000 },
          supported_parameters: ["tools"],
        },
        { id: "duplicate", input_modalities: ["image"] },
        { id: "duplicate", output_modalities: ["text"] },
        { id: "", context_window: 0 },
        null,
      ],
    }),
  );
  assert.deepEqual(
    { ...result, modelInfo: { ...result.modelInfo } },
    {
      ok: true,
      models: ["string-model", "nested", "duplicate"],
      modelInfo: {
        nested: {
          contextWindow: 32_000,
          maxTokens: 4_000,
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportedFeatures: ["tools"],
        },
        duplicate: { outputModalities: ["text"] },
      },
    },
  );
});

test("provider files reject malformed shapes and writes always clean private staging", async () => {
  assert.deepEqual(parseProviderFile(""), { providers: {} });
  assert.deepEqual(
    parseProviderFile(serializeProviderFile({ local: { host: "http://localhost" } })),
    { providers: { local: { host: "http://localhost" } } },
  );
  assert.ok(parseProviderFile("{").error);
  assert.ok(parseProviderFile("null").error);

  const calls = [];
  const writes = [];
  const home = "/app";
  const exec = async (command, args) => {
    calls.push([command, args]);
    if (command === "mktemp") return { code: 0, stdout: `${home}/.provider-write.test\n` };
    if (command === "chmod" || command === "rm" || command === "python3")
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command: ${command}`);
  };
  await writeProviderFile(
    { appHome: home, exec, writeTextFile: async (...args) => writes.push(args) },
    '{"local":{}}\n',
    '{"old":{}}\n',
  );
  assert.deepEqual(
    writes.map(([path]) => path),
    [`${home}/.provider-write.test/model-providers.json`, `${home}/.provider-write.test/expected`],
  );
  assert.equal(calls.filter(([command]) => command === "chmod").length, 3);
  assert.deepEqual(calls.at(-1), ["rm", ["-rf", `${home}/.provider-write.test`]]);

  const failed = async (command, args) =>
    command === "mktemp"
      ? { code: 0, stdout: `${home}/.provider-write.failed` }
      : command === "chmod"
        ? { code: 1, stdout: "" }
        : { code: 0, stdout: "" };
  await assert.rejects(
    writeProviderFile(
      {
        appHome: home,
        exec: failed,
        writeTextFile: async () => assert.fail("should fail before writing"),
      },
      "{}",
      null,
    ),
    /secure provider staging directory/,
  );
});

test("Codex launch argv preserves ordinary launches and applies only safe context overrides", () => {
  const baseArgv = ["codex", "--full-auto"];
  assert.deepEqual(launchArgv(baseArgv, null, "m"), baseArgv);
  const provider = {
    id: "local",
    configPath: "/app/providers.json",
    host: "http://127.0.0.1:8000/v1",
  };
  const withoutLimits = launchArgv(baseArgv, provider, "m");
  assert.ok(withoutLimits.includes('model_provider="omlx"'));
  assert.equal(launchArgv(baseArgv, { ...provider, id: undefined }, "m")[5], "omlx");
  assert.equal(withoutLimits.includes("model_context_window=0"), false);
  assert.equal(withoutLimits.at(-1), 'model_providers.omlx.env_key="OMLX_API_KEY"');
  const withLimits = launchArgv(
    baseArgv,
    { ...provider, modelInfo: { m: { contextWindow: 131_072 } } },
    "m",
  );
  assert.ok(withLimits.includes("model_context_window=131072"));
  const invalidLimits = launchArgv(
    baseArgv,
    { ...provider, modelInfo: { m: { contextWindow: Number.MAX_SAFE_INTEGER + 1 } } },
    "m",
  );
  assert.equal(
    invalidLimits.includes(`model_context_window=${Number.MAX_SAFE_INTEGER + 1}`),
    false,
  );
});

test("model endpoint maps authentication, route, server and malformed URL failures", () => {
  assert.deepEqual(judgeModels(401, ""), { ok: false, error: "Key rejected" });
  assert.deepEqual(judgeModels(403, ""), { ok: false, error: "Key rejected" });
  assert.deepEqual(judgeModels(404, ""), { ok: false, error: "No /models at this host" });
  assert.deepEqual(judgeModels(502, ""), { ok: false, error: "Cannot connect" });
  assert.deepEqual(judgeModels(200, "<html>not JSON</html>"), {
    ok: false,
    error: "Not a model server",
  });
});

test("launchPiArgv skips models without valid limits", () => {
  const provider = {
    id: "local",
    name: "Local",
    host: "http://127.0.0.1:8000/v1",
    configPath: "/app/model-providers.json",
    models: ["bad-model", "good-model"],
    modelInfo: {
      "bad-model": { contextWindow: 0 },
      "good-model": { contextWindow: 100_000, maxTokens: 20_000 },
    },
    apiKey: "never-put-this-in-argv",
  };
  const pi = launchPiArgv(["pi", "--version"], provider, "good-model", "/ext");
  const modelInfo = JSON.parse(
    pi.find((arg) => arg.startsWith("HERDR_PI_MODEL_INFO=")).slice("HERDR_PI_MODEL_INFO=".length),
  );
  assert.ok("good-model" in modelInfo);
  assert.ok(!("bad-model" in modelInfo));
});

test("launchClaudeArgv with undefined provider id", () => {
  const provider = {
    id: undefined,
    name: "Local",
    host: "http://127.0.0.1:8000/v1",
    configPath: "/app/providers.json",
  };
  const result = launchClaudeArgv(["claude", "--print"], provider, "m");
  // Filter out undefined elements (provider.id! is undefined at runtime)
  const args = result.filter((arg): arg is string => typeof arg === "string");
  assert.ok(args.some((arg) => arg.includes("127.0.0.1")));
});

test("modelCapabilities: supported_parameters without supported_features", () => {
  const result = judgeModels(
    200,
    JSON.stringify({ data: [{ id: "m1", supported_parameters: ["tools"] }] }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.models, ["m1"]);
  assert.ok(result.modelInfo);
  assert.equal((result.modelInfo as Record<string, unknown>).m1?.supportedFeatures?.[0], "tools");
});

test("modelCapabilities: empty features array sets supportedFeatures to empty array", () => {
  const result = judgeModels(200, JSON.stringify({ data: [{ id: "m1", supported_features: [] }] }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.models, ["m1"]);
  const m1 = (result.modelInfo as Record<string, unknown> | undefined)?.m1;
  assert.ok(m1);
  assert.deepEqual(m1?.supportedFeatures, []);
});

test("modelCapabilities: no features at all leaves supportedFeatures unset", () => {
  const result = judgeModels(200, JSON.stringify({ data: [{ id: "m1", context_window: 100 }] }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.models, ["m1"]);
  const m1 = (result.modelInfo as Record<string, unknown> | undefined)?.m1;
  assert.ok(m1);
  assert.ok(!("supportedFeatures" in m1));
});

test("modelMetadata: zero contextWindow is skipped", () => {
  const result = judgeModels(200, JSON.stringify({ data: [{ id: "m1", context_window: 0 }] }));
  assert.deepEqual(result, { ok: true, models: ["m1"] });
});

test("judgeModels: empty models list returns empty error", () => {
  const result = judgeModels(200, JSON.stringify({ data: [] }));
  assert.deepEqual(result, { ok: false, error: "No models" });
});

test("judgeModels: models with no modelInfo returns ok without modelInfo", () => {
  const result = judgeModels(200, JSON.stringify({ data: [{ id: "m1" }] }));
  assert.deepEqual(result, { ok: true, models: ["m1"] });
});

test("writeProviderFile rejects invalid mktemp directory", async () => {
  const home = "/app";
  const exec = async (command, args) => {
    if (command === "mktemp") return { code: 1, stdout: "", stderr: "failed" };
    return { code: 0, stdout: "", stderr: "" };
  };
  await assert.rejects(
    writeProviderFile({ appHome: home, exec, writeTextFile: async () => null }, "{}"),
    /Could not create private provider staging directory/,
  );
});
