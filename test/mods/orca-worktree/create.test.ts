import { test, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { ROOT } from "../../../src/mods/orca-worktree/helpers.js";

type ExecResult = { code: number; stdout: string; stderr: string };
type Run = { name: string; args?: Record<string, unknown> };

const host = vi.hoisted((): { home: string; runs: unknown[] } => ({
  home: "/home/u",
  runs: [],
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
  run: (name: string, args?: Record<string, unknown>) => host.runs.push({ name, args }),
  props: () => ({ action: "new" }),
  home: () => host.home,
  closeOverlay() {},
  theme: () => ({}),
  spaces: () => [],
  panes: () => [],
  agents: () => [],
  exec: async (cmd: string, args: string[], opts?: { cwd?: string; timeout?: number }) => {
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
  },
}));

import Worktree from "../../../src/mods/orca-worktree/main.js";

const failureCode = (error: { code?: string | number | null }): number =>
  typeof error.code === "number" ? error.code : 1;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function repo() {
  const root = mkdtempSync(join(tmpdir(), "wt-create-"));
  const dir = join(root, "repo");
  execFileSync("mkdir", [dir]);
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  execFileSync("sh", ["-c", "echo one > a.txt && git add a.txt && git commit -m one"], {
    cwd: dir,
  });
  return { root, dir };
}

function dialog(home: string, folder: string, text: string) {
  const runs: Run[] = [];
  host.runs = runs;
  const view = new Worktree();
  Object.assign(view, {
    on: null,
    userHome: home,
    text,
    repo: {
      top: folder,
      main: folder,
      common: `${folder}/.git`,
      name: basename(folder),
      linked: false,
    },
  });
  return { view, runs };
}

test("a new branch creates a checkout under the Herdr worktree root and opens a space", async () => {
  const { root, dir } = repo();
  const home = join(root, "home");
  execFileSync("mkdir", ["-p", home]);
  const { view, runs } = dialog(home, dir, "feat/login");
  assert.equal(await view.create(), "");
  const path = `${ROOT(home)}/repo/feat-login`;
  assert.equal(existsSync(join(path, "a.txt")), true);
  assert.equal(readFileSync(join(path, "a.txt"), "utf8"), "one\n");
  assert.equal(git(dir, "rev-parse", "--verify", "refs/heads/feat/login").length > 0, true);
  assert.equal(
    JSON.stringify(runs.at(-1)),
    JSON.stringify({ name: "space.new", args: { folder: path, machine: "" } }),
  );
});

test("an existing branch is checked out instead of recreated", async () => {
  const { root, dir } = repo();
  const home = join(root, "home");
  execFileSync("mkdir", ["-p", home]);
  git(dir, "branch", "release");
  const { view } = dialog(home, dir, "release");
  assert.equal(await view.create(), "");
  assert.equal(existsSync(join(ROOT(home), "repo", "release", "a.txt")), true);
  assert.equal(git(dir, "rev-parse", "--verify", "refs/heads/release").length > 0, true);
});

test("invalid names are refused before Git runs", async () => {
  const { root, dir } = repo();
  const home = join(root, "home");
  execFileSync("mkdir", ["-p", home]);
  assert.equal(await dialog(home, dir, "   ").view.create(), "Type a branch name.");
  assert.equal(await dialog(home, dir, "-x").view.create(), "Branch names cannot start with -.");
  assert.equal(
    await dialog(home, dir, "…").view.create(),
    "Branch name must contain a letter or number.",
  );
  assert.equal(existsSync(join(ROOT(home), "repo")), false);
});

test("a Git refusal is reported and no space is opened", async () => {
  const { root, dir } = repo();
  const home = join(root, "home");
  execFileSync("mkdir", ["-p", home]);
  const first = dialog(home, dir, "dup");
  assert.equal(await first.view.create(), "");
  const second = dialog(home, dir, "dup");
  const error = await second.view.create();
  assert.match(error, /already|used|exists/i);
  assert.deepEqual(second.runs, []);
});
