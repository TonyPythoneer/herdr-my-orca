// How tall a scrolling list is, for every capped list in the app's cards and popups (the Agent
// Settings catalogs, the agent setup flyout's model, effort, choice, provider and checklist lists).
//
// The rule: up to FULL_ROWS rows the list is exactly as tall as its rows. With more, it is
// VISIBLE_ROWS rows tall, so the sixth row shows half of itself and tells the reader there is more
// below, and the rest scrolls. A list never grows past that and never leaves blank space under a
// short one. Full-height panes (file tree, changes list, agents list) fill their container and do
// not use this.
//
// Pure: no herdr or gpui imports. Edit this file, then `node scripts/sync-shared.mjs` writes the
// copies the mods import.

/**
 * The one row of every list: its height, the space between rows, its radius, its side padding, the
 * gap inside it and its text size. A list's rows differ only in what they hold (an icon tile, a
 * label, a check, a checkbox); the hover is the only background a row gets, and a chosen row is
 * marked by its check alone.
 */
export const ROW = { height: 30, gap: 2, radius: 7, padX: 10, innerGap: 8, text: 12 };

/** More rows than this and the list scrolls. */
export const FULL_ROWS = 5;
/** Rows a scrolling list shows: five and a half. */
export const VISIBLE_ROWS = FULL_ROWS + 0.5;

/**
 * The height of a list of `count` rows, each `rowHeight` tall with `gap` between rows. A list that
 * fits is as tall as its rows; a longer one is five rows, five gaps and half a row (the cut-off row
 * begins after a gap).
 */
export function viewportHeight(count, rowHeight, gap = 0) {
  if (count <= 0) return 0;
  if (count <= FULL_ROWS) return count * rowHeight + (count - 1) * gap;
  return FULL_ROWS * (rowHeight + gap) + rowHeight / 2;
}

/** Whether a list of `count` rows scrolls. */
export const scrolls = (count) => count > FULL_ROWS;
