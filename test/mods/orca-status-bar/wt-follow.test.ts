import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  isLinked,
  parseCheckout,
  planFollow,
  type Checkout,
  type SpaceRef,
} from "../../../src/mods/orca-status-bar/wt-follow.js";

const main = ["/Users/t/repo", "/Users/t/repo/.git", "/Users/t/repo/.git", "main"].join("\n");
const linked = [
  "/Users/t/wt/foo",
  "/Users/t/repo/.git/worktrees/foo",
  "/Users/t/repo/.git",
  "feature/foo",
].join("\n");

const repo = parseCheckout(main);
const wt = parseCheckout(linked);

const checkoutOf = (checkout: Checkout | null): Checkout => {
  assert.ok(checkout);
  return checkout;
};

const space = (
  id: string,
  folder: string,
  checkout: Checkout | null,
  {
    active = true,
    machine = null,
    tab = `tab-${id}`,
  }: { active?: boolean; machine?: string | null; tab?: string } = {},
): SpaceRef => ({
  id,
  folder,
  checkout,
  machine,
  active,
  tabs: [{ id: tab, name: "1", named: false }],
});
const agent = (terminal: string, tab: string, extra = {}) => ({
  terminal,
  tab,
  program: { agent: true, name: "Claude Code" },
  ...extra,
});

test("a main checkout and a linked worktree are told apart", () => {
  assert.deepEqual(repo, {
    top: "/Users/t/repo",
    gitdir: "/Users/t/repo/.git",
    common: "/Users/t/repo/.git",
    branch: "main",
  });
  assert.deepEqual(wt, {
    top: "/Users/t/wt/foo",
    gitdir: "/Users/t/repo/.git/worktrees/foo",
    common: "/Users/t/repo/.git",
    branch: "feature/foo",
  });
  assert.equal(isLinked(repo), false);
  assert.equal(isLinked(wt), true);
  assert.equal(isLinked(null), false);
  assert.equal(parseCheckout(""), null);
  assert.equal(parseCheckout("fatal: not a git repository"), null);
});

test("parseCheckout of no output is null, as the legacy String(out ?? '') reads it", () => {
  assert.equal(parseCheckout(undefined), null);
  assert.equal(parseCheckout(null), null);
});

test("an agent that moved into a worktree takes its tab there", () => {
  const move = planFollow({
    spaces: [space("s1", "/Users/t/repo", repo)],
    panes: [agent("t1", "tab-s1")],
    cwds: { t1: "/Users/t/wt/foo" },
    cwdCheckouts: { "/Users/t/wt/foo": wt },
  });
  assert.deepEqual(move, {
    terminal: "t1",
    app: "Claude Code",
    to: "/Users/t/wt/foo",
    branch: "feature/foo",
    from: {
      space: "s1",
      folder: "/Users/t/repo",
      tab: "tab-s1",
      active: true,
      tabName: null,
      onlyTerminal: true,
    },
  });
});

test("a space on a worktree keeps the tab when the agent stays in it", () => {
  assert.equal(
    planFollow({
      spaces: [space("s2", "/Users/t/wt/foo", wt)],
      panes: [agent("t1", "tab-s2")],
      cwds: { t1: "/Users/t/wt/foo" },
      cwdCheckouts: { "/Users/t/wt/foo": wt },
    }),
    null,
  );
});

test("the shell next to the agent, a plain folder, another repo and another machine stay put", () => {
  const other = parseCheckout(
    ["/Users/t/other/wt", "/Users/t/other/.git/worktrees/wt", "/Users/t/other/.git", "x"].join(
      "\n",
    ),
  );
  const base = {
    spaces: [space("s1", "/Users/t/repo", repo)],
    cwds: { t1: "/Users/t/wt/foo" },
    cwdCheckouts: { "/Users/t/wt/foo": wt },
  };
  assert.equal(
    planFollow({ ...base, panes: [{ terminal: "t1", tab: "tab-s1", program: { agent: false } }] }),
    null,
  );
  assert.equal(
    planFollow({
      ...base,
      panes: [agent("t1", "tab-s1")],
      cwds: { t1: "/Users/t/repo" },
      cwdCheckouts: { "/Users/t/repo": repo },
    }),
    null,
  );
  assert.equal(
    planFollow({
      ...base,
      panes: [agent("t1", "tab-s1")],
      cwdCheckouts: { "/Users/t/wt/foo": other },
    }),
    null,
  );
  assert.equal(
    planFollow({
      ...base,
      spaces: [space("s1", "/Users/t/repo", repo, { machine: "vps" })],
      panes: [agent("t1", "tab-s1")],
    }),
    null,
  );
  assert.equal(
    planFollow({
      ...base,
      panes: [agent("t1", "tab-s1")],
      cwds: { t1: null },
      cwdCheckouts: { null: null },
    }),
    null,
  );
});

test("a terminal already sent to that worktree does not move again", () => {
  assert.equal(
    planFollow({
      spaces: [space("s1", "/Users/t/repo", repo)],
      panes: [agent("t1", "tab-s1")],
      cwds: { t1: "/Users/t/wt/foo" },
      cwdCheckouts: { "/Users/t/wt/foo": wt },
      moved: { t1: "/Users/t/wt/foo" },
    }),
    null,
  );
});

test("a named tab keeps its name; a shared tab keeps its space alive", () => {
  const s: SpaceRef = {
    ...space("s1", "/Users/t/repo", repo),
    tabs: [{ id: "tab-s1", name: "fix login", named: true }],
  };
  const move = planFollow({
    spaces: [s],
    panes: [agent("t1", "tab-s1"), agent("t2", "tab-s1")],
    cwds: { t1: "/Users/t/wt/foo", t2: "/Users/t/repo" },
    cwdCheckouts: { "/Users/t/wt/foo": wt, "/Users/t/repo": repo },
  });
  assert.equal(move?.from.tabName, "fix login");
  assert.equal(move?.from.onlyTerminal, false);
});

test("a named tab without a name keeps the legacy undefined tabName", () => {
  const s: SpaceRef = {
    ...space("s1", "/Users/t/repo", repo),
    tabs: [{ id: "tab-s1", named: true }],
  };
  const move = planFollow({
    spaces: [s],
    panes: [agent("t1", "tab-s1")],
    cwds: { t1: "/Users/t/wt/foo" },
    cwdCheckouts: { "/Users/t/wt/foo": wt },
  });
  assert.ok(move);
  assert.equal(move.from.tabName, undefined);
  assert.equal("tabName" in move.from, true);
});

test("a space whose checkout is missing never moves a pane", () => {
  assert.equal(
    planFollow({
      spaces: [space("s1", "/Users/t/repo", null)],
      panes: [agent("t1", "tab-s1")],
      cwds: { t1: "/Users/t/wt/foo" },
      cwdCheckouts: { "/Users/t/wt/foo": checkoutOf(wt) },
    }),
    null,
  );
});
