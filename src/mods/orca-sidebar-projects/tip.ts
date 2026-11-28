import { div, type Color, type Element } from "gpui-kit";
import { v_flex, HoverCard } from "gpui-base";
import { keys, window } from "herdr";

function keyOf(action: string): string {
  const k = keys().find((b) => b.action === action);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  const names: Record<string, string> = mac
    ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" }
    : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias: Record<string, string> = {
    secondary: mac ? "cmd" : "ctrl",
    super: "cmd",
    win: "cmd",
  };
  return k.keys
    .trim()
    .split(/\s+/)
    .map((stroke) => {
      const parts = stroke.split("-");
      let key = parts.pop() ?? "";
      if (key === "") {
        key = "-";
        parts.pop();
      }
      const held = new Set(parts.map((m) => alias[m.toLowerCase()] ?? m.toLowerCase()));
      if (/^[A-Z]$/.test(key)) held.add("shift");
      const label =
        key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
      return [
        ...Object.keys(names)
          .filter((m) => held.has(m))
          .map((m) => names[m]),
        label,
      ].join(mac ? "" : "+");
    })
    .join(" ");
}

export type TipTheme = { border: Color; chrome: Color; foreground: Color; muted: Color };
export type TipOptions = {
  hot: string | null | undefined;
  t: TipTheme;
  id: string;
  label: string;
  trigger: Element;
  action?: string;
  hint?: string;
  below?: boolean;
  delay?: number;
};

export function tip({
  hot,
  t,
  id,
  label,
  trigger,
  action,
  hint,
  below,
  delay = 150,
}: TipOptions): Element {
  const key = action ? keyOf(action) : "";
  return HoverCard.new(`tip-${id}`)
    .anchor(below ? "top_center" : "bottom_center")
    .open_delay(delay)
    .close_delay(0)
    .trigger(trigger)
    .content(
      hot !== id
        ? div()
        : v_flex()
            .when(Boolean(below), (el) => el.mt(4))
            .when(!below, (el) => el.mb(4))
            .px(8)
            .py(4)
            .rounded(6)
            .border(1)
            .border_color(t.border)
            .bg(t.chrome)
            .shadow_md()
            .text_size(12)
            .text_color(t.foreground)
            .child(div().child(key ? `${label} (${key})` : label))
            .when(Boolean(hint), (el) =>
              el.child(
                div()
                  .text_color(t.muted)
                  .child(hint ?? ""),
              ),
            ),
    );
}

export type TipMarkView = { hot?: string | null };
export type TipMarkOptions = {
  id: string;
  label?: string;
  mark: Element;
  action?: string;
  hint?: string;
  below?: boolean;
  delay?: number;
};

export function tipMark(
  view: TipMarkView,
  t: TipTheme,
  { id, label, mark, ...options }: TipMarkOptions,
): Element {
  if (!label) return mark;
  const lit = div()
    .id(id)
    .flex_none()
    .on_hover((on, cx) => {
      if (on) view.hot = id;
      else if (view.hot === id) view.hot = null;
      cx.notify();
    })
    .child(mark);
  return tip({ hot: view.hot, t, id, label, trigger: lit, ...options });
}
