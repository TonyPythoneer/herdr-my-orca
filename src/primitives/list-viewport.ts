export const ROW = { height: 30, gap: 2, radius: 7, padX: 10, innerGap: 8, text: 12 };

export const FULL_ROWS = 5;

export const VISIBLE_ROWS = FULL_ROWS + 0.5;

export function viewportHeight(count: number, rowHeight: number, gap = 0): number {
  if (count <= 0) return 0;
  if (count <= FULL_ROWS) return count * rowHeight + (count - 1) * gap;
  return FULL_ROWS * (rowHeight + gap) + rowHeight / 2;
}

export const scrolls = (count: number): boolean => count > FULL_ROWS;
