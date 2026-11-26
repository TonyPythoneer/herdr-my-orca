import { shared } from "herdr";

// Safely read a stored JSON value of the expected shape; a mangled key never throws.
// Memoized by the raw string so repeated renders skip re-parsing; an external write
// changes the raw string and invalidates the entry automatically.
const _storedCache = new Map();
export function stored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    const cached = _storedCache.get(key);
    if (cached && cached.raw === raw) return cached.value;
    const v = JSON.parse(raw ?? "null");
    const value = Array.isArray(fallback) === Array.isArray(v) && v !== null && typeof v === "object" ? v : fallback;
    _storedCache.set(key, { raw, value });
    return value;
  } catch { return fallback; }
}

// Workspace options written by orca-sidebar-top's options popup (SidebarWorkspaceOptionsMenu.tsx:23-100).
// Orca persists these in PersistedUIState (`persisted-ui-state-types.ts:39-89`). The options popup
// publishes them in Herdr's app-wide shared store; localStorage is a fallback for older versions.
// Defaults are NO_WORKSPACE_ROW_FILTERS
// (`workspace-row-filters.ts:45-56`) plus repo grouping and manual sort.
const WORKSPACE_OPTIONS_KEY = "workspace.options.v1";
const WORKSPACE_OPTIONS_DEFAULTS = {
  groupBy: "repo",              // none | workspace-status | repo
  sortBy: "manual",             // name | smart | recent | repo | manual
  projectOrderBy: "manual",     // manual | name | recent
  filterRepoIds: [],
  visibleWorkspaceHostIds: null,
  hideSleepingWorkspaces: false,
  alwaysShowDefaultBranchWorkspace: true,
  hideDefaultBranchWorkspace: false,
  hideAutomationGeneratedWorkspaces: false,
  hideCliCreatedWorkspaces: false,
  hideWorkspacesFromOtherDevices: false,
  hideDetachedHeadWorkspaces: false,
};
let _workspaceOptionsCache = { src: undefined, value: null };
export function workspaceOptions() {
  const published = shared(WORKSPACE_OPTIONS_KEY);
  const saved = published && typeof published === "object" && !Array.isArray(published)
    ? published
    : stored(WORKSPACE_OPTIONS_KEY, null);
  if (_workspaceOptionsCache.src === saved) return _workspaceOptionsCache.value;
  const value = saved && !Array.isArray(saved) ? { ...WORKSPACE_OPTIONS_DEFAULTS, ...saved } : { ...WORKSPACE_OPTIONS_DEFAULTS };
  _workspaceOptionsCache = { src: saved, value };
  return value;
}
