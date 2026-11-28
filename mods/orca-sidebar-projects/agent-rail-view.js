// Native GPUI rail, moved here from the agent settings page: it now lives in the left sidebar.
// Global and every agent use the same coordinate system.
import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex, Link } from "gpui-base";
import { appHome } from "herdr";
import { RAIL, railGeometry, railViewport, railRows, railControl } from "./agent-rail.js";
import { hoverHighlight } from "./selection-ui.js";
import { applyRailOrder, dragSlot, moveInOrder, persistRailOrder, readRailOrder } from "./rail-order.js";

const MOTION = { duration: 200, easing: "ease-out" };
const LITELLM_ICON = "mods/orca-assets/litellm_favicon_light_32.png";

function litellmBadge(t, size = 14) {
  return div().absolute().right(1).bottom(1).size(size).rounded_full().bg(t.surface)
    .border_2().border_color(t.surface).flex().items_center().justify_center()
    .tooltip("LiteLLM enabled").child(image(LITELLM_ICON).w(size - 4).h(size - 4).rounded_full());
}

// The same icon tile the settings page used (orca-agent-settings parts.js).
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
    .on_hover((hoverIn, cx) => {
      if (!hoverIn && owner.railHover !== row.key) return;
      const next = hoverIn ? row.key : null;
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
    .child(div().size_full().relative().flex().items_center().justify_center()
      .child(global ? svg("mods/orca-assets/bot.svg").size(25).text_color(t.foreground)
        : div().when(!row.installed, el => el.opacity(0.45)).child(icon(row,28,t)))
      .when(!global && owner.litellmEnabled, el => el.child(litellmBadge(t)))));
  return item.child(railAction(owner, row, t, control, label));
}

function providerItem(owner, provider, t) {
  const key = `provider:${provider.id}`;
  const selected = owner.railSelection === key;
  const hovered = owner.railHover === key;
  const g = railGeometry(selected, hovered);
  const health = provider.health ?? "unknown";
  const tone = { healthy: t.done, checking: t.accent, unhealthy: t.blocked, unknown: t.dim }[health] ?? t.dim;
  const label = `${provider.name || "Model provider"} · ${{ healthy: "Healthy", checking: "Checking", unhealthy: "Unhealthy", unknown: "Not checked" }[health] ?? "Not checked"}`;
  const src = String(provider.iconPath ?? "").startsWith(`${appHome()}/`) ? String(provider.iconPath).slice(appHome().length + 1) : provider.iconPath;
  const item = div().id(`am-rail-${key}`).relative().w(RAIL.width).h(RAIL.row).flex_none()
    .on_hover((inside, cx) => {
      if (!inside && owner.railHover !== key) return;
      const next = inside ? key : null;
      if (next === owner.railHover) return;
      owner.railHover = next;
      cx.notify();
    })
    .child(div().absolute().left(g.indicatorLeft).top(0).bottom(0).w(RAIL.indicatorWidth).flex().items_center()
      .child(div().id(`am-rail-pill-${key}`).w_full().h(g.indicatorHeight).rounded_r(RAIL.indicatorWidth).bg(t.foreground).transition("height", MOTION)))
    .child(div().id(`am-rail-select-${key}`).absolute().left(g.avatarLeft).top(g.avatarTop).size(RAIL.avatar).rounded(RAIL.avatarRadius).bg(t.surface)
      .flex().items_center().justify_center().cursor_pointer().role("button").accessibility_label(label).tooltip(label)
      .on_click((_e,cx) => owner.selectRail(key,cx))
      .child(div().size_full().relative().flex().items_center().justify_center()
        .child(hoverHighlight(hovered && !selected, t, RAIL.avatarRadius))
        .child(src ? image(src).w(28).h(28).rounded(6) : svg("mods/orca-assets/hard-drive.svg").size(28).text_color(t.muted))
        .child(div().absolute().right(2).bottom(2).size(11).rounded_full().bg(tone).border_2().border_color(t.raised).tooltip(label))));
  return item;
}

function providerAddItem(owner, t) {
  const key = "provider:add";
  const selected = owner.railSelection === key;
  const hovered = owner.railHover === key;
  const g = railGeometry(selected, hovered);
  return div().id("am-rail-provider-add").relative().w(RAIL.width).h(RAIL.row).flex_none()
    .on_hover((inside, cx) => {
      if (!inside && owner.railHover !== key) return;
      const next = inside ? key : null;
      if (next === owner.railHover) return;
      owner.railHover = next;
      cx.notify();
    })
    .child(div().absolute().left(g.indicatorLeft).top(0).bottom(0).w(RAIL.indicatorWidth).flex().items_center()
      .child(div().w_full().h(g.indicatorHeight).rounded_r(RAIL.indicatorWidth).bg(t.foreground).transition("height", MOTION)))
    .child(div().id("am-rail-select-provider-add").absolute().left(g.avatarLeft).top(g.avatarTop).size(RAIL.avatar).rounded_full()
      .border_1().border_dashed().border_color(t.border).bg(t.surface).flex().items_center().justify_center().cursor_pointer()
      .role("button").accessibility_label("Add model provider").tooltip("Add model provider")
      .on_click((_e,cx) => owner.selectRail(key,cx))
      .hover(s => s.bg(t.hover).border_color(t.accent))
      .text_size(23).line_height("23px").text_color(selected || hovered ? t.accent : t.muted).child("+"));
}

// The switch and install sit over the avatar; their hover must not light the avatar too.
function controlHover(owner, key, hovered, cx) {
  const next = hovered ? key : null;
  if (next === (owner.railControlHover ?? null)) return;
  owner.railControlHover = next;
  cx.notify();
}

function railAction(owner, row, t, control, label) {
  const avatarRight = (RAIL.width + RAIL.avatar) / 2;
  if (row.key === "global") {
    return div().absolute().left(avatarRight - 20).top(39).size(20).rounded_full().bg(t.raised)
      .border_1().border_color(t.border).flex().items_center().justify_center()
      .cursor_pointer().tooltip(label).on_click((_e,cx) => owner.selectRail(row.key,cx))
      .child(svg("mods/orca-assets/settings.svg").size(12).text_color(t.muted));
  }
  if (control?.kind === "switch") {
    // t.input is translucent in the dark theme; the off track must stay opaque.
    // Center the visible switch in its hit area, then align its right edge with the avatar.
    const hitLeft = avatarRight - (RAIL.hitWidth + RAIL.switchWidth) / 2;
    return div().id("am-rail-toggle-" + row.key).absolute().left(hitLeft).top(33)
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
      .child(svg("mods/orca-assets/download.svg").size(14));
    // Keep the install affordance visible even if a community CLI has no known guide.
    // A missing guide opens that agent's details, never a guessed shell command.
    const hit = h_flex().w(30).h(27).items_center().justify_center().child(glyph);
    const action = row.homepage
      ? Link.new("am-rail-install-" + row.key).href(row.homepage).tooltip("Install " + row.name).child(hit)
      : div().id("am-rail-install-" + row.key).role("button").accessibility_label("Install " + row.name)
        .tooltip("Install " + row.name).cursor_pointer().on_click((_e,cx) => {
          cx.stop_propagation(); owner.selectRail(row.key,cx);
        }).child(hit);
    // The 22px install glyph is centered in this 30px hit target.
    return div().absolute().left(avatarRight - 26).top(33).w(30).h(27).flex().items_center().justify_center()
      .on_hover((hovered, cx) => controlHover(owner, row.key, hovered, cx)).child(action);
  }
  return div().size(0);
}

// A Discord-style rounded group has a folder toggle at the top and agent tiles beneath it.
// Drag to reorder (like a todo list): grab a row, it follows the pointer, and the other rows slide
// to make room. Release commits the order on screen to the saved "rail.order".
function railDragStart(owner, group, key, pressOffset, cx) {
  const base = owner.railDisplayed?.[group] ?? [];
  const index = base.indexOf(key);
  if (index < 0) return;
  owner.railDrag = { group, key, base, pressOffset, pointerY: index * RAIL.row + pressOffset };
  cx.notify();
}

function railDragMove(owner, group, e, cx) {
  const drag = owner.railDrag;
  if (!drag || drag.group !== group) return;
  drag.pointerY = e.local_position?.y ?? drag.pointerY;
  cx.notify();
}

function railDragEnd(owner, cx) {
  const drag = owner.railDrag;
  owner.railDrag = null;
  if (drag) {
    const target = dragSlot(drag.pointerY, drag.pressOffset, RAIL.row, drag.base.length);
    const next = moveInOrder(drag.base, drag.key, target);
    if (next.some((key, i) => key !== drag.base[i])) {
      persistRailOrder({ ...readRailOrder(), [drag.group]: next });
    }
  }
  cx.notify();
}

// The rows of a draggable group. Each row sits in its slot; the dragged row sits under the pointer
// and is lifted with a shadow, while the others move to the slots the drag order gives them.
function dragRows(owner, group, items, keyOf, render) {
  const drag = owner.railDrag && owner.railDrag.group === group ? owner.railDrag : null;
  const byKey = new Map(items.map(item => [keyOf(item), item]));
  const keys = drag
    ? moveInOrder(drag.base, drag.key, dragSlot(drag.pointerY, drag.pressOffset, RAIL.row, drag.base.length))
    : items.map(keyOf);
  return div().relative().w(RAIL.width).h(keys.length * RAIL.row).children(
    keys.map((key, slot) => {
      const dragged = drag?.key === key;
      const top = drag && dragged ? drag.pointerY - drag.pressOffset : slot * RAIL.row;
      const item = byKey.get(key);
      return div().absolute().left(0).top(top).w(RAIL.width).h(RAIL.row)
        .when(!dragged, el => el.transition("top", MOTION))
        .when(dragged, el => el.shadow_lg())
        .on_mouse_down("left", (e, cx) => railDragStart(owner, group, key, e.local_position?.y ?? 0, cx))
        .when(item !== undefined, el => el.child(render(item)));
    }),
  );
}

function groupView(owner, title, rows, scroll, t) {
  const key = title === "Official" ? "officialRailOpen" : "unofficialRailOpen";
  const open = owner[key] !== false;
  const action = `${open ? "Collapse" : "Expand"} ${title}`;
  const medal = title === "Official" ? "🏅" : "🥉";
  const isUnofficial = title === "Unofficial";
  const displayed = isUnofficial ? applyRailOrder(railRows(rows), readRailOrder().unofficial, row => row.key) : railRows(rows);
  if (isUnofficial) owner.railDisplayed = {...owner.railDisplayed, unofficial: displayed.map(row => row.key)};
  const {height,scroll:overflow} = railViewport(displayed.length);
  const id = "am-rail-list-" + title.toLowerCase();
  return div().relative().w(RAIL.width).flex_none().mb(RAIL.groupGap)
    .child(div().absolute().left(RAIL.groupLeft).w(RAIL.groupWidth).top(0).bottom(0).rounded(RAIL.groupRadius).bg(t.raised))
    .child(v_flex().w(RAIL.width)
      .child(div().id("am-rail-folder-" + title.toLowerCase()).relative().w(RAIL.width).h(RAIL.row).flex_none()
        .flex().items_center().justify_center().cursor_pointer().role("button")
        .accessibility_label(action).tooltip(action)
        .on_click((_e,cx) => { owner[key] = !open; cx.notify(); })
        .child(div().relative().size(32).flex().items_center().justify_center()
          .child(svg("mods/orca-assets/folder--orca-sidebar-projects.svg").size(25).text_color(t.accent))
          .child(div().absolute().right(-7).bottom(-6).text_size(20).child(medal))))
      .child(div().relative().w(RAIL.width).h(open ? height : 0).overflow_hidden().transition("height", MOTION)
        .opacity(open ? 1 : 0).transition("opacity", MOTION)
        .child(div().relative().w(RAIL.width).h(height).overflow_hidden()
        .child(v_flex().id(id)
          .when(isUnofficial, el => el.on_mouse_move((e, cx) => railDragMove(owner, "unofficial", e, cx)).on_mouse_up("left", (_e, cx) => railDragEnd(owner, cx)))
          .w(RAIL.width).track_scroll(scroll)
          .when(overflow, inner => inner.absolute().inset_0().overflow_y_scroll())
          .children(isUnofficial
            ? [dragRows(owner, "unofficial", displayed, row => row.key, row => railItem(owner,row,t,t.surface))]
            : displayed.map(row => railItem(owner,row,t,t.surface)))))));
}

function providerGroupView(owner, providers, t) {
  const open = owner.providerRailOpen !== false;
  const action = `${open ? "Collapse" : "Expand"} Model providers`;
  const displayed = applyRailOrder(providers, readRailOrder().providers, provider => provider.id);
  owner.railDisplayed = {...owner.railDisplayed, providers: displayed.map(provider => provider.id)};
  const {height,scroll:overflow} = railViewport(displayed.length + 1);
  return div().relative().w(RAIL.width).flex_none().mb(RAIL.groupGap)
    .child(div().absolute().left(RAIL.groupLeft).w(RAIL.groupWidth).top(0).bottom(0).rounded(RAIL.groupRadius).bg(t.raised))
    .child(v_flex().w(RAIL.width)
      .child(div().id("am-rail-folder-model-providers").relative().w(RAIL.width).h(RAIL.row).flex_none()
        .flex().items_center().justify_center().cursor_pointer().role("button")
        .accessibility_label(action).tooltip(action)
        .on_click((_e,cx) => { owner.providerRailOpen = !open; cx.notify(); })
        .child(div().relative().size(32).flex().items_center().justify_center()
          .child(svg("mods/orca-assets/folder--orca-sidebar-projects.svg").size(25).text_color(t.accent))
          .child(div().absolute().right(-7).bottom(-6).size(20).rounded_full().bg(t.raised).border_1().border_color(t.border)
            .flex().items_center().justify_center().child(svg("mods/orca-assets/hard-drive.svg").size(12).text_color(t.muted)))))
      .child(
        div().relative().w(RAIL.width).h(open ? height : 0).overflow_hidden().transition("height", MOTION)
          .opacity(open ? 1 : 0).transition("opacity", MOTION)
          .child(
            div().relative().w(RAIL.width).h(height).overflow_hidden()
              .child(
                v_flex().id("am-rail-list-model-providers").on_mouse_move((e, cx) => railDragMove(owner, "providers", e, cx)).on_mouse_up("left", (_e, cx) => railDragEnd(owner, cx)).w(RAIL.width).track_scroll(owner.providerRailScroll)
                  .when(overflow, inner => inner.absolute().inset_0().overflow_y_scroll())
                  .children([dragRows(owner, "providers", displayed, provider => provider.id, provider => providerItem(owner,provider,t))])
                  .child(providerAddItem(owner,t)),
              ),
          ),
      ),
    );
}

export function railView(owner, official, unofficial, providers, t) {
  return v_flex().id("am-agent-rail").w(RAIL.width).flex_none().min_h(0)
    .bg(t.surface).overflow_y_scrollbar()
    .child(railItem(owner,{key:"global"},t))
    .child(div().w_full().h(12).flex().items_center().justify_center().child(div().w(32).h(2).rounded_full().bg(t.border)))
    .child(groupView(owner,"Official",official,owner.officialRailScroll,t))
    .child(groupView(owner,"Unofficial",unofficial,owner.unofficialRailScroll,t))
    .child(div().w_full().h(12).flex().items_center().justify_center().child(div().w(32).h(2).rounded_full().bg(t.border)))
    .child(providerGroupView(owner,providers,t));
}
