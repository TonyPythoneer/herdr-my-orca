// Native GPUI rail. Global and every agent use the same coordinate system.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Link } from "gpui-base";
import { icon } from "./parts.js";
import { RAIL, railGeometry, railViewport, railRows, railControl } from "./agent-rail.js";

export function railItem(owner, row, t) {
  const global = row.key === "global";
  const selected = owner.railSelection === row.key;
  const g = railGeometry(selected, owner.railHover === row.key);
  const control = global || row.installed === undefined ? null : railControl(row);
  const label = global ? "Global Agent Settings" : row.name;
  let item = div().id("am-rail-" + row.key).relative().w(RAIL.width).h(RAIL.row).flex_none()
    .on_hover((hovered, cx) => {
      if (hovered) owner.railHover = row.key;
      else if (owner.railHover === row.key) owner.railHover = null;
      cx.notify();
    });
  if (g.indicatorHeight) item = item.child(div().absolute().left(g.indicatorLeft).top(g.indicatorTop)
    .w(RAIL.indicatorWidth).h(g.indicatorHeight).rounded_full().bg(t.foreground));
  item = item.child(div().id("am-rail-select-" + row.key).absolute().left(g.avatarLeft).top(g.avatarTop)
    .size(RAIL.avatar).rounded_full().bg(selected ? t.hover : t.raised)
    .flex().items_center().justify_center().cursor_pointer().role("button")
    .accessibility_label(label).tooltip(label).hover(s => s.bg(t.hover))
    .on_click((_e,cx) => owner.selectRail(row.key,cx))
    .child(global ? svg("mods/orca-new-menu/bot.svg").size(25).text_color(t.foreground)
      : div().when(!row.installed, el => el.opacity(0.45)).child(icon(row,28,t))));
  return item.child(railAction(owner, row, t, control, label));
}

function railAction(owner, row, t, control, label) {
  if (row.key === "global") {
    return div().absolute().left(48).top(39).size(20).rounded_full().bg(t.raised)
      .border_1().border_color(t.border).flex().items_center().justify_center()
      .cursor_pointer().tooltip(label).on_click((_e,cx) => owner.selectRail(row.key,cx))
      .child(svg("mods/orca-chrome/settings.svg").size(12).text_color(t.muted));
  }
  if (control?.kind === "switch") {
    return div().id("am-rail-toggle-" + row.key).absolute().left(40).top(33)
      .w(RAIL.hitWidth).h(RAIL.hitHeight).flex().items_center().justify_center()
      .role("switch").checked(control.checked).accessibility_label("Enable " + row.name)
      .cursor_pointer().on_click((_e,cx) => { cx.stop_propagation(); owner.toggleEnabled(row,cx); })
      .child(h_flex().w(RAIL.switchWidth).h(RAIL.switchHeight).rounded_full().p(3)
        .bg(control.checked ? t.accent : t.input).items_center()
        .when(control.checked, el => el.justify_end())
        .child(div().size(11).rounded_full().bg(t.foreground)));
  }
  if (control?.kind === "install") {
    const glyph = div().size(22).rounded_full().bg(t.raised).border_1().border_color(t.border)
      .flex().items_center().justify_center().text_color(t.accent)
      .child(svg("mods/orca-agent-manager/download.svg").size(14));
    // Keep the install affordance visible even if a community CLI has no known guide.
    // A missing guide opens that agent's details, never a guessed shell command.
    const hit = h_flex().w(30).h(27).items_center().justify_center().child(glyph);
    const action = row.homepage
      ? Link.new("am-rail-install-" + row.key).href(row.homepage).tooltip("Install " + row.name).child(hit)
      : div().id("am-rail-install-" + row.key).role("button").accessibility_label("Install " + row.name)
        .tooltip("Install " + row.name).cursor_pointer().on_click((_e,cx) => {
          cx.stop_propagation(); owner.selectRail(row.key,cx);
        }).child(hit);
    return div().absolute().left(43).top(33).w(30).h(27).flex().items_center().justify_center().child(action);
  }
  return div().size(0);
}

function groupView(owner, title, rows, scroll, t) {
  const {height,scroll:overflow} = railViewport(rows.length);
  const id = "am-rail-list-" + title.toLowerCase();
  return v_flex().w(RAIL.width).flex_none()
    .child(div().h(23).w_full().flex().items_center().justify_center().text_size(10).text_color(t.muted).child(title))
    .child(div().relative().w(RAIL.width).h(height).overflow_hidden()
      .child(v_flex().id(id).w(RAIL.width).track_scroll(scroll)
        .when(overflow, el => el.absolute().inset_0().overflow_y_scroll())
        .children(railRows(rows).map(row => railItem(owner,row,t)))));
}

export function railView(owner, official, unofficial, t) {
  return v_flex().id("am-agent-rail").w(RAIL.width).flex_none().min_h(0)
    .bg(t.surface).overflow_y_scrollbar()
    .child(railItem(owner,{key:"global"},t))
    .child(groupView(owner,"Official",official,owner.officialRailScroll,t))
    .child(div().w_full().h(1).bg(t.border))
    .child(groupView(owner,"Unofficial",unofficial,owner.unofficialRailScroll,t));
}
