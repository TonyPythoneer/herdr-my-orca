import { div, svg, type AbsoluteLength, type Color, type NativeElement } from "gpui-kit";
import type { ColorTokens } from "gpui-base";
import { themeColor } from "./theme-color.js";

type SelectionColors = Pick<ColorTokens, "accent" | "surface"> & { hover: Color };

const MOTION = { duration: 200, easing: "ease-out" } as const;
const CHECK_INSET = 2;
const CHECK_SIZE = 14;
const CHECK_GLYPH_SIZE = 9;
const CHECK_ICON = "mods/orca-assets/check.svg";
const CHECK_MARK = "✓";
const MARK_WIDTH = 8;

export function hoverHighlight(
  hovered: boolean,
  t: SelectionColors,
  radius: AbsoluteLength,
): NativeElement {
  return div()
    .absolute()
    .inset_0()
    .rounded(radius)
    .bg(themeColor(t.hover))
    .opacity(hovered ? 1 : 0)
    .transition("opacity", MOTION);
}

export function selectedCheck(selected: boolean, t: SelectionColors): NativeElement {
  return div().when(selected, (el) =>
    el
      .absolute()
      .top(CHECK_INSET)
      .right(CHECK_INSET)
      .size(CHECK_SIZE)
      .rounded_full()
      .bg(themeColor(t.accent))
      .flex()
      .items_center()
      .justify_center()
      .child(svg(CHECK_ICON).size(CHECK_GLYPH_SIZE).text_color(themeColor(t.surface))),
  );
}

export function selectionMark(selected: boolean, t: SelectionColors): NativeElement {
  return div()
    .flex_none()
    .w(MARK_WIDTH)
    .flex()
    .items_center()
    .justify_center()
    .when(selected, (el) => el.text_color(themeColor(t.accent)).child(CHECK_MARK));
}
