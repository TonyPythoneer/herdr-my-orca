// The panel's copy of the left sidebar's frame: a narrowing panel keeps its content at the open
// width and fades it out, instead of reflowing it. Same numbers as sidebarFrame in orca-nav.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register(new URL("../../scripts/gpui-stub-loader.mjs", import.meta.url));
const { panelFrame } = await import("./panel-motion.js");

const inner = () => ({ content: 1 });

const at = (open, px) => {
  globalThis.__herdrProps = () => ({});
  globalThis.__herdrShared = (key) => (key === "panel.openPx" ? open : undefined);
  globalThis.__herdrLayout = () => ({ children: [{ id: "panel", size: { px } }] });
  globalThis.__herdrTheme = () => ({ surface: "#171717" });
};
const clear = () => {
  delete globalThis.__herdrProps; delete globalThis.__herdrShared;
  delete globalThis.__herdrLayout; delete globalThis.__herdrTheme;
};

test("leaves the content alone at the open width, with no shared width, or in an overlay copy", () => {
  const content = inner();
  at(undefined, 200);
  assert.equal(panelFrame(content), content);
  at(350, 350);
  assert.equal(panelFrame(content), content);
  at(350, 400);
  assert.equal(panelFrame(content), content);
  at(350, 175);
  globalThis.__herdrProps = () => ({ overlay: true });
  assert.equal(panelFrame(content), content);
  clear();
});

test("a narrowing panel keeps the open width, slides the content out and covers it", () => {
  const content = inner();
  at(350, 175); // k = 0.5
  const frame = panelFrame(content).__node;
  assert.deepEqual(frame.c.slice(0, 3), [["size_full", []], ["overflow_hidden", []], ["relative", []]]);
  const [innerFrame, cover] = frame.c.filter(([name]) => name === "child").map(([, args]) => args[0]);
  const calls = innerFrame.c.map(([name, args]) => [name, args[0]]);
  // Fixed at the open width, anchored to the panel's right edge and shifted 28px * (1-k) further out.
  assert.deepEqual([calls[0], calls[1][0]], [["w", 350], "h_full"]);
  assert.deepEqual(calls.find(([name]) => name === "left"), ["left", -161]);
  assert.deepEqual(innerFrame.c.find(([name]) => name === "child")[1], [content]);
  // clamp(1 - (k-.15)/.85) at k=0.5 is 0.588 -> alpha 0x96, in the panel's own colour.
  assert.deepEqual(cover.c.find(([name]) => name === "bg")[1], ["#17171796"]);
  clear();
});
