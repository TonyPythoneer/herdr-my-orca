import { describe, expect, it } from "vite-plus/test";
import {
  assertPlaceholderImports,
  assertStatusPortsImports,
  compareExports,
  compareValue,
  compareViewport,
  isDirectEntry,
  runPiProviderContract,
  typedManifestRows,
} from "../../src/tooling/verify-output.ts";

describe("verifier manifest row selection", () => {
  it("keeps only TypeScript sources and preserves their order", () => {
    const files = [
      { source: "src/shared/first.ts", outputs: ["mods/a/first.js"] },
      { source: "orca-ui/shared/second.js", outputs: ["mods/a/second.js"] },
      { source: "src/shared/third.ts", outputs: ["mods/a/third.js"] },
    ];
    expect(typedManifestRows(files).map(({ source }) => source)).toEqual([
      "src/shared/first.ts",
      "src/shared/third.ts",
    ]);
  });

  it("keeps each output row for shared TypeScript sources and build-entry sources", () => {
    const files = [
      {
        source: "src/primitives/list-viewport.ts",
        outputs: ["mods/a/list-viewport.js", "mods/b/list-viewport.js"],
      },
      {
        source: "src/mods/orca-sidebar-projects/worktree-plan.ts",
        outputs: ["mods/orca-sidebar-projects/worktree-plan.js"],
      },
      { source: "orca-ui/shared/legacy.js", outputs: ["mods/a/legacy.js"] },
    ];
    expect(typedManifestRows(files)).toEqual(files.slice(0, 2));
  });

  it("does not resolve a missing argv path in the direct-entry guard", () => {
    expect(isDirectEntry("/missing/verify-output.ts", "/missing/verify-output.ts")).toBe(false);
    expect(isDirectEntry(undefined, "/missing/verify-output.ts")).toBe(false);
  });
});

describe("verifier output comparisons", () => {
  it("accepts modules with the same exports, function names, arrays and nested objects", () => {
    const original = {
      flag: true,
      list: [1, { deep: "value" }],
      named: function compute(value: number) {
        return value;
      },
    };
    const copy = {
      flag: true,
      list: [1, { deep: "value" }],
      named: function compute(value: number) {
        return value * 2;
      },
    };
    expect(() => compareExports(copy, original, "copy")).not.toThrow();
  });

  it("reports a missing export or a renamed function with the comparison label", () => {
    expect(() => compareExports({ alpha: 1 }, { alpha: 1, beta: 2 }, "copy")).toThrow(/copy/);
    expect(() =>
      compareValue({ fn: function renamed() {} }, { fn: function original() {} }, "value"),
    ).toThrow(/value\.fn/);
  });

  it("rejects array length, object shape, wrapper and primitive drift", () => {
    expect(() => compareValue([1], [1, 2], "value")).toThrow(/value/);
    expect(() => compareValue({ extra: true }, { expected: true }, "value")).toThrow(/value/);
    expect(() => compareValue("text", { expected: true }, "value")).toThrow(/value/);
    expect(() => compareValue({ fn: 1 }, { fn: function original() {} }, "value")).toThrow(
      /value\.fn/,
    );
    expect(() => compareValue("other", "text", "value")).toThrow(/value/);
  });

  function viewport(overrides: Record<string, unknown> = {}) {
    return {
      ROW: 29,
      FULL_ROWS: 3,
      VISIBLE_ROWS: 2,
      scrolls: (count: number) => Math.max(0, count - 3),
      viewportHeight: (count: number, height: number, gap = 0) => count * height + gap,
      ...overrides,
    };
  }

  it("compares viewport constants, scroll counts and geometry across all probed sizes", () => {
    expect(() => compareViewport(viewport(), viewport(), "viewport")).not.toThrow();
    expect(() => compareViewport(viewport({ ROW: 1 }), viewport(), "viewport")).toThrow(/viewport/);
    expect(() =>
      compareViewport(viewport({ scrolls: (count: number) => count }), viewport(), "viewport"),
    ).toThrow(/viewport/);
    expect(() =>
      compareViewport(
        viewport({ viewportHeight: (count: number, height: number) => count + height }),
        viewport(),
        "viewport",
      ),
    ).toThrow(/viewport/);
  });
});

describe("generated import assertions", () => {
  it("requires the placeholder output to import only its mod-local panel motion helper", () => {
    const imports = [
      'import { panelFrame } from "./panel-motion.js";',
      'import { props, theme } from "herdr";',
      'import { View, div, svg } from "gpui-kit";',
      'import { v_flex } from "gpui-base";',
    ].join("\n");
    expect(() => assertPlaceholderImports(imports)).not.toThrow();
    expect(() => assertPlaceholderImports("const slide = 1;\n")).toThrow(/placeholder import/);
    expect(() =>
      assertPlaceholderImports(
        `${imports}\nimport { shared } from "../../shared/panel-motion.js";`,
      ),
    ).toThrow(/source tree/);
  });

  it("requires status port outputs to import every mod-local helper and no source tree file", () => {
    const local = [
      'import { PANEL, addressForPort, buildPorts } from "./scan.js";',
      'import { copyText } from "./clip.js";',
      'import { IconButton } from "./icon-button.js";',
      'import { exec, notify, openOverlay, props, run } from "herdr";',
      'import { View, div, svg } from "gpui-kit";',
      'import { h_flex, v_flex } from "gpui-base";',
    ].join("\n");
    expect(() => assertStatusPortsImports(local)).not.toThrow();
    expect(() => assertStatusPortsImports(local.replace("./clip.js", "../shared/clip.js"))).toThrow(
      /mod-local clip.js/,
    );
    expect(() =>
      assertStatusPortsImports(`${local}\nimport { extra } from "../shared/extra.js";`),
    ).toThrow(/source tree/);
  });
});

function registerExpectedProvider(host: {
  registerProvider: (name: string, config: unknown) => void;
}) {
  host.registerProvider("herdr", {
    baseUrl: "https://models.example/v1",
    api: "openai-completions",
    apiKey: "test-key",
    models: [
      {
        id: "herdr/model-a",
        name: "herdr/model-a",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 8192,
      },
    ],
  });
}

describe("Pi provider contract", () => {
  it("registers the configured provider and restores replaced environment values", () => {
    const previous = process.env.HERDR_PI_MODELS;
    process.env.HERDR_PI_MODELS = "sentinel";
    try {
      const providers = runPiProviderContract(registerExpectedProvider);
      expect(providers).toHaveLength(1);
      expect(providers[0][0]).toBe("herdr");
      expect(process.env.HERDR_PI_MODELS).toBe("sentinel");
    } finally {
      if (previous === undefined) delete process.env.HERDR_PI_MODELS;
      else process.env.HERDR_PI_MODELS = previous;
    }
  });

  it("rejects a provider that registers a different shape", () => {
    expect(() => runPiProviderContract((host) => host.registerProvider("other", {}))).toThrow(
      /Pi provider output contract/,
    );
  });

  it("restores absent environment values when the provider throws", () => {
    delete process.env.HERDR_PROVIDER_API_KEY;
    expect(() =>
      runPiProviderContract(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(process.env.HERDR_PROVIDER_API_KEY).toBeUndefined();
  });
});
