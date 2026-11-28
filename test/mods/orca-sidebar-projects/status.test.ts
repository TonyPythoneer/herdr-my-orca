import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { callsOf } from "../../stubs/gpui-kit.js";
import {
  STATUS_COLORS,
  agentStateMark,
  statusMark,
} from "../../../src/mods/orca-sidebar-projects/status.js";

type Element = object;

const first = (element: Element, name: string): unknown[] | undefined =>
  callsOf(element).find(([call]) => call === name)?.[1];

const childOf = (element: Element): Element => first(element, "child")?.[0] as Element;

const pathOf = (element: Element): unknown => (element as { args: unknown[] }).args[0];

const fill = (element: Element): unknown => first(element, "bg")?.[0];

test("card status marks: blocked is the question glyph filling the box", () => {
  const mark = statusMark("blocked") as Element;
  assert.deepEqual(first(mark, "size"), [12]);
  const glyph = childOf(mark);
  assert.equal(pathOf(glyph), "mods/orca-assets/message-circle-question.svg");
  assert.deepEqual(first(glyph, "text_color"), [STATUS_COLORS.blocked]);
});

test("card status marks: working is the spinning 8px ring, one turn a second", () => {
  const glyph = childOf(statusMark("working") as Element);
  assert.equal(pathOf(glyph), "mods/orca-assets/agent-working-spinner.svg");
  assert.deepEqual(first(glyph, "size"), [12]);
  assert.deepEqual(first(glyph, "spin"), [1000]);
  assert.deepEqual(first(glyph, "text_color"), [STATUS_COLORS.working]);
});

test("card status marks: done and idle are dots, emerald for both done and idle", () => {
  const done = childOf(statusMark("done") as Element);
  assert.deepEqual(first(done, "size"), [8]);
  assert.deepEqual(first(done, "rounded_full"), []);
  assert.equal(fill(done), STATUS_COLORS.done);
  assert.equal(fill(childOf(statusMark("idle") as Element)), STATUS_COLORS.done);
});

test("card status marks: unknown states are a grey dot, and box size is configurable", () => {
  const mark = statusMark("unopened", 16) as Element;
  assert.deepEqual(first(mark, "size"), [16]);
  assert.equal(fill(childOf(mark)), STATUS_COLORS.idle);
});

test("card status marks take a custom palette, falling back to the defaults", () => {
  const custom = { blocked: "#111111", working: "#222222", done: "#333333" } as const;
  assert.deepEqual(first(childOf(statusMark("blocked", 12, custom) as Element), "text_color"), [
    "#111111",
  ]);
  assert.deepEqual(first(childOf(statusMark("working", 12, custom) as Element), "text_color"), [
    "#222222",
  ]);
  assert.equal(fill(childOf(statusMark("done", 12, custom) as Element)), "#333333");
  assert.equal(fill(childOf(statusMark("idle", 12, custom) as Element)), "#333333");
  assert.deepEqual(first(childOf(statusMark("blocked", 12, {}) as Element), "text_color"), [
    STATUS_COLORS.blocked,
  ]);
  assert.equal(fill(childOf(statusMark("done", 12, {}) as Element)), STATUS_COLORS.done);
  assert.equal(fill(childOf(statusMark("unopened", 12, null) as Element)), STATUS_COLORS.idle);
  assert.deepEqual(first(childOf(statusMark("working", 12, null) as Element), "text_color"), [
    STATUS_COLORS.working,
  ]);
});

test("agent row marks: each state at the 10px agent box", () => {
  const blocked = childOf(agentStateMark("blocked") as Element);
  assert.equal(pathOf(blocked), "mods/orca-assets/message-circle-question.svg");
  assert.deepEqual(first(blocked, "size"), [10]);

  const working = childOf(agentStateMark("working") as Element);
  assert.equal(pathOf(working), "mods/orca-assets/agent-working-spinner.svg");
  assert.deepEqual(first(working, "size"), [6]);
  assert.deepEqual(first(working, "spin"), [1000]);

  const done = childOf(agentStateMark("done") as Element);
  assert.equal(pathOf(done), "mods/orca-assets/circle-check.svg");
  assert.deepEqual(first(done, "size"), [10]);
  assert.deepEqual(first(done, "text_color"), [STATUS_COLORS.done]);

  const idle = childOf(agentStateMark("idle") as Element);
  assert.deepEqual(first(idle, "size"), [6]);
  assert.equal(fill(idle), STATUS_COLORS.idle);
});

test("agent row marks resolve a custom or unknown state through the palette", () => {
  assert.equal(fill(childOf(agentStateMark("idle", {}) as Element)), STATUS_COLORS.idle);
  assert.equal(
    fill(childOf(agentStateMark("waiting", { waiting: "#abcdef" }) as Element)),
    "#abcdef",
  );
  assert.equal(fill(childOf(agentStateMark("idle", { idle: "#123456" }) as Element)), "#123456");
  assert.equal(fill(childOf(agentStateMark("unknown", { idle: "#654321" }) as Element)), "#654321");
  assert.equal(
    pathOf(childOf(agentStateMark("done", null) as Element)),
    "mods/orca-assets/circle-check.svg",
  );
  assert.equal(
    first(childOf(agentStateMark("blocked", null) as Element), "text_color")?.[0],
    STATUS_COLORS.blocked,
  );
  assert.equal(fill(childOf(agentStateMark("unknown", null) as Element)), STATUS_COLORS.idle);
});
