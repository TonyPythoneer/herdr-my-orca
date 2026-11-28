import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  callSet,
  firstDifference,
  pairs,
  parseDump,
  parseInvocation,
  runGoldenDiff,
  semantic,
  strict,
} from "../../src/tooling/golden-diff.ts";

type Tree = null | boolean | number | string | Tree[] | { [key: string]: Tree };
const button = (id: string, calls: [string, Tree[]][]): Tree => ({
  n: "div",
  a: [],
  c: [["id", [id]], ...calls],
});
const row = (...children: Tree[]): Tree => ({
  n: "h_flex",
  a: [],
  c: children.map((child) => ["child", [child]]),
});

it("semantic mode ignores call order and reports added calls", () => {
  const base = row(
    button("x", [
      ["flex", []],
      ["rounded", [6]],
    ]),
  );
  const reordered = row(
    button("x", [
      ["rounded", [6]],
      ["flex", []],
    ]),
  );
  assert.equal(semantic("t", base, reordered).same, true);
  const added = row(
    button("x", [
      ["flex", []],
      ["rounded", [6]],
      ["role", ["button"]],
    ]),
  );
  const result = semantic("t", base, added);
  assert.equal(result.same, false);
  assert.deepEqual(result.onlyNow, ['x role["button"]']);
  assert.deepEqual(result.onlyBase, []);
});

it("strict mode finds the first order-sensitive difference and its element", () => {
  const a = row(
    button("x", [
      ["flex", []],
      ["rounded", [6]],
    ]),
  );
  const b = row(
    button("x", [
      ["rounded", [6]],
      ["flex", []],
    ]),
  );
  assert.equal(strict("t", a, a).first, null);
  const first = strict("t", a, b).first;
  assert.equal(first?.id, "x");
  assert.match(first?.what ?? "", /call #1/);
});

it("callSet follows children and keeps the element id on each call", () => {
  const set = callSet(row(button("a", [["flex", []]]), button("b", [["flex", []]])));
  assert.deepEqual([...set.keys()].sort(), ["a flex[]", 'a id["a"]', "b flex[]", 'b id["b"]']);
});

it("parseDump reads one JSON value and back-to-back JSON objects", () => {
  assert.deepEqual(parseDump('{"a":1}'), { a: 1 });
  assert.deepEqual(parseDump('{\n "a": 1\n}\n{\n "a": 2\n}\n'), [{ a: 1 }, { a: 2 }]);
});

it("identical trees compare equal in both modes", () => {
  const tree = row(button("x", [["flex", []]]));
  assert.equal(firstDifference(tree, tree), null);
  assert.equal(semantic("t", tree, tree).same, true);
});

it("noid mode counts calls by content when an element is renamed", () => {
  const base = row(button("x", [["flex", []]]));
  const now = row(
    button("x", [
      ["flex", []],
      ["role", ["button"]],
    ]),
  );
  const renamed = row({
    n: "div",
    a: [],
    c: [
      ["flex", []],
      ["role", ["button"]],
    ],
  });
  assert.equal(semantic("t", base, renamed, false).same, false);
  assert.deepEqual(semantic("t", base, renamed, false).onlyNow, ['role["button"]']);
  assert.equal(semantic("t", base, now, false).onlyNow.length, 1);
});

it("strict mode finds a difference on a keyed record, not only on c", () => {
  const found = firstDifference({ plain: [["close", "o"]] }, { plain: [["close", "x"]] });
  assert.equal(found?.a, "o");
  assert.equal(found?.b, "x");
});

it("added or removed golden cases are compared rather than truncated", () => {
  const before = [{ name: "a", trees: { value: 1 } }];
  const after = [...before, { name: "new", trees: { value: 2 } }];
  assert.deepEqual(pairs(before, after).at(-1), ["new", undefined, { value: 2 }]);
  assert.deepEqual(pairs(after, before).at(-1), ["new", { value: 2 }, undefined]);
  const added = pairs(before, after).at(-1);
  assert.ok(added && strict(...added).first);
});

it("strict mode reaches later children of a children call", () => {
  const before = {
    n: "div",
    c: [["children", [button("one", []), button("two", [["flex", []]])]]],
  };
  const after = {
    n: "div",
    c: [["children", [button("one", []), button("two", [["rounded", [6]]])]]],
  };
  assert.equal(firstDifference(before, after)?.id, "two");
});

it("strict mode detects a changed container shape", () => {
  assert.ok(firstDifference([1], { 0: 1 }));
});

it("keyed paths handle missing intermediate values", () => {
  assert.deepEqual(pairs({ a: null }, { a: { b: 1 } }, ["a.b"]), [["a.b", undefined, 1]]);
});

it("keyed paths stop at null and scalar intermediates and traverse numeric array indices", () => {
  const before = { nil: null, scalar: 4, array: [{ value: 1 }] };
  const after = { nil: { value: 2 }, scalar: { value: 3 }, array: { value: 4 } };
  assert.deepEqual(
    pairs(before, after, ["nil.value", "scalar.value", "array.value", "array.0.value"]),
    [
      ["nil.value", undefined, 2],
      ["scalar.value", undefined, 3],
      ["array.value", undefined, 4],
      ["array.0.value", 1, undefined],
    ],
  );
  assert.deepEqual(pairs(before, before, ["array.0.value"]), [["array.0.value", 1, 1]]);
  assert.deepEqual(pairs(before, after, ["nil", "scalar"]), [
    ["nil", null, { value: 2 }],
    ["scalar", 4, { value: 3 }],
  ]);
});

it("array cases prefer the base name and fall back to the case when trees is null", () => {
  const before = [{ name: "before", trees: null, value: 1 }];
  const after = [{ name: "after", trees: { value: 2 } }];
  assert.deepEqual(pairs(before, after), [["before", before[0], { value: 2 }]]);
});

it("object pairs follow base key order and append keys found only in the current dump", () => {
  assert.deepEqual(pairs({ third: 1, first: 2 }, { second: 3, third: 4 }), [
    ["third", 1, 4],
    ["first", 2, undefined],
    ["second", undefined, 3],
  ]);
});

it("unsupported pair shapes return no rows while strict mode reports shape changes", () => {
  assert.deepEqual(pairs(1, { value: 1 }), []);
  assert.deepEqual(pairs([1], { value: 1 }), []);
  assert.deepEqual(firstDifference([1], { 0: 1 }), { id: "root", a: [1], b: { 0: 1 } });
});

it("strict comparison prioritizes node shape, then calls, then keys", () => {
  const kind = firstDifference({ n: "div", c: [], value: 1 }, { n: "span", c: [], value: 2 });
  assert.deepEqual(kind, { id: "root", what: "node kind", a: "div", b: "span" });
  const call = firstDifference(
    {
      n: "div",
      c: [
        ["id", ["base"]],
        ["flex", []],
      ],
      value: 1,
    },
    {
      n: "div",
      c: [
        ["id", ["now"]],
        ["rounded", [6]],
      ],
      value: 2,
    },
  );
  assert.equal(call?.id, "base");
  assert.equal(call?.what, "call #0");
  const key = firstDifference({ z: 1, a: 1 }, { z: 2, a: 2 });
  assert.equal(key?.a, 1);
  assert.equal(key?.b, 2);
});

it("CLI parsing validates modes and collects keyed and noid options", () => {
  assert.equal(parseInvocation([]), null);
  assert.equal(parseInvocation(["unknown", "base", "now"]), null);
  assert.equal(parseInvocation(["strict", "base"]), null);
  assert.deepEqual(parseInvocation(["semantic", "base", "now", "--key", "a.b", "--noid"]), {
    mode: "semantic",
    baseFile: "base",
    nowFile: "now",
    keys: ["a.b"],
    withIds: false,
  });
});

it("CLI exits 2 for usage errors and 0 or 1 for equal or differing inputs", () => {
  const dir = mkdtempSync(join(tmpdir(), "golden-diff-test-"));
  const base = join(dir, "base.json");
  const now = join(dir, "now.json");
  try {
    writeFileSync(base, '{"value":1}');
    writeFileSync(now, '{"value":1}');
    assert.equal(runGoldenDiff([]), 2);
    assert.equal(runGoldenDiff(["strict", base, now]), 0);
    writeFileSync(now, '{"value":2}');
    assert.equal(runGoldenDiff(["strict", base, now]), 1);
    writeFileSync(base, '{"cases":[{"value":1}]}');
    writeFileSync(now, '{"cases":[{"value":2}]}');
    assert.equal(runGoldenDiff(["strict", base, now, "--key", "cases.0.value"]), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
