import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import vm from "node:vm";
import { ROOT, tilde, slug, ago, spaceOf } from "./helpers.js";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function repo() {
  const root = mkdtempSync(join(tmpdir(), "wt-create-"));
  const dir = join(root, "repo");
  execFileSync("mkdir", [dir]);
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  execFileSync("sh", ["-c", "echo one > a.txt && git add a.txt && git commit -m one"], { cwd: dir });
  return { root, dir };
}

function dialog(home, folder, text) {
  const source = readFileSync(new URL("./main.js", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "").replace("export default class Worktree", "class Worktree");
  const runs = [];
  const scope = {
    View: class {}, div: () => ({}), v_flex: () => ({}), h_flex: () => ({}), InputState: {}, Input: {}, Scrollbar: {},
    run: (name, args) => runs.push({ name, args }), props: () => ({ action: "new" }),
    closeOverlay() {}, theme: () => ({}), spaces: () => [], panes: () => [], exec: (...args) => import("node:child_process").then(({ execFile }) => new Promise((resolve) => {
      execFile(args[0], args[1], { cwd: args[2]?.cwd, timeout: args[2]?.timeout }, (error, stdout, stderr) => {
        resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr });
      });
    })),
    home: () => home,
    removeWorktree: async () => {}, ROOT, tilde, slug, ago, spaceOf,
  };
  vm.runInNewContext(source + "\nglobalThis.Worktree = Worktree;", scope);
  const view = new scope.Worktree();
  Object.assign(view, {
    on: null, userHome: home, text,
    repo: { top: folder, main: folder, common: `${folder}/.git`, name: basename(folder), linked: false },
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
  assert.equal(JSON.stringify(runs.at(-1)), JSON.stringify({ name: "space.new", args: { folder: path, machine: "" } }));
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
  assert.equal(await dialog(home, dir, "…").view.create(), "Branch name must contain a letter or number.");
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
