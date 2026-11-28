import { afterEach, beforeEach, test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  settingsHoldPx,
  settingsPillLeft,
  settingsReturnPage,
  settingsSidebarPlan,
} from "../../../src/mods/orca-header/agent-settings-route.js";
import { closePlan } from "../../../src/mods/orca-header/close-plan.js";
import { Drawer } from "../../../src/mods/orca-header/drawer.js";
import {
  find,
  scaledWidth,
  toggleLeft,
  visibleSize,
} from "../../../src/mods/orca-header/header-layout.js";
import { newTabArgs } from "../../../src/mods/orca-header/new-tab.js";
import {
  matchUnofficialApp,
  unofficialByTerminal,
} from "../../../src/mods/orca-header/unofficial-apps.js";
import { stripLeadingAgentTitleDecoration } from "../../../src/mods/orca-header/tab-title.js";
import { tint } from "../../../src/mods/orca-header/tab-item.js";
import { headerTheme } from "../../../src/mods/orca-header/theme.js";
import { hostState, resetHostState } from "./host.js";

vi.mock("gpui-kit", async () => (await import("./host.js")).gpuiKit());
vi.mock("gpui-base", async () => (await import("./host.js")).gpuiBase());
vi.mock("herdr", async () => (await import("./host.js")).herdr());

beforeEach(() => {
  resetHostState();
});

afterEach(() => {
  resetHostState();
});

test("the settings pill position matches legacy for missing, text and out-of-range rails", () => {
  assert.equal(settingsPillLeft(undefined, 0, 0), null);
  assert.equal(settingsPillLeft(null, 0, 0), null);
  assert.equal(settingsPillLeft("900" as never, 0, 0), null);
  assert.equal(settingsPillLeft(Number.NaN, 0, 0), null);
  assert.equal(settingsPillLeft(1000, null as never, undefined as never), 444);
  assert.equal(settingsPillLeft(1000, "40" as never, -5), 404);
  assert.equal(settingsPillLeft(1000, 0, 0, undefined), 444);
  assert.equal(settingsPillLeft(100, 0, 0, 200), 0);
});

test("the return page matches legacy when the previous page or the children are missing", () => {
  assert.equal(settingsReturnPage(null, undefined, undefined), "main-landing");
  assert.equal(settingsReturnPage("main-tasks", null as never, { tabs: [] }), "main-landing");
  assert.equal(
    settingsReturnPage("main-tasks", [{ id: "main-tasks" }], { tabs: [{}] }),
    "main-tasks",
  );
  assert.equal(settingsReturnPage("x", [{}], null), "main-landing");
  assert.equal(settingsReturnPage("main-agents", [], { tabs: [{}] }), "main-terminals");
});

test("a sidebar with a null width counts as collapsed, and a null remembered width is released", () => {
  assert.deepEqual(
    settingsSidebarPlan({
      open: true,
      prior: null,
      sidebar: { size: { px: null as never } },
      busy: false,
      wide: 259,
    }),
    { flag: { px: 259, hidden: true }, show: false, resize: 76 },
  );
  assert.equal(
    settingsSidebarPlan({
      open: true,
      prior: { px: null as never },
      sidebar: { size: { px: 259 } },
      busy: false,
      wide: 259,
    }),
    null,
  );
  assert.equal(
    settingsSidebarPlan({
      open: true,
      prior: { px: null, hidden: true },
      sidebar: { size: { px: 259 } },
      busy: false,
      wide: 259,
    }),
    null,
  );
  assert.deepEqual(
    settingsSidebarPlan({ open: true, prior: null, sidebar: { size: {} }, busy: false }),
    {
      flag: { px: null as never },
      show: false,
      resize: null,
    },
  );
  assert.deepEqual(
    settingsSidebarPlan({
      open: true,
      prior: null,
      sidebar: { size: { px: 2 } },
      busy: false,
      wide: 259,
      zoom: 2,
    }),
    { flag: { px: 259, hidden: true }, show: false, resize: 152 },
  );
  assert.deepEqual(
    settingsSidebarPlan({
      open: true,
      prior: null,
      sidebar: { size: { px: null as never } },
      busy: false,
      wide: 259,
      zoom: 0,
    }),
    { flag: { px: 259, hidden: true }, show: false, resize: 0 },
  );
  assert.deepEqual(
    settingsSidebarPlan({
      open: false,
      prior: { px: null as never },
      sidebar: { size: { px: 259 } },
      busy: false,
    }),
    {
      flag: null,
      show: true,
      resize: null,
    },
  );
  assert.deepEqual(
    settingsSidebarPlan({
      open: false,
      prior: { hidden: true, px: 300 },
      sidebar: { hidden: true },
      busy: false,
    }),
    { flag: null, show: true, resize: 0 },
  );
  assert.equal(
    settingsSidebarPlan({ open: true, prior: null, sidebar: null, busy: false, wide: 259 })?.resize,
    null,
  );
  assert.deepEqual(
    settingsSidebarPlan({
      open: true,
      prior: { px: 259 },
      sidebar: { size: { px: 259 } },
      busy: false,
      wide: 259,
    }),
    { flag: { px: 259 }, show: false, resize: 76 },
  );
  assert.deepEqual(
    settingsSidebarPlan({
      open: true,
      prior: null,
      sidebar: { hidden: true, size: { px: null as never } },
      busy: false,
      wide: 259,
    }),
    { flag: { px: 259, hidden: true }, show: false, resize: 76 },
  );
});

test("the settings hold width matches legacy for NaN and fractional inputs", () => {
  assert.equal(settingsHoldPx({ full: Number.NaN, sidebar: 1 }), null);
  assert.equal(settingsHoldPx({ full: 100, sidebar: 200 }), 1);
  assert.equal(settingsHoldPx({ full: 10, sidebar: 0.4, panel: 0.4 }), 9);
});

test("layout lookups match legacy for null nodes, null sizes and hidden nodes", () => {
  assert.equal(find(null, "x"), null);
  assert.equal(find(undefined, "x"), null);
  assert.deepEqual(find({ id: "a", children: [{ id: "b" }] }, "b"), { id: "b" });
  assert.deepEqual(find({ id: "a" }, "a"), { id: "a" });
  assert.equal(scaledWidth({ size: { px: null as never } }, 7, 2), 3.5);
  assert.equal(scaledWidth({ hidden: false }, 7, 2), 3.5);
  assert.equal(scaledWidth(null, 7, 2), 3.5);
  assert.equal(visibleSize({ size: { px: null as never } }, 9), 9);
  assert.equal(visibleSize({ size: { px: 0 } }, 9), 0);
  assert.equal(visibleSize(null, 9), 9);
  assert.equal(visibleSize({ hidden: true }, 9), 0);
  assert.equal(toggleLeft({ platform: "linux" }, 5), 6);
  assert.equal(toggleLeft({ platform: "macos", fullscreen: true }, 3), 5);
  assert.equal(toggleLeft({}, 0), 75);
  assert.equal(toggleLeft({ fullscreen: false }, undefined), 75);
});

test("unofficial CLI matching matches legacy for odd terminal rows and argv shapes", () => {
  assert.deepEqual(
    unofficialByTerminal([
      { address: 1, argv: ["freebuff"] },
      null as never,
      { argv: undefined },
      { address: "t", argv: "freebuff" },
    ]).get(1),
    { key: "freebuff", name: "freebuff" },
  );
  assert.equal(unofficialByTerminal([null as never, { address: "t", argv: ["x"] }]).size, 0);
  assert.equal(unofficialByTerminal(null as never).size, 0);
  assert.equal(
    unofficialByTerminal([{ address: undefined, argv: ["freebuff"] }]).get(undefined)?.key,
    "freebuff",
  );
  assert.equal(matchUnofficialApp("freebuff"), null);
  assert.equal(matchUnofficialApp([1, null]), null);
  assert.equal(matchUnofficialApp(["zsh", "-c", "x".repeat(4097)]), null);
  assert.equal(matchUnofficialApp(["/usr/bin/zsh", "-c", "freebuff"])?.key, "freebuff");
  assert.equal(matchUnofficialApp(["zsh", "-c", "  "]), null);
});

test("the agent title strip matches legacy for non-strings and whitespace", () => {
  assert.equal(stripLeadingAgentTitleDecoration(null), null);
  assert.equal(stripLeadingAgentTitleDecoration(""), "");
  assert.equal(stripLeadingAgentTitleDecoration(42 as never), "42");
  assert.equal(stripLeadingAgentTitleDecoration("  ✳   "), "✳   ");
  assert.equal(stripLeadingAgentTitleDecoration("[x] y"), "[x] y");
});

test("close and new-tab arguments match legacy for null folders and empty ids", () => {
  assert.deepEqual(closePlan(null, ["a"]), [["tab.close", { id: "a" }]]);
  assert.deepEqual(closePlan([null, { id: "s", tabs: [] }], ["a"]), [["tab.close", { id: "a" }]]);
  assert.deepEqual(
    closePlan([{ id: "s", folder: null, tabs: [{ id: "a", settled: false }] }], ["a"]),
    [
      ["tab.new", { space: "s", focus: false }],
      ["tab.close", { id: "a" }],
    ],
  );
  assert.deepEqual(newTabArgs({ id: "", folder: "/x" }), {});
  assert.deepEqual(newTabArgs({ id: "s", folder: null as never }), { space: "s" });
});

test("the tint helper leaves non-hex colours alone and clamps the alpha", () => {
  assert.equal(tint("red" as never, 0.5), "red");
  assert.equal(tint("#abcdef" as never, 2), "#abcdefff");
  assert.equal(tint("#abcdef" as never, -1), "#abcdef00");
});

test("a drawer whose node has a null width keeps its open width and opens to the default", () => {
  const drawer = new Drawer({ id: "left-sidebar", defaultOpen: 259, measure: "measureSidebar" });
  assert.equal(drawer.open({ size: { px: null as never } }), 259);
  assert.equal(drawer.openPx, 0);
  assert.equal(drawer.open({ size: { px: 300 } }), 300);
  assert.equal(drawer.openPx, 300);
});

test("the theme reader hands every token through unchanged", () => {
  hostState.theme = () => new Proxy({}, { get: (_target, key) => String(key) });
  const values = headerTheme();
  assert.equal(values.surface, "surface");
  assert.equal(values.solid_foreground, "solid_foreground");
  assert.equal(Object.keys(values).length, 12);
});
