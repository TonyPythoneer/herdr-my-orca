import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { asContext, asRecorder, type Rec } from "./recording.js";

type ExecOptions = { on?: string | null; cwd?: string; timeout?: number };
type TestCx = {
  task?: Promise<void>;
  focus_handle(): { focus(): void };
  notify(): void;
  spawn(fn: (cx: TestCx) => Promise<void>): void;
  timer: { after(ms: number, fn: () => void): void };
};

const host = vi.hoisted(() => ({
  props: (): Record<string, unknown> | undefined => ({}),
  spaces: (): unknown[] => [],
  exec: (_cmd: string, _args: string[], _opts?: ExecOptions): unknown => ({}),
}));

vi.mock("gpui-kit", async () => {
  const { element } = await import("./recording.js");
  return { View: class View {}, div: element("div") };
});
vi.mock("gpui-base", async () => {
  const { element, recorder } = await import("./recording.js");
  return {
    v_flex: element("v_flex"),
    h_flex: element("h_flex"),
    Input: recorder("Input"),
    Scrollbar: recorder("Scrollbar"),
    InputState: recorder("InputState"),
  };
});
vi.mock("herdr", async () => {
  const { theme } = await import("./recording.js");
  return {
    run() {},
    props: () => host.props(),
    closeOverlay() {},
    theme: () => theme,
    spaces: () => host.spaces(),
    panes: () => [],
    agents: () => [],
    exec: async (cmd: string, args: string[], opts?: ExecOptions) => host.exec(cmd, args, opts),
    home: () => "/home",
  };
});

import Worktree from "../../../src/mods/orca-worktree/main.js";

function recOf(value: unknown): Rec {
  const rec = asRecorder(value);
  if (!rec) throw new Error("render did not produce a recording");
  return rec;
}

test("remote open falls back to PowerShell and schedules input focus after the repository probe", async () => {
  const calls: string[] = [],
    events: (string | number)[] = [];
  host.props = () => ({ action: "open", space: "s" });
  host.spaces = () => [{ id: "s", active: true, folder: "/repo", machine: "host" }];
  host.exec = (cmd, args, opts) => {
    calls.push(cmd);
    assert.equal(opts?.on, "host");
    if (cmd === "sh") throw Error("unavailable");
    if (cmd === "powershell.exe") return { code: 0, stdout: "C:\\Users\\orca" };
    if (args.includes("--show-toplevel")) return { code: 0, stdout: "/repo" };
    if (args.includes("--git-common-dir")) return { code: 0, stdout: "/repo/.git" };
    return { code: 0, stdout: "" };
  };
  const cx: TestCx = {
    focus_handle: () => ({ focus: () => events.push("focus") }),
    notify: () => events.push("notify"),
    spawn(fn) {
      this.task = fn(this);
    },
    timer: {
      after(ms, fn) {
        events.push(ms);
        fn();
      },
    },
  };
  const view = new Worktree();
  view.init({}, asContext(cx));
  await cx.task;
  assert.deepEqual(calls, ["sh", "powershell.exe", "git", "git", "git", "git"]);
  assert.deepEqual(events, ["focus", "notify", "focus", 100]);
  assert.equal(view.userHome, "C:/Users/orca");
  assert.equal(view.repo!.name, "repo");
  assert.deepEqual(view.initialIdentity, {
    spaceId: "s",
    folder: "/repo",
    spaceFolder: "/repo",
    spaceMachine: "host",
    on: "host",
    active: "s",
  });
  assert.match(JSON.stringify(recOf(view.render(asContext(cx)))), /No matching worktrees/);
});

test("switch and create render their detail and footer for each repository state", () => {
  const view = new Worktree();
  Object.assign(view, {
    folder: "/home/repo",
    userHome: "/home",
    text: "",
    branches: [],
    switching: true,
  });
  host.props = () => ({});
  host.spaces = () => [];
  const render = () => JSON.stringify(recOf(view.render(asContext({}))));
  assert.match(render(), /…/);
  view.repo = {
    top: "/home/repo",
    main: "/home/repo",
    common: "/home/repo/.git",
    name: "repo",
    linked: false,
  };
  view.branches = [
    { branch: "main", at: 0, current: true, held: null },
    { branch: "topic", at: 0, current: false, held: "/other/wt" },
  ];
  assert.deepEqual(view.visible(), view.branches);
  assert.match(render(), /in wt/);
  view.blocker = "dirty";
  assert.match(render(), /dirty/);
  view.busy = true;
  assert.match(render(), /switching…/);
  view.switching = false;
  assert.match(render(), /working…/);
  view.repo = null;
  assert.match(render(), /is not in a git repository/);
  view.repo = undefined;
  assert.match(render(), /…/);
});

test("loading without overlay props preserves the resolved repository", async () => {
  const view = new Worktree();
  view.initialIdentity = {
    spaceId: null,
    folder: "/repo",
    spaceFolder: null,
    spaceMachine: null,
    on: null,
    active: null,
  };
  view.userHome = "/home";
  view.loadRepo = async () => {
    view.repo = { top: "/repo", main: "/repo", common: "/repo/.git", name: "repo", linked: false };
  };
  Object.assign(view, { handle: { focus() {} }, input: { focus() {} } });
  host.props = () => undefined;
  let scheduled = 0;
  await view.load(
    asContext({
      notify() {},
      timer: {
        after() {
          scheduled++;
        },
      },
    }),
  );
  assert.equal(view.repo!.name, "repo");
  assert.equal(scheduled, 1);
});
