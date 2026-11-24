// Golden render of the pane header and the crew popup over the states that change them: focus,
// hover, split count, tab naming, crew size and status mix, and a popup whose pane is gone.
// Handlers are recorded by name ("fn"). Set GOLDEN_DUMP=<dir> to write the full text.
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
    export const settings = () => globalThis.host.settings;
    export const setShared = (...args) => globalThis.host.log.push(["setShared", ...args]);
    export const openOverlay = (...args) => globalThis.host.log.push(["openOverlay", ...args]);`;
  return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
} });
const { default: View } = await import("./main.js");

const THEME = Object.fromEntries(["surface", "foreground", "muted", "border", "working", "blocked"].map((key, i) => [key, `#${i}${i}${i}${i}${i}${i}`]));
const PANE = { pane: "p", tab: "tab", terminal: "tty", title: "Shell", focused: true };
const TAB = { id: "tab", named: true, name: "My Tab", active: true };
const member = (address, status, extra = {}) => ({ address, parent: "tty", state: "live", status, ...extra });
const CREW = [member("c1", "working", { title: "build", report: { app: "codex" }, program: { icon: "own.svg", tint: true } }),
  member("c2", "blocked", { report: { app: "omp" } }), member("c3", "done", { program: { name: "aider-cli" } }), member("c4", "idle", { report: { app: "gemini" } }),
  member("c5", "working", { report: { app: "droid" } }), member("c6", "working", { program: { icon: "x.png", tint: false } }), member("c7", "working"),
  member("c8", "dead", { status: "idle", state: "gone" }), { address: "tty", parent: "boss", state: "live" }, { address: "boss", status: "blocked", title: " Boss ", report: { app: "cursor" } }];

function scenario(name, o = {}) {
  const log = [];
  globalThis.host = { panes: o.panes ?? [PANE], terminals: o.terminals ?? [], settings: o.settings ?? {}, log };
  globalThis.__herdrProps = () => o.props ?? { pane: "p" };
  globalThis.__herdrTheme = () => THEME;
  globalThis.__herdrSpaces = () => o.spaces ?? [{ tabs: [TAB] }];
  globalThis.__herdrCloseOverlay = (id) => log.push(["closeOverlay", id]);
  const cx = { notify: () => log.push(["notify"]), timer: { every: (ms) => log.push(["every", ms]) } };
  const view = new View();
  view.init({}, cx);
  Object.assign(view, o.state);
  const trees = (o.steps ?? [() => {}]).map((step) => { step(view); return view.render(cx).__node; });
  return { name, trees, log };
}

const SPLIT = [PANE, { ...PANE, pane: "other", terminal: "tty2", focused: false }];
const SCENARIOS = [
  ["focused single", {}],
  ["unfocused split", { panes: [{ ...PANE, focused: false }, SPLIT[1]] }],
  ["focused split hovered", { panes: SPLIT, state: { hovered: true } }],
  ["single hovered", { state: { hovered: true } }],
  ["unnamed tab shows the pane title", { spaces: [{ tabs: [{ id: "tab", named: false, name: "x" }] }] }],
  ["pane title missing", { panes: [{ ...PANE, title: "" }], spaces: [{ tabs: [{ id: "tab" }] }] }],
  ["tab not found", { spaces: [{ tabs: [] }] }],
  ["no pane", { props: { pane: "gone" } }],
  ["crew chip with every status", { terminals: CREW }],
  ["crew chip, only a manager", { terminals: [{ address: "tty", parent: "boss" }, { address: "boss", status: "idle" }] }],
  ["crew chip, one managed agent", { terminals: [member("c1", "done")], state: {} }],
  ["unfocused with crew", { terminals: CREW, panes: [{ ...PANE, focused: false }, SPLIT[1]] }],
  ["header after the crew changes", { terminals: CREW, steps: [() => {}, (view) => { view.crew = { managing: [], managedBy: null }; }] }],
  ["popup, crew", { terminals: CREW, props: { overlay: "ov", pane: "p" } }],
  ["popup, managed only", { terminals: [{ address: "tty", parent: "boss" }, { address: "boss", status: "working", program: { name: "pi" } }], props: { overlay: "ov", pane: "p" } }],
  ["popup, empty crew", { props: { overlay: "ov", pane: "p" } }],
  ["popup follows the focused pane", { terminals: CREW, props: { overlay: "ov" } }],
  ["popup, pane gone", { terminals: CREW, props: { overlay: "ov", pane: "gone" } }],
  ["popup, tab no longer shown", { terminals: CREW, props: { overlay: "ov", pane: "p" }, spaces: [{ tabs: [{ ...TAB, active: false }] }] }],
  ["popup, no space", { terminals: CREW, props: { overlay: "ov", pane: "p" }, spaces: [] }],
];

const GOLDEN = "44d42c946418816fa1fbf1579f0d964f129c1eaeae94e657760ffe7f8acb04b4";

test("golden render over the pane header and popup states", () => {
  const text = SCENARIOS.map(([name, options]) => JSON.stringify(scenario(name, options), null, 1)).join("\n");
  if (process.env.GOLDEN_DUMP) {
    mkdirSync(process.env.GOLDEN_DUMP, { recursive: true });
    writeFileSync(`${process.env.GOLDEN_DUMP}/orca-pane-golden.json`, text);
  }
  const hash = createHash("sha256").update(text).digest("hex");
  if (GOLDEN === "unset") console.log("GOLDEN", hash, text.length);
  assert.equal(hash, GOLDEN);
});
