import {
  div,
  svg,
  image,
  type Color,
  type Context,
  type MouseMoveEvent,
  type NativeElement,
} from "gpui-kit";
import { h_flex, v_flex, Link, type ScrollHandle } from "gpui-base";
import { appHome } from "herdr";
import {
  railGeometry,
  railViewport,
  railRows,
  railControl,
  type RailControl,
  type RailGeometry,
  type RailRow,
} from "./agent-rail.js";
import * as SidebarUI from "../../config/ui-settings/agent-settings/sidebar.js";
import { hoverHighlight } from "../../primitives/selection-ui.js";
import {
  applyRailOrder,
  dragSlot,
  moveInOrder,
  persistRailOrder,
  readRailOrder,
} from "../../services/agent-settings/sidebar-order.js";

export type RailTheme = {
  accent: Color;
  blocked: Color;
  border: Color;
  dim: Color;
  done: Color;
  foreground: Color;
  hover: Color;
  muted: Color;
  raised: Color;
  ring: Color;
  surface: Color;
};

export type ProviderRow = {
  id: string;
  name?: string;
  health?: string | null;
  iconPath?: string | null;
};

export type RailOwner = {
  railHover: string | null;
  railControlHover?: string | null;
  railDrag?: {
    group: "unofficial" | "providers";
    key: string;
    base: string[];
    pressOffset: number;
    pointerY: number;
  } | null;
  railDisplayed?: { unofficial?: string[]; providers?: string[] };
  railSelection: string;
  readonly litellmEnabled: boolean;
  officialRailOpen?: boolean;
  unofficialRailOpen?: boolean;
  providerRailOpen?: boolean;
  officialRailScroll: ScrollHandle;
  unofficialRailScroll: ScrollHandle;
  providerRailScroll: ScrollHandle;
  selectRail(key: string, cx: Context): void;
  toggleEnabled(row: RailRow, cx: Context): void;
};

type RailState = {
  global: boolean;
  selected: boolean;
  hovered: boolean;
  tileHovered: boolean;
  geometry: RailGeometry;
  label: string;
};

type ProviderState = {
  key: string;
  label: string;
  tone: Color;
  src: string;
  geometry: RailGeometry;
  selected: boolean;
  hovered: boolean;
};

const MOTION = { duration: 200, easing: "ease-out" } as const;
const LITELLM_ICON = "mods/orca-assets/litellm_favicon_light_32.png";
const AVATAR_RIGHT = (SidebarUI.SIDEBAR__WIDTH_PX + SidebarUI.AVATAR__SIZE_PX) / 2;
const HEALTH_LABEL: Record<string, string | undefined> = {
  healthy: "Healthy",
  checking: "Checking",
  unhealthy: "Unhealthy",
  unknown: "Not checked",
};

function litellmBadge(t: RailTheme, size = 14): NativeElement {
  return div()
    .absolute()
    .right(1)
    .bottom(1)
    .size(size)
    .rounded_full()
    .bg(t.surface)
    .border_2()
    .border_color(t.surface)
    .flex()
    .items_center()
    .justify_center()
    .tooltip("LiteLLM enabled")
    .child(
      image(LITELLM_ICON)
        .w(size - 4)
        .h(size - 4)
        .rounded_full(),
    );
}

function icon(row: RailRow, size: number, t: RailTheme): NativeElement {
  if (row.icon)
    return row.tint
      ? svg(row.icon).size(size).flex_none().text_color(t.muted)
      : image(row.icon).w(size).h(size).flex_none().rounded(3);
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

function hoverTracker(owner: RailOwner, key: string) {
  return (inside: boolean, cx: Context) => {
    if (!inside && owner.railHover !== key) return;
    const next = inside ? key : null;
    if (next === owner.railHover) return;
    owner.railHover = next;
    cx.notify();
  };
}

function getAgentSelectionState(owner: RailOwner, row: RailRow): RailState {
  const global = row.key === "global";
  const selected = owner.railSelection === row.key;
  const hovered = owner.railHover === row.key;
  return {
    global,
    selected,
    hovered,
    tileHovered: hovered && owner.railControlHover !== row.key,
    geometry: railGeometry(selected, hovered),
    label: global ? "Global Agent Settings" : (row.name ?? ""),
  };
}

function indicator(key: string, g: RailGeometry, t: RailTheme): NativeElement {
  return div()
    .absolute()
    .left(g.indicatorLeft)
    .top(0)
    .bottom(0)
    .w(SidebarUI.SELECTION_INDICATOR__WIDTH_PX)
    .flex()
    .items_center()
    .child(
      div()
        .id("am-rail-pill-" + key)
        .w_full()
        .h(g.indicatorHeight)
        .rounded_r(SidebarUI.SELECTION_INDICATOR__WIDTH_PX)
        .bg(t.foreground)
        .transition("height", MOTION),
    );
}

function avatar(
  owner: RailOwner,
  row: RailRow,
  t: RailTheme,
  tile: Color,
  s: RailState,
): NativeElement {
  return div()
    .id("am-rail-select-" + row.key)
    .absolute()
    .left(s.geometry.avatarLeft)
    .top(s.geometry.avatarTop)
    .size(SidebarUI.AVATAR__SIZE_PX)
    .rounded(SidebarUI.AVATAR__RADIUS_PX)
    .bg(tile)
    .flex()
    .items_center()
    .justify_center()
    .cursor_pointer()
    .role("button")
    .accessibility_label(s.label)
    .tooltip(s.label)
    .on_click((_e, cx) => owner.selectRail(row.key, cx))
    .child(
      div()
        .id("am-rail-tile-" + row.key)
        .absolute()
        .inset_0()
        .rounded(SidebarUI.AVATAR__RADIUS_PX)
        .bg(t.hover)
        .opacity(s.selected || s.tileHovered ? 1 : 0)
        .transition("opacity", MOTION),
    )
    .child(
      div()
        .size_full()
        .relative()
        .flex()
        .items_center()
        .justify_center()
        .child(
          s.global
            ? svg("mods/orca-assets/bot.svg").size(25).text_color(t.foreground)
            : div()
                .when(!row.installed, (el) => el.opacity(0.45))
                .child(icon(row, 28, t)),
        )
        .when(!s.global && owner.litellmEnabled, (el) => el.child(litellmBadge(t))),
    );
}

export function railItem(
  owner: RailOwner,
  row: RailRow,
  t: RailTheme,
  tile: Color = t.raised,
): NativeElement {
  const s = getAgentSelectionState(owner, row);
  const control = s.global || row.installed === undefined ? null : railControl(row);
  return div()
    .id("am-rail-" + row.key)
    .relative()
    .w(SidebarUI.SIDEBAR__WIDTH_PX)
    .h(SidebarUI.ROW__HEIGHT_PX)
    .flex_none()
    .on_hover(hoverTracker(owner, row.key))
    .child(indicator(row.key, s.geometry, t))
    .child(avatar(owner, row, t, tile, s))
    .child(railAction(owner, row, t, control, s.label));
}

function getProviderHealthStatusColor(health: string, t: RailTheme): Color {
  const tones: Record<string, Color | undefined> = {
    healthy: t.done,
    checking: t.accent,
    unhealthy: t.blocked,
    unknown: t.dim,
  };
  return tones[health] ?? t.dim;
}

function providerState(owner: RailOwner, provider: ProviderRow, t: RailTheme): ProviderState {
  const key = `provider:${provider.id}`;
  const selected = owner.railSelection === key;
  const hovered = owner.railHover === key;
  const health = provider.health ?? "unknown";
  const home = `${appHome()}/`;
  const iconPath = provider.iconPath ?? "";
  return {
    key,
    selected,
    hovered,
    geometry: railGeometry(selected, hovered),
    label: `${provider.name || "Model provider"} · ${HEALTH_LABEL[health] ?? "Not checked"}`,
    tone: getProviderHealthStatusColor(health, t),
    src: iconPath.startsWith(home) ? iconPath.slice(home.length) : iconPath,
  };
}

function providerAvatar(owner: RailOwner, s: ProviderState, t: RailTheme): NativeElement {
  return div()
    .id(`am-rail-select-${s.key}`)
    .absolute()
    .left(s.geometry.avatarLeft)
    .top(s.geometry.avatarTop)
    .size(SidebarUI.AVATAR__SIZE_PX)
    .rounded(SidebarUI.AVATAR__RADIUS_PX)
    .bg(t.surface)
    .flex()
    .items_center()
    .justify_center()
    .cursor_pointer()
    .role("button")
    .accessibility_label(s.label)
    .tooltip(s.label)
    .on_click((_e, cx) => owner.selectRail(s.key, cx))
    .child(
      div()
        .size_full()
        .relative()
        .flex()
        .items_center()
        .justify_center()
        .child(hoverHighlight(s.hovered && !s.selected, t, SidebarUI.AVATAR__RADIUS_PX))
        .child(
          s.src
            ? image(s.src).w(28).h(28).rounded(6)
            : svg("mods/orca-assets/hard-drive.svg").size(28).text_color(t.muted),
        )
        .child(
          div()
            .absolute()
            .right(2)
            .bottom(2)
            .size(11)
            .rounded_full()
            .bg(s.tone)
            .border_2()
            .border_color(t.raised)
            .tooltip(s.label),
        ),
    );
}

function providerItem(owner: RailOwner, provider: ProviderRow, t: RailTheme): NativeElement {
  const s = providerState(owner, provider, t);
  return div()
    .id(`am-rail-${s.key}`)
    .relative()
    .w(SidebarUI.SIDEBAR__WIDTH_PX)
    .h(SidebarUI.ROW__HEIGHT_PX)
    .flex_none()
    .on_hover(hoverTracker(owner, s.key))
    .child(indicator(s.key, s.geometry, t))
    .child(providerAvatar(owner, s, t));
}

function providerAddItem(owner: RailOwner, t: RailTheme): NativeElement {
  const key = "provider:add";
  const selected = owner.railSelection === key;
  const hovered = owner.railHover === key;
  const g = railGeometry(selected, hovered);
  return div()
    .id("am-rail-provider-add")
    .relative()
    .w(SidebarUI.SIDEBAR__WIDTH_PX)
    .h(SidebarUI.ROW__HEIGHT_PX)
    .flex_none()
    .on_hover(hoverTracker(owner, key))
    .child(
      div()
        .absolute()
        .left(g.indicatorLeft)
        .top(0)
        .bottom(0)
        .w(SidebarUI.SELECTION_INDICATOR__WIDTH_PX)
        .flex()
        .items_center()
        .child(
          div()
            .w_full()
            .h(g.indicatorHeight)
            .rounded_r(SidebarUI.SELECTION_INDICATOR__WIDTH_PX)
            .bg(t.foreground)
            .transition("height", MOTION),
        ),
    )
    .child(
      div()
        .id("am-rail-select-provider-add")
        .absolute()
        .left(g.avatarLeft)
        .top(g.avatarTop)
        .size(SidebarUI.AVATAR__SIZE_PX)
        .rounded_full()
        .border_1()
        .border_dashed()
        .border_color(t.border)
        .bg(t.surface)
        .flex()
        .items_center()
        .justify_center()
        .cursor_pointer()
        .role("button")
        .accessibility_label("Add model provider")
        .tooltip("Add model provider")
        .on_click((_e, cx) => owner.selectRail(key, cx))
        .hover((s) => s.bg(t.hover).border_color(t.accent))
        .text_size(23)
        .line_height("23px")
        .text_color(selected || hovered ? t.accent : t.muted)
        .child("+"),
    );
}

function controlHover(owner: RailOwner, key: string, hovered: boolean, cx: Context): void {
  const next = hovered ? key : null;
  if (next === (owner.railControlHover ?? null)) return;
  owner.railControlHover = next;
  cx.notify();
}

function globalAction(owner: RailOwner, t: RailTheme, label: string): NativeElement {
  return div()
    .absolute()
    .left(AVATAR_RIGHT - 20)
    .top(39)
    .size(20)
    .rounded_full()
    .bg(t.raised)
    .border_1()
    .border_color(t.border)
    .flex()
    .items_center()
    .justify_center()
    .cursor_pointer()
    .tooltip(label)
    .on_click((_e, cx) => owner.selectRail("global", cx))
    .child(svg("mods/orca-assets/settings.svg").size(12).text_color(t.muted));
}

function AgentAvailabilitySwitch(
  owner: RailOwner,
  row: RailRow,
  t: RailTheme,
  checked: boolean,
): NativeElement {
  const switchLeft = AVATAR_RIGHT - SidebarUI.ENABLE_SWITCH__WIDTH_PX;
  return div()
    .id("am-rail-toggle-" + row.key)
    .absolute()
    .left(switchLeft)
    .top(SidebarUI.ENABLE_SWITCH__TOP_OFFSET_PX)
    .w(SidebarUI.ENABLE_SWITCH__WIDTH_PX)
    .h(SidebarUI.ENABLE_SWITCH__HEIGHT_PX)
    .flex()
    .items_center()
    .justify_center()
    .role("switch")
    .checked(checked)
    .accessibility_label("Enable " + row.name)
    .on_hover((hovered, cx) => controlHover(owner, row.key, hovered, cx))
    .cursor_pointer()
    .on_click((_e, cx) => {
      cx.stop_propagation();
      owner.toggleEnabled(row, cx);
    })
    .child(
      div()
        .relative()
        .w(SidebarUI.ENABLE_SWITCH__WIDTH_PX)
        .h(SidebarUI.ENABLE_SWITCH__HEIGHT_PX)
        .rounded_full()
        .bg(checked ? t.accent : t.ring)
        .border_1()
        .border_color(checked ? t.accent : t.ring)
        .hover((s) => s.border_color(t.foreground))
        .child(
          div()
            .absolute()
            .top(SidebarUI.ENABLE_SWITCH_THUMB__INSET_PX)
            .left(checked ? SidebarUI.ENABLE_SWITCH__WIDTH_PX - SidebarUI.ENABLE_SWITCH_THUMB__SIZE_PX - SidebarUI.ENABLE_SWITCH_THUMB__CHECKED_RIGHT_OFFSET_PX : SidebarUI.ENABLE_SWITCH_THUMB__INSET_PX)
            .size(SidebarUI.ENABLE_SWITCH_THUMB__SIZE_PX)
            .rounded_full()
            .bg(t.foreground)
            .transition("left", MOTION),
        ),
    );
}

function installAction(owner: RailOwner, row: RailRow, t: RailTheme): NativeElement {
  const glyph = div()
    .size(22)
    .rounded_full()
    .bg(t.raised)
    .border_1()
    .border_color(t.border)
    .hover((s) => s.border_color(t.foreground))
    .flex()
    .items_center()
    .justify_center()
    .text_color(t.accent)
    .child(svg("mods/orca-assets/download.svg").size(14));
  const hit = h_flex().w(30).h(27).items_center().justify_center().child(glyph);
  const action = row.homepage
    ? Link.new("am-rail-install-" + row.key)
        .href(row.homepage)
        .tooltip("Install " + row.name)
        .child(hit)
    : div()
        .id("am-rail-install-" + row.key)
        .role("button")
        .accessibility_label("Install " + row.name)
        .tooltip("Install " + row.name)
        .cursor_pointer()
        .on_click((_e, cx) => {
          cx.stop_propagation();
          owner.selectRail(row.key, cx);
        })
        .child(hit);
  return div()
    .absolute()
    .left(AVATAR_RIGHT - 26)
    .top(33)
    .w(30)
    .h(27)
    .flex()
    .items_center()
    .justify_center()
    .on_hover((hovered, cx) => controlHover(owner, row.key, hovered, cx))
    .child(action);
}

function railAction(
  owner: RailOwner,
  row: RailRow,
  t: RailTheme,
  control: RailControl | null,
  label: string,
): NativeElement {
  if (row.key === "global") return globalAction(owner, t, label);
  if (control?.kind === "switch") return AgentAvailabilitySwitch(owner, row, t, control.checked);
  if (control?.kind === "install") return installAction(owner, row, t);
  return div().size(0);
}

function AgentGroupCollapsibleTrigger(
  id: string,
  action: string,
  toggle: (cx: Context) => void,
  badge: NativeElement,
  t: RailTheme,
): NativeElement {
  return div()
    .id(id)
    .relative()
    .w(SidebarUI.SIDEBAR__WIDTH_PX)
    .h(SidebarUI.ROW__HEIGHT_PX)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .cursor_pointer()
    .role("button")
    .accessibility_label(action)
    .tooltip(action)
    .on_click((_e, cx) => toggle(cx))
    .child(
      div()
        .relative()
        .size(32)
        .flex()
        .items_center()
        .justify_center()
        .child(
          svg("mods/orca-assets/folder--orca-sidebar-projects.svg").size(25).text_color(t.accent),
        )
        .child(badge),
    );
}

function AgentGroupCollapsible(
  folder: NativeElement,
  list: NativeElement,
  open: boolean,
  height: number,
  t: RailTheme,
): NativeElement {
  return div()
    .relative()
    .w(SidebarUI.SIDEBAR__WIDTH_PX)
    .flex_none()
    .mb(SidebarUI.GROUP__GAP_PX)
    .child(
      div()
        .absolute()
        .left(SidebarUI.GROUP__LEFT_OFFSET_PX)
        .w(SidebarUI.GROUP__WIDTH_PX)
        .top(0)
        .bottom(0)
        .rounded(SidebarUI.GROUP__RADIUS_PX)
        .bg(t.raised),
    )
    .child(
      v_flex()
        .w(SidebarUI.SIDEBAR__WIDTH_PX)
        .child(folder)
        .child(
          div()
            .relative()
            .w(SidebarUI.SIDEBAR__WIDTH_PX)
            .h(open ? height : 0)
            .overflow_hidden()
            .transition("height", MOTION)
            .opacity(open ? 1 : 0)
            .transition("opacity", MOTION)
            .child(div().relative().w(SidebarUI.SIDEBAR__WIDTH_PX).h(height).overflow_hidden().child(list)),
        ),
    );
}

type RailSwapGroup = "unofficial" | "providers";

// Drag to reorder (like a todo list): grab a row, it follows the pointer, and the other rows slide
// to make room. Release commits the order on screen to the saved "rail.order".
function handleSidebarDragStart(
  owner: RailOwner,
  group: RailSwapGroup,
  key: string,
  pressOffset: number,
  cx: Context,
): void {
  const base = owner.railDisplayed?.[group] ?? [];
  const index = base.indexOf(key);
  if (index < 0) return;
  owner.railDrag = { group, key, base, pressOffset, pointerY: index * SidebarUI.ROW__HEIGHT_PX + pressOffset };
  cx.notify();
}

function handleSidebarDragMove(owner: RailOwner, group: RailSwapGroup, e: MouseMoveEvent, cx: Context): void {
  const drag = owner.railDrag;
  if (!drag || drag.group !== group) return;
  drag.pointerY = e.local_position?.y ?? drag.pointerY;
  cx.notify();
}

function handleSidebarDragEnd(owner: RailOwner, cx: Context): void {
  const drag = owner.railDrag;
  owner.railDrag = null;
  if (drag) {
    const target = dragSlot(drag.pointerY, drag.pressOffset, SidebarUI.ROW__HEIGHT_PX, drag.base.length);
    const next = moveInOrder(drag.base, drag.key, target);
    if (next.some((key, i) => key !== drag.base[i])) {
      persistRailOrder({ ...readRailOrder(), [drag.group]: next });
    }
  }
  cx.notify();
}

// The rows of a draggable group. Each row sits in its slot; the dragged row sits under the pointer
// and is lifted with a shadow, while the others move to the slots the drag order gives them.
function DraggableAgentGroupRows<T>(
  owner: RailOwner,
  group: RailSwapGroup,
  items: readonly T[],
  keyOf: (item: T) => string,
  render: (item: T) => NativeElement,
): NativeElement {
  const drag = owner.railDrag && owner.railDrag.group === group ? owner.railDrag : null;
  const byKey = new Map(items.map((item) => [keyOf(item), item]));
  const keys = drag
    ? moveInOrder(
        drag.base,
        drag.key,
        dragSlot(drag.pointerY, drag.pressOffset, SidebarUI.ROW__HEIGHT_PX, drag.base.length),
      )
    : items.map(keyOf);
  return div()
    .relative()
    .w(SidebarUI.SIDEBAR__WIDTH_PX)
    .h(keys.length * SidebarUI.ROW__HEIGHT_PX)
    .children(
      keys.map((key, slot) => {
        const dragged = drag?.key === key;
        const top = drag && dragged ? drag.pointerY - drag.pressOffset : slot * SidebarUI.ROW__HEIGHT_PX;
        const item = byKey.get(key);
        return div()
          .absolute()
          .left(0)
          .top(top)
          .w(SidebarUI.SIDEBAR__WIDTH_PX)
          .h(SidebarUI.ROW__HEIGHT_PX)
          .when(!dragged, (el) => el.transition("top", MOTION))
          .when(dragged, (el) => el.shadow_lg())
          .on_mouse_down("left", (e, cx) =>
            handleSidebarDragStart(owner, group, key, e.local_position?.y ?? 0, cx),
          )
          .when(item !== undefined, (el) => el.child(render(item!)));
      }),
    );
}

function AgentCategoryGroup(
  owner: RailOwner,
  title: string,
  rows: RailRow[],
  scroll: ScrollHandle,
  t: RailTheme,
): NativeElement {
  const key = title === "Official" ? "officialRailOpen" : "unofficialRailOpen";
  const open = owner[key] !== false;
  const action = `${open ? "Collapse" : "Expand"} ${title}`;
  const medal = title === "Official" ? "🏅" : "🥉";
  const isUnofficial = title === "Unofficial";
  const rowsInGroup = railRows(rows);
  const displayed = isUnofficial
    ? applyRailOrder(rowsInGroup, readRailOrder().unofficial, (row) => row.key)
    : rowsInGroup;
  if (isUnofficial) owner.railDisplayed = { ...owner.railDisplayed, unofficial: displayed.map((row) => row.key) };
  const { height, scroll: overflow } = railViewport(displayed.length);
  const folder = AgentGroupCollapsibleTrigger(
    "am-rail-folder-" + title.toLowerCase(),
    action,
    (cx) => {
      owner[key] = !open;
      cx.notify();
    },
    div().absolute().right(-7).bottom(-6).text_size(20).child(medal),
    t,
  );
  const list = v_flex()
    .id("am-rail-list-" + title.toLowerCase())
    .when(isUnofficial, (el) =>
      el
        .on_mouse_move((e, cx) => handleSidebarDragMove(owner, "unofficial", e, cx))
        .on_mouse_up("left", (_e, cx) => handleSidebarDragEnd(owner, cx)),
    )
    .w(SidebarUI.SIDEBAR__WIDTH_PX)
    .track_scroll(scroll)
    .when(overflow, (inner) => inner.absolute().inset_0().overflow_y_scroll())
    .children(
      isUnofficial
        ? [
            DraggableAgentGroupRows(
              owner,
              "unofficial",
              displayed,
              (row) => row.key,
              (row) => railItem(owner, row, t, t.surface),
            ),
          ]
        : displayed.map((row) => railItem(owner, row, t, t.surface)),
    );
  return AgentGroupCollapsible(folder, list, open, height, t);
}

function ModelProviderGroup(
  owner: RailOwner,
  providers: ProviderRow[],
  t: RailTheme,
): NativeElement {
  const open = owner.providerRailOpen !== false;
  const action = `${open ? "Collapse" : "Expand"} Model providers`;
  const displayed = applyRailOrder(providers, readRailOrder().providers, (provider) => provider.id);
  owner.railDisplayed = { ...owner.railDisplayed, providers: displayed.map((provider) => provider.id) };
  const { height, scroll: overflow } = railViewport(displayed.length + 1);
  const folder = AgentGroupCollapsibleTrigger(
    "am-rail-folder-model-providers",
    action,
    (cx) => {
      owner.providerRailOpen = !open;
      cx.notify();
    },
    div()
      .absolute()
      .right(-7)
      .bottom(-6)
      .size(20)
      .rounded_full()
      .bg(t.raised)
      .border_1()
      .border_color(t.border)
      .flex()
      .items_center()
      .justify_center()
      .child(svg("mods/orca-assets/hard-drive.svg").size(12).text_color(t.muted)),
    t,
  );
  const list = v_flex()
    .id("am-rail-list-model-providers")
    .on_mouse_move((e, cx) => handleSidebarDragMove(owner, "providers", e, cx))
    .on_mouse_up("left", (_e, cx) => handleSidebarDragEnd(owner, cx))
    .w(SidebarUI.SIDEBAR__WIDTH_PX)
    .track_scroll(owner.providerRailScroll)
    .when(overflow, (inner) => inner.absolute().inset_0().overflow_y_scroll())
    .children([
      DraggableAgentGroupRows(
        owner,
        "providers",
        displayed,
        (provider) => provider.id,
        (provider) => providerItem(owner, provider, t),
      ),
    ])
    .child(providerAddItem(owner, t));
  return AgentGroupCollapsible(folder, list, open, height, t);
}

export function railView(
  owner: RailOwner,
  official: RailRow[],
  unofficial: RailRow[],
  providers: ProviderRow[],
  t: RailTheme,
): NativeElement {
  return v_flex()
    .id("am-agent-rail")
    .w(SidebarUI.SIDEBAR__WIDTH_PX)
    .flex_none()
    .min_h(0)
    .bg(t.surface)
    .overflow_y_scrollbar()
    .child(railItem(owner, { key: "global" }, t))
    .child(
      div()
        .w_full()
        .h(12)
        .flex()
        .items_center()
        .justify_center()
        .child(div().w(32).h(2).rounded_full().bg(t.border)),
    )
    .child(AgentCategoryGroup(owner, "Official", official, owner.officialRailScroll, t))
    .child(AgentCategoryGroup(owner, "Unofficial", unofficial, owner.unofficialRailScroll, t))
    .child(
      div()
        .w_full()
        .h(12)
        .flex()
        .items_center()
        .justify_center()
        .child(div().w(32).h(2).rounded_full().bg(t.border)),
    )
    .child(ModelProviderGroup(owner, providers, t));
}
