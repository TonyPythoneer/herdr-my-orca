import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleTools, fallbackChild } from "./panel-gating.js";

const ITEMS = [
  { id: "files" }, { id: "agent-sessions" },
  { id: "workspaces", gating: "folderOnly" }, { id: "pr-checks", gating: "folderOnly" },
  { id: "changes", gating: "gitOnly" }, { id: "checks", gating: "gitOnly" },
  { id: "ports", gating: "sshOnly" },
];

test("git workspace shows source-control items only", () => {
  const ids = visibleTools(ITEMS, { isFolder: false, onSshHost: false }).map((t) => t.id);
  assert.deepEqual(ids, ["files", "agent-sessions", "changes", "checks"]);
});

test("folder workspace shows attached-worktrees and PR checks only", () => {
  const ids = visibleTools(ITEMS, { isFolder: true, onSshHost: false }).map((t) => t.id);
  assert.deepEqual(ids, ["files", "agent-sessions", "workspaces", "pr-checks"]);
});

test("ssh host adds ports on top of the git set", () => {
  const ids = visibleTools(ITEMS, { isFolder: false, onSshHost: true }).map((t) => t.id);
  assert.deepEqual(ids, ["files", "agent-sessions", "changes", "checks", "ports"]);
});

test("fallback keeps a visible active tab and resets a gated one", () => {
  const visible = visibleTools(ITEMS, { isFolder: false, onSshHost: false });
  assert.equal(fallbackChild(visible, "changes"), "changes");
  assert.equal(fallbackChild(visible, "workspaces"), "files");
  assert.equal(fallbackChild([], "changes"), null);
});

test("an item with no gate, or an unknown one, is always shown", () => {
  const items = [{ id: "a" }, { id: "b", gating: "mystery" }, { id: "c", gating: "toString" }];
  for (const state of [{ isFolder: true, onSshHost: false }, { isFolder: false, onSshHost: true }]) {
    assert.deepEqual(visibleTools(items, state).map((t) => t.id), ["a", "b", "c"]);
  }
});
