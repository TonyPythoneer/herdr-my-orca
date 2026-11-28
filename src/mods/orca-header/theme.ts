import { theme } from "herdr";
import { themeColor } from "../../shared/theme-color.js";
import type { HeaderTheme } from "./types.js";

export function headerTheme(): HeaderTheme {
  const raw = theme();
  return {
    surface: themeColor(raw.surface),
    background: themeColor(raw.background),
    foreground: themeColor(raw.foreground),
    muted: themeColor(raw.muted),
    dim: themeColor(raw.dim),
    popover: themeColor(raw.popover),
    border: themeColor(raw.border),
    solid: themeColor(raw.solid),
    solid_foreground: themeColor(raw.solid_foreground),
    input: themeColor(raw.input),
    raised: themeColor(raw.raised),
    hover: themeColor(raw.hover),
  };
}
