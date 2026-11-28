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
import { themeColor } from "./theme-color.js";

type DialogButtonTheme = Pick<ColorTokens, "foreground">;
type ClickHandler = (event: ClickEvent, cx: Context) => void;

type DialogButtonOptions = {
  t: DialogButtonTheme;
  name?: string;
  tooltip?: string | null;
  disabled?: boolean;
  onClick: ClickHandler;
  icon?: NativeElement | null;
  gap?: number;
  h?: Length | null;
  py?: number;
  px?: number;
  rounded?: AbsoluteLength | null;
  size?: AbsoluteLength;
  medium?: boolean;
  bg?: Color | null;
  color?: Color;
  border?: Color | null;
  hoverBg?: Color | null;
  hoverFg?: Color | null;
  hoverOpacity?: number | null;
};

const DEFAULT_HEIGHT = 32;
const DEFAULT_RADIUS = 6;
const DEFAULT_PADDING_X = 12;
const DEFAULT_PADDING_Y = 0;
const DEFAULT_TEXT_SIZE = 12;
const DEFAULT_ICON_GAP = 6;
const DISABLED_OPACITY = 0.4;

export function DialogButton(
  id: string,
  label: string,
  options: DialogButtonOptions,
): NativeElement {
  const { name = label, tooltip = null, disabled = false, onClick, icon = null } = options;
  const named = box(id, options).role("button").accessibility_label(name);
  const tipped = tooltip === null ? named : named.tooltip(tooltip);
  const content =
    icon === null
      ? label
      : div()
          .flex()
          .items_center()
          .gap(options.gap ?? DEFAULT_ICON_GAP)
          .child(icon)
          .child(label);
  if (disabled) return tipped.opacity(DISABLED_OPACITY).child(content);
  return hoverable(tipped.cursor_pointer().on_click(onClick), options).child(content);
}

function box(
  id: string,
  {
    t,
    h = DEFAULT_HEIGHT,
    py = DEFAULT_PADDING_Y,
    px = DEFAULT_PADDING_X,
    rounded = DEFAULT_RADIUS,
    size = DEFAULT_TEXT_SIZE,
    medium = false,
    bg = null,
    color = themeColor(t.foreground),
    border = null,
  }: DialogButtonOptions,
): NativeElement {
  const element = boxShape(div().id(id), h, py, px, rounded);
  return boxColor(element, { size, medium, bg, color, border });
}

function boxShape(
  element: NativeElement,
  h: Length | null,
  py: number,
  px: number,
  rounded: AbsoluteLength | null,
): NativeElement {
  let out = element;
  if (h !== null) out = out.h(h);
  if (py > 0) out = out.py(py);
  out = out.px(px).flex_none().flex().items_center().justify_center();
  return rounded === null ? out : out.rounded(rounded);
}

function boxColor(
  element: NativeElement,
  {
    size,
    medium,
    bg,
    color,
    border,
  }: {
    size: AbsoluteLength;
    medium: boolean;
    bg: Color | null;
    color: Color;
    border: Color | null;
  },
): NativeElement {
  let out = element.text_size(size).text_color(color);
  if (medium) out = out.font_medium();
  if (bg !== null) out = out.bg(bg);
  return border === null ? out : out.border_1().border_color(border);
}

function hoverable(
  element: NativeElement,
  { hoverBg = null, hoverFg = null, hoverOpacity = null }: DialogButtonOptions,
): NativeElement {
  if (hoverBg === null && hoverFg === null && hoverOpacity === null) return element;
  return element.hover((style) => hoverStyle(style, hoverBg, hoverFg, hoverOpacity));
}

function hoverStyle(
  element: NativeElement,
  bg: Color | null,
  fg: Color | null,
  opacity: number | null,
): NativeElement {
  let out = element;
  if (bg !== null) out = out.bg(bg);
  if (fg !== null) out = out.text_color(fg);
  if (opacity !== null) out = out.opacity(opacity);
  return out;
}
