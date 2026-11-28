import assert from "node:assert/strict";
import { test, vi } from "vite-plus/test";
import type { Context } from "gpui-kit";
import { asRecorder, type Rec } from "./recording.js";
import HandoffDialog from "../../../src/mods/orca-handoff/main.ts";

type ExecOptions = { cwd?: string };
type RunArgs = Record<string, unknown> | undefined;

const host = vi.hoisted(() => ({
  props: () => ({}) as Record<string, unknown>,
  exec: (_cmd: string, _args: string[], _opts?: ExecOptions): unknown => ({ code: 0 }),
  run: (_cmd: string, _args?: RunArgs) => {},
  closeOverlay: (_id?: string) => {},
  panes: () => [] as unknown[],
  agents: () => [] as unknown[],
  spaces: () => [] as unknown[],
  knownAgents: async (_options?: { on?: string | null }) => [] as unknown[],
  hc: async (_args: string[]) => ({ code: 0, stdout: "" }),
}));

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
    run: (cmd: string, args?: RunArgs) => host.run(cmd, args),
    props: () => host.props(),
    closeOverlay: (id?: string) => host.closeOverlay(id),
    theme: () => theme,
    panes: () => host.panes(),
    agents: () => host.agents(),
    knownAgents: (options?: { on?: string | null }) => host.knownAgents(options),
    spaces: () => host.spaces(),
    hc: (args: string[]) => host.hc(args),
    exec: async (cmd: string, args?: string[], opts?: ExecOptions) =>
      host.exec(cmd, args ?? [], opts),
  };
});
vi.mock("../../../src/shared/clip.ts", () => ({ copyText: () => {} }));

function recOf(value: unknown): Rec {
  const rec = asRecorder(value);
  if (!rec) throw new Error("render did not produce a recording");
  return rec;
}

test("fork launches once after Git probes, with the original folder and prompt", async () => {
  for (const [cwd, top, branch, name] of [
    ["/repo", 0, "topic\n", "Fork: topic-fork"],
    ["/repo", 0, "", "Fork: session-fork"],
    ["/repo", 0, null, "Fork: main-fork"],
    ["/repo", 1, null, "Session Fork"],
    ["", 1, null, "Session Fork"],
  ] as const) {
    const events: unknown[] = [];
    host.props = () => ({ overlay: "dialog" });
    host.exec = (cmd, args, opts) => {
      assert.equal(cmd, "git");
      assert.equal(opts?.cwd, cwd);
      events.push(args[0]);
      if (args[0] === "rev-parse") return { code: top, stdout: cwd };
      if (branch === null) throw Error("unavailable");
      return { code: 0, stdout: branch };
    };
    host.run = (cmd, args) => {
      events.push([cmd, args]);
    };
    host.closeOverlay = (id) => {
      events.push(id);
    };
    const view = Object.assign(new HandoffDialog(), {
      cwd,
      capturedText: "progress",
      sourceAgent: "codex",
    });
    const cx = { notify: () => events.push("notify") };
    await view.executeFork(cx as unknown as Context);
    await view.executeFork(cx as unknown as Context);
    const probes = cwd ? ["rev-parse"] : [];
    if (cwd && top === 0) probes.push("branch");
    assert.deepEqual(events, [
      "notify",
      ...probes,
      ["tab.new", { name, folder: cwd || undefined, task: view.getForkPrompt() }],
      "dialog",
    ]);
  }
});

test("handoff picker, copy delay and busy fork footer reflect dialog state", async () => {
  const view = Object.assign(new HandoffDialog(), {
    action: "handoff",
    cwd: "/repo",
    capturedText: "progress",
    sourceAgent: "codex",
    selectedAgentIndex: 1,
    statusMessage: "ready",
  });
  const events: unknown[] = [];
  host.props = () => ({ overlay: "dialog" });
  host.closeOverlay = (id) => {
    events.push(id);
  };
  const cx = {
    notify() {},
    timer: {
      after(ms: number, fn: () => void) {
        events.push(ms);
        fn();
      },
    },
  };
  const render = () => JSON.stringify(recOf(view.render(cx as unknown as Context)));
  assert.match(render(), /agent-opt-opencode/);
  assert.match(render(), /Start Session/);
  await view.copyCurrentPrompt(cx as unknown as Context);
  assert.deepEqual(events, [600, "dialog"]);
  assert.match(render(), /Copied!/);
  view.action = "fork";
  assert.doesNotMatch(render(), /agent-opt-/);
  assert.match(render(), /Start Fork/);
  view.busy = true;
  assert.match(render(), /Launching…/);
});
