// Native GPUI rail, moved here from the agent settings page: it now lives in the left sidebar.
// Global and every agent use the same coordinate system.
import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex, Link } from "gpui-base";
import { RAIL, railGeometry, railViewport, railRows, railControl } from "./agent-rail.js";

const MOTION = { duration: 200, easing: "ease-out" };

// The same icon tile the settings page used (orca-agent-manager parts.js).
function icon(row, size, t) {
  if (row.icon) {
    return row.tint
      ? svg(row.icon).size(size).flex_none().text_color(t.muted)
      : image(row.icon).w(size).h(size).flex_none().rounded(3);
  }
  return div().size(size).flex_none().rounded(3).bg(t.raised).flex().items_center().justify_center()
    .text_size(Math.round(size * 0.55)).text_color(t.muted).child((row.name ?? "?").slice(0, 1).toUpperCase());
}
export function railItem(owner, row, t, tile = t.raised) {
  const global = row.key === "global";
  const selected = owner.railSelection === row.key;
  const hovered = owner.railHover === row.key;
  const tileHovered = hovered && owner.railControlHover !== row.key;
  const g = railGeometry(selected, hovered);
  const control = global || row.installed === undefined ? null : railControl(row);
  const label = global ? "Global Agent Settings" : row.name;
  let item = div().id("am-rail-" + row.key).relative().w(RAIL.width).h(RAIL.row).flex_none()
    .on_hover((hovered, cx) => {
      if (!hovered && owner.railHover !== row.key) return;
      const next = hovered ? row.key : null;
      if (next === owner.railHover) return;
      owner.railHover = next;
      cx.notify();
    });
  item = item.child(div().absolute().left(g.indicatorLeft).top(0).bottom(0).w(RAIL.indicatorWidth).flex().items_center()
    .child(div().id("am-rail-pill-" + row.key).w_full().h(g.indicatorHeight)
      .rounded_r(RAIL.indicatorWidth).bg(t.foreground).transition("height", MOTION)));
  item = item.child(div().id("am-rail-select-" + row.key).absolute().left(g.avatarLeft).top(g.avatarTop)
    .size(RAIL.avatar).rounded(RAIL.avatarRadius).bg(tile)
    .flex().items_center().justify_center().cursor_pointer().role("button")
    .accessibility_label(label).tooltip(label)
    .on_click((_e,cx) => owner.selectRail(row.key,cx))
    .child(div().id("am-rail-tile-" + row.key).absolute().inset_0().rounded(RAIL.avatarRadius)
      .bg(t.hover).opacity(selected || tileHovered ? 1 : 0).transition("opacity", MOTION))
    .child(div().relative().child(global ? svg("mods/orca-new-menu/bot.svg").size(25).text_color(t.foreground)
      : div().when(!row.installed, el => el.opacity(0.45)).child(icon(row,28,t)))));
  return item.child(railAction(owner, row, t, control, label));
}

// The switch and install sit over the avatar; their hover must not light the avatar too.
function controlHover(owner, key, hovered, cx) {
  const next = hovered ? key : null;
  if (next === (owner.railControlHover ?? null)) return;
  owner.railControlHover = next;
  cx.notify();
}

function railAction(owner, row, t, control, label) {
  if (row.key === "global") {
    return div().absolute().left(48).top(39).size(20).rounded_full().bg(t.raised)
      .border_1().border_color(t.border).flex().items_center().justify_center()
      .cursor_pointer().tooltip(label).on_click((_e,cx) => owner.selectRail(row.key,cx))
      .child(svg("mods/orca-chrome/settings.svg").size(12).text_color(t.muted));
  }
  if (control?.kind === "switch") {
    // t.input is translucent in the dark theme; the off track must stay opaque.
    return div().id("am-rail-toggle-" + row.key).absolute().left(40).top(33)
      .w(RAIL.hitWidth).h(RAIL.hitHeight).flex().items_center().justify_center()
      .role("switch").checked(control.checked).accessibility_label("Enable " + row.name)
      .on_hover((hovered, cx) => controlHover(owner, row.key, hovered, cx))
      .cursor_pointer().on_click((_e,cx) => { cx.stop_propagation(); owner.toggleEnabled(row,cx); })
      .child(div().relative().w(RAIL.switchWidth).h(RAIL.switchHeight).rounded_full()
        .bg(control.checked ? t.accent : t.ring).border_1().border_color(control.checked ? t.accent : t.ring)
        .hover((s) => s.border_color(t.foreground))
        .child(div().absolute().top(2).left(control.checked ? RAIL.switchWidth - 15 : 2).size(11).rounded_full()
          .bg(t.foreground).transition("left", MOTION)));
  }
  if (control?.kind === "install") {
    const glyph = div().size(22).rounded_full().bg(t.raised).border_1().border_color(t.border).hover((s) => s.border_color(t.foreground))
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
    return div().absolute().left(43).top(33).w(30).h(27).flex().items_center().justify_center()
      .on_hover((hovered, cx) => controlHover(owner, row.key, hovered, cx)).child(action);
  }
  return div().size(0);
}

// A group is a rounded box (Discord's folder) holding its title and its rows. The pills stay on the
// rail's left edge, outside the box.
function groupView(owner, title, rows, scroll, t) {
  const {height,scroll:overflow} = railViewport(rows.length);
  const id = "am-rail-list-" + title.toLowerCase();
  return div().relative().w(RAIL.width).flex_none().mb(RAIL.groupGap)
    .child(div().absolute().left(RAIL.groupLeft).w(RAIL.groupWidth).top(0).bottom(0).rounded(RAIL.groupRadius).bg(t.raised))
    .child(v_flex().w(RAIL.width)
      .child(div().h(23).w_full().flex().items_center().justify_center().text_size(10).text_color(t.muted).child(title))
      .child(div().relative().w(RAIL.width).h(height).overflow_hidden()
        .child(v_flex().id(id).w(RAIL.width).track_scroll(scroll)
          .when(overflow, el => el.absolute().inset_0().overflow_y_scroll())
          .children(railRows(rows).map(row => railItem(owner,row,t,t.surface))))));
}

export function railView(owner, official, unofficial, t) {
  return v_flex().id("am-agent-rail").w(RAIL.width).flex_none().min_h(0)
    .bg(t.surface).overflow_y_scrollbar()
    .child(railItem(owner,{key:"global"},t))
    .child(div().w_full().h(12).flex().items_center().justify_center().child(div().w(32).h(2).rounded_full().bg(t.border)))
    .child(groupView(owner,"Official",official,owner.officialRailScroll,t))
    .child(groupView(owner,"Unofficial",unofficial,owner.unofficialRailScroll,t));
}
