import { it, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Context, KeyEvent } from "gpui-kit";
import { fileURLToPath } from "node:url";

type Call = [string, unknown[]];
type RecordNode = { n: string; a: unknown[]; c: Call[] };
type Node = { name: string; calls: Call[]; __node: RecordNode };
type Handler = (...args: unknown[]) => unknown;
type Pane = Record<string, unknown>;
type Scenario = {
  props: unknown;
  panes?: Pane[];
  light?: boolean;
  picked?: string | null;
};

const state = vi.hoisted(() => ({
  calls: [] as unknown[][],
  props: undefined as unknown,
  panes: undefined as Pane[] | undefined,
  picked: undefined as string | null | undefined,
  folderResult: null as Promise<string | null> | null,
  light: false,
  handlers: [] as Array<[string, Handler]>,
}));

function clean(value: unknown): unknown {
  if (typeof value === "function") return "fn";
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    const node = (value as Partial<Node>).__node;
    if (node) return node;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  }
  return value;
}

function plain(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) => (typeof item === "function" ? "fn" : item)),
  ) as unknown;
}

function builder(name: string, args: unknown[] = []): Node {
  const rec: RecordNode = { n: name, a: args.map(clean), c: [] };
  const node: Node = { name, calls: [], __node: rec };
  let proxy: Node;
  proxy = new Proxy(node, {
    get(target, key: string | symbol) {
      if (key === "__node") return rec;
      if (typeof key === "symbol" || key === "toJSON") return undefined;
      if (key in target) return target[key as keyof Node];
      return (...args: unknown[]) => {
        if (key === "when") {
          if (args[0]) {
            const result = (args[1] as (element: Node) => Node)(proxy);
            if (result !== proxy) rec.c.push(["when", [clean(result)]]);
          }
          return proxy;
        }
        if (String(key).startsWith("on_")) {
          state.handlers.push([String(key), args[0] as Handler]);
        }
        const values = args.map(clean);
        node.calls.push([String(key), values]);
        rec.c.push([String(key), values]);
        return proxy;
      };
    },
  });
  return proxy;
}

vi.mock("gpui-kit", () => ({
  View: class {},
  div: (...args: unknown[]) => builder("div", args),
  svg: (...args: unknown[]) => builder("svg", args),
}));
vi.mock("gpui-base", () => ({
  v_flex: (...args: unknown[]) => builder("v_flex", args),
  h_flex: (...args: unknown[]) => builder("h_flex", args),
}));
vi.mock("herdr", () => ({
  props: () => state.props,
  panes: () => state.panes,
  theme: () => ({
    appearance: state.light ? "light" : "dark",
    foreground: "fg",
    popover: "pop",
    selected: "sel",
    muted: "mu",
    border: "bd",
  }),
  run: (...args: unknown[]) => state.calls.push(["run", ...args]),
  closeOverlay: (id: string) => state.calls.push(["closeOverlay", id]),
  pickFolder: async (options: unknown) => {
    state.calls.push(["pickFolder", options]);
    if (state.folderResult) return await state.folderResult;
    return state.picked === undefined ? "/picked" : state.picked;
  },
}));

import SplitMenu from "../../../src/mods/orca-split-menu/main.ts";

const pane = (id: string, tab: string, more: Record<string, unknown> = {}): Pane => ({
  pane: id,
  tab,
  ...more,
});

const SCENARIOS: Record<string, Scenario> = {
  "two panes, target given": {
    props: { overlay: "ov", target: { pane: "b" } },
    panes: [pane("a", "t", { focused: true }), pane("b", "t")],
  },
  "two panes, zoomed focus": {
    props: { overlay: "ov" },
    panes: [pane("a", "t", { focused: true, zoomed: true }), pane("b", "t"), pane("c", "u")],
  },
  "one pane": { props: { overlay: "ov" }, panes: [pane("a", "t", { focused: true })] },
  "unknown target falls back to focus": {
    props: { overlay: "ov", target: { pane: "zz" } },
    panes: [pane("a", "t"), pane("b", "t", { focused: true })],
    light: true,
  },
  "no focus, no target": { props: undefined, panes: [pane("a", "t"), pane("b", "t")] },
  "no panes": { props: { overlay: "ov" }, panes: [] },
  "panes unavailable": { props: { overlay: "ov" }, panes: undefined, picked: null },
};

const KEYS = [
  { key: "down" },
  { key: "up" },
  { key: "home" },
  { key: "end" },
  { key: "enter" },
  { key: "space" },
  { key: "escape" },
  ...["1", "2", "3", "4", "r", "l", "d", "u", "f", "c", "o", "7", "8", "9", "0", "z", "x", "q"].map(
    (key) => ({ key }),
  ),
  ...["F", "C", "O"].map((key) => ({ key, modifiers: { shift: true } })),
  { key: "f", modifiers: { shift: true } },
  { key: "C" },
  { key: "Z", modifiers: { shift: false } },
];

function start(
  scenario: Scenario,
  effects: unknown[][],
): {
  menu: SplitMenu;
  cx: Context;
  handlers: Array<[string, Handler]>;
  jobs: Array<Promise<void>>;
} {
  state.calls = effects;
  state.props = scenario.props;
  state.panes = scenario.panes;
  state.picked = scenario.picked;
  state.folderResult = null;
  state.light = Boolean(scenario.light);
  state.handlers = [];
  const jobs: Array<Promise<void>> = [];
  const cx = {
    notify: () => effects.push(["notify"]),
    spawn: (job: () => Promise<void>) => jobs.push(job()),
    focus_handle: () => ({ focus: () => effects.push(["focus"]) }),
  } as unknown as Context;
  const menu = new SplitMenu();
  menu.init({}, cx);
  return { menu, cx, handlers: state.handlers, jobs };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha1")
    .update(JSON.stringify(canonical(plain(value))))
    .digest("hex");
}

function summary(
  results: Record<string, Record<string, unknown>>,
): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(results).map(([scenario, sections]) => [
      scenario,
      Object.fromEntries(
        Object.entries(sections).map(([section, value]) => [section, hash(value)]),
      ),
    ]),
  );
}

async function settle(jobs: Array<Promise<void>>): Promise<void> {
  await Promise.all(jobs.splice(0));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function record(scenario: Scenario): Promise<Record<string, unknown>> {
  const output: Record<string, unknown> = {};
  const first = start(scenario, []);
  const rows = first.menu.items();
  output.rows = rows;
  output.render = [];
  for (const at of [0, 3, 99]) {
    first.menu.at = at;
    first.handlers.length = 0;
    const tree = first.menu.render() as unknown as Node;
    (output.render as unknown[][]).push([hash(tree.__node), first.menu.at]);
  }
  output.keys = [];
  for (const press of KEYS) {
    for (const at of [0, rows.length - 1]) {
      const effects: unknown[][] = [];
      const current = start(scenario, effects);
      current.menu.at = Math.max(at, 0);
      current.handlers.length = 0;
      current.menu.render();
      effects.length = 0;
      const handler = current.handlers.find(([name]) => name === "on_key_down")?.[1];
      assert.ok(handler);
      handler(press as KeyEvent, current.cx);
      await settle(current.jobs);
      (output.keys as unknown[][]).push([
        press.key,
        press.modifiers?.shift ?? null,
        at,
        current.menu.at,
        plain(effects),
      ]);
    }
  }
  output.choose = [];
  for (let i = 0; i <= rows.length; i++) {
    const effects: unknown[][] = [];
    const current = start(scenario, effects);
    effects.length = 0;
    current.menu.choose(i, current.cx);
    await settle(current.jobs);
    (output.choose as unknown[][]).push(plain(effects));
  }
  const effects: unknown[][] = [];
  const current = start(scenario, effects);
  current.handlers.length = 0;
  current.menu.render();
  effects.length = 0;
  const hover = current.handlers.filter(([name]) => name === "on_hover").map(([, fn]) => fn);
  const click = current.handlers.filter(([name]) => name === "on_click").map(([, fn]) => fn);
  if (hover.length) {
    hover[hover.length - 1](false, current.cx);
    hover[hover.length - 1](true, current.cx);
    output.hover = [current.menu.at, plain(effects)];
  }
  if (click.length) {
    effects.length = 0;
    click[0]({}, current.cx);
    await settle(current.jobs);
    output.click = plain(effects);
  }
  return output;
}

it("matches the seven legacy menu layouts across rendered rows, keys, choices, hover and click", async () => {
  const actual: Record<string, Record<string, unknown>> = {};
  for (const [name, scenario] of Object.entries(SCENARIOS)) actual[name] = await record(scenario);
  const expected = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../mods/orca-split-menu/menu.golden.json", import.meta.url)),
      "utf8",
    ),
  ) as Record<string, Record<string, string>>;
  assert.equal(Object.keys(actual).length, 7);
  assert.deepEqual(summary(actual), expected);
  for (const value of Object.values(actual)) {
    assert.equal((value.render as unknown[][]).length, 3);
    assert.equal((value.keys as unknown[][]).length, KEYS.length * 2);
    assert.equal((value.choose as unknown[][]).length, (value.rows as unknown[]).length + 1);
  }
});

it("passes absent overlay props through direct choice, keyboard selection and click", () => {
  const effects: unknown[][] = [];
  const { menu, cx, handlers } = start({ props: undefined, panes: [] }, effects);
  effects.length = 0;
  menu.choose(0, cx);
  assert.deepEqual(effects, [
    ["closeOverlay", undefined],
    ["run", "pane.split", { direction: "right", pane: undefined }],
  ]);
  effects.length = 0;
  menu.onKey({ key: "escape" } as KeyEvent, cx, menu.items());
  assert.deepEqual(effects, [["closeOverlay", undefined]]);
  handlers.length = 0;
  menu.render();
  effects.length = 0;
  const firstClick = handlers.filter(([name]) => name === "on_click")[0]?.[1];
  assert.ok(firstClick);
  firstClick({}, cx);
  assert.deepEqual(effects, [
    ["closeOverlay", undefined],
    ["run", "pane.split", { direction: "right", pane: undefined }],
  ]);
});

it("passes folder prompts, cancellation and deferred folder selection through the picker", async () => {
  const canceled: unknown[][] = [];
  const cancel = start(
    { props: { overlay: "ov" }, panes: [pane("a", "t")], picked: null },
    canceled,
  );
  canceled.length = 0;
  cancel.menu.choose(8, cancel.cx);
  await settle(cancel.jobs);
  assert.deepEqual(canceled, [
    ["closeOverlay", "ov"],
    ["pickFolder", { prompt: "Choose folder for split terminal (right)" }],
  ]);

  const deferred: unknown[][] = [];
  const current = start({ props: { overlay: "ov" }, panes: [pane("a", "t")] }, deferred);
  let finish!: (folder: string | null) => void;
  state.folderResult = new Promise((resolve) => {
    finish = resolve;
  });
  deferred.length = 0;
  current.menu.choose(9, current.cx);
  assert.deepEqual(deferred, [
    ["closeOverlay", "ov"],
    ["pickFolder", { prompt: "Choose folder for split terminal (down)" }],
  ]);
  finish("/deferred");
  await settle(current.jobs);
  assert.deepEqual(deferred.at(-1), [
    "run",
    "pane.split",
    { direction: "down", pane: "a", folder: "/deferred" },
  ]);
});

it("targets the selected pane for left and up swaps", () => {
  for (const [id, direction] of [
    ["split-left", "right"],
    ["split-up", "down"],
  ] as const) {
    const effects: unknown[][] = [];
    const { menu, cx } = start(SCENARIOS["two panes, target given"], effects);
    menu.choose(
      menu.items().findIndex((row) => row.id === id),
      cx,
    );
    assert.deepEqual(
      effects.filter(([name]) => name === "run"),
      [
        ["run", "pane.split", { direction, pane: "b" }],
        ["run", "pane.swap", { direction, pane: "b" }],
      ],
    );
  }
});
