import { layout, settings } from "herdr";
import type { LayoutNode, WindowState } from "./types.js";

export function layoutTree(): LayoutNode | undefined {
  return layout() as LayoutNode | undefined;
}

export function find(node: LayoutNode | null | undefined, id: string): LayoutNode | null {
  if (node && node.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export function scaledWidth(
  node: LayoutNode | null | undefined,
  fallback: number,
  zoom: number,
): number {
  return node?.hidden ? 0 : (node?.size?.px ?? fallback) / zoom;
}

export function visibleSize(node: LayoutNode | null | undefined, fallback: number): number {
  return node?.hidden ? 0 : (node?.size?.px ?? fallback);
}

export function toggleLeft(w: WindowState, leftPad = 0): number {
  if (w.platform && w.platform !== "macos") return 6;
  return (w.fullscreen ? 8 : 75) - leftPad;
}

export function zoomOf(): number {
  return (settings()?.zoom as number | undefined) || 1;
}
