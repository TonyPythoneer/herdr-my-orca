import { defineConfig } from "vite-plus";
import { readFileSync } from "node:fs";

const shared: { files: { outputs: string[] }[] } = JSON.parse(
  readFileSync(new URL("./orca-ui/shared/manifest.json", import.meta.url), "utf8"),
);
const generated = shared.files.flatMap((file) => file.outputs);

const pilot = "tools/vite-plus-pilot";
const delivery = process.env.HERDR_PACK_CANDIDATE === "1";
const inputs: string[] = delivery
  ? JSON.parse(readFileSync(`${pilot}/dist/delivery-entries.json`, "utf8"))
  : [];

export default defineConfig({
  lint: {
    // Same quality thresholds and generated-file exclusions as the legacy gate.
    categories: { correctness: "off" },
    rules: {
      "eslint/complexity": ["warn", 12],
      "eslint/max-depth": ["warn", 4],
      "eslint/max-lines-per-function": ["warn", { max: 60, skipBlankLines: true, skipComments: true }],
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
    ignorePatterns: ["**/*.test.js", "**/*.test.mjs", "**/*.test.ts", "**/*.test.mts", "artifacts/**", "egm/**", "mods/orca-right-sidebar-header/**", "**/dist/**", "**/node_modules/**", ...generated],
  },
  pack: {
    entry: delivery ? inputs : { "list-viewport": `${pilot}/src/list-viewport.ts` },
    ...(delivery ? { root: `${pilot}/dist/delivery-input`, deps: { neverBundle: true }, treeshake: false } : {}),
    format: "esm",
    unbundle: true,
    fixedExtension: false,
    dts: false,
    minify: false,
    outDir: delivery ? `${pilot}/dist/delivery-compiled` : `${pilot}/dist`,
    clean: !delivery,
  },
  test: { include: [`${pilot}/test/**/*.test.ts`] },
});
