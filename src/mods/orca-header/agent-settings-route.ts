import type { Flag, LayoutNode } from "./types.js";

export const SETTINGS_SIDEBAR_PX = 76;
const MIN_OPEN_PX = 120;

export type SettingsSpace = { tabs?: unknown[] } | null | undefined;

export type SidebarPlan = { flag: Flag | null; show: boolean; resize: number | null };

export function settingsPillLeft(
  viewportWidth: number | null | undefined,
  leftRailWidth: number,
  rightRailWidth: number,
  pillWidth = 112,
): number | null {
  if (typeof viewportWidth !== "number" || !Number.isFinite(viewportWidth)) return null;
  const left = Math.max(0, leftRailWidth || 0);
  const right = Math.max(0, rightRailWidth || 0);
  const stripWidth = Math.max(0, viewportWidth - left - right);
  return Math.max(
    0,
    Math.min(Math.max(0, stripWidth - pillWidth), viewportWidth / 2 - left - pillWidth / 2),
  );
}

export function settingsReturnPage(
  previous: string | null | undefined,
  children: Pick<LayoutNode, "id">[] | undefined,
  activeSpace: SettingsSpace,
): string {
  const fallback = activeSpace?.tabs?.length ? "main-terminals" : "main-landing";
  if (
    !previous ||
    previous === "main-agents" ||
    previous === "main-terminals" ||
    previous === "main-landing"
  )
    return fallback;
  return (children ?? []).some((child) => child.id === previous) ? previous : fallback;
}

function collapsedPlan(prior: Flag): SidebarPlan {
  return { flag: null, show: true, resize: prior.hidden ? 0 : (prior.px ?? null) };
}

function openedPx(sidebar: LayoutNode | null | undefined, wide: number | undefined): number | null {
  if (!sidebar) return null;
  const current = sidebar.size?.px;
  return (current ?? 0) >= MIN_OPEN_PX ? (current ?? null) : (wide ?? null);
}

export function isCollapsed(sidebar: LayoutNode | null | undefined): boolean {
  const current = sidebar?.size?.px;
  return Boolean(sidebar && (sidebar.hidden || (current !== undefined && current <= 2)));
}

function resizeTo(
  sidebar: LayoutNode | null | undefined,
  flag: Flag,
  collapsed: boolean,
  narrow: number,
): number | null {
  return sidebar && (flag.px != null || collapsed) ? narrow : null;
}

function openedFlag(
  prior: Flag | null | undefined,
  sidebar: LayoutNode | null | undefined,
  collapsed: boolean,
  wide: number | undefined,
): Flag {
  if (prior && !(collapsed && prior.px == null && !prior.hidden)) return prior;
  return { px: openedPx(sidebar, wide), ...(collapsed ? { hidden: true } : {}) };
}

export type SidebarPlanInput = {
  open: boolean;
  prior?: Flag | null;
  sidebar?: LayoutNode | null;
  busy?: boolean;
  zoom?: number;
  wide?: number;
};

export function settingsSidebarPlan({
  open,
  prior,
  sidebar,
  busy,
  zoom = 1,
  wide,
}: SidebarPlanInput): SidebarPlan | null {
  if (busy) return null;
  if (!open) return prior == null ? null : collapsedPlan(prior);
  const narrow = Math.round(SETTINGS_SIDEBAR_PX * zoom);
  const collapsed = isCollapsed(sidebar);
  const flag = openedFlag(prior, sidebar, collapsed, wide);
  const resize = resizeTo(sidebar, flag, collapsed, narrow);
  if (flag === prior && !collapsed && (resize == null || sidebar?.size?.px === resize)) return null;
  return { flag, show: false, resize };
}

export function settingsHoldPx({
  full,
  sidebar,
  panel = 0,
}: {
  full: number;
  sidebar: number;
  panel?: number;
}): number | null {
  if (!(full > 0)) return null;
  return Math.max(1, Math.round(full - sidebar - panel));
}
