export type Zone = "left" | "right" | "up" | "down";
export type Box = { left: number; top: number; width: number; height: number };

export function edgeZone(
  panel: Box,
  point: { x: number; y: number },
  stripHeight: number,
): Zone | null {
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
  const toLeft = localX;
  const toRight = panel.width - localX;
  const toUp = bodyLocalY;
  const toDown = bodyHeight - bodyLocalY;
  const horizontal = Math.min(toLeft, toRight);
  const vertical = Math.min(toUp, toDown);
  if (horizontal <= vertical) return toLeft <= toRight ? "left" : "right";
  return toUp <= toDown ? "up" : "down";
}
