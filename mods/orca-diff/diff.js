// Row painting for the diff pane, ported from the shipped `changes` mod: rows are numbered once
// (diff-rows.js) and drawn through a virtual list, so a frame only builds the rows on screen.
// shortcut: unified view only, one line-number column, no syntax or word-level highlighting, no
// folding; upgrade if reviewing large changes here becomes common.
import { div } from "gpui-kit";
import { h_flex, Scrollbar, v_virtual_list } from "gpui-base";

function diffRow({ kind, number, text }, t) {
  if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
  if (kind === "F") return div().w_full().px(12).h(20).flex_none().truncate().font_semibold().bg(t.selected).text_color(t.foreground).child(text);
  if (kind === "") return div().w_full().px(12).h(20).flex_none().truncate().text_color(t.dim).child(text);
  return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
    .child(div().w(34).flex_none().text_right().text_color(t.dim).child(String(number)))
    .child(div().flex_1().min_w(0).truncate().child(text));
}

export function diffBody(t, mono, rows, width) {
  return div().flex_1().min_h(0).relative().font_family(mono).text_size(11)
    .child(div().id("orca-diff-x").size_full().overflow_x_scrollbar()
      .child(div().w_full().min_w(width).h_full().child(v_virtual_list("orca-diff-rows", rows.length, 20, (i) => String(i),
        (range) => rows.slice(range.start, range.end).map((row) => diffRow(row, t))).size_full())))
    .child(Scrollbar.vertical("orca-diff-rows").viewport_from_layout().absolute().inset_0());
}
