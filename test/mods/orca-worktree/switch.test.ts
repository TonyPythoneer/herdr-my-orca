import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { asContext } from "./recording.js";

type ExecOptions = { cwd?: string; timeout?: number; on?: string | null };
type ExecResult = { code: number; stdout: string; stderr: string };
type Agent = { tab: string; status: string };

const host = vi.hoisted(() => ({
  props: (): Record<string, unknown> => ({}),
  spaces: (): unknown[] => [],
  agents: (): unknown[] => [],
  closeOverlay: (_id?: unknown) => {},
  exec: async (_cmd: string, _args: string[], _opts?: ExecOptions): Promise<ExecResult> => ({
    code: 0,
    stdout: "",
    stderr: "",
  }),
}));

vi.mock("gpui-kit", () => ({
  View: class View {},
  div: () => ({}),
  v_flex: () => ({}),
  h_flex: () => ({}),
}));
vi.mock("gpui-base", () => ({
  InputState: {},
  Input: {},
  Scrollbar: {},
  v_flex: () => ({}),
  h_flex: () => ({}),
}));
vi.mock("herdr", () => ({
  run() {},
  props: () => host.props(),
  closeOverlay: (id?: unknown) => host.closeOverlay(id),
  theme: () => ({}),
  spaces: () => host.spaces(),
  panes: () => [],
  agents: () => host.agents(),
  home: () => "/home/u",
  exec: (cmd: string, args: string[], opts?: ExecOptions) => host.exec(cmd, args, opts),
}));

import Worktree, { checkouts } from "../../../src/mods/orca-worktree/main.js";

const failureCode = (error: { code?: string | number | null }): number =>
  typeof error.code === "number" ? error.code : 1;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function repo() {
  const root = mkdtempSync(join(tmpdir(), "wt-switch-"));
  const dir = join(root, "repo");
  execFileSync("mkdir", [dir]);
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  execFileSync("sh", ["-c", "echo one > a.txt && git add a.txt && git commit -m one"], {
    cwd: dir,
  });
  git(dir, "branch", "feat");
  return { root, dir };
}

function dialog(
  folder: string,
  { agents = [], tabs = [] }: { agents?: Agent[]; tabs?: string[] } = {},
) {
  const closed: boolean[] = [];
  host.props = () => ({ action: "switch", folder, space: "s1" });
  host.closeOverlay = () => closed.push(true);
  host.spaces = () => [
    { id: "s1", folder, machine: null, name: basename(folder), tabs: tabs.map((id) => ({ id })) },
  ];
  host.agents = () => agents;
  host.exec = async (cmd, args, opts) => {
    const { execFile } = await import("node:child_process");
    return new Promise<ExecResult>((resolve) => {
      execFile(cmd, args, { cwd: opts?.cwd, timeout: opts?.timeout }, (error, stdout, stderr) => {
        resolve({
          code: error ? failureCode(error) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      });
    });
  };
  const view = new Worktree();
  Object.assign(view, {
    on: null,
    userHome: "/home/u",
    folder,
    text: "",
    list: [],
    busy: false,
    error: "",
    repo: {
      top: folder,
      main: folder,
      common: `${folder}/.git`,
      name: basename(folder),
      linked: false,
    },
  });
  const row = (branch: string) => view.branchList().find((b) => b.branch === branch);
  const cx = asContext({ notify() {} });
  return { view, closed, row, cx };
}

test("a clean checkout moves HEAD to the branch the dialog offers", async () => {
  const { dir } = repo();
  const { view, closed, row, cx } = dialog(dir);
  await view.loadBranches(view.repo!);
  assert.equal(view.blocker, "");
  await view.switchTo(row("feat"), cx);
  assert.equal(git(dir, "rev-parse", "--abbrev-ref", "HEAD"), "feat");
  assert.deepEqual(closed, [true]);
});

test("uncommitted changes stop the switch before Git runs", async () => {
  const { dir } = repo();
  const { view, closed, row, cx } = dialog(dir);
  writeFileSync(join(dir, "a.txt"), "dirty\n");
  await view.loadBranches(view.repo!);
  assert.match(view.blocker, /1 changed file/);
  await view.switchTo(row("feat"), cx);
  assert.equal(git(dir, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.match(view.error, /1 changed file/);
  assert.deepEqual(closed, []);
});

test("a branch another worktree holds is not switched to", async () => {
  const { root, dir } = repo();
  git(dir, "worktree", "add", join(root, "held"), "feat");
  const { view, closed, row, cx } = dialog(dir);
  view.list = await checkouts(view.repo!, null);
  await view.loadBranches(view.repo!);
  const held = row("feat");
  assert.equal(held!.branch, "feat");

  assert.match(held!.held!, /\/held$/);
  await view.switchTo(held, cx);
  assert.equal(git(dir, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.deepEqual(closed, []);
});

test("an agent working in the space blocks the switch", async () => {
  const { dir } = repo();
  const agents = [{ tab: "t1", status: "working" }];
  const { view, closed, row, cx } = dialog(dir, { agents, tabs: ["t1"] });
  await view.loadBranches(view.repo!);
  assert.match(view.blocker, /agent is working/);
  await view.switchTo(row("feat"), cx);
  assert.equal(git(dir, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.deepEqual(closed, []);
});
