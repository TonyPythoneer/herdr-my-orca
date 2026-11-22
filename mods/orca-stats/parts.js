// Stateless building blocks for the CodeBurn panel. Every builder takes the
// theme `t`; none of them reads the page's state.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings } from "herdr";
import {
  brand,
  clamp,
  count,
  dayLabel,
  money,
  percent,
  sharePct,
  weekdayLabel,
} from "./data.js";

export const mono = () => settings()?.font_family ?? "JetBrains Mono";

export const icon = (name, size, color) =>
  svg(`mods/orca-stats/${name}.svg`).size(size).flex_none().text_color(color);

export function brandMark(size, color = brand()) {
  return div()
    .size(size)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(Math.round(size * 0.28))
    .bg(`${color}1f`)
    .child(icon("flame", Math.round(size * 0.62), color));
}

export function pill(text, t, options = {}) {
  const color = options.color ?? t.muted;
  return h_flex()
    .h(options.height ?? 20)
    .px(options.px ?? 7)
    .flex_none()
    .items_center()
    .gap(4)
    .rounded(options.full ? 999 : 5)
    .bg(options.bg ?? "#00000000")
    .when(options.border !== false, (el) => el.border_1().border_color(options.borderColor ?? t.border))
    .text_size(options.size ?? 10)
    .font_medium()
    .text_color(color)
    .when(options.tooltip, (el) => el.tooltip(options.tooltip))
    .child(text);
}

export function button(id, label, t, onClick, options = {}) {
  return h_flex()
    .id(id)
    .h(options.height ?? 30)
    .px(options.px ?? 11)
    .gap(6)
    .flex_none()
    .items_center()
    .justify_center()
    .rounded(options.radius ?? 7)
    .border_1()
    .border_color(options.primary ? t.accent : options.borderColor ?? t.border)
    .bg(options.primary ? t.solid : options.bg ?? "#00000000")
    .text_size(options.size ?? 12)
    .font_medium()
    .text_color(options.primary ? t.solid_foreground : options.color ?? t.foreground)
    .when(!options.disabled, (el) =>
      el
        .cursor_pointer()
        .hover((s) => s.bg(options.primary ? t.solid : t.hover))
        .on_click((_event, cx) => onClick(_event, cx)),
    )
    .when(options.disabled, (el) => el.opacity(0.45))
    .role("button")
    .accessibility_label(label)
    .tooltip(options.tooltip ?? label)
    .child(label);
}

export function iconButton(id, iconName, label, t, onClick, options = {}) {
  return div()
    .id(id)
    .size(options.size ?? 30)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(7)
    .border_1()
    .border_color(options.borderColor ?? t.border)
    .bg(options.bg ?? "#00000000")
    .text_color(options.color ?? t.muted)
    .when(!options.disabled, (el) =>
      el
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(options.hoverColor ?? t.foreground))
        .on_click((_event, cx) => onClick(_event, cx)),
    )
    .when(options.disabled, (el) => el.opacity(0.45))
    .role("button")
    .accessibility_label(label)
    .tooltip(options.tooltip ?? label)
    .child(icon(iconName, options.iconSize ?? 14, options.color ?? t.muted));
}

export function segmented(items, selected, t, onSelect, options = {}) {
  return h_flex()
    .flex_none()
    .items_center()
    .gap(2)
    .p(2)
    .rounded(8)
    .border_1()
    .border_color(t.border)
    .bg(t.surface)
    .children(
      items.map((item) =>
        div()
          .id(`${options.id ?? "seg"}-${item.key}`)
          .h(options.height ?? 24)
          .px(options.px ?? 9)
          .flex()
          .items_center()
          .justify_center()
          .rounded(6)
          .text_size(options.size ?? 11)
          .font_medium()
          .text_color(selected === item.key ? t.foreground : t.muted)
          .when(selected === item.key, (el) => el.bg(t.raised))
          .when(selected !== item.key, (el) =>
            el.cursor_pointer().hover((s) => s.text_color(t.foreground)),
          )
          .role("button")
          .accessibility_label(item.label)
          .on_click((_event, cx) => onSelect(item.key, cx))
          .child(item.label),
      ),
    );
}

export function card(children, t, options = {}) {
  return v_flex()
    .w_full()
    .min_w(0)
    .gap(options.gap ?? 12)
    .p(options.p ?? 16)
    .rounded(options.radius ?? 12)
    .border_1()
    .border_color(options.borderColor ?? t.border)
    .bg(options.bg ?? t.surface)
    .when(options.shadow, (el) => el.shadow_sm())
    .children(children);
}

export function panelHead(title, t, options = {}) {
  return h_flex()
    .w_full()
    .items_center()
    .gap(8)
    .flex_none()
    .child(
      div()
        .text_size(options.size ?? 13)
        .font_semibold()
        .text_color(t.foreground)
        .child(title),
    )
    .when(options.badge, (el) => el.child(pill(options.badge, t, { border: true })))
    .child(div().flex_1())
    .when(options.right, (el) => el.child(options.right));
}

export function metric(label, value, sub, t, options = {}) {
  return card(
    [
      h_flex()
        .w_full()
        .items_center()
        .gap(6)
        .child(div().text_size(10).font_semibold().text_color(t.dim).whitespace_nowrap().child(label.toUpperCase()))
        .child(div().flex_1())
        .when(options.icon, (el) => el.child(icon(options.icon, 12, options.iconColor ?? t.dim))),
      div()
        .w_full()
        .text_size(options.valueSize ?? 26)
        .font_semibold()
        .text_color(options.valueColor ?? t.foreground)
        .child(value),
      div()
        .w_full()
        .text_size(11)
        .text_color(t.muted)
        .child(sub),
    ],
    t,
    { p: options.p ?? 14, gap: 7, shadow: options.shadow },
  );
}

export function progress(value, color, t, options = {}) {
  const pct = clamp(value, 0, 100);
  return div()
    .w_full()
    .h(options.height ?? 6)
    .flex_none()
    .rounded(options.radius ?? 3)
    .bg(options.track ?? t.raised)
    .overflow_hidden()
    .child(div().h(options.height ?? 6).rounded(options.radius ?? 3).bg(color).w(`${pct}%`));
}

export function barRow(row, t, options = {}) {
  const share = sharePct(row.cost ?? row.calls ?? 0, options.total ?? 0);
  return v_flex()
    .w_full()
    .min_w(0)
    .gap(5)
    .child(
      h_flex()
        .w_full()
        .items_center()
        .gap(8)
        .min_w(0)
        .when(row.color, (el) => el.child(div().size(7).flex_none().rounded_full().bg(row.color)))
        .child(
          div()
            .min_w(0)
            .flex_1()
            .truncate()
            .text_size(12)
            .text_color(t.foreground)
            .child(row.name),
        )
        .when(row.note, (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child(row.note)))
        .child(
          div()
            .flex_none()
            .text_size(12)
            .font_medium()
            .text_color(options.valueColor ?? t.foreground)
            .child(row.value ?? money(row.cost)),
        ),
    )
    .when(options.bar !== false, (el) =>
      el.child(progress(share, row.color ?? options.color ?? t.accent, t, { height: 4 })),
    );
}

export function emptyNote(text, t, options = {}) {
  return div()
    .w_full()
    .p(options.p ?? 14)
    .rounded(8)
    .border_1()
    .border_color(t.border)
    .border_dashed()
    .text_size(11)
    .line_height("16px")
    .text_color(t.muted)
    .child(text);
}

export function skeleton(t, options = {}) {
  return div()
    .w(options.width ?? "100%")
    .h(options.height ?? 12)
    .flex_none()
    .rounded(options.radius ?? 5)
    .bg(t.raised)
    .loop("opacity", { from: 0.35, to: 0.8, period: 1200 });
}

export function skeletonCard(t, lines = 3) {
  return card(
    [
      skeleton(t, { width: "42%", height: 12 }),
      skeleton(t, { width: "72%", height: 24 }),
      ...Array.from({ length: Math.max(0, lines - 2) }, (_, i) =>
        skeleton(t, { width: `${88 - i * 12}%`, height: 10 }),
      ),
    ],
    t,
    { p: 14, gap: 10 },
  );
}

export function valueWithUnit(value, unit, t, options = {}) {
  return h_flex()
    .items_end()
    .gap(4)
    .child(
      div()
        .text_size(options.size ?? 26)
        .font_semibold()
        .text_color(options.color ?? t.foreground)
        .child(value),
    )
    .when(unit, (el) => el.child(div().pb(options.unitPad ?? 4).text_size(11).text_color(t.muted).child(unit)));
}

const labelEvery = (length) => (length <= 10 ? 1 : length <= 14 ? 2 : Math.ceil(length / 7));

export function dailyChart(series, t, options = {}) {
  const days = series?.days ?? [];
  const chartH = options.height ?? 148;
  if (!days.length || series.max <= 0) {
    return emptyNote("No spend recorded in this period. Run an agent, then refresh.", t, { p: 20 });
  }
  const every = labelEvery(days.length);
  const barColor = options.color ?? brand();
  const averagePct = clamp((series.average / series.max) * 100, 0, 100);
  const labels = h_flex()
    .w_full()
    .pt(7)
    .gap(3)
    .children(
      days.map((day, index) => {
        const last = days.length - 1;
        // The final label is useful, but skip it when it would sit one slot
        // after the previous label: at this size "Nov 21" and "Nov 22" collide.
        const show = index === 0 || index % every === 0 || (index === last && last % every !== 1);
        return div()
          .flex_1()
          .min_w(0)
          .text_size(9)
          .text_color(show ? t.dim : "#00000000")
          .when(show, (el) => el.whitespace_nowrap())
          .when(index === last, (el) => el.text_right())
          .child(show ? (days.length <= 10 ? weekdayLabel(day.date) : dayLabel(day.date)) : " ");
      }),
    );

  return v_flex()
    .w_full()
    .min_w(0)
    .gap(0)
    .child(
      h_flex()
        .w_full()
        .items_end()
        .gap(3)
        .h(chartH)
        .relative()
        .child(
          div()
            .absolute()
            .left(0)
            .right(0)
            .bottom_px(Math.round((averagePct / 100) * chartH))
            .h(1)
            .border_t(1)
            .border_color(t.border)
            .border_dashed(),
        )
        .children(
          days.map((day, index) => {
            const h = Math.max(2, Math.round((day.cost / series.max) * (chartH - 10)));
            const isPeak = day.cost === series.max && day.cost > 0;
            return v_flex()
              .id(`cb-bar-${day.date}`)
              .flex_1()
              .min_w(0)
              .h_full()
              .justify_end()
              .items_center()
              .rounded_t(4)
              .tooltip(`${dayLabel(day.date)} · ${money(day.cost)} · ${count(day.turns)} turns`)
              .child(
                div()
                  .w_full()
                  .max_w(days.length <= 7 ? 34 : 20)
                  .h(h)
                  .flex_none()
                  .rounded_t(4)
                  .bg(isPeak ? barColor : `${barColor}b8`)
                  .hover((s) => s.bg(isPeak ? barColor : `${barColor}e0`))
                  .when(day.cost === 0, (el) => el.opacity(0.25)),
              );
          }),
        ),
    )
    .child(labels);
}

export function miniStat(label, value, t, options = {}) {
  return v_flex()
    .flex_1()
    .min_w(0)
    .gap(3)
    .child(div().text_size(9).font_semibold().text_color(t.dim).child(label.toUpperCase()))
    .child(
      div()
        .text_size(options.size ?? 13)
        .font_medium()
        .text_color(options.color ?? t.foreground)
        .truncate()
        .child(value),
    );
}

export function dot(color, size = 7) {
  return div().size(size).flex_none().rounded_full().bg(color);
}

export function shareLabel(cost, total) {
  return percent(sharePct(cost, total), 0);
}

export function rowsSkeleton(t, rows = 4) {
  return v_flex()
    .w_full()
    .gap(10)
    .children(
      Array.from({ length: rows }, (_, i) => skeleton(t, { width: `${92 - i * 9}%`, height: 12 })),
    );
}
