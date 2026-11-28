const ROW = {
	height: 30,
	gap: 2,
	radius: 7,
	padX: 10,
	innerGap: 8,
	text: 12
};
const FULL_ROWS = 5;
const VISIBLE_ROWS = 5.5;
function viewportHeight(count, rowHeight, gap = 0) {
	if (count <= 0) return 0;
	if (count <= 5) return count * rowHeight + (count - 1) * gap;
	return 5 * (rowHeight + gap) + rowHeight / 2;
}
const scrolls = (count) => count > 5;

export { FULL_ROWS, ROW, VISIBLE_ROWS, scrolls, viewportHeight };
