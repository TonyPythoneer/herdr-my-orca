import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Context } from "gpui-kit";
import type { ExecResult } from "herdr";
import type { ForcePushTarget } from "../../../src/mods/orca-changes/push-target.js";
import type { OperationTarget } from "../../../src/mods/orca-changes/operation-target.js";
import type { Entry, EntryLike } from "../../../src/mods/orca-changes/main.js";
import type { PrSnapshot } from "../../../src/mods/orca-changes/create-pr.js";
import {
  builder,
  cleanse,
  factory,
  handlers,
  plain,
  recOf,
  theme,
  type HandlerRecord,
  type Rec,
} from "./recording.js";

type Palette = Record<string, string | boolean>;
type Space = { id: string; folder: string; machine: string | null; active?: boolean };
type Pane = { pane?: string; tab: string; focused?: boolean; mod?: string };
type Answer = ExecResult | ((args: string[]) => ExecResult);
type Script = Record<string, Answer>;
type Log = {
  exec: unknown[][];
  runs: unknown[][];
  shared: unknown[][];
  overlays: unknown[];
  closed: unknown[];
  copies: unknown[];
  dialogs: (() => unknown)[];
  timers: unknown[][];
  dialogClosed: number;
  pending: ((cx: Context) => unknown)[];
};
type State = {
  spaces: Space[];
  props: Record<string, unknown>;
  text?: string;
  inputText?: string;
  focusedSection?: boolean;
};
type Scope = {
  spaces: () => Space[];
  theme: () => Palette;
  focused: () => { tab: string };
  panes: () => Pane[];
  shared: (key: string) => unknown;
  setShared: (key: string, value: unknown) => number;
  window: { open_dialog: (fn: () => unknown) => void; close_dialog: () => void };
  run: (name: string, args?: unknown) => number;
  props: () => Record<string, unknown>;
  openOverlay: (spec: unknown) => number;
  closeOverlay: (id: unknown) => number;
  nextCommand: () => Promise<string>;
  watchFolder: (root: string) => Promise<unknown>;
  copyText: (text: unknown, cx?: unknown) => Promise<void>;
  reveal: (path: string, flag: boolean) => Promise<void>;
  exec: (cmd: string, args: string[], options?: unknown) => Promise<ExecResult>;
  panelFrame: (inner: unknown) => unknown;
  TextareaState: { new: () => unknown };
  InputState: { new: () => unknown };
};
type MainModule = typeof import("../../../src/mods/orca-changes/main.js");
type ChangesView = InstanceType<MainModule["default"]>;

const GOLDEN = new URL("./main.golden.json", import.meta.url);

function asContext(value: unknown): Context {
  return value as Context;
}

async function loadChanges(scope: Scope): Promise<MainModule> {
  vi.doMock("gpui-kit", () => ({
    View: class {},
    div: factory("div"),
    svg: factory("svg"),
  }));
  vi.doMock("gpui-base", () => ({
    v_flex: factory("v_flex"),
    h_flex: factory("h_flex"),
    TextareaState: scope.TextareaState,
    Textarea: builder("Textarea"),
    Input: builder("Input"),
    InputState: scope.InputState,
  }));
  vi.doMock("herdr", () => ({
    spaces: () => scope.spaces(),
    theme: () => scope.theme(),
    focused: () => scope.focused(),
    panes: () => scope.panes(),
    shared: (key: string) => scope.shared(key),
    setShared: (key: string, value: unknown) => scope.setShared(key, value),
    window: scope.window,
    run: (name: string, args?: unknown) => scope.run(name, args),
    props: () => scope.props(),
    openOverlay: (spec: unknown) => scope.openOverlay(spec),
    closeOverlay: (id: unknown) => scope.closeOverlay(id),
    nextCommand: () => scope.nextCommand(),
    watchFolder: (root: string) => scope.watchFolder(root),
    exec: (cmd: string, args: string[], options?: unknown) => scope.exec(cmd, args, options),
  }));
  vi.doMock("../../../src/shared/clip.js", () => ({
    copyText: (text: unknown, cx?: unknown) => scope.copyText(text, cx),
    reveal: (path: string, flag: boolean) => scope.reveal(path, flag),
  }));
  vi.doMock("../../../src/components/right-sidebar/panel-motion.js", () => ({
    panelFrame: (inner: unknown) => scope.panelFrame(inner),
  }));
  vi.resetModules();
  return import("../../../src/mods/orca-changes/main.js");
}

const FILES: Entry[] = [
  { path: "src/a.js", section: "changes", status: "M", fresh: false, add: 3, del: 1 },
  { path: "new file.txt", section: "changes", status: "U", fresh: true, add: 0, del: 0 },
  { path: "gone.js", section: "changes", status: "D", fresh: false, add: 0, del: 4 },
  { path: "added.js", section: "changes", status: "A", fresh: false, add: 5, del: 0 },
  { path: "staged.js", section: "staged", status: "M", fresh: false, add: 1, del: 1 },
  { path: "bin.png", section: "staged", status: "A", fresh: false, add: 0, del: 0, binary: true },
  { path: "c1.js", section: "conflicts", status: "!", xy: "DU", fresh: false, add: 0, del: 0 },
  { path: "c2.js", section: "conflicts", status: "!", xy: "UU", fresh: false, add: 0, del: 0 },
  { path: "c3.js", section: "conflicts", status: "!", xy: "DD", fresh: false, add: 0, del: 0 },
];

function gitAnswer(args: string[], script: Script): ExecResult {
  const line = args.join(" ");
  for (const [needle, answer] of Object.entries(script))
    if (line.includes(needle)) return typeof answer === "function" ? answer(args) : answer;
  if (line.includes("rev-parse --show-toplevel")) return { code: 0, stdout: "/repo\n", stderr: "" };
  if (line.includes("symbolic-ref --quiet HEAD"))
    return { code: 0, stdout: "refs/heads/topic\n", stderr: "" };
  if (line.includes("symbolic-ref refs/remotes/origin/HEAD"))
    return { code: 0, stdout: "refs/remotes/origin/main\n", stderr: "" };
  if (line.includes("for-each-ref"))
    return {
      code: 0,
      stdout:
        "refs/heads/topic\0origin\0refs/heads/topic\0refs/remotes/origin/topic\0origin\0refs/heads/topic\0refs/remotes/origin/topic",
      stderr: "",
    };
  if (line.includes("config --get-all remote.origin.push"))
    return { code: 1, stdout: "", stderr: "" };
  if (line.includes("config --get push.default")) return { code: 1, stdout: "", stderr: "" };
  if (line.includes("config --bool --get remote.origin.mirror"))
    return { code: 1, stdout: "", stderr: "" };
  if (line.includes("config --get-all branch.topic.merge"))
    return { code: 0, stdout: "refs/heads/topic\n", stderr: "" };
  if (line.includes("remote get-url --push --all origin"))
    return { code: 0, stdout: "https://u:p@example.com/r.git\n", stderr: "" };
  if (line.includes("rev-parse --verify HEAD^{commit}"))
    return { code: 0, stdout: `${"a".repeat(40)}\n`, stderr: "" };
  if (line.includes("rev-parse --verify refs/remotes/origin/topic^{commit}"))
    return { code: 0, stdout: `${"b".repeat(40)}\n`, stderr: "" };
  if (line.includes("--porcelain=v2"))
    return {
      code: 0,
      stdout: "u UU N... 100644 100644 100644 100644 h h h c2.js\0",
      stderr: "",
    };
  if (line.includes("ls-files")) return { code: 0, stdout: "src/a.js\0gone.js\0", stderr: "" };
  if (line.includes("diff --cached --numstat"))
    return { code: 0, stdout: "1\t1\tstaged.js\0", stderr: "" };
  if (line.includes("diff --numstat")) return { code: 0, stdout: "3\t1\tsrc/a.js\0", stderr: "" };
  if (line.includes("status --porcelain=v1"))
    return {
      code: 0,
      stdout: ["MM src/a.js", "?? new.txt", "UU c.js", "AD x"].join("\0"),
      stderr: "",
    };
  return { code: 0, stdout: "", stderr: "" };
}

type SetupOptions = {
  script?: Script;
  props?: Record<string, unknown>;
  spaceState?: Space[];
  withMain?: boolean;
};

type Env = {
  view: ChangesView;
  cx: Context;
  log: Log;
  state: State;
  sharedValues: Record<string, unknown>;
  scope: Scope;
  mod: MainModule;
  main?: ChangesView;
  notifies0: number;
  readonly notifies: number;
  tasks: unknown[];
};

async function setup(options: SetupOptions = {}): Promise<Env> {
  const script = options.script ?? {};
  const log: Log = {
    exec: [],
    runs: [],
    shared: [],
    overlays: [],
    closed: [],
    copies: [],
    dialogs: [],
    timers: [],
    dialogClosed: 0,
    pending: [],
  };
  const sharedValues: Record<string, unknown> = {
    "orca-diff.target": { path: "src/a.js", section: "changes" },
  };
  const state: State = {
    spaces: options.spaceState ?? [{ active: true, folder: "/repo", machine: "host", id: "s" }],
    props: { ...options.props },
  };
  const tasks: unknown[] = [];
  const scope: Scope = {
    spaces: () => state.spaces,
    theme: () => theme,
    focused: () => ({ tab: "t1" }),
    panes: () => [{ pane: "p1", tab: "t1", focused: true }],
    shared: (key: string) => sharedValues[key],
    setShared: (key: string, value: unknown) => log.shared.push([key, cleanse(value)]),
    window: {
      open_dialog: (fn: () => unknown) => {
        log.dialogs.push(fn);
      },
      close_dialog: () => {
        log.dialogClosed++;
      },
    },
    run: (name: string, args?: unknown) => log.runs.push([name, cleanse(args)]),
    props: () => state.props,
    openOverlay: (spec: unknown) => log.overlays.push(cleanse(spec)),
    closeOverlay: (id: unknown) => log.closed.push(id),
    nextCommand: () => new Promise<string>(() => {}),
    watchFolder: () => new Promise<unknown>(() => {}),
    copyText: async (text: unknown) => {
      log.copies.push(text);
    },
    reveal: async (path: string, flag: boolean) => {
      log.copies.push(["reveal", path, flag]);
    },
    exec: async (cmd: string, args: string[], options?: unknown) => {
      log.exec.push([cmd, args, options]);
      return gitAnswer(args, script);
    },
    panelFrame: (inner: unknown) => inner,
    TextareaState: {
      new: () => ({
        set_auto_grow() {},
        on() {},
        value: () => state.text ?? "",
        set_value(value: string) {
          log.exec.push(["set_value", value]);
          state.text = value;
        },
      }),
    },
    InputState: {
      new: () => ({
        set_value() {},
        value: () => state.inputText ?? "",
      }),
    },
  };
  const mod = await loadChanges(scope);
  let notifies = 0;
  const cx: Context = asContext({
    notify() {
      notifies++;
    },
    stop_propagation() {
      log.exec.push(["stop_propagation"]);
    },
    focus_handle: () => ({
      focus() {
        log.exec.push(["focus"]);
      },
      is_focused: () => state.focusedSection === true,
    }),
    spawn(fn: (cx: Context) => unknown) {
      tasks.push(fn(cx));
    },
    timer: {
      after(ms: number, fn: (cx: Context) => unknown) {
        log.timers.push(["after", ms]);
        log.pending = [...log.pending, fn];
      },
      every(ms: number) {
        log.timers.push(["every", ms]);
      },
    },
  });
  const view = new mod.default();
  return {
    view,
    cx,
    log,
    state,
    sharedValues,
    scope,
    mod,
    notifies0: 0,
    get notifies() {
      return notifies;
    },
    tasks,
  };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
};

function recFrom(value: unknown): Rec {
  const rec = recOf(value);
  if (!rec) throw new TypeError("Value is not a recorded element");
  return rec;
}

const STATE_KEYS = [
  "note",
  "busy",
  "busyReason",
  "loading",
  "menuOpen",
  "typing",
  "collapsed",
  "hovered",
  "message",
  "error",
  "limited",
  "root",
  "on",
] as const;

function snapshotState(view: ChangesView): unknown {
  return plain(Object.fromEntries(STATE_KEYS.map((k) => [k, view[k] ?? null])));
}

async function ready(options?: SetupOptions, patch: Record<string, unknown> = {}): Promise<Env> {
  const env = await setup(options);
  if (options?.withMain) {
    const saved = env.state.props;
    env.state.props = {};
    const main = new env.mod.default();
    main.init(null, env.cx);
    await settle();
    Object.assign(main, {
      root: "/repo",
      on: "host",
      context: JSON.stringify({ cwd: "/repo", on: "host", space: "s" }),
      files: [],
      error: null,
      loading: false,
      busy: false,
    });
    env.state.props = saved;
    env.main = main;
  }
  env.view.init(null, env.cx);
  await settle();
  env.log.exec.length = 0;
  env.log.runs.length = 0;
  env.log.timers.length = 0;
  Object.assign(env.view, {
    root: "/repo",
    on: "host",
    context: JSON.stringify({ cwd: "/repo", on: "host", space: "s" }),
    files: FILES,
    error: null,
    loading: false,
    busy: false,
    note: null,
    limited: false,
    message: "",
    ...structuredClone(patch),
  });
  env.notifies0 = env.notifies;
  return env;
}

const SAMPLE_EVENTS: Record<string, unknown[][]> = {
  on_click: [[{}]],
  on_hover: [[true], [false]],
  on_mouse_down: [[{}]],
  on_key_down: [
    [{ key: "escape", modifiers: {} }],
    [{ key: "enter", modifiers: { platform: true } }],
    [{ key: "enter", modifiers: { alt: true, control: true } }],
    [{ key: "space", modifiers: {} }],
    [{ key: "x", modifiers: {} }],
  ],
};

async function fire(env: Env, h: HandlerRecord, args: unknown[]): Promise<void> {
  await h.fn(args[0], env.cx);
  await settle();
}

function dialogTree(env: Env): unknown {
  const fn = env.log.dialogs.at(-1);
  if (!fn) return null;
  return fn();
}

function renderRec(env: Env): Rec {
  return recFrom(env.view.renderBody(env.cx));
}

async function explore(
  label: string,
  options: SetupOptions,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  const probe = await ready(options, patch);
  const count = handlers(renderRec(probe)).length;
  for (let i = 0; i < count; i++) {
    const metaList = handlers(renderRec(probe)),
      meta = metaList[i];
    if (!meta) throw new Error(`${label}: handler ${i} of ${count} missing (${metaList.length})`);
    for (const [argIndex, args] of (SAMPLE_EVENTS[meta.name] ?? [[{}]]).entries()) {
      const env = await ready(options, patch);
      const h = handlers(renderRec(env))[i];
      await fire(env, h, args);
      const key = `${label}#${i}:${h.path}:${h.name}:${argIndex}`;
      const entry: Record<string, unknown> = {
        main: env.main ? snapshotState(env.main) : null,
        state: snapshotState(env.view),
        exec: plain(env.log.exec),
        runs: plain(env.log.runs),
        shared: plain(env.log.shared),
        overlays: plain(env.log.overlays),
        closed: plain(env.log.closed),
        copies: plain(env.log.copies),
        timers: plain(env.log.timers),
        dialogClosed: env.log.dialogClosed,
        notifies: env.notifies - env.notifies0,
        dialog: null,
        inner: {},
      };
      if (env.log.dialogs.length) {
        const dialog = dialogTree(env);
        entry.dialog = plain(recFrom(dialog));
        const inner = handlers(recFrom(dialog));
        for (let j = 0; j < inner.length; j++) {
          const env2 = await ready(options, patch);
          const h1 = handlers(renderRec(env2))[i];
          await fire(env2, h1, args);
          const target = handlers(recFrom(dialogTree(env2)))[j];
          env2.log.exec.length = 0;
          env2.log.runs.length = 0;
          env2.log.dialogClosed = 0;
          const before = env2.notifies;
          await fire(env2, target, [{}]);
          (entry.inner as Record<string, unknown>)[`${j}:${target.path}:${target.name}`] = {
            main: env2.main ? snapshotState(env2.main) : null,
            state: snapshotState(env2.view),
            exec: plain(env2.log.exec),
            runs: plain(env2.log.runs),
            dialogClosed: env2.log.dialogClosed,
            notifies: env2.notifies - before,
            reopened: env2.log.dialogs.length,
          };
        }
      }
      results[key] = entry;
    }
  }
  return results;
}

test(
  "main.js behaves as recorded: renders, handlers and flows",
  { timeout: 3_600_000 },
  async () => {
    const out: Record<string, Record<string, unknown>> = { renders: {}, flows: {}, handlers: {} };
    const render = async (
      name: string,
      patch: Record<string, unknown>,
      options?: SetupOptions,
    ): Promise<void> => {
      const env = await ready(options, patch);
      out.renders[name] = plain(recFrom(env.view.renderBody(env.cx)));
    };
    const files = FILES,
      tab = { props: { tab: "entry-menu" } };
    const staged = files.filter((f) => f.section === "staged");
    await render("full", {});
    await render("no-root", { root: null, files: [] });
    await render("loading", { root: null, files: [], loading: true });
    await render("error", { root: null, files: [], error: "boom" });
    await render("clean", { files: [] });
    await render("typing-menu-message", {
      typing: true,
      menuOpen: true,
      message: "msg",
      note: "Push completed.",
    });
    await render("hovered-failed-note", {
      hovered: "changes-src/a.js",
      note: "bad",
      collapsed: { changes: true },
    });
    await render("hover-staged-conflict", { hovered: "conflicts-c1.js" });
    await render("hover-staged", { hovered: "staged-staged.js" });
    await render("busy-limited", {
      busy: true,
      limited: true,
      busyReason: "Commit in progress…",
      hovered: "changes-new file.txt",
      files,
    });
    await render("conflicts-block-commit", {
      message: "m",
      files: files.filter((f) => f.section === "conflicts"),
    });
    await render("staged-no-message", { files: staged });
    await render("staged-with-message", { message: "m", files: staged, menuOpen: true });
    await render("menu-no-root", { menuOpen: true, root: null, files: [] });
    const entryRenders: [string, Entry, string | null][] = [
      ["changes", files[0], "/repo"],
      ["fresh", files[1], "/repo/"],
      ["deleted", files[2], "/repo"],
      ["staged", files[4], "/repo"],
      ["conflict-du", files[6], "/repo"],
      ["conflict-uu", files[7], "/repo"],
      ["conflict-dd", files[8], "/repo"],
      ["no-root", files[0], null],
    ];
    for (const [label, entry, root] of entryRenders) {
      const env = await ready({
        props: { ...tab.props, entry, target: { root, on: "host", context: "c" }, overlay: "ov" },
      });
      out.renders[`entry-menu-${label}`] = plain(recFrom(env.view.renderBody(env.cx)));
    }
    {
      const env = await ready({ props: { tab: "entry-menu" } });
      out.renders["entry-menu-empty"] = plain(recFrom(env.view.renderBody(env.cx)));
    }
    {
      const env = await ready();
      out.renders.panel = plain(recFrom(env.view.render(env.cx)));
    }
    {
      const env = await ready();
      out.renders.tooMany = plain(
        recFrom(env.view.tooManyBanner({ ...theme, is_dark: true }, env.cx)),
      );
    }

    const primary: Record<string, unknown> = {};
    const primaryPatches: Record<string, Record<string, unknown> | undefined> = {
      busy: { busy: true, busyReason: "r" },
      conflicts: {},
      ready: { message: " x ", files: staged },
      noMessage: { files: staged },
      stage: { files: files.filter((f) => f.section === "changes") },
      none: { files: [] },
    };
    for (const [name, patch] of Object.entries(primaryPatches)) {
      const env = await ready(undefined, patch);
      primary[name] = plain(env.view.primaryAction());
    }
    out.flows.primaryAction = primary;

    out.handlers.panel = await explore("panel", {}, {});
    out.handlers.panelMenu = await explore(
      "panel-menu",
      {},
      {
        menuOpen: true,
        message: "m",
        typing: true,
        limited: true,
        files: files.filter((f) => f.section !== "conflicts" || f.xy === "UU"),
      },
    );
    out.handlers.panelStaged = await explore(
      "panel-staged",
      {},
      { message: "m", hovered: "staged-staged.js", files: staged },
    );
    out.handlers.panelBusy = await explore(
      "panel-busy",
      {},
      { busy: true, hovered: "changes-src/a.js", collapsed: { staged: true } },
    );
    const entryHandlers: [string, Entry][] = [
      ["changes", files[0]],
      ["conflict", files[6]],
      ["conflict-uu", files[7]],
      ["deleted", files[2]],
    ];
    for (const [label, entry] of entryHandlers) {
      out.handlers[`entry-${label}`] = await explore(
        `entry-${label}`,
        {
          props: {
            tab: "entry-menu",
            entry,
            target: {
              root: "/repo",
              on: "host",
              context: JSON.stringify({ cwd: "/repo", on: "host", space: "s" }),
            },
            overlay: "ov",
          },
          withMain: true,
        },
        {},
      );
    }
    out.handlers.entryMismatch = await explore(
      "entry-mismatch",
      {
        props: {
          tab: "entry-menu",
          entry: files[6],
          target: { root: "/other", on: "host", context: "x" },
          overlay: "ov",
        },
        withMain: true,
      },
      {},
    );

    const flow = async (
      name: string,
      fn: (env: Env) => unknown,
      options?: SetupOptions,
      patch?: Record<string, unknown>,
    ): Promise<Env> => {
      const env = await ready(options, patch);
      let thrown: string | null = null;
      try {
        await fn(env);
        await settle();
      } catch (e) {
        thrown = String(e);
      }
      out.flows[name] = {
        thrown,
        state: snapshotState(env.view),
        exec: plain(env.log.exec),
        runs: plain(env.log.runs),
        shared: plain(env.log.shared),
        dialogs: env.log.dialogs.length,
        dialogClosed: env.log.dialogClosed,
        notifies: env.notifies - env.notifies0,
      };
      return env;
    };
    const guarded: Record<string, Record<string, unknown>> = {
      busy: { busy: true },
      loading: { loading: true },
      noRoot: { root: null },
      otherContext: { context: "other" },
    };
    const guardedMethods = [
      "runPrimary",
      "runCommitAndPush",
      "runPush",
      "runSync",
      "runFetch",
      "runPull",
      "runForcePush",
      "runPublish",
      "runRebase",
      "openCreatePrDialog",
    ] as const;
    for (const method of guardedMethods) {
      for (const [g, patch] of Object.entries({
        ok: { message: "m", files: staged },
        ...guarded,
      })) {
        await flow(`${method}-${g}`, (env) => env.view[method](env.cx), undefined, patch);
      }
    }
    await flow("runPrimary-stage", (env) => env.view.runPrimary(env.cx), undefined, {
      files: files.filter((f) => f.section === "changes"),
    });
    await flow(
      "commit-and-push-fail-commit",
      (env) => env.view.runCommitAndPush(env.cx),
      { script: { " commit ": { code: 1, stderr: "nope", stdout: "" } } },
      { message: "m", files: staged },
    );
    await flow(
      "commit-and-push-fail-push",
      (env) => env.view.runCommitAndPush(env.cx),
      {
        script: {
          "push --no-follow-tags": {
            code: 1,
            stderr: "rejected https://u:p@example.com/r.git",
            stdout: "",
          },
        },
      },
      { message: "m", files: staged },
    );
    await flow("commit-and-push-ok", (env) => env.view.runCommitAndPush(env.cx), undefined, {
      message: "m",
      files: staged,
    });
    await flow("push-ok", (env) => env.view.runPush(env.cx));
    await flow("push-fail", (env) => env.view.runPush(env.cx), {
      script: { "push --no-follow-tags": { code: 1, stderr: "denied", stdout: "" } },
    });
    await flow("push-no-target", (env) => env.view.runPush(env.cx), {
      script: { "symbolic-ref --quiet HEAD": { code: 1, stdout: "", stderr: "" } },
    });
    await flow("push-silent-fail", (env) => env.view.runPush(env.cx), {
      script: { "push --no-follow-tags": { code: 1, stdout: "", stderr: "" } },
    });
    await flow("rebase-ok", (env) => env.view.runRebase(env.cx));
    await flow("rebase-no-base", (env) => env.view.runRebase(env.cx), {
      script: { "symbolic-ref refs/remotes/origin/HEAD": { code: 1, stdout: "", stderr: "" } },
    });
    await flow("rebase-fail", (env) => env.view.runRebase(env.cx), {
      script: { "rebase origin/main": { code: 1, stderr: "conflict", stdout: "" } },
    });
    await flow("force-push-dialog", async (env) => {
      env.view.runForcePush(env.cx);
      await settle();
      const d = dialogTree(env);
      out.flows.forcePushDialog = plain(recFrom(d));
      for (const h of handlers(recFrom(d))) await fire(env, h, [{}]);
    });
    const forcePushTarget: ForcePushTarget = {
      branch: "topic",
      remote: "origin",
      ref: "refs/heads/topic",
      oid: "a".repeat(40),
      destination: "https://u:p@example.com/r.git",
      leaseTracking: "refs/remotes/origin/topic",
      expected: "b".repeat(40),
    };
    await flow("force-push-confirm", (env) =>
      env.view.confirmForcePush(env.view.operationTarget(), forcePushTarget, env.cx),
    );
    await flow(
      "force-push-confirm-busy",
      (env) => env.view.confirmForcePush(env.view.operationTarget(), {} as ForcePushTarget, env.cx),
      undefined,
      { busy: true },
    );
    await flow("force-push-no-lease", (env) => env.view.runForcePush(env.cx), {
      script: {
        "for-each-ref": {
          code: 0,
          stdout: "refs/heads/topic\0origin\0refs/heads/topic\0\0\0\0",
          stderr: "",
        },
      },
    });
    const createPrFlow = await flow(
      "create-pr-dialog",
      async (env) => {
        env.view.openCreatePrDialog(env.cx);
        await settle();
        if (env.log.dialogs.length) {
          const d = dialogTree(env);
          out.flows.createPrDialog = plain(recFrom(d));
          for (const h of handlers(recFrom(d))) await fire(env, h, [{}]);
        }
      },
      {
        script: {
          "symbolic-ref --quiet HEAD": { code: 0, stdout: "refs/heads/topic\n", stderr: "" },
          "config --null --get-all branch.topic.remote": {
            code: 0,
            stdout: "origin\0",
            stderr: "",
          },
          "config --null --get-all branch.topic.merge": {
            code: 0,
            stdout: "refs/heads/topic\0",
            stderr: "",
          },
          "remote get-url --all origin": {
            code: 0,
            stdout: "git@github.com:o/r.git\n",
            stderr: "",
          },
          "api graphql": {
            code: 0,
            stdout: JSON.stringify({
              data: {
                repository: {
                  id: "repo-id",
                  nameWithOwner: "o/r",
                  isArchived: false,
                  isFork: false,
                  defaultBranchRef: { name: "main", target: { oid: "b".repeat(40) } },
                  ref: { prefix: "refs/heads/", name: "topic", target: { oid: "a".repeat(40) } },
                },
              },
            }),
            stderr: "",
          },
          gh: { code: 0, stdout: "", stderr: "" },
        },
      },
    );
    assert.equal(createPrFlow.log.dialogs.length, 1, "create-PR flow should open its dialog");
    assert.ok(out.flows.createPrDialog, "create-PR dialog tree should be recorded");
    await flow("submit-create-pr", (env) =>
      env.view.submitCreatePr(
        env.view.operationTarget(),
        {} as PrSnapshot,
        { title: "t", body: "b", draft: true },
        env.cx,
      ),
    );
    await flow(
      "submit-create-pr-busy",
      (env) =>
        env.view.submitCreatePr(
          env.view.operationTarget(),
          {} as PrSnapshot,
          { title: "t", body: "b", draft: true },
          env.cx,
        ),
      undefined,
      { busy: true },
    );
    const applyCases: [string, OperationTarget | undefined][] = [
      ["ok", undefined],
      ["stale", { root: "/x", on: "host", context: "x" }],
    ];
    for (const [name, target] of applyCases) {
      await flow(`apply-${name}`, (env) =>
        env.view.apply(
          [
            ["add", "--", "a"],
            ["commit", "-m", "x"],
          ],
          env.cx,
          () => {
            env.log.exec.push(["done"]);
          },
          target,
        ),
      );
    }
    await flow("apply-fail", (env) => env.view.apply([["add", "--", "a"]], env.cx), {
      script: { "add -- a": { code: 1, stderr: "", stdout: "failed" } },
    });
    await flow("apply-context-change", (env) => {
      env.view.apply(
        [
          ["add", "--", "a"],
          ["add", "--", "b"],
        ],
        env.cx,
      );
      env.state.spaces = [{ active: true, folder: "/other", machine: "host", id: "s" }];
    });
    await flow("stage-paths", (env) =>
      env.view.stagePaths(
        Array.from({ length: 450 }, (_, i) => `f${i}`),
        env.cx,
      ),
    );
    await flow("unstage-paths", (env) => env.view.unstagePaths(["a", "b"], env.cx));
    const discardPatches: [string, Record<string, unknown>][] = [
      ["ok", {}],
      ["busy", { busy: true }],
      ["mismatch", { context: "x" }],
    ];
    for (const [name, patch] of discardPatches) {
      await flow(
        `prepare-discard-${name}`,
        (env) =>
          env.view.prepareDiscard(env.view.operationTarget(), ["a"], env.cx, (s) =>
            env.log.exec.push(["open", plain(s)]),
          ),
        undefined,
        patch,
      );
      await flow(
        `verify-discard-${name}`,
        (env) =>
          env.view.verifyDiscard(env.view.operationTarget(), ["a"], "{}", env.cx, () =>
            env.log.exec.push(["perform"]),
          ),
        undefined,
        patch,
      );
      await flow(
        `discard-paths-${name}`,
        (env) => env.view.discardPaths(["src/a.js", "new.txt"], "staged", env.cx),
        undefined,
        patch,
      );
      await flow(
        `resolve-${name}`,
        (env) => env.view.resolveConflict(files[7], "mark_resolved", env.cx),
        undefined,
        patch,
      );
      await flow(
        `confirm-discard-all-${name}`,
        async (env) => {
          env.view.confirmDiscardAll("changes", ["a", "b"], env.cx);
          await settle();
        },
        undefined,
        patch,
      );
    }
    await flow(
      "discard-paths-clean",
      (env) => env.view.discardPaths(["src/a.js", "new.txt"], "changes", env.cx),
      { script: { "clean -f": { code: 1, stderr: "no", stdout: "" } } },
    );
    await flow("discard-paths-context", (env) => {
      env.view.discardPaths(["a"], "changes", env.cx);
      env.state.spaces = [];
    });
    await flow("confirm-discard-all-empty", (env) =>
      env.view.confirmDiscardAll("staged", [], env.cx),
    );
    await flow("confirm-discard-all-staged", async (env) => {
      env.view.confirmDiscardAll("staged", ["one"], env.cx);
      await settle();
      out.flows.discardAllStagedDialog = plain(recOf(dialogTree(env)));
    });
    await flow("resolve-keep-deletion", (env) =>
      env.view.resolveConflict(files[6], "keep_deletion", env.cx),
    );
    await flow(
      "resolve-keep-file-missing",
      (env) => env.view.resolveConflict(files[6], "keep_file", env.cx),
      {
        script: {
          "--porcelain=v2": {
            code: 0,
            stdout: "u DU N... 100644 000000 100644 100644 h h h c1.js\0",
            stderr: "",
          },
        },
      },
    );
    await flow(
      "resolve-not-conflict",
      (env) => env.view.resolveConflict(files[6], "keep_file", env.cx),
      { script: { "--porcelain=v2": { code: 0, stdout: "", stderr: "" } } },
    );
    await flow(
      "resolve-status-fail",
      (env) => env.view.resolveConflict(files[6], "keep_file", env.cx),
      { script: { "--porcelain=v2": { code: 1, stdout: "", stderr: "bad" } } },
    );
    await flow(
      "resolve-add-fail",
      (env) => env.view.resolveConflict(files[7], "mark_resolved", env.cx),
      { script: { "--literal-pathspecs add": { code: 1, stdout: "", stderr: "denied" } } },
    );
    await flow("resolve-target-changed", (env) => {
      const target = env.view.operationTarget();
      env.view.resolveConflict(files[7], "mark_resolved", env.cx, target);
      env.state.spaces = [{ active: true, folder: "/other", machine: "host", id: "s" }];
    });
    await flow("confirm-discard", async (env) => {
      for (const f of [files[0], files[1], files[2]]) {
        env.view.confirmDiscard(f, f.path.split("/").pop() as string, env.cx);
        await settle();
        out.flows[`discardDialog-${f.status}`] = plain(recOf(dialogTree(env)));
      }
    });
    const diffCases: [string, EntryLike, string | null, Record<string, unknown>][] = [
      ["file", files[0], "/repo", {}],
      [
        "section",
        { sectionAll: true, section: "changes", paths: ["a"], limited: true },
        "/repo",
        {},
      ],
      ["all", { all: true }, "/repo", {}],
      ["conflict", files[6], "/repo", {}],
      ["noroot", files[0], null, { root: null }],
    ];
    for (const [name, f, root, extra] of diffCases) {
      await flow(
        `open-diff-${name}`,
        (env) => env.view.openDiff(f, root ?? undefined, "host"),
        undefined,
        extra,
      );
    }
    await flow("open-diff-default-args", (env) => env.view.openDiff(files[0]));
    await flow("open-entry", (env) => env.view.openEntry(files[0]));
    await flow("open-entry-no-cwd", (env) => env.view.openEntry(files[0]), undefined, {
      root: "/repo/sub/",
    });
    await flow("open-diff-no-panes", (env) => {
      env.scope.panes = () => [];
      env.view.openDiff(files[0]);
    });
    await flow("open-diff-existing-pane", (env) => {
      env.scope.panes = () => [{ pane: "p9", tab: "t1", mod: "orca-diff" }];
      env.view.openDiff(files[0]);
    });
    await flow("open-diff-hostless", (env) => {
      env.scope.panes = () => [{ pane: "p9", tab: "t1", mod: "other" }];
      env.view.openDiff(files[0]);
    });

    await flow("refresh-not-repo", (env) => env.view.refresh(env.cx), {
      script: { "rev-parse --show-toplevel": { code: 128, stdout: "", stderr: "" } },
    });
    await flow("refresh-status-fail", (env) => env.view.refresh(env.cx), {
      script: { "status --porcelain=v1": { code: 1, stderr: "bad", stdout: "" } },
    });
    await flow("refresh-numstat-fail", (env) => env.view.refresh(env.cx), {
      script: { "diff --numstat": { code: 1, stderr: "bad numstat", stdout: "" } },
    });
    await flow("refresh-ok-watch", (env) => env.view.refresh(env.cx));
    await flow(
      "refresh-no-cwd",
      (env) => env.view.refresh(env.cx),
      { spaceState: [] },
      { context: undefined },
    );
    await flow(
      "refresh-context-change",
      (env) => {
        env.view.refresh(env.cx);
        env.state.spaces = [{ active: true, folder: "/other", machine: "host", id: "s" }];
      },
      undefined,
      { context: undefined },
    );
    await flow("refresh-new-context", (env) => env.view.refresh(env.cx), undefined, {
      context: "other",
      message: "m",
    });
    await flow("watch-twice", (env) => {
      env.view.on = null;
      env.view.watched = null;
      env.view.watch("/repo", env.cx);
      env.view.watch("/repo", env.cx);
    });
    await flow("watch-loop", (env) => {
      let calls = 0;
      env.scope.watchFolder = async (root: string) => {
        env.log.exec.push(["watch", root, ++calls]);
        if (calls > 1) throw new Error("gone");
      };
      env.view.on = null;
      env.view.watched = null;
      env.view.watch("/repo", env.cx);
    });

    {
      const env = await setup({ props: { tab: "entry-menu" } });
      env.view.init(null, env.cx);
      await settle();
      out.flows.initEntryMenu = {
        runs: plain(env.log.runs),
        exec: plain(env.log.exec),
        timers: plain(env.log.timers),
      };
    }
    {
      const env = await setup();
      const commands = ["other", "refresh"];
      env.scope.nextCommand = () =>
        commands.length ? Promise.resolve(commands.shift() as string) : new Promise(() => {});
      env.view.init(null, env.cx);
      await settle();
      out.flows.initCommands = {
        exec: plain(env.log.exec),
        timers: plain(env.log.timers),
        notifies: env.notifies,
        files: env.view.files.length,
      };
    }
    {
      const env = await ready();
      env.view.context = "stale";
      env.view.renderBody(env.cx);
      const deferred: Record<string, unknown> = {
        timers: plain(env.log.timers),
        pending: env.log.pending.length,
      };
      out.flows.renderDefersRefresh = deferred;
      await env.log.pending[0]?.(env.cx);
      await settle();
      Object.assign(deferred, {
        after: { exec: plain(env.log.exec), context: env.view.context },
      });
    }
    {
      const env = await setup();
      out.flows.relPath = plain(
        [
          ["/a/b", "/a/b/c.js"],
          ["/a/b/", "/a/c/d.js"],
          ["/a", "/b"],
        ].map(([from, to]) => env.mod.relPath(from, to)),
      );
    }
    {
      const env = await setup();
      out.flows.tones = plain(
        ["A", "D", "M", "R", "U", "C", "!", "Z"].map((m) => env.mod.gitTone(m, { dim: "#dim" })),
      );
    }
    {
      const env = await setup();
      out.flows.conflictResolutions = plain(
        ["DD", "DU", "UD", "UU", "AA"].map((xy) => env.mod.conflictResolutions(xy)),
      );
    }

    const digest: Record<string, string> = {};
    for (const [group, entries] of Object.entries(out))
      for (const [name, value] of Object.entries(entries))
        digest[`${group}/${name}`] = createHash("sha256")
          .update(JSON.stringify(value))
          .digest("hex");
    assert.deepStrictEqual(digest, JSON.parse(readFileSync(GOLDEN, "utf8")));
  },
);
