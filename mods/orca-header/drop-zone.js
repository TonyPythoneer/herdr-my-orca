// `tab-drop-zone.ts:38-88`, ported: a zone only in the outer bands, the strip left to
// reordering, and the middle of the panel meaning "no split".
export function edgeZone(panel, point, stripHeight) {
  const stripBottom = panel.top + stripHeight;
  if (point.y < stripBottom) return null;
  const localX = point.x - panel.left;
  const horizontalEdge = panel.width * 0.2;
  if (localX < horizontalEdge) return "left";
  if (localX > panel.width - horizontalEdge) return "right";
  const bodyHeight = Math.max(0, panel.height - stripHeight);
  if (bodyHeight <= 0) return null;
  const bodyLocalY = point.y - stripBottom;
  const verticalEdge = bodyHeight * 0.2;
  if (bodyLocalY < verticalEdge) return "up";
  if (bodyLocalY > bodyHeight - verticalEdge) return "down";
  // Orca's bands leave the middle of the panel unclaimed because there the drop MERGES the tab
  // into that pane group (`resolveDropZone`'s 'center', `tab-drop-zone.ts:19-36`). Herdr has no
  // tab-group merge — a tab *is* its panes — so the centre has no action, and keeping it dead
  // makes most of the panel a no-op. The nearest edge wins instead; horizontal on a tie, which
  // is the preference Orca states in that same function.
  const toLeft = localX, toRight = panel.width - localX;
  const toUp = bodyLocalY, toDown = bodyHeight - bodyLocalY;
  const horizontal = Math.min(toLeft, toRight), vertical = Math.min(toUp, toDown);
  if (horizontal <= vertical) return toLeft <= toRight ? "left" : "right";
  return toUp <= toDown ? "up" : "down";
}
