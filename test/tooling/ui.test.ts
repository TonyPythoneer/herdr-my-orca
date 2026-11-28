import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseArgs,
  oneLine,
  quoted,
  componentLine,
  knownSources,
  references,
  cmdFind,
  cmdWhere,
  cmdMod,
  cmdOutline,
  cmdPages,
  cmdAudit,
  formatTag,
  shotPath,
  targetText,
} from "../../src/tooling/ui";
import { buildIndex } from "../../src/tooling/ui-index";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const index = await buildIndex(ROOT);

let logged: string[] = [];
const origLog = console.log;
function captureLog(): void {
  logged = [];
  console.log = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
}
function releaseLog(): void {
  console.log = origLog;
}
function getLog(): string[] {
  return logged;
}

it("parseArgs collects positional args and flags", () => {
  const f = parseArgs(["find", "toggle", "--json", "--limit", "10", "--dry-run"]);
  assert.deepEqual(f._, ["find", "toggle"]);
  assert.equal(f.json, true);
  assert.equal(f.limit, "10");
  assert.equal(f["dry-run"], true);
});

it("parseArgs handles boolean flags without values", () => {
  const f = parseArgs(["--json", "--out", "/tmp/x"]);
  assert.equal(f.json, true);
  assert.equal(f.out, "/tmp/x");
});

it("oneLine collapses whitespace and truncates", () => {
  assert.equal(oneLine("  hello   world  "), "hello world");
  assert.equal(oneLine("a".repeat(200), 10), "a".repeat(10));
  assert.equal(oneLine(undefined), "");
});

it("quoted joins non-empty values with quotes", () => {
  assert.equal(quoted(["a", undefined, "b", ""]), '"a", "b"');
  assert.equal(quoted([]), "");
});

it("componentLine formats a component with file, line, name and kind", () => {
  const item = {
    file: "mods/foo/main.js",
    line: 42,
    name: "myButton",
    kind: "control",
    ids: ["x-foo"],
    labels: ["Click me"],
    description: "A test button",
  };
  const line = componentLine(item);
  assert.match(line, /mods\/foo\/main\.js:42/);
  assert.match(line, /myButton/);
  assert.match(line, /\[control\]/);
  assert.match(line, /id x-foo/);
  assert.match(line, /"Click me"/);
});

it("knownSources returns mod files and shared helper sources", () => {
  const sources = knownSources(index);
  assert.ok(Array.isArray(sources));
  assert.ok(sources.length > 0);
});

it("references finds lines containing a needle in indexed sources", () => {
  const hits = references(index, "export function", 5);
  assert.ok(Array.isArray(hits));
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => h.includes(":")));
});

it("references returns empty for empty needle", () => {
  assert.deepEqual(references(index, ""), []);
});

it("cmdFind throws when no term is given", () => {
  assert.throws(() => cmdFind(index, { _: [] }), /find needs a term/);
});

it("cmdFind logs mod results", () => {
  captureLog();
  cmdFind(index, { _: ["orca-agent-settings"], json: false });
  releaseLog();
  assert.ok(logged.length > 0, "expected console.log output");
});

it("cmdFind outputs JSON when requested", () => {
  captureLog();
  cmdFind(index, { _: ["orca"], json: true });
  releaseLog();
  assert.ok(logged.length > 0, "expected console.log output");
  assert.ok(typeof logged[0] === "string");
});

it("cmdWhere throws when no term is given", () => {
  assert.throws(() => cmdWhere(index, { _: [] }), /where needs an id/);
});

it("cmdWhere reports no match for unknown term", () => {
  captureLog();
  cmdWhere(index, { _: ["nonexistent-thing-xyz"] });
  releaseLog();
  assert.ok(logged.length > 0, "expected console.log output");
});

it("cmdMod reports unknown mod", () => {
  captureLog();
  cmdMod(index, { _: ["nonexistent-mod"] });
  releaseLog();
  assert.ok(logged.length > 0, "expected console.log output");
});

it("cmdMod outputs mod details as JSON", () => {
  captureLog();
  cmdMod(index, { _: ["orca-header"], json: true });
  releaseLog();
  assert.ok(logged.length > 0, "expected console.log output");
});

it("cmdOutline reports unknown mod", () => {
  captureLog();
  cmdOutline(index, { _: ["nonexistent-mod"] });
  releaseLog();
  assert.ok(logged.length > 0, "expected console.log output");
});

it("cmdPages lists pages", () => {
  captureLog();
  cmdPages(index, { json: false });
  releaseLog();
  assert.ok(logged.length > 0, "expected console.log output");
});

it("cmdPages outputs JSON", () => {
  captureLog();
  cmdPages(index, { json: true });
  releaseLog();
  assert.ok(logged.length > 0, "expected console.log output");
});

it("cmdAudit produces an audit report", () => {
  captureLog();
  cmdAudit(index, { json: false });
  releaseLog();
  assert.ok(logged.length > 0, "expected console.log output");
});

it("cmdAudit outputs JSON", () => {
  captureLog();
  cmdAudit(index, { json: true });
  releaseLog();
  assert.ok(logged.length > 0, "expected console.log output");
});

it("formatTag returns empty string for no components", () => {
  assert.equal(formatTag({ components: [] }), "");
});

it("formatTag formats component references", () => {
  const tag = formatTag({
    components: [
      { id: "x-foo", name: "foo" },
      { id: null, name: "bar" },
    ],
  });
  assert.match(tag, /<- x-foo, bar/);
});

it("shotPath resolves output path", () => {
  const path = shotPath({ out: "/tmp/test-shot.png" });
  assert.equal(path, "/tmp/test-shot.png");
});

it("targetText returns the text flag when provided", () => {
  assert.equal(targetText(index, { text: "custom text" }), "custom text");
});

it("targetText returns null when no id or text", () => {
  assert.equal(targetText(index, {}), null);
});

it("targetText throws for unknown id", () => {
  assert.throws(() => targetText(index, { id: "nonexistent-id" }), /unknown id/);
});
