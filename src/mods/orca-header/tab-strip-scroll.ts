export const TAB_STRIP_EPSILON_PX = 1;
export const TAB_STRIP_SCROLL_FRACTION = 0.75;
export const TAB_STRIP_MIN_SCROLL_STEP_PX = 120;

export function tabStripContentWidth(widths: number[]): number {
  let total = 0;
  for (const width of widths) total += width > 0 ? width : 0;
  return total;
}

export function tabStripOffset(widths: number[], index: number): number {
  let left = 0;
  for (let i = 0; i < index && i < widths.length; i++) {
    left += widths[i] > 0 ? widths[i] : 0;
  }
  return left;
}

export function tabStripMaxScroll(viewportWidth: number, contentWidth: number): number {
  return Math.max(0, contentWidth - viewportWidth);
}

export function clampTabStripScroll(
  scrollLeft: number,
  viewportWidth: number,
  contentWidth: number,
): number {
  if (!Number.isFinite(scrollLeft)) return 0;
  return Math.min(Math.max(scrollLeft, 0), tabStripMaxScroll(viewportWidth, contentWidth));
}

export type TabArrows = {
  maxScrollLeft: number;
  hasOverflow: boolean;
  leftDisabled: boolean;
  rightDisabled: boolean;
};

export type TabSlot = {
  naturalLeft: number;
  visualLeft: number;
  docked: boolean;
  side: "start" | "end" | null;
  viewportWidth: number;
  maxScrollLeft: number;
};

export function tabStripArrowState(
  scrollLeft: number,
  viewportWidth: number,
  contentWidth: number,
): TabArrows {
  const maxScrollLeft = tabStripMaxScroll(viewportWidth, contentWidth);
  const hasOverflow = maxScrollLeft > TAB_STRIP_EPSILON_PX;
  return {
    maxScrollLeft,
    hasOverflow,
    leftDisabled: !hasOverflow || scrollLeft <= TAB_STRIP_EPSILON_PX,
    rightDisabled: !hasOverflow || scrollLeft >= maxScrollLeft - TAB_STRIP_EPSILON_PX,
  };
}

export function tabStripScrollStep(viewportWidth: number): number {
  return Math.max(TAB_STRIP_MIN_SCROLL_STEP_PX, viewportWidth * TAB_STRIP_SCROLL_FRACTION);
}

export function tabStripScrollTarget(
  scrollLeft: number,
  viewportWidth: number,
  contentWidth: number,
  direction: "start" | "end",
): number {
  const step = tabStripScrollStep(viewportWidth);
  const target = direction === "start" ? scrollLeft - step : scrollLeft + step;
  return clampTabStripScroll(target, viewportWidth, contentWidth);
}

export function tabStripCanDock(viewportWidth: number, activeWidth: number): boolean {
  return viewportWidth > 0 && activeWidth > 0 && viewportWidth >= activeWidth * 2;
}

export function tabStripDockedLeft(
  naturalLeft: number,
  viewportWidth: number,
  activeWidth: number,
): number {
  if (!tabStripCanDock(viewportWidth, activeWidth)) return naturalLeft;
  const maxLeft = Math.max(0, viewportWidth - activeWidth);
  return Math.min(Math.max(naturalLeft, 0), maxLeft);
}

function dockSide(docked: boolean, naturalLeft: number): "start" | "end" | null {
  if (!docked) return null;
  return naturalLeft > 0 ? "end" : "start";
}

export type ActiveSlot = {
  scrollLeft: number;
  viewportWidth: number;
  contentWidth: number;
  activeOffset: number;
  activeWidth: number;
};

export function tabStripActiveSlot({
  scrollLeft,
  viewportWidth,
  contentWidth,
  activeOffset,
  activeWidth,
}: ActiveSlot): TabSlot {
  const naturalLeft = activeOffset - scrollLeft;
  const visualLeft = tabStripDockedLeft(naturalLeft, viewportWidth, activeWidth);
  const docked =
    tabStripCanDock(viewportWidth, activeWidth) && Math.abs(visualLeft - naturalLeft) > 0.5;
  return {
    naturalLeft,
    visualLeft,
    docked,
    side: dockSide(docked, naturalLeft),
    viewportWidth,
    maxScrollLeft: tabStripMaxScroll(viewportWidth, contentWidth),
  };
}

export function revealTabStripSlot(
  scrollLeft: number,
  viewportWidth: number,
  contentWidth: number,
  left: number,
  width: number,
): number {
  let next = scrollLeft;
  if (width >= viewportWidth) {
    next = left;
  } else if (left < scrollLeft) {
    next = left;
  } else if (left + width > scrollLeft + viewportWidth) {
    next = left + width - viewportWidth;
  }
  return clampTabStripScroll(next, viewportWidth, contentWidth);
}
