import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  fallbackChild,
  visibleTools,
} from "../../../src/mods/orca-right-sidebar-header/panel-gating.ts";

const ITEMS = [
  { id: "files" },
  { id: "agent-sessions" },
  { id: "workspaces", gating: "folderOnly" },
  { id: "pr-checks", gating: "folderOnly" },
  { id: "changes", gating: "gitOnly" },
  { id: "checks", gating: "gitOnly" },
  { id: "ports", gating: "sshOnly" },
];

test("git workspace shows source-control items only", () => {
  assert.deepEqual(
    visibleTools(ITEMS, { isFolder: false, onSshHost: false }).map(({ id }) => id),
    ["files", "agent-sessions", "changes", "checks"],
  );
});

test("folder workspace shows attached-worktrees and PR checks only", () => {
  assert.deepEqual(
    visibleTools(ITEMS, { isFolder: true, onSshHost: false }).map(({ id }) => id),
    ["files", "agent-sessions", "workspaces", "pr-checks"],
  );
});

test("SSH host adds ports on top of the git set", () => {
  assert.deepEqual(
    visibleTools(ITEMS, { isFolder: false, onSshHost: true }).map(({ id }) => id),
    ["files", "agent-sessions", "changes", "checks", "ports"],
  );
});

test("fallback keeps visible selection, resets hidden selection, and handles no tools", () => {
  const visible = visibleTools(ITEMS, { isFolder: false, onSshHost: false });
  assert.equal(fallbackChild(visible, "changes"), "changes");
  assert.equal(fallbackChild(visible, "workspaces"), "files");
  assert.equal(fallbackChild([], "changes"), null);
});

test("unknown gates remain visible", () => {
  assert.deepEqual(
    visibleTools([{ id: "a" }, { id: "b", gating: "toString" }], {
      isFolder: true,
      onSshHost: false,
    }).map(({ id }) => id),
    ["a", "b"],
  );
});
