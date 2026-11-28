import { it, vi } from "vite-plus/test";
import assert from "node:assert/strict";
import { plain, resetHost } from "./host.js";
import type { GitKind, MenuProps, Row } from "../../../src/mods/orca-context-menu/main.js";

vi.mock("gpui-kit", async () => {
  const { element } = await import("./host.js");
  return { View: class {}, div: element("div"), svg: element("svg") };
});
vi.mock("gpui-base", async () => {
  const { element } = await import("./host.js");
  return { h_flex: element("h_flex"), v_flex: element("v_flex") };
});
vi.mock("herdr", async () => (await import("./host.js")).herdrMock());
vi.mock("../../../src/shared/clip.ts", () => ({ copyText: () => {} }));
vi.mock("../../../src/shared/transcript.ts", () => ({ buildBoundedSessionTranscript: () => null }));

import { items } from "../../../src/mods/orca-context-menu/main.js";

function fixture(spaces: unknown[]): (p: MenuProps | undefined, git: GitKind | null) => Row[] {
  resetHost({ props: undefined, spaces, panes: [], terminals: [], keys: [], theme: {} });
  return (p, git) => items(p, git);
}

const space = (id: string, folder = "/repo") => ({
  id,
  folder,
  name: id,
  tabs: [{ id: `${id}-tab` }],
  machine: null,
});

function closeRow(rows: Row[], label: string): Row | undefined {
  return rows.find((it) => it[0] === label);
}

it("the card menu closes its space with confirmed", () => {
  const rows = fixture([space("w1")]);
  assert.deepEqual(
    closeRow(rows({ tab: "space", target: { id: "w1", linked: false } }, "main"), "Close"),
    ["Close", "space.close", { id: "w1", confirmed: true }],
  );
});

it("a group with one open space closes it with confirmed", () => {
  const rows = fixture([space("w1")]);
  assert.deepEqual(
    closeRow(
      rows({ tab: "group", target: { id: "w1", path: "/repo", spaces: ["w1"] } }, null),
      "Close workspace",
    ),
    ["Close workspace", "space.close", { id: "w1", confirmed: true }],
  );
});

it("a group closes every space its plan names, linked worktrees included", () => {
  const rows = fixture([space("w1"), space("w2", "/elsewhere/wt")]);
  const row = closeRow(
    rows({ tab: "group", target: { id: "w1", path: "/repo", spaces: ["w1", "w2"] } }, null),
    "Close workspace",
  );
  assert.equal(row?.[1], "orca-context-menu.close-group");
  assert.deepEqual(row?.[2], { ids: ["w1", "w2"] });
});

it("a group with no open space has no Close row", () => {
  const rows = fixture([]);
  assert.equal(
    closeRow(rows({ tab: "group", target: { id: "w1", path: "/repo" } }, null), "Close workspace"),
    undefined,
  );
});

it("a made-up row id never reaches space.close", () => {
  const rows = fixture([space("w1")]);
  const row = closeRow(
    rows(
      { tab: "group", target: { id: "w1", path: "/repo", spaces: ['repo:[null,"/repo"]', "w1"] } },
      null,
    ),
    "Close workspace",
  );
  assert.deepEqual(row, ["Close workspace", "space.close", { id: "w1", confirmed: true }]);
});

it("a group whose every row is an unopened worktree has no Close row", () => {
  const rows = fixture([]);
  assert.equal(
    closeRow(
      rows(
        {
          tab: "group",
          target: {
            id: 'repo:[null,"/repo"]',
            path: "/repo",
            spaces: ['repo:[null,"/repo"]', "wt:/repo/.git:/repo/wt-x"],
          },
        },
        null,
      ),
      "Close workspace",
    ),
    undefined,
  );
});

it("a project with no open space offers Remove Project from Sidebar", () => {
  const rows = fixture([]);
  const menu = rows(
    {
      tab: "group",
      target: {
        id: 'repo:[null,"/repo"]',
        path: "/repo",
        repo: 'repo:[null,"/repo/.git"]',
        spaces: ['repo:[null,"/repo"]', "wt:/repo/.git:/repo/wt-x"],
      },
    },
    null,
  );
  assert.deepEqual(plain(closeRow(menu, "Remove Project from Sidebar")), [
    "Remove Project from Sidebar",
    "orca-context-menu.forget-project",
    { repo: 'repo:[null,"/repo/.git"]' },
  ]);

  assert.equal(closeRow(menu, "Close workspace"), undefined);
});

it("a project with a live space offers Close, not Remove", () => {
  const rows = fixture([space("w1")]);
  const menu = rows(
    {
      tab: "group",
      target: { id: "w1", path: "/repo", repo: 'repo:[null,"/repo/.git"]', spaces: ["w1"] },
    },
    null,
  );
  assert.equal(closeRow(menu, "Remove Project from Sidebar"), undefined);
  assert.equal(closeRow(menu, "Close workspace")?.[1], "space.close");
});

it("an unopened worktree card can remove its project too", () => {
  const rows = fixture([]);
  const menu = rows(
    {
      tab: "space",
      target: {
        id: "wt:/repo/.git:/repo/wt-x",
        folder: "/repo/wt-x",
        repo: 'repo:[null,"/repo/.git"]',
        linked: true,
      },
    },
    "linked",
  );
  assert.deepEqual(plain(closeRow(menu, "Remove Project from Sidebar")), [
    "Remove Project from Sidebar",
    "orca-context-menu.forget-project",
    { repo: 'repo:[null,"/repo/.git"]' },
  ]);
});
