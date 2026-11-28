import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  LINEAGE_CHILDREN_INLINE_OFFSET,
  LINEAGE_IMMEDIATE_PARENT_STEP,
  PROJECT_GROUP_HEADER_BASE_PADDING,
  getFlushWorktreeCardPaddingLeft,
  getFolderWorkspaceCardContentIndent,
  getFolderWorkspaceCardSurfaceInset,
  getFolderWorkspaceRowGeometry,
  getProjectGroupHeaderPaddingLeft,
  getWorktreeCardContentIndent,
  getWorktreeCardSurfaceInset,
} from "../../../src/mods/orca-sidebar-projects/indentation.js";

test("lineage constants derive from the tree indent and card inset", () => {
  assert.equal(LINEAGE_IMMEDIATE_PARENT_STEP, 20);
  assert.equal(LINEAGE_CHILDREN_INLINE_OFFSET, 14);
  assert.equal(PROJECT_GROUP_HEADER_BASE_PADDING, 10);
});

test("project group header padding steps per depth and clamps to six levels", () => {
  assert.equal(getProjectGroupHeaderPaddingLeft(0), 10);
  assert.equal(getProjectGroupHeaderPaddingLeft(2), 30);
  assert.equal(getProjectGroupHeaderPaddingLeft(2.7), 30);
  assert.equal(getProjectGroupHeaderPaddingLeft(9), 70);
  assert.equal(getProjectGroupHeaderPaddingLeft(-3), 10);
  assert.equal(getProjectGroupHeaderPaddingLeft(Number.NaN), 10);
  assert.equal(getProjectGroupHeaderPaddingLeft(undefined), 10);
});

test("worktree card content indent adds lineage and the grouped title anchor", () => {
  assert.equal(getWorktreeCardContentIndent({ isGrouped: false, lineageDepth: 2 }), 36);
  assert.equal(getWorktreeCardContentIndent({ isGrouped: false }), 0);
  assert.equal(
    getWorktreeCardContentIndent({ isGrouped: true, groupDepth: 1, lineageDepth: 1 }),
    20 + 3 + 18,
  );
});

test("folder workspace content aligns to the parent group label, never below depth zero", () => {
  assert.equal(getFolderWorkspaceCardContentIndent({ groupDepth: 2 }), 23);
  assert.equal(getFolderWorkspaceCardContentIndent({ groupDepth: 0 }), 13);
  assert.equal(getFolderWorkspaceCardContentIndent({}), 13);
});

test("worktree surface inset steps with grouped depth only", () => {
  assert.equal(getWorktreeCardSurfaceInset({ isGrouped: true, groupDepth: 2 }), 20);
  assert.equal(getWorktreeCardSurfaceInset({ isGrouped: false, groupDepth: 2 }), 0);
});

test("folder surface inset is capped so the flush card keeps its minimum content inset", () => {
  assert.equal(getFolderWorkspaceCardSurfaceInset({ isGrouped: true, groupDepth: 2 }), 17);
  assert.equal(getFolderWorkspaceCardSurfaceInset({ isGrouped: true, groupDepth: 0 }), 0);
});

test("flush card padding pulls back by the lane and never drops below the minimum inset", () => {
  assert.equal(getFlushWorktreeCardPaddingLeft(0), 2);
  assert.equal(getFlushWorktreeCardPaddingLeft(20), 16);
  assert.equal(getFlushWorktreeCardPaddingLeft(20, true), 8);
  assert.equal(getFlushWorktreeCardPaddingLeft(5, true), 2);
});

test("folder workspace row geometry uses the compact anchor under the new card style", () => {
  assert.deepEqual(
    getFolderWorkspaceRowGeometry({
      experimentalNewWorktreeCardStyle: true,
      isFolderBackedWorkspaceChild: true,
      groupDepth: 2,
    }),
    { surfaceInset: 10, cardContentIndent: 13 },
  );
});

test("folder workspace row geometry aligns to the folder label under the legacy card style", () => {
  assert.deepEqual(
    getFolderWorkspaceRowGeometry({
      isFolderBackedWorkspaceChild: true,
      groupDepth: 2,
    }),
    { surfaceInset: 17, cardContentIndent: 6 },
  );
});

test("ordinary grouped rows subtract their surface inset from the content indent", () => {
  assert.deepEqual(
    getFolderWorkspaceRowGeometry({ isGrouped: true, groupDepth: 1, lineageDepth: 1 }),
    { surfaceInset: 10, cardContentIndent: 31 },
  );
  assert.deepEqual(getFolderWorkspaceRowGeometry({}), { surfaceInset: 0, cardContentIndent: 0 });
});
