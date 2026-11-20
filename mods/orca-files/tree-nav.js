// Port of Orca's resolveFileExplorerNavigationTarget
// (selection/file-explorer-keyboard-navigation.ts:25-91) onto this mod's flat row list.
// Rows are the visible projection: { path, dir, depth, open }. Returns what the caller
// should do, so the View only moves selection/toggles folders.
export function resolveTreeKey(key, current, rows) {
  const total = rows.length;
  if (!total) return { type: "none" };
  if (current === null || current === undefined) {
    if (key === "arrowdown" || key === "end" || key === "pagedown") return { type: "move", index: 0 };
    if (key === "arrowup" || key === "home" || key === "pageup") return { type: "move", index: total - 1 };
    return { type: "unhandled" };
  }
  const row = rows[current];
  if (!row) return { type: "none" };
  const page = Math.max(1, Math.floor(total / 10));
  switch (key) {
    case "arrowdown": return { type: "move", index: Math.min(total - 1, current + 1) };
    case "arrowup": return { type: "move", index: Math.max(0, current - 1) };
    case "home": return { type: "move", index: 0 };
    case "end": return { type: "move", index: total - 1 };
    case "pagedown": return { type: "move", index: Math.min(total - 1, current + page) };
    case "pageup": return { type: "move", index: Math.max(0, current - page) };
    case "arrowright": {
      if (!row.dir) return { type: "move", index: current };
      if (!row.open) return { type: "expand", index: current, path: row.path };
      const child = rows[current + 1];
      return child && child.depth > row.depth ? { type: "move", index: current + 1 } : { type: "move", index: current };
    }
    case "arrowleft": {
      if (row.dir && row.open) return { type: "collapse", index: current, path: row.path };
      return { type: "move", index: parentIndex(rows, current) ?? current };
    }
    default: return { type: "unhandled" };
  }
}

// Nearest earlier row that is shallower: the folder this row sits in.
export function parentIndex(rows, index) {
  const depth = rows[index]?.depth ?? 0;
  for (let i = index - 1; i >= 0; i--) if (rows[i].depth < depth) return i;
  return null;
}
