// Golden render of the header strip, the close dialog and the drop overlay over a matrix of
// states: platform, layout, hover and drag state, overflow, every status and agent mark. Handlers
// are recorded by name ("fn"), so the hash covers structure, styles and the commands, shared
// writes, overlays and timers a render and an init issue. Set GOLDEN_DUMP=<dir> to write the full
// text next to the hash when it breaks.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { register, registerHooks } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
registerHooks({ resolve(name, context, next) {
  const result = next(name, context);
  if (name !== "herdr") return result;
  const source = `export * from ${JSON.stringify(result.url)};
    export const panes = () => globalThis.host.panes;
    export const terminals = () => globalThis.host.terminals;
    export const window = () => globalThis.host.window;
    export const settings = () => globalThis.host.settings;
    export const setShared = (...args) => globalThis.host.log.push(["setShared", ...args]);
    export const openOverlay = (...args) => { globalThis.host.log.push(["openOverlay", ...args]); return "overlay-1"; };
    export const writeTextFile = async () => {};
    export const nextCommand = () => new Promise(() => {});`;
  return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
} });
const { default: Tabs } = await import("./main.js");

const THEME = Object.fromEntries(["surface", "background", "foreground", "muted", "dim", "popover", "border", "solid", "solid_foreground", "input", "raised", "hover"]
  .map((key, i) => [key, `#${String(i + 1).padStart(2, "0")}${String(i + 1).padStart(2, "0")}${String(i + 1).padStart(2, "0")}`]));
const node = (id, extra = {}) => ({ id, ...extra });
const LAYOUT = ({ sidebar = {}, panel = {}, main = { active: "main-terminals" }, status = {}, lights } = {}) => ({
  id: "root", traffic_lights: lights,
  children: [node("sidebar", { size: { px: 259 }, ...sidebar }), node("main", { size: { px: 900 }, ...main, children: [node("tabs", { size: { px: 36 } })] }),
    node("panel", { size: { px: 350 }, ...panel }), node("panel-body", { active: "files" }), node("status", { size: { px: 24 }, ...status })],
});
const tab = (id, extra = {}) => ({ id, name: `Tab ${id}`, status: "idle", ...extra });
const SPACE = (tabs, extra = {}) => ({ id: "s1", active: true, name: "work", folder: "/proj", tabs, ...extra });
const pane = (id, tabId, extra = {}) => ({ pane: id, tab: tabId, terminal: `tty-${id}`, title: `title ${id}`, ...extra });
const MAC = { platform: "macos", titlebar: "none", fullscreen: false };
const FOUR = [tab("a", { status: "working", active: true }), tab("b", { status: "done", named: true, name: "Named" }),
  tab("c", { status: "blocked", settled: true, zoomed: true }), tab("d", { status: "idle" })];
const AGENTS = [pane("p1", "a", { app: "codex", program: { agent: true, name: "Codex", icon: "x/codex.svg", tint: true }, title: "✳ Codex task" }),
  pane("p2", "b", { app: "omp", program: { agent: true, name: "OMP" } }), pane("p3", "c", { app: "gemini", program: { agent: true } }),
  pane("p4", "d", { app: "aider", program: { agent: true } })];
const TERMINALS = [{ address: "tty-p4", argv: ["node", "/bin/freebuff"] }];

function makeCx(log) {
  const cx = { notify: () => log.push(["notify"]), spawn: () => log.push(["spawn"]),
    focus_handle: () => ({ focus: () => log.push(["focus"]) }),
    timer: { every: (ms) => log.push(["every", ms]), after: (ms) => log.push(["after", ms]) } };
  return cx;
}

function scenario(name, o = {}) {
  const log = [];
  const stored = new Map();
  globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => log.push(["storage", k, v]) };
  globalThis.host = { panes: o.panes ?? [], terminals: o.terminals ?? [], window: o.window, settings: o.settings ?? {}, log };
  globalThis.__herdrProps = () => o.props ?? {};
  globalThis.__herdrTheme = () => THEME;
  globalThis.__herdrSpaces = () => o.spaces ?? [SPACE(FOUR)];
  globalThis.__herdrLayout = () => o.layout ?? LAYOUT();
  globalThis.__herdrShared = (key) => (o.shared ?? {})[key];
  globalThis.__herdrRun = (command, args) => { log.push(["run", command, args]); };
  globalThis.__herdrCloseOverlay = (id) => log.push(["closeOverlay", id]);
  const tabs = new Tabs();
  const cx = makeCx(log);
  tabs.init(o.initProps ?? {}, cx);
  Object.assign(tabs, o.state);
  const trees = [];
  for (const step of o.steps ?? [() => {}]) {
    step(tabs, o);
    trees.push(tabs.render(cx).__node);
  }
  return { name, trees, log };
}

const overflow = { viewportWidth: 300, tabWidths: new Map(FOUR.map((c) => [c.id, 144])) };
const unified = { unified: true };
const SCENARIOS = [
  ["mac four tabs", { window: MAC, panes: AGENTS, terminals: TERMINALS }],
  ["mac fullscreen", { window: { ...MAC, fullscreen: true }, panes: AGENTS }],
  ["mac titlebar visible", { window: { platform: "macos", titlebar: "native" }, panes: AGENTS }],
  ["mac traffic lights", { window: MAC, layout: LAYOUT({ lights: [14, 30] }), panes: AGENTS, settings: { zoom: 1.25 } }],
  ["mac traffic lights, sidebar hidden", { window: MAC, layout: LAYOUT({ lights: [14, 30], sidebar: { hidden: true } }) }],
  ["linux", { window: { platform: "linux" }, panes: AGENTS }],
  ["windows maximized", { window: { platform: "windows", maximized: true } }],
  ["no window yet", { panes: AGENTS }],
  ["no tabs", { spaces: [SPACE([])] }],
  ["no space", { spaces: [] }],
  ["single zoomed tab", { window: MAC, spaces: [SPACE([tab("a", { active: true, zoomed: true, status: "working" })])] }],
  ["single plain tab", { window: MAC, spaces: [SPACE([tab("a", { active: true })])] }],
  ["sidebar hidden", { window: MAC, layout: LAYOUT({ sidebar: { hidden: true }, panel: { hidden: true } }) }],
  ["sidebar hidden then shown", { window: MAC, layout: LAYOUT({ sidebar: { hidden: true } }),
    steps: [() => {}, () => { globalThis.__herdrLayout = () => LAYOUT(); }, () => { globalThis.__herdrLayout = () => LAYOUT({ sidebar: { hidden: true, size: { px: 300 } } }); }] }],
  ["sidebar shown then hidden, linux", { window: { platform: "linux" }, state: {},
    steps: [() => {}, () => { globalThis.__herdrLayout = () => LAYOUT({ sidebar: { hidden: true } }); }] }],
  ["panel hidden", { window: MAC, layout: LAYOUT({ panel: { hidden: true } }), shared: { "workspace.panels": ["files", "git"] } }],
  ["landing stack", { window: MAC, spaces: [SPACE([])], layout: LAYOUT({ main: { active: "main-landing" } }) }],
  ["remembered panel", { window: MAC, state: { panels: { s1: "git" } }, layout: LAYOUT({ panel: { hidden: true } }), shared: { "workspace.panels": ["files", "git"] } }],
  ["remembered hide", { window: MAC, state: { panels: { s1: null } }, shared: { "workspace.panels": ["files", "git"] } }],
  ["unified", { window: MAC, props: unified, panes: AGENTS }],
  ["unified sidebar hidden", { window: MAC, props: unified, layout: LAYOUT({ sidebar: { hidden: true } }) }],
  ["unified narrow sidebar", { window: MAC, props: unified, layout: LAYOUT({ sidebar: { size: { px: 90 } } }) }],
  ["unified panel hidden, zoom", { window: MAC, props: unified, layout: LAYOUT({ panel: { hidden: true } }), settings: { zoom: 2 } }],
  ["unified native pinned", { window: MAC, props: { ...unified, motion: "native", pinSidebarTerminal: true }, state: { nativeHeaderWidth: 1000 } }],
  ["unified native clocks", { window: MAC, props: { ...unified, motion: "native" }, steps: [(t) => { t.drawers.sidebar.clockPx = 77; t.drawers.panel.clockPx = 55; }] }],
  ["unified busy drawers", { window: MAC, props: unified, steps: [(t) => { t.drawers.sidebar.busy = true; t.drawers.panel.busy = true; }] }],
  ["unified main already flexible", { window: MAC, props: unified, layout: LAYOUT({ main: { size: undefined } }) }],
  ["unified pending toggles", { window: MAC, props: unified, state: { wantToggle: 3, wantPanelToggle: 2 } }],
  ["plain pending toggle", { window: MAC, state: { wantToggle: 1, wantPanelToggle: 1 } }],
  ["overflow", { window: MAC, state: overflow, panes: AGENTS }],
  ["overflow scrolled", { window: MAC, state: { ...overflow, scrollX: 100, activeTabId: "a" } }],
  ["overflow scrolled to end, active last", { window: MAC, spaces: [SPACE(FOUR.map((c) => ({ ...c, active: c.id === "d" })))], state: { ...overflow, scrollX: 500 } }],
  ["overflow sliding", { window: MAC, state: { ...overflow, scrollX: 100, animatedUntil: Number.MAX_SAFE_INTEGER } }],
  ["overflow unified", { window: MAC, props: unified, state: { ...overflow, scrollX: 50 } }],
  ["unmeasured widths", { window: MAC, state: { viewportWidth: 300, tabWidths: new Map([["a", 144]]) } }],
  ["hovered tab", { window: MAC, state: { hoveredTab: "b" } }],
  ["hovered active tab", { window: MAC, state: { hoveredTab: "a" } }],
  ["dragging a tab", { window: MAC, state: { pressed: 0, overTab: "c", overSide: "left" } }],
  ["dragging a tab, right side", { window: MAC, state: { pressed: 3, overTab: "b", overSide: "right" } }],
  ["pressed on own tab", { window: MAC, state: { pressed: 0, overTab: "a", overSide: null } }],
  ["pane drag over the strip", { window: MAC, shared: { "orca-tabs.pane-drag": { active: true, inTabStrip: true, pane: "p1", terminal: "tty-p1" } } }],
  ["pane drag below the strip", { window: MAC, shared: { "orca-tabs.pane-drag": { active: true, inTabStrip: false } } }],
  ["unified mixed apps", { window: MAC, props: unified, panes: [
    pane("p1", "a", { app: "kilo", program: { agent: true } }), pane("p2", "b", { program: { icon: "own.png", tint: false } }),
    pane("p3", "c", { program: { icon: "own.svg", tint: true } }), pane("p4", "d", { app: "freebuff", program: {} })] }],
  ["terminal unofficial and cursor", { window: MAC, panes: [pane("p1", "a", { app: "cursor", program: { agent: true } }), pane("p2", "b", { app: "grok" }),
    pane("p3", "c", { app: "qoder" }), pane("p4", "d", { app: "dsh-tui", program: { name: "dsh" } })], terminals: TERMINALS }],
  ["pane titles instead of tab names", { window: MAC, spaces: [SPACE([{ id: "a", status: "idle", active: true }, { id: "b", name: "x", status: "working" }])],
    panes: [pane("p1", "a", { program: { name: "zsh" } }), pane("p2", "b", { title: "" , program: { name: "bash" } })] }],
  ["init dialog props", { window: MAC, initProps: { confirmClose: { kind: "pinned" } }, props: { confirmClose: { kind: "pinned", tabId: "a", tabLabel: "Tab a" }, overlay: "ov" } }],
  ["init drop overlay props", { props: { drop: true, overlay: "ov" }, shared: { "orca-tabs.drop": { tab: "a", zone: "left", strip: { x: 0, y: 0, width: 900, height: 600, stripHeight: 36 } } } }],
];

const DIALOGS = [
  {}, { kind: "command", tabId: "a", tabLabel: "build" }, { kind: "agent", tabId: "a", tabLabel: "claude" }, { kind: "pinned", tabId: "a", tabLabel: "pin" },
  { kind: "bulk", scope: "others", tabIds: ["a", "b"] }, { kind: "bulk", scope: "right", tabIds: ["a"] }, { kind: "bulk", scope: "left", tabIds: [], detail: "3 tabs in 2 worktrees" },
  { kind: "bulk", tabIds: undefined }, { kind: "bulk", scope: "weird", tabIds: ["x"] },
];
for (const cfg of DIALOGS) {
  for (const again of [false, true]) {
    SCENARIOS.push([`dialog ${JSON.stringify(cfg)} again=${again}`, { props: { confirmClose: cfg, overlay: "ov" }, initProps: { confirmClose: cfg }, state: { dontAskAgain: again } }]);
  }
}
const STRIP = { x: 100, y: 50, width: 800, height: 601, stripHeight: 36 };
for (const zone of [null, "up", "down", "left", "right"]) {
  SCENARIOS.push([`drop overlay ${zone}`, { props: { drop: true, overlay: "ov" }, initProps: { drop: true }, shared: { "orca-tabs.drop": { tab: "a", zone, strip: STRIP } } }]);
}
SCENARIOS.push(["drop overlay without a record", { props: { drop: true, overlay: "ov" }, initProps: { drop: true } }]);
SCENARIOS.push(["drop overlay own zone", { props: { drop: true, overlay: "ov" }, initProps: { drop: true }, state: { zone: "down" }, shared: { "orca-tabs.drop": { tab: "a", zone: "down", strip: { ...STRIP, stripHeight: 0 } } } }]);
SCENARIOS.push(["actions are consumed", { window: MAC, shared: { "orca-tabs.action": { kind: "unsplit-to-tab", pane: "p1" } }, panes: AGENTS }]);

const GOLDEN = "a9d5431823582476599c958d93d4ac7fc1974b288cd680d0827a08fe43fbbfcb";

test("golden render and commands over the state matrix", () => {
  const realNow = Date.now;
  Date.now = () => 1_700_000_000_000;
  let text;
  try {
    text = SCENARIOS.map(([name, options]) => JSON.stringify(scenario(name, options), (key, value) => (value instanceof Map ? [...value] : value), 1)).join("\n");
  } finally {
    Date.now = realNow;
  }
  if (process.env.GOLDEN_DUMP) {
    mkdirSync(process.env.GOLDEN_DUMP, { recursive: true });
    writeFileSync(`${process.env.GOLDEN_DUMP}/orca-tabs-golden.json`, text);
  }
  const hash = createHash("sha256").update(text).digest("hex");
  if (GOLDEN === "unset") console.log("GOLDEN", hash, text.length);
  assert.equal(hash, GOLDEN);
});
