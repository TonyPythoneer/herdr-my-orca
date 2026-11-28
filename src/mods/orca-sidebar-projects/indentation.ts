export const SIDEBAR_TREE_INDENT = 18;
const PROJECT_WORKTREE_CARD_EXTRA_INDENT = 2;
export const FLUSH_CARD_CONTENT_PULLBACK = 4;
export const NEW_CARD_STYLE_STATUS_LANE_EXTRA_PULLBACK = 8;
export const FLUSH_CARD_MIN_CONTENT_INSET = 2;
export const WORKTREE_CARD_SURFACE_MARGIN = 4;
export const LEGACY_STATUS_LANE_WIDTH = 16;
export const WORKTREE_CARD_BORDER_WIDTH = 1;
const HEADER_ICON_SLOT = 16;
const HEADER_ICON_GAP = 6;
const CARD_ROW_GAP = 2;
export const LINEAGE_IMMEDIATE_PARENT_STEP =
  SIDEBAR_TREE_INDENT + PROJECT_WORKTREE_CARD_EXTRA_INDENT;
export const LINEAGE_CHILDREN_INLINE_OFFSET =
  LINEAGE_IMMEDIATE_PARENT_STEP - WORKTREE_CARD_SURFACE_MARGIN - FLUSH_CARD_MIN_CONTENT_INSET;
const GROUPED_CARD_TITLE_HEADER_LABEL_OFFSET =
  HEADER_ICON_SLOT +
  HEADER_ICON_GAP -
  (WORKTREE_CARD_SURFACE_MARGIN +
    WORKTREE_CARD_BORDER_WIDTH +
    LEGACY_STATUS_LANE_WIDTH +
    CARD_ROW_GAP -
    FLUSH_CARD_CONTENT_PULLBACK);
export const PROJECT_GROUP_HEADER_BASE_PADDING = 10;
const PROJECT_GROUP_HEADER_INDENT = 10;
const MAX_PROJECT_GROUP_HEADER_DEPTH = 6;

export type RowDepths = { isGrouped?: boolean; groupDepth?: number; lineageDepth?: number };
export type FolderRowInput = {
  experimentalNewWorktreeCardStyle?: boolean;
  isFolderBackedWorkspaceChild?: boolean;
  isGrouped?: boolean;
  groupDepth?: number;
  lineageDepth?: number;
};

const clampDepth = (d: number | undefined): number =>
  Math.max(0, Math.floor(typeof d === "number" && Number.isFinite(d) ? d : 0));

export function getProjectGroupHeaderPaddingLeft(depth: number | undefined): number {
  return (
    PROJECT_GROUP_HEADER_BASE_PADDING +
    Math.min(clampDepth(depth), MAX_PROJECT_GROUP_HEADER_DEPTH) * PROJECT_GROUP_HEADER_INDENT
  );
}

export function getWorktreeCardContentIndent({
  isGrouped,
  groupDepth,
  lineageDepth,
}: RowDepths): number {
  const lineageIndent = clampDepth(lineageDepth) * SIDEBAR_TREE_INDENT;
  return isGrouped
    ? getProjectGroupHeaderPaddingLeft(groupDepth) +
        GROUPED_CARD_TITLE_HEADER_LABEL_OFFSET +
        lineageIndent
    : lineageIndent;
}

export function getFolderWorkspaceCardContentIndent({
  groupDepth,
}: {
  groupDepth?: number;
}): number {
  const parentGroupDepth = Math.max(0, clampDepth(groupDepth) - 1);
  return (
    getProjectGroupHeaderPaddingLeft(parentGroupDepth) + GROUPED_CARD_TITLE_HEADER_LABEL_OFFSET
  );
}

export function getFolderWorkspaceCardSurfaceInset({ isGrouped, groupDepth }: RowDepths): number {
  const contentAnchor = getFolderWorkspaceCardContentIndent({ groupDepth });
  const maxSurfaceInset =
    contentAnchor - WORKTREE_CARD_SURFACE_MARGIN - FLUSH_CARD_MIN_CONTENT_INSET;
  return Math.min(
    getWorktreeCardSurfaceInset({ isGrouped, groupDepth }),
    Math.max(0, maxSurfaceInset),
  );
}

export function getWorktreeCardSurfaceInset({ isGrouped, groupDepth }: RowDepths): number {
  return isGrouped
    ? getProjectGroupHeaderPaddingLeft(groupDepth) - PROJECT_GROUP_HEADER_BASE_PADDING
    : 0;
}

export function getFlushWorktreeCardPaddingLeft(
  contentIndent: number,
  applyNewCardStyleStatusLaneOffset = false,
): number {
  const pullback =
    FLUSH_CARD_CONTENT_PULLBACK +
    (applyNewCardStyleStatusLaneOffset ? NEW_CARD_STYLE_STATUS_LANE_EXTRA_PULLBACK : 0);
  return contentIndent > 0
    ? Math.max(FLUSH_CARD_MIN_CONTENT_INSET, contentIndent - pullback)
    : FLUSH_CARD_MIN_CONTENT_INSET;
}

export function getFolderWorkspaceRowGeometry({
  experimentalNewWorktreeCardStyle,
  isFolderBackedWorkspaceChild,
  isGrouped,
  groupDepth,
  lineageDepth,
}: FolderRowInput): { surfaceInset: number; cardContentIndent: number } {
  if (experimentalNewWorktreeCardStyle && isFolderBackedWorkspaceChild) {
    const parentGroupDepth = Math.max(0, clampDepth(groupDepth) - 1);
    const contentAnchor = getWorktreeCardContentIndent({
      isGrouped: true,
      groupDepth: parentGroupDepth,
      lineageDepth: 0,
    });
    const surfaceInset = getWorktreeCardSurfaceInset({
      isGrouped: true,
      groupDepth: parentGroupDepth,
    });
    return { surfaceInset, cardContentIndent: Math.max(0, contentAnchor - surfaceInset) };
  }

  const contentIndent = isFolderBackedWorkspaceChild
    ? getFolderWorkspaceCardContentIndent({ groupDepth })
    : getWorktreeCardContentIndent({ isGrouped, groupDepth, lineageDepth });
  const surfaceInset = isFolderBackedWorkspaceChild
    ? getFolderWorkspaceCardSurfaceInset({ isGrouped: true, groupDepth })
    : getWorktreeCardSurfaceInset({ isGrouped, groupDepth });
  return { surfaceInset, cardContentIndent: Math.max(0, contentIndent - surfaceInset) };
}
