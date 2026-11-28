import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vite-plus/test";
import { callsOf } from "../../stubs/gpui-kit";
import Nav from "../../../src/mods/orca-workspace-settings/main";

type Ctx = Parameters<Nav["render"]>[0];
type Theme = Parameters<Nav["menuRow"]>[2];
type KeyHandler = (event: { key: string }, cx: Ctx) => void;
type HoverHandler = (on: boolean, cx: Ctx) => void;
type ClickHandler = (event: unknown, cx: Ctx) => void;
type Hooks = {
  __herdrProps?: () => unknown;
  __herdrShared?: (key: string) => unknown;
  __herdrSetShared?: (key: string, value: unknown) => void;
  __herdrLayout?: () => unknown;
  __herdrTheme?: () => Record<string, string>;
  __herdrRun?: (...args: unknown[]) => void;
  __herdrCloseOverlay?: (id?: string) => void;
};

const host = vi.hoisted(() => ({ machines: [] as Array<{ name: string | null }> }));

vi.mock("herdr", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    machines: () => host.machines,
    pickFolder: () => Promise.resolve("/new"),
  };
});

vi.mock("gpui-base", async () => {
  const kit = await import("../../stubs/gpui-kit");
  return { v_flex: () => kit.div(), h_flex: () => kit.div() };
});

const hooks = globalThis as unknown as Hooks;
const OPTIONS_KEY = "workspace.options.v1";
const TOKENS = [
  "surface",
  "background",
  "dim",
  "border",
  "foreground",
  "muted",
  "popover",
  "selected",
  "hover",
  "accent",
  "accent_foreground",
];
const navTheme: Theme = {
  surface: "#1",
  background: "#1",
  dim: "#2",
  border: "#3",
  foreground: "#4",
  muted: "#5",
  popover: "#6",
  selected: "#7",
  hover: "#8",
  accent: "#9",
  accent_foreground: "#a",
};

let store: Map<string, string>;
let sharedValues: Map<string, unknown>;
let ran: unknown[][];
let closed: unknown[];

function storageOf(values: Map<string, string>): Storage {
  return {
    length: 0,
    clear() {},
    key: () => null,
    removeItem(key: string) {
      values.delete(key);
    },
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function themeWith(overrides: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries([
    ...TOKENS.map((token) => [token, `token(${token})`]),
    ...Object.entries(overrides),
  ]);
}

function contextOf() {
  const cx = {
    count: 0,
    focused: 0,
    notify() {
      cx.count++;
    },
    focus_handle() {
      return {
        focus() {
          cx.focused++;
        },
      };
    },
  };
  return cx;
}

function asContext(cx: ReturnType<typeof contextOf>): Ctx {
  return cx as unknown as Ctx;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function nodes(root: object): object[] {
  return [
    root,
    ...callsOf(root).flatMap(([, args]) => args.flat().filter(isObject).flatMap(nodes)),
  ];
}

function calls(root: object, name: string): unknown[][] {
  return nodes(root).flatMap((node) =>
    callsOf(node)
      .filter(([method]) => method === name)
      .map(([, args]) => args),
  );
}

function first(root: object, name: string): unknown {
  return calls(root, name)[0]?.[0];
}

function hasArg(root: object, name: string, value: unknown): boolean {
  return calls(root, name).some((args) => args[0] === value);
}

function strings(root: object): string[] {
  return nodes(root).flatMap((node) =>
    callsOf(node).flatMap(([, args]) =>
      args.filter((arg): arg is string => typeof arg === "string"),
    ),
  );
}

function nodeWith(root: object, method: string, value?: unknown): object {
  const node = nodes(root).find((candidate) =>
    callsOf(candidate).some(
      ([name, args]) => name === method && (value === undefined || args[0] === value),
    ),
  );
  assert.ok(node);
  return node;
}

function savedOptions(): Record<string, unknown> {
  return JSON.parse(store.get(OPTIONS_KEY) ?? "{}") as Record<string, unknown>;
}

beforeEach(() => {
  store = new Map();
  sharedValues = new Map([["left-sidebar.openPx", 200]]);
  ran = [];
  closed = [];
  host.machines = [];
  globalThis.localStorage = storageOf(store);
  hooks.__herdrProps = () => ({});
  hooks.__herdrShared = (key) => sharedValues.get(key);
  hooks.__herdrSetShared = (key, value) => {
    sharedValues.set(key, value);
  };
  hooks.__herdrLayout = () => ({ children: [{ id: "left-sidebar", size: { px: 120 } }] });
  hooks.__herdrTheme = () => themeWith();
  hooks.__herdrRun = (...args) => {
    ran.push(args);
  };
  hooks.__herdrCloseOverlay = (id) => {
    closed.push(id);
  };
});

test("non-hash theme tokens reach the body, the popup and the sidebar cover unchanged", () => {
  const nav = new Nav();
  const cx = contextOf();
  assert.ok(hasArg(nav.renderBody(asContext(cx)), "bg", "token(surface)"));

  hooks.__herdrProps = () => ({ navMenu: "workspace-options" });
  const menu = nav.renderBody(asContext(cx));
  assert.ok(hasArg(menu, "bg", "token(popover)"));
  assert.ok(hasArg(menu, "text_color", "token(foreground)"));
  assert.ok(hasArg(menu, "text_color", "token(muted)"));

  hooks.__herdrProps = () => ({});
  const frame = nav.render(asContext(cx));
  assert.ok(hasArg(nodeWith(frame, "absolute"), "bg", "token(surface)"));
});

test("a non-hash surface covers the sidebar as given, and a hash surface keeps its alpha", () => {
  const coverFill = (surface: string) => {
    hooks.__herdrTheme = () => themeWith({ surface });
    const frame = new Nav().render(asContext(contextOf()));
    return calls(nodeWith(frame, "absolute"), "bg")[0]?.[0];
  };
  assert.equal(coverFill("rgb(1 2 3)"), "rgb(1 2 3)");
  assert.equal(coverFill("#102030"), "#10203078");
});

test("a truthy non-string navMenu skips the sidebar frame and still takes focus on init", () => {
  hooks.__herdrProps = () => ({ navMenu: true });
  const nav = new Nav();
  const cx = contextOf();
  nav.init({}, asContext(cx));
  assert.equal(cx.focused, 1);
  assert.deepEqual(calls(nav.render(asContext(cx)), "overflow_hidden"), []);

  hooks.__herdrProps = () => ({});
  assert.equal(calls(nav.render(asContext(cx)), "overflow_hidden").length, 1);
});

test("the overlay prop reaches closeOverlay as given, including when it is absent", () => {
  const nav = new Nav();
  const cx = contextOf();
  hooks.__herdrProps = () => ({ navMenu: "workspace-options", overlay: 5 });
  const onKeyDown = first(nav.renderBody(asContext(cx)), "on_key_down") as KeyHandler;
  onKeyDown({ key: "escape" }, asContext(cx));
  hooks.__herdrProps = () => ({ navMenu: "workspace-options" });
  onKeyDown({ key: "escape" }, asContext(cx));

  hooks.__herdrProps = () => ({ overlay: 7 });
  nav.act({ kind: "action", command: "refresh" }, asContext(cx));
  hooks.__herdrProps = () => ({});
  nav.act({ kind: "action", command: "refresh" }, asContext(cx));

  assert.deepEqual(closed, [5, undefined, 7, undefined]);
  assert.deepEqual(ran, [["orca-sidebar-projects.refresh"], ["orca-sidebar-projects.refresh"]]);
});

test("git cache entries with a non-string repo or name reach the projects page as given", () => {
  store.set(
    "git.cache.v2",
    '{"a":{"repo":7,"name":3},"b":{"repo":"r","name":null},"c":{"repo":""},"d":{"repo":"s"},"e":null}',
  );
  const projects = new Nav()
    .pageRows("projects")
    .filter((row) => row.kind === "project")
    .map((row) => [row.project, row.label]);
  assert.deepEqual(projects, [
    [7, 3],
    ["r", "r"],
    ["s", "s"],
  ]);
});

test("the folder picker keeps non-string saved projects as given", async () => {
  store.set("projects.saved.v1", '[1,"a"]');
  const nav = new Nav();
  const cx = contextOf();
  const onClick = first(
    nodeWith(nav.renderBody(asContext(cx)), "id", "proj-add-repo"),
    "on_click",
  ) as ClickHandler;
  onClick({}, asContext(cx));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(JSON.parse(store.get("projects.saved.v1") ?? "null"), [1, "a", "/new"]);
  assert.deepEqual(ran, [["space.new", { folder: "/new" }]]);
});

test("option rows without a key or project write what legacy wrote", () => {
  const nav = new Nav();
  const cx = contextOf();
  nav.act({ kind: "toggle" }, asContext(cx));
  assert.equal(savedOptions().undefined, true);
  nav.act({ kind: "project" }, asContext(cx));
  assert.deepEqual(savedOptions().filterRepoIds, [null]);
});

test("a page row without a value renders undefined and a page row without a page leaves none set", () => {
  const nav = new Nav();
  const cx = contextOf();
  assert.ok(
    strings(nav.menuRow({ kind: "page", label: "Sort" }, 0, navTheme)).includes("undefined ›"),
  );
  nav.act({ kind: "page" }, asContext(cx));
  assert.equal(nav.page, undefined);
});

test("a disabled Clear row passes an undefined tooltip and gap rows keep Herdr's apostrophe", () => {
  const nav = new Nav();
  assert.deepEqual(
    calls(
      nav.menuRow({ kind: "projectClear", label: "Clear", disabled: true }, 0, navTheme),
      "tooltip",
    ),
    [[undefined]],
  );
  assert.equal(
    nav.rootRows().find((row) => row.label === "Show properties")?.note,
    "Herdr's card has no per-property model; branch and review badge are fixed.",
  );
});

test("the header notifies on the first hover-out, as legacy did", () => {
  const nav = new Nav();
  const cx = contextOf();
  const onHover = first(nav.renderBody(asContext(cx)), "on_hover") as HoverHandler;
  onHover(false, asContext(cx));
  assert.equal(cx.count, 1);
});

test("the sidebar frame width is the shared open width as given", () => {
  sharedValues.set("left-sidebar.openPx", "200");
  const frame = new Nav().render(asContext(contextOf()));
  assert.deepEqual(calls(frame, "w"), [["200"]]);
});

test("a layout whose children are not a list throws, as legacy did", () => {
  hooks.__herdrLayout = () => ({ children: 5 });
  assert.throws(() => new Nav().render(asContext(contextOf())), TypeError);
});
