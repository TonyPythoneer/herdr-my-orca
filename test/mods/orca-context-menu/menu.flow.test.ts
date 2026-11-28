import { it, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { contextOf, host, resetHost, plain } from "./host.js";
import type { MenuProps, Row } from "../../../src/mods/orca-context-menu/main.js";

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
vi.mock("../../../src/shared/transcript.ts", () => ({ buildBoundedSessionTranscript: () => null }));

import Menu, { items, menuIcon, section } from "../../../src/mods/orca-context-menu/main.js";

function fixture(tab: string): {
  menu: Menu;
  rows: Row[];
  icons: string[];
  breaks: string[];
  events: unknown[];
} {
  const state: MenuProps = {
    tab,
    overlay: "popup",
    target: { id: "a", pane: "p", terminal: "term", linked: true, path: "/repo" },
  };
  resetHost({
    props: state,
    spaces: [{ id: "a", folder: "/repo", tabs: [{ id: "a", named: true }, { id: "b" }] }],
    panes: [{ pane: "p", tab: "a", focused: true }],
    terminals: [{ address: "term", agent: true }],
    keys: [],
    theme: {},
    onExec: async () => ({ code: 0, stdout: "" }),
    onHc: async () => ({ code: 0 }),
    onRun: (...args: unknown[]) => host.effects.push(args),
    onCloseOverlay: (id: unknown) => host.effects.push(id),
    onOpenOverlay: (spec: unknown) => host.effects.push(spec),
  });
  const rows = items(state, null);
  const menu = new Menu();
  return {
    menu,
    rows,
    icons: rows.map((row) => menuIcon(row, false)),
    breaks: rows.filter((row, index) => section(state, rows, index)).map((row) => row[0]),
    events: host.effects,
  };
}

it("context rows keep command-specific icons and separators", () => {
  const expectations: Record<string, Array<[string, string, boolean?]>> = {
    pane: [
      ["Copy", "copy.svg"],
      ["Paste", "clipboard.svg"],
      ["Split Terminal Right", "panel-right-close--orca-context-menu.svg", true],
      ["Split Terminal Down", "panel-bottom-close.svg"],
      ["Clear Pane Title", "x--orca-context-menu.svg"],
      ["Expand Pane", "maximize-2.svg", true],
    ],
    tab: [
      ["Move Tab to Split Left", "arrow-left.svg"],
      ["Pin Tab", "pin.svg", true],
      ["Change Title", "pencil--orca-context-menu.svg", true],
    ],
    group: [
      ["New worktree", "git-branch-plus--orca-context-menu.svg"],
      ["Open worktree", "workflow--orca-context-menu.svg"],
      ["Copy Path", "copy.svg", true],
    ],
    space: [
      ["Checkout branch", "git-fork.svg"],
      ["Remove worktree", "unlink.svg"],
      ["Mark Unread", "bell--orca-context-menu.svg", true],
    ],
    global: [
      ["New space", "plus--orca-agent-flyout.svg"],
      ["Keybinds", "terminal.svg", true],
      ["Theme: graphite", "settings.svg", true],
    ],
  };
  for (const [tab, descriptions] of Object.entries(expectations)) {
    const { rows, icons, breaks } = fixture(tab);
    for (const [label, icon, separator] of descriptions) {
      assert.equal(
        icons[rows.findIndex((row) => row[0] === label)],
        "mods/orca-assets/" + icon,
        label,
      );
      if (separator) assert.ok(breaks.includes(label), label);
    }
  }
});

it("copy focuses its target and bulk deletion confirms before closing the overlay", () => {
  const pane = fixture("pane");
  pane.menu.choose(0, contextOf({}));
  assert.deepEqual(plain(pane.events), [
    ["pane.focus", { pane: "p" }],
    ["terminal.copy", {}],
    "popup",
  ]);
  const group = fixture("space");
  group.menu.choose(
    group.rows.findIndex((row) => row[0] === "Delete all tabs"),
    contextOf({}),
  );
  const opened = plain<{ props: { confirmClose: unknown } }>(group.events[0]);
  assert.deepEqual(plain(opened.props.confirmClose), {
    kind: "bulk",
    scope: "all",
    tabIds: ["a", "b"],
  });
  assert.equal(group.events[1], "popup");
});

it("left/up context splits swap the original target explicitly", () => {
  for (const [label, direction] of [
    ["Split Terminal Left", "right"],
    ["Split Terminal Up", "down"],
  ] as const) {
    const { menu, rows, events } = fixture("pane");
    menu.choose(
      rows.findIndex((row) => row[0] === label),
      contextOf({}),
    );
    assert.deepEqual(plain(events), [
      ["pane.focus", { pane: "p" }],
      ["pane.split", { direction, pane: "p" }],
      ["pane.swap", { direction, pane: "p" }],
      "popup",
    ]);
  }
});
