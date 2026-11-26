// Specification of orca-ui/shared/codex-provider.js, imported from the source (not a mod copy):
// what a pasted project link becomes, plus the host, preset, slug and key-hint rules around it.
import test from "node:test";
import assert from "node:assert/strict";
import { iconFromHtml, keyHint, linkInfo, presetFor, recordLink, slugId, validateHost } from "../orca-ui/shared/codex-provider.js";

const ERROR = { error: "Enter a link like https://github.com/owner/repo or https://example.com" };
const NONE = { link: "", name: "", iconUrl: "" };

test("linkInfo: no link is empty, not an error", () => {
  for (const text of [undefined, null, "", "   "]) assert.deepEqual(linkInfo(text), NONE);
});

test("linkInfo: a GitHub link names the repo and takes the owner's avatar", () => {
  const repo = { link: "https://github.com/o/r", name: "r", iconUrl: "https://github.com/o.png?size=64" };
  for (const text of ["https://github.com/o/r", "github.com/o/r", "https://www.github.com/o/r/", "HTTPS://GitHub.com/o/r.git", "https://github.com/o/r/tree/main"]) {
    assert.deepEqual(linkInfo(text), repo, text);
  }
  const owner = { link: "https://github.com/o", name: "o", iconUrl: "https://github.com/o.png?size=64" };
  assert.deepEqual(linkInfo("https://github.com/o"), owner);
  assert.deepEqual(linkInfo("https://github.com/o/"), owner);
  assert.deepEqual(linkInfo("https://github.com/o/bad name"), owner, "an unusable repo falls back to the owner");
  assert.deepEqual(linkInfo(`https://github.com/o/${"r".repeat(101)}`), owner, "a repo name is at most 100 characters");
  assert.equal(linkInfo(`https://github.com/o/${"r".repeat(100)}`).name, "r".repeat(100));
});

test("linkInfo: a GitHub owner must be a valid login", () => {
  assert.deepEqual(linkInfo("https://github.com/"), ERROR);
  assert.deepEqual(linkInfo("https://github.com"), ERROR);
  assert.deepEqual(linkInfo("https://github.com/-bad/r"), ERROR);
  assert.deepEqual(linkInfo("https://github.com/bad_owner/r"), ERROR);
  assert.deepEqual(linkInfo(`https://github.com/${"o".repeat(40)}/r`), ERROR, "a login is at most 39 characters");
  assert.equal(linkInfo(`https://github.com/${"o".repeat(39)}/r`).name, "r");
});

test("linkInfo: any other https link names its site and takes /favicon.ico", () => {
  assert.deepEqual(linkInfo("example.com"), { link: "https://example.com", name: "example", iconUrl: "https://example.com/favicon.ico" });
  assert.deepEqual(linkInfo("https://www.Docs.Example.com:8443/a/b?q=1"), { link: "https://www.docs.example.com:8443", name: "example", iconUrl: "https://www.docs.example.com:8443/favicon.ico" });
});

test("linkInfo: only plain https links with a dotted host are accepted", () => {
  for (const text of ["http://example.com", "ftp://example.com", "https://localhost", "https://user@example.com", "https://user:pw@example.com", "https://", "https://exa mple.com", "mailto:x@example.com"]) {
    assert.deepEqual(linkInfo(text), ERROR, text);
  }
});

test("iconFromHtml: an SVG link icon wins", () => {
  const html = '<html><head><link rel="icon" type="image/svg+xml" href="/logo.svg" sizes="any"><link rel="icon" href="/favicon.ico"></head></html>';
  assert.equal(iconFromHtml(html, "https://example.com/"), "https://example.com/logo.svg");
});

test("iconFromHtml: the first rel=icon link wins when there is no SVG", () => {
  const html = '<html><head><link rel="icon" href="/second.ico"><link rel="icon" href="/first.ico"></head></html>';
  assert.equal(iconFromHtml(html, "https://example.com/"), "https://example.com/second.ico");
});

test("iconFromHtml: a shortcut icon still counts as an icon", () => {
  const html = '<html><head><link rel="shortcut icon" href="/favicon.ico"></head></html>';
  assert.equal(iconFromHtml(html, "https://example.com/"), "https://example.com/favicon.ico");
});

test("iconFromHtml: relative hrefs resolve against the site origin", () => {
  const html = '<html><head><link rel="icon" type="image/svg+xml" href="icons/logo.svg"></head></html>';
  assert.equal(iconFromHtml(html, "https://example.com/site/"), "https://example.com/site/icons/logo.svg");
});

test("iconFromHtml: an SVG without href is skipped", () => {
  const html = '<html><head><link rel="icon" type="image/svg+xml"><link rel="icon" href="/favicon.ico"></head></html>';
  assert.equal(iconFromHtml(html, "https://example.com/"), "https://example.com/favicon.ico");
});

test("iconFromHtml: quoted attributes and unsafe URLs", () => {
  assert.equal(iconFromHtml("<link rel = 'icon' type = 'image/svg+xml' href = '/logo.svg'>", "https://example.com/"), "https://example.com/logo.svg");
  assert.equal(iconFromHtml('<link rel="icon" href="file:///etc/passwd"><link rel="icon" href="/safe.png">', "https://example.com/"), "https://example.com/safe.png");
});

test("iconFromHtml: no icon link means null", () => {
  assert.equal(iconFromHtml("<html><head></head></html>", "https://example.com/"), null);
  assert.equal(iconFromHtml("<html><head><link rel=\"stylesheet\" href=\"/a.css\"></head></html>", "https://example.com/"), null);
});

test("recordLink, presetFor, slugId, keyHint and validateHost", () => {
  assert.equal(recordLink({ link: "L", githubOwner: "o" }), "L");
  assert.equal(recordLink({ githubOwner: "o" }), "https://github.com/o");
  assert.equal(recordLink({}), "");
  assert.equal(recordLink(undefined), "");
  assert.deepEqual(presetFor("http://127.0.0.1:8000/v1"), { name: "oMLX", link: "https://github.com/jundot/omlx" });
  assert.deepEqual(presetFor("http://localhost:11434"), { name: "Ollama", link: "https://github.com/ollama/ollama" });
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
  assert.deepEqual(validateHost(" http://127.0.0.1:8000/v1// "), { host: "http://127.0.0.1:8000/v1" });
  assert.match(validateHost("ftp://x").error, /Enter a host/);
  assert.match(validateHost("http://exa mple").error, /Enter a host/);
  assert.match(validateHost("http://").error, /Enter a host/);
});
