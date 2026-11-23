import { test } from "node:test";
import { strict as assert } from "node:assert";
import { sidebarEase } from "./sidebar-motion.js";

test("sidebar easing reaches both ends and moves monotonically", () => {
  assert.equal(sidebarEase(0), 0);
  assert.equal(sidebarEase(1), 1);
  let previous = 0;
  for (let i = 1; i <= 100; i++) {
    const value = sidebarEase(i / 100);
    assert.ok(value >= previous && value <= 1);
    previous = value;
  }
  assert.ok(sidebarEase(0.05) < 0.01);
});
