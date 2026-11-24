// Quality gates for hand-written code: `eslint -c eslint.config.mjs mods scripts orca-ui` (eslint 9,
// run with npx; nothing is installed in this repo). Generated files are not linted: fix the source,
// then rebuild. Thresholds are the ones the refactor aims at; an exception needs a comment saying why.
import { readFileSync } from "node:fs";

const shared = JSON.parse(readFileSync(new URL("./orca-ui/shared/manifest.json", import.meta.url), "utf8"));
const generated = shared.files.flatMap(f => f.outputs);

export default [{
  files: ["**/*.js", "**/*.mjs"],
  ignores: ["**/*.test.js", "**/*.test.mjs", "artifacts/**", "egm/**", "mods/orca-right-sidebar-header/**", ...generated],
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
  rules: {
    complexity: ["warn", 12],
    "max-depth": ["warn", 4],
    "max-lines-per-function": ["warn", { max: 60, skipBlankLines: true, skipComments: true }],
    "max-params": ["warn", 5],
    "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
    "no-shadow": "warn",
    "no-nested-ternary": "warn",
    "no-else-return": "warn",
    "no-lonely-if": "warn",
    "no-unneeded-ternary": "warn",
    "no-extra-boolean-cast": "warn",
    "no-var": "warn",
    "prefer-const": "warn",
    eqeqeq: ["warn", "always", { null: "ignore" }],
    "no-empty": ["warn", { allowEmptyCatch: true }],
    "no-useless-catch": "warn",
    "no-duplicate-imports": "warn",
  },
}];
