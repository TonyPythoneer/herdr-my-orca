import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import type { PaneInfo } from "herdr";
import { selectTabPanes } from "../../../src/mods/orca-header/tab-panes.js";

const PROGRAM = {
  key: "",
  name: "",
  icon: null,
  tint: false,
  tile: null,
  color: null,
  shell: false,
  agent: false,
};

const pane = (over: Partial<PaneInfo>): PaneInfo => ({
  pane: "",
  terminal: null,
  tab: "",
  title: "",
  name: null,
  cwd: null,
  branch: null,
  status: null,
  app: null,
  program: PROGRAM,
  focused: false,
  zoomed: false,
  movable: false,
  ...over,
});

test("each tab uses its first agent pane, or its first pane when no agent exists", () => {
  const panes = [
    pane({ tab: "a", pane: "1", program: { ...PROGRAM, shell: true } }),
    pane({ tab: "a", pane: "2", program: { ...PROGRAM, agent: true } }),
    pane({ tab: "a", pane: "3", program: { ...PROGRAM, agent: true } }),
    pane({ tab: "b", pane: "4" }),
    pane({ tab: "b", pane: "5" }),
  ];
  const selected = selectTabPanes(panes);
  assert.equal(selected.get("a")?.pane, "2");
  assert.equal(selected.get("b")?.pane, "4");
  assert.equal(selected.get("missing"), undefined);
});
