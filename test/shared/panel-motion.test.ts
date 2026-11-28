import { describe, it } from "vite-plus/test";
import assert from "node:assert/strict";
import { div } from "gpui-kit";
import { panelFrame } from "../../src/components/right-sidebar/panel-motion";
import { callsOf } from "../stubs/gpui-kit";

type Call = ReturnType<typeof callsOf>[number];

type TestGlobal = {
  __herdrProps?: () => unknown;
  __herdrLayout?: () => unknown;
  __herdrShared?: (key: string) => unknown;
  __herdrTheme?: () => Record<string, string>;
};

const host: TestGlobal = globalThis;

function configure(open: unknown, layout: unknown, overlay = false, surface = "#112233") {
  host.__herdrProps = () => ({ overlay });
  host.__herdrShared = (key) => (key === "panel.openPx" ? open : undefined);
  host.__herdrLayout = () => layout;
  host.__herdrTheme = () => ({ surface });
}

function clearConfiguration() {
  delete host.__herdrProps;
  delete host.__herdrShared;
  delete host.__herdrLayout;
  delete host.__herdrTheme;
}

function asElement(value: unknown): object {
  if (typeof value === "object" && value !== null) return value;
  throw new Error("expected an element");
}

function call(element: object, name: string): Call | undefined {
  return callsOf(element).find(([method]) => method === name);
}

describe("panel motion source behavior", () => {
  it("keeps popup overlays out of the panel animation wrapper", () => {
    const inner = div().id("inner");
    configure(240, { id: "panel", size: { px: 80 } }, true);
    try {
      assert.deepEqual(panelFrame(inner), inner);
      assert.deepEqual(
        callsOf(inner).map(([name]) => name),
        ["id"],
      );
    } finally {
      clearConfiguration();
    }
  });

  it("leaves the content unchanged when panel measurements are absent, invalid, or settled", () => {
    const inner = div().id("inner");
    const cases: Array<[unknown, unknown]> = [
      [undefined, { id: "panel", size: { px: 80 } }],
      [0, { id: "panel", size: { px: 80 } }],
      [240, null],
      [240, { id: "container", children: [{ id: "other", size: { px: 80 } }] }],
      [240, { id: "panel", size: { px: 0 } }],
      [240, { id: "panel", size: { px: 239.5 } }],
    ];
    try {
      for (const [open, layout] of cases) {
        configure(open, layout);
        assert.deepEqual(panelFrame(inner), inner);
      }
    } finally {
      clearConfiguration();
    }
  });

  it("compares a string panel width with JavaScript coercion as the legacy source did", () => {
    const inner = div().id("inner");
    configure(240, { id: "panel", size: { px: "80" } });
    try {
      const frame = panelFrame(inner);
      assert.notEqual(frame, inner);
      const children = callsOf(frame)
        .filter(([name]) => name === "child")
        .map(([, args]) => asElement(args[0]));
      assert.equal(call(children[0], "w")?.[1][0], 240);
      assert.equal(call(children[0], "child")?.[1][0], inner);
    } finally {
      clearConfiguration();
    }
  });

  it("wraps a nested partial panel and computes the cover color and offset", () => {
    const inner = div().id("inner");
    configure(200, {
      id: "window",
      children: [{ id: "sidebar", children: [{ id: "panel", size: { px: 100 } }] }],
    });
    try {
      const frame = panelFrame(inner);
      assert.notEqual(frame, inner);
      assert.deepEqual(
        callsOf(frame).map(([name]) => name),
        ["size_full", "overflow_hidden", "relative", "child", "child"],
      );
      const children = callsOf(frame)
        .filter(([name]) => name === "child")
        .map(([, args]) => asElement(args[0]));
      const animatedPanel = children[0];
      const cover = children[1];
      assert.equal(call(animatedPanel, "w")?.[1][0], 200);
      assert.equal(call(animatedPanel, "left")?.[1][0], -86);
      assert.equal(call(animatedPanel, "child")?.[1][0], inner);
      assert.equal(call(cover, "bg")?.[1][0], "#11223396");
    } finally {
      clearConfiguration();
    }
  });

  it("appends cover alpha to uppercase hex surfaces and passes other theme strings through", () => {
    for (const [surface, expected] of [
      ["#AbCdEf", "#AbCdEf96"],
      ["#abc", "#abc"],
      ["", ""],
    ] as const) {
      const inner = div().id("inner");
      configure(200, { id: "panel", size: { px: 100 } }, false, surface);
      try {
        const cover = asElement(
          callsOf(panelFrame(inner)).filter(([name]) => name === "child")[1]?.[1][0],
        );
        assert.equal(call(cover, "bg")?.[1][0], expected);
      } finally {
        clearConfiguration();
      }
    }
  });

  it("preserves non-hex theme colors instead of appending alpha bytes", () => {
    const inner = div().id("inner");
    configure(200, { id: "panel", size: { px: 100 } }, false, "var(--surface)");
    try {
      const frame = panelFrame(inner);
      const cover = asElement(callsOf(frame).filter(([name]) => name === "child")[1]?.[1][0]);
      assert.equal(call(cover, "bg")?.[1][0], "var(--surface)");
    } finally {
      clearConfiguration();
    }
  });
});
