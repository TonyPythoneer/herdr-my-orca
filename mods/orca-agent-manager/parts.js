// Stateless view builders for the Agent Manager page: each takes the theme `t`, none reads the page.
import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { LIST_HEADER_HEIGHT } from "./state.js";

export function badge(text, t, options = {}) {
  const color = options.color ?? t.muted;
  return div()
    .h(18)
    .px(6)
    .flex_none()
    .flex()
    .items_center()
    .rounded(4)
    .bg(options.bg ?? "#00000000")
    .when(options.border, (el) => el.border_1().border_color(t.border))
    .text_size(10)
    .font_medium()
    .text_color(color)
    .child(text);
}

export function icon(row, size, t) {
  if (row.icon) {
    return row.tint
      ? svg(row.icon).size(size).flex_none().text_color(t.muted)
      : image(row.icon).w(size).h(size).flex_none().rounded(3);
  }
  return div()
    .size(size)
    .flex_none()
    .rounded(3)
    .bg(t.raised)
    .flex()
    .items_center()
    .justify_center()
    .text_size(Math.round(size * 0.55))
    .text_color(t.muted)
    .child((row.name ?? "?").slice(0, 1).toUpperCase());
}

export function section(title, count, t, note, muted = false) {
  return h_flex()
    .w_full()
    .items_center()
    .h(LIST_HEADER_HEIGHT)
    .gap(8)
    .pt(0)
    .pb(0)
    .child(div().text_size(13).font_semibold().text_color(muted ? t.muted : t.foreground).child(title))
    .child(badge(count, t, { border: true, color: muted ? t.muted : t.accent }))
    .when(note, (el) => el.child(div().text_size(11).text_color(t.dim).child(note)))
    .child(div().flex_1());
}

export function banner(text, t, options = {}) {
  return h_flex()
    .w_full()
    .gap(8)
    .p(10)
    .rounded(8)
    .border_1()
    .border_color(options.border ?? t.blocked)
    .bg(options.bg ?? "#ef444414")
    .items_start()
    .child(div().flex_none().text_size(12).text_color(options.color ?? t.blocked).child("!"))
    .child(v_flex().flex_1().min_w(0).gap(4).child(div().text_size(12).text_color(options.color ?? t.blocked).child(text)).when(options.actions, (el) => el.child(options.actions)));
}

export function empty(text, t) {
  return div()
    .w_full()
    .p(16)
    .rounded(8)
    .border_1()
    .border_color(t.border)
    .border_dashed()
    .text_size(12)
    .text_color(t.muted)
    .child(text);
}

export function group(title, note, t) {
  return v_flex().w_full().pt(14).pb(2).gap(2)
    .child(div().text_size(15).font_semibold().text_color(t.foreground).child(title))
    .child(div().text_size(11).text_color(t.dim).child(note));
}
