import { div, svg } from "gpui-kit";

const MOTION = { duration: 200, easing: "ease-out" };

// Reusable selection tile layers: hover is transient; selection gets its own check mark.
export function hoverHighlight(hovered, t, radius) {
  return div().absolute().inset_0().rounded(radius).bg(t.hover)
    .opacity(hovered ? 1 : 0).transition("opacity", MOTION);
}

export function selectedCheck(selected, t) {
  return div().when(selected, el => el.absolute().top(2).right(2).size(14).rounded_full().bg(t.accent)
    .flex().items_center().justify_center()
    .child(svg("mods/orca-assets/check.svg").size(9).text_color(t.surface)));
}

// Inline trailing mark for selectable list rows; selection does not reuse the hover background.
export function selectionMark(selected, t) {
  return div().flex_none().w(8).flex().items_center().justify_center()
    .when(selected, el => el.text_color(t.accent).child("✓"));
}
// Generated from orca-ui/shared/selection-ui.js by scripts/build-orca-ui.mjs. Edit that file, not this copy.
