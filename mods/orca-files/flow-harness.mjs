// Test harness for main.js: the real module runs against the recorder stubs in scripts/gpui-stub-loader.mjs,
// with the inputs, editors and host calls it needs swapped for fakes a test can drive and read back.
import { register } from "node:module";
import { goldenSuite } from "./golden.mjs";

Date.now = () => 1700000000000;
Math.random = () => 0.5;

const loader = new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url).href;
const OVERRIDDEN = ["InputState", "EditorState", "VirtualListScrollHandle", "watchFolder", "nextCommand", "setShared", "openOverlay", "window", "readTextFile", "writeTextFile"];
register("data:text/javascript," + encodeURIComponent(`
  import { load as record } from ${JSON.stringify(loader)};
  export { resolve } from ${JSON.stringify(loader)};
  const OVERRIDDEN = ${JSON.stringify(OVERRIDDEN)};
  export async function load(url, ctx, next) {
    const result = await record(url, ctx, next);
    if (!url.startsWith("stub:")) return result;
    // Every function a chained call receives is logged with its element id and method, so a test can run a real handler.
    const source = result.source.replace(/^export const (\\w+) = .*$/gm, (line, name) =>
      OVERRIDDEN.includes(name) ? "export const " + name + " = globalThis.__fake." + name + ";" : line)
      .replace("rec.c.push([key, a.map(cleanse)]); return proxy;", "for (const x of a) if (typeof x === 'function') globalThis.__fns.push({ id: rec.c.find(([k]) => k === 'id')?.[1][0], node: rec.n, key, fn: x }); rec.c.push([key, a.map(cleanse)]); return proxy;")
      .replace("const rec = { n: name, a: args.map(cleanse), c: [] };", "const rec = { n: name, a: args.map(cleanse), c: [] }; for (const x of args) if (typeof x === 'function') globalThis.__fns.push({ node: name, key: 'arg', fn: x });");
    return { ...result, source };
  }`));

globalThis.__fns = [];
export const handler = (id, key, node) => globalThis.__fns.findLast((h) => h.key === key && (id === undefined || h.id === id) && (!node || h.node === node))?.fn;

export class FakeInput {
  #value = ""; #handlers = {}; #log = [];
  constructor(opts) { this.opts = opts; }
  static new(opts) { return new FakeInput(opts); }
  value() { return this.#value; }
  set_value(text) { this.#value = text; this.#log.push(["set_value", text]); }
  set_selected_range(range) { this.#log.push(["range", range]); }
  focus() { this.#log.push(["focus"]); }
  on(event, callback) { (this.#handlers[event] ??= []).push(callback); }
  emit(event, cx) { for (const callback of this.#handlers[event] ?? []) callback({}, cx); }
  log() { return this.#log.splice(0); }
}

export class FakeEditor {
  #value;
  constructor(opts) { this.opts = { language: opts.language, readonly: opts.readonly, font_family: opts.font_family, font_size: opts.font_size, syntax: opts.syntax }; this.#value = world.normalize ? world.normalize(opts.value) : opts.value; this.released = false; this.handlers = []; }
  static new(opts) { return new FakeEditor(opts); }
  value() { return this.#value; }
  on(_event, callback) { this.handlers.push(callback); }
  release() { this.released = true; }
  type(text, cx) { this.#value = text; for (const callback of this.handlers) callback({}, cx); }
}

export const THEME = Object.fromEntries(["background", "foreground", "surface", "popover", "raised", "selected", "hover", "border", "muted", "dim", "accent_foreground",
  "blocked", "ansi1", "ansi2", "ansi3", "ansi4", "ansi5", "ansi6", "solid", "solid_foreground", "ring"].map((name, i) => [name, `#${(i + 16).toString(16)}2233`]));
THEME.accent = "#336699"; THEME.input = "#445566cc";

// One mutable bag for everything the host would own; `reset()` returns it to an empty workspace.
export const world = {};
export function reset(extra = {}) {
  Object.assign(world, {
    files: new Map(), writes: [], failWrite: null, execLog: [], exec: () => ({ code: 0, stdout: "", stderr: "" }),
    overlays: [], closed: [], runs: [], shared: new Map(), sharedLog: [], timers: [], waiters: [], watchers: [], watchError: null,
    platform: "macos", props: {}, spaces: [{ id: "s1", active: true, folder: "/repo", machine: null }], notifies: 0, jobs: [], copied: [], normalize: null, onRead: null, spawnErrors: [], stopped: 0, scrolled: undefined, treeFocused: true, focused: false,
    ...extra,
  });
}
reset();

globalThis.__fake = {
  InputState: FakeInput, EditorState: FakeEditor, VirtualListScrollHandle: { new: () => ({ scroll_to_item(index) { world.scrolled = index; } }) },
  watchFolder: () => new Promise((resolve, reject) => { if (world.watchError) reject(world.watchError); else world.watchers.push(resolve); }),
  nextCommand: () => new Promise((resolve) => world.waiters.push(resolve)),
  setShared: (key, value) => { world.sharedLog.push([key, value]); world.shared.set(key, value); },
  openOverlay: (options) => { world.overlays.push(options); return `overlay-${world.overlays.length}`; },
  window: () => ({ platform: world.platform }),
  readTextFile: async (path) => { world.onRead?.(path); if (!world.files.has(path)) throw new Error(`ENOENT ${path}`); return world.files.get(path); },
  writeTextFile: async (path, text, expected) => { world.writes.push([path, text, expected]); if (world.failWrite) throw world.failWrite; world.files.set(path, text); },
};
globalThis.__herdrProps = () => world.props;
globalThis.__herdrTheme = () => THEME;
globalThis.__herdrSpaces = () => world.spaces;
globalThis.__herdrRun = (command, args) => { world.runs.push(args === undefined ? [command] : [command, args]); };
globalThis.__herdrCloseOverlay = (id) => { world.closed.push(id); };
globalThis.__herdrShared = (key) => world.shared.get(key);
globalThis.__herdrExec = (cmd, args, options) => { world.execLog.push([cmd, args, options]); return world.exec(cmd, args, options); };
globalThis.__clipboard_write_text = (text) => { world.copied.push(text); };

// `cx.spawn` runs its body at once up to the first await, like the host's; timers wait for `fire`.
export function makeCx() {
  const cx = {
    notify() { world.notifies++; }, stop_propagation() { world.stopped = (world.stopped ?? 0) + 1; },
    spawn(body) { const job = Promise.resolve(body(cx)); job.catch((error) => world.spawnErrors.push(String(error))); world.jobs.push(job); return job; },
    timer: {
      after(ms, fn) { const timer = { ms, fn, cancelled: false, cancel() { timer.cancelled = true; } }; world.timers.push(timer); return timer; },
      every(ms, fn) { const timer = { ms, fn, every: true, cancel() {} }; world.timers.push(timer); return timer; },
    },
    focus_handle: () => ({ focus() { world.focused = true; }, is_focused: () => world.treeFocused ?? true }),
  };
  return cx;
}
export const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve)); };
export const fire = async (index, cx) => { const timer = world.timers[index]; await timer.fn(cx); await settle(); };
export const deliver = async (command) => { world.waiters.shift()(command); await settle(); };

export const { default: Files } = await import("./main.js");

export { goldenSuite };

export async function fresh(setup) {
  reset(); setup?.();
  const cx = makeCx(), view = new Files();
  view.init({}, cx); await settle();
  return { view, cx };
}
