// Unit tests for the provider helpers the two mods share (generated from orca-ui/shared/codex-provider.js).
// `node --test mods` runs this file; nothing here touches herdr, the network or the file system.
import test from "node:test";
import assert from "node:assert/strict";
import {
  OMLX,
  PROVIDER_FILE,
  TEST_ERRORS,
  WRAPPER,
  judgeModels,
  keyHint,
  linkInfo,
  launchArgv,
  parseProviderFile,
  presetFor,
  recordLink,
  serializeProviderFile,
  slugId,
  validateHost,
} from "./codex-provider.js";

test("validateHost accepts base URLs and trims them", () => {
  assert.deepEqual(validateHost("http://127.0.0.1:8000/v1"), { host: "http://127.0.0.1:8000/v1" });
  assert.deepEqual(validateHost("  http://127.0.0.1:8000/v1/  "), { host: "http://127.0.0.1:8000/v1" });
  assert.deepEqual(validateHost("https://models.example.com/v1"), { host: "https://models.example.com/v1" });
});

test("validateHost rejects what a base URL cannot be", () => {
  for (const bad of ["", "   ", "127.0.0.1:8000/v1", "ftp://127.0.0.1/v1", "http://", "http://a b/v1", 'http://a"b/v1', "http://a\\b/v1"]) {
    const checked = validateHost(bad);
    assert.ok(checked.error, `${JSON.stringify(bad)} must be rejected`);
    assert.equal(checked.host, undefined);
  }
});

test("judgeModels passes a 200 with a non-empty data array", () => {
  const body = JSON.stringify({ object: "list", data: [{ id: "mlx-community--LFM2-VL-450M-4bit", max_model_len: 65536 }, { id: "b" }] });
  assert.deepEqual(judgeModels(200, body), { ok: true, models: ["mlx-community--LFM2-VL-450M-4bit", "b"], modelInfo: { "mlx-community--LFM2-VL-450M-4bit": { contextWindow: 65536 } } });
});

test("judgeModels maps every failure to its fixed message", () => {
  assert.deepEqual(judgeModels(401, ""), { ok: false, error: "Key rejected" });
  assert.deepEqual(judgeModels(403, ""), { ok: false, error: "Key rejected" });
  assert.deepEqual(judgeModels(404, "<html>not found</html>"), { ok: false, error: "No /models at this host" });
  assert.deepEqual(judgeModels(200, "<html>hello</html>"), { ok: false, error: "Not a model server" });
  assert.deepEqual(judgeModels(200, JSON.stringify({ models: [] })), { ok: false, error: "Not a model server" });
  assert.deepEqual(judgeModels(200, JSON.stringify({ data: [] })), { ok: false, error: "No models" });
  assert.deepEqual(judgeModels(200, ""), { ok: false, error: "Not a model server" });
  assert.deepEqual(judgeModels(0, ""), { ok: false, error: "Cannot connect" });
  assert.deepEqual(judgeModels(502, "<html>bad gateway</html>"), { ok: false, error: "Cannot connect" });
  // Every message is a fixed string from the design, never anything a server said.
  for (const status of [0, 200, 401, 404, 500]) {
    const verdict = judgeModels(status, "<html>upstream said: secret</html>");
    assert.ok(verdict.ok || Object.values(TEST_ERRORS).includes(verdict.error));
  }
});

// The argv before this feature: the program, then its arguments.
const baseArgv = ["codex", "--no-daemon", "-c", "disable_paste_burst=true"];
const provider = { id: "omlx", host: "http://127.0.0.1:8000/v1", configPath: `/Users/me/.config/herdr-app/${PROVIDER_FILE}` };

test("launchArgv keeps today's argv when no provider is chosen", () => {
  assert.deepEqual(launchArgv(baseArgv, null, "gpt-5"), baseArgv);
  assert.notEqual(launchArgv(baseArgv, null, "gpt-5"), baseArgv);
});

test("launchArgv passes a known model context limit and leaves unknown limits alone", () => {
  const known = launchArgv(baseArgv, { ...provider, modelInfo: { m: { contextWindow: 131072 } } }, "m");
  assert.ok(known.includes("model_context_window=131072"));
  for (const contextWindow of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const argv = launchArgv(baseArgv, { ...provider, modelInfo: { m: { contextWindow } } }, "m");
    assert.equal(argv.some((part) => part.startsWith("model_context_window=")), false);
  }
});

test("launchArgv wraps Codex for oMLX and keeps the flag order from the design", () => {
  const argv = launchArgv(baseArgv, provider, "mlx-community--LFM2-VL-450M-4bit");
  assert.deepEqual(argv, [
    "/bin/sh",
    "-c",
    WRAPPER,
    "--",
    provider.configPath,
    "omlx",
    provider.host,
    "codex",
    "--disable",
    "shell_snapshot",
    "--no-daemon",
    "-c",
    "disable_paste_burst=true",
    "-m",
    "mlx-community--LFM2-VL-450M-4bit",
    "-c",
    'model_provider="omlx"',
    "-c",
    'model_providers.omlx.name="oMLX"',
    "-c",
    'model_providers.omlx.base_url="http://127.0.0.1:8000/v1"',
    "-c",
    'model_providers.omlx.env_key="OMLX_API_KEY"',
  ]);
  // The wrapper reads the key from the file: no argument carries one.
  assert.equal(argv.filter((part) => part.includes("apiKey=") || part.startsWith("sk-")).length, 0);
  assert.ok(WRAPPER.includes("$1") && WRAPPER.includes("$2") && WRAPPER.includes("$3") && WRAPPER.includes('"$@"') && WRAPPER.includes("shift 3"));
  assert.equal(OMLX, "omlx");
});

test("the wrapper reads the key of the record the host came from", () => {
  // Two records in the file: the one chosen sends its own key, never the other record's.
  const other = { id: "myllm", host: "http://127.0.0.1:9000/v1", configPath: provider.configPath };
  const argv = launchArgv(baseArgv, other, "m");
  assert.equal(argv[5], "myllm", "the record id is what the wrapper looks the key up by");
  assert.equal(argv[6], other.host, "the wrapper checks that the record still has the selected host");
  assert.ok(argv.includes('model_providers.omlx.base_url="http://127.0.0.1:9000/v1"'));
  // A record without an id is the oMLX record.
  assert.equal(launchArgv(baseArgv, { ...provider, id: undefined }, "m")[5], "omlx");
});

test("the provider file round-trips and a broken one is refused", () => {
  const providers = { omlx: { name: "oMLX", host: provider.host, apiKey: "k", models: ["a"], selectedModel: { codex: "a" } } };
  assert.deepEqual(parseProviderFile(serializeProviderFile(providers)), { providers });
  assert.deepEqual(parseProviderFile(null), { providers: {} });
  assert.ok(parseProviderFile("{").error);
  assert.ok(parseProviderFile("[]").error);
});

test("linkInfo names a GitHub link by its repo and takes the owner's avatar", () => {
  assert.deepEqual(linkInfo("https://github.com/jundot/omlx"), { link: "https://github.com/jundot/omlx", name: "omlx", iconUrl: "https://github.com/jundot.png?size=64" });
  assert.deepEqual(linkInfo("github.com/jundot/omlx.git?tab=x"), { link: "https://github.com/jundot/omlx", name: "omlx", iconUrl: "https://github.com/jundot.png?size=64" });
  assert.deepEqual(linkInfo("https://github.com/jundot"), { link: "https://github.com/jundot", name: "jundot", iconUrl: "https://github.com/jundot.png?size=64" });
});

test("linkInfo names any other https link by its site and takes its favicon", () => {
  assert.deepEqual(linkInfo("https://models.example.com/docs/x"), { link: "https://models.example.com", name: "example", iconUrl: "https://models.example.com/favicon.ico" });
  assert.deepEqual(linkInfo("example.org"), { link: "https://example.org", name: "example", iconUrl: "https://example.org/favicon.ico" });
});

test("linkInfo: empty is no link, anything else that is not https or a site is an error", () => {
  assert.deepEqual(linkInfo("  "), { link: "", name: "", iconUrl: "" });
  assert.deepEqual(linkInfo(undefined), { link: "", name: "", iconUrl: "" });
  for (const bad of ["http://example.com", "ftp://example.com", "omlx", "https://a:b@example.com", "https://github.com/", "https://github.com/a$b", "a b"]) {
    assert.ok(linkInfo(bad).error, bad);
  }
});

test("recordLink reads the link, or the owner an older record kept", () => {
  assert.equal(recordLink({ link: "https://example.com" }), "https://example.com");
  assert.equal(recordLink({ githubOwner: "jundot" }), "https://github.com/jundot");
  assert.equal(recordLink({}), "");
});

test("presetFor suggests only for a local server on a known port", () => {
  assert.equal(presetFor("http://127.0.0.1:8000/v1").name, "oMLX");
  assert.equal(presetFor("http://localhost:11434/v1").name, "Ollama");
  assert.equal(presetFor("http://example.com:8000/v1"), null);
  assert.equal(presetFor("http://127.0.0.1:9000/v1"), null);
  assert.equal(presetFor("nope"), null);
});

test("slugId makes a unique, safe id", () => {
  assert.equal(slugId("oMLX", []), "omlx");
  assert.equal(slugId("oMLX", ["omlx"]), "omlx-2");
  assert.equal(slugId("   ", []), "provider");
  assert.equal(slugId("constructor", []), "constructor-2");
  assert.equal(slugId("None", []), "none-2", "none is the flyout's word for no provider");
  assert.equal(slugId("My Server!", ["my-server"]), "my-server-2");
});

test("keyHint shows dots and the last four characters", () => {
  assert.equal(keyHint("sk-abcdef1234"), "••••••••••••1234");
  assert.equal(keyHint("short"), "••••••••••••");
  assert.equal(keyHint(undefined), "••••••••••••");
});
