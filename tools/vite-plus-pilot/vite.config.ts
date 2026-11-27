import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["dist/**", "node_modules/**"],
  },
  pack: {
    entry: { "list-viewport": "src/list-viewport.ts" },
    format: "esm",
    unbundle: true,
    fixedExtension: false,
    dts: false,
    minify: false,
    outDir: "dist",
    clean: true,
  },
});
