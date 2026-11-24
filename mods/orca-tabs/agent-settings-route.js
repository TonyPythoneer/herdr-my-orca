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
