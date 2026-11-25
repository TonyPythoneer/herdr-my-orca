// The agent-sessions panel: Orca's "Agents" activity entry — the live Herdr agents above the session
// history Orca lists from disk, with resume.
//
// Orca's panel scans agent transcripts on disk and offers scope, search, details and resume
// (AiVaultPanel.tsx:196-363, AiVaultPanelHeader.tsx:94-172, AiVaultSessionRow.tsx:155-245).
// The reader primitive here is `exec` (defaults/herdr.d.ts:14): it runs a program in the
// user's real environment, which is what can see `$HOME`. `readTextFile`
// (defaults/herdr.d.ts:26) rejects anything over 1 MiB (src/mods.rs:872) and transcripts run
// to 32 MB, so it cannot read them; that is the only read primitive Herdr exposes for mods.
// The bounded `head`/`tail` window below is the sampling strategy, not a second primitive.
//
// One store is ported: OMP's jsonl sessions. Orca has one adapter per CLI
// (AI_VAULT_AGENT_SOURCES, session-scanner-agent-sources.ts:88); a second CLI is a second
// adapter (root + parser), not a rewrite of this panel.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { agents, spaces, run, theme, exec } from "herdr";
import { panelFrame } from "./panel-motion.js";

function fade(color, factor) {
  if (!color || typeof color !== "string") return "#00000000";
  const alpha = color.length === 9 ? parseInt(color.slice(7), 16) : 255;
  return color.slice(0, 7) + Math.round(alpha * factor).toString(16).padStart(2, "0");
}

// The identity glyph comes from the app's program table (`Program.icon`, herdr.d.ts:150):
// tinted glyphs are SVGs, others are pictures — the same pair the shipped agents mod uses.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// Orca's row title falls back through title -> app -> program name; `program.agent` is a
// boolean, never a name (orca-sidebar-projects/main.js:759-763).
const title = (a) => a.title?.trim() || a.app || a.program?.name || "Agent";

// `AgentStateDot` at its default `sm` size (`src/renderer/src/components/AgentStateDot.tsx:105-197`):
// a 10px box (`h-2.5 w-2.5`), a 6px inner dot (`size-1.5`), a 10px glyph (`size-2.5`). Statuses map
// to Herdr's 4-state rollup: working (AgentWorkingSpinner turning 1000ms in t.working),
// blocked (AgentQuestionIcon message-circle-question in t.blocked), done (CircleCheck in
// t.done), and idle (6px dot in t.idle + "66").
function stateDot(status, t) {
  const box = div().size(10).flex_none().flex().items_center().justify_center();
  if (status === "working") {
    return box.child(svg("mods/orca-assets/agent-working-spinner.svg").size(10).flex_none().text_color(t.working).spin(1000));
  }
  if (status === "blocked") {
    return box.child(svg("mods/orca-assets/message-circle-question.svg").size(10).flex_none().text_color(t.blocked));
  }
  if (status === "done") {
    return box.child(svg("mods/orca-assets/circle-check.svg").size(10).flex_none().text_color(t.done));
  }
  return box.child(div().size(6).rounded_full().flex_none().bg(t.idle + "66"));
}

// Scope folders: a session belongs to a scope when its cwd is under the scope folder or above
// it (Orca matches by worktree paths and cwd aliases,
// src/renderer/src/components/right-sidebar/ai-agent-sessions/session-list/ai-agent-sessions-session-filters.ts:20).
function inFolder(root, path) {
  return Boolean(root && path && (path === root || path.startsWith(root + "/") || root.startsWith(path + "/")));
}

// Git cache reader for project/repository resolution across worktrees.
// `git.cache.v2` stores git info keyed by [machine, folder].
function gitCache() {
  try {
    return JSON.parse(localStorage.getItem("git.cache.v2") ?? "{}") ?? {};
  } catch {
    return {};
  }
}

// The checkout paths (top and linked worktrees) of every cached git entry in `repo`.
function addRepoPaths(paths, cache, repo) {
  if (!repo) return;
  for (const g of Object.values(cache)) {
    if (g?.repo !== repo) continue;
    if (g.top) paths.add(g.top);
    for (const wt of g.worktrees ?? []) {
      if (wt.path) paths.add(wt.path);
    }
  }
}

// `git.cache.v2` keys by [machine, folder]; a space opened on a linked worktree may only be
// reachable through the repo entry that lists it (`top`/`worktrees`).
function findActiveGit(cache, activeSpace, projectFolder) {
  const activeKey = JSON.stringify([activeSpace.machine ?? null, projectFolder]);
  return cache[activeKey] ?? Object.values(cache).find(
    (g) => g?.top === projectFolder || (g?.worktrees ?? []).some((wt) => wt.path === projectFolder)
  );
}

// Resolves project scope for active space across linked worktrees and same-repo checkouts.
// Port of Orca's `deriveAiVaultScopeSessionPaths` (ai-agent-sessions-scope-paths.ts:47-95)
// and `buildAiVaultSessionProjectById` (ai-agent-sessions-session-projects.ts:80-120).
function resolveProjectScope(activeSpace, sp) {
  if (!activeSpace) {
    return { projectFolder: null, projectPaths: new Set(), isSameProject: () => false };
  }
  const projectFolder = activeSpace.folder ?? null;
  const cache = gitCache();
  const activeRepo = findActiveGit(cache, activeSpace, projectFolder)?.repo ?? null;
  const projectPaths = new Set();
  if (projectFolder) projectPaths.add(projectFolder);
  addRepoPaths(projectPaths, cache, activeRepo);

  // A space in the same repository (its cached entry names it, or it is a known checkout path).
  const sharesRepo = (space) =>
    cache[JSON.stringify([space.machine ?? null, space.folder])]?.repo === activeRepo
    || Boolean(space.folder && projectPaths.has(space.folder));
  // Spaces belonging to the same repository (share git common-dir or known worktree path)
  // or matching the folder workspace.
  const isSameProject = (space) => {
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

// `formatTimeAgo` (ai-agent-sessions-session-time.tsx:32-74).
function ago(ms) {
  if (!Number.isFinite(ms)) return "Unknown time";
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

// AiVaultSessionListBar.tsx:23-33.
function countLabel(shown, loaded) {
  if (shown !== loaded) return `${shown} of ${loaded} sessions`;
  return `${shown} session${shown === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------------------
// OMP transcript adapter. Root resolution ports `resolveOmpSessionsDir`
// (scanners/omp/omp-session-root.ts:31-79): an explicit OMP_CODING_AGENT_DIR (or the
// inherited PI_ one) may name the agent root or the sessions root, else ~/.omp/agent.
// It runs through POSIX `sh`, the same assumption orca-files/clip.js:11-29 makes; on a
// machine without one the scan rejects and its message is shown as the error row.
// ---------------------------------------------------------------------------------------
// Rows the history lists (the newest sessions) and the time one `exec` may take.
const MAX_SESSIONS = 12;
const SCAN_TIMEOUT_MS = 15000;
// Live agents repaint on a one-second timer; the history re-scans on a minute one.
const REPAINT_MS = 1000;
const RESCAN_MS = 60000;
const OMP_LIST =
  'root="${OMP_CODING_AGENT_DIR:-${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}}"; ' +
  'case "$root" in */sessions) ;; *) root="$root/sessions" ;; esac; ' +
  // One level under the store is one conversation; `<session>.jsonl/` subagent transcripts
  // are one level deeper and are not rows (isOmpConversationDirectory,
  // session-scanner-omp-subagent-transcripts.ts:13).
  `ls -1t "$root"/*/*.jsonl 2>/dev/null | head -n ${MAX_SESSIONS}`;

// The bounded window: a transcript's first record carries id/cwd/title, the tail carries the
// last activity, and `readTextFile` cannot stretch past 1 MiB. A cut line fails JSON.parse
// and is skipped.
const OMP_READ = 'head -c 65536 "$1"; printf "\\n"; tail -c 16384 "$1" | tail -n 2';

// `sessionIdFromFileName` (session-scanner-accumulator.ts:209-213): the trailing UUID.
function sessionIdFromFileName(fileName) {
  const name = fileName.replace(/\.jsonl$/, "");
  const match = name.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  return match ? match[0] : name;
}

// `extractMessageText` (session-scanner-text-normalization.ts): text parts only.
const partText = (part) => {
  if (typeof part === "string") return part;
  return typeof part?.text === "string" ? part.text : "";
};
function messageText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map(partText).join(" ").trim();
}

const TITLE_RECORD_TYPES = new Set(["session", "session_info", "title", "title_change"]);

// Who named the session: `session_info` is always the user; other records say so, or are
// automatic when silent. Null for a source this port does not know.
function titleSourceOf(record) {
  if (record.type === "session_info") return "user";
  const raw = record.source ?? record.titleSource;
  if (raw === undefined) return "auto";
  return raw === "user" || raw === "auto" ? raw : null;
}

// The title a record offers, or null when it offers none.
function titleCandidate(record) {
  if (!TITLE_RECORD_TYPES.has(record.type)) return null;
  if (record.type === "title" && record.v !== 1) return null;
  const value = String((record.type === "session_info" ? record.name : record.title) ?? "").trim();
  const source = titleSourceOf(record);
  if (!value || source === null) return null;
  const parsed = Date.parse(record.type === "title" ? record.updatedAt : record.timestamp);
  return { title: value, source, at: Number.isFinite(parsed) ? parsed : null };
}

// `foldOmpTranscriptTitle` (scanners/omp/session-scanner-omp-title.ts:10-42): a user name
// outranks an automatic one, and the current title slot outranks older rename entries.
function foldTitle(current, record) {
  const next = titleCandidate(record);
  if (!next) return current;
  if (current?.source === "user" && next.source !== "user") return current;
  if (current?.source === next.source && current.at !== null && next.at !== null && next.at < current.at) return current;
  return next;
}

// `updateTimeline` (session-scanner-accumulator.ts:161-176).
function foldTimeline(acc, timestamp) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return;
  if (acc.createdAt === null || parsed < acc.createdAt) acc.createdAt = parsed;
  if (acc.updatedAt === null || parsed > acc.updatedAt) acc.updatedAt = parsed;
}

function foldSessionRecord(acc, record) {
  if (typeof record.id === "string" && record.id.trim()) acc.sessionId = record.id.trim();
  if (acc.cwd === null && typeof record.cwd === "string" && record.cwd.trim()) acc.cwd = record.cwd.trim();
}

function foldMessage(acc, message) {
  const role = message.role;
  if (role !== "user" && role !== "assistant") return;
  const text = messageText(message.content);
  if (role === "user") acc.fallback ??= text;
  else acc.model = message.model || acc.model;
  if (text) acc.preview = { role, text };
}

function foldRecord(acc, record) {
  foldTimeline(acc, record.timestamp);
  acc.named = foldTitle(acc.named, record);
  if (record.type === "session") foldSessionRecord(acc, record);
  else if (record.type === "model_change") acc.model = record.modelId || record.model || acc.model;
  else if (record.type === "message" && record.message) foldMessage(acc, record.message);
}

// A line is a record when it is a JSON object; a cut or foreign line is skipped.
function parseRecordLine(line) {
  if (line.charAt(0) !== "{") return null;
  try {
    const record = JSON.parse(line);
    return record && typeof record === "object" ? record : null;
  } catch {
    return null;
  }
}

// `consumeMessageGraphRecordLine` (scanners/session-scanner-graph-parsers.ts:222-271) for
// agent 'omp'. Dropped: Orca filters harness-injected user turns out of the title
// (`isKnownHarnessInjectedUserTurnText`, shared/harness-injected-user-turns), so a title can
// occasionally be the injected prompt; and messageCount needs the whole file.
function parseOmpSession(path, content) {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  const acc = {
    sessionId: sessionIdFromFileName(fileName), cwd: null, named: null, model: null,
    createdAt: null, updatedAt: null, fallback: null, preview: null,
  };
  for (const line of content.split("\n")) {
    const record = parseRecordLine(line);
    if (record) foldRecord(acc, record);
  }
  return {
    id: acc.sessionId,
    path,
    cwd: acc.cwd,
    // `generatedSessionTitle` (session-scanner-accumulator.ts:157-159): "OMP <id8>".
    title: acc.named?.title || acc.fallback || `OMP ${acc.sessionId.slice(0, 8)}`,
    model: typeof acc.model === "string" ? acc.model : null,
    updatedAt: acc.updatedAt ?? acc.createdAt,
    preview: acc.preview,
  };
}

async function scanOmpSessions() {
  const listing = await exec("sh", ["-c", OMP_LIST], { timeout: SCAN_TIMEOUT_MS });
  const paths = listing.stdout.split("\n").filter(Boolean).slice(0, MAX_SESSIONS);
  const contents = await Promise.all(
    paths.map(async (path) => {
      try {
        const read = await exec("sh", ["-c", OMP_READ, "read", path], { timeout: SCAN_TIMEOUT_MS });
        return [path, read.stdout];
      } catch {
        return [path, ""];
      }
    })
  );
  return contents
    .map(([path, content]) => parseOmpSession(path, content))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}

// A scope that is not available falls back to the next wider one.
function effectiveScopeOf(scope, workspaceAvailable, projectAvailable) {
  if (scope === "workspace" && !workspaceAvailable) return projectAvailable ? "project" : "all";
  if (scope === "project" && !projectAvailable) return "all";
  return scope;
}

// The same scope filter for history rows, by their recorded cwd
// (useAiVaultPanelSessions, src/renderer/src/components/right-sidebar/ai-agent-sessions/session-list/ai-agent-sessions-session-filters.ts:20).
// `projectPaths` is null while no project folder is known.
function scopedHistory(history, scope, activeSpace, projectPaths) {
  if (scope === "workspace" && activeSpace?.folder) {
    return history.filter((s) => inFolder(activeSpace.folder, s.cwd));
  }
  if (scope === "project" && projectPaths) {
    const paths = [...projectPaths];
    return history.filter((s) => s.cwd && paths.some((p) => inFolder(p, s.cwd)));
  }
  return history;
}

// Search over the loaded fields. Orca searches a full-text index built in the main
// process (src/main/ai-agent-sessions-search/session-search-engine.ts); Herdr has no index, so
// this filters the rows the adapter loaded.
function searchedHistory(history, query) {
  if (!query) return history;
  return history.filter((s) =>
    [s.title, s.cwd || "", s.model || "", "omp"].some((value) => value.toLowerCase().includes(query))
  );
}

export default class AgentsPanel extends View {
  init(_props, cx) {
    this.seen = "";
    this.scope = "workspace"; // "workspace" | "project" | "all" (AiVaultPanelControls.tsx:87-160)
    this.search = InputState.new({ placeholder: "Search sessions" });
    this.search.on("change", (_e, changeCx) => changeCx.notify());
    this.history = [];
    this.historyLoading = false;
    this.historyError = null;

    // `agents()` is live but a status change does not notify a mod; orca-sidebar-projects repaints from
    // a timer for exactly this reason (main.js:123-133). One second is enough for a label.
    cx.timer.every(REPAINT_MS, (tickCx) => {
      const now = (agents() ?? []).map((a) => `${a.address}:${a.status}`).join(",");
      if (now === this.seen) return;
      this.seen = now;
      tickCx.notify();
    });

    this.refreshHistory(cx);
    // Orca re-scans on demand and when the panel opens (useAiVaultSessionRefresh); a mounted
    // Herdr mod never "opens", so a slow timer stands in for the open event.
    cx.timer.every(RESCAN_MS, (tickCx) => this.refreshHistory(tickCx));
  }

  refreshHistory(cx) {
    if (this.historyLoading) return;
    this.historyLoading = true;
    cx.spawn(async (jobCx) => {
      try {
        this.history = await scanOmpSessions();
        this.historyError = null;
      } catch (e) {
        this.historyError = String(e?.message ?? e);
      }
      this.historyLoading = false;
      jobCx.notify();
    });
  }

  // Resume for a past session. Orca's omp line is `omp --resume <absolute transcript path>`
  // (src/shared/ai-agent-sessions/resume/ai-agent-sessions-resume-command.ts:33-48 takes the transcript path as the target, :163-175 the
  // base command from TUI_AGENT_CONFIG.omp.detectCmd = "omp", :216-218 the --resume form),
  // run in the folder the session recorded. Herdr's `terminal.open {argv, folder}` starts it
  // in a new tab (src/commands.rs:44) — the "Resume in new tab" action the row offers
  // (AiVaultSessionRow.tsx:83-95). Dropped with no Herdr equivalent: drag-to-resume,
  // resume-in-chat, resume-in-new-CLI, copy id/path, reveal log, delete (all Orca-only).
  // The flag keeps the CLI's documented `--resume=<value>` form (`omp --help`: "Resume a
  // session (by ID prefix, path, or picker if omitted)"), because argv has no shell to glue
  // the value to an optional-value flag.
  resume(session) {
    const args = { argv: ["omp", "--resume=" + session.path] };
    // Recorded cwd, never the focused terminal's folder; Herdr falls back on its own when absent.
    if (session.cwd) args.folder = session.cwd;
    run("terminal.open", args);
  }

  // `AiVaultSessionRow.tsx:155-159`: `flex w-full min-w-0 cursor-pointer flex-col border-b
  // border-sidebar-border px-3 py-2 text-left transition-colors hover:bg-sidebar-accent/55`.
  // Orca's `min-h-[98px]` covers the conversation preview, message counts, time and model;
  // agents() carries none of those, so this row is only its two real lines.
  row(a, t) {
    return h_flex().id(`agent-${a.address}`).w_full().min_w(0).flex_none().px(12).py(8).gap(6).items_start()
      .border_b(1).border_color(t.border).cursor_pointer().hover((s) => s.bg(t.hover))
      .role("button").accessibility_label(`${title(a)} — ${a.status}`)
      .on_click(() => run("agent.focus", { terminal: a.address }))
      .child(v_flex().flex_1().min_w(0)
        // `AiVaultSessionRow.tsx:163-172`: `text-[13px] font-medium leading-5 text-foreground`,
        // clamped to one line while details are collapsed.
        .child(div().min_w(0).truncate().text_size(13).font_medium().line_height("20px").text_color(t.foreground).child(title(a)))
        // `ai-agent-sessions-session-row-display.tsx:55-65`: `mt-1 grid grid-cols-[auto_minmax(0,1fr)]
        // gap-x-1.5 text-[11px] leading-4 text-muted-foreground`, the identity glyph in a
        // `size-4` slot at `size={14}`, then the state dot and the agent label.
        .child(h_flex().mt(4).gap(6).items_center().text_size(11).line_height("16px").text_color(t.muted)
          .child(h_flex().size(16).flex_none().items_center().justify_center().child(icon(a.program, 14, t.muted)))
          .child(stateDot(a.status, t))
          .child(div().min_w(0).truncate().child(a.app || a.program?.name || "agent"))
          // Herdr's real metadata where Orca shows message count, subagent count, time and
          // model: the space and tab the live agent belongs to.
          .child(div().flex_none().text_color(t.dim).child("·"))
          .child(div().min_w(0).truncate().child(a.space_name || a.space))
          .child(div().flex_none().text_color(t.dim).child("·"))
          .child(div().min_w(0).truncate().child(a.tab_name || `tab ${a.tab_index}`))));
  }

  // A past-session row, ported from `AiVaultSessionRow.tsx:155-245` + `SessionMetadata`
  // (ai-agent-sessions-session-row-display.tsx:55-130). The identity glyph comes from a live
  // `program`; a transcript has none and a mod cannot read another folder's icons, so the
  // agent label alone is drawn (`OMP`, AI_VAULT_AGENT_LABELS). The preview is one truncated
  // line: GPUI has no 2-line clamp (`line-clamp-2`). A click resumes, standing in for the
  // row's resume button (the details toggle has no Herdr equivalent).
  // Orca's row id carries the file path (`finalizeSession`,
  // session-scanner-accumulator.ts:116), so one session copied into two project folders still
  // gets distinct rows; keying on the path keeps that identity here.
  historyRow(s, t) {
    return h_flex().id(`session-${s.path}`).w_full().min_w(0).flex_none().px(12).py(8).gap(6).items_start()
      .border_b(1).border_color(t.border).cursor_pointer().hover((st) => st.bg(t.hover))
      .role("button").accessibility_label(`Resume ${s.title}`)
      .on_click(() => this.resume(s))
      .child(v_flex().flex_1().min_w(0)
        .child(div().min_w(0).truncate().text_size(13).font_medium().line_height("20px").text_color(t.foreground).child(s.title))
        // `AiVaultSessionRow.tsx:233-243`: `mt-0.5 ... text-[12px] leading-4 text-muted-foreground`,
        // the role at `font-medium text-foreground/80`, then ": text".
        .child(h_flex().mt(2).w_full().min_w(0).text_size(12).line_height("16px").text_color(t.muted)
          .when(Boolean(s.preview), (e) => e
            .child(div().flex_none().font_medium().text_color(fade(t.foreground, 0.8))
              .child(s.preview.role === "user" ? "You" : "Agent"))
            .child(div().flex_1().min_w(0).truncate().child(`: ${s.preview.text}`)))
          .when(!s.preview, (e) => e.child(div().min_w(0).truncate().child("No conversation preview available"))))
        .child(h_flex().mt(4).gap(6).items_center().text_size(11).line_height("16px").text_color(t.muted)
          .child(div().flex_none().child("OMP"))
          .child(div().flex_none().text_color(t.dim).child("·"))
          .child(div().flex_none().child(ago(s.updatedAt)))
          .when(Boolean(s.model), (e) => e
            .child(div().flex_none().text_color(t.dim).child("·"))
            .child(div().min_w(0).truncate().child(s.model)))
          .child(div().flex_none().text_color(t.dim).child("·"))
          .child(div().min_w(0).truncate().child(s.cwd || "unknown folder"))));
  }

  // `VaultGroupHeader` (AiVaultPanelControls.tsx:57-85): `flex h-8 w-full items-center gap-2
  // border-y border-sidebar-border bg-sidebar-accent/60 px-3 text-xs font-semibold` plus a
  // count badge. The chevron/collapse toggle is dropped: it would need an icon asset this
  // mod does not ship, and the lists are short.
  groupHeader(label, count, t) {
    return h_flex().w_full().h(32).flex_none().items_center().gap(6).px(12)
      .border_t(1).border_b(1).border_color(t.border).bg(fade(t.raised, 0.6))
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().child(label))
      .child(div().flex_none().px(6).py(2).rounded(4).border_1().border_color(t.border)
        .bg(t.background).text_size(11).font_semibold().child(String(count)));
  }

  // Ports Orca's `VaultScopeSwitch` (AiVaultPanelControls.tsx:87-160): ToggleGroup outline variant,
  // h-7 rounded-md border border-sidebar-border bg-sidebar-accent/35 shadow-xs (VAULT_SCOPE_TOGGLE_ITEM_CLASS:55).
  scopeSwitch(scope, workspaceAvailable, projectAvailable, t) {
    const seg = (key, label, available) => {
      const active = scope === key;
      return div().id(`agent-sessions-scope-${key}`).flex_1().min_w(0).h(24).flex().items_center().justify_center()
        .rounded(4).px(6).text_size(11).font_medium()
        .when(active, (e) => e.bg(fade(t.foreground, 0.1)).text_color(t.foreground).border_1().border_color(t.border))
        .when(!active && available, (e) => e.text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .when(!available, (e) => e.text_color(t.dim).opacity(0.4))
        .on_click((_e, clickCx) => {
          if (!available || this.scope === key) return;
          this.scope = key;
          clickCx.notify();
        })
        .child(label);
    };

    return h_flex().w_full().p(2).gap(2).rounded(6).border_1().border_color(t.border).bg(fade(t.raised, 0.4))
      .child(seg("workspace", "Workspace", workspaceAvailable))
      .child(seg("project", "Project", projectAvailable))
      .child(seg("all", "All", true));
  }

  // Ports Orca's search bar in `AiVaultPanelHeader.tsx:161-202`: h-8 rounded-md border border-sidebar-border
  // bg-input/50 px-2 with Search glyph and clear button.
  searchBar(t) {
    const q = this.search.value();
    return h_flex().w_full().h(30).px(8).gap(6).items_center().rounded(6)
      .border_1().border_color(t.border).bg(fade(t.input, 0.4))
      .child(svg("mods/orca-assets/search--orca-right-sidebar-agents.svg").size(13).flex_none().text_color(t.muted))
      .child(Input.new(this.search).flex_1().min_w(0).text_size(12).text_color(t.foreground).bg("#00000000"))
      .when(Boolean(q), (e) => e.child(
        div().id("agents-search-clear").size(18).flex_none().flex().items_center().justify_center()
          .rounded(4).cursor_pointer().text_color(t.muted).hover((s) => s.text_color(t.foreground).bg(t.hover))
          .on_click((_e, clickCx) => {
            this.search.set_value("");
            clickCx.notify();
          })
          .child(svg("mods/orca-assets/x--orca-files.svg").size(12))
      ));
  }

  // Unified layout: a narrowing panel keeps this content at its open width (see panel-motion.js).
  render() { return panelFrame(this.renderBody()); }

  renderBody() {
    const t = theme();
    const sp = spaces() ?? [];
    const activeSpace = sp.find((s) => s.active);
    const workspaceAvailable = Boolean(activeSpace);
    const { projectFolder, projectPaths, isSameProject } = resolveProjectScope(activeSpace, sp);
    const projectAvailable = Boolean(projectFolder);
    const effectiveScope = effectiveScopeOf(this.scope, workspaceAvailable, projectAvailable);

    // Filter by scope (AiVaultPanel.tsx:140-148, deriveAiVaultScopeSessionPaths,
    // ai-agent-sessions-scope-paths.ts:47-95).
    let filtered = agents() ?? [];
    if (effectiveScope === "workspace" && activeSpace) {
      filtered = filtered.filter((a) => a.space === activeSpace.id);
    } else if (effectiveScope === "project" && projectAvailable) {
      filtered = filtered.filter((a) => isSameProject(sp.find((x) => x.id === a.space)));
    }
    const history = searchedHistory(
      scopedHistory(this.history, effectiveScope, activeSpace, projectAvailable ? projectPaths : null),
      this.search.value().trim().toLowerCase());

    return v_flex().id("agents").size_full().min_h(0).overflow_hidden().text_color(t.foreground)
      // `AiVaultPanelHeader.tsx:94-108`: title "Agent Session History", subtitle
      // "Resume past sessions" (the <300px compact copy is a container-query variant with
      // no Herdr counterpart and is not ported).
      .child(v_flex().flex_none().px(10).py(8).gap(8).border_b(1).border_color(t.border)
        .child(v_flex().w_full().min_w(0)
          .child(div().truncate().text_size(12).font_semibold().child("Agent Session History"))
          .child(div().truncate().text_size(11).text_color(t.muted).child("Resume past sessions")))
        .child(this.scopeSwitch(effectiveScope, workspaceAvailable, projectAvailable, t))
        .child(this.searchBar(t)))
      // `AiVaultSessionListBar.tsx:50-54`: `flex h-8 shrink-0 items-center gap-2 border-y
      // border-sidebar-border bg-sidebar-accent/60 pl-3 pr-1.5`, 12px semibold count. The
      // sort dropdown (:56-87) is not ported; rows stay in Orca's default "updated" order.
      .child(h_flex().h(32).flex_none().items_center().pl(12).pr(6).border_b(1)
        .border_color(t.border).bg(fade(t.raised, 0.6))
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold()
          .child(countLabel(history.length, this.history.length))))
      .child(this.sessionList(t, filtered, history));
  }

  sessionList(t, filtered, history) {
    return v_flex().id("agents-list").flex_1().min_h(0).overflow_y_scrollbar()
      // Orca's agent-sessions has no live section: a live agent is a dot on its history row
      // (AiVaultSessionRow.tsx:82-91). Herdr's live list is kept above the history under
      // its own header — this grouping is ours, not Orca's.
      .child(this.groupHeader("Live agents", filtered.length, t))
      .children(filtered.map((a) => this.row(a, t)))
      .when(!filtered.length, (el) =>
        el.child(h_flex().px(12).py(6).text_size(11).text_color(t.muted).child("No live agents"))
      )
      .child(this.groupHeader("Past sessions", history.length, t))
      .when(this.historyError, (el) =>
        el.child(v_flex().px(12).py(8).text_size(11).text_color(t.blocked).child(this.historyError))
      )
      // `SessionLoadingState` (AiVaultSessionListStates.tsx:4-30) label; the six skeleton
      // rows are pure decoration and are not drawn.
      .when(this.historyLoading && !this.history.length, (el) =>
        el.child(h_flex().px(12).py(12).gap(6).items_center().text_size(11).text_color(t.muted)
          .child(svg("mods/orca-assets/agent-working-spinner.svg").size(14).flex_none().text_color(t.working).spin(1000))
          .child("Scanning sessions"))
      )
      .children(history.map((s) => this.historyRow(s, t)))
      // `AiVaultSessionVirtualList.tsx:260-286`: the empty titles.
      .when(!this.historyLoading && !history.length, (el) =>
        el.child(v_flex().size_full().items_center().justify_center().px(16).text_color(t.muted)
          .child(div().mb(12).opacity(0.5).child(svg("mods/orca-assets/archive-restore.svg").size(28)))
          .child(div().text_size(14).font_medium().text_center()
            .child(this.history.length ? "No sessions match the current filters" : "No agent sessions found")))
      );
  }
}
