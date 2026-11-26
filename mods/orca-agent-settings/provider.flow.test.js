// Flow test: runs the real model-provider handlers of main.js with answer-controlled curl, mktemp,
// chmod and sips (scripts/gpui-stub-loader.mjs), without the app or a live model server.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: AgentManager } = await import("./main.js");

const PROVIDERS = "/home/model-providers.json";
const ICON_DIR = "/home/provider-icons/";
const KEY = "test-key-ab12";
const MODELS = JSON.stringify({ object: "list", data: [{ id: "mlx-community--LFM2-VL-450M-4bit", context_window: 65536, max_completion_tokens: 8192 }, { id: "b" }] });
const PNG = "89504e470d0a1a0a";
const OMLX_LINK = "https://github.com/jundot/omlx";

const field = (value) => {
  const state = { text: value, value: () => state.text, set_value: (next) => { state.text = next; }, set_masked() {} };
  return state;
};

// `answers` controls the /models and icon responses; file and process APIs use an in-memory harness.
function harness({ file = null, status = 200, body = MODELS, siteHtml = null, iconStatus = 200, magic = PNG, failStagedFileChmod = false } = {}) {
  const files = new Map();
  if (file !== null) files.set(PROVIDERS, file);
  globalThis.__herdrFiles = files;
  const calls = [];
  globalThis.__herdrExec = async (command, args) => {
    calls.push([command, ...args]);
    if (command === "mktemp") return { code: 0, stdout: `${args.at(-1).replace(/XXXXXX$/, "fixture")}\n`, stderr: "" };
    if (command === "curl" && args.includes("-o")) {
      if (iconStatus === 200) files.set(args[args.indexOf("-o") + 1], "image");
      return { code: 0, stdout: `\n${iconStatus}`, stderr: "" };
    }
    if (command === "curl") {
      // /models carries the bearer header; an icon HTML hunt does not.
      if (args.includes("-H")) return { code: 0, stdout: body ? `${body}\n${status}` : `\n${status}`, stderr: "" };
      return { code: 0, stdout: siteHtml ?? `\n${status}`, stderr: "" };
    }
    if (command === "xxd") return { code: 0, stdout: `${magic}\n`, stderr: "" };
    if (command === "chmod" && failStagedFileChmod && args[0] === "600" && args[1]?.endsWith("/model-providers.json")) {
      return { code: 1, stdout: "", stderr: "permission denied" };
    }
    if (command === "python3" && args[0] === "-c") {
      const [, , _lock, target, staged, expectedFile, absent] = args;
      if (absent === "1" ? files.has(target) : files.get(target) !== files.get(expectedFile)) {
        return { code: 1, stdout: "provider file changed", stderr: "" };
      }
      files.set(target, files.get(staged));
      return { code: 0, stdout: "", stderr: "" };
    }
    if (command === "sips") {
      files.set(args[args.indexOf("--out") + 1], "converted");
      return { code: 0, stdout: "", stderr: "" };
    }
    if (command === "mv") {
      files.set(args.at(-1), files.get(args.at(-2)));
      files.delete(args.at(-2));
    }
    if (command === "rm") {
      for (const path of args.slice(1).filter((part) => !part.startsWith("-"))) {
        files.delete(path);
        for (const saved of files.keys()) if (saved.startsWith(`${path}/`)) files.delete(saved);
      }
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const cx = { notify() {} };
  const page = Object.create(AgentManager.prototype);
  Object.assign(page, {
    providers: {},
    providersError: null,
    cards: new Map(),
    providerHealth: new Map(),
    providerChecks: new Set(),
    adding: null,
    providerText: undefined,
    providerWrittenAt: 0,
    typing: false,
  });
  if (file !== null) page.applyProviders = AgentManager.prototype.applyProviders;
  return { page, files, calls, cx };
}

// A card as makeCard builds it, with plain fields in place of the editor inputs.
const cardOf = (over = {}) => ({
  id: null,
  open: true,
  touched: false,
  testing: false,
  status: null,
  replacing: false,
  reveal: false,
  autoName: "",
  iconWork: Promise.resolve(),
  name: field("oMLX"),
  host: field("http://127.0.0.1:8000/v1/"),
  key: field(KEY),
  link: field(OMLX_LINK),
  fetched: { link: "", path: "" },
  ...over,
});

const savedRecord = (over = {}) => ({
  name: "oMLX",
  host: "http://127.0.0.1:8000/v1",
  apiKey: KEY,
  link: OMLX_LINK,
  iconPath: `${ICON_DIR}icon-old.png`,
  verifiedAt: "2026-11-22T10:00:00.000Z",
  models: ["mlx-community--LFM2-VL-450M-4bit"],
  selectedModel: { codex: "mlx-community--LFM2-VL-450M-4bit" },
  ...over,
});
const fileOf = (providers) => `${JSON.stringify(providers, null, 2)}\n`;
const stored = (files) => JSON.parse(files.get(PROVIDERS));

test("a passing test writes the record, fixes the mode and saves the icon under a new name", async () => {
  const { page, files, calls, cx } = harness();
  const card = cardOf();
  await page.saveCard(card, cx);
  const record = stored(files).omlx;
  assert.equal(record.name, "oMLX");
  assert.equal(record.host, "http://127.0.0.1:8000/v1"); // the trailing slash is gone
  assert.equal(record.apiKey, KEY);
  assert.equal(record.link, OMLX_LINK);
  assert.deepEqual(record.models, ["mlx-community--LFM2-VL-450M-4bit", "b"]);
  assert.deepEqual(record.modelInfo, { "mlx-community--LFM2-VL-450M-4bit": { contextWindow: 65536, maxTokens: 8192 } });
  const testRequest = calls.find((call) => call[0] === "curl" && call.includes("-H"));
  assert.ok(testRequest);
  assert.equal(testRequest[1], "-q");
  assert.equal(testRequest.some((arg) => arg.includes(KEY)), false, "the API key is not a process argument");
  assert.match(record.iconPath, /^\/home\/provider-icons\/icon-[a-z0-9]+\.png$/);
  assert.ok(files.has(record.iconPath));
  assert.equal(card.status.tone, "done");
  assert.equal(card.id, "omlx");
  assert.ok(calls.some((call) => call[0] === "chmod" && call[1] === "600"));
  assert.ok(calls.some((call) => call[0] === "chmod" && call[1] === "600" && call[2]?.endsWith("/model-providers.json")));
  assert.ok(calls.some((call) => call[0] === "curl" && call.at(-1) === "https://github.com/jundot.png?size=64"));
});

test("a failed test writes nothing", async () => {
  for (const status of [401, 403, 404, 0]) {
    const { page, files, calls, cx } = harness({ file: "{}\n", status });
    const card = cardOf();
    await page.saveCard(card, cx);
    assert.equal(files.get(PROVIDERS), "{}\n", `status ${status} must not write`);
    assert.equal(card.status.tone, "blocked");
    assert.ok(["Key rejected", "No /models at this host", "Cannot connect"].includes(card.status.text));
    assert.ok(calls.some((call) => call[0] === "chmod" && call[2]?.endsWith("/headers")), "the temporary curl headers are private");
    assert.equal(calls.some((call) => call[0] === "chmod" && call[2] === PROVIDERS), false, "a failed test never writes the provider file");
    assert.equal(calls.some((call) => call[0] === "xxd"), false, "no icon is fetched for a server that failed");
  }
});

test("a 200 that is not a model server writes nothing", async () => {
  const { page, files, cx } = harness({ body: "<html>hello</html>" });
  const card = cardOf();
  await page.saveCard(card, cx);
  assert.equal(files.has(PROVIDERS), false);
  assert.equal(card.status.text, "Not a model server");
});

test("a bad link or host stops before any request", async () => {
  const { page, files, calls, cx } = harness();
  const badLink = cardOf({ link: field("http://example.com") });
  await page.saveCard(badLink, cx);
  assert.match(badLink.status.text, /Enter a link/);
  const badHost = cardOf({ host: field("nope") });
  await page.saveCard(badHost, cx);
  assert.match(badHost.status.text, /Enter a host/);
  const noKey = cardOf({ key: field("  ") });
  await page.saveCard(noKey, cx);
  assert.equal(noKey.status.text, "Enter the API key.");
  assert.equal(files.has(PROVIDERS), false);
  assert.equal(calls.length, 0);
});

test("an icon in PNG or JPEG is kept, an .ico is converted, an HTML error page is not", async () => {
  for (const magic of [PNG, "ffd8ffdb00840008"]) {
    const { page, files, cx } = harness({ magic });
    await page.saveCard(cardOf(), cx);
    assert.ok(files.has(stored(files).omlx.iconPath), magic);
  }
  const ico = harness({ magic: "0000010001001010" });
  await ico.page.saveCard(cardOf(), ico.cx);
  assert.equal(ico.files.get(stored(ico.files).omlx.iconPath), "converted");
  assert.ok(ico.calls.some((call) => call[0] === "sips"));
  const html = harness({ magic: "3c68746d6c3e0a" });
  await html.page.saveCard(cardOf(), html.cx);
  assert.equal(stored(html.files).omlx.iconPath, "");
});

test("a site link takes the site's favicon", async () => {
  const { page, files, calls, cx } = harness();
  const card = cardOf({ name: field(""), link: field("https://models.example.com/docs") });
  await page.saveCard(card, cx);
  assert.ok(calls.some((call) => call[0] === "curl" && call.at(-1) === "https://models.example.com/favicon.ico"));
  assert.equal(stored(files).example.name, "example");
  assert.equal(stored(files).example.link, "https://models.example.com");
});

test("a site link takes an SVG link icon in preference to favicon", async () => {
  const siteHtml = '<html><head><link rel="icon" type="image/svg+xml" href="/logo.svg" sizes="any"></head></html>';
  const { page, files, calls, cx } = harness({ siteHtml });
  const card = cardOf({ name: field(""), link: field("https://omlx.ai/") });
  await page.saveCard(card, cx);
  assert.ok(calls.some((call) => call[0] === "curl" && call.at(-1) === "https://omlx.ai/logo.svg"), "fetched the SVG icon URL");
  assert.match(stored(files).omlx.iconPath, /^\/home\/provider-icons\/icon-[a-z0-9]+\.png$/);
  assert.ok(files.has(stored(files).omlx.iconPath));
});

test("a site link takes the first rel=icon link when there is no SVG", async () => {
  const siteHtml = '<html><head><link rel="icon" href="/a.ico"><link rel="icon" href="/b.ico"></head></html>';
  const { page, files, calls, cx } = harness({ siteHtml });
  const card = cardOf({ name: field(""), link: field("https://example.com/") });
  await page.saveCard(card, cx);
  assert.ok(calls.some((call) => call[0] === "curl" && call.at(-1) === "https://example.com/a.ico"), "fetched the first icon URL");
  assert.match(stored(files).example.iconPath, /^\/home\/provider-icons\/icon-[a-z0-9]+\.png$/);
});

test("an unsupported preferred icon falls back to the site's favicon", async () => {
  const { page } = harness();
  const card = cardOf({ name: field(""), link: field("https://omlx.ai/") });
  const attempted = [];
  page.resolveIconUrl = async () => "https://omlx.ai/logo.svg";
  page.fetchProviderIcon = async (url) => {
    attempted.push(url);
    return url.endsWith(".svg") ? null : "/home/provider-icons/favicon.png";
  };
  await page.refreshIcon(card, { link: "https://omlx.ai", iconUrl: "https://omlx.ai/favicon.ico" });
  assert.deepEqual(attempted, ["https://omlx.ai/logo.svg", "https://omlx.ai/favicon.ico"]);
  assert.equal(card.fetched.path, "/home/provider-icons/favicon.png");
});

test("a GitHub repo link takes the page's avatar image", async () => {
  const siteHtml = '<html><body><img data-component="Avatar" data-testid="github-avatar" src="https://avatars.githubusercontent.com/u/123?v=4"></body></html>';
  const { page, files, calls, cx } = harness({ siteHtml });
  const card = cardOf({ name: field(""), link: field(OMLX_LINK) });
  await page.saveCard(card, cx);
  assert.ok(calls.some((call) => call[0] === "curl" && call.at(-1) === OMLX_LINK), "fetched the repo page");
  assert.ok(calls.some((call) => call[0] === "curl" && call.at(-1) === "https://avatars.githubusercontent.com/u/123?v=4"), "fetched the avatar");
  assert.match(stored(files).omlx.iconPath, /^\/home\/provider-icons\/icon-[a-z0-9]+\.png$/);
});

test("a failed staging permission check preserves the existing provider file", async () => {
  const providers = { omlx: savedRecord() };
  const original = fileOf(providers);
  const { page, files, cx } = harness({ file: original, failStagedFileChmod: true });
  page.providers = providers;
  const card = cardOf({ id: "omlx", key: field(""), fetched: { link: OMLX_LINK, path: providers.omlx.iconPath } });
  await page.saveCard(card, cx);
  assert.equal(files.get(PROVIDERS), original);
  assert.equal(card.status.text, "Could not write model-providers.json.");
});

test("two providers save on their own and a re-test keeps the chosen model", async () => {
  const { page, files, cx } = harness();
  const first = cardOf();
  await page.saveCard(first, cx);
  const second = cardOf({ name: field("oMLX"), host: field("http://127.0.0.1:11434/v1"), link: field("") });
  await page.saveCard(second, cx);
  assert.deepEqual(Object.keys(stored(files)), ["omlx", "omlx-2"]);
  assert.equal(second.id, "omlx-2");
  assert.equal(stored(files)["omlx-2"].iconPath, "");
  // Codex picked a model for the first; testing it again keeps that pick.
  const record = stored(files);
  record.omlx.selectedModel = { codex: "b" };
  files.set(PROVIDERS, fileOf(record));
  page.providerText = files.get(PROVIDERS);
  first.key.set_value("");
  await page.saveCard(first, cx);
  assert.deepEqual(stored(files).omlx.selectedModel, { codex: "b" });
  assert.equal(stored(files)["omlx-2"].host, "http://127.0.0.1:11434/v1");
});

test("an empty key box keeps the saved key, a typed one replaces it", async () => {
  const providers = { omlx: savedRecord() };
  const { page, files, cx } = harness({ file: fileOf(providers) });
  page.providers = providers;
  const card = cardOf({ id: "omlx", key: field(""), fetched: { link: OMLX_LINK, path: providers.omlx.iconPath } });
  await page.saveCard(card, cx);
  assert.equal(stored(files).omlx.apiKey, KEY);
  card.key.set_value("new-key-9999");
  await page.saveCard(card, cx);
  assert.equal(stored(files).omlx.apiKey, "new-key-9999");
});

test("a changed link finds a new icon, saves it under a new name and deletes the old file", async () => {
  const providers = { omlx: savedRecord() };
  const { page, files, calls, cx } = harness({ file: fileOf(providers) });
  page.providers = providers;
  files.set(providers.omlx.iconPath, "old");
  const card = cardOf({ id: "omlx", key: field(""), fetched: { link: OMLX_LINK, path: providers.omlx.iconPath } });
  card.link.set_value("https://github.com/someone/else");
  await page.linkChanged(card, cx);
  assert.equal(card.fetched.link, "https://github.com/someone/else");
  assert.notEqual(card.fetched.path, providers.omlx.iconPath);
  assert.ok(files.has(providers.omlx.iconPath), "the saved icon stays until the save lands");
  await page.saveCard(card, cx);
  const record = stored(files).omlx;
  assert.equal(record.iconPath, card.fetched.path);
  assert.equal(files.has(providers.omlx.iconPath), false);
  assert.equal(calls.filter((call) => call[0] === "curl" && call.includes("-o")).length, 1, "downloaded the icon once, not again on save");
});

test("the same link is not fetched again", async () => {
  const { page, calls, cx } = harness();
  const card = cardOf({ fetched: { link: OMLX_LINK, path: `${ICON_DIR}icon-old.png` } });
  await page.linkChanged(card, cx);
  assert.equal(calls.length, 0);
});

test("a link that no longer has an icon leaves the default one", async () => {
  const providers = { omlx: savedRecord() };
  const { page, files, cx } = harness({ file: fileOf(providers), iconStatus: 404 });
  page.providers = providers;
  files.set(providers.omlx.iconPath, "old");
  const card = cardOf({ id: "omlx", key: field(""), fetched: { link: OMLX_LINK, path: providers.omlx.iconPath } });
  card.link.set_value("https://example.org");
  await page.saveCard(card, cx);
  assert.equal(stored(files).omlx.iconPath, "");
  assert.equal(files.has(providers.omlx.iconPath), false);
});

test("a link suggests a name only until one is typed", async () => {
  const { page, cx } = harness();
  const card = cardOf({ name: field("") });
  await page.linkChanged(card, cx);
  assert.equal(card.name.value(), "omlx");
  card.link.set_value("https://github.com/ollama/ollama");
  await page.linkChanged(card, cx);
  assert.equal(card.name.value(), "ollama", "the earlier suggestion is replaced");
  card.name.set_value("My Ollama");
  card.link.set_value("https://github.com/jundot/omlx");
  await page.linkChanged(card, cx);
  assert.equal(card.name.value(), "My Ollama", "a typed name stays");
});

test("delete removes one record and its icon and leaves the others", async () => {
  const providers = { omlx: savedRecord(), other: savedRecord({ name: "Other", iconPath: `${ICON_DIR}icon-other.png` }) };
  const { page, files, calls, cx } = harness({ file: fileOf(providers) });
  page.providers = providers;
  const card = cardOf({ id: "omlx", fetched: { link: OMLX_LINK, path: providers.omlx.iconPath } });
  page.cards.set("omlx", card);
  await page.deleteProvider(card, cx);
  assert.deepEqual(Object.keys(stored(files)), ["other"]);
  assert.ok(calls.some((call) => call[0] === "rm" && call.includes(providers.omlx.iconPath)));
  assert.equal(calls.some((call) => call[0] === "rm" && call.includes(providers.other.iconPath)), false);
  assert.equal(page.cards.has("omlx"), false);
});

test("delete and a re-test never remove a file outside the provider icon folder", async () => {
  const record = savedRecord({ iconPath: "/home/important.txt" });
  const gone = harness({ file: fileOf({ omlx: record }) });
  await gone.page.deleteProvider(cardOf({ id: "omlx", fetched: { link: "", path: "" } }), gone.cx);
  assert.equal(gone.calls.some((call) => call[0] === "rm" && call.includes("/home/important.txt")), false);
  const retest = harness({ file: fileOf({ omlx: record }) });
  retest.page.providers = { omlx: record };
  await retest.page.saveCard(cardOf({ id: "omlx", key: field(""), fetched: { link: OMLX_LINK, path: "/home/important.txt" } }), retest.cx);
  assert.equal(retest.calls.some((call) => call[0] === "rm" && call.includes("/home/important.txt")), false);
});

test("a read older than this page's own write never brings a deleted record back", async () => {
  const providers = { omlx: savedRecord() };
  const { page, files, cx } = harness({ file: fileOf(providers) });
  page.makeCard = (id, record) => cardOf({ id, name: field(record.name), host: field(record.host), link: field(record.link) });
  page.fillCard = () => {};
  page.applyProviders(files.get(PROVIDERS), 1);
  const card = page.cards.get("omlx");
  await page.deleteProvider(card, cx);
  assert.equal(page.cards.has("omlx"), false);
  // The page read the file just before the delete and applies just after it: that text is stale.
  assert.equal(page.applyProviders(fileOf(providers), page.providerWrittenAt - 1), false);
  assert.equal(page.cards.has("omlx"), false);
  // A read that started after the write is news, and it does apply.
  assert.equal(page.applyProviders(fileOf(providers), page.providerWrittenAt + 1), true);
  assert.equal(page.providers.omlx.host, "http://127.0.0.1:8000/v1");
});

test("an older record that kept only a GitHub owner still shows its link", () => {
  const { page } = harness();
  page.makeCard = (id, record) => cardOf({ id, link: field(record.githubOwner) });
  page.fillCard = () => {};
  page.applyProviders(fileOf({ omlx: { name: "oMLX", host: "http://127.0.0.1:8000/v1", apiKey: KEY, githubOwner: "jundot", models: ["a"] } }));
  assert.ok(page.cards.has("omlx"));
});

test("the Model providers page draws a card for each provider and a way to add one", () => {
  const { page } = harness();
  page.providersPage = true;
  page.providers = { omlx: savedRecord() };
  page.cards.set("omlx", cardOf({ id: "omlx", open: false, fetched: { link: OMLX_LINK, path: "" } }));
  page.selectedProviderId = "omlx";
  const text = JSON.stringify(page.render()?.__node ?? page.render());
  assert.ok(text.includes("Model providers"));
  assert.ok(text.includes("oMLX"));
  assert.ok(text.includes("Check health"));
  assert.ok(text.includes("Edit provider"));
  assert.equal(text.includes("Official support"), false);
});

test("an icon path that climbs out of the icon folder is never removed", async () => {
  for (const iconPath of [`${ICON_DIR}../model-providers.json`, `${ICON_DIR}sub/x.png`, ICON_DIR]) {
    const record = savedRecord({ iconPath });
    const { page, calls, cx } = harness({ file: fileOf({ omlx: record }) });
    await page.deleteProvider(cardOf({ id: "omlx", fetched: { link: "", path: "" } }), cx);
    assert.equal(calls.some((call) => call[0] === "rm" && call.includes(iconPath)), false, iconPath);
  }
});

test("delete does nothing while that card is saving", async () => {
  const providers = { omlx: savedRecord() };
  const { page, files, cx } = harness({ file: fileOf(providers) });
  page.providers = providers;
  await page.deleteProvider(cardOf({ id: "omlx", testing: true }), cx);
  assert.deepEqual(Object.keys(stored(files)), ["omlx"]);
});

test("a failed staging permission check keeps the new provider draft for retry", async () => {
  const { page, files, cx } = harness({ failStagedFileChmod: true });
  page.adding = cardOf();
  const card = page.adding;
  await page.saveCard(card, cx);
  assert.equal(card.id, null);
  assert.equal(page.cards.has("omlx"), false);
  assert.equal(page.adding, card);
  assert.equal(files.has(PROVIDERS), false);
  assert.equal(card.status.tone, "blocked");
  assert.equal(card.status.text, "Could not write model-providers.json.");
});
