// The launch wrapper reads a quickstart's master key from its own .env at run time. These tests run the
// real /bin/sh wrapper against temp files: the key must reach the command's environment, never its argv,
// and a host that is not the .env's port must stop the launch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wrapperFor } from "./codex-provider.js";

const KEY = "sk-test-quickstart-0000000000000000";

function envFile(text) {
  const path = join(mkdtempSync(join(tmpdir(), "qs-env-")), ".env");
  writeFileSync(path, text);
  return path;
}

// What the launcher builds: the wrapper, then the record's file, id and host, then the command to run.
function launch(configPath, host, command, ...args) {
  const provider = { configPath, id: "openai", host };
  return spawnSync("/bin/sh", ["-c", wrapperFor(provider, "OMLX_API_KEY"), "--", configPath, "openai", host, command, ...args], { encoding: "utf8" });
}

test("the wrapper hands the quickstart key to the command through its environment", () => {
  const env = envFile(`LITELLM_MASTER_KEY=${KEY}\nLITELLM_PORT=4010\n`);
  const run = launch(env, "http://127.0.0.1:4010/v1", "/usr/bin/printenv", "OMLX_API_KEY");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, `${KEY}\n`);
});

test("the key is never in the command's argv", () => {
  const env = envFile(`LITELLM_MASTER_KEY=${KEY}\nLITELLM_PORT=4010\n`);
  const provider = { configPath: env, id: "openai", host: "http://127.0.0.1:4010/v1" };
  const argv = ["/bin/sh", "-c", wrapperFor(provider, "OMLX_API_KEY"), "--", env, "openai", provider.host, "/usr/bin/true"];
  assert.ok(!argv.some((part) => part.includes(KEY)), "the key must not appear in any argv element");
});

test("a host that is not the .env's port stops the launch before the command runs", () => {
  const env = envFile(`LITELLM_MASTER_KEY=${KEY}\nLITELLM_PORT=4010\n`);
  const run = launch(env, "http://127.0.0.1:9999/v1", "/usr/bin/printenv", "OMLX_API_KEY");
  assert.notEqual(run.status, 0);
  assert.equal(run.stdout, "");
});

test("a .env without a key stops the launch", () => {
  const env = envFile("LITELLM_PORT=4010\n");
  const run = launch(env, "http://127.0.0.1:4010/v1", "/usr/bin/printenv", "OMLX_API_KEY");
  assert.notEqual(run.status, 0);
  assert.equal(run.stdout, "");
});

test("a saved record still uses the record lookup, not the .env path", () => {
  const record = wrapperFor({ configPath: "/home/litellm-gateway/credentials.json" }, "OMLX_API_KEY");
  assert.match(record, /json\.load/);
  assert.doesNotMatch(record, /LITELLM_MASTER_KEY/);
  const quick = wrapperFor({ configPath: "/x/.env" }, "OMLX_API_KEY");
  assert.match(quick, /LITELLM_MASTER_KEY/);
});

test("an indented or repeated key resolves the same way the gateway script resolves it", () => {
  const env = envFile(`LITELLM_MASTER_KEY=sk-old\n  LITELLM_MASTER_KEY=${KEY}\n  LITELLM_PORT=4010  \n`);
  const run = launch(env, "http://127.0.0.1:4010/v1", "/usr/bin/printenv", "OMLX_API_KEY");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, `${KEY}\n`);
});

test("the real Claude launcher keeps the quickstart key out of its argv", async () => {
  const { launchClaudeArgv } = await import("./codex-provider.js");
  const env = envFile(`LITELLM_MASTER_KEY=${KEY}\nLITELLM_PORT=4010\n`);
  const argv = launchClaudeArgv(["/usr/bin/true"], { configPath: env, id: "claude", host: "http://127.0.0.1:4010" }, "m1");
  assert.ok(argv.includes(env), "the .env path is the only credential reference");
  assert.ok(!argv.some((part) => part.includes(KEY)), "the key must not appear in any argv element");
});
