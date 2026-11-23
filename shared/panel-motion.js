// Right sidebar, mirrored from the left sidebar's `sidebarFrame` (orca-nav / orca-spaces /
// orca-chrome): while `orca-tabs.togglePanelNative` steps the panel narrower, the panel's content
// keeps the OPEN width and only slides out and fades, so nothing reflows or truncates on the way.
// The panel is anchored to its right edge, so the inner frame is too and the content is clipped on
// the left; it is not faded, so the panel does not read as sliding over the work area.
// Untouched (`inner`) at the open width, with no shared open width, or in an overlay copy of the
// same mod (the file menu and the diff popup are not the panel). The gate is the shared open width
// rather than a layout prop, so a layout that forgets to pass one still gets the frame.
import { div } from "gpui-kit";
import { layout, props, shared } from "herdr";

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
  // The content is pinned to the panel's right edge at its open width and clipped on the left, and
  // it does not fade or slide: the work area's right edge is the only thing that moves, so what the
  // person sees is their work shrinking and the panel being revealed behind it. (The left sidebar
  // fades its content instead, because there the card's LEFT edge moves.)
  return div().size_full().overflow_hidden().relative()
    .child(div().w(open).h_full().relative().left(-(px - open)).child(inner));
}
