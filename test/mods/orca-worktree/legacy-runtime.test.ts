import { beforeEach, test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import type { Context } from "gpui-kit";
import { asContext, asRecorder, type Rec } from "./recording.js";

type ExecOptions = { cwd?: string | null; on?: string | null; timeout?: number };
type Reply = { code: number; stdout: string; stderr: string };

const host = vi.hoisted(() => ({
  props: null as unknown,
  theme: {} as Record<string, string>,
  home: "/home/u" as string | null,
  spaces: [] as unknown[],
  inRepo: true,
  execs: [] as [string, string[], ExecOptions | undefined][],
  runs: [] as [string, unknown][],
  closed: [] as unknown[],
}));

function reply(args: string[]): Reply {
  const line = args.join(" ");
  if (line.includes("--show-toplevel"))
    return { code: host.inRepo ? 0 : 128, stdout: "/home/u/repo\n", stderr: "" };
  if (line.includes("--git-common-dir"))
    return { code: host.inRepo ? 0 : 128, stdout: "/home/u/repo/.git\n", stderr: "" };
  if (line.includes("show-ref")) return { code: 1, stdout: "", stderr: "" };
  return { code: 0, stdout: "", stderr: "" };
}

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
    InputState: { new: () => ({ on() {}, value: () => "", focus() {} }) },
  };
});
vi.mock("herdr", () => ({
  run: (name: string, args?: unknown) => {
    host.runs.push([name, args]);
  },
  props: () => host.props,
  closeOverlay: (id?: unknown) => {
    host.closed.push(id);
  },
  theme: () => host.theme,
  spaces: () => host.spaces,
  panes: () => [],
  agents: () => [],
  exec: async (cmd: string, args: string[], opts?: ExecOptions) => {
    host.execs.push([cmd, args, opts]);
    if (cmd === "sh" || cmd === "powershell.exe") return { code: 1, stdout: "", stderr: "" };
    return reply(args);
  },
  home: () => host.home,
}));

import Worktree from "../../../src/mods/orca-worktree/main.js";

beforeEach(() => {
  host.props = null;
  host.theme = {};
  host.home = "/home/u";
  host.spaces = [];
  host.inRepo = true;
  host.execs = [];
  host.runs = [];
  host.closed = [];
});

function recOf(value: unknown): Rec {
  const rec = asRecorder(value);
  if (!rec) throw new Error("render did not produce a recording");
  return rec;
}

function calls(rec: Rec, name: string): unknown[][] {
  const own = rec.c.filter(([key]) => key === name).map(([, args]) => args as unknown[]);
  return [...own, ...(rec.kids ?? []).flatMap((kid) => calls(kid, name))];
}

function texts(rec: Rec): string[] {
  const own = rec.c
    .filter(([key]) => key === "child")
    .map(([, args]) => (args as unknown[])[0])
    .filter((value): value is string => typeof value === "string");
  return [...own, ...(rec.kids ?? []).flatMap((kid) => texts(kid))];
}

async function mount(
  props: unknown,
): Promise<{ view: Worktree; cx: Context; tasks: Promise<unknown>[] }> {
  host.props = props;
  const tasks: Promise<unknown>[] = [];
  const raw = {
    notify() {},
    stop_propagation() {},
    focus_handle: () => ({ focus() {} }),
    spawn(fn: (taskCx: Context) => unknown) {
      tasks.push(Promise.resolve(fn(cx)));
    },
    timer: {
      after(_ms: number, fn: () => void) {
        fn();
      },
    },
  };
  const cx = asContext(raw);
  const view = new Worktree();
  view.init(null, cx);
  await Promise.all(tasks);
  return { view, cx, tasks };
}

test("theme tokens reach the dialog exactly as the host sent them", async () => {
  host.theme = {
    popover: "p0",
    background: "b0",
    foreground: "f0",
    muted: "m0",
    dim: "d0",
    input: "i0",
    accent: "a0",
    selected: "s0",
    hover: "h0",
    blocked: "k0",
  };
  const { view, cx } = await mount({ action: "new" });
  const rec = recOf(view.render(cx));
  assert.deepEqual(calls(rec, "bg"), [["p0"], ["b0"]]);
  assert.deepEqual(calls(rec, "text_color"), [["f0"], ["m0"], ["f0"], ["d0"]]);
});

test("null props render the new dialog and the bare reads throw as legacy did", async () => {
  host.spaces = [{ id: "s1", folder: "/repo", machine: null, name: "repo", active: true }];
  const { view, cx, tasks } = await mount(null);
  assert.equal(view.opening, false);
  assert.equal(view.switching, false);
  assert.equal(view.text, "");
  assert.deepEqual(view.initialIdentity, {
    spaceId: null,
    folder: null,
    spaceFolder: null,
    spaceMachine: null,
    on: null,
    active: "s1",
  });
  assert.equal(view.repo?.name, "repo");
  assert.ok(texts(recOf(view.render(cx))).includes("New worktree of repo"));
  assert.throws(() => view.key({ key: "escape" }, cx), TypeError);
  view.go(cx);
  await Promise.all(tasks);
  assert.match(view.error, /Cannot read properties of null \(reading 'action'\)/);
  assert.deepEqual(host.runs, []);
  assert.deepEqual(host.closed, []);
});

test("malformed prop values reach the host raw", async () => {
  const { view } = await mount({ action: "new", branch: "feat", tab: 7, argv: "not-an-array" });
  assert.equal(view.text, "feat");
  assert.deepEqual(host.runs, [
    [
      "space.new",
      {
        folder: "/home/u/.herdr/worktrees/repo/feat",
        machine: "",
        tab: 7,
        argv: "not-an-array",
      },
    ],
  ]);
  assert.deepEqual(host.closed, [undefined]);
});

test("a remote host with no home folder fails the dialog with the legacy message", async () => {
  const { view } = await mount({ action: "new", machine: "host" });
  assert.equal(view.repo, null);
  assert.equal(view.error, "Error: Could not find the remote home folder.");
});

test("a null folder is passed to git as null and reads as not in a repository", async () => {
  host.home = null;
  host.inRepo = false;
  const { view, cx } = await mount({ action: "new" });
  assert.equal(view.folder, null);
  assert.equal(view.repo, null);
  assert.deepEqual(host.execs[0], [
    "git",
    ["rev-parse", "--show-toplevel"],
    { cwd: null, on: null },
  ]);
  assert.ok(texts(recOf(view.render(cx))).includes("This folder is not in a git repository."));
});

test("a null home makes the create path start with null and the new-space detail throw", async () => {
  host.home = null;
  const { view, cx } = await mount({ action: "new", branch: "feat" });
  assert.deepEqual(host.runs, [
    [
      "space.new",
      { folder: "null/.herdr/worktrees/repo/feat", machine: "", tab: undefined, argv: undefined },
    ],
  ]);
  assert.throws(() => view.render(cx), TypeError);
});
