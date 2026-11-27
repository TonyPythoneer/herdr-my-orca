// Pure helpers behind the live UI commands; the native calls themselves are exercised by hand
// on a running app, and by ui-snapshot/capture.py in CI.
import test from "node:test";
import assert from "node:assert/strict";
import { matchWords, normalize, pickWord, pointOf, readingOrder, textDiff } from "./ui-live.mjs";

const row = (text, x, y, confidence = 1) => ({ text, x, y, confidence, width: 0.05, height: 0.01 });
const rows = [
  row("Search", 0.04, 0.06),
  row("Search projects", 0.04, 0.2),
  row("Projects", 0.03, 0.1),
  row("noise", 0.5, 0.3, 0.3),
];

test("matchWords ignores low confidence and prefers an exact label", () => {
  assert.deepEqual(matchWords(rows, "search").map((item) => item.text), ["Search"]);
  assert.deepEqual(matchWords(rows, "search projects").map((item) => item.text), ["Search projects"]);
  assert.deepEqual(matchWords(rows, "noise"), []);
});

test("pickWord refuses to guess between two visible matches", () => {
  const matches = matchWords(rows, "sea");
  assert.equal(pickWord(matches, "top").y, 0.06);
  assert.equal(pickWord(matches, "bottom").y, 0.2);
  assert.throws(() => pickWord(matches), /ambiguous/);
  assert.equal(pickWord([], "top"), null);
});

test("points are normalized window coordinates", () => {
  assert.deepEqual(pointOf(row("x", 0.12345, 0.6789)), [0.123, 0.679]);
});

test("textDiff reports only the text that appeared or disappeared", () => {
  const before = [row("Agent Settings", 0, 0), row("Save", 0, 1)];
  const after = [row("Agent Settings", 0, 0), row("Saved", 0, 1)];
  assert.deepEqual(textDiff(before, after), { added: ["saved"], removed: ["save"] });
});

test("readingOrder sorts by vertical then horizontal position", () => {
  const order = readingOrder([row("b", 0.2, 0.1), row("a", 0.1, 0.1), row("c", 0.1, 0.5)]).map((item) => item.text);
  assert.deepEqual(order, ["a", "b", "c"]);
});

test("normalize collapses punctuation and case for OCR comparisons", () => {
  assert.equal(normalize("  Back to app "), "back to app");
  assert.equal(normalize("fix/sidebar-branch-tooltip"), "fix sidebar branch tooltip");
});
