import { it, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import Pane from "../../../src/mods/orca-pane-header/main.js";
import type { TerminalInfo } from "../../../src/mods/orca-pane-header/crew.js";
import { asyncContext, resetHost, type TestPane, type TestSpace } from "./host.js";
import { nodeOf } from "./recording.js";

vi.mock("gpui-kit", async () => {
  const { View, element } = await import("./recording.js");
  return { View, div: element("div"), svg: element("svg"), image: element("image") };
});

vi.mock("gpui-base", async () => {
  const { element } = await import("./recording.js");
  return { h_flex: element("h_flex"), v_flex: element("v_flex") };
});

vi.mock("herdr", async () => {
  const { herdrMock } = await import("./host.js");
  return herdrMock();
});

const THEME: Record<string, string> = Object.fromEntries(
  ["surface", "foreground", "muted", "border", "working", "blocked"].map((key, i) => [
    key,
    `#${i}${i}${i}${i}${i}${i}`,
  ]),
);
const PANE: TestPane = { pane: "p", tab: "tab", terminal: "tty", title: "Shell", focused: true };
const TAB = { id: "tab", named: true, name: "My Tab", active: true };
const member = (
  address: string,
  status: string | null,
  extra: Partial<TerminalInfo> = {},
): TerminalInfo => ({ address, parent: "tty", state: "live", status, ...extra });
const CREW: TerminalInfo[] = [
  member("c1", "working", {
    title: "build",
    report: { app: "codex" },
    program: { icon: "own.svg", tint: true },
  }),
  member("c2", "blocked", { report: { app: "omp" } }),
  member("c3", "done", { program: { name: "aider-cli" } }),
  member("c4", "idle", { report: { app: "gemini" } }),
  member("c5", "working", { report: { app: "droid" } }),
  member("c6", "working", { program: { icon: "x.png", tint: false } }),
  member("c7", "working"),
  member("c8", "dead", { status: "idle", state: "gone" }),
  { address: "tty", parent: "boss", state: "live" },
  { address: "boss", status: "blocked", title: " Boss ", report: { app: "cursor" } },
];

type ScenarioOptions = {
  panes?: TestPane[];
  terminals?: TerminalInfo[];
  settings?: Record<string, unknown>;
  props?: Record<string, unknown>;
  spaces?: TestSpace[];
  state?: Record<string, unknown>;
  steps?: Array<(view: Pane) => void>;
};

function scenario(name: string, o: ScenarioOptions = {}) {
  const log: unknown[][] = [];
  resetHost({
    panes: o.panes ?? [PANE],
    terminals: o.terminals ?? [],
    settings: o.settings ?? {},
    spaces: o.spaces ?? [{ tabs: [TAB] }],
    props: o.props ?? { pane: "p" },
    theme: THEME,
    onSetShared: (...args) => log.push(["setShared", ...args]),
    onOpenOverlay: (spec) => log.push(["openOverlay", spec]),
    onCloseOverlay: (id) => log.push(["closeOverlay", id]),
  });
  const cx = asyncContext({
    notify: () => log.push(["notify"]),
    timer: { every: (ms: number) => log.push(["every", ms]) },
  });
  const view = new Pane();
  view.init({}, cx);
  if (o.state) Object.assign(view, o.state);
  const trees = (o.steps ?? [() => {}]).map((step) => {
    step(view);
    return nodeOf(view.render(cx));
  });
  return { name, trees, log };
}

const SPLIT: TestPane[] = [PANE, { ...PANE, pane: "other", terminal: "tty2", focused: false }];
const SCENARIOS: Array<[string, ScenarioOptions]> = [
  ["focused single", {}],
  ["unfocused split", { panes: [{ ...PANE, focused: false }, SPLIT[1]] }],
  ["focused split hovered", { panes: SPLIT, state: { hovered: true } }],
  ["single hovered", { state: { hovered: true } }],
  [
    "unnamed tab shows the pane title",
    { spaces: [{ tabs: [{ id: "tab", named: false, name: "x" }] }] },
  ],
  ["pane title missing", { panes: [{ ...PANE, title: "" }], spaces: [{ tabs: [{ id: "tab" }] }] }],
  ["tab not found", { spaces: [{ tabs: [] }] }],
  ["no pane", { props: { pane: "gone" } }],
  ["crew chip with every status", { terminals: CREW }],
  [
    "crew chip, only a manager",
    {
      terminals: [
        { address: "tty", parent: "boss" },
        { address: "boss", status: "idle" },
      ],
    },
  ],
  ["crew chip, one managed agent", { terminals: [member("c1", "done")], state: {} }],
  ["unfocused with crew", { terminals: CREW, panes: [{ ...PANE, focused: false }, SPLIT[1]] }],
  [
    "header after the crew changes",
    {
      terminals: CREW,
      steps: [
        () => {},
        (view) => {
          view.crew = { managing: [], managedBy: null };
        },
      ],
    },
  ],
  ["popup, crew", { terminals: CREW, props: { overlay: "ov", pane: "p" } }],
  [
    "popup, managed only",
    {
      terminals: [
        { address: "tty", parent: "boss" },
        { address: "boss", status: "working", program: { name: "pi" } },
      ],
      props: { overlay: "ov", pane: "p" },
    },
  ],
  ["popup, empty crew", { props: { overlay: "ov", pane: "p" } }],
  ["popup follows the focused pane", { terminals: CREW, props: { overlay: "ov" } }],
  ["popup, pane gone", { terminals: CREW, props: { overlay: "ov", pane: "gone" } }],
  [
    "popup, tab no longer shown",
    {
      terminals: CREW,
      props: { overlay: "ov", pane: "p" },
      spaces: [{ tabs: [{ ...TAB, active: false }] }],
    },
  ],
  ["popup, no space", { terminals: CREW, props: { overlay: "ov", pane: "p" }, spaces: [] }],
];

const GOLDEN: string = "9e391cb2fe38eb0066aa23b0d4e0c85096ebe14e4f472f7a8c1f105fa2a36936";

it("golden render over the pane header and popup states", () => {
  const text = SCENARIOS.map(([name, options]) =>
    JSON.stringify(scenario(name, options), null, 1),
  ).join("\n");
  if (process.env.GOLDEN_DUMP) {
    mkdirSync(process.env.GOLDEN_DUMP, { recursive: true });
    writeFileSync(`${process.env.GOLDEN_DUMP}/orca-pane-golden.json`, text);
  }
  const hash = createHash("sha256").update(text).digest("hex");
  if (GOLDEN === "unset") console.log("GOLDEN", hash, text.length);
  assert.equal(hash, GOLDEN);
});
