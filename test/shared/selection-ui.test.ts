import { describe, expect, it } from "vite-plus/test";
import { callsOf } from "../stubs/gpui-kit";
import { hoverHighlight, selectedCheck, selectionMark } from "../../src/primitives/selection-ui";

const theme = { hover: "#222222", accent: "#aabbcc", surface: "#ffffff" } as const;

describe("selection UI builders", () => {
  it("sets hover opacity for both pointer states and preserves the theme and radius", () => {
    const hovered = hoverHighlight(true, theme, 6);
    const idle = hoverHighlight(false, theme, 6);

    expect(callsOf(hovered).find(([name]) => name === "opacity")?.[1]).toEqual([1]);
    expect(callsOf(idle).find(([name]) => name === "opacity")?.[1]).toEqual([0]);
    expect(callsOf(hovered).find(([name]) => name === "rounded")?.[1]).toEqual([6]);
    expect(callsOf(hovered).find(([name]) => name === "bg")?.[1]).toEqual([theme.hover]);
    expect(callsOf(hovered).find(([name]) => name === "transition")?.[1]).toEqual([
      "opacity",
      { duration: 200, easing: "ease-out" },
    ]);
  });

  it("adds the themed check icon only for a selected item", () => {
    const unselected = selectedCheck(false, theme);
    const selected = selectedCheck(true, theme);

    const calls = callsOf(selected);

    expect(callsOf(unselected)).toEqual([]);
    expect(calls.map(([name]) => name)).toEqual([
      "absolute",
      "top",
      "right",
      "size",
      "rounded_full",
      "bg",
      "flex",
      "items_center",
      "justify_center",
      "child",
    ]);
    expect(calls.find(([name]) => name === "bg")?.[1]).toEqual([theme.accent]);
    expect(calls.find(([name]) => name === "child")?.[1][0]).toMatchObject({
      name: "svg",
      args: ["mods/orca-assets/check.svg"],
    });
  });

  it("adds the inline marker only for a selected item", () => {
    const unselected = selectionMark(false, theme);
    const selected = selectionMark(true, theme);

    expect(callsOf(unselected).some(([name]) => name === "child")).toBe(false);
    expect(callsOf(selected).find(([name]) => name === "text_color")?.[1]).toEqual([theme.accent]);
    expect(callsOf(selected).find(([name]) => name === "child")?.[1]).toEqual(["✓"]);
  });
});
