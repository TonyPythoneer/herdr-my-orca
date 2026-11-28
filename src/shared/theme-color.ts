import type { Color } from "gpui-kit";

export function themeColor(token: unknown): Color {
  return token as Color;
}
