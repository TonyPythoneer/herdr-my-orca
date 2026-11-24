// Golden render of the floating workspace: closed, empty, and listing agents of every status and
// mark, at several viewport sizes. Handlers are recorded by name ("fn"). Set GOLDEN_DUMP=<dir>
// to write the full text.
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
    export const agents = () => globalThis.host.agents;
    export const keys = () => globalThis.host.keys;
    export const nextCommand = () => new Promise(() => {});
    export const setShared = (...args) => globalThis.host.log.push(["setShared", ...args]);
    export const openOverlay = (...args) => globalThis.host.log.push(["openOverlay", ...args]);`;
  return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
} });
const { default: Workspace } = await import("./main.js");

const THEME = Object.fromEntries(["foreground", "muted", "border", "raised", "hover", "working", "blocked", "done", "idle"].map((key, i) => [key, `#${i}${i}${i}${i}${i}${i}`]));
const agent = (address, status, extra = {}) => ({ address, status, app: "", title: "", ...extra });
const MANY = [
  agent("a1", "working", { app: "codex", title: " Build ", program: { icon: "x/codex.svg" }, space_name: "work", tab_name: "main" }),
  agent("a2", "blocked", { app: "omp", space: "s2", tab_index: 3 }), agent("a3", "done", { app: "gemini", program: { name: "gem" } }),
  agent("a4", "idle", { app: "aider" }), agent("a5", "working", { app: "kilo" }), agent("a6", "idle", { app: "cursor" }),
  agent("a7", "done", { app: "codex" }), agent("a8", "working", { program: { icon: "own.svg", tint: true, name: "tool" } }),
  agent("a9", "idle", { program: { icon: "own.png", tint: false } }), agent("a10", "done", { app: "unknown-app" }), agent("a11", "weird"),
];
const KEYS = [{ action: "orca-tabs.new-tab", keys: "Ctrl + T" }, { action: "orca-float.toggle", keys: "Ctrl + Alt + A" }];

function scenario(name, o = {}) {
  const log = [];
  globalThis.host = { agents: o.agents ?? [], keys: o.keys, log };
  globalThis.window = { viewport_size: () => o.viewport ?? { width: 1400, height: 900 } };
  globalThis.__herdrTheme = () => THEME;
  globalThis.__herdrSpaces = () => o.spaces ?? [];
  const view = new Workspace();
  view.init({}, { spawn: () => log.push(["spawn"]), timer: { every: (ms) => log.push(["every", ms]) } });
  view.open = o.open ?? true;
  return { name, tree: view.render().__node, log };
}

const SCENARIOS = [
  ["closed", { open: false, agents: MANY }],
  ["empty without keys", {}],
  ["empty with keys", { keys: KEYS }],
  ["empty with only the toggle key", { keys: [KEYS[1]] }],
  ["one agent", { agents: [MANY[0]], keys: KEYS }],
  ["many agents", { agents: MANY, keys: KEYS }],
  ["small viewport", { agents: MANY.slice(0, 2), viewport: { width: 300, height: 200 } }],
  ["medium viewport", { agents: MANY.slice(0, 2), viewport: { width: 700, height: 500 } }],
  ["large viewport", { agents: MANY.slice(0, 2), viewport: { width: 5000, height: 5000 } }],
];

const GOLDEN = "c7274ccc57b419b4913ce8d1670933282ce9fd6225fbabf96f42d23e182e602b";

test("golden render of the floating workspace", () => {
  const text = SCENARIOS.map(([name, options]) => JSON.stringify(scenario(name, options), null, 1)).join("\n");
  if (process.env.GOLDEN_DUMP) {
    mkdirSync(process.env.GOLDEN_DUMP, { recursive: true });
    writeFileSync(`${process.env.GOLDEN_DUMP}/orca-float-golden.json`, text);
  }
  const hash = createHash("sha256").update(text).digest("hex");
  if (GOLDEN === "unset") console.log("GOLDEN", hash, text.length);
  assert.equal(hash, GOLDEN);
  delete globalThis.window;
});
