import { it } from "vite-plus/test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  applyWorkspaceOptions,
  base,
  optionTitle,
  parseWorktreeList,
  projectWorktreePlan,
  readPair,
  recentOf,
  sortRows,
  where,
  groupSpaceIds,
  forgetProject,
} from "../../../src/mods/orca-sidebar-projects/worktree-plan.ts";

it("project sort by name orders project groups by their display name", () => {
  const rows = [
    { w: { id: "z", tabs: [] }, g: { repo: "z", name: "Zulu", linked: false } },
    { w: { id: "a", tabs: [] }, g: { repo: "a", name: "Alpha", linked: false } },
  ];
  const sorted = applyWorkspaceOptions(rows, { groupBy: "repo", projectOrderBy: "name" });
  assert.deepEqual(
    sorted.map((row) => row.w.id),
    ["a", "z"],
  );
});

it("deleted worktrees disappear from the sidebar without closing their tabs", () => {
  const repo = JSON.stringify([null, "/repo/.git"]);
  const space = { id: "deleted", folder: "/deleted", tabs: [{ id: "tab" }] };
  const catalog = parseWorktreeList(
    "worktree /repo\nbranch refs/heads/main\n\nworktree /deleted\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n",
  );
  const gitState = {
    [where(space)]: {
      repo,
      top: "/deleted",
      name: "repo",
      linked: true,
      branch: "old",
      worktrees: catalog,
    },
  };
  const plan = projectWorktreePlan({ spaces: [space], gitState, loaded: true });
  assert.equal(
    plan.visibleRows.some((r) => r.w.id === "deleted"),
    false,
  );
  assert.deepEqual(space.tabs, [{ id: "tab" }]);
  assert.deepEqual(catalog, [{ path: "/repo", branch: "main" }]);
});

it("duplicate worktree spaces stay attached to the first row in order", () => {
  const spaces = [
    { id: "first", folder: "/repo", tabs: [] },
    { id: "other", folder: "/other", tabs: [] },
    { id: "second", folder: "/repo", tabs: [] },
    { id: "third", folder: "/repo", tabs: [] },
  ];
  const gitState = Object.fromEntries(
    spaces.map((w) => [
      where(w),
      {
        repo: w.folder,
        top: w.folder,
        name: w.folder,
        linked: false,
        worktrees: [{ path: w.folder }],
      },
    ]),
  );
  const plan = projectWorktreePlan({ spaces, gitState, loaded: true });
  assert.deepEqual(
    plan.list.map((r) => r.w.id),
    ["first", "other"],
  );
  assert.deepEqual(
    plan.list[0].also.map((r) => r.w.id),
    ["second", "third"],
  );
});

it("agents are grouped by card while preserving agent order and merged tabs", async () => {
  const { agentsByRow } = await import("../../../src/mods/orca-sidebar-projects/worktree-plan.ts");
  const rows = [
    { w: { tabs: [{ id: "a" }, { id: "a" }] }, also: [{ w: { tabs: [{ id: "b" }] } }] },
    { w: { tabs: [{ id: "c" }] } },
    { w: { tabs: [{ id: "a" }] } },
  ];
  const agents = [
    { tab: "b", id: 1 },
    { tab: "c", id: 2 },
    { tab: "a", id: 3 },
    { tab: "none", id: 4 },
  ];
  const grouped = agentsByRow(rows, agents);
  assert.deepEqual(
    rows.map((row) => grouped.get(row).map((a) => a.id)),
    [[1, 3], [2], [3]],
  );
});

it("other tabs counts tabs without an agent once, across merged spaces", async () => {
  const { otherTabCount } =
    await import("../../../src/mods/orca-sidebar-projects/worktree-plan.ts");
  const row = {
    w: { tabs: [{ id: "a" }, { id: "b" }, { id: "b" }] },
    also: [{ w: { tabs: [{ id: "c" }, { id: "d" }] } }],
  };
  assert.equal(otherTabCount(row, [{ tab: "a" }, { tab: "a" }, { tab: "d" }]), 2);
  assert.equal(otherTabCount({ w: {} }, []), 0);
  const { otherTabs } = await import("../../../src/mods/orca-sidebar-projects/worktree-plan.ts");
  assert.deepEqual(
    otherTabs(row, [{ tab: "a" }, { tab: "d" }]).map((t) => t.id),
    ["b", "c"],
  );
});

it("pruning git cache drops only inactive negative entries and preserves projects", async () => {
  const { pruneGitCache } =
    await import("../../../src/mods/orca-sidebar-projects/worktree-plan.ts");
  const active = { id: "open", folder: "/open" };
  const cache = {
    [where(active)]: null,
    [where({ folder: "/old" })]: null,
    repo: { repo: "known" },
  };
  pruneGitCache(cache, [active]);
  assert.deepEqual(cache, { [where(active)]: null, repo: { repo: "known" } });
});

it("render row planning preserves host, status, fold and repair order", async () => {
  const { planRenderRows } =
    await import("../../../src/mods/orca-sidebar-projects/worktree-plan.ts");
  const rows = [
    { w: { machine: null, status: "idle" } },
    { w: { machine: "remote", status: "working" } },
    { w: { machine: "remote", status: "blocked" } },
  ];
  assert.deepEqual(
    planRenderRows(rows, "workspace-status", new Set(["offline"]), new Set(["remote"])),
    [
      { kind: "host", machine: null, count: 1 },
      { kind: "status", label: "Idle", count: 1 },
      { kind: "row", index: 0, position: 0 },
      { kind: "host", machine: "remote", count: 2 },
      { kind: "host", machine: "offline", count: 0 },
    ],
  );
  assert.deepEqual(planRenderRows(rows.slice(0, 1), "repo", new Set(), new Set()), [
    { kind: "row", index: 0, position: 0 },
  ]);
  assert.deepEqual(
    planRenderRows(rows, "workspace-status", new Set(), new Set()).map((x) =>
      x.kind === "row" ? x.index : x.kind,
    ),
    ["host", "status", 0, "host", "status", 2, "status", 1],
  );
});

it("a listed repair entry without a usable repair state does not hide its rows", async () => {
  const { planRenderRows } =
    await import("../../../src/mods/orca-sidebar-projects/worktree-plan.ts");
  const rows = [{ w: { machine: "remote", status: "idle" } }];
  assert.deepEqual(planRenderRows(rows, "repo", new Set(["remote"]), new Set(), new Set()), [
    { kind: "host", machine: "remote", count: 1 },
    { kind: "row", index: 0, position: 0 },
  ]);
});

it("render descriptors use current row positions after a same-shape reorder", async () => {
  const { planRenderRows } =
    await import("../../../src/mods/orca-sidebar-projects/worktree-plan.ts");
  const first = [{ w: { id: "a", status: "idle" } }, { w: { id: "b", status: "idle" } }];
  const descriptors = planRenderRows(first, "repo", new Set(), new Set());
  const reordered = [first[1], first[0]];
  assert.deepEqual(
    descriptors.map((d) => reordered[d.index].w.id),
    ["b", "a"],
  );
});

it("active review keys cover each visible local branch once", async () => {
  const { activeReviewKeys } =
    await import("../../../src/mods/orca-sidebar-projects/worktree-plan.ts");
  const repo = JSON.stringify([null, "/repo/.git"]);
  const rows = [
    { w: {}, g: { repo, branch: "main" } },
    { w: {}, g: { repo, branch: "main" } },
    { w: {}, g: { repo, branch: "feature" } },
    { w: { machine: "remote" }, g: { repo, branch: "remote" } },
    { w: {}, g: { repo, branch: "" } },
  ];
  assert.deepEqual(activeReviewKeys(rows), ["/repo/.git::main", "/repo/.git::feature"]);
});

it("catalog pruning preserves unopened and disconnected projects across restart", async () => {
  const { pruneGitCache } =
    await import("../../../src/mods/orca-sidebar-projects/worktree-plan.ts");
  const local = { folder: "/local" };
  const remote = { machine: "offline", folder: "/remote/linked" };
  const git = Object.fromEntries(
    [local, remote].map((w) => [
      where(w),
      {
        repo: JSON.stringify([w.machine ?? null, `${w.folder}/.git`]),
        top: w.folder,
        name: w.folder,
        linked: false,
        worktrees: [{ path: w.folder }, { path: `${w.folder}/sibling`, branch: "feature" }],
      },
    ]),
  );
  git[where({ folder: "/old-negative" })] = null;
  const checked = Object.fromEntries(Object.keys(git).map((k) => [k, 1]));
  pruneGitCache(git, [], checked);
  const restarted = JSON.parse(JSON.stringify(git));
  assert.equal(Object.keys(restarted).length, 2);
  assert.deepEqual(Object.keys(checked), Object.keys(restarted));
  const plan = projectWorktreePlan({ spaces: [], gitState: restarted, loaded: true });
  assert.deepEqual(
    new Set(plan.visibleRows.map((r) => r.w.folder)),
    new Set(["/local", "/local/sibling", "/remote/linked", "/remote/linked/sibling"]),
  );
});

it("a group hands over only the spaces the host knows", () => {
  const group = {
    rows: [
      { w: { id: "w1" }, also: [{ w: { id: "w1b" } }] },
      { w: { id: 'repo:[null,"/repo"]' }, unopened: true },
      { w: { id: "wt:/repo/.git:/repo/wt-x" }, unopened: true },
      { w: { id: "w2" }, also: [] },
    ],
  };
  assert.deepEqual(groupSpaceIds(group, ["w1", "w1b", "w2"]), ["w1", "w1b", "w2"]);

  assert.deepEqual(groupSpaceIds(group, []), []);
  assert.deepEqual(groupSpaceIds(undefined, ["w1"]), []);

  assert.deepEqual(groupSpaceIds({ rows: [{ w: { id: "w1" } }, { w: { id: "w1" } }] }, ["w1"]), [
    "w1",
  ]);
});

it("the plan gives an unopened main checkout a made-up id, never a space id", () => {
  const linked = { id: "w1", folder: "/repo/wt-x", tabs: [] };
  const gitState = {
    [where(linked)]: {
      repo: JSON.stringify([null, "/repo/.git"]),
      top: "/repo/wt-x",
      name: "repo",
      linked: true,
      branch: "feature",
      worktrees: [
        { path: "/repo", branch: "main" },
        { path: "/repo/wt-x", branch: "feature" },
      ],
    },
  };
  const plan = projectWorktreePlan({ spaces: [linked], gitState, loaded: true });
  const group = plan.groups.find((g) => g.rows.some((r) => r.w.id === "w1"));
  assert.equal(
    group.rows.some((r) => r.unopened && r.w.id.startsWith("repo:")),
    true,
  );
  assert.deepEqual(groupSpaceIds(group, ["w1"]), ["w1"]);
});

it("removing a project drops its catalog entries and keeps a live space's checkouts", () => {
  const repo = JSON.stringify([null, "/repo/.git"]);
  const other = JSON.stringify([null, "/other/.git"]);
  const cache = {
    [JSON.stringify([null, "/repo"])]: { repo, top: "/repo" },
    [JSON.stringify([null, "/repo/wt-a"])]: { repo, top: "/repo/wt-a" },
    [JSON.stringify([null, "/repo/wt-live"])]: { repo, top: "/repo/wt-live" },
    [JSON.stringify([null, "/other"])]: { repo: other, top: "/other" },
    [JSON.stringify([null, "/gone"])]: null,
  };
  const live = [JSON.stringify([null, "/repo/wt-live"])];
  assert.equal(forgetProject(cache, repo, live), 2);
  assert.deepEqual(
    Object.keys(cache).sort(),
    [
      JSON.stringify([null, "/gone"]),
      JSON.stringify([null, "/other"]),
      JSON.stringify([null, "/repo/wt-live"]),
    ].sort(),
  );

  assert.equal(forgetProject(cache, repo, live), 0);
  assert.equal(forgetProject(cache, null, live), 0);
  assert.equal(Object.keys(cache).length, 3);
});

it("removing a project after its spaces close leaves the sidebar empty of it", () => {
  const linked = { id: "w1", folder: "/repo/wt", tabs: [] };
  const gitState = {
    [where(linked)]: {
      repo: JSON.stringify([null, "/repo/.git"]),
      top: "/repo/wt",
      name: "repo",
      linked: true,
      branch: "x",
      worktrees: [
        { path: "/repo", branch: "main" },
        { path: "/repo/wt", branch: "x" },
      ],
    },
  };
  assert.equal(projectWorktreePlan({ spaces: [linked], gitState, loaded: true }).groups.length, 1);
  assert.equal(forgetProject(gitState, JSON.stringify([null, "/repo/.git"]), []), 1);
  const plan = projectWorktreePlan({ spaces: [], gitState, loaded: true });
  assert.equal(plan.groups.length, 0);
  assert.equal(plan.visibleRows.length, 0);
});

it("the plan for a seeded sweep of spaces, git caches and options is unchanged", () => {
  const hash = createHash("sha256");
  let seed = 7;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const pick = (a) => a[rnd(a.length)];
  for (let n = 0; n < 300; n++) {
    const machines = [null, null, "far"];
    const repos = ["/r1/.git", "/r2/.git", "/r3.git"];
    const spaces = Array.from({ length: rnd(6) }, (_, i) => ({
      id: `s${i}`,
      name: `n${i}`,
      folder: pick(["/a", "/b", "/wt1", "/wt2", "/c", "/r1", "/r2"]),
      machine: pick(machines),
      tabs: rnd(2) ? [{ id: `t${i}` }] : [],
      status: pick(["idle", "working", "done", "blocked"]),
      active: !rnd(3),
    }));
    const gitState = {};
    for (const s of spaces) {
      if (rnd(4) === 0) continue;
      const repo = pick(repos),
        linked = !!rnd(2);
      const worktrees =
        rnd(3) === 0
          ? undefined
          : [
              { path: pick(["/r1", "/r2", "/a"]), branch: "main" },
              { path: s.folder, branch: pick(["f", "", "g"]) },
              { path: pick(["/wt1", "/wt2"]), branch: pick(["x", ""]) },
            ];
      gitState[where(s)] =
        rnd(6) === 0
          ? null
          : {
              repo: JSON.stringify([s.machine, repo]),
              top: rnd(5) ? s.folder : "/zzz",
              name: "nm",
              linked,
              branch: pick(["main", "dev", null]),
              worktrees,
            };
    }
    for (let k = 0; k < rnd(3); k++)
      gitState[JSON.stringify([pick(machines), pick(["/q1", "/q2", "/a"])])] = pick([
        null,
        {
          repo: JSON.stringify([null, pick(repos)]),
          top: "/q",
          name: "q",
          linked: false,
          branch: "m",
        },
        {
          repo: JSON.stringify([null, pick(repos)]),
          top: "/q",
          name: "q",
          linked: true,
          worktrees: [{ path: "/q" }, { path: "/q2", branch: "k" }],
        },
      ]);
    const options = pick([
      {},
      { groupBy: "none" },
      { sortBy: "name" },
      { hideDefaultBranchWorkspace: true },
      { filterRepoIds: ["/r1/.git"] },
      { hideDetachedHeadWorkspaces: true, sortBy: "repo" },
    ]);
    const args = { spaces, panes: [], gitState, foldedRepos: new Set(), loaded: !!rnd(2), options };
    hash.update(
      JSON.stringify(projectWorktreePlan(args), (k, v) => (v instanceof Map ? [...v] : v)),
    );
  }

  assert.equal(hash.digest("hex").slice(0, 24), "d207e4d416b803678e60db1c");
});

it("projection resolves each workspace identity once, including undiscovered and pruned spaces", () => {
  const spaces = [
    { id: "main", folder: "/repo", tabs: [] },
    { id: "unknown", folder: "/unknown", tabs: [] },
    { id: "deleted", folder: "/gone", tabs: [] },
  ];
  const repo = JSON.stringify([null, "/repo/.git"]);
  const worktrees = [{ path: "/repo", branch: "main" }];
  const gitState = {
    [where(spaces[0])]: {
      repo,
      top: "/repo",
      name: "repo",
      branch: "main",
      linked: false,
      worktrees,
    },
    [where(spaces[2])]: {
      repo,
      top: "/gone",
      name: "repo",
      branch: "gone",
      linked: true,
      worktrees,
    },
  };
  for (const loaded of [false, true]) {
    const calls = [];
    const input = { spaces, gitState, loaded };
    const plan = projectWorktreePlan({
      ...input,
      whereFn: (w) => {
        calls.push(w.id);
        return where(w);
      },
    });
    assert.deepEqual(calls, ["main", "unknown", "deleted"]);
    assert.deepEqual(plan, projectWorktreePlan(input));
    assert.deepEqual(
      plan.visibleRows.map((r) => r.w.id),
      loaded ? ["main", "unknown"] : ["main"],
    );
  }
});

it("preserves the default identity resolver when a caller passes a falsy resolver", () => {
  const space = { id: "fallback", folder: "/fallback", tabs: [] };
  const plan = projectWorktreePlan({ spaces: [space], loaded: true, whereFn: null });
  assert.deepEqual(
    plan.visibleRows.map((row) => row.w.id),
    ["fallback"],
  );
});

it("keeps permissive parsed cache pairs and their legacy synthetic path values", () => {
  assert.deepEqual(readPair("[false,42]"), [false, 42]);
  assert.deepEqual(readPair('["only-machine"]'), ["only-machine"]);
  const key = "[false,42]";
  const plan = projectWorktreePlan({
    gitState: { [key]: { repo: "repo", name: "repo", branch: "main", linked: false } },
  });
  assert.equal(plan.visibleRows[0].w.machine, false);
  assert.equal(plan.visibleRows[0].w.folder, 42);
});

it("leaves an absent workspace title undefined", () => {
  assert.equal(optionTitle({ w: {} }), undefined);
});

it("normalizes paths and tolerates malformed or non-pair cache values", () => {
  assert.equal(base("/workspace/project///"), "project");
  assert.equal(base("/"), "");
  assert.equal(base(null), "");
  assert.deepEqual(readPair("not json"), []);
  assert.deepEqual(readPair('{"machine":"local"}'), []);
  assert.equal(recentOf({ w: { tabs: [] } }), 0);
});

it("sorts workspace rows by each supported rule while keeping local main rows first", () => {
  const main = {
    w: {
      id: "main",
      name: "Zulu",
      branch: "main",
      status: "idle",
      tabs: [{ id: "m", changed_at: 2 }],
    },
    g: { repo: "repo-z", name: "Zulu repo", linked: false },
  };
  const linked = {
    w: {
      id: "linked",
      name: "Feature",
      branch: "feature",
      status: "working",
      tabs: [{ id: "f", changed_at: 9 }],
    },
    g: { repo: "repo-a", name: "Alpha repo", linked: true },
  };
  const standalone = {
    w: {
      id: "standalone",
      name: "Standalone",
      status: "blocked",
      tabs: [{ id: "s", changed_at: 5 }],
    },
  };
  const rows = [standalone, linked, main];

  assert.equal(sortRows(rows, "manual"), rows);
  assert.deepEqual(
    sortRows(rows, "name").map((row) => row.w.id),
    ["main", "linked", "standalone"],
  );
  assert.deepEqual(
    sortRows(rows, "smart").map((row) => row.w.id),
    ["main", "standalone", "linked"],
  );
  assert.deepEqual(
    sortRows(rows, "recent").map((row) => row.w.id),
    ["main", "linked", "standalone"],
  );
  assert.deepEqual(
    sortRows(rows, "repo").map((row) => row.w.id),
    ["main", "standalone", "linked"],
  );
  assert.deepEqual(
    sortRows(rows, "unknown").map((row) => row.w.id),
    ["standalone", "linked", "main"],
  );
});

it("applies host, default-checkout, detached-branch and repository filters", () => {
  const rows = [
    { w: { id: "local", machine: null }, g: { repo: "repo", linked: false, branch: "main" } },
    {
      w: { id: "remote", machine: "remote" },
      g: { repo: "repo", linked: true, branch: "(detached)" },
    },
    { w: { id: "other", machine: null }, g: { repo: "other-repo", linked: true, branch: "topic" } },
  ];
  assert.deepEqual(
    applyWorkspaceOptions(rows, { visibleWorkspaceHostIds: ["remote"] }).map((row) => row.w.id),
    ["remote"],
  );
  assert.deepEqual(
    applyWorkspaceOptions(rows, { hideDefaultBranchWorkspace: true }).map((row) => row.w.id),
    ["remote", "other"],
  );
  assert.deepEqual(
    applyWorkspaceOptions(rows, { hideDetachedHeadWorkspaces: true }).map((row) => row.w.id),
    ["local", "other"],
  );
  assert.deepEqual(
    applyWorkspaceOptions(rows, { filterRepoIds: ["repo"] }).map((row) => row.w.id),
    ["local", "remote"],
  );
});

it("groups adjacent repo rows and orders project blocks by recent activity", () => {
  const rows = [
    {
      w: { id: "a-main", tabs: [{ id: "a", changed_at: 1 }] },
      g: { repo: "a", name: "Alpha", linked: false },
    },
    {
      w: { id: "a-linked", tabs: [{ id: "b", changed_at: 8 }] },
      g: { repo: "a", name: "Alpha", linked: true },
    },
    {
      w: { id: "b-main", tabs: [{ id: "c", changed_at: 4 }] },
      g: { repo: "b", name: "Beta", linked: false },
    },
  ];
  const grouped = applyWorkspaceOptions(rows, { groupBy: "repo", projectOrderBy: "recent" });
  assert.deepEqual(
    grouped.map((row) => [row.w.id, row.head]),
    [
      ["b-main", true],
      ["a-main", true],
      ["a-linked", false],
    ],
  );
});

it("skips an unopened checkout whose catalog path is empty", () => {
  const plan = projectWorktreePlan({
    gitState: {
      '[null,"/repo"]': {
        repo: "repo",
        top: "/repo",
        name: "repo",
        linked: false,
        worktrees: [{ path: "" }],
      },
    },
  });
  assert.deepEqual(plan.visibleRows, []);
});

it("ignores sparse workspace slots while projecting live workspaces", () => {
  const spaces = [];
  spaces[1] = { id: "second", folder: "/second", tabs: [] };
  const plan = projectWorktreePlan({ spaces, loaded: true });
  assert.deepEqual(
    plan.visibleRows.map((row) => row.w.id),
    ["second"],
  );
});

it("large project action preserves first occurrence order and excludes synthetic or stale IDs", () => {
  const ids = Array.from({ length: 1000 }, (_, i) => "w" + i);
  const group = {
    rows: ids.map((id, i) => ({
      w: { id },
      also: [{ w: { id } }, { w: { id: "stale-" + i } }],
    })),
  };
  assert.deepEqual(groupSpaceIds(group, ids), ids);
});

it("group action promotes deduplication without losing order across the threshold", () => {
  const ids = Array.from({ length: 40 }, (_, i) => "w" + i);
  const group = {
    rows: [
      {
        w: { id: ids[0] },
        also: [...ids, ids[0], ids[31], ids[32], "stale"].map((id) => ({ w: { id } })),
      },
    ],
  };
  assert.deepEqual(groupSpaceIds(group, ids), ids);
});
