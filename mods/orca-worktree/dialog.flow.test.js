import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { default: Worktree } = await import("./main.js");

test("remote open falls back to PowerShell and schedules input focus after the repository probe", async () => {
  const calls = [], events = [];
  globalThis.__herdrProps = () => ({ action: "open", space: "s" });
  globalThis.__herdrSpaces = () => [{ id: "s", active: true, folder: "/repo", machine: "host" }];
  globalThis.__herdrExec = (cmd, args, opts) => {
    calls.push(cmd);
    assert.equal(opts.on, "host");
    if (cmd === "sh") throw Error("unavailable");
    if (cmd === "powershell.exe") return { code: 0, stdout: "C:\\Users\\orca" };
    if (args.includes("--show-toplevel")) return { code: 0, stdout: "/repo" };
    if (args.includes("--git-common-dir")) return { code: 0, stdout: "/repo/.git" };
    return { code: 0, stdout: "" };
  };
  const cx = { focus_handle: () => ({ focus: () => events.push("focus") }), notify: () => events.push("notify"),
    spawn(fn) { this.task = fn(this); }, timer: { after(ms, fn) { events.push(ms); fn(); } } };
  const view = new Worktree();
  view.init({}, cx);
  await cx.task;
  assert.deepEqual(calls, ["sh", "powershell.exe", "git", "git", "git", "git"]);
  assert.deepEqual(events, ["focus", "notify", "focus", 100]);
  assert.equal(view.userHome, "C:/Users/orca");
  assert.equal(view.repo.name, "repo");
  assert.deepEqual(view.initialIdentity, { spaceId: "s", folder: "/repo", spaceFolder: "/repo", spaceMachine: "host", on: "host", active: "s" });
  assert.match(JSON.stringify(view.render(cx).__node), /No matching worktrees/);
});

test("switch and create render their detail and footer for each repository state", () => {
  const view = new Worktree();
  Object.assign(view, { folder: "/home/repo", userHome: "/home", text: "", branches: [], switching: true });
  globalThis.__herdrProps = () => ({});
  globalThis.__herdrSpaces = () => [];
  const render = () => JSON.stringify(view.render({}).__node);
  assert.match(render(), /…/);
  view.repo = { name: "repo" };
  view.branches = [{ branch: "main", current: true }, { branch: "topic", held: "/other/wt" }];
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
