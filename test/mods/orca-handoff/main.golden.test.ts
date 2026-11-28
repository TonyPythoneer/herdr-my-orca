import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test, vi } from "vite-plus/test";
import type { AsyncContext, Context } from "gpui-kit";
import { asRecorder, cleanse, handlers, plain, type HandlerRecord, type Rec } from "./recording.js";
import {
  buildAgentSessionForkPrompt,
  buildAgentSessionContinuationPrompt,
} from "../../../src/shared/transcript.js";
import HandoffDialog from "../../../src/mods/orca-handoff/main.ts";

const GOLDEN = new URL("./main.golden.json", import.meta.url);

type InventoryAgent = { key: string; name: string; run: string[]; installed: boolean };
type GoldenOptions = {
  props?: Record<string, unknown>;
  panes?: unknown[];
  agents?: unknown[];
  hcResult?: unknown;
  git?: Record<string, unknown>;
  spaces?: unknown[];
  inventory?: InventoryAgent[] | "reject";
};
type GoldenLog = {
  exec: unknown[];
  runs: unknown[];
  closed: unknown[];
  copies: string[];
  timers: number[];
  hc: unknown[];
  inventory?: unknown;
};
type TestCx = {
  notify(): void;
  spawn(fn: (cx: TestCx) => unknown): void;
  focus_handle(): { focus(): void };
  timer: { after(ms: number, fn: () => void): void };
};
type GoldenHarness = {
  run(name: string, args?: unknown): void;
  props(): Record<string, unknown>;
  closeOverlay(id: string): void;
  panes(): unknown[];
  spaces(): unknown[];
  agents(): unknown[];
  knownAgents(options?: { on?: string | null }): Promise<unknown>;
  hc(args: string[]): Promise<unknown>;
  exec(command: string, args: string[], options?: { cwd?: string }): Promise<unknown>;
  copyText(text: string): Promise<void>;
};
type GoldenEnv = {
  view: HandoffDialog;
  cx: TestCx;
  log: GoldenLog;
  state: { props: Record<string, unknown> };
  n0: number;
  notifies: number;
};
type GoldenOut = {
  renders: Record<string, unknown>;
  handlers: Record<string, unknown>;
  flows: Record<string, unknown>;
};

const current = vi.hoisted(() => ({ harness: null as GoldenHarness | null }));

function harness(): GoldenHarness {
  const value = current.harness;
  if (!value) throw new Error("handoff golden harness is not ready");
  return value;
}

vi.mock("gpui-kit", async () => {
  const { element } = await import("./recording.js");
  return { View: class View {}, div: element("div"), svg: element("svg") };
});
vi.mock("gpui-base", async () => {
  const { element } = await import("./recording.js");
  return { v_flex: element("v_flex"), h_flex: element("h_flex") };
});
vi.mock("herdr", async () => {
  const { theme } = await import("./recording.js");
  return {
    run: (name: string, args?: Record<string, unknown>) => harness().run(name, args),
    props: () => harness().props(),
    closeOverlay: (id: string) => harness().closeOverlay(id),
    theme: () => theme,
    panes: () => harness().panes(),
    agents: () => harness().agents(),
    knownAgents: (options?: { on?: string | null }) => harness().knownAgents(options),
    spaces: () => harness().spaces(),
    hc: (args: string[]) => harness().hc(args),
    exec: (command: string, args?: string[], options?: { cwd?: string }) =>
      harness().exec(command, args ?? [], options),
  };
});
vi.mock("../../../src/shared/clip.ts", () => ({
  copyText: (text: string) => harness().copyText(text),
}));

const TRANSCRIPT = "\u001b[31mhello\u001b[0m\nworld ".repeat(3);
const DEFAULT_INVENTORY: InventoryAgent[] = [
  ["claude", "Claude Code", "claude"],
  ["opencode", "OpenCode", "opencode"],
  ["codex", "Codex", "codex"],
  ["pi", "Pi", "pi"],
  ["gemini", "Gemini", "gemini"],
  ["agy", "Antigravity", "agy"],
  ["cursor", "Cursor Agent", "cursor-agent"],
  ["aider", "Aider", "aider"],
].map(([key, name, cmd]) => ({ key, name, run: [cmd], installed: true }));

function setup(options: GoldenOptions = {}): GoldenEnv {
  const {
    props = {},
    panes,
    agents,
    hcResult,
    git = {},
    spaces = [{ active: true, id: "s" }],
    inventory = DEFAULT_INVENTORY,
  } = options;
  const log: GoldenLog = { exec: [], runs: [], closed: [], copies: [], timers: [], hc: [] };
  const state = {
    props: { overlay: "ov", action: "handoff", terminal: "term1", pane: "p1", ...props },
  };
  let notifies = 0;
  const instance: GoldenHarness = {
    run(name, args) {
      log.runs.push([name, cleanse(args)]);
    },
    props: () => state.props,
    closeOverlay(id) {
      log.closed.push(id);
    },
    panes: () => panes ?? [{ pane: "p1", terminal: "term1", cwd: "/repo", title: "My Terminal" }],
    spaces: () => spaces,
    agents: () => agents ?? [{ address: "term1", app: "Codex" }],
    async knownAgents(opts) {
      log.inventory = opts;
      if (inventory === "reject") throw Error("offline");
      return inventory;
    },
    async hc(args) {
      log.hc.push(args);
      if (hcResult === "reject") throw new Error("hc gone");
      return hcResult ?? { code: 0, stdout: TRANSCRIPT };
    },
    async exec(command, args, opts) {
      log.exec.push([command, args, opts]);
      const answer = git[args[0]];
      if (typeof answer === "function") return (answer as () => unknown)();
      if (answer) return answer;
      return args[0] === "rev-parse"
        ? { code: 0, stdout: `${(opts as { cwd: string }).cwd}\n` }
        : { code: 0, stdout: "topic\n" };
    },
    async copyText(text) {
      log.copies.push(text);
    },
  };
  current.harness = instance;
  const cx: TestCx = {
    notify() {
      notifies++;
    },
    spawn(fn) {
      void fn(cx);
    },
    focus_handle: () => ({
      focus() {
        log.exec.push(["focus"]);
      },
    }),
    timer: {
      after(ms, fn) {
        log.timers.push(ms);
        fn();
      },
    },
  };
  return {
    view: new HandoffDialog(),
    cx,
    log,
    state,
    n0: 0,
    get notifies() {
      return notifies;
    },
  };
}

const asAsync = (cx: TestCx): AsyncContext => cx as unknown as AsyncContext;
const asContext = (cx: TestCx): Context => cx as unknown as Context;
function recOf(value: unknown): Rec {
  const rec = asRecorder(value);
  if (!rec) throw new Error("render did not produce a recording");
  return rec;
}

async function opened(
  options?: GoldenOptions,
  patch: Record<string, unknown> = {},
): Promise<GoldenEnv> {
  const env = setup(options);
  env.view.init(null, asAsync(env.cx));
  await settle();
  Object.assign(env.view, structuredClone(patch));
  env.log.exec.length = 0;
  env.log.runs.length = 0;
  env.log.closed.length = 0;
  env.log.copies.length = 0;
  env.log.timers.length = 0;
  env.n0 = env.notifies;
  return env;
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
};

const fields = [
  "action",
  "terminal",
  "paneId",
  "cwd",
  "paneTitle",
  "sourceAgent",
  "selectedAgentIndex",
  "loading",
  "capturedText",
  "copied",
  "busy",
  "statusMessage",
] as const;

function viewState(view: HandoffDialog): unknown {
  const values = view as unknown as Record<string, unknown>;
  return plain(Object.fromEntries(fields.map((key) => [key, values[key] ?? null])));
}

const KEYS = [{ key: "escape" }, { key: "enter" }, { key: "x" }];

async function explore(
  label: string,
  options: GoldenOptions | undefined,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const probe = await opened(options, patch);
  const count = handlers(recOf(probe.view.render(asContext(probe.cx)))).length;
  for (let i = 0; i < count; i++) {
    const kinds =
      handlers(recOf(probe.view.render(asContext(probe.cx))))[i].name === "on_key_down"
        ? KEYS
        : [{}];
    for (const [k, ev] of kinds.entries()) {
      const env = await opened(options, patch);
      const handler: HandlerRecord = handlers(recOf(env.view.render(asContext(env.cx))))[i];
      await handler.fn(ev, env.cx);
      await settle();
      out[`${label}#${i}:${handler.path}:${handler.name}:${k}`] = {
        view: viewState(env.view),
        exec: plain(env.log.exec),
        runs: plain(env.log.runs),
        closed: plain(env.log.closed),
        copies: env.log.copies,
        timers: env.log.timers,
        notifies: env.notifies - env.n0,
        after: plain(recOf(env.view.render(asContext(env.cx)))),
      };
    }
  }
  return out;
}

test("handoff dialog behaves as recorded: renders, handlers and flows", async () => {
  const out: GoldenOut = { renders: {}, handlers: {}, flows: {} };
  const states: Record<string, GoldenOptions> = {
    handoff: {},
    fork: { props: { action: "fork" } },
    forkNoTerminal: {
      props: { action: "fork", terminal: "", pane: "" },
      panes: [],
      agents: [],
    },
    unknownAction: { props: { action: "weird" } },
    noPane: { panes: [] },
    byPane: {
      props: { terminal: "", pane: "p1" },
      agents: [{ pane: "p1", program: { name: "Claude" } }],
    },
    sameAgent: { agents: [{ address: "term1", app: "Claude Code" }] },
    claudeLower: { agents: [{ address: "term1", app: "claude" }] },
    hcFails: { hcResult: "reject" },
    hcNonZero: { hcResult: { code: 1, stdout: "x" } },
    hcEmpty: { hcResult: { code: 0, stdout: "" } },
    noAgent: { agents: [] },
    noProps: { props: { terminal: undefined, pane: undefined } },
  };
  for (const [name, options] of Object.entries(states)) {
    const env = await opened(options);
    out.renders[name] = {
      view: viewState(env.view),
      tree: plain(recOf(env.view.render(asContext(env.cx)))),
      hc: env.log.hc,
      cont: env.view.getContinuationPrompt(),
      fork: env.view.getForkPrompt(),
    };
    out.handlers[name] = await explore(name, options, {});
  }
  const patches: Record<string, Record<string, unknown>> = {
    loading: { loading: true },
    busy: { busy: true },
    copied: { copied: true, statusMessage: "Prompt copied to clipboard" },
    status: { statusMessage: "hello" },
    picked: { selectedAgentIndex: 3 },
    noCwd: { cwd: "", paneTitle: "" },
  };
  for (const [name, patch] of Object.entries(patches)) {
    for (const mode of ["handoff", "fork"]) {
      const options = states[mode];
      const env = await opened(options, patch);
      out.renders[`${mode}-${name}`] = plain(recOf(env.view.render(asContext(env.cx))));
      out.handlers[`${mode}-${name}`] = await explore(`${mode}-${name}`, options, patch);
    }
  }

  const flow = async (
    name: string,
    fn: (env: GoldenEnv) => unknown,
    options?: GoldenOptions,
    patch?: Record<string, unknown>,
  ): Promise<void> => {
    const env = await opened(options, patch);
    let thrown: string | null = null;
    let returned: unknown;
    try {
      returned = await fn(env);
      await settle();
    } catch (error) {
      thrown = String(error);
    }
    out.flows[name] = {
      thrown,
      returned: plain(returned),
      view: viewState(env.view),
      exec: plain(env.log.exec),
      runs: plain(env.log.runs),
      closed: plain(env.log.closed),
      copies: env.log.copies,
      timers: env.log.timers,
      notifies: env.notifies - env.n0,
    };
  };
  await flow("copy-handoff", (env) => env.view.copyCurrentPrompt(asContext(env.cx)));
  await flow("copy-fork", (env) => env.view.copyCurrentPrompt(asContext(env.cx)), {
    props: { action: "fork" },
  });
  await flow("copy-empty", (env) => env.view.copyCurrentPrompt(asContext(env.cx)), undefined, {
    sourceAgent: "x",
    capturedText: "",
  });
  await flow("handoff-run", (env) => env.view.executeHandoff(asContext(env.cx)));
  await flow("handoff-run-index", (env) => env.view.executeHandoff(asContext(env.cx)), undefined, {
    selectedAgentIndex: 7,
  });
  await flow(
    "handoff-run-out-of-range",
    (env) => env.view.executeHandoff(asContext(env.cx)),
    undefined,
    { selectedAgentIndex: 99 },
  );
  await flow("handoff-busy", (env) => env.view.executeHandoff(asContext(env.cx)), undefined, {
    busy: true,
  });
  await flow("handoff-no-cwd", (env) => env.view.executeHandoff(asContext(env.cx)), {
    panes: [],
  });
  await flow("handoff-twice", async (env) => {
    await env.view.executeHandoff(asContext(env.cx));
    await env.view.executeHandoff(asContext(env.cx));
  });
  const forks: Record<string, GoldenOptions> = {
    branch: {},
    emptyBranch: { git: { branch: { code: 0, stdout: "\n" } } },
    branchFails: { git: { branch: { code: 1, stdout: "" } } },
    branchThrows: {
      git: {
        branch: () => {
          throw new Error("x");
        },
      },
    },
    notRepo: { git: { "rev-parse": { code: 128, stdout: "" } } },
    revParseThrows: {
      git: {
        "rev-parse": () => {
          throw new Error("x");
        },
      },
    },
    noCwd: { panes: [] },
  };
  for (const [name, options] of Object.entries(forks))
    await flow(`fork-${name}`, (env) => env.view.executeFork(asContext(env.cx)), {
      props: { action: "fork" },
      ...options,
    });
  await flow(
    "fork-busy",
    (env) => env.view.executeFork(asContext(env.cx)),
    { props: { action: "fork" } },
    { busy: true },
  );
  await flow(
    "fork-twice",
    async (env) => {
      await env.view.executeFork(asContext(env.cx));
      await env.view.executeFork(asContext(env.cx));
    },
    { props: { action: "fork" } },
  );
  await flow(
    "fork-empty-prompt",
    (env) => env.view.executeFork(asContext(env.cx)),
    { props: { action: "fork" } },
    { capturedText: "" },
  );
  await flow(
    "init-spawn-timing",
    async (env) => {
      env.view.init(null, asAsync(env.cx));
      return viewState(env.view);
    },
    { hcResult: { code: 0, stdout: "later" } },
  );

  if (process.env.GOLDEN_FULL) writeFileSync(process.env.GOLDEN_FULL, JSON.stringify(out, null, 1));
  const digest: Record<string, string> = {};
  for (const [group, entries] of Object.entries(out))
    for (const [name, value] of Object.entries(entries))
      digest[`${group}/${name}`] = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  if (!existsSync(GOLDEN)) {
    assert.ok(
      process.env.GOLDEN_RECORD === "1",
      `missing ${GOLDEN}; rerun with GOLDEN_RECORD=1 to record an intended change`,
    );
    writeFileSync(GOLDEN, JSON.stringify(digest, null, 1) + "\n");
  }
  assert.deepStrictEqual(
    digest,
    JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>,
  );
});

test("handoff uses Herdr's installed catalog and configured argv, not hardcoded commands", async () => {
  const env = await opened({
    panes: [{ pane: "p1", tab: "t", terminal: "term1", cwd: "/repo" }],
    spaces: [{ id: "s", machine: "remote", tabs: [{ id: "t" }] }],
    inventory: [
      { key: "custom", name: "Custom Agent", run: ["custom", "--flag"], installed: true },
      { key: "claude", name: "Claude", run: ["claude"], installed: false },
    ],
  });
  assert.deepEqual(plain(env.log.inventory), { on: "remote" });
  const tree = JSON.stringify(recOf(env.view.render(asContext(env.cx))));
  assert.match(tree, /agent-opt-custom/);
  assert.doesNotMatch(tree, /agent-opt-claude/);
  await env.view.executeHandoff(asContext(env.cx));
  assert.deepEqual(plain(env.log.runs[0][1].argv), ["custom", "--flag"]);
  assert.equal(env.log.runs[0][1].space, "s");
  const empty = await opened({ inventory: [] });
  await empty.view.executeHandoff(asContext(empty.cx));
  assert.deepEqual(empty.log.runs, []);
  assert.match(empty.view.statusMessage, /No installed/);
  const failed = await opened({ inventory: "reject" });
  assert.match(failed.view.statusMessage, /discovery unavailable/);
  assert.match(JSON.stringify(recOf(failed.view.render(asContext(failed.cx)))), /agent-opt-claude/);
});
