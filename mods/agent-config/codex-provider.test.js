// Unit tests for the provider helpers the two mods share (generated from shared/codex-provider.js).
// `node --test mods` runs this file; nothing here touches herdr, the network or the file system.
import test from "node:test";
import assert from "node:assert/strict";
import {
  OMLX,
  PROVIDER_FILE,
  TEST_ERRORS,
  WRAPPER,
  judgeModels,
  launchArgv,
  parseProviderFile,
  serializeProviderFile,
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
  const body = JSON.stringify({ object: "list", data: [{ id: "mlx-community--LFM2-VL-450M-4bit" }, { id: "b" }] });
  assert.deepEqual(judgeModels(200, body), { ok: true, models: ["mlx-community--LFM2-VL-450M-4bit", "b"] });
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
const provider = { host: "http://127.0.0.1:8000/v1", configPath: `/Users/me/.config/herdr-app/${PROVIDER_FILE}` };

test("launchArgv keeps today's argv when no provider is chosen", () => {
  assert.deepEqual(launchArgv(baseArgv, null, "gpt-5"), baseArgv);
  assert.notEqual(launchArgv(baseArgv, null, "gpt-5"), baseArgv);
});

test("launchArgv wraps Codex for oMLX and keeps the flag order from the design", () => {
  const argv = launchArgv(baseArgv, provider, "mlx-community--LFM2-VL-450M-4bit");
  assert.deepEqual(argv, [
    "/bin/sh",
    "-c",
    WRAPPER,
    "--",
    provider.configPath,
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
  assert.ok(WRAPPER.includes("$1") && WRAPPER.includes('"$@"') && WRAPPER.includes("shift"));
  assert.equal(OMLX, "omlx");
});

test("the provider file round-trips and a broken one is refused", () => {
  const providers = { omlx: { name: "oMLX", host: provider.host, apiKey: "k", models: ["a"], selectedModel: { codex: "a" } } };
  assert.deepEqual(parseProviderFile(serializeProviderFile(providers)), { providers });
  assert.deepEqual(parseProviderFile(null), { providers: {} });
  assert.ok(parseProviderFile("{").error);
  assert.ok(parseProviderFile("[]").error);
});
