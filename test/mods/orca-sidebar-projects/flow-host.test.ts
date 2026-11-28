import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  control,
  event,
  type FlowNode,
} from "../../../src/mods/orca-sidebar-projects/flow-host.js";

const withId = (id: string): FlowNode => ({ c: [["id", [id]]] });

test("control finds the node carrying an id through its containers, in order", () => {
  const deep = withId("deep");
  const first = withId("first");
  const root: FlowNode = {
    c: [
      ["on_click", [withId("ignored")]],
      ["child", [{ c: [["trigger", [deep]]] }]],
      ["children", [["text", first, null], first]],
    ],
  };
  assert.equal(control(root, "deep"), deep);
  assert.equal(control(root, "first"), first);
  assert.equal(control(root, "ignored"), undefined);
  assert.equal(control(root, "missing"), undefined);
});

test("control returns the node itself when it carries the id", () => {
  const self = withId("self");
  assert.equal(control(self, "self"), self);
  assert.equal(control({ c: [["content", [withId("inner")]]] }, "inner")?.c[0][1][0], "inner");
});

test("control tolerates missing nodes and non-node children, like the legacy optional chain", () => {
  assert.equal(control(undefined, "x"), undefined);
  assert.equal(control(null, "x"), undefined);
  assert.equal(control({}, "x"), undefined);
  assert.equal(control({ c: [["child", ["text", null, 3]]] }, "x"), undefined);
});

test("control throws the legacy TypeError when c is not a list", () => {
  assert.throws(() => control({ c: "not a list" as unknown as [] }, "x"), TypeError);
});

test("event returns the handler of the first matching call", () => {
  const press = () => "pressed";
  const later = () => "later";
  const node: FlowNode = {
    c: [
      ["on_click", ["left", press]],
      ["on_click", ["right", later]],
    ],
  };
  assert.equal(event(node, "on_click"), press);
  assert.equal(event(node, "on_click", "right"), later);
});

test("event throws the legacy TypeError when no call matches", () => {
  const node: FlowNode = { c: [["on_click", ["left", () => null]]] };
  assert.throws(() => event(node, "on_hover"), {
    name: "TypeError",
    message: "Cannot read properties of undefined (reading '1')",
  });
  assert.throws(() => event(node, "on_click", "middle"), TypeError);
});
