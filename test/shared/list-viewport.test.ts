import { describe, expect, it } from "vite-plus/test";
import { viewportHeight, scrolls, ROW } from "../../src/shared/list-viewport";

describe("typed viewport candidate", () => {
  it("preserves empty, short and overflowing list dimensions", () => {
    expect(viewportHeight(0, ROW.height, ROW.gap)).toBe(0);
    expect(viewportHeight(1, ROW.height, ROW.gap)).toBe(30);
    expect(viewportHeight(5, ROW.height, ROW.gap)).toBe(158);
    expect(viewportHeight(6, ROW.height, ROW.gap)).toBe(175);
    expect(viewportHeight(100, ROW.height, ROW.gap)).toBe(175);
    expect(scrolls(5)).toBe(false);
    expect(scrolls(6)).toBe(true);
  });
});
