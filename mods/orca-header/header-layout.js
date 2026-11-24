// Derived from Herdr App's defaults/mods/tabs/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export function scaledWidth(node, fallback, zoom) {
  return node?.hidden ? 0 : (node?.size?.px ?? fallback) / zoom;
}

export function visibleSize(node, fallback) {
  return node?.hidden ? 0 : node?.size?.px ?? fallback;
}

export function toggleLeft(w, leftPad = 0) {
  if (w.platform && w.platform !== "macos") return 6;
  return (w.fullscreen ? 8 : 75) - leftPad;
}
