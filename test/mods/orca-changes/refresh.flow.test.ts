import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import type { Context } from "gpui-kit";
import type { ExecResult } from "herdr";
import Changes from "../../../src/mods/orca-changes/main.js";

type Space = { active: boolean; folder: string; machine: string; id: string };
type Exec = (command: string, args: string[], options?: unknown) => Promise<ExecResult>;

const host = vi.hoisted(
  (): { exec: Exec; spaces: () => Space[]; watchFolder: () => Promise<unknown> } => ({
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    spaces: () => [],
    watchFolder: () => new Promise(() => {}),
  }),
);

vi.mock("herdr", () => ({
  exec: (command: string, args: string[], options?: unknown) => host.exec(command, args, options),
  spaces: () => host.spaces(),
  watchFolder: () => host.watchFolder(),
}));

function asContext(value: unknown): Context {
  return value as Context;
}

test("refresh separates index and worktree counts, preserves paths and caps porcelain records", async () => {
  host.spaces = () => [{ active: true, folder: "/repo", machine: "remote", id: "s" }];
  const status = [
    "MM dir/a\tb",
    "AD bin",
    "DU conflicted",
    ...Array(998).fill("?? untracked"),
  ].join("\0");
  const calls: string[][] = [];
  host.exec = async (bin, args, options) => {
    assert.equal(bin, "git");
    assert.deepEqual(options, { cwd: "/repo", on: "remote" });
    calls.push(args);
    let stdout = "/repo\n";
    if (args.includes("status")) stdout = status;
    if (args.includes("diff"))
      stdout = args.includes("--cached") ? "1\t2\tdir/a\tb\0-\t-\tbin\0" : "3\t4\tdir/a\tb\0";
    return { code: 0, stdout, stderr: "" };
  };
  const view = new Changes();
  Object.assign(view, { input: { set_value() {} } });
  const cx = {
    task: Promise.resolve() as Promise<unknown>,
    spawn(fn: (value: Context) => unknown) {
      cx.task = Promise.resolve(fn(asContext(cx)));
    },
    notify() {},
  };
  view.refresh(asContext(cx));
  await cx.task;
  assert.equal(calls.length, 4);
  assert.equal(view.error, null);
  assert.equal(view.limited, true);
  assert.equal(view.loading, false);
  assert.equal(view.files.length, 1002);
  assert.deepEqual(
    view.files.slice(0, 5).map((f) => [f.path, f.section, f.status, f.add, f.del]),
    [
      ["dir/a\tb", "staged", "M", 1, 2],
      ["dir/a\tb", "changes", "M", 3, 4],
      ["bin", "staged", "A", 0, 0],
      ["bin", "changes", "D", 0, 0],
      ["conflicted", "conflicts", "!", 0, 0],
    ],
  );
  assert.equal(view.files[2].binary, true);
  assert.equal(view.files[4].xy, "DU");
  assert.equal(view.files.at(-1)?.fresh, true);
});
