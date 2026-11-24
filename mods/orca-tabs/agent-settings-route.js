// Agent Settings only. Pure geometry and return target; no layout changes here.
export function settingsPillLeft(viewportWidth, leftRailWidth, rightRailWidth, pillWidth = 112) {
  if (!Number.isFinite(viewportWidth)) return null;
  const left = Math.max(0, leftRailWidth || 0), right = Math.max(0, rightRailWidth || 0);
  const stripWidth = Math.max(0, viewportWidth - left - right);
  return Math.max(0, Math.min(Math.max(0, stripWidth - pillWidth), viewportWidth / 2 - left - pillWidth / 2));
}

export function settingsReturnPage(previous, children, activeSpace) {
  const fallback = activeSpace?.tabs?.length ? "main-terminals" : "main-landing";
  if (!previous || previous === "main-agents" || previous === "main-terminals" || previous === "main-landing") return fallback;
  return (children ?? []).some(child => child.id === previous) ? previous : fallback;
}

// While Agent Settings is open the left sidebar shrinks to the agent rail (orca-spaces RAIL.width) and
// loses Search and its title (`nav-top`). Keep the wide width and initial visibility across reloads.
export const SETTINGS_SIDEBAR_PX = 76;
const MIN_OPEN_PX = 120; // a narrower node is mid-motion, not a width worth restoring

// `zoom`: layout px are element px times the window zoom, so the rail (RAIL.width element px) needs 76 * zoom.
// eslint-disable-next-line complexity -- shortcut: this function's branches are inherited from main, refactor when this area is next changed
export function settingsSidebarPlan({ open, prior, sidebar, busy, zoom = 1, wide }) {
  const narrow = Math.round(SETTINGS_SIDEBAR_PX * zoom);
  if (busy || (!open && prior == null)) return null;
  const current = sidebar?.size?.px;
  const collapsed = Boolean(sidebar && (sidebar.hidden || current <= 2));
  if (!open) return { flag: null, show: true, resize: prior.hidden ? 0 : prior.px ?? null };
  let px = null;
  if (sidebar) px = current >= MIN_OPEN_PX ? current : wide;
  // Older sessions could persist {px:null} while hidden and never show the rail.
  const flag = prior && !(collapsed && prior.px == null && !prior.hidden)
    ? prior : { px: px ?? null, ...(collapsed ? { hidden: true } : {}) };
  const resize = sidebar && (flag.px != null || collapsed) ? narrow : null;
  if (flag === prior && !collapsed && (resize == null || current === resize)) return null;
  return { flag, show: false, resize };
}

// Compute the main width at a sidebar endpoint before pinning or selecting the page.
export function settingsHoldPx({ full, sidebar, panel = 0 }) {
  if (!(full > 0)) return null;
  return Math.max(1, Math.round(full - sidebar - panel));
}
