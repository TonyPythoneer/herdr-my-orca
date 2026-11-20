// mods/orca-diff/diff.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffRows, diffLines, untrackedPreview } from "./diff-rows.js";

test("untracked preview reports omitted files", () => {
  const paths = Array.from({ length: 23 }, (_, i) => `file ${i}`);
  assert.deepEqual(untrackedPreview(paths), { paths: paths.slice(0, 20), omitted: 3 });
  assert.deepEqual(untrackedPreview(["only"]), { paths: ["only"], omitted: 0 });
});

const sample = [
  "diff --git a/a.txt b/a.txt", "index 1..2 100644", "--- a/a.txt", "+++ b/a.txt",
  "@@ -3,3 +3,3 @@ fn", " keep", "-old", "+new", " tail", "\\ No newline at end of file", "",
].join("\n");

test("numbers old lines for - and new lines for + and context", () => {
  const rows = diffRows(diffLines(sample));
  assert.deepEqual(rows.map((r) => [r.kind, r.number]), [["@", undefined], [" ", 3], ["-", 4], ["+", 4], [" ", 5], ["", undefined]]);
});

test("a second hunk restarts the numbers", () => {
  const rows = diffRows(["@@ -1 +1 @@", "-a", "+b", "@@ -10,2 +10,2 @@", " c", "-d", "+e"]);
  assert.deepEqual(rows.filter((r) => r.kind !== "@").map((r) => r.number), [1, 1, 10, 11, 11]);
});

test("binary and empty diffs have no hunk", () => {
  assert.deepEqual(diffLines("Binary files a/x and b/x differ\n"), ["Binary file · no text diff"]);
  assert.deepEqual(diffLines(""), ["No text diff available"]);
});

test("long diffs are cut with a note, tabs are padded", () => {
  const big = ["@@ -1,2000 +1,2000 @@", ...Array.from({ length: 2000 }, () => " x")].join("\n");
  const lines = diffLines(big);
  assert.equal(lines.length, 1501);
  assert.match(lines.at(-1), /cut at 1500/);
  assert.equal(diffRows(["+\tx"])[0].text, "    x");
});

test("files mode keeps each file header and drops the git preamble", () => {
  const two = ["diff --git a/a b/a", "index 1..2", "--- a/a", "+++ b/a", "@@ -1 +1 @@", "-x", "+y",
    "diff --git a/dir/b b/dir/b", "Binary files a/dir/b and b/dir/b differ"].join("\n");
  assert.deepEqual(diffRows(diffLines(two, { files: true })).map((r) => [r.kind, r.text]),
    [["F", "a"], ["@", "@@ -1 +1 @@"], ["-", "x"], ["+", "y"], ["F", "dir/b"], ["", "Binary file · no text diff"]]);
  assert.equal(diffLines(two).includes("a"), false);
});

test("file headers retain ambiguous and Git-quoted paths", () => {
  const rows = diffRows([
    "diff --git a/folder b/file.txt b/folder b/file.txt",
    'diff --git "a/line\\nbreak.txt" "b/line\\nbreak.txt"',
    'diff --git "a/quote\\"file" "b/quote\\"file"',
  ]);
  assert.deepEqual(rows.map((row) => row.text), ["folder b/file.txt", '"line\\nbreak.txt"', '"quote\\"file"']);
});
