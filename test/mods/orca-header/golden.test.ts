import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import type { AsyncContext } from "gpui-kit";
import Tabs from "../../../src/mods/orca-header/main.js";
import { hostState, nodeOf } from "./host.js";

vi.mock("gpui-kit", async () => (await import("./host.js")).gpuiKit());
vi.mock("gpui-base", async () => (await import("./host.js")).gpuiBase());
vi.mock("herdr", async () => (await import("./host.js")).herdr());

type Step = (t: Tabs, o: Opts) => void;
type Opts = {
  window?: unknown;
  panes?: unknown[];
  terminals?: unknown[];
  settings?: Record<string, unknown>;
  props?: Record<string, unknown>;
  initProps?: Record<string, unknown>;
  spaces?: unknown[];
  layout?: unknown;
  shared?: Record<string, unknown>;
  state?: Record<string, unknown>;
  steps?: Step[];
};
type Scenario = [string, Opts];

const THEME: Record<string, string> = Object.fromEntries(
  [
    "surface",
    "background",
    "foreground",
    "muted",
    "dim",
    "popover",
    "border",
    "solid",
    "solid_foreground",
    "input",
    "raised",
    "hover",
  ].map((key, i) => [
    key,
    `#${String(i + 1).padStart(2, "0")}${String(i + 1).padStart(2, "0")}${String(i + 1).padStart(2, "0")}`,
  ]),
);
const node = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra });
const LAYOUT = ({
  sidebar = {},
  panel = {},
  main = { active: "main-terminals" },
  status = {},
  lights,
}: {
  sidebar?: Record<string, unknown>;
  panel?: Record<string, unknown>;
  main?: Record<string, unknown>;
  status?: Record<string, unknown>;
  lights?: number[];
} = {}) => ({
  id: "root",
  traffic_lights: lights,
  children: [
    node("left-sidebar", { size: { px: 259 }, ...sidebar }),
    node("main", { size: { px: 900 }, ...main, children: [node("tabs", { size: { px: 36 } })] }),
    node("panel", { size: { px: 350 }, ...panel }),
    node("panel-body", { active: "files" }),
    node("status", { size: { px: 24 }, ...status }),
  ],
});
type Tab = {
  id: string;
  name?: string;
  status?: string;
  active?: boolean;
  named?: boolean;
  settled?: boolean;
  zoomed?: boolean;
};
const tab = (id: string, extra: Record<string, unknown> = {}): Tab => ({
  id,
  name: `Tab ${id}`,
  status: "idle",
  ...extra,
});
const SPACE = (tabs: unknown[], extra: Record<string, unknown> = {}) => ({
  id: "s1",
  active: true,
  name: "work",
  folder: "/proj",
  tabs,
  ...extra,
});
const pane = (id: string, tabId: string, extra: Record<string, unknown> = {}) => ({
  pane: id,
  tab: tabId,
  terminal: `tty-${id}`,
  title: `title ${id}`,
  ...extra,
});
const MAC = { platform: "macos", titlebar: "none", fullscreen: false };
const FOUR = [
  tab("a", { status: "working", active: true }),
  tab("b", { status: "done", named: true, name: "Named" }),
  tab("c", { status: "blocked", settled: true, zoomed: true }),
  tab("d", { status: "idle" }),
];
const AGENTS = [
  pane("p1", "a", {
    app: "codex",
    program: { agent: true, name: "Codex", icon: "x/codex.svg", tint: true },
    title: "✳ Codex task",
  }),
  pane("p2", "b", { app: "omp", program: { agent: true, name: "OMP" } }),
  pane("p3", "c", { app: "gemini", program: { agent: true } }),
  pane("p4", "d", { app: "aider", program: { agent: true } }),
];
const TERMINALS = [{ address: "tty-p4", argv: ["node", "/bin/freebuff"] }];

function makeCx(log: unknown[][]): AsyncContext {
  const cx: {
    notify: () => unknown;
    spawn: () => unknown;
    focus_handle: () => { focus: () => unknown };
    timer: { every: (ms: number) => unknown; after: (ms: number) => unknown };
  } = {
    notify: () => log.push(["notify"]),
    spawn: () => log.push(["spawn"]),
    focus_handle: () => ({ focus: () => log.push(["focus"]) }),
    timer: {
      every: (ms: number) => log.push(["every", ms]),
      after: (ms: number) => log.push(["after", ms]),
    },
  };
  return Object.assign({} as AsyncContext, cx);
}

function scenario(name: string, o: Opts = {}) {
  const log: unknown[][] = [];
  const stored = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => log.push(["storage", k, v]),
    },
  });
  hostState.panes = () => o.panes ?? [];
  hostState.terminals = () => o.terminals ?? [];
  hostState.window = () => o.window;
  hostState.settings = () => o.settings ?? {};
  hostState.props = () => o.props ?? {};
  hostState.theme = () => THEME;
  hostState.spaces = () => o.spaces ?? [SPACE(FOUR)];
  hostState.layout = () => o.layout ?? LAYOUT();
  hostState.shared = (key: string) => (o.shared ?? {})[key];
  hostState.run = (command: string, args?: unknown) => {
    log.push(["run", command, args]);
  };
  hostState.closeOverlay = (id?: string) => log.push(["closeOverlay", id]);
  hostState.openOverlay = (spec: unknown) => {
    log.push(["openOverlay", spec]);
    return "overlay-1";
  };
  hostState.setShared = (key: string, value: unknown) => log.push(["setShared", key, value]);
  hostState.writeTextFile = async () => null;
  hostState.nextCommand = () => new Promise<string>(() => {});
  const tabs = new Tabs();
  const cx = makeCx(log);
  tabs.init(o.initProps ?? {}, cx);
  Object.assign(tabs, o.state);
  const trees = [];
  for (const step of o.steps ?? [() => {}]) {
    step(tabs, o);
    trees.push(nodeOf(tabs.render(cx)));
  }
  return { name, trees, log };
}

const overflow = {
  viewportWidth: 300,
  tabWidths: new Map(FOUR.map((c) => [c.id, 144])),
};
const SCENARIOS: Scenario[] = [
  ["mac four tabs", { window: MAC, panes: AGENTS, terminals: TERMINALS }],
  ["mac fullscreen", { window: { ...MAC, fullscreen: true }, panes: AGENTS }],
  ["mac titlebar visible", { window: { platform: "macos", titlebar: "native" }, panes: AGENTS }],
  [
    "mac traffic lights",
    { window: MAC, layout: LAYOUT({ lights: [14, 30] }), panes: AGENTS, settings: { zoom: 1.25 } },
  ],
  [
    "mac traffic lights, sidebar hidden",
    { window: MAC, layout: LAYOUT({ lights: [14, 30], sidebar: { hidden: true } }) },
  ],
  ["linux", { window: { platform: "linux" }, panes: AGENTS }],
  ["windows maximized", { window: { platform: "windows", maximized: true } }],
  ["no window yet", { panes: AGENTS }],
  ["no tabs", { spaces: [SPACE([])] }],
  ["no space", { spaces: [] }],
  [
    "single zoomed tab",
    { window: MAC, spaces: [SPACE([tab("a", { active: true, zoomed: true, status: "working" })])] },
  ],
  ["single plain tab", { window: MAC, spaces: [SPACE([tab("a", { active: true })])] }],
  [
    "sidebar hidden",
    { window: MAC, layout: LAYOUT({ sidebar: { hidden: true }, panel: { hidden: true } }) },
  ],
  [
    "sidebar hidden then shown",
    {
      window: MAC,
      layout: LAYOUT({ sidebar: { hidden: true } }),
      steps: [
        () => {},
        () => {
          hostState.layout = () => LAYOUT();
        },
        () => {
          hostState.layout = () => LAYOUT({ sidebar: { hidden: true, size: { px: 300 } } });
        },
      ],
    },
  ],
  [
    "sidebar shown then hidden, linux",
    {
      window: { platform: "linux" },
      state: {},
      steps: [
        () => {},
        () => {
          hostState.layout = () => LAYOUT({ sidebar: { hidden: true } });
        },
      ],
    },
  ],
  [
    "panel hidden",
    {
      window: MAC,
      layout: LAYOUT({ panel: { hidden: true } }),
      shared: { "workspace.panels": ["files", "git"] },
    },
  ],
  [
    "landing stack",
    { window: MAC, spaces: [SPACE([])], layout: LAYOUT({ main: { active: "main-landing" } }) },
  ],
  [
    "remembered panel",
    {
      window: MAC,
      state: { panels: { s1: "git" } },
      layout: LAYOUT({ panel: { hidden: true } }),
      shared: { "workspace.panels": ["files", "git"] },
    },
  ],
  [
    "remembered hide",
    {
      window: MAC,
      state: { panels: { s1: null } },
      shared: { "workspace.panels": ["files", "git"] },
    },
  ],
  ["sidebar hidden, panel shown", { window: MAC, layout: LAYOUT({ sidebar: { hidden: true } }) }],
  ["narrow sidebar", { window: MAC, layout: LAYOUT({ sidebar: { size: { px: 90 } } }) }],
  [
    "panel hidden, zoom 2",
    { window: MAC, layout: LAYOUT({ panel: { hidden: true } }), settings: { zoom: 2 } },
  ],
  [
    "native pinned",
    {
      window: MAC,
      props: { motion: "native", pinSidebarTerminal: true },
      state: { nativeHeaderWidth: 1000 },
    },
  ],
  [
    "native clocks",
    {
      window: MAC,
      props: { motion: "native" },
      steps: [
        (t) => {
          t.drawers.sidebar.clockPx = 77;
          t.drawers.panel.clockPx = 55;
        },
      ],
    },
  ],
  [
    "busy drawers",
    {
      window: MAC,
      steps: [
        (t) => {
          t.drawers.sidebar.busy = true;
          t.drawers.panel.busy = true;
        },
      ],
    },
  ],
  ["main already flexible", { window: MAC, layout: LAYOUT({ main: { size: undefined } }) }],
  ["pending toggles", { window: MAC, state: { wantToggle: 3, wantPanelToggle: 2 } }],
  ["overflow", { window: MAC, state: overflow, panes: AGENTS }],
  ["overflow scrolled", { window: MAC, state: { ...overflow, scrollX: 100, activeTabId: "a" } }],
  [
    "overflow scrolled to end, active last",
    {
      window: MAC,
      spaces: [SPACE(FOUR.map((c) => ({ ...c, active: c.id === "d" })))],
      state: { ...overflow, scrollX: 500 },
    },
  ],
  [
    "overflow sliding",
    { window: MAC, state: { ...overflow, scrollX: 100, animatedUntil: Number.MAX_SAFE_INTEGER } },
  ],
  ["overflow, scrolled 50", { window: MAC, state: { ...overflow, scrollX: 50 } }],
  [
    "unmeasured widths",
    { window: MAC, state: { viewportWidth: 300, tabWidths: new Map([["a", 144]]) } },
  ],
  ["hovered tab", { window: MAC, state: { hoveredTab: "b" } }],
  ["hovered active tab", { window: MAC, state: { hoveredTab: "a" } }],
  ["dragging a tab", { window: MAC, state: { pressed: 0, overTab: "c", overSide: "left" } }],
  [
    "dragging a tab, right side",
    { window: MAC, state: { pressed: 3, overTab: "b", overSide: "right" } },
  ],
  ["pressed on own tab", { window: MAC, state: { pressed: 0, overTab: "a", overSide: null } }],
  [
    "pane drag over the strip",
    {
      window: MAC,
      shared: {
        "orca-header.pane-drag": { active: true, inTabStrip: true, pane: "p1", terminal: "tty-p1" },
      },
    },
  ],
  [
    "pane drag below the strip",
    { window: MAC, shared: { "orca-header.pane-drag": { active: true, inTabStrip: false } } },
  ],
  [
    "mixed apps",
    {
      window: MAC,
      panes: [
        pane("p1", "a", { app: "kilo", program: { agent: true } }),
        pane("p2", "b", { program: { icon: "own.png", tint: false } }),
        pane("p3", "c", { program: { icon: "own.svg", tint: true } }),
        pane("p4", "d", { app: "freebuff", program: {} }),
      ],
    },
  ],
  [
    "terminal unofficial and cursor",
    {
      window: MAC,
      panes: [
        pane("p1", "a", { app: "cursor", program: { agent: true } }),
        pane("p2", "b", { app: "grok" }),
        pane("p3", "c", { app: "qoder" }),
        pane("p4", "d", { app: "dsh-tui", program: { name: "dsh" } }),
      ],
      terminals: TERMINALS,
    },
  ],
  [
    "pane titles instead of tab names",
    {
      window: MAC,
      spaces: [
        SPACE([
          { id: "a", status: "idle", active: true },
          { id: "b", name: "x", status: "working" },
        ]),
      ],
      panes: [
        pane("p1", "a", { program: { name: "zsh" } }),
        pane("p2", "b", { title: "", program: { name: "bash" } }),
      ],
    },
  ],
  [
    "init dialog props",
    {
      window: MAC,
      initProps: { confirmClose: { kind: "pinned" } },
      props: {
        confirmClose: { kind: "pinned", tabId: "a", tabLabel: "Tab a" },
        overlay: "ov",
      },
    },
  ],
  [
    "init drop overlay props",
    {
      props: { drop: true, overlay: "ov" },
      shared: {
        "orca-header.drop": {
          tab: "a",
          zone: "left",
          strip: { x: 0, y: 0, width: 900, height: 600, stripHeight: 36 },
        },
      },
    },
  ],
];

const DIALOGS = [
  {},
  { kind: "command", tabId: "a", tabLabel: "build" },
  { kind: "agent", tabId: "a", tabLabel: "claude" },
  { kind: "pinned", tabId: "a", tabLabel: "pin" },
  { kind: "bulk", scope: "others", tabIds: ["a", "b"] },
  { kind: "bulk", scope: "right", tabIds: ["a"] },
  { kind: "bulk", scope: "left", tabIds: [], detail: "3 tabs in 2 worktrees" },
  { kind: "bulk", tabIds: undefined },
  { kind: "bulk", scope: "weird", tabIds: ["x"] },
];
for (const cfg of DIALOGS) {
  for (const again of [false, true]) {
    SCENARIOS.push([
      `dialog ${JSON.stringify(cfg)} again=${again}`,
      {
        props: { confirmClose: cfg, overlay: "ov" },
        initProps: { confirmClose: cfg },
        state: { dontAskAgain: again },
      },
    ]);
  }
}
const STRIP = { x: 100, y: 50, width: 800, height: 601, stripHeight: 36 };
for (const zone of [null, "up", "down", "left", "right"]) {
  SCENARIOS.push([
    `drop overlay ${zone}`,
    {
      props: { drop: true, overlay: "ov" },
      initProps: { drop: true },
      shared: { "orca-header.drop": { tab: "a", zone, strip: STRIP } },
    },
  ]);
}
SCENARIOS.push([
  "drop overlay without a record",
  { props: { drop: true, overlay: "ov" }, initProps: { drop: true } },
]);
SCENARIOS.push([
  "drop overlay own zone",
  {
    props: { drop: true, overlay: "ov" },
    initProps: { drop: true },
    state: { zone: "down" },
    shared: {
      "orca-header.drop": { tab: "a", zone: "down", strip: { ...STRIP, stripHeight: 0 } },
    },
  },
]);
SCENARIOS.push([
  "actions are consumed",
  {
    window: MAC,
    shared: { "orca-header.action": { kind: "unsplit-to-tab", pane: "p1" } },
    panes: AGENTS,
  },
]);

const GOLDEN = "fce2c10a9fe279d1645441d0f757036d0a07e6752950d2027c78130aa26f60f7";

test("golden render and commands over the state matrix", () => {
  const realNow = Date.now;
  Date.now = () => 1_700_000_000_000;
  let text: string;
  try {
    text = SCENARIOS.map(([name, options]) =>
      JSON.stringify(
        scenario(name, options),
        (_key, value) => (value instanceof Map ? [...value] : value),
        1,
      ),
    ).join("\n");
  } finally {
    Date.now = realNow;
  }
  if (process.env.GOLDEN_DUMP) {
    mkdirSync(process.env.GOLDEN_DUMP, { recursive: true });
    writeFileSync(`${process.env.GOLDEN_DUMP}/orca-header-golden.json`, text);
  }
  const hash = createHash("sha256").update(text).digest("hex");
  assert.equal(hash, GOLDEN);
});
