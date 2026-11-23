import { test } from "node:test";
import assert from "node:assert/strict";
import { ROOT, tilde, slug, ago, place, inside, spaceOf, branchRows, switchBlocker } from "./helpers.js";

test("ROOT, tilde, slug keep their display semantics", () => {
  assert.equal(ROOT("/home/u"), "/home/u/.herdr/worktrees");
  assert.equal(tilde("/home/u/repo", "/home/u"), "~/repo");
  assert.equal(tilde("C:\\Users\\u\\repo", "C:\\Users\\u"), "~/repo");
  assert.equal(tilde("/elsewhere", "/home/u"), "/elsewhere");
  assert.equal(slug("feat/a b/c!"), "feat-a-b-c");
  assert.equal(slug(""), "");
});

test("ago buckets minutes, hours, days, months", () => {
  const now = 1_000_000_000_000;
  assert.equal(ago(now / 1000 - 60, now), "1m");
  assert.equal(ago(now / 1000 - 3600, now), "1h");
  assert.equal(ago(now / 1000 - 86400, now), "1d");
  assert.equal(ago(now / 1000 - 86400 * 60, now), "2mo");
});

test("place prefers a live matching pane over the saved folder", () => {
  const panes = [{ tab: "t1", cwd: "/live" }, { tab: "t2", cwd: "/other" }];
  assert.equal(place({ tabs: [{ id: "t1" }], folder: "/saved" }, panes), "/live");
  assert.equal(place({ tabs: [], folder: "/saved" }, panes), "/saved");
  assert.equal(place(null, panes), null);
});

test("spaceOf picks the deepest matching checkout and respects host", () => {
  const all = [{ path: "/repo" }, { path: "/repo/nested" }];
  const spaces = [
    { id: "a", machine: null, tabs: [], folder: "/repo" },
    { id: "b", machine: null, tabs: [{ id: "t" }], folder: "/ignored" },
    { id: "c", machine: "host-x", tabs: [], folder: "/repo/nested" },
  ];
  const paneList = [{ tab: "t", cwd: "/repo/nested/deep" }];
  assert.equal(spaceOf("/repo", all, null, spaces, paneList).id, "a");
  assert.equal(spaceOf("/repo/nested", all, null, spaces, paneList).id, "b");
  assert.equal(spaceOf("/repo/nested", all, "host-x", spaces, paneList).id, "c");
  assert.equal(inside("/repo/nested", "/repo"), true);
  assert.equal(inside("/repository", "/repo"), false);
});

test("branch rows put the current branch first, then newest commit, and name the worktree holding one", () => {
  const rows = branchRows(
    [{ branch: 'main', at: 10 }, { branch: 'feat', at: 30 }, { branch: 'old', at: 1 }],
    [{ path: '/w/old', branch: 'old' }, { path: '/w/feat', branch: 'feat' }],
    'feat',
  );
  assert.deepEqual(rows.map((r) => r.branch), ['feat', 'main', 'old']);
  assert.equal(rows[0].current, true);
  assert.equal(rows[0].held, null); // the checkout it is already in is not "held"
  assert.equal(rows.find((r) => r.branch === 'old').held, '/w/old');
  assert.equal(rows.find((r) => r.branch === 'main').held, null);
});

test("a switch is blocked by a working agent, then unreadable changes, then a dirty tree", () => {
  assert.match(switchBlocker({ agentWorking: true, dirtyCount: 3 }), /agent is working/);
  assert.match(switchBlocker({ statusKnown: false }), /couldn't read/i);
  assert.match(switchBlocker({ dirtyCount: 1 }), /1 changed file before/);
  assert.match(switchBlocker({ dirtyCount: 2 }), /2 changed files before/);
  assert.equal(switchBlocker({}), '');
});
