import { div, svg, image, type Color, type NativeElement } from "gpui-kit";
import { h_flex, v_flex, type ColorTokens } from "gpui-base";
import { settings } from "herdr";
import { themeColor } from "../../shared/theme-color.js";
import { LIST_HEADER_HEIGHT } from "./state.js";
import { PERMISSION_SHORT_LABELS, type StoredPermission } from "./permissions.js";
import { IconButton } from "../../primitives/icon-button.js";

export type PartsTheme = Pick<
  ColorTokens,
  "muted" | "border" | "accent" | "foreground" | "background" | "surface" | "input" | "ring"
> & {
  blocked: Color;
  hover: Color;
  raised: Color;
  dim: Color;
  popover: Color;
  done: Color;
};

export const monoFont = (): string => String(settings()?.font_family ?? "JetBrains Mono");

export function badge(
  text: string,
  t: PartsTheme,
  options: { color?: Color; bg?: string | null; border?: boolean },
): NativeElement {
  const color = options.color ?? themeColor(t.muted);
  const bg = options.bg ?? null;
  return div()
    .h(18)
    .px(6)
    .flex_none()
    .flex()
    .items_center()
    .rounded(4)
    .bg(bg === null ? themeColor(t.muted) : themeColor(bg as Color))
    .when(options.border === true, (el) => el.border_1().border_color(themeColor(t.border)))
    .text_size(10)
    .font_medium()
    .text_color(color)
    .child(text);
}

export function icon(
  row: { icon?: string; tint?: boolean; name?: string },
  size: number,
  t: PartsTheme,
): NativeElement {
  if (row.icon) {
    const iconPath: string = row.icon;
    if (row.tint) return svg(iconPath).size(size).flex_none().text_color(themeColor(t.muted));
    return image(iconPath).w(size).h(size).flex_none().rounded(3);
  }
  return div()
    .size(size)
    .flex_none()
    .rounded(3)
    .bg(themeColor(t.raised))
    .flex()
    .items_center()
    .justify_center()
    .text_size(Math.round(size * 0.55))
    .text_color(themeColor(t.muted))
    .child((row.name ?? "?").slice(0, 1).toUpperCase());
}

export function permissionBadge(choice: string, t: PartsTheme): NativeElement {
  return badge(PERMISSION_SHORT_LABELS[choice as StoredPermission] ?? "Custom", t, {
    color: choice === "full-access" ? themeColor(t.blocked) : themeColor(t.muted),
    border: true,
  });
}

export function section(
  title: string,
  count: number | string,
  t: PartsTheme,
  note?: string,
  muted = false,
): NativeElement {
  return h_flex()
    .w_full()
    .items_center()
    .h(LIST_HEADER_HEIGHT)
    .gap(8)
    .pt(0)
    .pb(0)
    .child(
      div()
        .text_size(13)
        .font_semibold()
        .text_color(muted ? themeColor(t.muted) : themeColor(t.foreground))
        .child(title),
    )
    .child(
      badge(String(count), t, {
        border: true,
        color: muted ? themeColor(t.muted) : themeColor(t.accent),
      }),
    )
    .when(note !== undefined, (el) =>
      el.child(
        div()
          .text_size(11)
          .text_color(themeColor(t.dim))
          .child(note as string),
      ),
    )
    .child(div().flex_1());
}

export function banner(
  text: string,
  t: PartsTheme,
  options: { border?: Color | null; bg?: string | null; color?: Color | null; actions?: unknown },
): NativeElement {
  const borderColor = options.border ?? themeColor(t.blocked);
  const bgColor = options.bg === null ? themeColor(t.muted) : themeColor(options.bg as Color);
  return h_flex()
    .w_full()
    .gap(8)
    .p(10)
    .rounded(8)
    .border_1()
    .border_color(borderColor)
    .bg(bgColor)
    .items_start()
    .child(
      div()
        .flex_none()
        .text_size(12)
        .text_color(options.color ?? themeColor(t.blocked))
        .child("!"),
    )
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .gap(4)
        .child(
          div()
            .text_size(12)
            .text_color(options.color ?? themeColor(t.blocked))
            .child(text),
        )
        .when(options.actions !== undefined, (el) => el.child(options.actions as NativeElement)),
    );
}

export function empty(text: string, t: PartsTheme): NativeElement {
  return div()
    .w_full()
    .p(16)
    .rounded(8)
    .border_1()
    .border_color(themeColor(t.border))
    .border_dashed()
    .text_size(12)
    .text_color(themeColor(t.muted))
    .child(text);
}

export function group(title: string, note: string, t: PartsTheme): NativeElement {
  return v_flex()
    .w_full()
    .pt(14)
    .pb(2)
    .gap(2)
    .child(div().text_size(15).font_semibold().text_color(themeColor(t.foreground)).child(title))
    .child(div().text_size(11).text_color(themeColor(t.dim)).child(note));
}

export function backButton(t: PartsTheme, onClick: unknown): NativeElement {
  return IconButton(
    "am-back",
    "Back to terminals",
    svg("mods/orca-assets/chevron-left--orca-agent-settings.svg").size(16),
    { t, size: 28, tooltip: "Back to terminals", onClick } as unknown as Parameters<
      typeof IconButton
    >[3],
  );
}
