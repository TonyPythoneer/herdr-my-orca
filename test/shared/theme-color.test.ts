import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { themeColor } from "../../src/shared/theme-color.js";

test("theme tokens pass through unchanged, as the legacy mods did", () => {
  assert.equal(themeColor("#808080"), "#808080");
  assert.equal(themeColor("var(--border)"), "var(--border)");
  assert.equal(themeColor("red"), "red");
  assert.equal(themeColor(""), "");
  assert.equal(themeColor(undefined), undefined);
  assert.equal(themeColor(null), null);
});
