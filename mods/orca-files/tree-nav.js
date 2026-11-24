// Port of Orca's resolveFileExplorerNavigationTarget
// (selection/file-explorer-keyboard-navigation.ts:25-91) onto this mod's flat row list.
// Rows are the visible projection: { path, dir, depth, open }. Returns what the caller
// should do, so the View only moves selection/toggles folders.
const PAGE_DIVISOR = 10; // PageUp/PageDown move a tenth of the list, at least one row
const move = (index) => ({ type: "move", index });

// The index each plain movement key lands on, from the selected row.
const MOVES = {
  arrowdown: (current, total) => Math.min(total - 1, current + 1),
  arrowup: (current) => Math.max(0, current - 1),
  home: () => 0,
  end: (_current, total) => total - 1,
  pagedown: (current, total, page) => Math.min(total - 1, current + page),
  pageup: (current, _total, page) => Math.max(0, current - page),
};
const FIRST_ROW_KEYS = ["arrowdown", "end", "pagedown"], LAST_ROW_KEYS = ["arrowup", "home", "pageup"];

// Nothing selected yet: forward keys start at the top, backward keys at the bottom.
function fromNoSelection(key, total) {
  if (FIRST_ROW_KEYS.includes(key)) return move(0);
  if (LAST_ROW_KEYS.includes(key)) return move(total - 1);
  return { type: "unhandled" };
}

function arrowRight(rows, current, row) {
  if (!row.dir) return move(current);
  if (!row.open) return { type: "expand", index: current, path: row.path };
  const child = rows[current + 1];
  return move(child && child.depth > row.depth ? current + 1 : current);
}

function arrowLeft(rows, current, row) {
  if (row.dir && row.open) return { type: "collapse", index: current, path: row.path };
  return move(parentIndex(rows, current) ?? current);
}

export function resolveTreeKey(key, current, rows) {
  const total = rows.length;
  if (!total) return { type: "none" };
  if (current === null || current === undefined) return fromNoSelection(key, total);
  const row = rows[current];
  if (!row) return { type: "none" };
  if (Object.hasOwn(MOVES, key)) return move(MOVES[key](current, total, Math.max(1, Math.floor(total / PAGE_DIVISOR))));
  if (key === "arrowright") return arrowRight(rows, current, row);
  if (key === "arrowleft") return arrowLeft(rows, current, row);
  return { type: "unhandled" };
}

// Nearest earlier row that is shallower: the folder this row sits in.
export function parentIndex(rows, index) {
  const row = rows[index];
  if (!row) return null;
  const depth = row.depth ?? 0;
  for (let i = index - 1; i >= 0; i--) if (rows[i].depth < depth) return i;
  return null;
}
