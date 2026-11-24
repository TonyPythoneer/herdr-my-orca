// Golden render of the landing page: with and without projects, with and without key bindings.
// Handlers are recorded by name ("fn"). Set GOLDEN_DUMP=<dir> to write the full text.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { register, registerHooks } from "node:module";

register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
registerHooks({ resolve(name, context, next) {
  const result = next(name, context);
  if (name !== "herdr") return result;
  const source = `export * from ${JSON.stringify(result.url)};
    export const keys = () => globalThis.host.keys;`;
  return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
} });
const { default: Landing } = await import("./main.js");

const THEME = Object.fromEntries(["foreground", "muted", "border", "canvas"].map((key, i) => [key, `#${i}${i}${i}${i}${i}${i}`]));
const BINDINGS = [{ action: "space.new", keys: "Ctrl + Shift + N" }, { action: "space.prev", keys: "Alt+Up" }, { action: "space.next", keys: 7 }];
const SCENARIOS = [
  ["no projects, no bindings", { keys: undefined, spaces: undefined }],
  ["no projects, bindings", { keys: BINDINGS, spaces: [] }],
  ["projects, bindings", { keys: BINDINGS, spaces: [{ id: "s" }] }],
  ["projects, partial bindings", { keys: [BINDINGS[1]], spaces: [{ id: "s" }] }],
];

const GOLDEN = "ea9782c31d4e661fdf20d76b73da14974b630011b85b41a94c582274b0a53425";

test("golden render of the landing page", () => {
  globalThis.__herdrTheme = () => THEME;
  const text = SCENARIOS.map(([name, o]) => {
    globalThis.host = { keys: o.keys };
    globalThis.__herdrSpaces = () => o.spaces;
    return JSON.stringify({ name, tree: new Landing().render().__node }, null, 1);
  }).join("\n");
  if (process.env.GOLDEN_DUMP) {
    mkdirSync(process.env.GOLDEN_DUMP, { recursive: true });
    writeFileSync(`${process.env.GOLDEN_DUMP}/orca-landing-golden.json`, text);
  }
  const hash = createHash("sha256").update(text).digest("hex");
  if (GOLDEN === "unset") console.log("GOLDEN", hash, text.length);
  assert.equal(hash, GOLDEN);
});
