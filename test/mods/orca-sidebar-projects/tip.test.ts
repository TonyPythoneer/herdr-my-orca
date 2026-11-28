import { afterEach, beforeEach, test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import type { Context, Element } from "gpui-kit";
import {
  clearAgentConfigRuntime,
  agentConfigRuntime,
  setAgentConfigRuntime,
} from "../../support/agent-config-runtime.js";
import { recordedElement } from "../../stubs/gpui-recording.js";
import { tip, tipMark, type TipTheme } from "../../../src/mods/orca-sidebar-projects/tip.js";

type Rec = { n: string; a: unknown[]; c: [string, unknown[]][] };
const host = vi.hoisted(() => ({
  keys: [] as { section: string; keys: string; action: string }[],
  platform: "macos" as "macos" | "linux" | null,
}));

vi.mock("herdr", () => ({
  keys: () => host.keys,
  window: () => (host.platform ? { platform: host.platform } : null),
}));

const T: TipTheme = {
  border: "#010101",
  chrome: "#020202",
  foreground: "#030303",
  muted: "#040404",
};

type Recorded = { __node: Rec };
const nodeOf = (value: Element): Rec => (value as unknown as Recorded).__node;
const callsNamed = (node: Rec, name: string): unknown[][] =>
  node.c.filter(([call]) => call === name).map(([, args]) => args);
const argOf = (node: Rec, name: string): unknown => callsNamed(node, name)[0]?.[0];
const hasCall = (node: Rec, name: string): boolean => callsNamed(node, name).length > 0;
const trigger = (card: Rec): Rec => argOf(card, "trigger") as Rec;
const content = (card: Rec): Rec => argOf(card, "content") as Rec;
const labelOf = (node: Rec): unknown => argOf(argOf(node, "child") as Rec, "child");

const shell = (): Element => recordedElement("trigger") as unknown as Element;
const mark = (): Element => recordedElement("mark") as unknown as Element;

function bind(kind: "mac" | "linux" | "none") {
  host.platform = kind === "mac" ? "macos" : kind === "linux" ? "linux" : null;
}

beforeEach(() => {
  setAgentConfigRuntime({ key: "tip", argv: [] });
  host.keys = [];
  bind("mac");
});

afterEach(() => {
  clearAgentConfigRuntime();
});

const cardOf = (over: Partial<Parameters<typeof tip>[0]> = {}): Rec =>
  nodeOf(tip({ hot: "x", t: T, id: "x", label: "Label", trigger: shell(), ...over }));

test("a lit tip is a hover card anchored below its trigger with the given delay", () => {
  const card = cardOf();
  assert.equal(card.n, "HoverCard");
  assert.deepEqual(card.a, ["tip-x"]);
  assert.deepEqual(argOf(card, "anchor"), "bottom_center");
  assert.deepEqual(argOf(card, "open_delay"), 150);
  assert.deepEqual(argOf(card, "close_delay"), 0);
  assert.equal(trigger(card).n, "trigger");
});

test("the tip's anchor and delay follow its options", () => {
  const card = cardOf({ below: true, delay: 0 });
  assert.equal(argOf(card, "anchor"), "top_center");
  assert.equal(argOf(card, "open_delay"), 0);
});

test("a lit tip's card sits under a below trigger and above an ordinary one", () => {
  const above = content(cardOf());
  assert.deepEqual(callsNamed(above, "mb"), [[4]]);
  assert.deepEqual(callsNamed(above, "mt"), []);
  const below = content(cardOf({ below: true }));
  assert.deepEqual(callsNamed(below, "mt"), [[4]]);
  assert.deepEqual(callsNamed(below, "mb"), []);
});

test("a lit tip paints its box with the theme and shows its label", () => {
  const box = content(cardOf());
  assert.equal(box.n, "v_flex");
  assert.deepEqual(callsNamed(box, "bg"), [[T.chrome]]);
  assert.deepEqual(callsNamed(box, "border_color"), [[T.border]]);
  assert.deepEqual(callsNamed(box, "text_color"), [[T.foreground]]);
  assert.deepEqual(callsNamed(box, "text_size"), [[12]]);
  assert.deepEqual(labelOf(box), "Label");
  assert.equal(hasCall(box, "child"), true);
});

test("a tip with a key shows the label with its binding in brackets", () => {
  host.keys = [{ section: "s", keys: "cmd-shift-O", action: "new" }];
  assert.equal(labelOf(content(cardOf({ action: "new" }))), "Label (⇧⌘O)");
});

test("a tip with a hint adds the hint under the label in the muted colour", () => {
  const box = content(cardOf({ hint: "More" }));
  const hint = callsNamed(box, "child")[1][0] as Rec;
  assert.deepEqual(callsNamed(hint, "text_color"), [[T.muted]]);
  assert.deepEqual(callsNamed(hint, "child"), [["More"]]);
  assert.equal(callsNamed(box, "child").length, 2);
});

test("a tip without a hint has one child, and an empty hint adds none", () => {
  assert.equal(callsNamed(content(cardOf()), "child").length, 1);
  assert.equal(callsNamed(content(cardOf({ hint: "" })), "child").length, 1);
});

test("a tip that is not lit shows nothing", () => {
  const card = cardOf({ hot: "other" });
  assert.equal(content(card).n, "div");
  assert.equal(content(card).c.length, 0);
});

test("a binding reads per platform, with Ctrl and Super names off the Mac", () => {
  host.keys = [{ section: "s", keys: "secondary-b", action: "go" }];
  assert.equal(labelOf(content(cardOf({ action: "go" }))), "Label (⌘B)");
  bind("linux");
  assert.equal(labelOf(content(cardOf({ action: "go" }))), "Label (Ctrl+B)");
  host.keys = [{ section: "s", keys: "cmd-shift-O", action: "go" }];
  assert.equal(labelOf(content(cardOf({ action: "go" }))), "Label (Shift+Super+O)");
  bind("none");
  host.keys = [{ section: "s", keys: "ctrl-alt-k", action: "go" }];
  assert.equal(labelOf(content(cardOf({ action: "go" }))), "Label (Ctrl+Alt+K)");
});

test("a binding reads chords, super aliases, dashes, and long key names", () => {
  host.keys = [{ section: "s", keys: "ctrl-k ctrl-c", action: "chord" }];
  assert.equal(labelOf(content(cardOf({ action: "chord" }))), "Label (⌃K ⌃C)");
  host.keys = [{ section: "s", keys: "super-k", action: "chord" }];
  assert.equal(labelOf(content(cardOf({ action: "chord" }))), "Label (⌘K)");
  host.keys = [{ section: "s", keys: "cmd--", action: "chord" }];
  assert.equal(labelOf(content(cardOf({ action: "chord" }))), "Label (⌘-)");
  host.keys = [{ section: "s", keys: "escape", action: "chord" }];
  assert.equal(labelOf(content(cardOf({ action: "chord" }))), "Label (Escape)");
  host.keys = [{ section: "s", keys: "alt-shift-x", action: "chord" }];
  assert.equal(labelOf(content(cardOf({ action: "chord" }))), "Label (⌥⇧X)");
});

test("a tip with no binding for its action, or a blank one, shows the bare label", () => {
  host.keys = [{ section: "s", keys: "   ", action: "blank" }];
  assert.equal(labelOf(content(cardOf({ action: "blank" }))), "Label");
  assert.equal(labelOf(content(cardOf({ action: "missing" }))), "Label");
  assert.equal(labelOf(content(cardOf())), "Label");
});

test("a mark with no label is shown as it is, with no tip", () => {
  const plain = mark();
  const view: { hot?: string | null } = {};
  assert.equal(tipMark(view, T, { id: "m", mark: plain }), plain);
});

test("hovering a labelled mark lights its tip and leaving clears it only for that mark", () => {
  const label = mark();
  const view: { hot?: string | null } = {};
  const card = nodeOf(tipMark(view, T, { id: "m", label: "Mark", mark: label }));
  assert.equal(content(card).n, "div");
  const lit = trigger(card);
  assert.deepEqual(argOf(lit, "id"), "m");
  assert.equal(hasCall(lit, "flex_none"), true);
  assert.deepEqual(argOf(lit, "child"), nodeOf(label));

  const hover = agentConfigRuntime()?.handlers.find(
    ([name, , id]) => name === "on_hover" && id === "m",
  );
  const onHover = hover?.[1] as (on: boolean, cx: Context) => void;
  const cx = { notify: vi.fn() } as unknown as Context;
  onHover(true, cx);
  assert.equal(view.hot, "m");
  assert.equal(vi.mocked(cx.notify).mock.calls.length, 1);
  onHover(false, cx);
  assert.equal(view.hot, null);
  view.hot = "other";
  onHover(false, cx);
  assert.equal(view.hot, "other");
  assert.equal(vi.mocked(cx.notify).mock.calls.length, 3);
});

test("a labelled mark shows its tip while it is the hot one", () => {
  const label = mark();
  const card = nodeOf(
    tipMark({ hot: "m" }, T, { id: "m", label: "Mark", mark: label, hint: "Hint" }),
  );
  assert.equal(content(card).n, "v_flex");
  assert.equal(labelOf(content(card)), "Mark");
  const below = nodeOf(
    tipMark({ hot: "m" }, T, { id: "m", label: "Mark", mark: label, below: true }),
  );
  assert.deepEqual(callsNamed(content(below), "mt"), [[4]]);
});
