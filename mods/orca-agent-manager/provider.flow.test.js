// Flow test: runs the real model-provider handlers of main.js with answer-controlled curl, chmod
// and stat (scripts/gpui-stub-loader.mjs), so the save order, the file mode and the delete are
// checked without the app or a live oMLX server.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: AgentManager } = await import("./main.js");

const PROVIDERS = "/home/model-providers.json";
const ICON = "/home/provider-icons/omlx.png";
const KEY = "test-key";
const MODELS = JSON.stringify({ object: "list", data: [{ id: "mlx-community--LFM2-VL-450M-4bit" }, { id: "b" }] });

// The three programs this page runs: the /models curl, the avatar curl, chmod, stat, xxd and the
// file moves. `answers` decides what the server says.
function harness({ file = null, status = 200, body = MODELS, iconStatus = 200, magic = "89504e470d0a1a0a", mode = "600", owner: ownerName = "tonyyang" } = {}) {
  const files = new Map();
  if (file !== null) files.set(PROVIDERS, file);
  globalThis.__herdrFiles = files;
  const calls = [];
  globalThis.__herdrExec = async (command, args) => {
    calls.push([command, ...args]);
    if (command === "curl" && args.some((part) => part.includes("github.com"))) {
      if (iconStatus === 200) files.set(args[args.indexOf("-o") + 1], "png");
      return { code: 0, stdout: `\n${iconStatus}`, stderr: "" };
    }
    if (command === "curl") return { code: 0, stdout: body ? `${body}\n${status}` : `\n${status}`, stderr: "" };
    if (command === "xxd") return { code: 0, stdout: `${magic}\n`, stderr: "" };
    if (command === "chmod") return { code: 0, stdout: "", stderr: "" };
    if (command === "stat") return { code: 0, stdout: `${mode}\n`, stderr: "" };
    if (command === "mv" || command === "rm") return { code: 0, stdout: "", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const cx = { notify() {} };
  const owner = Object.create(AgentManager.prototype);
  const field = (value) => {
    const state = { text: value, value: () => state.text, set_value: (next) => { state.text = next; } };
    return state;
  };
  Object.assign(owner, {
    provider: null,
    providerText: undefined,
    providerWrittenAt: 0,
    providerStatus: null,
    providerTesting: false,
    typing: false,
    providerHost: field("http://127.0.0.1:8000/v1/"),
    providerKey: field(KEY),
    providerOwner: field(ownerName),
  });
  return { owner, files, calls, cx };
}

const savedRecord = () => ({
  name: "oMLX",
  host: "http://127.0.0.1:8000/v1",
  apiKey: KEY,
  githubOwner: "tonyyang",
  iconPath: ICON,
  verifiedAt: "2026-11-22T10:00:00.000Z",
  models: ["mlx-community--LFM2-VL-450M-4bit"],
  selectedModel: { codex: "mlx-community--LFM2-VL-450M-4bit" },
});
const savedFile = () => `${JSON.stringify({ omlx: savedRecord() }, null, 2)}\n`;

test("a passing test writes the record, fixes the mode and saves the icon", async () => {
  const { owner, files, calls, cx } = harness();
  await owner.testAndSaveProvider(cx);
  const record = JSON.parse(files.get(PROVIDERS)).omlx;
  assert.equal(record.host, "http://127.0.0.1:8000/v1"); // the trailing slash is gone
  assert.equal(record.apiKey, KEY);
  assert.deepEqual(record.models, ["mlx-community--LFM2-VL-450M-4bit", "b"]);
  assert.equal(record.iconPath, ICON);
  assert.equal(owner.providerStatus.tone, "done");
  // write, then chmod, then the check that it took
  assert.ok(calls.some((call) => call[0] === "chmod" && call[1] === "600"));
  assert.ok(calls.some((call) => call[0] === "stat"));
  assert.ok(calls.some((call) => call[0] === "mv" && call.at(-1) === ICON));
});

test("a wrong key writes nothing at all", async () => {
  for (const status of [401, 403, 404, 0]) {
    const { owner, files, calls, cx } = harness({ file: "{}\n", status });
    await owner.testAndSaveProvider(cx);
    assert.equal(files.get(PROVIDERS), "{}\n", `status ${status} must not write`);
    assert.equal(files.has(ICON), false);
    assert.equal(owner.providerStatus.tone, "blocked");
    assert.ok(["Key rejected", "No /models at this host", "Cannot connect"].includes(owner.providerStatus.text));
    assert.equal(calls.some((call) => call[0] === "chmod"), false);
  }
});

test("a 200 that is not a model server writes nothing", async () => {
  const { owner, files, cx } = harness({ file: null, status: 200, body: "<html>hello</html>" });
  await owner.testAndSaveProvider(cx);
  assert.equal(files.has(PROVIDERS), false);
  assert.equal(owner.providerStatus.text, "Not a model server");
});

test("an avatar in either image format is kept, an HTML error page is not", async () => {
  for (const magic of ["89504e470d0a1a0a", "ffd8ffdb00840008"]) {
    const { owner, files, cx } = harness({ magic });
    await owner.testAndSaveProvider(cx);
    assert.equal(JSON.parse(files.get(PROVIDERS)).omlx.iconPath, ICON, magic);
  }
  const html = harness({ magic: "3c68746d6c3e0a" });
  await html.owner.testAndSaveProvider(html.cx);
  assert.equal(JSON.parse(html.files.get(PROVIDERS)).omlx.iconPath, "");
});

test("a mode that did not take is reported", async () => {
  const { owner, cx } = harness({ mode: "644" });
  await owner.testAndSaveProvider(cx);
  assert.equal(owner.providerStatus.tone, "blocked");
  assert.equal(owner.providerStatus.text, "model-providers.json is not private to your user.");
});

test("delete removes the record and its icon", async () => {
  const { owner, files, calls, cx } = harness({ file: savedFile() });
  owner.provider = savedRecord();
  owner.providerText = files.get(PROVIDERS);
  await owner.deleteProvider(cx);
  assert.deepEqual(JSON.parse(files.get(PROVIDERS)), {});
  assert.ok(calls.some((call) => call[0] === "rm" && call[1] === "-f" && call[2] === ICON));
  assert.equal(owner.provider, null);
  assert.equal(owner.providerStatus.text, "Deleted.");
});

test("delete never removes a file outside the provider icon folder", async () => {
  const record = { ...savedRecord(), iconPath: "/home/important.txt" };
  const { owner, calls, cx } = harness({ file: `${JSON.stringify({ omlx: record }, null, 2)}\n` });
  owner.provider = record;
  await owner.deleteProvider(cx);
  assert.equal(calls.some((call) => call[0] === "rm"), false);
});

test("a re-test never removes a file outside the provider icon folder", async () => {
  const record = { ...savedRecord(), iconPath: "/home/important.txt" };
  const { owner, files, calls, cx } = harness({ file: `${JSON.stringify({ omlx: record }, null, 2)}\n`, owner: "someone-else" });
  await owner.testAndSaveProvider(cx);
  assert.equal(calls.some((call) => call[0] === "rm"), false);
  // The new record names the avatar it just saved, not the old file.
  assert.equal(JSON.parse(files.get(PROVIDERS)).omlx.iconPath, ICON);
});

test("a replaced icon of ours is deleted", async () => {
  // The owner is cleared, so the saved avatar goes too. It is one of ours.
  const { owner, calls, cx } = harness({ file: savedFile(), owner: "" });
  await owner.testAndSaveProvider(cx);
  assert.ok(calls.some((call) => call[0] === "rm" && call[2] === ICON));
});

test("a read older than this page's own write never brings a deleted record back", async () => {
  const { owner, files, cx } = harness({ file: savedFile() });
  owner.provider = savedRecord();
  owner.providerText = files.get(PROVIDERS);
  await owner.deleteProvider(cx);
  assert.equal(owner.provider, null);
  assert.equal(owner.providerHost.value(), "");
  // The page read the file just before the delete and applies just after it: that text is stale.
  assert.equal(owner.applyProviders(savedFile(), owner.providerWrittenAt - 1), false);
  assert.equal(owner.provider, null);
  assert.equal(owner.providerHost.value(), "");
  // A read that started after the write is news, and it does apply.
  assert.equal(owner.applyProviders(savedFile(), owner.providerWrittenAt + 1), true);
  assert.equal(owner.provider.host, "http://127.0.0.1:8000/v1");
});
