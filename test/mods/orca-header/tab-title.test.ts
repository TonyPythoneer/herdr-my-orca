import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { stripLeadingAgentTitleDecoration as strip } from "../../../src/mods/orca-header/tab-title.js";

test("drops a leading status glyph", () => {
  assert.equal(strip("✳ fix bug"), "fix bug");
  assert.equal(strip("⠋ working"), "working");
  assert.equal(strip("* note"), "note");
});
test("keeps glyph-only and plain titles", () => {
  assert.equal(strip("✳"), "✳");
  assert.equal(strip("plain"), "plain");
  assert.equal(strip(undefined), undefined);
});
