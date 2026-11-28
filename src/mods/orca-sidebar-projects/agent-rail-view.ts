import { div, svg, image, type Color, type Context, type NativeElement } from "gpui-kit";
import { h_flex, v_flex, Link, type ScrollHandle } from "gpui-base";
import { appHome } from "herdr";
import {
  RAIL,
  railGeometry,
  railViewport,
  railRows,
  railControl,
  type RailControl,
  type RailGeometry,
  type RailRow,
} from "./agent-rail.js";
import { hoverHighlight, selectedCheck } from "../../shared/selection-ui.js";

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
const AVATAR_RIGHT = (RAIL.width + RAIL.avatar) / 2;
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

function railState(owner: RailOwner, row: RailRow): RailState {
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
    .w(RAIL.indicatorWidth)
    .flex()
    .items_center()
    .child(
      div()
        .id("am-rail-pill-" + key)
        .w_full()
        .h(g.indicatorHeight)
        .rounded_r(RAIL.indicatorWidth)
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
    .size(RAIL.avatar)
    .rounded(RAIL.avatarRadius)
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
        .rounded(RAIL.avatarRadius)
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
        .when(s.global && owner.litellmEnabled, (el) => el.child(litellmBadge(t))),
    );
}

export function railItem(
  owner: RailOwner,
  row: RailRow,
  t: RailTheme,
  tile: Color = t.raised,
): NativeElement {
  const s = railState(owner, row);
  const control = s.global || row.installed === undefined ? null : railControl(row);
  return div()
    .id("am-rail-" + row.key)
    .relative()
    .w(RAIL.width)
    .h(RAIL.row)
    .flex_none()
    .on_hover(hoverTracker(owner, row.key))
    .child(indicator(row.key, s.geometry, t))
    .child(avatar(owner, row, t, tile, s))
    .child(railAction(owner, row, t, control, s.label));
}

function providerTone(health: string, t: RailTheme): Color {
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
    tone: providerTone(health, t),
    src: iconPath.startsWith(home) ? iconPath.slice(home.length) : iconPath,
  };
}

function providerAvatar(owner: RailOwner, s: ProviderState, t: RailTheme): NativeElement {
  return div()
    .id(`am-rail-select-${s.key}`)
    .absolute()
    .left(s.geometry.avatarLeft)
    .top(s.geometry.avatarTop)
    .size(RAIL.avatar)
    .rounded(RAIL.avatarRadius)
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
        .child(hoverHighlight(s.hovered && !s.selected, t, RAIL.avatarRadius))
        .child(
          s.src
            ? image(s.src).w(28).h(28).rounded(6)
            : svg("mods/orca-assets/hard-drive.svg").size(28).text_color(t.muted),
        )
        .child(selectedCheck(s.selected, t))
        .child(
          div()
            .absolute()
            .left(2)
            .bottom(2)
            .size(11)
            .rounded_full()
            .bg(s.tone)
            .border_2()
            .border_color(t.raised)
            .tooltip(s.label),
        )
        .when(owner.litellmEnabled, (el) => el.child(litellmBadge(t))),
    );
}

function providerItem(owner: RailOwner, provider: ProviderRow, t: RailTheme): NativeElement {
  const s = providerState(owner, provider, t);
  return div()
    .id(`am-rail-${s.key}`)
    .relative()
    .w(RAIL.width)
    .h(RAIL.row)
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
    .w(RAIL.width)
    .h(RAIL.row)
    .flex_none()
    .on_hover(hoverTracker(owner, key))
    .child(
      div()
        .absolute()
        .left(g.indicatorLeft)
        .top(0)
        .bottom(0)
        .w(RAIL.indicatorWidth)
        .flex()
        .items_center()
        .child(
          div()
            .w_full()
            .h(g.indicatorHeight)
            .rounded_r(RAIL.indicatorWidth)
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
        .size(RAIL.avatar)
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

function switchAction(
  owner: RailOwner,
  row: RailRow,
  t: RailTheme,
  checked: boolean,
): NativeElement {
  const hitLeft = AVATAR_RIGHT - (RAIL.hitWidth + RAIL.switchWidth) / 2;
  return div()
    .id("am-rail-toggle-" + row.key)
    .absolute()
    .left(hitLeft)
    .top(33)
    .w(RAIL.hitWidth)
    .h(RAIL.hitHeight)
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
        .w(RAIL.switchWidth)
        .h(RAIL.switchHeight)
        .rounded_full()
        .bg(checked ? t.accent : t.ring)
        .border_1()
        .border_color(checked ? t.accent : t.ring)
        .hover((s) => s.border_color(t.foreground))
        .child(
          div()
            .absolute()
            .top(2)
            .left(checked ? RAIL.switchWidth - 15 : 2)
            .size(11)
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
  if (control?.kind === "switch") return switchAction(owner, row, t, control.checked);
  if (control?.kind === "install") return installAction(owner, row, t);
  return div().size(0);
}

function folderTile(
  id: string,
  action: string,
  toggle: (cx: Context) => void,
  badge: NativeElement,
  t: RailTheme,
): NativeElement {
  return div()
    .id(id)
    .relative()
    .w(RAIL.width)
    .h(RAIL.row)
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

function groupShell(
  folder: NativeElement,
  list: NativeElement,
  open: boolean,
  height: number,
  t: RailTheme,
): NativeElement {
  return div()
    .relative()
    .w(RAIL.width)
    .flex_none()
    .mb(RAIL.groupGap)
    .child(
      div()
        .absolute()
        .left(RAIL.groupLeft)
        .w(RAIL.groupWidth)
        .top(0)
        .bottom(0)
        .rounded(RAIL.groupRadius)
        .bg(t.raised),
    )
    .child(
      v_flex()
        .w(RAIL.width)
        .child(folder)
        .child(
          div()
            .relative()
            .w(RAIL.width)
            .h(open ? height : 0)
            .overflow_hidden()
            .transition("height", MOTION)
            .opacity(open ? 1 : 0)
            .transition("opacity", MOTION)
            .child(div().relative().w(RAIL.width).h(height).overflow_hidden().child(list)),
        ),
    );
}

function groupView(
  owner: RailOwner,
  title: string,
  rows: RailRow[],
  scroll: ScrollHandle,
  t: RailTheme,
): NativeElement {
  const key = title === "Official" ? "officialRailOpen" : "unofficialRailOpen";
  const open = owner[key] !== false;
  const action = `${open ? "Collapse" : "Expand"} ${title}`;
  const medal = title === "Official" ? "🥇" : "🥉";
  const { height, scroll: overflow } = railViewport(rows.length);
  const folder = folderTile(
    "am-rail-folder-" + title.toLowerCase(),
    action,
    (cx) => {
      owner[key] = !open;
      cx.notify();
    },
    div().absolute().right(-7).bottom(-6).text_size(14).child(medal),
    t,
  );
  const list = v_flex()
    .id("am-rail-list-" + title.toLowerCase())
    .w(RAIL.width)
    .track_scroll(scroll)
    .when(overflow, (inner) => inner.absolute().inset_0().overflow_y_scroll())
    .children(railRows(rows).map((row) => railItem(owner, row, t, t.surface)));
  return groupShell(folder, list, open, height, t);
}

function providerGroupView(
  owner: RailOwner,
  providers: ProviderRow[],
  t: RailTheme,
): NativeElement {
  const open = owner.providerRailOpen !== false;
  const action = `${open ? "Collapse" : "Expand"} Model providers`;
  const { height, scroll: overflow } = railViewport(providers.length + 1);
  const folder = folderTile(
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
    .w(RAIL.width)
    .track_scroll(owner.providerRailScroll)
    .when(overflow, (inner) => inner.absolute().inset_0().overflow_y_scroll())
    .children(providers.map((provider) => providerItem(owner, provider, t)))
    .child(providerAddItem(owner, t));
  return groupShell(folder, list, open, height, t);
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
    .w(RAIL.width)
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
    .child(groupView(owner, "Official", official, owner.officialRailScroll, t))
    .child(groupView(owner, "Unofficial", unofficial, owner.unofficialRailScroll, t))
    .child(
      div()
        .w_full()
        .h(12)
        .flex()
        .items_center()
        .justify_center()
        .child(div().w(32).h(2).rounded_full().bg(t.border)),
    )
    .child(providerGroupView(owner, providers, t));
}
