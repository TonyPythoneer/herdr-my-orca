import { defineConfig } from "vite-plus";
import { readFileSync } from "node:fs";

const pilot = "tools/vite-plus-pilot";
const delivery = process.env.HERDR_PACK_CANDIDATE === "1";
const inputs: string[] = delivery
  ? JSON.parse(readFileSync(`${pilot}/dist/delivery-entries.json`, "utf8"))
  : [];

export default defineConfig({
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["**/dist/**", "**/node_modules/**"],
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
