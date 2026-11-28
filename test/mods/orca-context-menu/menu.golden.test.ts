import { it, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AsyncContext } from "gpui-kit";
import type { MenuProps, MenuTarget } from "../../../src/mods/orca-context-menu/main.js";
import {
  digest,
  flush,
  host,
  log,
  plain,
  resetHost,
  summary,
  cleanse,
  contextOf,
  focusHandle,
  type Effect,
} from "./host.js";
import { AGENT } from "../../../src/config/definitions/agent-catalog.js";

vi.mock("gpui-kit", async () => {
  const { element } = await import("./host.js");
  return { View: class {}, div: element("div"), svg: element("svg") };
});
vi.mock("gpui-base", async () => {
  const { element } = await import("./host.js");
  return { h_flex: element("h_flex"), v_flex: element("v_flex") };
});
vi.mock("herdr", async () => (await import("./host.js")).herdrMock());
vi.mock("../../../src/shared/clip.ts", async () => {
  const { host } = await import("./host.js");
  return { copyText: (text: unknown, cx: unknown) => host.onCopy?.(text, cx) };
});
vi.mock("../../../src/shared/transcript.ts", () => ({
  buildBoundedSessionTranscript: (text: string) => text.trim() && `clean:${text.trim()}`,
}));

import Menu, {
  closeRow,
  isDestructive,
  items,
  keyHint,
  menuIcon,
  section,
  shortcut,
  stored,
} from "../../../src/mods/orca-context-menu/main.js";

const GOLDEN = new URL("../../../mods/orca-context-menu/menu.golden.json", import.meta.url);

type Scenario = {
  props?: MenuProps;
  ls?: Record<string, string>;
  lsThrows?: boolean;
  exec?: { throws?: boolean; fail?: boolean; top?: string; common?: string };
  hc?: { code: number; stdout: string };
  dark?: boolean;
};

const tab = (id: string, more: Record<string, unknown> = {}) => ({ id, ...more });
const SPACES = [
  {
    id: "s1",
    folder: "/repo",
    machine: null,
    name: "repo",
    branch: "main",
    tabs: [
      tab("t1", { named: true, name: "Build", settled: true }),
      tab("t2"),
      tab("t3", { settled: true, status: "working" }),
    ],
  },
  {
    id: "s2",
    folder: "/repo",
    machine: null,
    name: "repo2",
    tabs: [tab("t4"), tab("t6", { settled: true })],
  },
  { id: "s3", folder: "/repo/wt", machine: "m", named: true, name: "Linked", tabs: [tab("t5")] },
  {
    id: "s4",
    folder: "/other",
    machine: null,
    name: "other",
    tabs: [tab("t7", { status: "blocked" })],
  },
];
const PANES = [
  {
    pane: "p1",
    tab: "t1",
    focused: true,
    program: { agent: AGENT.claude, name: AGENT.claude },
    status: "working",
    title: "Claude",
    zoomed: true,
  },
  { pane: "p2", tab: "t1", program: { name: "zsh", shell: true } },
  { pane: "p3", tab: "t2", program: { name: "vim" }, title: "" },
  { pane: "p4", tab: "t4" },
  { pane: "p5", tab: "t3", status: "blocked" },
  { pane: "p6", tab: "t5", program: { name: "zsh", shell: true } },
  { pane: "p7", tab: "t6" },
  { pane: "p8", tab: "t7" },
];
const TERMINALS = [
  { address: "a1", agent: true, parent: "a0", labels: { "herdr.right-click": "program" } },
  { address: "a0", name: "Boss" },
  { address: "a2" },
  { address: "a3", parent: "zz" },
];
const KEYS = [
  { action: "pane.split:right", keys: "cmd-d" },
  { action: "tab.close", keys: "cmd-w" },
  { action: "app.help", keys: "f1" },
  { action: "tab.rename", keys: "f2" },
  { action: "pane.zoom", keys: "ctrl-shift-alt-z" },
  { action: "space.new", keys: "cmd-n" },
];

const withPane = (pane: string | undefined, extra: Partial<MenuTarget> = {}): MenuProps => ({
  tab: "pane",
  overlay: "ov",
  target: { pane, terminal: "a1", ...extra },
});
const SCENARIOS: Record<string, Scenario> = {
  "pane, agent in a split tab": { props: withPane("p1") },
  "pane, shell in the same tab": { props: withPane("p2", { terminal: "a2" }) },
  "pane, alone in a pinned tab": { props: withPane("p7", { terminal: "a2" }) },
  "pane, alone in an unpinned tab": { props: withPane("p4", { terminal: "a3" }) },
  "pane, no terminal and no known pane": { props: withPane(undefined, { terminal: undefined }) },
  "pane, unknown ids": { props: withPane("nope", { terminal: "nope" }) },
  "tab with panes, pinned, split": {
    props: { tab: "tab", overlay: "ov", target: { id: "t1", space: "s1" } },
  },
  "tab, running command": { props: { tab: "tab", overlay: "ov", target: { id: "t2" } } },
  "tab, agent status, pinned": { props: { tab: "tab", overlay: "ov", target: { id: "t3" } } },
  "tab, only tab of its space": { props: { tab: "tab", overlay: "ov", target: { id: "t5" } } },
  "tab, no panes": { props: { tab: "tab", overlay: "ov", target: { id: "t6" } } },
  "tab, blocked status, unnamed": { props: { tab: "tab", overlay: "ov", target: { id: "t7" } } },
  "tab, unknown": { props: { tab: "tab", overlay: "ov", target: { id: "zz" } } },
  "tab, pinned close skipped": {
    props: { tab: "tab", overlay: "ov", target: { id: "t1" } },
    ls: { "orca.confirmClosePinnedTab": "false" },
  },
  "tab, running close skipped": {
    props: { tab: "tab", overlay: "ov", target: { id: "t2" } },
    ls: { "orca.skipCloseTerminalWithRunningProcessConfirm": "true" },
  },
  "tab, storage throws": {
    props: { tab: "tab", overlay: "ov", target: { id: "t1" } },
    lsThrows: true,
  },
  "group, open space with children": {
    props: {
      tab: "group",
      overlay: "ov",
      target: {
        id: "s1",
        path: "/repo",
        spaces: ["s1", "s2", "s3", "x:1"],
        repo: "r1",
        machine: "m",
      },
    },
  },
  "group, unopened project": {
    props: { tab: "group", overlay: "ov", target: { id: "gone", path: "/nowhere", repo: "r2" } },
  },
  "group, by folder prefix": {
    props: { tab: "group", overlay: "ov", target: { id: "g", path: "/repo" } },
  },
  "group, nothing at all": { props: { tab: "group", overlay: "ov", target: {} } },
  "space, open and linked": {
    props: {
      tab: "space",
      overlay: "ov",
      target: {
        id: "s3",
        linked: true,
        folder: "/repo/wt",
        branch: "feat",
        unread: true,
        machine: "m",
      },
    },
  },
  "space, open, main checkout": {
    props: {
      tab: "space",
      overlay: "ov",
      target: { id: "s1", linked: false, top: "/repo", repo: "r1" },
    },
  },
  "space, open, probe says linked": {
    props: { tab: "space", overlay: "ov", target: { id: "s3" } },
    exec: { top: "/repo/wt", common: "/repo/.git" },
  },
  "space, open, probe says main": {
    props: { tab: "space", overlay: "ov", target: { id: "s1" } },
    exec: { top: "/repo", common: "/repo/.git" },
  },
  "space, open, probe fails": {
    props: { tab: "space", overlay: "ov", target: { id: "s1" } },
    exec: { fail: true },
  },
  "space, open, probe throws": {
    props: { tab: "space", overlay: "ov", target: { id: "s1" } },
    exec: { throws: true },
  },
  "space, unopened card with repo": {
    props: {
      tab: "space",
      overlay: "ov",
      multi: true,
      target: {
        id: "wt:/x",
        linked: true,
        path: "/x",
        named: true,
        name: "Pretty",
        repo: "r3",
        machine: "m",
      },
    },
  },
  "space, unopened card, folder only": {
    props: { tab: "space", overlay: "ov", target: { id: "wt:/y", folder: "/y/" } },
    exec: { fail: true },
  },
  global: { props: { tab: "global", overlay: "ov" } },
  "no props": { props: undefined },
};

function world(scn: Scenario, effects: Effect[]): void {
  const ls = new Map(Object.entries(scn.ls ?? {}));
  resetHost({
    props: scn.props,
    spaces: SPACES,
    panes: PANES,
    terminals: TERMINALS,
    keys: KEYS,
    theme: { foreground: "fg", popover: "pop", selected: "sel", muted: "mu", border: "bd" },
    effects,
  });
  host.onExec = async (_command, args) => {
    if (scn.exec?.throws) throw new Error("boom");
    if (scn.exec?.fail) return { code: 1, stdout: "" };
    return { code: 0, stdout: args.includes("--show-toplevel") ? scn.exec?.top : scn.exec?.common };
  };
  host.onHc = (args) => {
    log("hc", args);
    return Promise.resolve(scn.hc ?? { code: 0, stdout: "line one\nline two\n" });
  };
  host.onCopy = (text) => log("copyText", text);
  Object.assign(globalThis, {
    window: { appearance: () => (scn.dark === false ? "light" : "dark") },
    localStorage: {
      getItem: (key: string) => {
        if (scn.lsThrows) throw new Error("denied");
        return ls.has(key) ? ls.get(key)! : null;
      },
      setItem: (key: string, value: string) => {
        if (scn.lsThrows) throw new Error("denied");
        ls.set(key, value);
        log("localStorage.setItem", key, value);
      },
    },
  });
}

type Job = (cx: AsyncContext) => Promise<void>;
function cxFor(jobs: Job[], effects: Effect[]): AsyncContext {
  return contextOf({
    notify: () => effects.push(["notify"]),
    spawn: (job: Job) => jobs.push(job),
    focus_handle: () => focusHandle(() => effects.push(["focus"])),
  });
}

async function started(
  scn: Scenario,
  effects: Effect[],
): Promise<{ menu: Menu; cx: AsyncContext }> {
  world(scn, effects);
  const jobs: Job[] = [];
  const cx = cxFor(jobs, effects);
  const menu = new Menu();
  menu.init({}, cx);
  for (const job of jobs) await job(cx);
  return { menu, cx };
}

async function record(scn: Scenario): Promise<Record<string, unknown>> {
  const setup: Effect[] = [];
  const { menu, cx } = await started(scn, setup);
  const p = scn.props;
  const rows = items(p, menu.git);
  const out: Record<string, unknown> = {};
  const render: string[] = [];
  out.init = { git: menu.git, effects: setup };
  out.rows = plain(rows);
  out.icons = rows.map((row) => [menuIcon(row, false), menuIcon(row, true)]);
  out.sections = rows.map((_row, i) => section(p, rows, i));
  out.destructive = rows.map((row) => isDestructive(p, row));
  out.closeRow = rows.map((row) => closeRow(p, row));
  out.shortcuts = rows.map((row) => shortcut(row[1], row[2]));
  if (rows.length)
    for (const at of [0, rows.length - 1]) {
      menu.at = at;
      host.handlers.length = 0;
      render.push(digest(cleanse(menu.render())));
    }
  out.render = render;
  const hover = host.handlers.filter(([name]) => name === "on_hover").map(([, fn]) => fn);

  const driver = host.handlers.find(([name]) => name === "on_key_down")?.[1];
  const cursor: unknown[] = [];
  if (driver && rows.length)
    for (const key of [
      "down",
      "down",
      "up",
      "up",
      "end",
      "home",
      "x",
      "space",
      "enter",
      "escape",
    ]) {
      const effects: Effect[] = [];
      const w = await started(scn, effects);
      const rendered = w.menu;
      rendered.at = key === "x" ? 1 : 0;
      host.handlers.length = 0;
      rendered.render();
      effects.length = 0;
      host.handlers.find(([name]) => name === "on_key_down")![1]({ key }, w.cx);
      await flush();
      cursor.push([key, rendered.at, plain(effects)]);
    }
  out.keys = cursor;

  if (hover.length > 1) {
    const effects: Effect[] = [];
    menu.at = 0;
    hover[1](true, cx);
    hover[1](false, cx);
    out.hover = [menu.at, plain(effects)];
  }

  const choose: unknown[] = [];
  for (let i = 0; i <= rows.length; i++) {
    const effects: Effect[] = [];
    const w = await started(scn, effects);
    effects.length = 0;
    w.menu.choose(i, w.cx);
    await flush();
    choose.push(plain(effects));
  }
  out.choose = choose;

  const clicks: Effect[] = [];
  const w = await started(scn, clicks);
  host.handlers.length = 0;
  w.menu.render();
  const click = host.handlers.filter(([name]) => name === "on_click").map(([, fn]) => fn);
  clicks.length = 0;
  if (click.length) {
    click[click.length - 1]({}, w.cx);
    await flush();
  }
  out.click = plain(clicks);
  return out;
}

it("every menu records as before", async () => {
  const got: Record<string, unknown> = {};
  for (const [name, scn] of Object.entries(SCENARIOS)) got[name] = await record(scn);
  const now = summary(got);
  if (!existsSync(GOLDEN)) writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`);
  const expected: Record<string, Record<string, string>> = JSON.parse(readFileSync(GOLDEN, "utf8"));
  const changes = Object.fromEntries(
    Object.entries(now).flatMap(([scenario, sections]) => {
      const changed = Object.fromEntries(
        Object.entries(sections).filter(([key, value]) => expected[scenario]?.[key] !== value),
      );
      return Object.keys(changed).length ? [[scenario, changed]] : [];
    }),
  );
  if (Object.keys(changes).length) console.log("GOLDEN_CHANGED " + JSON.stringify(changes));
  assert.deepEqual(now, expected);
});

it("copy and transcript rows act on their own data", async () => {
  const effects: Effect[] = [];
  const scn: Scenario = {
    props: { tab: "pane", overlay: "ov", target: { pane: "p1", terminal: "a1" } },
    hc: { code: 0, stdout: "  \n" },
  };
  const { menu, cx } = await started(scn, effects);
  for (const label of ["Copy Context", "Copy Terminal Buffer", "Clear Screen", "Reset Terminal"]) {
    effects.length = 0;
    menu.choose(
      items(scn.props, null).findIndex((row) => row[0] === label),
      cx,
    );
    await flush();
    assert.ok(
      effects.some((e) => e[0] === "closeOverlay"),
      label,
    );
    assert.equal(
      effects.some((e) => e[0] === "copyText"),
      false,
      label,
    );
  }
});

it("key hints use glyphs for modifiers and keep a bare key as it is", async () => {
  await started({ props: undefined }, []);
  assert.deepEqual(["cmd-shift-d", "f2", undefined, "ctrl-alt-x", "cmd-w"].map(keyHint), [
    "⇧⌘D",
    "f2",
    "",
    "⌃⌥X",
    "⌘W",
  ]);
});

it("stored values are cached by raw text, and bad json falls back", async () => {
  await started({ props: undefined, ls: { good: '{"a":1}', arr: "[1]", bad: "{" } }, []);
  assert.deepEqual(
    plain([
      stored("good", 0),
      stored("good", 0),
      stored("arr", "f"),
      stored("bad", "f"),
      stored("none", "f"),
    ]),
    [{ a: 1 }, { a: 1 }, [1], "f", "f"],
  );
});
