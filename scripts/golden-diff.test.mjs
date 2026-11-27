// The dump comparer: order-insensitive for the semantic mode, order-sensitive for the strict mode.
import test from "node:test";
import assert from "node:assert/strict";
import { callSet, firstDifference, parseDump, semantic, strict } from "./golden-diff.mjs";

const button = (id, calls) => ({ n: "div", a: [], c: [["id", [id]], ...calls] });
const row = (...children) => ({ n: "h_flex", a: [], c: children.map((child) => ["child", [child]]) });

test("semantic mode ignores call order and reports added calls", () => {
  const base = row(button("x", [["flex", []], ["rounded", [6]]]));
  const reordered = row(button("x", [["rounded", [6]], ["flex", []]]));
  assert.equal(semantic("t", base, reordered).same, true);
  const added = row(button("x", [["flex", []], ["rounded", [6]], ["role", ["button"]]]));
  const r = semantic("t", base, added);
  assert.equal(r.same, false);
  assert.deepEqual(r.onlyNow, ['x role["button"]']);
  assert.deepEqual(r.onlyBase, []);
});

test("strict mode finds the first order-sensitive difference and its element", () => {
  const a = row(button("x", [["flex", []], ["rounded", [6]]]));
  const b = row(button("x", [["rounded", [6]], ["flex", []]]));
  assert.equal(strict("t", a, a).first, null);
  const first = strict("t", a, b).first;
  assert.equal(first.id, "x");
  assert.match(first.what, /call #1/); // call #0 is the id itself
});

test("callSet follows children and keeps the element id on each call", () => {
  const set = callSet(row(button("a", [["flex", []]]), button("b", [["flex", []]])));
  assert.deepEqual([...set.keys()].sort(), ['a flex[]', 'a id["a"]', 'b flex[]', 'b id["b"]']);
});

test("parseDump reads one JSON value and back-to-back JSON objects", () => {
  assert.deepEqual(parseDump('{"a":1}'), { a: 1 });
  assert.deepEqual(parseDump('{\n "a": 1\n}\n{\n "a": 2\n}\n'), [{ a: 1 }, { a: 2 }]);
});

test("identical trees compare equal in both modes", () => {
  const t = row(button("x", [["flex", []]]));
  assert.equal(firstDifference(t, t), null);
  assert.equal(semantic("t", t, t).same, true);
});

test("noid mode counts a call by its content, so a renamed element shows only what was added", () => {
  const base = row(button("x", [["flex", []]]));
  const now = row(button("x", [["flex", []], ["role", ["button"]]]));
  const renamed = row({ n: "div", a: [], c: [["flex", []], ["role", ["button"]]] });
  assert.equal(semantic("t", base, renamed, false).same, false);
  assert.deepEqual(semantic("t", base, renamed, false).onlyNow, ['role["button"]']);
  assert.equal(semantic("t", base, now, false).onlyNow.length, 1);
});
