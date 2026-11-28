import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Context } from "gpui-kit";
import { asContext, asRecorder, cleanse, handlers, plain, type Rec } from "./recording.js";

type ExecOptions = { cwd?: string; on?: string | null; timeout?: number };
type ExecResult = { code: number; stdout?: string; stderr?: string };
type ScriptAnswer = ExecResult | ((args: string[], opts?: ExecOptions) => ExecResult);
type Script = Record<string, ScriptAnswer>;
type Space = {
  id: string;
  folder: string;
  machine: string | null;
  name: string;
  tabs: { id: string }[];
  active?: boolean;
};
type Pane = { tab: string; cwd: string };
type Agent = { tab: string; status: string };
type Input = {
  opts: { value?: string; placeholder?: string };
  handlers: Record<string, (event: unknown, cx: unknown) => void>;
  on(name: string, fn: (event: unknown, cx: unknown) => void): void;
  value(): string;
  focus(): void;
};
type Log = {
  exec: [string, string[], ExecOptions | undefined][];
  runs: [string, unknown][];
  closed: unknown[];
  timers: number[];
  focus: string[];
};
type State = {
  props: Record<string, unknown>;
  spaces: Space[];
  panes: Pane[];
  agents: Agent[];
  inputs: { last?: Input };
  inputText?: string;
  log: Log;
};
const current = vi.hoisted(() => ({
  exec: async (_cmd: string, _args: string[], _opts?: ExecOptions): Promise<ExecResult> => ({
    code: 0,
    stdout: "",
    stderr: "",
  }),
  run: (_name: string, _args?: unknown) => {},
  props: (): Record<string, unknown> => ({}),
  closeOverlay: (_id?: unknown) => {},
  spaces: (): Space[] => [],
  panes: (): Pane[] => [],
  agents: (): Agent[] => [],
  newInput: (_opts: { value?: string; placeholder?: string }): unknown => ({}),
}));

vi.mock("gpui-kit", async () => {
  const { element } = await import("./recording.js");
  return { View: class View {}, div: element("div") };
});
vi.mock("gpui-base", async () => {
  const { element } = await import("./recording.js");
  return {
    v_flex: element("v_flex"),
    h_flex: element("h_flex"),
    Input: { new: element("Input") },
    Scrollbar: { vertical: element("Scrollbar.vertical") },
    InputState: { new: (opts: { value?: string; placeholder?: string }) => current.newInput(opts) },
  };
});
vi.mock("herdr", async () => {
  const { theme } = await import("./recording.js");
  return {
    run: (name: string, args?: unknown) => current.run(name, args),
    props: () => current.props(),
    closeOverlay: (id?: unknown) => current.closeOverlay(id),
    theme: () => theme,
    spaces: () => current.spaces(),
    panes: () => current.panes(),
    agents: () => current.agents(),
    exec: (cmd: string, args: string[], opts?: ExecOptions) => current.exec(cmd, args, opts),
    home: () => "/home/u",
  };
});

import Worktree from "../../../src/mods/orca-worktree/main.js";

const GOLDEN = new URL("./main.golden.json", import.meta.url);
const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
};

const BLOCKS = [
  "worktree /repo\nHEAD a1\nbranch refs/heads/main",
  "worktree /wt/feat\nHEAD a2\nbranch refs/heads/feat",
  "worktree /wt/det\nHEAD a3\ndetached",
  "worktree /wt/bare\nbare",
  "worktree /wt/gone\nHEAD a4\nbranch refs/heads/gone\nprunable gitdir file points to non-existent location",
  "worktree /wt/nobranch\nHEAD a5\nbranch refs/heads/other",
].join("\n\n");

function answer(args: string[], script: Script, opts?: ExecOptions): ExecResult {
  const line = args.join(" ");
  for (const [needle, value] of Object.entries(script))
    if (line.includes(needle)) return typeof value === "function" ? value(args, opts) : value;
  if (line.includes("--show-toplevel")) return { code: 0, stdout: "/repo\n" };
  if (line.includes("--git-common-dir")) return { code: 0, stdout: "/repo/.git\n" };
  if (line.includes("worktree list")) return { code: 0, stdout: BLOCKS };
  if (line.includes("for-each-ref"))
    return { code: 0, stdout: "main\t300\nfeat\t200\nother\t100\nnodate\t" };
  if (line.includes("symbolic-ref")) return { code: 0, stdout: "main\n" };
  if (line.includes("status --porcelain")) return { code: 0, stdout: "" };
  if (line.includes("show-ref")) return { code: 1, stdout: "" };
  return { code: 0, stdout: "", stderr: "" };
}

function setup({
  props = {},
  spaces,
  panes,
  agents = [],
  script = {},
  shell = "ok",
}: {
  props?: Record<string, unknown>;
  spaces?: Space[];
  panes?: Pane[];
  agents?: Agent[];
  script?: Script;
  shell?: string;
} = {}) {
  const log: Log = { exec: [], runs: [], closed: [], timers: [], focus: [] };
  const state: State = {
    props: { overlay: "ov", ...props },
    spaces: spaces ?? [
      {
        id: "s1",
        active: true,
        folder: "/repo",
        machine: typeof props.machine === "string" ? props.machine : null,
        name: "repo",
        tabs: [{ id: "t1" }],
      },
    ],
    panes: panes ?? [
      { tab: "t1", cwd: "/repo/sub" },
      { tab: "t9", cwd: "/wt/feat" },
    ],
    agents,
    inputs: {},
    log,
  };
  current.run = (name, args) => log.runs.push([name, cleanse(args)]);
  current.props = () => state.props;
  current.closeOverlay = (id) => log.closed.push(id);
  current.spaces = () => state.spaces;
  current.panes = () => state.panes;
  current.agents = () => state.agents;
  current.exec = async (cmd, args, opts) => {
    log.exec.push([cmd, args, opts]);
    if (cmd === "sh") {
      if (shell === "throw") throw new Error("no sh");
      if (shell === "empty") return { code: 0, stdout: "" };
      return { code: 0, stdout: "/home/remote\n" };
    }
    if (cmd === "powershell.exe")
      return shell === "powershell-fail"
        ? { code: 1, stdout: "" }
        : { code: 0, stdout: "C:\\Users\\r" };
    return answer(args, script, opts);
  };
  current.newInput = (opts: Input["opts"]) => {
    const handlers: Input["handlers"] = {};
    const input: Input = {
      opts,
      handlers,
      on(name, fn) {
        handlers[name] = fn;
      },
      value: () => state.inputText ?? opts.value ?? "",
      focus() {
        log.focus.push("input");
      },
    };
    state.inputs.last = input;
    return input;
  };
  let notifies = 0;
  const handle = {
    focus() {
      log.focus.push("handle");
    },
  };
  const cx: Context = asContext({
    notify() {
      notifies++;
    },
    stop_propagation() {
      log.focus.push("stop");
    },
    focus_handle: () => handle,
    spawn(fn: (cx: Context) => unknown) {
      fn(cx);
    },
    timer: {
      after(ms: number, fn: () => void) {
        log.timers.push(ms);
        fn();
      },
    },
  });
  const view = new Worktree();
  return {
    view,
    cx,
    log,
    state,
    n0: 0,
    get notifies() {
      return notifies;
    },
  };
}

async function opened(options: Parameters<typeof setup>[0], patch: Record<string, unknown> = {}) {
  const env = setup(options);
  env.view.init(null, env.cx);
  await settle();
  Object.assign(env.view, structuredClone(patch));
  env.log.exec.length = 0;
  env.log.runs.length = 0;
  env.log.closed.length = 0;
  env.log.timers.length = 0;
  env.log.focus.length = 0;
  env.n0 = env.notifies;
  return env;
}

const VIEW_KEYS = [
  "on",
  "userHome",
  "opening",
  "switching",
  "text",
  "list",
  "branches",
  "current",
  "blocker",
  "at",
  "busy",
  "error",
  "repo",
  "folder",
  "inputFocused",
] as const;
const viewState = (v: Worktree): unknown =>
  plain(Object.fromEntries(VIEW_KEYS.map((k) => [k, v[k] ?? null])));

const KEYS = [{ key: "escape" }, { key: "enter" }, { key: "down" }, { key: "up" }, { key: "x" }];

function recOf(value: unknown): Rec {
  const rec = asRecorder(value);
  if (!rec) throw new Error("render did not produce a recording");
  return rec;
}

async function explore(
  label: string,
  options: Parameters<typeof setup>[0],
  patch: Record<string, unknown>,
) {
  const out: Record<string, unknown> = {};
  const probe = await opened(options, patch);
  const count = handlers(recOf(probe.view.render(probe.cx))).length;
  for (let i = 0; i < count; i++) {
    const kinds =
      handlers(recOf(probe.view.render(probe.cx)))[i].name === "on_key_down" ? KEYS : [{}];
    for (const [k, ev] of kinds.entries()) {
      const env = await opened(options, patch);
      const h = handlers(recOf(env.view.render(env.cx)))[i];
      await h.fn(ev, env.cx);
      await settle();
      out[`${label}#${i}:${h.path}:${h.name}:${k}`] = {
        view: viewState(env.view),
        exec: plain(env.log.exec),
        runs: plain(env.log.runs),
        closed: plain(env.log.closed),
        focus: env.log.focus,
        notifies: env.notifies - env.n0,
        after: plain(recOf(env.view.render(env.cx))),
      };
    }
  }

  for (const name of ["change", "submit", "focus", "blur"]) {
    const env = await opened(options, patch);
    env.state.inputText = "fe";
    env.state.inputs.last!.handlers[name]({}, env.cx);
    await settle();
    out[`${label}#input:${name}`] = {
      view: viewState(env.view),
      exec: plain(env.log.exec),
      runs: plain(env.log.runs),
      closed: plain(env.log.closed),
      notifies: env.notifies - env.n0,
    };
  }
  return out;
}

test("worktree dialog behaves as recorded: renders, handlers and flows", async () => {
  const out: {
    renders: Record<string, unknown>;
    handlers: Record<string, unknown>;
    flows: Record<string, unknown>;
  } = { renders: {}, handlers: {}, flows: {} };
  const MODES: Record<string, Record<string, unknown>> = {
    new: { action: "new", space: "s1", tab: "t2", argv: ["x"] },
    open: { action: "open", space: "s1" },
    switch: { action: "switch", space: "s1" },
    remove: { action: "remove", space: "s1" },
    newFolder: { action: "new", folder: "/solo", machine: "m1" },
    newBranch: { action: "new", space: "s1", branch: "feat/x" },
    removeBranch: { action: "remove", space: "s1", branch: "x" },
  };
  for (const [name, props] of Object.entries(MODES)) {
    const env = await opened({ props });
    out.renders[name] = {
      view: viewState(env.view),
      tree: plain(recOf(env.view.render(env.cx))),
      exec: plain(env.log.exec),
      runs: plain(env.log.runs),
      closed: plain(env.log.closed),
    };
    out.handlers[name] = await explore(name, { props }, {});
  }
  const notGit = { script: { "--show-toplevel": { code: 128, stdout: "" } } };
  for (const [name, props] of Object.entries({
    new: MODES.new,
    open: MODES.open,
    switch: MODES.switch,
  })) {
    const env = await opened({ props, ...notGit });
    out.renders[`${name}-not-git`] = {
      view: viewState(env.view),
      tree: plain(recOf(env.view.render(env.cx))),
    };
  }
  for (const [name, patch] of Object.entries({
    looking: { repo: undefined },
    notGit: { repo: null },
    busy: { busy: true },
    error: { error: "oops" },
    unfocused: { inputFocused: false, text: "fe" },
    noMatch: { text: "zzz" },
    at: { at: 1, text: "" },
  })) {
    for (const mode of ["open", "switch", "new", "remove"]) {
      const env = await opened({ props: MODES[mode] }, patch);
      out.renders[`${mode}-${name}`] = plain(recOf(env.view.render(env.cx)));
      if (mode === "open" || mode === "switch")
        out.handlers[`${mode}-${name}`] = await explore(
          `${mode}-${name}`,
          { props: MODES[mode] },
          patch,
        );
    }
  }
  out.renders["switch-blocker"] = plain(
    recOf(
      (
        await opened({
          props: MODES.switch,
          script: { "status --porcelain": { code: 0, stdout: " M a\n?? b" } },
        })
      ).view.render(asContext({})),
    ),
  );
  out.handlers["switch-blocker"] = await explore(
    "switch-blocker",
    { props: MODES.switch, script: { "status --porcelain": { code: 0, stdout: " M a\n?? b" } } },
    {},
  );
  out.handlers["switch-held"] = await explore("switch-held", { props: MODES.switch }, { at: 1 });
  out.handlers["open-filter"] = await explore(
    "open-filter",
    { props: MODES.open },
    { text: "feat", at: 0 },
  );
  out.handlers["open-no-space"] = await explore(
    "open-no-space",
    { props: MODES.open, panes: [] },
    {},
  );

  const flow = async (
    name: string,
    fn: (env: ReturnType<typeof setup>) => unknown,
    options: Parameters<typeof setup>[0] = { props: MODES.new },
    patch: Record<string, unknown> = {},
  ) => {
    const env = await opened(options, patch);
    let thrown: string | null = null,
      returned: unknown;
    try {
      returned = await fn(env);
      await settle();
    } catch (e) {
      thrown = String(e);
    }
    out.flows[name] = {
      thrown,
      returned: plain(returned),
      view: viewState(env.view),
      exec: plain(env.log.exec),
      runs: plain(env.log.runs),
      closed: plain(env.log.closed),
      focus: env.log.focus,
      timers: env.log.timers,
      notifies: env.notifies - env.n0,
    };
  };
  const created: [string, string][] = [
    ["empty", ""],
    ["spaces", "   "],
    ["dash", "-x"],
    ["nonslug", "!!!"],
    ["plain", "feat"],
    ["slash", "feat/Login Page"],
  ];
  for (const [name, text] of created)
    await flow(`create-${name}`, (env) => env.view.create(), { props: MODES.new }, { text });
  await flow(
    "create-exists",
    (env) => env.view.create(),
    { props: MODES.new, script: { "show-ref": { code: 0, stdout: "" } } },
    { text: "feat" },
  );
  await flow(
    "create-add-fails",
    (env) => env.view.create(),
    {
      props: MODES.new,
      script: { "worktree add": { code: 1, stdout: "", stderr: "exists already" } },
    },
    { text: "feat" },
  );
  await flow(
    "create-add-fails-silent",
    (env) => env.view.create(),
    {
      props: MODES.new,
      script: { "worktree add": { code: 1, stdout: "out only", stderr: undefined } },
    },
    { text: "feat" },
  );
  await flow(
    "create-add-fails-empty",
    (env) => env.view.create(),
    { props: MODES.new, script: { "worktree add": { code: 1, stdout: "", stderr: "" } } },
    { text: "feat" },
  );
  await flow(
    "create-remote",
    (env) => env.view.create(),
    { props: { action: "new", folder: "/r", machine: "host" } },
    { text: "b" },
  );
  await flow("work-new", (env) => env.view.work(env.cx), { props: MODES.new }, { text: "feat" });
  await flow("work-new-empty", (env) => env.view.work(env.cx), { props: MODES.new }, { text: "" });
  await flow("work-remove", (env) => env.view.work(env.cx), { props: MODES.remove });
  await flow(
    "work-busy",
    (env) => env.view.work(env.cx),
    { props: MODES.new },
    { busy: true, text: "a" },
  );
  await flow(
    "work-no-repo",
    (env) => env.view.work(env.cx),
    { props: MODES.new },
    { repo: null, text: "a" },
  );
  await flow(
    "work-throws",
    (env) => env.view.work(env.cx),
    {
      props: MODES.new,
      script: {
        "worktree add": () => {
          throw new Error("crash");
        },
      },
    },
    { text: "feat" },
  );
  await flow("go-busy", (env) => env.view.go(env.cx), undefined, { busy: true });
  await flow("go-new", (env) => env.view.go(env.cx), undefined, { text: "feat" });
  await flow("go-remove", (env) => env.view.go(env.cx), { props: MODES.remove });
  await flow("go-switch", (env) => env.view.go(env.cx), { props: MODES.switch }, { at: 1 });
  await flow(
    "go-switch-none",
    (env) => env.view.go(env.cx),
    { props: MODES.switch },
    { text: "zzz" },
  );
  await flow("go-open", (env) => env.view.go(env.cx), { props: MODES.open }, { at: 1 });
  for (const [name, row] of Object.entries({
    none: undefined,
    current: { branch: "main", current: true },
    held: { branch: "feat", held: "/wt/feat" },
    free: { branch: "other", current: false, held: null },
    nodate: { branch: "nodate" },
  })) {
    await flow(`switchTo-${name}`, (env) => env.view.switchTo(row, env.cx), {
      props: MODES.switch,
    });
  }
  await flow(
    "switchTo-busy",
    (env) => env.view.switchTo({ branch: "other" }, env.cx),
    { props: MODES.switch },
    { busy: true },
  );
  await flow("switchTo-dirty", (env) => env.view.switchTo({ branch: "other" }, env.cx), {
    props: MODES.switch,
    script: { "status --porcelain": { code: 0, stdout: " M a" } },
  });
  await flow("switchTo-agent", (env) => env.view.switchTo({ branch: "other" }, env.cx), {
    props: MODES.switch,
    agents: [{ tab: "t1", status: "working" }],
  });
  await flow("switchTo-fail", (env) => env.view.switchTo({ branch: "other" }, env.cx), {
    props: MODES.switch,
    script: { "switch other": { code: 1, stdout: "", stderr: "would overwrite" } },
  });
  await flow("switchTo-fail-silent", (env) => env.view.switchTo({ branch: "other" }, env.cx), {
    props: MODES.switch,
    script: { "switch other": { code: 1, stdout: "", stderr: "" } },
  });
  for (const [name, agents] of Object.entries({
    none: [],
    working: [{ tab: "t1", status: "working" }],
    blocked: [{ tab: "t1", status: "blocked" }],
    idle: [{ tab: "t1", status: "idle" }],
    elsewhere: [{ tab: "t7", status: "working" }],
  })) {
    await flow(`blocker-${name}`, (env) => env.view.blockerNow(), { props: MODES.switch, agents });
  }
  await flow("blocker-dirty-one", (env) => env.view.blockerNow(), {
    props: MODES.switch,
    script: { "status --porcelain": { code: 0, stdout: " M a\n" } },
  });
  await flow("blocker-unknown", (env) => env.view.blockerNow(), {
    props: MODES.switch,
    script: { "status --porcelain": { code: 128, stdout: "" } },
  });
  await flow("loadBranches-detached", (env) => env.view.loadBranches({ main: "/repo" }), {
    props: MODES.switch,
    script: { "symbolic-ref": { code: 1, stdout: "" } },
  });
  await flow("loadBranches-no-refs", (env) => env.view.loadBranches({ main: "/repo" }), {
    props: MODES.switch,
    script: { "for-each-ref": { code: 0, stdout: "" } },
  });
  await flow("loadBranches-refs-fail", (env) => env.view.loadBranches({ main: "/repo" }), {
    props: MODES.switch,
    script: { "for-each-ref": { code: 1, stdout: "x" } },
  });
  await flow("open-worktree-open", (env) => env.view.open({ path: "/wt/feat" }), {
    props: MODES.open,
  });
  await flow("open-worktree-new", (env) => env.view.open({ path: "/wt/other" }), {
    props: MODES.open,
  });
  await flow("open-worktree-none", (env) => env.view.open(undefined), { props: MODES.open });
  await flow("open-worktree-remote", (env) => env.view.open({ path: "/wt/other" }), {
    props: { action: "open", folder: "/r", machine: "host" },
  });
  await flow("remove", (env) => env.view.remove(), { props: MODES.remove });
  await flow("close", (env) => env.view.close());
  await flow("space-folder", (env) => plain(env.view.space()), {
    props: { action: "new", folder: "/solo", machine: "m1" },
  });
  await flow("space-folder-nomachine", (env) => plain(env.view.space()), {
    props: { action: "new", folder: "/solo" },
  });
  await flow("space-none", (env) => plain(env.view.space()), { props: { action: "new" } });
  await flow("identity", (env) => ({ a: env.view.identity(), initial: env.view.initialIdentity }), {
    props: { action: "new", space: "s1", machine: "m2" },
  });
  await flow("identity-nospace", (env) => ({ a: env.view.identity() }), {
    props: { action: "new", space: "missing" },
  });
  await flow("visible-modes", (env) => ({ new: env.view.visible() }), { props: MODES.new });
  await flow("key-escape", (env) => env.view.key({ key: "escape" }, env.cx), { props: MODES.open });
  await flow(
    "key-nav-empty",
    (env) => env.view.key({ key: "down" }, env.cx),
    { props: MODES.open },
    { text: "zzz" },
  );
  await flow(
    "key-up-wrap",
    (env) => {
      env.view.key({ key: "up" }, env.cx);
      return env.view.at;
    },
    { props: MODES.open },
  );
  await flow(
    "key-down-wrap",
    (env) => {
      for (let i = 0; i < 4; i++) env.view.key({ key: "down" }, env.cx);
      return env.view.at;
    },
    { props: MODES.open },
  );
  await flow("key-enter-remove", (env) => env.view.key({ key: "enter" }, env.cx), {
    props: MODES.remove,
  });
  await flow(
    "key-enter-new",
    (env) => env.view.key({ key: "enter" }, env.cx),
    { props: MODES.new },
    { text: "feat" },
  );
  await flow("key-other-new", (env) => env.view.key({ key: "x" }, env.cx), { props: MODES.new });

  const remoteProps = { action: "new", folder: "/r", machine: "host" };
  for (const shell of ["ok", "throw", "empty", "powershell-fail"]) {
    const env = await opened({ props: remoteProps, shell });
    out.flows[`init-remote-${shell}`] = {
      view: viewState(env.view),
      tree: plain(recOf(env.view.render(env.cx))),
    };
  }
  for (const [name, props] of Object.entries({
    branch: { ...MODES.new, branch: "auto" },
    openBranch: { ...MODES.open, branch: "x" },
    removeBranch: MODES.removeBranch,
  })) {
    const env = setup({ props });
    env.view.init(null, env.cx);
    await settle();
    out.flows[`init-${name}`] = {
      view: viewState(env.view),
      exec: plain(env.log.exec),
      runs: plain(env.log.runs),
      closed: plain(env.log.closed),
      focus: env.log.focus,
      timers: env.log.timers,
      notifies: env.notifies,
      input: plain(env.state.inputs.last!.opts),
    };
  }
  {
    const env = setup({
      props: MODES.new,
      script: {
        "--git-common-dir": () => {
          throw new Error("git gone");
        },
      },
    });
    env.view.init(null, env.cx);
    await settle();
    out.flows["init-throws"] = {
      view: viewState(env.view),
      tree: plain(recOf(env.view.render(env.cx))),
    };
  }
  {
    const env = setup({
      props: MODES.new,
      script: { "--git-common-dir": { code: 0, stdout: "/other/place\n" } },
    });
    env.view.init(null, env.cx);
    await settle();
    out.flows["init-no-dot-git"] = { view: viewState(env.view) };
  }
  {
    const env = setup({ props: MODES.open, script: { "worktree list": { code: 1, stdout: "" } } });
    env.view.init(null, env.cx);
    await settle();
    out.flows["init-open-list-fails"] = { view: viewState(env.view) };
  }
  {
    const env = setup({ props: {} });
    env.view.init(null, env.cx);
    await settle();
    out.flows["init-no-props"] = { view: viewState(env.view) };
  }

  if (process.env.GOLDEN_FULL) writeFileSync(process.env.GOLDEN_FULL, JSON.stringify(out, null, 1));
  const digest: Record<string, string> = {};
  for (const [group, entries] of Object.entries(out))
    for (const [name, value] of Object.entries(entries))
      digest[`${group}/${name}`] = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  if (!existsSync(GOLDEN)) writeFileSync(GOLDEN, JSON.stringify(digest, null, 1) + "\n");
  assert.deepStrictEqual(digest, JSON.parse(readFileSync(GOLDEN, "utf8")));
});
