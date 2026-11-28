import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import type { Context } from "gpui-kit";
import type { ExecResult } from "herdr";
import Changes from "../../../src/mods/orca-changes/main.js";
import type { Entry } from "../../../src/mods/orca-changes/main.js";

type Space = { id: string; folder: string; machine: string; active: boolean };
type Exec = (command: string, args: string[], options?: unknown) => Promise<ExecResult>;

const host = vi.hoisted((): { exec: Exec; spaces: () => Space[] } => ({
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  spaces: () => [],
}));

vi.mock("herdr", () => ({
  exec: (command: string, args: string[], options?: unknown) => host.exec(command, args, options),
  spaces: () => host.spaces(),
}));

function asContext(value: unknown): Context {
  return value as Context;
}

function fixture(exec: Exec) {
  let active: Space = { active: true, folder: "/repo", machine: "host", id: "space" };
  host.exec = exec;
  host.spaces = () => [active];
  const view = new Changes();
  Object.assign(view, {
    root: "/repo",
    on: "host",
    context: JSON.stringify({ cwd: "/repo", on: "host", space: "space" }),
    busy: false,
    refresh() {},
  });
  return {
    view,
    setActive(value: Space) {
      active = value;
    },
  };
}

const target = {
  root: "/repo",
  on: "host",
  context: JSON.stringify({ cwd: "/repo", on: "host", space: "space" }),
};
const conflict: Entry = {
  path: "conflict.txt",
  section: "conflicts",
  status: "!",
  fresh: false,
  add: 0,
  del: 0,
  xy: "UU",
};
const cx = {
  task: Promise.resolve() as Promise<unknown>,
  notify() {},
  spawn(fn: (value: Context) => unknown) {
    cx.task = Promise.resolve(fn(asContext(cx)));
  },
};

test("workspace or host changes during status prevent conflict staging", async () => {
  let releaseStatus: (value: ExecResult) => void = () => {};
  let statusStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    statusStarted = resolve;
  });
  const calls: [string, string[]][] = [];
  const f = fixture(async (bin, args) => {
    calls.push([bin, Array.from(args)]);
    statusStarted();
    return new Promise<ExecResult>((resolve) => {
      releaseStatus = resolve;
    });
  });
  f.view.resolveConflict(conflict, "mark_resolved", asContext(cx), target);
  await started;
  f.setActive({ active: true, folder: "/other", machine: "other-host", id: "other" });
  releaseStatus({
    code: 0,
    stdout: "u UU N... 100644 100644 100644 100644 a b c conflict.txt\0",
    stderr: "",
  });
  await cx.task;
  assert.equal(calls.length, 1);
  assert.ok(calls[0][1].includes("status"));
  assert.equal(calls[0][1].at(-1), "conflict.txt");
  assert.equal(calls[0][1].includes("add"), false);
  assert.equal(calls[0][1].includes("rm"), false);
});

test("keep-deletion never invokes git", () => {
  const calls: unknown[][] = [];
  const f = fixture(async (...args: unknown[]) => {
    calls.push(args);
    return { code: 0, stdout: "", stderr: "" };
  });
  f.view.resolveConflict(conflict, "keep_deletion", asContext(cx), target);
  assert.deepEqual(calls, []);
});
