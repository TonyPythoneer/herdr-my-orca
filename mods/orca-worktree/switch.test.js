// The Checkout branch dialog moves HEAD in a checkout the space already has, so the tests use a
// real throwaway repository: Git itself decides what a switch may do to a dirty or held branch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { ROOT, tilde, slug, ago, spaceOf, branchRows, switchBlocker } from "./helpers.js";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function repo() {
  const root = mkdtempSync(join(tmpdir(), "wt-switch-"));
  const dir = join(root, "repo");
  execFileSync("mkdir", [dir]);
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  execFileSync("sh", ["-c", "echo one > a.txt && git add a.txt && git commit -m one"], { cwd: dir });
  git(dir, "branch", "feat");
  return { root, dir };
}

// The dialog as the card menu opens it: `{ action: "switch", space }`. `spaces()` reports the
// space with the tabs the sidebar would draw, so an agent in one of them is visible here.
function dialog(folder, { agents = [], tabs = [] } = {}) {
  const source = readFileSync(new URL("./main.js", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "").replace("export default class Worktree", "class Worktree");
  const closed = [];
  const scope = {
    View: class {}, div: () => ({}), v_flex: () => ({}), h_flex: () => ({}), InputState: {}, Input: {}, Scrollbar: {},
    run() {}, props: () => ({ action: "switch", folder, space: "s1" }), closeOverlay: () => closed.push(true), theme: () => ({}),
    spaces: () => [{ id: "s1", folder, machine: null, name: basename(folder), tabs: tabs.map((id) => ({ id })) }],
    panes: () => [], agents: () => agents, home: () => "/home/u", removeWorktree: async () => {},
    exec: (...args) => import("node:child_process").then(({ execFile }) => new Promise((resolve) => {
      execFile(args[0], args[1], { cwd: args[2]?.cwd, timeout: args[2]?.timeout }, (error, stdout, stderr) => {
        resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr });
      });
    })),
    ROOT, tilde, slug, ago, spaceOf, branchRows, switchBlocker,
  };
  // `checkouts` is the dialog's own `git worktree list` read, exposed so a test can hand the
  // view the same list `init` would.
  vm.runInNewContext(source + "\nglobalThis.Worktree = Worktree; globalThis.checkouts = checkouts;", scope);
  const view = new scope.Worktree();
  Object.assign(view, {
    on: null, userHome: "/home/u", folder, text: "", list: [], busy: false, error: "",
    repo: { top: folder, main: folder, common: `${folder}/.git`, name: basename(folder), linked: false },
  });
  const row = (branch) => view.branchList().find((b) => b.branch === branch);
  const cx = { notify() {} };
  return { view, closed, row, cx, checkouts: scope.checkouts };
}

test("a clean checkout moves HEAD to the branch the dialog offers", async () => {
  const { dir } = repo();
  const { view, closed, row, cx } = dialog(dir);
  await view.loadBranches(view.repo);
  assert.equal(view.blocker, "");
  await view.switchTo(row("feat"), cx);
  assert.equal(git(dir, "rev-parse", "--abbrev-ref", "HEAD"), "feat");
  assert.deepEqual(closed, [true]);
});

test("uncommitted changes stop the switch before Git runs", async () => {
  const { dir } = repo();
  const { view, closed, row, cx } = dialog(dir);
  writeFileSync(join(dir, "a.txt"), "dirty\n");
  await view.loadBranches(view.repo);
  assert.match(view.blocker, /1 changed file/);
  await view.switchTo(row("feat"), cx);
  assert.equal(git(dir, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.match(view.error, /1 changed file/);
  assert.deepEqual(closed, []);
});

test("a branch another worktree holds is not switched to", async () => {
  const { root, dir } = repo();
  git(dir, "worktree", "add", join(root, "held"), "feat");
  const { view, closed, row, cx, checkouts } = dialog(dir);
  view.list = await checkouts(view.repo, null);
  await view.loadBranches(view.repo);
  const held = row("feat");
  assert.equal(held.branch, "feat");
  // Git resolves the temp folder's symlink, so compare the tail, not the prefix.
  assert.match(held.held, /\/held$/);
  await view.switchTo(held, cx);
  assert.equal(git(dir, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.deepEqual(closed, []);
});

test("an agent working in the space blocks the switch", async () => {
  const { dir } = repo();
  const agents = [{ tab: "t1", status: "working" }];
  const { view, closed, row, cx } = dialog(dir, { agents, tabs: ["t1"] });
  await view.loadBranches(view.repo);
  assert.match(view.blocker, /agent is working/);
  await view.switchTo(row("feat"), cx);
  assert.equal(git(dir, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.deepEqual(closed, []);
});
