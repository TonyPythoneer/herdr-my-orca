import { shared } from "herdr";

const _storedCache = new Map<string, { raw: string | null; value: unknown }>();

export function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    const cached = _storedCache.get(key);
    if (cached && cached.raw === raw) return cached.value as T;
    const v: unknown = JSON.parse(raw ?? "null");
    const value = (
      Array.isArray(fallback) === Array.isArray(v) && v !== null && typeof v === "object"
        ? v
        : fallback
    ) as T;
    _storedCache.set(key, { raw, value });
    return value;
  } catch {
    return fallback;
  }
}

export type WorkspaceOptions = {
  groupBy: string;
  sortBy: string;
  projectOrderBy: string;
  filterRepoIds: string[];
  visibleWorkspaceHostIds: string[] | null;
  hideSleepingWorkspaces: boolean;
  alwaysShowDefaultBranchWorkspace: boolean;
  hideDefaultBranchWorkspace: boolean;
  hideAutomationGeneratedWorkspaces: boolean;
  hideCliCreatedWorkspaces: boolean;
  hideWorkspacesFromOtherDevices: boolean;
  hideDetachedHeadWorkspaces: boolean;
};

const WORKSPACE_OPTIONS_KEY = "workspace.options.v1";
const WORKSPACE_OPTIONS_DEFAULTS: WorkspaceOptions = {
  groupBy: "repo",
  sortBy: "manual",
  projectOrderBy: "manual",
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

let _workspaceOptionsCache: { src: unknown; value: WorkspaceOptions | null } = {
  src: undefined,
  value: null,
};

export function workspaceOptions(): WorkspaceOptions {
  const published = shared(WORKSPACE_OPTIONS_KEY);
  const saved: unknown = isRecord(published)
    ? published
    : stored<unknown>(WORKSPACE_OPTIONS_KEY, null);
  if (_workspaceOptionsCache.src === saved && _workspaceOptionsCache.value)
    return _workspaceOptionsCache.value;
  const value: WorkspaceOptions = isRecord(saved)
    ? { ...WORKSPACE_OPTIONS_DEFAULTS, ...saved }
    : { ...WORKSPACE_OPTIONS_DEFAULTS };
  _workspaceOptionsCache = { src: saved, value };
  return value;
}
