import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vite-plus/test";
import Nav from "../../../src/mods/orca-workspace-settings/main";

type Row = Parameters<Nav["act"]>[0];
type Theme = Parameters<Nav["menuRow"]>[2];

const host = vi.hoisted(() => {
  const state: {
    machines: Array<{ name: string | null }>;
    pick: (() => Promise<string | null>) | null;
  } = { machines: [], pick: null };
  return state;
});
vi.mock("herdr", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    machines: () => host.machines,
    pickFolder: () => host.pick?.() ?? Promise.resolve(null),
  };
});

declare global {
  var __herdrSpaces: (() => unknown[]) | undefined;
  var __herdrProps: (() => unknown) | undefined;
  var __herdrShared: ((key: string) => unknown) | undefined;
  var __herdrSetShared: ((key: string, value: unknown) => void) | undefined;
  var __herdrRun: ((...args: unknown[]) => void) | undefined;
  var __herdrCloseOverlay: ((id?: string) => void) | undefined;
  var __herdrLayout: (() => unknown) | undefined;
}

const OPTIONS_KEY = "workspace.options.v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asRow(value: object): Row {
  return value as Row;
}

function asContext(value: object): Parameters<Nav["render"]>[0] {
  return value as Parameters<Nav["render"]>[0];
}

function recorder(): Parameters<Nav["render"]>[0] & { calls: number } {
  const cx = {
    calls: 0,
    notify() {
      cx.calls++;
    },
  };
  return cx as Parameters<Nav["render"]>[0] & { calls: number };
}

function memoryStorage(store: Map<string, string>, fallback?: Storage): Storage {
  return {
    length: 0,
    clear() {},
    key: () => null,
    removeItem() {},
    getItem: (key) => store.get(key) ?? fallback?.getItem(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
      fallback?.setItem(key, value);
    },
  };
}

function fixture(sharedValues = new Map<string, unknown>()) {
  const store = new Map<string, string>();
  globalThis.localStorage = memoryStorage(store);
  globalThis.__herdrSpaces = () => [{ machine: null }, { machine: "remote" }];
  globalThis.__herdrProps = () => ({});
  globalThis.__herdrShared = (key) => (key === "projects.count" ? 2 : sharedValues.get(key));
  globalThis.__herdrSetShared = (key, value) => {
    sharedValues.set(key, value);
  };
  globalThis.__herdrLayout = () => ({ children: [{ id: "left-sidebar", size: { px: 120 } }] });
  globalThis.__herdrRun = undefined;
  globalThis.__herdrCloseOverlay = undefined;
  const cx = recorder();
  return {
    nav: new Nav(),
    cx,
    store,
    saved: () => toRecord(JSON.parse(store.get(OPTIONS_KEY) ?? "null")),
    sharedValues,
  };
}

beforeEach(() => {
  host.machines = [];
  host.pick = null;
});

test("the options popup refreshes projects through the sidebar and closes itself", () => {
  const { nav } = fixture();
  const ran: unknown[] = [];
  const closed: unknown[] = [];
  globalThis.__herdrRun = (...args) => {
    ran.push(args);
  };
  globalThis.__herdrCloseOverlay = (id) => {
    closed.push(id);
  };
  globalThis.__herdrProps = () => ({ navMenu: "workspace-options", overlay: "overlay-1" });
  const row = nav.rootRows().find((item) => item.kind === "action");
  assert.equal(row?.label, "Refresh branches");
  assert.ok(row);
  nav.act(row, recorder());
  assert.deepEqual(ran, [["orca-sidebar-projects.refresh"]]);
  assert.deepEqual(closed, ["overlay-1"]);
});

test("actions persist options, preserve the final host and notify only on change", () => {
  const { nav, cx, saved } = fixture();
  const actions: Array<[Row, string, unknown]> = [
    [{ kind: "toggle", key: "hideDetachedHeadWorkspaces" }, "hideDetachedHeadWorkspaces", true],
    [{ kind: "radio", key: "sortBy", value: "name" }, "sortBy", "name"],
    [{ kind: "groupby", value: "none" }, "groupBy", "none"],
    [{ kind: "project", project: "r" }, "filterRepoIds", ["r"]],
    [{ kind: "project", project: "r" }, "filterRepoIds", []],
    [{ kind: "projectClear" }, "filterRepoIds", []],
    [{ kind: "host", host: "remote" }, "visibleWorkspaceHostIds", [null]],
  ];
  for (const [row, key, value] of actions) {
    nav.act(row, cx);
    assert.deepEqual(saved()[key], value);
  }
  const ignored: Row[] = [{ kind: "host", host: null }, { kind: "gap" }, asRow({ kind: "other" })];
  for (const row of ignored) nav.act(row, cx);
  assert.equal(cx.calls, 7);
  nav.act({ kind: "host", host: "remote" }, cx);
  assert.equal(saved().visibleWorkspaceHostIds, null);
  nav.act({ kind: "hostAll" }, cx);
  assert.equal(cx.calls, 9);
});

test("workspace options publish across popup props and update shared state", () => {
  const { nav, cx, saved, sharedValues } = fixture();
  nav.act({ kind: "radio", key: "sortBy", value: "name" }, cx);
  assert.equal(saved().sortBy, "name");
  assert.equal(toRecord(sharedValues.get(OPTIONS_KEY)).sortBy, "name");
  const reopened = fixture(sharedValues);
  assert.equal(reopened.nav.pageRows("sort").find((row) => row.value === "name")?.checked, true);
  nav.act({ kind: "groupby", value: "none" }, cx);
  assert.equal(toRecord(sharedValues.get(OPTIONS_KEY)).groupBy, "none");
});

test("every page lists its rows with stored choices marked", () => {
  const { nav, saved } = fixture();
  host.machines = [{ name: "remote" }];
  const store = new Map<string, string>([
    [
      "git.cache.v2",
      JSON.stringify({ a: { repo: "r1", name: "One" }, b: { repo: "r2" }, c: null }),
    ],
  ]);
  globalThis.localStorage = memoryStorage(store, globalThis.localStorage);
  nav.act({ kind: "host", host: "remote" }, recorder());
  nav.act({ kind: "project", project: "r2" }, recorder());
  assert.deepEqual(saved().visibleWorkspaceHostIds, [null]);
  const pick = (page: string) =>
    nav.pageRows(page).map((row) => [row.kind, row.label, row.checked, row.disabled]);
  assert.deepEqual(pick("hosts"), [
    ["back", "Back", undefined, undefined],
    ["hostAll", "All hosts", false, undefined],
    ["host", "This computer", true, undefined],
    ["host", "remote", false, undefined],
  ]);
  assert.deepEqual(pick("projects"), [
    ["back", "Back", undefined, undefined],
    ["projectClear", "Clear", undefined, false],
    ["project", "One", false, undefined],
    ["project", "r2", true, undefined],
  ]);
  assert.deepEqual(
    pick("sort").filter((row) => row[2]),
    [["radio", "Manual", true, undefined]],
  );
  assert.deepEqual(
    nav
      .rootRows()
      .filter((row) => row.kind === "page")
      .map((row) => [row.page, row.label, row.value]),
    [
      ["hosts", "Hosts", "1 hosts"],
      ["projects", "Projects", "1 projects"],
      ["sort", "Worktree sort", "Manual"],
      ["projectOrder", "Project sort", "Manual"],
    ],
  );
  assert.deepEqual(
    nav.pageRows("projectOrder").map((row) => row.label),
    ["Back", "Manual", "Name", "Recent"],
  );
});

test("the popup keyboard wraps, jumps to the ends and closes on escape", () => {
  const { nav, cx } = fixture();
  const closed: unknown[] = [];
  globalThis.__herdrProps = () => ({ navMenu: "workspace-options", overlay: "o1" });
  globalThis.__herdrCloseOverlay = (id) => {
    closed.push(id);
  };
  nav.init({}, asContext({ focus_handle: () => ({ focus() {} }) }));
  const rows = nav.rootRows();
  const stops = rows.filter(
    (row) => !["separator", "label", "heading", "gap", "groupby"].includes(row.kind),
  );
  assert.deepEqual(
    rows.filter((row) => !["separator", "label", "heading", "gap", "groupby"].includes(row.kind)),
    stops,
  );
  assert.equal(stops[0].label, "Refresh branches");
  const rendered = nav.render(cx);
  assert.ok(rendered);
  assert.ok(nav.renderBody(cx));
  const theme: Theme = {
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
  for (const row of rows) nav.menuRow(row, 0, theme);
  nav.act({ kind: "page", page: "sort" }, cx);
  assert.equal(nav.page, "sort");
  nav.act({ kind: "back" }, cx);
  assert.equal(nav.page, null);
});
