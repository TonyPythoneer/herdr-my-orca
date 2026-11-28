import { View, div, svg, image, type Color, type Context, type NativeElement } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import {
  agents,
  spaces,
  run,
  theme,
  exec,
  type AgentInfo,
  type Program,
  type SpaceInfo,
  type Status,
} from "herdr";
import { panelFrame } from "../../shared/panel-motion.js";
import { AGENT } from "../../shared/agent-catalog.js";
import { themeColor } from "../../shared/theme-color.js";

type AgentsTheme = {
  foreground: Color;
  muted: Color;
  dim: Color;
  border: Color;
  hover: Color;
  working: Color;
  blocked: Color;
  done: Color;
  idle: Color;
  raised: Color;
  background: Color;
  input: Color;
};
const ROLE = { user: "user", assistant: "assistant" } as const;
type Role = (typeof ROLE)[keyof typeof ROLE];
const TITLE_SOURCE = { user: "user", auto: "auto" } as const;
type TitleSource = (typeof TITLE_SOURCE)[keyof typeof TITLE_SOURCE];
const RECORD = {
  session: "session",
  sessionInfo: "session_info",
  title: "title",
  titleChange: "title_change",
  message: "message",
  modelChange: "model_change",
} as const;
const SCOPE = { workspace: "workspace", project: "project", all: "all" } as const;
type Preview = { role: Role; text: string };
type Session = {
  id: string;
  path: string;
  cwd: string | null;
  title: string;
  model: string | null;
  updatedAt: number | null;
  preview: Preview | null;
};
type Title = { title: string; source: TitleSource; at: number | null };
type GitEntry = { repo?: string; top?: string; worktrees?: Array<{ path?: string }> };
type GitCache = Record<string, GitEntry | null>;
type Message = { role?: string; content?: unknown; model?: string };
type SessionRecord = {
  type?: string;
  id?: string;
  cwd?: string;
  timestamp?: string;
  source?: string;
  titleSource?: string;
  title?: string;
  name?: string;
  v?: number;
  updatedAt?: string;
  model?: string;
  modelId?: string;
  message?: Message;
};
type ScanState = {
  sessionId: string;
  cwd: string | null;
  named: Title | null;
  model: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  fallback: string | null;
  preview: Preview | null;
};

const TRANSPARENT: Color = "#00000000";
const SEPARATOR = "·";
const AGENT_LABEL = "Agent";
const OMP_LABEL = "OMP";
const UNKNOWN_FOLDER = "unknown folder";
const GIT_CACHE_KEY = "git.cache.v2";
const PREVIEW_EMPTY = "No conversation preview available";
const ICON = {
  spinner: "mods/orca-assets/agent-working-spinner.svg",
  blocked: "mods/orca-assets/message-circle-question.svg",
  done: "mods/orca-assets/circle-check.svg",
  search: "mods/orca-assets/search--orca-right-sidebar-agents.svg",
  clear: "mods/orca-assets/x--orca-files.svg",
  empty: "mods/orca-assets/archive-restore.svg",
} as const;

function agentsTheme(): AgentsTheme {
  const raw = theme();
  return {
    foreground: themeColor(raw.foreground),
    muted: themeColor(raw.muted),
    dim: themeColor(raw.dim),
    border: themeColor(raw.border),
    hover: themeColor(raw.hover),
    working: themeColor(raw.working),
    blocked: themeColor(raw.blocked),
    done: themeColor(raw.done),
    idle: themeColor(raw.idle),
    raised: themeColor(raw.raised),
    background: themeColor(raw.background),
    input: themeColor(raw.input),
  };
}

function fade(color: Color | string | null | undefined, factor: number): Color {
  if (!color || typeof color !== "string") return TRANSPARENT;
  const alpha = color.length === 9 ? parseInt(color.slice(7), 16) : 255;
  return themeColor(
    color.slice(0, 7) +
      Math.round(alpha * factor)
        .toString(16)
        .padStart(2, "0"),
  );
}

function icon(p: Program | undefined, size: number, color: Color): NativeElement | null {
  if (!p?.icon) return null;
  return p.tint
    ? svg(p.icon).size(size).flex_none().text_color(color)
    : image(p.icon).w(size).h(size).flex_none();
}

function title(a: Pick<AgentInfo, "title" | "app" | "program">): string {
  return a.title?.trim() || a.app || a.program?.name || AGENT_LABEL;
}

function stateDot(status: Status, t: AgentsTheme): NativeElement {
  const box = div().size(10).flex_none().flex().items_center().justify_center();
  if (status === "working") {
    return box.child(svg(ICON.spinner).size(10).flex_none().text_color(t.working).spin(1000));
  }
  if (status === "blocked") {
    return box.child(svg(ICON.blocked).size(10).flex_none().text_color(t.blocked));
  }
  if (status === "done") {
    return box.child(svg(ICON.done).size(10).flex_none().text_color(t.done));
  }
  return box.child(
    div()
      .size(6)
      .rounded_full()
      .flex_none()
      .bg(themeColor(`${t.idle}66`)),
  );
}

function separator(t: AgentsTheme): NativeElement {
  return div().flex_none().text_color(t.dim).child(SEPARATOR);
}

function rowTitle(text: string, t: AgentsTheme): NativeElement {
  return div()
    .min_w(0)
    .truncate()
    .text_size(13)
    .font_medium()
    .line_height("20px")
    .text_color(t.foreground)
    .child(text);
}

function agentMeta(a: AgentInfo, t: AgentsTheme): NativeElement {
  return h_flex()
    .mt(4)
    .gap(6)
    .items_center()
    .text_size(11)
    .line_height("16px")
    .text_color(t.muted)
    .child(
      h_flex()
        .size(16)
        .flex_none()
        .items_center()
        .justify_center()
        .child(icon(a.program, 14, t.muted) as NativeElement),
    )
    .child(stateDot(a.status, t))
    .child(
      div()
        .min_w(0)
        .truncate()
        .child(a.app || a.program?.name || "agent"),
    )
    .child(separator(t))
    .child(
      div()
        .min_w(0)
        .truncate()
        .child(a.space_name || a.space),
    )
    .child(separator(t))
    .child(
      div()
        .min_w(0)
        .truncate()
        .child(a.tab_name || `tab ${a.tab_index}`),
    );
}

function previewRow(preview: Preview | null, t: AgentsTheme): NativeElement {
  const line = h_flex()
    .mt(2)
    .w_full()
    .min_w(0)
    .text_size(12)
    .line_height("16px")
    .text_color(t.muted);
  if (!preview) return line.child(div().min_w(0).truncate().child(PREVIEW_EMPTY));
  return line
    .child(
      div()
        .flex_none()
        .font_medium()
        .text_color(fade(t.foreground, 0.8))
        .child(preview.role === ROLE.user ? "You" : AGENT_LABEL),
    )
    .child(div().flex_1().min_w(0).truncate().child(`: ${preview.text}`));
}

function sessionMeta(s: Session, t: AgentsTheme): NativeElement {
  const line = h_flex()
    .mt(4)
    .gap(6)
    .items_center()
    .text_size(11)
    .line_height("16px")
    .text_color(t.muted)
    .child(div().flex_none().child(OMP_LABEL))
    .child(separator(t))
    .child(div().flex_none().child(ago(s.updatedAt)));
  const withModel = s.model
    ? line.child(separator(t)).child(div().min_w(0).truncate().child(s.model))
    : line;
  return withModel.child(separator(t)).child(
    div()
      .min_w(0)
      .truncate()
      .child(s.cwd || UNKNOWN_FOLDER),
  );
}

function inFolder(root: string | null, path: string | null): boolean {
  return Boolean(
    root && path && (path === root || path.startsWith(root + "/") || root.startsWith(path + "/")),
  );
}

function gitCache(): GitCache {
  try {
    const cache: GitCache | null = JSON.parse(localStorage.getItem(GIT_CACHE_KEY) ?? "{}");
    return cache ?? {};
  } catch {
    return {};
  }
}

function addRepoPaths(paths: Set<string>, cache: GitCache, repo: string | null): void {
  if (!repo) return;
  for (const g of Object.values(cache)) {
    if (g?.repo !== repo) continue;
    if (g.top) paths.add(g.top);
    for (const wt of g.worktrees ?? []) {
      if (wt.path) paths.add(wt.path);
    }
  }
}

function findActiveGit(
  cache: GitCache,
  activeSpace: SpaceInfo,
  projectFolder: string | null,
): GitEntry | null {
  const activeKey = JSON.stringify([activeSpace.machine ?? null, projectFolder]);
  return (
    cache[activeKey] ??
    Object.values(cache).find(
      (g) =>
        g?.top === projectFolder || (g?.worktrees ?? []).some((wt) => wt.path === projectFolder),
    ) ??
    null
  );
}

export function resolveProjectScope(
  activeSpace: SpaceInfo | undefined,
  sp: SpaceInfo[],
): {
  projectFolder: string | null;
  projectPaths: Set<string>;
  isSameProject: (space: SpaceInfo | undefined) => boolean;
} {
  if (!activeSpace) {
    return { projectFolder: null, projectPaths: new Set(), isSameProject: () => false };
  }
  const projectFolder = activeSpace.folder ?? null;
  const cache = gitCache();
  const activeRepo = findActiveGit(cache, activeSpace, projectFolder)?.repo ?? null;
  const projectPaths = new Set<string>();
  if (projectFolder) projectPaths.add(projectFolder);
  addRepoPaths(projectPaths, cache, activeRepo);

  const sharesRepo = (space: SpaceInfo): boolean =>
    cache[JSON.stringify([space.machine ?? null, space.folder])]?.repo === activeRepo ||
    Boolean(space.folder && projectPaths.has(space.folder));

  const isSameProject = (space: SpaceInfo | undefined): boolean => {
    if (!space) return false;
    if (space.id === activeSpace.id) return true;
    if (activeRepo && sharesRepo(space)) return true;
    return Boolean(projectFolder && space.folder && inFolder(projectFolder, space.folder));
  };

  for (const s of sp) {
    if (s.folder && isSameProject(s)) {
      projectPaths.add(s.folder);
    }
  }

  return { projectFolder, projectPaths, isSameProject };
}

function ago(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "Unknown time";
  const diff = Date.now() - ms;
  if (diff < 60000) return "Just now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function countLabel(shown: number, loaded: number): string {
  if (shown !== loaded) return `${shown} of ${loaded} sessions`;
  return `${shown} session${shown === 1 ? "" : "s"}`;
}

function countBar(shown: number, loaded: number, t: AgentsTheme): NativeElement {
  return h_flex()
    .h(32)
    .flex_none()
    .items_center()
    .pl(12)
    .pr(6)
    .border_b(1)
    .border_color(t.border)
    .bg(fade(t.raised, 0.6))
    .child(
      div()
        .flex_1()
        .min_w(0)
        .truncate()
        .text_size(12)
        .font_semibold()
        .child(countLabel(shown, loaded)),
    );
}

const MAX_SESSIONS = 12;
const SCAN_TIMEOUT_MS = 15000;

const REPAINT_MS = 1000;
const RESCAN_MS = 60000;
const OMP_LIST =
  'root="${OMP_CODING_AGENT_DIR:-${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}}"; ' +
  'case "$root" in */sessions) ;; *) root="$root/sessions" ;; esac; ' +
  `ls -1t "$root"/*/*.jsonl 2>/dev/null | head -n ${MAX_SESSIONS}`;

const OMP_READ = 'head -c 65536 "$1"; printf "\\n"; tail -c 16384 "$1" | tail -n 2';

function sessionIdFromFileName(fileName: string): string {
  const name = fileName.replace(/\.jsonl$/, "");
  const match = name.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  return match ? match[0] : name;
}

function partText(part: unknown): string {
  if (typeof part === "string") return part;
  if (part === null || (typeof part !== "object" && typeof part !== "function")) return "";
  return "text" in part && typeof part.text === "string" ? part.text : "";
}
function messageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map(partText).join(" ").trim();
}

const TITLE_RECORD_TYPES = new Set<string>([
  RECORD.session,
  RECORD.sessionInfo,
  RECORD.title,
  RECORD.titleChange,
]);

function titleSourceOf(record: SessionRecord): TitleSource | null {
  if (record.type === RECORD.sessionInfo) return TITLE_SOURCE.user;
  const raw = record.source ?? record.titleSource;
  if (raw === undefined) return TITLE_SOURCE.auto;
  return raw === TITLE_SOURCE.user || raw === TITLE_SOURCE.auto ? raw : null;
}

function titleCandidate(record: SessionRecord): Title | null {
  if (!TITLE_RECORD_TYPES.has(record.type ?? "")) return null;
  if (record.type === RECORD.title && record.v !== 1) return null;
  const value = String(
    (record.type === RECORD.sessionInfo ? record.name : record.title) ?? "",
  ).trim();
  const source = titleSourceOf(record);
  if (!value || source === null) return null;
  const stamp = record.type === RECORD.title ? record.updatedAt : record.timestamp;
  const parsed = stamp ? Date.parse(stamp) : NaN;
  return { title: value, source, at: Number.isFinite(parsed) ? parsed : null };
}

function foldTitle(current: Title | null, record: SessionRecord): Title | null {
  const next = titleCandidate(record);
  if (!next) return current;
  if (current?.source === TITLE_SOURCE.user && next.source !== TITLE_SOURCE.user) return current;
  if (
    current?.source === next.source &&
    current.at !== null &&
    next.at !== null &&
    next.at < current.at
  )
    return current;
  return next;
}

function foldTimeline(
  acc: Pick<ScanState, "createdAt" | "updatedAt">,
  timestamp: string | undefined,
): void {
  const parsed = timestamp ? Date.parse(timestamp) : NaN;
  if (!Number.isFinite(parsed)) return;
  if (acc.createdAt === null || parsed < acc.createdAt) acc.createdAt = parsed;
  if (acc.updatedAt === null || parsed > acc.updatedAt) acc.updatedAt = parsed;
}

function foldSessionRecord(acc: Pick<ScanState, "sessionId" | "cwd">, record: SessionRecord): void {
  if (typeof record.id === "string" && record.id.trim()) acc.sessionId = record.id.trim();
  if (acc.cwd === null && typeof record.cwd === "string" && record.cwd.trim())
    acc.cwd = record.cwd.trim();
}

function foldMessage(
  acc: Pick<ScanState, "fallback" | "model" | "preview">,
  message: Message,
): void {
  const role = message.role;
  if (role !== ROLE.user && role !== ROLE.assistant) return;
  const text = messageText(message.content);
  if (role === ROLE.user) acc.fallback ??= text;
  else acc.model = message.model || acc.model;
  if (text) acc.preview = { role, text };
}

function foldRecord(acc: ScanState, record: SessionRecord): void {
  foldTimeline(acc, record.timestamp);
  acc.named = foldTitle(acc.named, record);
  if (record.type === RECORD.session) foldSessionRecord(acc, record);
  else if (record.type === RECORD.modelChange)
    acc.model = record.modelId || record.model || acc.model;
  else if (record.type === RECORD.message && record.message) foldMessage(acc, record.message);
}

function parseRecordLine(line: string): SessionRecord | null {
  if (line.charAt(0) !== "{") return null;
  try {
    const record: SessionRecord | null = JSON.parse(line);
    return record && typeof record === "object" ? record : null;
  } catch {
    return null;
  }
}

function parseOmpSession(path: string, content: string): Session {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  const acc: ScanState = {
    sessionId: sessionIdFromFileName(fileName),
    cwd: null,
    named: null,
    model: null,
    createdAt: null,
    updatedAt: null,
    fallback: null,
    preview: null,
  };
  for (const line of content.split("\n")) {
    const record = parseRecordLine(line);
    if (record) foldRecord(acc, record);
  }
  return {
    id: acc.sessionId,
    path,
    cwd: acc.cwd,
    title: acc.named?.title || acc.fallback || `${OMP_LABEL} ${acc.sessionId.slice(0, 8)}`,
    model: typeof acc.model === "string" ? acc.model : null,
    updatedAt: acc.updatedAt ?? acc.createdAt,
    preview: acc.preview,
  };
}

async function scanOmpSessions(): Promise<Session[]> {
  const listing = await exec("sh", ["-c", OMP_LIST], { timeout: SCAN_TIMEOUT_MS });
  const paths = listing.stdout.split("\n").filter(Boolean).slice(0, MAX_SESSIONS);
  const contents = await Promise.all(
    paths.map(async (path): Promise<[string, string]> => {
      try {
        const read = await exec("sh", ["-c", OMP_READ, "read", path], { timeout: SCAN_TIMEOUT_MS });
        return [path, read.stdout];
      } catch {
        return [path, ""];
      }
    }),
  );
  return contents
    .map(([path, content]) => parseOmpSession(path, content))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}

function effectiveScopeOf(
  scope: string,
  workspaceAvailable: boolean,
  projectAvailable: boolean,
): string {
  if (scope === SCOPE.workspace && !workspaceAvailable) {
    return projectAvailable ? SCOPE.project : SCOPE.all;
  }
  if (scope === SCOPE.project && !projectAvailable) return SCOPE.all;
  return scope;
}

function scopedHistory(
  history: Session[],
  scope: string,
  activeSpace: SpaceInfo | undefined,
  projectPaths: Set<string> | null,
): Session[] {
  if (scope === SCOPE.workspace && activeSpace?.folder) {
    return history.filter((s) => inFolder(activeSpace.folder, s.cwd));
  }
  if (scope === SCOPE.project && projectPaths) {
    const paths = [...projectPaths];
    return history.filter((s) => s.cwd && paths.some((p) => inFolder(p, s.cwd)));
  }
  return history;
}

function searchedHistory(history: Session[], query: string): Session[] {
  if (!query) return history;
  return history.filter((s) =>
    [s.title, s.cwd || "", s.model || "", AGENT.omp].some((value) =>
      value.toLowerCase().includes(query),
    ),
  );
}

function liveAgents(
  scope: string,
  activeSpace: SpaceInfo | undefined,
  sp: SpaceInfo[],
  projectAvailable: boolean,
  isSameProject: (space: SpaceInfo | undefined) => boolean,
): AgentInfo[] {
  const all = agents() ?? [];
  if (scope === SCOPE.workspace && activeSpace) {
    return all.filter((a) => a.space === activeSpace.id);
  }
  if (scope === SCOPE.project && projectAvailable) {
    return all.filter((a) => isSameProject(sp.find((x) => x.id === a.space)));
  }
  return all;
}

function noLiveAgentsLine(t: AgentsTheme): NativeElement {
  return h_flex().px(12).py(6).text_size(11).text_color(t.muted).child("No live agents");
}

function errorLine(message: string, t: AgentsTheme): NativeElement {
  return v_flex().px(12).py(8).text_size(11).text_color(t.blocked).child(message);
}

function loadingLine(t: AgentsTheme): NativeElement {
  return h_flex()
    .px(12)
    .py(12)
    .gap(6)
    .items_center()
    .text_size(11)
    .text_color(t.muted)
    .child(svg(ICON.spinner).size(14).flex_none().text_color(t.working).spin(1000))
    .child("Scanning sessions");
}

export default class AgentsPanel extends View {
  seen = "";
  scope: string = SCOPE.workspace;
  search!: InputState;
  history: Session[] = [];
  historyLoading = false;
  historyError: string | null = null;

  init(_props: unknown, cx: Context): void {
    this.seen = "";
    this.scope = SCOPE.workspace;
    this.search = InputState.new({ placeholder: "Search sessions" });
    this.search.on("change", (_e: unknown, changeCx: Context) => changeCx.notify());
    this.history = [];
    this.historyLoading = false;
    this.historyError = null;

    cx.timer.every(REPAINT_MS, (tickCx: Context) => {
      const now = (agents() ?? []).map((a) => `${a.address}:${a.status}`).join(",");
      if (now === this.seen) return;
      this.seen = now;
      tickCx.notify();
    });

    this.refreshHistory(cx);

    cx.timer.every(RESCAN_MS, (tickCx: Context) => this.refreshHistory(tickCx));
  }

  refreshHistory(cx: Context): void {
    if (this.historyLoading) return;
    this.historyLoading = true;
    cx.spawn(async (jobCx: Context) => {
      try {
        this.history = await scanOmpSessions();
        this.historyError = null;
      } catch (e) {
        this.historyError = e instanceof Error ? e.message : String(e);
      }
      this.historyLoading = false;
      jobCx.notify();
    });
  }

  resume(session: Session): void {
    const args: { argv: string[]; folder?: string } = {
      argv: [AGENT.omp, "--resume=" + session.path],
    };

    if (session.cwd) args.folder = session.cwd;
    run("terminal.open", args);
  }

  row(a: AgentInfo, t: AgentsTheme): NativeElement {
    return h_flex()
      .id(`agent-${a.address}`)
      .w_full()
      .min_w(0)
      .flex_none()
      .px(12)
      .py(8)
      .gap(6)
      .items_start()
      .border_b(1)
      .border_color(t.border)
      .cursor_pointer()
      .hover((s: ReturnType<typeof h_flex>) => s.bg(t.hover))
      .role("button")
      .accessibility_label(`${title(a)} — ${a.status}`)
      .on_click(() => run("agent.focus", { terminal: a.address }))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .child(rowTitle(title(a), t))
          .child(agentMeta(a, t)),
      );
  }

  historyRow(s: Session, t: AgentsTheme): NativeElement {
    return h_flex()
      .id(`session-${s.path}`)
      .w_full()
      .min_w(0)
      .flex_none()
      .px(12)
      .py(8)
      .gap(6)
      .items_start()
      .border_b(1)
      .border_color(t.border)
      .cursor_pointer()
      .hover((st: ReturnType<typeof h_flex>) => st.bg(t.hover))
      .role("button")
      .accessibility_label(`Resume ${s.title}`)
      .on_click(() => this.resume(s))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .child(rowTitle(s.title, t))
          .child(previewRow(s.preview, t))
          .child(sessionMeta(s, t)),
      );
  }

  groupHeader(label: string, count: number, t: AgentsTheme): NativeElement {
    return h_flex()
      .w_full()
      .h(32)
      .flex_none()
      .items_center()
      .gap(6)
      .px(12)
      .border_t(1)
      .border_b(1)
      .border_color(t.border)
      .bg(fade(t.raised, 0.6))
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().child(label))
      .child(
        div()
          .flex_none()
          .px(6)
          .py(2)
          .rounded(4)
          .border_1()
          .border_color(t.border)
          .bg(t.background)
          .text_size(11)
          .font_semibold()
          .child(String(count)),
      );
  }

  scopeSwitch(
    scope: string,
    workspaceAvailable: boolean,
    projectAvailable: boolean,
    t: AgentsTheme,
  ): NativeElement {
    const seg = (key: string, label: string, available: boolean): NativeElement => {
      const active = scope === key;
      return div()
        .id(`agent-sessions-scope-${key}`)
        .flex_1()
        .min_w(0)
        .h(24)
        .flex()
        .items_center()
        .justify_center()
        .rounded(4)
        .px(6)
        .text_size(11)
        .font_medium()
        .when(active, (e: NativeElement) =>
          e.bg(fade(t.foreground, 0.1)).text_color(t.foreground).border_1().border_color(t.border),
        )
        .when(!active && available, (e: NativeElement) =>
          e
            .text_color(t.muted)
            .cursor_pointer()
            .hover((s: ReturnType<typeof h_flex>) => s.bg(t.hover).text_color(t.foreground)),
        )
        .when(!available, (e: NativeElement) => e.text_color(t.dim).opacity(0.4))
        .on_click((_e: unknown, clickCx: Context) => {
          if (!available || this.scope === key) return;
          this.scope = key;
          clickCx.notify();
        })
        .child(label);
    };

    return h_flex()
      .w_full()
      .p(2)
      .gap(2)
      .rounded(6)
      .border_1()
      .border_color(t.border)
      .bg(fade(t.raised, 0.4))
      .child(seg(SCOPE.workspace, "Workspace", workspaceAvailable))
      .child(seg(SCOPE.project, "Project", projectAvailable))
      .child(seg(SCOPE.all, "All", true));
  }

  searchBar(t: AgentsTheme): NativeElement {
    const q = this.search.value();
    return h_flex()
      .w_full()
      .h(30)
      .px(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .border_1()
      .border_color(t.border)
      .bg(fade(t.input, 0.4))
      .child(svg(ICON.search).size(13).flex_none().text_color(t.muted))
      .child(
        Input.new(this.search)
          .flex_1()
          .min_w(0)
          .text_size(12)
          .text_color(t.foreground)
          .bg(TRANSPARENT),
      )
      .when(Boolean(q), (e: NativeElement) =>
        e.child(
          div()
            .id("agents-search-clear")
            .size(18)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .rounded(4)
            .cursor_pointer()
            .text_color(t.muted)
            .hover((s: ReturnType<typeof h_flex>) => s.text_color(t.foreground).bg(t.hover))
            .on_click((_e: unknown, clickCx: Context) => {
              this.search.set_value("");
              clickCx.notify();
            })
            .child(svg(ICON.clear).size(12)),
        ),
      );
  }

  controls(
    t: AgentsTheme,
    scope: string,
    workspaceAvailable: boolean,
    projectAvailable: boolean,
  ): NativeElement {
    return v_flex()
      .flex_none()
      .px(10)
      .py(8)
      .gap(8)
      .border_b(1)
      .border_color(t.border)
      .child(
        v_flex()
          .w_full()
          .min_w(0)
          .child(div().truncate().text_size(12).font_semibold().child("Agent Session History"))
          .child(div().truncate().text_size(11).text_color(t.muted).child("Resume past sessions")),
      )
      .child(this.scopeSwitch(scope, workspaceAvailable, projectAvailable, t))
      .child(this.searchBar(t));
  }

  render(): NativeElement {
    return panelFrame(this.renderBody());
  }

  renderBody(): NativeElement {
    const t = agentsTheme();
    const sp = spaces() ?? [];
    const activeSpace = sp.find((s) => s.active);
    const workspaceAvailable = Boolean(activeSpace);
    const { projectFolder, projectPaths, isSameProject } = resolveProjectScope(activeSpace, sp);
    const projectAvailable = Boolean(projectFolder);
    const effectiveScope = effectiveScopeOf(this.scope, workspaceAvailable, projectAvailable);
    const filtered = liveAgents(effectiveScope, activeSpace, sp, projectAvailable, isSameProject);
    const history = searchedHistory(
      scopedHistory(
        this.history,
        effectiveScope,
        activeSpace,
        projectAvailable ? projectPaths : null,
      ),
      this.search.value().trim().toLowerCase(),
    );

    return v_flex()
      .id("agents")
      .size_full()
      .min_h(0)
      .overflow_hidden()
      .text_color(t.foreground)
      .child(this.controls(t, effectiveScope, workspaceAvailable, projectAvailable))
      .child(countBar(history.length, this.history.length, t))
      .child(this.sessionList(t, filtered, history));
  }

  emptyState(t: AgentsTheme): NativeElement {
    return v_flex()
      .size_full()
      .items_center()
      .justify_center()
      .px(16)
      .text_color(t.muted)
      .child(div().mb(12).opacity(0.5).child(svg(ICON.empty).size(28)))
      .child(
        div()
          .text_size(14)
          .font_medium()
          .text_center()
          .child(
            this.history.length
              ? "No sessions match the current filters"
              : "No agent sessions found",
          ),
      );
  }

  sessionList(t: AgentsTheme, filtered: AgentInfo[], history: Session[]): NativeElement {
    return v_flex()
      .id("agents-list")
      .flex_1()
      .min_h(0)
      .overflow_y_scrollbar()
      .child(this.groupHeader("Live agents", filtered.length, t))
      .children(filtered.map((a) => this.row(a, t)))
      .when(!filtered.length, (el: NativeElement) => el.child(noLiveAgentsLine(t)))
      .child(this.groupHeader("Past sessions", history.length, t))
      .when(Boolean(this.historyError), (el: NativeElement) =>
        el.child(errorLine(this.historyError ?? "", t)),
      )
      .when(this.historyLoading && !this.history.length, (el: NativeElement) =>
        el.child(loadingLine(t)),
      )
      .children(history.map((s) => this.historyRow(s, t)))
      .when(!this.historyLoading && !history.length, (el: NativeElement) =>
        el.child(this.emptyState(t)),
      );
  }
}
