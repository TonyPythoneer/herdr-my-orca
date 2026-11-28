import { it, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { cleanse, contextOf, host, resetHost } from "./host.js";

vi.mock("gpui-kit", async () => {
  const { element } = await import("./host.js");
  return { View: class {}, div: element("div"), svg: element("svg") };
});
vi.mock("gpui-base", async () => {
  const { element } = await import("./host.js");
  return { h_flex: element("h_flex"), v_flex: element("v_flex") };
});
vi.mock("herdr", async () => (await import("./host.js")).herdrMock());
vi.mock("../../../src/shared/clip.ts", () => ({ copyText: () => {} }));
vi.mock("../../../src/services/agent-handoff/transcript.ts", () => ({ buildBoundedSessionTranscript: () => null }));

import Menu from "../../../src/mods/orca-context-menu/main.js";

Object.assign(globalThis, { window: { appearance: () => "dark" } });

const PANE_MENU = { tab: "pane", overlay: "ov", target: { pane: "p" } };
const TWO_PANES = [
  { pane: "p", tab: "t", focused: true },
  { pane: "q", tab: "t" },
];

it("theme tokens reach the rendered tree exactly as the host gives them", () => {
  resetHost({
    props: { tab: "global", overlay: "ov" },
    theme: {
      foreground: "#101010",
      popover: "#202020",
      selected: "#303030",
      muted: "#404040",
      border: "#505050",
    },
  });
  const json = JSON.stringify(cleanse(new Menu().render()));
  for (const color of ["#101010", "#202020", "#303030", "#404040", "#505050"]) {
    assert.ok(json.includes(`"${color}"`), color);
  }
});

it("a theme without a token renders that token as undefined, without throwing", () => {
  resetHost({ props: { tab: "global", overlay: "ov" }, theme: {} });
  assert.doesNotThrow(() => new Menu().render());
});

it("choosing with no overlay id closes the overlay with undefined", () => {
  const closed: unknown[] = [];
  resetHost({ props: undefined, onRun: () => {}, onCloseOverlay: (id) => closed.push(id) });
  new Menu().choose(0, contextOf({}));
  assert.deepEqual(closed, [undefined]);
});

it("destructive rows use the red of the window appearance", () => {
  for (const [appearance, red] of [
    ["dark", "#ff6568"],
    ["light", "#e40014"],
  ] as const) {
    Object.assign(globalThis, { window: { appearance: () => appearance } });
    resetHost({
      props: PANE_MENU,
      panes: TWO_PANES,
      theme: { foreground: "a", popover: "b", selected: "c", muted: "d", border: "e" },
    });
    assert.ok(JSON.stringify(cleanse(new Menu().render())).includes(`"${red}"`), appearance);
  }
});

it("a menu rendered before init tracks a focus handle that has only focus", () => {
  resetHost({ props: { tab: "global", overlay: "ov" }, theme: {} });
  const json = JSON.stringify(cleanse(new Menu().render()));
  assert.ok(json.includes(`["track_focus",[{"focus":"fn"}]]`));
});

it("the host handler registry is untouched by a plain render", () => {
  resetHost({ props: { tab: "global", overlay: "ov" }, theme: {} });
  new Menu().render();
  assert.ok(host.handlers.every(([name]) => name.startsWith("on_")));
});
