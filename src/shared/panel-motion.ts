import { div, type Color, type NativeElement } from "gpui-kit";
import { theme, layout, props, shared } from "herdr";
import { themeColor } from "./theme-color.js";

type LayoutNode = {
  id?: string;
  size?: { px?: number };
  children?: readonly LayoutNode[];
};

const PANEL_ID = "panel";
const PANEL_OPEN_KEY = "panel.openPx";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const COVER_FADE_START = 0.15;
const COVER_FADE_SPAN = 0.85;
const SLIDE_OFFSET_PX = 28;
const SETTLED_TOLERANCE_PX = 0.5;
const MAX_ALPHA = 255;
const ALPHA_HEX_DIGITS = 2;

function find(node: LayoutNode | null | undefined, id: string): LayoutNode | null {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const result = find(child, id);
    if (result) return result;
  }
  return null;
}

function coverAlpha(k: number): string {
  const cover = Math.max(0, Math.min(1, 1 - (k - COVER_FADE_START) / COVER_FADE_SPAN));
  return Math.round(cover * MAX_ALPHA)
    .toString(16)
    .padStart(ALPHA_HEX_DIGITS, "0");
}

function coverColor(surface: Color, alpha: string): Color {
  return HEX_COLOR.test(surface) ? `${surface}${alpha}` : surface;
}

export function panelFrame(inner: NativeElement): NativeElement {
  if (props()?.overlay) return inner;
  const open = shared(PANEL_OPEN_KEY) as number;
  const px = find(layout() as LayoutNode | null | undefined, PANEL_ID)?.size?.px as number;
  if (!(open > 0) || !(px > 0) || px >= open - SETTLED_TOLERANCE_PX) return inner;
  const k = px / open;

  return div()
    .size_full()
    .overflow_hidden()
    .relative()
    .child(
      div()
        .w(open)
        .h_full()
        .relative()
        .left(px - open + (1 - k) * SLIDE_OFFSET_PX)
        .child(inner),
    )
    .child(
      div()
        .absolute()
        .top(0)
        .left(0)
        .right(0)
        .bottom(0)
        .bg(coverColor(themeColor(theme().surface), coverAlpha(k))),
    );
}
