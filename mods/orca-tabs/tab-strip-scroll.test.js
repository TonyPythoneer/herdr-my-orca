import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  TAB_STRIP_EPSILON_PX,
  TAB_STRIP_MIN_SCROLL_STEP_PX,
  clampTabStripScroll,
  revealTabStripSlot,
  tabStripActiveSlot,
  tabStripArrowState,
  tabStripCanDock,
  tabStripContentWidth,
  tabStripDockedLeft,
  tabStripMaxScroll,
  tabStripOffset,
  tabStripScrollStep,
  tabStripScrollTarget,
} from './tab-strip-scroll.js';

// Ten 200px tabs in a 600px viewport: the "about three visible" strip of the acceptance tests.
const TAB_WIDTH = 200;
const VIEWPORT = 600;
const widths = Array.from({ length: 10 }, () => TAB_WIDTH);
const contentWidth = tabStripContentWidth(widths);
const maxScrollLeft = tabStripMaxScroll(VIEWPORT, contentWidth);

const slotAt = (scrollLeft, activeIndex) =>
  tabStripActiveSlot({
    scrollLeft,
    viewportWidth: VIEWPORT,
    contentWidth,
    activeOffset: tabStripOffset(widths, activeIndex),
    activeWidth: TAB_WIDTH,
  });

test('content width and offsets come from every tab, so the track never shrinks', () => {
  assert.equal(contentWidth, 2000);
  assert.equal(maxScrollLeft, 1400);
  assert.deepEqual(
    [0, 1, 2, 9].map((index) => tabStripOffset(widths, index)),
    [0, 200, 400, 1800]
  );
});

test('Test A: the active tab docks left and later tabs keep scrolling to the real end', () => {
  const activeIndex = 3; // Tab 4, offset 600
  // Scroll stop 0 has it past the right edge, so it docks right first.
  const start = slotAt(0, activeIndex);
  assert.equal(start.visualLeft, VIEWPORT - TAB_WIDTH);
  assert.equal(start.side, 'end');

  // Scrolled into view it lets go of the edge and moves with the track.
  const half = slotAt(300, activeIndex);
  assert.equal(half.naturalLeft, 300);
  assert.equal(half.visualLeft, 300);
  assert.equal(half.docked, false, 'nothing is sticky while the tab is still on screen');

  const pinned = slotAt(600, activeIndex);
  assert.equal(pinned.visualLeft, 0);
  assert.equal(pinned.naturalLeft, 0);
  assert.equal(pinned.docked, false, 'touching the edge is not yet a dock');

  // Past the edge it is pinned, and it stays pinned all the way to the end.
  for (let scrollLeft = 601; scrollLeft <= maxScrollLeft; scrollLeft += 37) {
    const slot = slotAt(scrollLeft, activeIndex);
    assert.equal(slot.visualLeft, 0, `pinned at the left edge at scrollLeft=${scrollLeft}`);
    assert.equal(slot.docked, true);
    assert.equal(slot.side, 'start');
    assert.equal(slot.maxScrollLeft, maxScrollLeft, 'docking never changes the scroll limits');
    const arrows = tabStripArrowState(scrollLeft, VIEWPORT, contentWidth);
    assert.equal(arrows.rightDisabled, scrollLeft >= maxScrollLeft - TAB_STRIP_EPSILON_PX);
  }

  // At the real end the last tab is fully on screen beside the docked tab.
  const end = slotAt(maxScrollLeft, activeIndex);
  assert.equal(end.maxScrollLeft, contentWidth - VIEWPORT);
  const lastTabRightEdge = tabStripOffset(widths, 9) + TAB_WIDTH - maxScrollLeft;
  assert.equal(lastTabRightEdge, VIEWPORT);
});

test('Test B: the active tab docks right and earlier tabs keep scrolling to the real start', () => {
  const activeIndex = 6; // Tab 7, offset 1200
  const pinnedAtEnd = slotAt(0, activeIndex);
  assert.equal(pinnedAtEnd.naturalLeft, 1200);
  assert.equal(pinnedAtEnd.visualLeft, VIEWPORT - TAB_WIDTH);
  assert.equal(pinnedAtEnd.docked, true);
  assert.equal(pinnedAtEnd.side, 'end');

  for (let scrollLeft = 0; scrollLeft < 800; scrollLeft += 41) {
    const slot = slotAt(scrollLeft, activeIndex);
    assert.equal(slot.visualLeft, VIEWPORT - TAB_WIDTH, `pinned at the right edge at ${scrollLeft}`);
    assert.equal(slot.side, 'end');
    assert.equal(slot.maxScrollLeft, maxScrollLeft);
  }

  const inView = slotAt(800, activeIndex);
  assert.equal(inView.naturalLeft, 400);
  assert.equal(inView.visualLeft, 400);
  assert.equal(inView.docked, false, 'back inside the viewport it scrolls normally again');

  // The left arrow keeps working down to the true beginning of the track.
  assert.equal(tabStripArrowState(0, VIEWPORT, contentWidth).leftDisabled, true);
  assert.equal(tabStripArrowState(500, VIEWPORT, contentWidth).leftDisabled, false);
});

test('Test C: reversing direction leaves the dock without a jump', () => {
  const activeIndex = 3;
  const positions = [];
  for (let scrollLeft = 900; scrollLeft >= 400; scrollLeft -= 25) {
    positions.push(slotAt(scrollLeft, activeIndex));
  }
  let previous = positions[0];
  for (const slot of positions.slice(1)) {
    // Undocking is continuous: the drawn left edge moves back with the track, no step larger
    // than the scroll step itself.
    const step = Math.abs(slot.visualLeft - previous.visualLeft);
    assert.ok(step <= 25 + 0.5, `no jump when undocking (moved ${step}px)`);
    previous = slot;
  }
  const last = positions[positions.length - 1];
  assert.equal(last.docked, false);
  assert.equal(last.visualLeft, tabStripOffset(widths, activeIndex) - 400);
});

test('Test D: arrow states follow the track only, never the dock', () => {
  const at = (scrollLeft) => tabStripArrowState(scrollLeft, VIEWPORT, contentWidth);

  assert.deepEqual(at(0), {
    maxScrollLeft,
    hasOverflow: true,
    leftDisabled: true,
    rightDisabled: false,
  });
  assert.deepEqual(at(maxScrollLeft), {
    maxScrollLeft,
    hasOverflow: true,
    leftDisabled: false,
    rightDisabled: true,
  });
  assert.deepEqual(at(700), {
    maxScrollLeft,
    hasOverflow: true,
    leftDisabled: false,
    rightDisabled: false,
  });

  // No overflow: both hidden, both disabled, whatever the docking would say.
  const narrow = tabStripArrowState(0, VIEWPORT, VIEWPORT - TAB_STRIP_EPSILON_PX);
  assert.equal(narrow.hasOverflow, false);
  assert.equal(narrow.leftDisabled, true);
  assert.equal(narrow.rightDisabled, true);
  const empty = tabStripArrowState(0, VIEWPORT, 0);
  assert.equal(empty.hasOverflow, false);
  assert.equal(empty.maxScrollLeft, 0);
});

test('arrow presses move most of a screen and stop at the real limits', () => {
  assert.equal(tabStripScrollStep(VIEWPORT), 450);
  assert.equal(tabStripScrollStep(80), TAB_STRIP_MIN_SCROLL_STEP_PX);
  assert.equal(tabStripScrollTarget(0, VIEWPORT, contentWidth, 'end'), 450);
  assert.equal(tabStripScrollTarget(450, VIEWPORT, contentWidth, 'end'), 900);
  assert.equal(tabStripScrollTarget(1300, VIEWPORT, contentWidth, 'end'), maxScrollLeft);
  assert.equal(tabStripScrollTarget(100, VIEWPORT, contentWidth, 'start'), 0);
  assert.equal(tabStripScrollTarget(maxScrollLeft, VIEWPORT, contentWidth, 'start'), 950);
  // A strip that fits does not move at all.
  assert.equal(tabStripScrollTarget(0, VIEWPORT, 400, 'end'), 0);
});

test('scroll offsets are clamped into the real track', () => {
  assert.equal(clampTabStripScroll(-50, VIEWPORT, contentWidth), 0);
  assert.equal(clampTabStripScroll(Number.NaN, VIEWPORT, contentWidth), 0);
  assert.equal(clampTabStripScroll(99_999, VIEWPORT, contentWidth), maxScrollLeft);
  assert.equal(clampTabStripScroll(400, VIEWPORT, contentWidth), 400);
  assert.equal(clampTabStripScroll(400, VIEWPORT, 100), 0);
});

test('selecting a tab scrolls the least amount that shows it', () => {
  // Already visible: the strip does not move.
  assert.equal(revealTabStripSlot(400, VIEWPORT, contentWidth, 600, TAB_WIDTH), 400);
  assert.equal(revealTabStripSlot(400, VIEWPORT, contentWidth, 500, TAB_WIDTH), 400);
  // Off to the left: align its left edge with the viewport.
  assert.equal(revealTabStripSlot(400, VIEWPORT, contentWidth, 200, TAB_WIDTH), 200);
  // Off to the right: align its right edge with the viewport, not more.
  assert.equal(revealTabStripSlot(0, VIEWPORT, contentWidth, 1800, TAB_WIDTH), 1400);
  // The last tab at the last scroll stop, and the first at 0.
  assert.equal(revealTabStripSlot(0, VIEWPORT, contentWidth, 1600, TAB_WIDTH), 1200);
  assert.equal(revealTabStripSlot(900, VIEWPORT, contentWidth, 0, TAB_WIDTH), 0);
  // A tab wider than the viewport: its own start.
  assert.equal(revealTabStripSlot(800, VIEWPORT, contentWidth, 1000, 700), 1000);
});

test('docking needs room for a second tab, as in Orca', () => {
  assert.equal(tabStripCanDock(VIEWPORT, TAB_WIDTH), true);
  assert.equal(tabStripCanDock(VIEWPORT, 300), true);
  assert.equal(tabStripCanDock(VIEWPORT, 301), false);
  assert.equal(tabStripCanDock(0, TAB_WIDTH), false);
  assert.equal(tabStripCanDock(VIEWPORT, 0), false);
  // Without room to dock, the tab stays where the track puts it.
  assert.equal(tabStripDockedLeft(-400, VIEWPORT, 400), -400);
  assert.equal(tabStripDockedLeft(-400, VIEWPORT, 200), 0);
  assert.equal(tabStripDockedLeft(900, VIEWPORT, 200), VIEWPORT - TAB_WIDTH);
});

test('a single tab or an empty strip has nothing to scroll and nothing to dock', () => {
  const one = [TAB_WIDTH];
  const oneWidth = tabStripContentWidth(one);
  assert.equal(tabStripMaxScroll(VIEWPORT, oneWidth), 0);
  assert.equal(tabStripArrowState(0, VIEWPORT, oneWidth).hasOverflow, false);
  const slot = tabStripActiveSlot({
    scrollLeft: 0,
    viewportWidth: 6000, // a very narrow strip is not needed; a wide one is the normal case
    contentWidth: oneWidth,
    activeOffset: 0,
    activeWidth: TAB_WIDTH,
  });
  assert.equal(slot.docked, false);
  assert.equal(slot.visualLeft, 0);
  const empty = tabStripActiveSlot({
    scrollLeft: 0,
    viewportWidth: VIEWPORT,
    contentWidth: 0,
    activeOffset: 0,
    activeWidth: 0,
  });
  assert.equal(empty.docked, false);
});
