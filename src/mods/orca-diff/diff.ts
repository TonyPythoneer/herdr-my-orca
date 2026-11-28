import { div, type Color, type NativeElement } from "gpui-kit";
import { h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { ROW, type DiffRow } from "./diff-rows.js";

export type DiffBodyTheme = {
  raised: Color;
  dim: Color;
  selected: Color;
  foreground: Color;
  ansi1: Color;
  ansi2: Color;
};

const ROW_HEIGHT = 20;
const ROW_PADDING = 12;
const ROW_GAP = 10;
const GUTTER_WIDTH = 34;
const TINT_ALPHA = "18";
const FONT_SIZE = 11;
const ROWS_ID = "orca-diff-rows";
const SCROLL_X_ID = "orca-diff-x";

function diffRow({ kind, number, text }: DiffRow, t: DiffBodyTheme): NativeElement {
  if (kind === ROW.hunk)
    return div()
      .w_full()
      .px(ROW_PADDING)
      .h(ROW_HEIGHT)
      .flex_none()
      .truncate()
      .bg(t.raised)
      .text_color(t.dim)
      .child(text);
  if (kind === ROW.file)
    return div()
      .w_full()
      .px(ROW_PADDING)
      .h(ROW_HEIGHT)
      .flex_none()
      .truncate()
      .font_semibold()
      .bg(t.selected)
      .text_color(t.foreground)
      .child(text);
  if (kind === ROW.plain)
    return div()
      .w_full()
      .px(ROW_PADDING)
      .h(ROW_HEIGHT)
      .flex_none()
      .truncate()
      .text_color(t.dim)
      .child(text);
  return h_flex()
    .w_full()
    .h(ROW_HEIGHT)
    .flex_none()
    .gap(ROW_GAP)
    .when(kind === ROW.added, (e) => e.bg(`${t.ansi2}${TINT_ALPHA}`))
    .when(kind === ROW.removed, (e) => e.bg(`${t.ansi1}${TINT_ALPHA}`))
    .child(div().w(GUTTER_WIDTH).flex_none().text_right().text_color(t.dim).child(String(number)))
    .child(div().flex_1().min_w(0).truncate().child(text));
}

export function diffBody(
  t: DiffBodyTheme,
  mono: string,
  rows: DiffRow[],
  width: number,
): NativeElement {
  return div()
    .flex_1()
    .min_h(0)
    .relative()
    .font_family(mono)
    .text_size(FONT_SIZE)
    .child(
      div()
        .id(SCROLL_X_ID)
        .size_full()
        .overflow_x_scrollbar()
        .child(
          div()
            .w_full()
            .min_w(width)
            .h_full()
            .child(
              v_virtual_list(
                ROWS_ID,
                rows.length,
                ROW_HEIGHT,
                (i) => String(i),
                (range) => rows.slice(range.start, range.end).map((row) => diffRow(row, t)),
              ).size_full(),
            ),
        ),
    )
    .child(Scrollbar.vertical(ROWS_ID).viewport_from_layout().absolute().inset_0());
}
