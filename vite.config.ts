import { defineConfig } from "vite-plus";
import { fileURLToPath } from "node:url";
import { loadManifests } from "./src/tooling/orca-ui-manifests.ts";
import { packModLocalImportsPlugin } from "./src/tooling/pack-mod-local-imports.js";

type TypedBuildRow = { source: string; packId?: string };
type ManifestSet = {
  shared: { files: { outputs: string[] }[] };
  entries: { entries: { output: string }[] };
  table: Map<string, TypedBuildRow>;
};

const manifests = loadManifests() as ManifestSet;
const generated = [
  ...manifests.shared.files.flatMap((file) => file.outputs),
  ...manifests.entries.entries.map((entry) => entry.output),
];
const generatedRuntime = [...manifests.table.keys()].filter((path) =>
  /\.(?:js|mjs|cjs)$/.test(path),
);
const entries = Object.fromEntries(
  [...manifests.table.values()]
    .filter(
      (row): row is TypedBuildRow & { packId: string } =>
        row.source.endsWith(".ts") && typeof row.packId === "string",
    )
    .map(({ source, packId }) => [packId, source]),
);
const metricsMode = process.env.ORCA_COVERAGE_MODE === "metrics";

export default defineConfig({
  lint: {
    categories: { correctness: "off" },
    rules: {
      "eslint/complexity": ["warn", 12],
      "eslint/max-depth": ["warn", 4],
      "eslint/max-lines-per-function": [
        "warn",
        { max: 60, skipBlankLines: true, skipComments: true },
      ],
      "eslint/max-params": ["warn", 5],
      "eslint/no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
      "eslint/no-shadow": "warn",
      "eslint/no-nested-ternary": "warn",
      "eslint/no-else-return": "warn",
      "eslint/no-lonely-if": "warn",
      "eslint/no-unneeded-ternary": "warn",
      "eslint/no-extra-boolean-cast": "warn",
      "eslint/no-var": "warn",
      "eslint/prefer-const": "warn",
      "eslint/eqeqeq": ["warn", "always", { null: "ignore" }],
      "eslint/no-empty": ["warn", { allowEmptyCatch: true }],
      "eslint/no-useless-catch": "warn",
      "eslint/no-duplicate-imports": "warn",
    },
    ignorePatterns: [
      "**/*.test.js",
      "**/*.test.mjs",
      "**/*.test.ts",
      "**/*.test.mts",
      "artifacts/**",
      "egm/**",
      "mods/orca-right-sidebar-header/**",
      "**/dist/**",
      "**/node_modules/**",
      ...generated,
    ],
  },
  pack: {
    entry: entries,
    format: "esm",
    unbundle: true,
    plugins: [
      packModLocalImportsPlugin({
        rows: [...manifests.table],
        root: fileURLToPath(new URL(".", import.meta.url)),
      }),
    ],
    fixedExtension: false,
    dts: false,
    minify: false,
    outDir: "tools/vite-plus-pilot/dist/typed",
    clean: true,
  },
  test: {
    include: metricsMode
      ? ["test/**/*.test.ts"]
      : ["test/**/*.test.ts"],
    testTimeout: metricsMode ? 60_000 : undefined,
    alias: {
      "gpui-kit": new URL("./test/stubs/gpui-kit.ts", import.meta.url).pathname,
      "gpui-base": new URL("./test/stubs/gpui-base.ts", import.meta.url).pathname,
      herdr: new URL("./test/stubs/herdr.ts", import.meta.url).pathname,
    },
    coverage: {
      reporter: ["json-summary"],
      autoAttachSubprocess: true,
      include: metricsMode
        ? [
            "mods/**/*.{js,mjs,cjs}",
            "orca-ui/**/*.{js,mjs,cjs}",
            "scripts/**/*.{js,mjs,cjs}",
            "src/**/*.{js,mjs,cjs,ts,mts,cts}",
            "tools/**/*.{js,mjs,cjs}",
          ]
        : ["src/**/*.ts"],
      exclude: [
        "**/*.test.*",
        "**/flow-harness.mjs",
        "**/golden.mjs",
        "**/dist/**",
        "**/node_modules/**",
        "test/**",
        "types/**",
        ...generatedRuntime,
      ],
    },
  },
});
