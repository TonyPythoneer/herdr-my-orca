import { describe, expect, it } from "vite-plus/test";
import { div } from "gpui-kit";
import { callsOf } from "../stubs/gpui-kit";
import { DialogButton } from "../../src/primitives/dialog-button";

type Call = ReturnType<typeof callsOf>[number];

const theme = { foreground: "#111111" } as const;

function asElement(value: unknown): object {
  if (typeof value === "object" && value !== null) return value;
  throw new Error("expected an element");
}

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

describe("dialog button source behavior", () => {
  it("builds a plain labeled button with default shape and no hover callback", () => {
    const onClick = () => undefined;
    const button = DialogButton("dialog-cancel", "Cancel", { t: theme, onClick });

    expect(call(button, "id")?.[1]).toEqual(["dialog-cancel"]);
    expect(call(button, "role")?.[1]).toEqual(["button"]);
    expect(call(button, "accessibility_label")?.[1]).toEqual(["Cancel"]);
    expect(call(button, "h")?.[1]).toEqual([32]);
    expect(call(button, "px")?.[1]).toEqual([12]);
    expect(call(button, "rounded")?.[1]).toEqual([6]);
    expect(call(button, "text_size")?.[1]).toEqual([12]);
    expect(call(button, "text_color")?.[1]).toEqual([theme.foreground]);
    expect(call(button, "cursor_pointer")).toBeDefined();
    expect(call(button, "on_click")?.[1]).toEqual([onClick]);
    expect(call(button, "child")?.[1]).toEqual(["Cancel"]);
    expect(call(button, "hover")).toBeUndefined();
  });

  it("uses a custom accessible name and tooltip and adds an icon with default gap", () => {
    const icon = div().id("save-icon");
    const button = DialogButton("dialog-save", "Save", {
      t: theme,
      onClick: () => undefined,
      name: "Save document",
      tooltip: "Save the current document",
      icon,
    });
    const content = asElement(call(button, "child")?.[1][0]);

    expect(call(button, "accessibility_label")?.[1]).toEqual(["Save document"]);
    expect(call(button, "tooltip")?.[1]).toEqual(["Save the current document"]);
    expect(call(content, "gap")?.[1]).toEqual([6]);
    const children = callsOf(content)
      .filter(([name]) => name === "child")
      .map(([, args]) => args[0]);
    expect(children[0]).toBe(icon);
    expect(children[1]).toBe("Save");
  });

  it("preserves custom dimensions, padding, shape, font weight, background, and border", () => {
    const button = DialogButton("dialog-confirm", "Confirm", {
      t: theme,
      onClick: () => undefined,
      h: null,
      py: 5,
      px: 8,
      rounded: null,
      size: 13,
      medium: true,
      bg: "#222222",
      color: "#ffffff",
      border: "#333333",
    });
    const methods = callsOf(button).map(([name]) => name);

    expect(methods).not.toContain("h");
    expect(call(button, "py")?.[1]).toEqual([5]);
    expect(call(button, "px")?.[1]).toEqual([8]);
    expect(methods).not.toContain("rounded");
    expect(call(button, "text_size")?.[1]).toEqual([13]);
    expect(methods).toContain("font_medium");
    expect(call(button, "bg")?.[1]).toEqual(["#222222"]);
    expect(call(button, "border_color")?.[1]).toEqual(["#333333"]);
    expect(call(button, "text_color")?.[1]).toEqual(["#ffffff"]);
  });

  it("omits click handling for disabled buttons while dimming their content", () => {
    const button = DialogButton("dialog-disabled", "Unavailable", {
      t: theme,
      onClick: () => undefined,
      disabled: true,
      tooltip: "Unavailable right now",
      hoverBg: "#444444",
    });

    expect(call(button, "tooltip")?.[1]).toEqual(["Unavailable right now"]);
    expect(call(button, "opacity")?.[1]).toEqual([0.4]);
    expect(call(button, "cursor_pointer")).toBeUndefined();
    expect(call(button, "on_click")).toBeUndefined();
    expect(call(button, "hover")).toBeUndefined();
  });

  it("applies only configured hover background, foreground, and opacity", () => {
    const button = DialogButton("dialog-hover", "Run", {
      t: theme,
      onClick: () => undefined,
      hoverBg: "#555555",
      hoverFg: "#eeeeee",
      hoverOpacity: 0.85,
    });

    expect(hoverCalls(button)).toEqual([
      ["bg", ["#555555"]],
      ["text_color", ["#eeeeee"]],
      ["opacity", [0.85]],
    ]);
  });

  it("supports a custom icon gap and each isolated hover setting", () => {
    const icon = div().id("copy-icon");
    const button = DialogButton("dialog-copy", "Copy", {
      t: theme,
      onClick: () => undefined,
      icon,
      gap: 9,
      hoverBg: null,
      hoverFg: "#dddddd",
      hoverOpacity: null,
    });
    const content = asElement(call(button, "child")?.[1][0]);

    expect(call(content, "gap")?.[1]).toEqual([9]);
    expect(hoverCalls(button)).toEqual([["text_color", ["#dddddd"]]]);
  });

  it("passes explicit null height and radius through without the legacy defaults", () => {
    const button = DialogButton("dialog-bare", "Bare", {
      t: theme,
      onClick: () => undefined,
      h: null,
      rounded: null,
      border: null,
      bg: null,
    });

    expect(call(button, "h")).toBeUndefined();
    expect(call(button, "rounded")).toBeUndefined();
    expect(call(button, "border_1")).toBeUndefined();
    expect(call(button, "bg")).toBeUndefined();
    expect(call(button, "py")).toBeUndefined();
    expect(call(button, "text_color")?.[1]).toEqual([theme.foreground]);
  });

  it("applies the legacy 32-pixel height and 6-pixel radius only when they are omitted", () => {
    const button = DialogButton("dialog-default-shape", "Default shape", {
      t: theme,
      onClick: () => undefined,
    });

    expect(call(button, "h")?.[1]).toEqual([32]);
    expect(call(button, "rounded")?.[1]).toEqual([6]);
  });
});
