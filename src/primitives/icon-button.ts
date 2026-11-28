import {
  div,
  type AbsoluteLength,
  type ClickEvent,
  type Color,
  type Context,
  type Length,
  type NativeElement,
} from "gpui-kit";
import type { ColorTokens } from "gpui-base";
import { themeColor } from "../shared/theme-color.js";

type IconButtonTheme = Pick<ColorTokens, "muted" | "foreground" | "background"> & {
  hover: Color;
  dim: Color;
};
type ClickHandler = (event: ClickEvent, cx: Context) => void;

const FULL_EXTENT = "full";

type FullExtent = typeof FULL_EXTENT;

type IconButtonOptions = {
  t: IconButtonTheme;
  active?: boolean;
  disabled?: boolean;
  color?: Color;
  hoverBg?: Color | null;
  hoverFg?: Color;
  size?: Length;
  w?: Length | null;
  h?: Length | FullExtent | null;
  radius?: AbsoluteLength | FullExtent | null;
  border?: Color | null;
  bg?: Color | null;
  textSize?: AbsoluteLength | null;
  tooltip?: string | null;
  onClick: ClickHandler;
};

const DEFAULT_SIZE = 24;
const DEFAULT_RADIUS = 6;

export function IconButton(
  id: string,
  label: string,
  glyph: NativeElement | string,
  options: IconButtonOptions,
): NativeElement {
  const {
    t,
    active = false,
    disabled = false,
    color = themeColor(t.muted),
    hoverBg = themeColor(t.hover),
    hoverFg = themeColor(t.foreground),
  } = options;
  const base = frame(id, label, glyph, options);
  if (active) return base.bg(themeColor(t.foreground)).text_color(themeColor(t.background));
  if (disabled) return base.text_color(themeColor(t.dim));
  return hover(base.text_color(color), hoverBg, hoverFg);
}

function frame(
  id: string,
  label: string,
  glyph: NativeElement | string,
  {
    size = DEFAULT_SIZE,
    w = null,
    h = null,
    radius = DEFAULT_RADIUS,
    border = null,
    bg = null,
    textSize = null,
    tooltip = null,
    disabled = false,
    onClick,
  }: IconButtonOptions,
): NativeElement {
  const el = outline(
    corners(box(id, { size, w, h }).flex_none().flex().items_center().justify_center(), radius),
    { border, bg, textSize },
  );
  const named = el
    .when(!disabled, (element) => element.cursor_pointer())
    .role("button")
    .accessibility_label(label);
  return (tooltip ? named.tooltip(tooltip) : named).on_click(onClick).child(glyph);
}

function outline(
  element: NativeElement,
  {
    border,
    bg,
    textSize,
  }: { border: Color | null; bg: Color | null; textSize: AbsoluteLength | null },
): NativeElement {
  let out = element;
  if (border !== null) out = out.border_1().border_color(border);
  if (bg !== null) out = out.bg(bg);
  if (textSize !== null) out = out.text_size(textSize);
  return out;
}

function box(
  id: string,
  { size, w, h }: { size: Length; w: Length | null; h: Length | FullExtent | null },
): NativeElement {
  const element = div().id(id);
  if (w === null) return element.size(size);
  return h === FULL_EXTENT ? element.w(w).h_full() : element.w(w).h(h as Length);
}

function corners(
  element: NativeElement,
  radius: AbsoluteLength | FullExtent | null,
): NativeElement {
  if (radius === FULL_EXTENT) return element.rounded_full();
  return radius === null ? element : element.rounded(radius);
}

function hover(element: NativeElement, bg: Color | null, fg: Color): NativeElement {
  return element.hover((style) => (bg === null ? style : style.bg(bg)).text_color(fg));
}
