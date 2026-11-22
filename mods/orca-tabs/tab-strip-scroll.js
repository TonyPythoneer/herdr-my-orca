// Horizontal scrolling geometry for the tab strip, kept free of herdr so it can be tested
// with node. Orca's strip is a native scroller with a `position: sticky` active tab
// (`use-tab-strip-slot-props.ts`, `tab-strip-slot-geometry.ts`); Herdr has neither, so the
// strip carries its own scroll offset and paints the active tab at the clamped position.
//
// The one rule everything here serves: the active tab's visual position must never reach
// back into the scroll limits. `scrollLeft` still runs from 0 to `contentWidth - viewportWidth`
// over the whole track, docked or not, so later tabs stay reachable.

/** Same slack Orca uses (`tab-strip-scroll-metrics.ts:20`). */
export const TAB_STRIP_EPSILON_PX = 1;
/** Orca's `TAB_STRIP_SCROLL_FRACTION` (`tab-strip-overflow-navigation.ts:19`). */
export const TAB_STRIP_SCROLL_FRACTION = 0.75;
/** Orca's `TAB_STRIP_MIN_SCROLL_STEP_PX` (`tab-strip-overflow-navigation.ts:20`). */
export const TAB_STRIP_MIN_SCROLL_STEP_PX = 120;

/** The whole track: every tab keeps its slot, docked or not, so this never changes with docking. */
export function tabStripContentWidth(widths) {
  let total = 0;
  for (const width of widths) total += width > 0 ? width : 0;
  return total;
}

/** Left edge of the tab at `index` in the track, before scrolling. */
export function tabStripOffset(widths, index) {
  let left = 0;
  for (let i = 0; i < index && i < widths.length; i++) {
    left += widths[i] > 0 ? widths[i] : 0;
  }
  return left;
}

export function tabStripMaxScroll(viewportWidth, contentWidth) {
  return Math.max(0, contentWidth - viewportWidth);
}

export function clampTabStripScroll(scrollLeft, viewportWidth, contentWidth) {
  if (!Number.isFinite(scrollLeft)) return 0;
  return Math.min(Math.max(scrollLeft, 0), tabStripMaxScroll(viewportWidth, contentWidth));
}

/** Arrow visibility and disabled state, from the real track limits only (`scrollLeft` vs 0 / max). */
export function tabStripArrowState(scrollLeft, viewportWidth, contentWidth) {
  const maxScrollLeft = tabStripMaxScroll(viewportWidth, contentWidth);
  const hasOverflow = maxScrollLeft > TAB_STRIP_EPSILON_PX;
  return {
    maxScrollLeft,
    hasOverflow,
    leftDisabled: !hasOverflow || scrollLeft <= TAB_STRIP_EPSILON_PX,
    rightDisabled: !hasOverflow || scrollLeft >= maxScrollLeft - TAB_STRIP_EPSILON_PX,
  };
}

/** How far one arrow press moves the track: three quarters of a screen, never less than 120px. */
export function tabStripScrollStep(viewportWidth) {
  return Math.max(TAB_STRIP_MIN_SCROLL_STEP_PX, viewportWidth * TAB_STRIP_SCROLL_FRACTION);
}

export function tabStripScrollTarget(scrollLeft, viewportWidth, contentWidth, direction) {
  const step = tabStripScrollStep(viewportWidth);
  const target = direction === "start" ? scrollLeft - step : scrollLeft + step;
  return clampTabStripScroll(target, viewportWidth, contentWidth);
}

/**
 * Orca refuses to dock when the strip is narrower than two docks
 * (`tab-strip-slot-geometry.ts:31-38`, "Leave room for another tab beside the dock, or
 * inactive tabs become unreachable"). A tab wider than half the viewport cannot be kept
 * fully visible without covering every other tab, so it scrolls normally instead.
 */
export function tabStripCanDock(viewportWidth, activeWidth) {
  return viewportWidth > 0 && activeWidth > 0 && viewportWidth >= activeWidth * 2;
}

/** The active tab's clamped visual left edge; `naturalLeft` when it may not dock. */
export function tabStripDockedLeft(naturalLeft, viewportWidth, activeWidth) {
  if (!tabStripCanDock(viewportWidth, activeWidth)) return naturalLeft;
  const maxLeft = Math.max(0, viewportWidth - activeWidth);
  return Math.min(Math.max(naturalLeft, 0), maxLeft);
}

/** Where the active tab is drawn, and which edge of the viewport it is stuck to, if either. */
export function tabStripActiveSlot({
  scrollLeft,
  viewportWidth,
  contentWidth,
  activeOffset,
  activeWidth,
}) {
  const naturalLeft = activeOffset - scrollLeft;
  const visualLeft = tabStripDockedLeft(naturalLeft, viewportWidth, activeWidth);
  const docked = tabStripCanDock(viewportWidth, activeWidth) && Math.abs(visualLeft - naturalLeft) > 0.5;
  return {
    naturalLeft,
    visualLeft,
    docked,
    side: !docked ? null : naturalLeft > 0 ? "end" : "start",
    viewportWidth,
    maxScrollLeft: tabStripMaxScroll(viewportWidth, contentWidth),
  };
}

/**
 * The smallest scroll change that puts `[left, left + width)` inside the viewport, clamped to
 * the real track limits. Orca's `revealTabStripSlot` (`tab-strip-slot-geometry.ts:84-107`)
 * without the dock-reservation branch: the dock is drawn, it does not take part in scrolling.
 */
export function revealTabStripSlot(scrollLeft, viewportWidth, contentWidth, left, width) {
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
