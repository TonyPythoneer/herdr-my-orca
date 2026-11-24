// Right sidebar, mirrored from the left sidebar's `sidebarFrame` (orca-nav / orca-spaces /
// orca-chrome): while `orca-tabs.togglePanelNative` steps the panel narrower, the panel's content
// keeps the OPEN width and only slides out and fades, so nothing reflows or truncates on the way.
// The panel is anchored to its right edge, so the inner frame is too and the content leaves
// through the window's right edge; the 28px shift and the clamp((k-.15)/.85) fade are the left
// side's numbers, mirrored onto that edge. Same two layers as the left, for the same reasons: a
// fixed-width inner frame (no reflow) and a flat cover (one blended quad, not a group `opacity`
// that would make the GPU draw the whole subtree off-screen every frame).
// Untouched (`inner`) at the open width, with no shared open width, or in an overlay copy of the
// same mod (the file menu and the diff popup are not the panel). The gate is the shared open width
// rather than a layout prop, so a layout that forgets to pass one still gets the frame.
import { div } from "gpui-kit";
import { theme, layout, props, shared } from "herdr";

function find(n, id) {
  if (n?.id === id) return n;
  for (const c of n?.children ?? []) { const r = find(c, id); if (r) return r; }
  return null;
}

export function panelFrame(inner) {
  if (props()?.overlay) return inner;
  const open = shared("panel.openPx");
  const px = find(layout(), "panel")?.size?.px;
  if (!(open > 0) || !(px > 0) || px >= open - 0.5) return inner;
  const k = px / open;
  // GPU cost: a group `opacity` makes the GPU draw the whole subtree off-screen every frame. A flat
  // cover in the panel's own colour, with the alpha the fade needs, is one blended quad.
  const bg = theme().surface;
  const cover = Math.max(0, Math.min(1, 1 - (k - 0.15) / 0.85));
  const alpha = Math.round(cover * 255).toString(16).padStart(2, "0");
  // `px - open` pins the content to the panel's right edge (the edge that does not move), and the
  // extra `(1 - k) * 28` slides it out that way: the left frame's `-(1 - k) * 28`, mirrored.
  return div().size_full().overflow_hidden().relative()
    .child(div().w(open).h_full().relative().left(px - open + (1 - k) * 28).child(inner))
    .child(div().absolute().top(0).left(0).right(0).bottom(0).bg(/^#[0-9a-f]{6}$/i.test(bg) ? `${bg}${alpha}` : bg));
}
// Generated from shared/panel-motion.js by scripts/sync-shared.mjs. Edit that file, not this copy.
