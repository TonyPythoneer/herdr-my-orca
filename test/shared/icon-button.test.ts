import { describe, expect, it } from "vite-plus/test";
import { div } from "gpui-kit";
import { callsOf } from "../stubs/gpui-kit";
import { IconButton } from "../../src/primitives/icon-button";

type Call = ReturnType<typeof callsOf>[number];

const theme = {
  muted: "#111111",
  hover: "#222222",
  foreground: "#333333",
  background: "#444444",
  dim: "#555555",
} as const;

function call(element: object, name: string): Call | undefined {
  return callsOf(element).find(([method]) => method === name);
}

function isHoverCallback(value: unknown): value is (style: object) => unknown {
  return typeof value === "function";
}

function hoverCalls(element: object): Call[] {
  const callback = call(element, "hover")?.[1][0];
  if (!isHoverCallback(callback)) return [];
  const style = div();
  callback(style);
  return callsOf(style);
}

describe("icon button source behavior", () => {
  it("builds a labeled button with default frame, tooltip, click handler, and glyph", () => {
    const onClick = () => undefined;
    const glyph = div().id("glyph");
    const button = IconButton("icon-refresh", "Refresh", glyph, {
      t: theme,
      onClick,
      tooltip: "Refresh now",
    });

    expect(call(button, "id")?.[1]).toEqual(["icon-refresh"]);
    expect(call(button, "size")?.[1]).toEqual([24]);
    expect(call(button, "rounded")?.[1]).toEqual([6]);
    expect(call(button, "role")?.[1]).toEqual(["button"]);
    expect(call(button, "accessibility_label")?.[1]).toEqual(["Refresh"]);
    expect(call(button, "tooltip")?.[1]).toEqual(["Refresh now"]);
    expect(call(button, "on_click")?.[1]).toEqual([onClick]);
    expect(call(button, "child")?.[1][0]).toBe(glyph);
    expect(call(button, "cursor_pointer")).toBeDefined();
    expect(call(button, "text_color")?.[1]).toEqual([theme.muted]);
    expect(hoverCalls(button)).toEqual([
      ["bg", [theme.hover]],
      ["text_color", [theme.foreground]],
    ]);
  });

  it("uses explicit width and full height while applying optional border, fill, text size, and full rounding", () => {
    const button = IconButton("icon-close", "Close", "×", {
      t: theme,
      onClick: () => undefined,
      w: 32,
      h: "full",
      radius: "full",
      border: "#666666",
      bg: "#777777",
      textSize: 14,
      tooltip: "",
    });
    const methods = callsOf(button).map(([name]) => name);

    expect(methods).toContain("w");
    expect(call(button, "w")?.[1]).toEqual([32]);
    expect(methods).toContain("h_full");
    expect(methods).toContain("rounded_full");
    expect(call(button, "border_color")?.[1]).toEqual(["#666666"]);
    expect(call(button, "bg")?.[1]).toEqual(["#777777"]);
    expect(call(button, "text_size")?.[1]).toEqual([14]);
    expect(call(button, "tooltip")).toBeUndefined();
  });

  it("keeps active styling ahead of disabled styling and avoids hover behavior", () => {
    const button = IconButton("icon-active", "Active", "✓", {
      t: theme,
      onClick: () => undefined,
      active: true,
      disabled: true,
    });

    expect(call(button, "bg")?.[1]).toEqual([theme.foreground]);
    expect(call(button, "text_color")?.[1]).toEqual([theme.background]);
    expect(call(button, "cursor_pointer")).toBeUndefined();
    expect(call(button, "hover")).toBeUndefined();
    expect(call(button, "on_click")).toBeDefined();
  });

  it("dims disabled buttons without adding a hover style or pointer cursor", () => {
    const button = IconButton("icon-disabled", "Unavailable", "×", {
      t: theme,
      onClick: () => undefined,
      disabled: true,
      hoverBg: "#888888",
    });

    expect(call(button, "text_color")?.[1]).toEqual([theme.dim]);
    expect(call(button, "cursor_pointer")).toBeUndefined();
    expect(call(button, "hover")).toBeUndefined();
    expect(call(button, "on_click")).toBeDefined();
  });

  it("allows suppressing only the hover background while retaining the hover foreground", () => {
    const button = IconButton("icon-transparent", "Transparent", "○", {
      t: theme,
      onClick: () => undefined,
      color: "#999999",
      hoverBg: null,
      hoverFg: "#aaaaaa",
    });

    expect(call(button, "text_color")?.[1]).toEqual(["#999999"]);
    expect(hoverCalls(button)).toEqual([["text_color", ["#aaaaaa"]]]);
  });

  it("passes a null height through to a width-only box as the legacy source did", () => {
    const button = IconButton("icon-wide", "Wide", "▭", {
      t: theme,
      onClick: () => undefined,
      w: 40,
    });

    expect(call(button, "w")?.[1]).toEqual([40]);
    expect(call(button, "h")?.[1]).toEqual([null]);
    expect(call(button, "h_full")).toBeUndefined();
    expect(call(button, "size")).toBeUndefined();
  });

  it("sizes a square box from the explicit size and omits the width and height calls", () => {
    const button = IconButton("icon-square", "Square", "□", {
      t: theme,
      onClick: () => undefined,
      size: 16,
    });

    expect(call(button, "size")?.[1]).toEqual([16]);
    expect(call(button, "w")).toBeUndefined();
    expect(call(button, "h")).toBeUndefined();
  });

  it("keeps the square corners when radius is null and never adds the rounded default", () => {
    const button = IconButton("icon-square-corners", "Square corners", "□", {
      t: theme,
      onClick: () => undefined,
      radius: null,
    });

    expect(call(button, "rounded")).toBeUndefined();
    expect(call(button, "rounded_full")).toBeUndefined();
  });

  it("adds no tooltip for an omitted or empty tooltip and no outline calls for null outline values", () => {
    const button = IconButton("icon-plain", "Plain", "·", {
      t: theme,
      onClick: () => undefined,
      tooltip: undefined,
      border: null,
      bg: null,
      textSize: null,
    });

    expect(call(button, "tooltip")).toBeUndefined();
    expect(call(button, "border_1")).toBeUndefined();
    expect(call(button, "border_color")).toBeUndefined();
    expect(call(button, "text_size")).toBeUndefined();
    expect(call(button, "bg")).toBeUndefined();
  });
});
