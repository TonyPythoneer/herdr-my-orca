// Derived from Herdr App's defaults/mods/files/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
// A lazy file browser for the active space's folder, with bounded previews; local files under 400 KB are editable.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list, Scrollbar, VirtualListScrollHandle, Input, InputState, Editor, EditorState } from "gpui-base";
import { spaces, exec, readTextFile, writeTextFile, watchFolder, theme, settings, window, props, run, openOverlay, closeOverlay, shared, setShared, nextCommand, appHome } from "herdr";
import { copyText, reveal } from "./clip.js";
import { deleteTarget } from "./delete-target.js";
import { mutateFile } from "./file-mutation.js";
import { queueSave } from "./save-queue.js";
import { canEditPath, writeEditorFile } from "./editor-path.js";
import { resolveTreeKey } from "./tree-nav.js";
import { splitGlobs, searchResults } from "./text-search.js";
import { parseStatus } from "./git-status.js";
import { panelFrame } from "./panel-motion.js";
import { SPIN_PERIOD_MS } from "./ui-settings.js";

const plat = () => (typeof window === "function" ? window()?.platform : null);
// The entry of `table` for the host platform, or `fallback`.
const byPlatform = (table, fallback) => Object.hasOwn(table, plat()) ? table[plat()] : fallback;

// "Open in" lists the apps the system offers for the file (macOS: LaunchServices, what Finder's
// Open With shows), not a built-in list. Orca keeps its own `openInApplications` setting instead;
// the nearest Herdr has is <app home>/open-in-apps.json ([{ "label", "app": "/Applications/X.app" }]):
// when it exists it replaces the system list, and "Customize apps…" seeds and opens it.
// shortcut: macOS only; other platforms get an empty list until they have a lookup.
const openInFile = () => `${appHome()}/open-in-apps.json`;
const OPEN_WITH = 'ObjC.import("AppKit"); function run(argv) { const a = $.NSWorkspace.sharedWorkspace.URLsForApplicationsToOpenURL($.NSURL.fileURLWithPath(argv[0])), out = []; for (let i = 0; i < a.count; i++) out.push(ObjC.unwrap(a.objectAtIndex(i).path)); return out.join("\n"); }';
async function systemApps(full) {
  if (plat() !== "macos") return [];
  const r = await exec("osascript", ["-l", "JavaScript", "-e", OPEN_WITH, full]).catch(() => null);
  return (r?.stdout ?? "").split("\n").filter(Boolean).map(app => ({ label: app.replace(/^.*\//, "").replace(/\.app$/, ""), app }));
}
async function openInApps(full) {
  try {
    const list = JSON.parse(await readTextFile(openInFile(), null));
    if (Array.isArray(list) && list.length) return list.filter(a => a?.label && a?.app);
  } catch { /* Missing or invalid preferences fall back to the system list. */ }
  return systemApps(full);
}

// herdr's JS has no ICU collation: localeCompare orders by code point (README before keys). Orca sorts case-insensitively.
function compareNames(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function compareEntries(a, b) {
  return Number(b.dir) - Number(a.dir) || compareNames(a.name.toLowerCase(), b.name.toLowerCase()) || compareNames(a.name, b.name);
}

// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

// Orca scopes the panel to the project/workspace folder (FileExplorer.tsx:93,
// GLOSSARY.md: "The space is the scope; the terminal is only where keystrokes go").
// The file tree stays rooted in space.folder; terminal cwd changes never re-root the explorer.
function location() {
  const space = (spaces() ?? []).find(s => s.active);
  return { cwd: space?.folder ?? null, on: space?.machine ?? null, space: space?.id };
}
let mainFilesView = null;
const workspaceKey = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;
const REFRESH_INTERVAL_MS = 10000, SEARCH_DEBOUNCE_MS = 200, AUTOSAVE_DELAY_MS = 800;
const MAX_LISTED_PATHS = 20001, MAX_NAME_QUERY_LENGTH = 2048, MAX_TREE_DEPTH = 40;
const MAX_PREVIEW_CHARS = 400000;

// Orca mixes the accent at 70%/80% and uses `bg-input/50` (FileExplorerNameFilter.tsx:23,
// main.css:1453-1471). Herdr stores colors as `#rrggbb[aa]`, so scale the alpha.
function fade(color, factor) {
  const alpha = color.length === 9 ? parseInt(color.slice(7), 16) : 255;
  return color.slice(0, 7) + Math.round(alpha * factor).toString(16).padStart(2, "0");
}

// Orca's FileTypeIcon tables (file-type-icons.ts:24-54, file-type-icon-extension-table.ts,
// file-type-icon-name-table.ts). Grouped by icon so the port stays one table, not two hundred.
const FILE_ICONS = Object.assign(Object.create(null), {
  "file-code": "astro c cc clj cjs cpp cs cts cxx dart erl ex exs fs fsx go h hpp hrl hs htm html java js jsx kt kts lua mjs mts nim php pl pm py r rb rs scala sol svelte swift ts tsx vb vue xhtml xml zig",
  "file-archive": "7z br bz2 dmg gz iso rar tar tbz2 tgz txz xz zip",
  "file-image": "ai avif bmp eps gif heic ico jpeg jpg png psd svg tif tiff webp",
  "file-text": "adoc doc docx log md mdx pdf qmd rmarkdown rmd rst rtf tex txt",
  "file-sliders": "cfg conf hcl ini properties tf tfvars toml yaml yml",
  "file-type": "css eot less otf sass scss ttf woff woff2",
  "file-video": "avi m4v mkv mov mp4 mpeg mpg webm",
  "file-music": "aac flac m4a mp3 ogg opus wav",
  "file-key": "asc cer crt gpg key pem pub",
  "database": "db duckdb prisma sql sqlite sqlite3",
  "file-spreadsheet": "csv ods tsv xls xlsx",
  "file-chart-column": "ipynb mmd ppt pptx",
  "file-json": "json json5 jsonc",
  "file-braces": "gql graphql proto",
  "file-diff": "diff patch",
  "file-terminal": "bash bat cmd fish nu ps1 sh zsh",
  "file-cog": "gradle",
  "file-axis-3d": "blend fbx glb gltf obj stl",
  "file-lock": "lock p12 pfx",
});
const FILE_ICON_EXT = Object.create(null), FILE_ICON_NAME = Object.create(null);
for (const [icon, list] of Object.entries(FILE_ICONS)) for (const ext of list.split(" ")) FILE_ICON_EXT[ext] = icon;
for (const [icon, list] of Object.entries({
  "file-sliders": ".babelrc .dockerignore .editorconfig .eslintrc .eslintrc.cjs .eslintrc.js .eslintrc.yaml .eslintrc.yml .gitattributes .gitignore .npmrc .prettierrc .prettierrc.yaml .prettierrc.yml components.json postcss.config.cjs postcss.config.js postcss.config.mjs postcss.config.ts tailwind.config.cjs tailwind.config.js tailwind.config.mjs tailwind.config.ts tsconfig.json vite.config.js vite.config.mjs vite.config.ts vitest.config.js vitest.config.mjs vitest.config.ts",
  "file-json": ".eslintrc.json .prettierrc.json",
  "file-text": "agents.md authors changelog changelog.md contributing contributing.md readme readme.md todo",
  "file-box": "bun.lock bun.lockb cargo.lock cargo.toml composer.json composer.lock gemfile go.mod go.sum package-lock.json package.json pipfile pnpm-lock.yaml pnpm-workspace.yaml poetry.lock pom.xml pyproject.toml requirements-dev.txt requirements.txt yarn.lock",
  "file-key": "codeowners copying license notice",
  "file-lock": "security security.md",
  "file-cog": "cmakelists.txt dockerfile meson.build settings.gradle settings.gradle.kts",
  "file-terminal": "makefile",
})) for (const name of list.split(" ")) if (name) FILE_ICON_NAME[name] = icon;
// getExtension + getFileTypeIcon (file-type-icons.ts:14-54): compound suffix first, then the
// last dot, `.env`/Dockerfile/Makefile special cases, and File as the fallback.
function fileIcon(name) {
  const lower = name.toLowerCase(), dot = lower.lastIndexOf(".");
  if (FILE_ICON_NAME[lower]) return FILE_ICON_NAME[lower];
  if (lower === ".env" || lower.startsWith(".env.")) return "file-lock";
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "file-cog";
  if (lower === "makefile" || lower.startsWith("makefile.")) return "file-terminal";
  for (const compound of ["tar.bz2", "tar.gz", "tar.xz"]) if (lower.endsWith(`.${compound}`)) return "file-archive";
  return (dot > 0 ? FILE_ICON_EXT[lower.slice(dot + 1)] : undefined) ?? "file";
}

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))); link=($_.LinkType -ne $null) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  // `l`: a link to a non-directory, so the row can draw Link (FileExplorerRow.tsx:219-220).
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; elif [ -L "$p" ]; then kind=l; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d", link: fields[i] === "l" });
  return out;
}

// Git decoration tones, `git-path-decoration.ts:5-12` -> main.css:489-496 (dark).
function gitTone(mark, t) {
  switch (mark) {
    case "A": return "#81b88b";               // added
    case "D": return "#c74e39";               // deleted
    case "M": return "#e2c08d";               // modified
    case "R": case "U": case "C": return "#73c991"; // renamed / untracked / copied
    case "!": return "#808080";               // ignored
    default: return t.dim;
  }
}

// Toolbar filter state is shared because the More menu opens as a second copy of this mod
// (openOverlay instantiates it again); keyed by root like Orca's per-worktree store
// (FileExplorer.tsx:73-74). Both default true, as Orca does
// (FileExplorer.tsx:73-74, useFileExplorerVisibleRowProjection.ts:167).
function filters(root) {
  const all = shared("orca-files.filters") ?? {};
  return { dotfiles: all[root]?.dotfiles ?? true, ignored: all[root]?.ignored ?? true };
}
function setFilter(root, name, value) {
  const all = shared("orca-files.filters") ?? {};
  setShared("orca-files.filters", { ...all, [root]: { ...(all[root] ?? {}), [name]: value } });
}

// New File / New Folder: the shell mode and the prompt title.
const NEW_ITEM = { "new-file": ["touch", "New File"], "new-folder": ["mkdir", "New Folder"] };

function confirmDelete(loc, full) {
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return openOverlay({ mod: "orca-confirm", kind: "dialog", width: 420, height: 180,
    props: { title: "Delete?", detail: `${full}\nHost: ${loc.on ?? "local"}`,
      confirmShared: { key: `orca-files.target.${token}`, value: { ...loc, path: full } },
      command: { name: `orca-files.remove-${token}` } } });
}

// ⌘⌥C copies the row's path (⇧ for the relative one); ⌘Backspace alone asks to delete it.
const isCopyPathKey = (e, mods) => mods.platform && mods.alt && e.key === "c";
const isDeleteKey = (e, mods) => mods.platform && e.key === "backspace" && !mods.control && !mods.alt && !mods.shift;

const centeredBox = () => div().flex_1().flex().items_center().justify_center();
const statusMessage = (t, text) => centeredBox().px(16).text_center().text_size(11).text_color(t.muted).child(text);
const spinner = (t) => svg("mods/orca-files/loader-circle.svg").size(16).flex_none().text_color(t.muted).spin(SPIN_PERIOD_MS);

function previewPath(path, root) {
  if (path.startsWith("/")) return path;
  return root ? `${root.replace(/\/+$/, "")}/${path}` : null;
}

export default class Files extends View {
  init(_props, cx) {
    if (!props()?.tab) mainFilesView = this;
    this.saved = new Map(); this.drafts = new Map(); this.doc = null;
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.ignored = new Set(); this.git = false; this.folderMarks = {}; this.folderErrors = {};
    this.inputHandle = cx.focus_handle();
    // Keyboard navigation follows Orca's explorer keys (useFileExplorerKeys.ts): the tree
    // owns the keyboard while it is focused, so terminal and query inputs keep theirs.
    this.treeFocus = cx.focus_handle(); this.treeScroll = VirtualListScrollHandle.new();
    this.selected = null; this.visible = [];
    this.hits = null; this.searching = false; this.qFocused = false; this.view = "files";
    // `tab.new { mod: "orca-files", props: { file } }` / `pane.split { …, props: { file } }`
    // open the pane already showing that file — the Herdr stand-in for Orca's `openFile`
    // (open-uncommitted-entry.ts:6-36). Consumed once in `refresh`, below.
    this.propFile = props()?.file ?? null;
    // SearchResultsPane.tsx:22-23 — collapsedFiles is per-worktree search state; the
    // collapsed file rows stay collapsed until the query or worktree changes.
    this.collapsedSearch = new Set();
    // FileExplorerViewSwitch.tsx:21-41 — Names filters the tree by name, Contents searches
    // file text; both inputs stay mounted, as FileExplorer.tsx:294-309 keeps them.
    // Names matches a flat worktree listing (use-file-explorer-name-filter.ts:45-50), cached
    // in `names` and projected into `nfMap`; `nfCollapsed` is nameFilterCollapsedPaths.
    this.names = null; this.nfMap = null; this.nfCollapsed = new Set(); this.nfLoading = false;
    this.name = InputState.new({ placeholder: "Find files" }); // FileExplorerNameFilter.tsx:39
    // A new query blanks the projection and shows the listing spinner, as Orca's
    // `relativePaths: null` does while `nameFilterFiles.loading` (use-file-explorer-name-filter.ts:57-61).
    this.name.on("change", (_e, eventCx) => {
      if (this.name.value().trim()) { this.nfMap = null; this.nfLoading = true; }
      eventCx.notify(); this.scheduleName(eventCx);
    });
    // SearchQueryRow.tsx:53 — the Contents input's placeholder is `Search`.
    this.q = InputState.new({ placeholder: "Search" });
    // SearchQueryRow.tsx:12-20 / SearchFilters.tsx:9-13 — Contents owns three match toggles
    // and the include/exclude pair. Orca keeps them per worktree in the file-search store
    // (useFileSearchPanel.ts:47-51); here they live on the view and reset in refresh().
    this.caseSensitive = false; this.wholeWord = false; this.useRegex = false;
    this.include = InputState.new({ placeholder: "e.g. *.ts, src/**" });   // SearchFilters.tsx:76-79
    this.exclude = InputState.new({ placeholder: "e.g. *.min.js, dist/**" }); // SearchFilters.tsx:97-100
    this.filtersOpen = false; // SearchFilters.tsx:31 — defaultOpen is activeCount > 0
    // useFileSearchPanel.ts:294-300 — a filter edit reruns the current query at once.
    for (const state of [this.include, this.exclude]) state.on("change", (_e, eventCx) => this.rerun(eventCx));
    // Debounce through `cx.timer.after`, not `setTimeout`: a `cx` captured in a
    // `setTimeout` closure is stale by the time it fires, and the runtime rejects it
    // ("cx is no longer valid…", `scope.rs:420`). A rejected build makes the shell
    // replace the pane with its "could not be re-rendered" banner — which is the
    // orange 2px bar at the top of the sidebar that appeared while typing.
    // `cx.timer.after` hands each callback a fresh context (`typings.rs:3914-3921`).
    this.searchTimer = null; this.searchGeneration = 0;
    this.q.on("change", (_e, eventCx) => this.rerun(eventCx));
    // `focus-within:border-ring ring-1 ring-ring` (FileExplorerNameFilter.tsx:23): GPUI has no
    // `:focus-within` or ring, so the input's own focus events paint the border in ring colour.
    this.q.on("focus", (_e, eventCx) => { this.qFocused = true; eventCx.notify(); });
    this.q.on("blur", (_e, eventCx) => { this.qFocused = false; eventCx.notify(); });
    this.input = InputState.new({ placeholder: "Name" });
    this.input.on("change", (_e, eventCx) => eventCx.notify());
    this.input.on("submit", (_e, eventCx) => { void this.apply(this.input.value(), eventCx); eventCx.notify(); });
    this.refresh(cx);
    cx.timer.every(REFRESH_INTERVAL_MS, timerCx => this.refresh(timerCx));
    cx.spawn(async taskCx => {
      for (;;) {
        const c = await nextCommand();
        if (c) {
          try { await this.command(c, taskCx); }
          catch { /* A failed action must allow the next command to run. */ }
        }
        taskCx.notify();
      }
    });
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async taskCx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(taskCx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && workspaceKey() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort(compareEntries));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  switchWorkspace({ cwd, on, key: next }, cx) {
    this.searchGeneration++; this.searchTimer?.cancel(); this.searchTimer = null;
    if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
    const saved = this.saved.get(next);
    this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
    this.pending = new Set(); this.marks = {}; this.folderMarks = {}; this.folderErrors = {};
    this.ignored = new Set(); this.git = false;
    this.names = null; this.nfMap = null; this.nfCollapsed = new Set(); this.nfLoading = false;
    // The file-search store is per worktree (useFileSearchPanel.ts:43-51), so the match
    // toggles and patterns start empty again for the worktree being entered.
    this.caseSensitive = false; this.wholeWord = false; this.useRegex = false;
    this.include.set_value(""); this.exclude.set_value(""); this.filtersOpen = false;
    this.hits = null; this.searching = false; this.collapsedSearch = new Set();
    this.selected = null; this.visible = [];
    this.show(null); this.watched = null; this.error = null; this.limited = false;
    this.loading = false;
    if (saved?.file) this.show(saved.file, cx);
    if (this.propFile) { this.show(this.propFile, cx); this.propFile = null; }
  }

  refresh(cx) {
    const { cwd, on } = location(), next = workspaceKey();
    if (next !== this.context?.key) this.switchWorkspace({ cwd, on, key: next }, cx);
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    this.names = null; // a fresh listing each cycle picks up files the filter must see
    cx.notify();
    cx.spawn(async taskCx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const { decorations, git } = await this.gitDecorations(cwd, on);
        if (!this.current(context)) return;
        Object.assign(this, decorations);
        this.git = git;
        this.error = null; this.watch(cwd, taskCx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally {
        if (this.context === context) this.loading = false;
        if (this.view === "files" && this.name.value().trim()) this.scheduleName(taskCx);
        taskCx.notify();
      }
    });
  }

  // The git marks for the tree, from `git rev-parse` and `git status`; both stay empty outside a repository.
  async gitDecorations(cwd, on) {
    const top = await exec("git", [...READ, "rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
    // Status keys are relative to `this.root`, as Orca looks them up by `relativePath`
    // (FileExplorerVirtualRows.tsx:198-232): the tree root is the space folder,
    // which can sit below the repo root `git rev-parse` reports.
    const posix = p => p.replace(/\\/g, "/").replace(/\/+$/, "");
    const root = posix(this.root ?? ""), base = top?.stdout.trim() ? posix(top.stdout.trim()) : "";
    let stdout = "";
    if (top?.code === 0) {
      // Keep ignored rows and rename/copy pairs for the tree decorations.
      const status = await exec("git", [...READ, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"], { cwd, on }).catch(() => null);
      if (status?.code === 0) stdout = status.stdout;
    }
    return { decorations: parseStatus(stdout, base, root, TOTAL), git: top?.code === 0 };
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
        delete this.folderErrors[folder];
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async taskCx => {
          try { await this.loadFolder(path, context); delete this.folderErrors[path]; }
          catch (e) { if (this.current(context)) this.folderErrors[path] = String(e); }
          finally { if (this.context === context) this.pending.delete(path); taskCx.notify(); }
        });
      }
    }
    cx.notify();
  }

  // canCollapseAll is files-view only and never under a name filter
  // (FileExplorer.tsx:150, handleCollapseAll :151-157); collapsing drops the expanded
  // folders and their cached listings, as `toggle` does. Under a name filter the tree is
  // `nfMap`, so clearing `folders` would change nothing on screen.
  collapseAll(cx) {
    if (this.view !== "files" || this.name.value().trim() || !this.folders.size) return;
    for (const folder of this.folders) this.entries.delete(folder);
    this.folders.clear();
    cx.notify();
  }

  // `isPathIgnored`: the path or any ancestor (git-path-decoration.ts:90-108). The ignored
  // set is keyed relative to the tree root, like the marks.
  isGitIgnored(path) {
    if (!this.git || !this.ignored.size) return false;
    for (let p = path; ;) {
      if (this.ignored.has(p)) return true;
      const i = p.lastIndexOf("/");
      if (i < 0) return false;
      p = p.slice(0, i);
    }
  }

  // Debounced like the Contents input above: a keystroke must not re-list the worktree.
  scheduleName(cx) {
    this.nfTimer?.cancel();
    const query = this.name.value().trim();
    if (!query) {
      this.nfMap = null; this.nfCollapsed = new Set(); this.nfLoading = false;
      cx.notify();
      return;
    }
    this.nfTimer = cx.timer.after(SEARCH_DEBOUNCE_MS, timerCx => { timerCx.spawn(taskCx => this.nameMatches(taskCx)); });
  }

  // The listing behind Names: one `git ls-files` (tracked + untracked, ignored included —
  // the toggle filters later) or `rg --files` outside git, NUL-separated, capped at
  // Orca's QUICK_OPEN_LISTING_MAX_RESULTS (quick-open-listing-limits.ts:2). Cached per root
  // so narrowing a query reuses it; every `refresh` drops it for a fresh listing.
  async fileList() {
    const key = `${this.root ?? ""}\n${this.git}`;
    if (this.names?.key === key) return this.names.paths;
    const root = this.root;
    if (!root) return [];
    let paths = [];
    if (this.git) {
      const r = await exec("git", [...READ, "ls-files", "-z", "-c", "-o"], { cwd: root, on: this.on }).catch(() => null);
      if (r?.code === 0) paths = r.stdout.split("\0");
    }
    if (!paths.length) {
      const r = await exec("rg", ["--files", "--hidden", "--no-ignore", "--null"], { cwd: root, on: this.on }).catch(() => null);
      // rg exits 2 when one directory is unreadable and still prints every other path;
      // a non-zero code is not an empty listing. Orca keeps the partial listing and only
      // marks the host scan failed (quick-open-file-list.ts:263-265 `hostFilterFailed`).
      if (r?.stdout) paths = r.stdout.split("\0").map(p => p.replace(/^\.\//, ""));
    }
    // `.git` never enters the tree (directory() skips it).
    paths = paths.filter(p => p && p !== "." && p !== ".git" && !p.startsWith(".git/")).slice(0, MAX_LISTED_PATHS);
    this.names = { key, paths };
    return paths;
  }

  // createNameFilteredFileExplorerProjection (:111-194): a matching file keeps every
  // ancestor directory; dotfiles and ignored paths follow the same two toggles (:149-154);
  // all query tokens must appear in the relative path (file-name-filter-tokens.ts:50-60);
  // over FILE_NAME_FILTER_QUERY_MAX_BYTES (2 KiB) nothing matches (:5).
  async nameMatches(cx) {
    const query = this.name.value().trim(), context = this.context;
    if (!query) { this.nfMap = null; this.nfCollapsed = new Set(); this.nfLoading = false; cx.notify(); return; }
    const f = filters(this.root);
    this.nfLoading = true; cx.notify();
    if (query.length > MAX_NAME_QUERY_LENGTH) { // FILE_NAME_FILTER_QUERY_MAX_BYTES, approximated by string length
      this.nfMap = new Map(); this.nfLoading = false; cx.notify(); return;
    }
    // Tokens are whitespace-split and lowercased by splitFileNameFilterTokens (:15-32).
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean), paths = await this.fileList();
    if (!this.current(context) || this.name.value().trim() !== query) return;
    this.nfMap = this.nameProjection(paths, f, tokens); this.nfLoading = false;
    cx.notify();
  }

  matchesName(rel, f, tokens) {
    if (!f.dotfiles && rel.split("/").some(s => s.length > 1 && s.startsWith("."))) return false;
    if (!f.ignored && this.isGitIgnored(rel)) return false;
    if (this.marks[rel] === "D") return false; // the index still lists an unstaged deletion
    const hay = rel.toLowerCase();
    return tokens.every(token => hay.includes(token));
  }

  nameProjection(paths, f, tokens) {
    const map = new Map(), seen = new Set(), add = (prefix, name, dir) => {
      const id = `${prefix}\0${name}`;
      if (seen.has(id)) return;
      seen.add(id);
      const list = map.get(prefix) ?? [];
      list.push({ name, dir }); map.set(prefix, list);
    };
    let count = 0;
    for (const rel of paths) {
      if (count >= TOTAL) break;
      if (!this.matchesName(rel, f, tokens)) continue;
      count++;
      const parts = rel.split("/");
      let prefix = "";
      for (let i = 0; i < parts.length - 1; i++) { add(prefix, parts[i], true); prefix = prefix ? `${prefix}/${parts[i]}` : parts[i]; }
      add(prefix, parts[parts.length - 1], false);
    }
    // appendNameFilteredEntries (:196-205) sorts directories first, then by name.
    for (const list of map.values()) list.sort(compareEntries);
    return map;
  }

  // nameFilterCollapsedPaths (use-file-explorer-name-filter.ts:15): the filtered tree opens
  // every ancestor of a match; a click collapses just that branch.
  nameToggle(path, cx) {
    if (this.nfCollapsed.has(path)) this.nfCollapsed.delete(path); else this.nfCollapsed.add(path);
    cx.notify();
  }

  // Orca's fallback is `basename(worktreePath)` (FileExplorer.tsx:93); Herdr has no
  // repo displayName.
  repo() {
    return this.root ? this.root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "" : "";
  }

  // Edits write straight to disk (like agent-config): 800 ms after the last keystroke, and on leaving the file.
  // `expected` is the text last read or written, so a file changed on disk meanwhile is refused, not overwritten.
  edited(doc, cx) {
    if (this.doc !== doc) return;
    doc.failure = null;
    const v = ++doc.ver;
    doc.status = "editing";
    cx.timer.after(AUTOSAVE_DELAY_MS, (timerCx) => { if (this.doc === doc && doc.ver === v) this.save(doc, timerCx); });
    cx.notify();
  }

  save(doc, cx) {
    const text = this.code.value(), v = doc.ver;
    cx.spawn(async (taskCx) => {
      try { await queueSave(doc, text, (_path, value, expected) => writeEditorFile(doc, value, expected, exec, writeTextFile)); if (doc.ver === v) doc.status = "saved"; }
      catch (e) { doc.status = "failed"; doc.error = String(e); }
      taskCx.notify();
    });
  }

  // Leaving a file (another file, back, a new workspace) writes what is still pending. `doc.full` is fixed at
  // open: by the time a workspace switch gets here `this.root` already points at the new one.
  flush() {
    const doc = this.doc;
    if (!doc || !this.code) return;
    const text = this.code.value();
    const draft = { text, disk: doc.disk, error: doc.error ?? "Save pending" };
    this.drafts.set(doc.full, draft);
    return queueSave(doc, text, (_path, value, expected) => writeEditorFile(doc, value, expected, exec, writeTextFile)).then(() => {
      if (this.drafts.get(doc.full) === draft) {
        this.drafts.delete(doc.full);
        if (this.viewDraft?.draft === draft) { this.reloadDraft = this.viewDraft; run("orca-files.refresh"); }
      }
    }).catch((e) => {
      draft.error = String(e);
      this.operationError = "An unsaved draft is retained in memory. Reopen its file to copy it.";
      run("orca-files.refresh");
      throw e;
    });
  }

  // A pane, tab or layout slot closing. Best effort: only `exec` and `terminal.kill` are promised to finish on app quit.
  async close() { await this.flush(); }

  show(path, cx) {
    this.flush()?.catch(() => { /* flush retains the draft and publishes its error. */ });
    this.code?.release(); this.code = null; this.doc = null; this.file = path; this.fileError = null; this.viewDraft = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async taskCx => {
      try { await this.loadPreview(path, { context, root, on }); }
      catch { if (this.previewCurrent(path, context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { taskCx.notify(); }
    });
  }

  async loadPreview(path, { context, root, on }) {
    const full = previewPath(path, root);
    if (!full) { this.fileError = "Select a workspace to open this file"; return; }
    const read = await this.readPreview(path, full, { context, on });
    if (!read) return;
    const { text, draft } = read;
    if (text === null && !draft) { this.fileError = "This file is no longer available"; return; }
    const content = draft?.text ?? text;
    if (content.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
    const make = this.previewEditor(path, content, draft);
    const pathSafe = this.canCheckPath(on, draft, content) ? await canEditPath(root, full, exec) : false;
    if (!this.previewCurrent(path, context)) return;
    this.installPreview({ path, context, root, full, on, draft, text, content, pathSafe }, make);
  }

  // Reads the file, following a draft that changes while it is read; null when the view moved on meanwhile.
  async readPreview(path, full, { context, on }) {
    let draft = !on ? this.drafts.get(full) : null;
    let text = await readTextFile(full, { on }).catch((error) => { if (draft) return null; throw error; });
    if (!this.previewCurrent(path, context)) return null;
    if (draft && this.drafts.get(full) !== draft) {
      draft = this.drafts.get(full) ?? null;
      if (!draft) { text = await readTextFile(full, { on }); if (!this.previewCurrent(path, context)) return null; }
    }
    return { text, draft };
  }

  previewCurrent(path, context) {
    return this.file === path && this.current(context);
  }

  canCheckPath(on, draft, content) {
    return !on && !draft && content.length <= MAX_PREVIEW_CHARS;
  }

  previewEditor(path, content, draft) {
    const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
    // Read-only where saving is unsafe: another machine (`writeTextFile` is local only), a truncated preview, and
    // text the editor does not hand back unchanged (line endings, BOM, normalisation), which a save would rewrite.
    return (readonly) => EditorState.new({ language: LANG[ext] ?? ext, readonly,
      value: !draft && content.length > MAX_PREVIEW_CHARS ? content.slice(0, MAX_PREVIEW_CHARS) + "\n… (file truncated)" : content,
      font_family: settings().font_family, font_size: 12,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
  }

  installPreview({ path, context, root, full, on, draft, text, content, pathSafe }, make) {
    let editable = pathSafe;
    this.code = make(!editable);
    if (editable && this.code.value() !== text) { this.code.release(); this.code = make(true); editable = false; }
    if (draft) { this.viewDraft = { draft, path, context }; this.fileError = `Unsaved draft (read-only): ${draft.error}. Copy its contents before closing.`; }
    else if (this.canCheckPath(on, draft, content) && !pathSafe) this.fileError = "Read-only: file path is outside the workspace, unsafe, or cannot be verified.";
    else if (pathSafe && !editable) this.fileError = "Read-only: this text cannot be saved without changing it.";
    if (editable) {
      const doc = this.doc = { full, root, disk: text, status: "", ver: 0 };
      this.code.on("change", (_e, eventCx) => this.edited(doc, eventCx));
    }
  }

  // A row's menu. It opens as this mod's own popup: props() carries the target.
  // New/Rename ask in the popup's own prompt because run("<mod>.<cmd>") delivers only
  // the command name to nextCommand(), so typed text cannot cross mods.
  menu(path, entry) {
    if (!this.context || !this.current(this.context)) return;
    openOverlay({ mod: "orca-files", kind: "popup", width: 256,
      props: { tab: "file", target: { path, dir: entry.dir, location: location() } } });
  }

  act(name, cx) {
    const target = props()?.target;
    if (!target) return;
    const { path, dir } = target;
    const overlay = props()?.overlay;
    const close = () => { if (overlay) closeOverlay(overlay); };
    if (!target.location || JSON.stringify(target.location) !== workspaceKey()) {
      if (mainFilesView) { mainFilesView.operationError = "Workspace or host changed; action was cancelled."; cx.notify(); }
      return close();
    }
    const full = `${target.location.cwd.replace(/\/+$/, "")}/${path}`;
    if (Object.hasOwn(NEW_ITEM, name)) {
      const [mode, title] = NEW_ITEM[name], parent = dir ? full : full.replace(/\/[^/]*$/, "") || "/";
      return this.askName(mode, title, parent, { overlay, location: target.location }, cx);
    }
    if (name === "rename") return this.askName("mv", "Rename", full, { overlay, location: target.location, value: path.replace(/^.*\//, "") }, cx);
    return this.fileAction(name, { target, full, close }, cx);
  }

  // Typed text cannot cross mods, so New and Rename keep the prompt in this popup.
  askName(mode, title, full, { overlay, location: where, value }, cx) {
    this.prompt = { mode, title, full, overlay, value: value ?? "", ...where };
    this.input.set_value(value || "");
    if (value) this.input.set_selected_range({ start: 0, end: value.length });
    this.input.focus();
    cx.notify();
  }

  fileAction(name, { target, full, close }, cx) {
    const { path, dir } = target;
    switch (name) {
      // Copy — puts the file itself on the pasteboard (macOS), so Finder can paste it; elsewhere its path.
      case "copy-file":
        if (plat() === "macos") exec("osascript", ["-e", "on run argv\nset the clipboard to (POSIX file (item 1 of argv))\nend run", full]).catch(() => { /* The host action is best effort. */ });
        else void copyText(full, cx);
        return close();
      case "copy-path": void copyText(full, cx); return close();
      case "copy-rel": void copyText(path, cx); return close();
      // Duplicate — file-explorer-row-context-menu.tsx:197-202 & useFileDuplicate.ts:34-63,89-91
      case "duplicate": close(); return this.duplicateFile(target, full, cx);
      // Open in Terminal — file-explorer-row-context-menu.tsx:210 (directories only)
      case "terminal": run("terminal.open", { folder: dir ? full : this.root }); return close();
      // View File — file-explorer-row-context-menu.tsx:220-225: show file in preview pane
      case "view-file": {
        setShared("orca-files.viewFile", path);
        run("orca-files.view");
        if (mainFilesView) mainFilesView.show(path, cx);
        return close();
      }
      // Reveal in File Manager / Open Containing Folder — file-explorer-row-context-menu.tsx:254-263
      case "reveal": void reveal(full, Boolean(dir)); return close();
      case "delete": close(); return confirmDelete(target.location, full);
    }
  }

  duplicateFile(target, full, cx) {
    const { path } = target;
    const source = { ...target.location, full, mode: "duplicate" };
    cx.spawn(async (taskCx) => {
      try {
        await mutateFile(source, location(), path.slice(path.lastIndexOf("/") + 1), exec);
        if (mainFilesView && workspaceKey() === JSON.stringify(target.location)) { mainFilesView.operationError = null; mainFilesView.refresh(taskCx); }
        run("orca-files.refresh");
      } catch (e) {
        if (mainFilesView && workspaceKey() === JSON.stringify(target.location)) mainFilesView.operationError = `Duplicate failed: ${e.message || e}`;
        run("orca-files.refresh"); taskCx.notify();
      }
    });
  }

  // The pending New/Rename, applied here because typed text cannot cross mods.
  // `cx` is a click or submit context, so the writes run in a task whose own
  // `cx` is what `refresh` gets: the caller's would be stale after the awaits.
  // Ported from Orca file-explorer-row-context-menu.tsx:153-164,289-296
  apply(name, cx) {
    const p = this.prompt;
    if (!p || p.busy) return;
    p.busy = true; p.error = null; cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        await mutateFile(p, location(), name, exec);
        if (this.prompt === p) { this.prompt = null; if (p.overlay) closeOverlay(p.overlay); }
        if (mainFilesView) mainFilesView.refresh(taskCx);
        run("orca-files.refresh");
      } catch (e) { if (this.prompt === p) p.error = String(e.message || e); }
      finally { p.busy = false; taskCx.notify(); }
    });
  }

  // Delete needs no typed text, so the shipped confirm mod can drive it.
  // `cx` is the `nextCommand` loop's AsyncContext (see `command`), which stays
  // valid across awaits. Ported from Orca file-explorer-row-context-menu.tsx:298-302
  async remove(token, cx) {
    const targetKey = `orca-files.target.${token}`;
    const target = shared(targetKey);
    if (!target) return;
    setShared(targetKey, null);
    try { await deleteTarget(target, location(), exec); this.operationError = null; }
    catch (e) { this.operationError = `Delete failed: ${e.message || e}`; }
    this.refresh(cx);
    cx.notify();
  }

  // command loop dispatch: handles delete confirmation, refresh requests, and cross-mod view requests
  // (src/renderer/src/components/right-sidebar/file-explorer/panel/file-explorer-row-context-menu.tsx:220-225,298-302)
  command(c, cx) {
    if (c.startsWith("remove-")) return this.remove(c.slice(7), cx);
    // Revealed by ⌘⇧F (orca-panel-head.search): the panel is already shown and on the
    // Explorer tab by the time this runs. Orca's showRightSidebarSearch opens the Contents
    // view with its query field focused (right-sidebar-state.ts:87-110).
    if (c === "search") {
      this.view = "search";
      this.q.focus();
      if (this.q.value().trim()) this.rerun(cx);
      cx.notify();
      return;
    }
    if (c === "refresh") {
      if (this.reloadDraft && this.reloadDraft === this.viewDraft && this.current(this.reloadDraft.context)) {
        const path = this.reloadDraft.path; this.reloadDraft = null; this.show(path, cx);
      }
      return this.refresh(cx);
    }
    // The More menu's filter toggles rebuild the cached name projection (see moreView).
    if (c === "filters") return this.scheduleName(cx);
    if (c === "view") {
      const file = shared("orca-files.viewFile");
      setShared("orca-files.viewFile", null);
      if (file) this.show(file, cx);
    }
  }

  // useFileSearchPanel.ts:276-300 — flipping a toggle or editing a filter reruns the
  // current query; both paths share the input's 200 ms debounce, so a filter typed a
  // character at a time does not spawn one rg per keystroke (Orca's executeSearch
  // debounces all of them for the same reason).
  rerun(cx) {
    const v = this.q.value().trim();
    const generation = ++this.searchGeneration, context = this.context;
    this.searchTimer?.cancel();
    if (!v) { this.searchTimer = null; this.hits = null; this.searching = false; this.collapsedSearch = new Set(); cx.notify(); return; }
    this.searching = true; cx.notify();
    this.searchTimer = cx.timer.after(SEARCH_DEBOUNCE_MS, (timerCx) => {
      this.searchTimer = null;
      timerCx.spawn(async (taskCx) => {
        const h = await this.search(v);
        if (generation !== this.searchGeneration || !this.current(context)) return;
        this.hits = h; this.searching = false; taskCx.notify();
      });
    });
  }

  // Bounded: exec caps at 8 MiB / 30s, so cap hits rather than fail.
  // Argv order and flags port `buildRgArgs` (src/shared/text-search.ts:46-77): a
  // case-insensitive search gets `--ignore-case` (Orca has no smart-case), whole word
  // gets `--word-regexp`, a non-regex query `--fixed-strings`, each include glob
  // `--glob <pat>` and each exclude `--glob !<pat>`. `--vimgrep` keeps this mod's
  // `file:line:column:text` parser instead of Orca's `--json` stream.
  // Returns the SearchResult shape SearchResultsPane.tsx reads (:88-92 totalMatches /
  // files.length / truncated; :57-70 one file row per file, matches indented below).
  // `files` keeps first-seen order and holds at most 200 matches for display; every line
  // rg printed still counts toward `totalMatches`, so the summary and `truncated` are true.
  async search(query) {
    if (!query) return searchResults("");
    const args = ["--vimgrep"];
    if (!this.caseSensitive) args.push("--ignore-case");      // text-search.ts:56-58
    if (this.wholeWord) args.push("--word-regexp");            // text-search.ts:59-61
    if (!this.useRegex) args.push("--fixed-strings");          // text-search.ts:62-64
    for (const pat of splitGlobs(this.include.value())) args.push("--glob", pat);       // :65-69
    for (const pat of splitGlobs(this.exclude.value())) args.push("--glob", `!${pat}`); // :70-74
    args.push("--", query);                                   // :75 — `--` ends option parsing; Orca sets no per-file cap
    const r = await exec("rg", args, { cwd: this.root, on: this.on }).catch(() => null);
    // Same as the listing: rg exits 2 after an unreadable directory and still printed
    // the hits; only a run that produced nothing is a failure.
    return searchResults(r?.stdout || "");
  }

  // `source === "name"` walks `nfMap`, the projection nameMatches built from the worktree
  // listing; the plain tree walks the loaded folder cache. Returns descriptors, not elements:
  // FileExplorerVirtualRows.tsx renders the tree through a virtualizer, and a broad name
  // filter matches thousands of rows — building them all in one frame overruns the engine's
  // 50 ms render budget (`sandbox.rs` Budgets::render) and paints the stale-frame banner.
  flat(prefix, depth, out, source) {
    if (out.length >= TOTAL || depth > MAX_TREE_DEPTH) return out;
    const named = source === "name", f = filters(this.root);
    for (const entry of this.listed(prefix, named)) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // nameMatches already applied both toggles to the name projection.
      if (!named && this.hiddenByFilter(entry, path, f)) continue;
      // The filtered tree opens every ancestor of a match unless the branch was collapsed
      // (nameFilterCollapsedPaths, file-explorer-name-filter-projection.ts:206-208).
      const open = named ? !this.nfCollapsed.has(path) : this.folders.has(path);
      out.push({ path, name: entry.name, entry, dir: entry.dir, link: entry.link, depth, open });
      if (entry.dir && open) this.flat(path, depth + 1, out, source);
    }
    return out;
  }

  listed(prefix, named) {
    return (named ? this.nfMap?.get(prefix) : this.entries.get(prefix)) ?? [];
  }

  hiddenByFilter(entry, path, f) {
    // Show Dotfiles: Orca drops any dot-prefixed segment (file-explorer-entries.ts:7-14).
    if (!f.dotfiles && entry.name.length > 1 && entry.name !== ".." && entry.name.startsWith(".")) return true;
    // Show Git Ignored Files: Orca hides ignored paths and their ancestors (git-path-decoration.ts:90-108).
    return !f.ignored && this.isGitIgnored(path);
  }

  // Orca's explorer keys (useFileExplorerKeys.ts:200-260, file-explorer-keyboard-navigation.ts):
  // Space activates the row, Enter renames it, Delete removes it, ⌘⌥C copies its path and
  // ⌘⌥⇧C its workspace-relative path. Selection only changes while the tree holds focus, so
  // typing in the query inputs and terminals is never intercepted.
  treeKey(e, cx) {
    if (!this.treeOwnsKeyboard()) return;
    const mods = e.modifiers ?? {};
    const index = this.visible.findIndex((r) => r.path === this.selected);
    const row = index === -1 ? null : this.visible[index];
    if (mods.platform || mods.control || mods.alt) return this.treeShortcut(e, mods, row, cx);
    const resolved = resolveTreeKey(e.key, index === -1 ? null : index, this.visible);
    if (this.navigateTree(resolved, row, cx)) return;
    if (row) this.rowKey(e.key, row, cx);
  }

  treeOwnsKeyboard() {
    return this.view === "files" && !this.file && !this.prompt && this.treeFocus.is_focused();
  }

  // Space opens the row, Enter renames it, Delete asks to remove it.
  rowKey(key, row, cx) {
    if (key === "space") {
      if (row.dir) this.toggleFolder(row.path, cx);
      else this.show(row.path, cx);
      cx.stop_propagation(); cx.notify(); return;
    }
    if (key === "enter") { this.startRename(row, cx); cx.stop_propagation(); return; }
    if (key === "delete") {
      this.requestDelete(row.path, row.dir, cx); cx.stop_propagation();
    }
  }

  // A folder row toggles in the name projection while a filter is typed, in the loaded tree otherwise.
  toggleFolder(path, cx) {
    if (this.name.value().trim()) this.nameToggle(path, cx);
    else this.toggle(path, cx);
  }

  treeShortcut(e, mods, row, cx) {
    if (isCopyPathKey(e, mods)) {
      if (row) void copyText(mods.shift ? row.path : `${(this.root ?? "").replace(/\/+$/, "")}/${row.path}`, cx);
      cx.stop_propagation(); return;
    }
    if (isDeleteKey(e, mods)) {
      if (row) this.requestDelete(row.path, row.dir, cx);
      cx.stop_propagation(); return;
    }
  }

  navigateTree(resolved, row, cx) {
    if (resolved.type === "move") {
      this.selected = this.visible[resolved.index]?.path ?? null;
      this.treeScroll.scroll_to_item(resolved.index);
      cx.stop_propagation(); cx.notify(); return true;
    }
    if (resolved.type === "expand" || resolved.type === "collapse") {
      if (resolved.type === "expand" ? !row.open : row.open) this.toggleFolder(resolved.path, cx);
      cx.stop_propagation(); cx.notify(); return true;
    }
    return false;
  }

  // Enter rename and Delete confirmation, reachable without the row menu. The target is
  // captured now so a workspace/host switch before the write cancels (M1).
  startRename(row, cx) {
    const loc = location();
    if (!this.root || JSON.stringify(loc) !== this.context?.key) {
      this.operationError = "Workspace or host changed; action was cancelled."; cx.notify(); return;
    }
    const full = `${loc.cwd.replace(/\/+$/, "")}/${row.path}`;
    this.prompt = { mode: "mv", title: "Rename", full, overlay: null, value: row.name, ...loc };
    this.input.set_value(row.name);
    this.input.set_selected_range({ start: 0, end: row.name.length });
    this.input.focus(); cx.notify();
  }

  requestDelete(path, dir, cx) {
    const loc = location();
    if (!this.root || JSON.stringify(loc) !== this.context?.key) {
      this.operationError = "Workspace or host changed; action was cancelled."; cx.notify(); return;
    }
    const full = `${loc.cwd.replace(/\/+$/, "")}/${path}`;
    confirmDelete(loc, full);
  }

  // v_virtual_list hands its renderer a {start,end} range, not an index (defaults/mods/changes
  // uses the same contract), and rows cannot register their own handlers — the renderer runs
  // every frame, so the list takes one `on_item_click` keyed by `get_key` instead.
  treeList(t) {
    const list = this.flat("", 0, [], this.name.value().trim() ? "name" : undefined);
    const named = Boolean(this.name.value().trim());
    const find = (key) => list.find((r) => r.path === key);
    this.visible = list;
    return div().size_full().track_focus(this.treeFocus).tab_index(0).role("tree")
      .on_key_down((e, cx) => this.treeKey(e, cx))
      .child(v_virtual_list("files-rows", list.length, 24, i => list[i]?.path ?? String(i),
      (range) => list.slice(range.start, range.end).map(r => this.row(r, t)))
      // The list keeps its own position; the handle lets keyboard moves scroll the
      // selected row into view (gpui-kit track_scroll, VirtualListScrollHandle docs).
      .track_scroll(this.treeScroll)
      .on_item_click((key, cx) => {
        const r = find(key);
        if (!r) return;
        this.selected = r.path; this.treeFocus.focus();
        if (r.dir) named ? this.nameToggle(r.path, cx) : this.toggle(r.path, cx);
        else this.show(r.path, cx);
        cx.notify();
      })
      .on_item_secondary_click((key, _event, cx) => {
        const r = find(key);
        if (!r) return;
        cx.stop_propagation();
        this.menu(r.path, r.entry);
      })
      .size_full());
  }

  // FileExplorerRow.tsx:204-226,242-248 — Loader2 while the folder loads, CircleAlert on a
  // read error, Link for a symlink, FileTypeIcon per extension.
  rowIcon({ path, name, dir, link, open }, failed, t) {
    const glyph = (file) => svg(`mods/orca-files/${file}.svg`).size(12).flex_none();
    if (!dir) return (link ? glyph("link") : glyph(fileIcon(name))).text_color(t.muted);
    if (this.pending.has(path)) return glyph("loader-circle").text_color(t.muted).spin(SPIN_PERIOD_MS);
    if (failed) return glyph("circle-alert").text_color(t.blocked);
    return glyph(open ? "folder-open" : "folder").text_color(t.muted);
  }

  // FileExplorerRow.tsx:147-152 — px-2 py-1 text-xs gap-1, indent depth*16 + 8; 26px is
  // Orca's own row constant (virtualizer estimateSize, inline-input row, drag ghost).
  // Colours: git-path-decoration.ts:5-12 -> main.css:489-496.
  // Selected row: main.css:1453-1471 — accent at 70% (80% hovered), inset 1px border,
  // accent-foreground text; hover is `bg-accent` (FileExplorerRow.tsx:148).
  // Divergence: rounded(2), not rounded-sm (6px): the hover fill is only 26px tall.
  row(r, t) {
    const { path, name, dir, depth, open } = r;
    // A folder row shows its descendants' dominant status when it has no mark of its own
    // (buildFolderStatusMap, git-path-decoration.ts:53-88; FileExplorerVirtualRows.tsx:170-176).
    const mark = this.marks[path] ?? (dir ? this.folderMarks[path] : undefined);
    const failed = dir ? this.folderErrors[path] : null;
    const icon = this.rowIcon(r, failed, t);
    return h_flex().id(`file-${path}`).w_full().h(24).flex_none().pl(8 + depth * 16).pr(8).gap(4).items_center().rounded(2).text_size(12).cursor_pointer()
      .role("button").accessibility_label(name)
      .when(this.file === path, el => el.bg(fade(t.accent, 0.7)).border_1().border_color(t.border).text_color(t.accent_foreground).hover(s => s.bg(fade(t.accent, 0.8))))
      .when(this.file !== path, el => el.hover(s => s.bg(t.accent)))
      // Keyboard selection is a lighter fill than the previewed file's (Orca keeps both).
      .when(this.selected === path && this.file !== path, el => el.bg(fade(t.accent, 0.55)))
      .child(dir ? svg(`mods/orca-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
      .child(icon)
      .child(div().flex_1().min_w(0).truncate().when(Boolean(mark), el => el.text_color(gitTone(mark, t))).child(name))
      // FileExplorerRow.tsx:242-248 — the read error rides the row as a destructive truncation.
      .when(Boolean(failed), el => el.child(div().w(0).flex_1().truncate().text_color(t.blocked).tooltip(failed).child(failed)))
      // FileExplorerRow.tsx:251-267 — status `text-[10px] font-semibold tracking-wide mr-2`;
      // ignored rows swap the label for CircleSlash size-3. `tracking-wide` has no gpui-kit
      // method, so only the size and weight are ported.
      .when(mark === "!", el => el.child(div().mr(8).flex_none().child(svg("mods/orca-files/circle-slash.svg").size(12).flex_none().text_color(gitTone(mark, t)))))
      .when(Boolean(mark) && mark !== "!", el => el.child(div().mr(8).flex_none().text_size(10).font_semibold().text_color(gitTone(mark, t)).child(mark)));
  }

  promptView(t) {
    const close = (cx) => { if (!this.prompt.busy) { this.prompt = null; cx.notify(); } };
    return v_flex().id("orca-files-prompt").w_full().min_h(0).p(14).gap(10).bg(t.popover).text_size(12.8).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(14).font_semibold().child(this.prompt.title))
        .child(div().text_size(11).text_color(t.dim).child("Esc")).on_key_down((e, cx) => {
          if (e.key === "escape") { close(cx); cx.stop_propagation(); }
        }).track_focus(this.inputHandle))
      .child(div().text_size(11).text_color(t.dim).child(this.prompt.full))
      .when(Boolean(this.prompt.error), el => el.child(div().text_size(11).text_color(t.ansi1).child(this.prompt.error)))
      .child(Input.new(this.input).h(34).px(10).rounded(8).border_1().border_color(t.input).bg(t.surface).text_size(12.8).text_color(t.foreground)
        .on_key_down((e, cx) => { if (e.key === "enter") { void this.apply(this.input.value(), cx); cx.stop_propagation(); } }))
      .child(h_flex().gap(8).justify_end()
        .child(h_flex().id("fx-cancel").h(30).px(12).items_center().rounded(7).border_1().border_color(t.input).text_size(12).cursor_pointer().hover(s => s.opacity(0.88)).on_click((_e, cx) => close(cx)).child("Cancel"))
        .child(h_flex().id("fx-save").h(30).px(12).items_center().rounded(7).bg(t.solid).text_color(t.solid_foreground).text_size(12).font_medium().cursor_pointer()
          .hover(s => s.opacity(0.88)).on_click((_e, cx) => { void this.apply(this.input.value(), cx); cx.notify(); }).child(this.prompt.busy ? "Saving…" : "Save")));
  }

  menuView(t) {
    const target = props()?.target ?? {};
    const { dir } = target;
    const revealLabel = byPlatform({ macos: "Reveal in Finder", windows: "Reveal in File Explorer" }, "Open Containing Folder");

    // Rows are 26 tall with the shortcut right-aligned and muted, as in Orca's menu. The shortcuts are
    // display only: Herdr binds none of them.
    const item = (i, label, icon, name, { shortcut, destructive = false, chevron = false, onClick, track } = {}) =>
      h_flex().id(`fx-${i}`).h(26).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
        .hover(s => s.bg(t.hover)).on_click((_e, cx) => onClick ? onClick(cx) : this.act(name, cx))
        // Dropdown behaviour: the flyout opens while the pointer is on "Open in" and folds back as soon
        // as it moves onto any other row of this menu; moving onto the flyout itself keeps it open.
        .on_mouse_move((e) => { if (track) { track(e); if (!shared("orca-files.openIn")) this.openIn(); } else this.closeOpenIn(); })
        .child(svg(`mods/orca-files/${icon}.svg`).size(14).flex_none().text_color(destructive ? "#ff6568" : t.muted))
        .child(div().flex_1().text_color(destructive ? "#ff6568" : t.foreground).child(label))
        .when(Boolean(shortcut), el => el.child(div().flex_none().text_size(12).text_color(t.muted).child(shortcut)))
        .when(chevron, el => el.child(svg("mods/orca-files/chevron-right.svg").size(14).flex_none().text_color(t.muted)));
    const sep = () => div().h(1).my(3).mx(4).bg(t.border);

    return v_flex().id("orca-files-menu").w_full().min_h(0).p(4).bg(t.popover).text_size(12.8).text_color(t.foreground)
      .child(item(0, "New File", "file-plus", "new-file"))
      .child(item(1, "New Folder", "folder-plus", "new-folder"))
      .child(sep())
      .child(item(2, "Copy", "copy", "copy-file"))
      .child(item(3, "Copy Path", "copy", "copy-path"))
      .child(item(4, "Copy Relative Path", "copy", "copy-rel"))
      // Duplicate — file-explorer-row-context-menu.tsx:197-202 (files only)
      .when(!dir, el => el.child(item(5, "Duplicate", "files", "duplicate")))
      // Open in Terminal — file-explorer-row-context-menu.tsx:210 (directories only)
      .when(Boolean(dir), el => el.child(item(6, "Open in Terminal", "terminal", "terminal")))
      // View File — file-explorer-row-context-menu.tsx:216-221 (files only)
      .when(!dir, el => el.child(item(7, "View File", "file", "view-file")))
      // "Open in Orca Browser" is left out on purpose: Herdr has no browser.
      .child(item(8, "Open in", "folder-open", null, { chevron: true,
        track: (e) => { if (e.local_position && e.bounds) { const left = e.position.x - e.local_position.x; this.rowEdge = { left, right: left + e.bounds.width, y: e.position.y - e.local_position.y }; } },
        onClick: () => { if (!shared("orca-files.openIn")) this.openIn(); } }))
      // Reveal in File Manager / Open Containing Folder — file-explorer-row-context-menu.tsx:254-263
      .child(item(9, revealLabel, "external-link", "reveal"))
      .child(sep())
      // Rename & Delete — file-explorer-row-context-menu.tsx:265-276
      .child(item(10, "Rename", "pencil", "rename"))
      .child(item(11, "Delete", "trash", "delete", { destructive: true }));
  }

  // The "Open in" flyout is its own popup (as orca-new-menu's agent setup is), level with the row and
  // flipped to the menu's left when the right side would leave the window. Its width is fixed
  // so that position is known; the menu's id rides along so choosing an app closes both.
  openIn() {
    const { target, overlay } = props() ?? {};
    this.closeOpenIn();
    const r = this.rowEdge, vp = globalThis.window?.viewport_size?.() ?? null; // the imported `window` is Herdr's function, so the global is the one with viewport_size
    const W = 200, GAP = 6, M = 8;
    let at = "pointer";
    if (r) {
      const left = r.left - 4 - GAP - W, right = r.right + GAP;
      at = { x: left >= M ? left : right, y: r.y };
      if (vp && at.x + W > vp.width - M) at.x = Math.max(M, vp.width - W - M);
    }
    setShared("orca-files.openIn", openOverlay({ mod: "orca-files", kind: "popup", width: W, at,
      props: { tab: "open-in", target, root: this.root, menu: overlay } }));
  }

  closeOpenIn() {
    const open = shared("orca-files.openIn");
    if (!open) return;
    closeOverlay(open);
    setShared("orca-files.openIn", null);
  }

  // OpenInSubmenu: the apps the system offers for the file, a separator, then "Customize apps…".
  openInView(t, cx) {
    const { target, menu } = props() ?? {};
    const root = props()?.root ?? this.root;
    const full = root ? `${root}/${target?.path ?? ""}` : target?.path ?? "";
    // Looked up once per flyout; notify runs on the spawn's own cx, as render's is invalid after an await.
    if (!this.openApps) {
      this.openApps = [];
      cx.spawn(async (taskCx) => { this.openApps = await openInApps(full); taskCx.notify(); });
    }
    const close = () => { closeOverlay(props().overlay); if (menu) closeOverlay(menu); setShared("orca-files.openIn", null); };
    const row = (i, label, onClick, icon) => h_flex().id(`oi-${i}`).h(26).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
      .hover(s => s.bg(t.hover)).on_click(onClick)
      .child(svg(`mods/orca-files/${icon ?? "folder-open"}.svg`).size(14).flex_none().text_color(t.muted))
      .child(div().flex_1().text_color(t.foreground).child(label));
    // shortcut: no per-app icon (Orca shows a favicon); a generic one stands in until Herdr can load remote images.
    return v_flex().id("orca-files-open-in").w_full().min_h(0).p(4).bg(t.popover).text_size(12.8).text_color(t.foreground)
      .children(this.openApps.map((a, i) => row(i, a.label, () => {
        exec("open", ["-a", a.app, full]).catch(() => { /* The host action is best effort. */ });
        close();
      })))
      .child(div().h(1).my(3).mx(4).bg(t.border))
      .child(row("customize", "Customize apps…", () => {
        void (async () => {
          if (this.openApps.length && await readTextFile(openInFile(), null).then(() => false, () => true)) await writeTextFile(openInFile(), JSON.stringify(this.openApps.map(({ label, app }) => ({ label, app })), null, 2) + "\n", null);
          exec("open", ["-t", openInFile()]).catch(() => { /* The host action is best effort. */ });
        })();
        close();
      }, "square-pen"));
  }

  // FileExplorerToolbar.tsx:66 — `flex h-8 min-h-8 items-center gap-2 border-b border-border px-2`;
  // controls are icon-xs ghost buttons: 24x24 rounded-md with 12px glyphs (button.tsx:41).
  toolbar(t) {
    // canCollapseAll = isFilesViewActive && !hasNameFilter && expanded.size > 0
    // (FileExplorer.tsx:150); canRefresh = isFilesViewActive (:260).
    const name = this.repo(), files = this.view === "files";
    const collapse = files && !this.name.value().trim() && this.folders.size > 0;
    const btn = (id, label, icon, action, enabled) => div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.muted).tooltip(label).disabled(!enabled)
      .when(enabled, s => s.cursor_pointer().hover(x => x.bg(t.hover).text_color(t.foreground)))
      .when(!enabled, s => s.opacity(0.5)).role("button").accessibility_label(label)
      .when(enabled, s => s.on_click(action)).child(icon);
    return h_flex().id("files-toolbar").h(32).flex_none().px(8).gap(8).items_center().border_b(1).border_color(t.border)
      // :67-72 — `min-w-0 flex-1 truncate text-xs font-medium text-foreground`, title=repoName.
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_medium().text_color(t.foreground)
        .when(Boolean(name), s => s.tooltip(name)).child(name))
      // :73-106 — Collapse All; `aria-disabled` + `opacity-50` when nothing is expanded.
      .child(btn("files-collapse", "Collapse All", svg("mods/orca-files/list-collapse.svg").size(12).flex_none(),
        (_e, cx) => this.collapseAll(cx), collapse))
      // :107-144 — Refresh Explorer; Loader2-style spinner while `refresh.isRefreshing`,
      // disabled outside the files view (`aria-disabled={!canRefresh || refresh.isRefreshing}`).
      .child(btn("files-refresh", "Refresh Explorer",
        this.loading ? svg("mods/orca-assets/refresh-cw.svg").size(12).flex_none().spin(SPIN_PERIOD_MS) : svg("mods/orca-assets/refresh-cw.svg").size(12).flex_none(),
        (_e, cx) => this.refresh(cx), files && !this.loading))
      // :145-198 — More Explorer Actions; the dropdown opens at the pointer.
      .child(btn("files-more", "More Explorer Actions", svg("mods/orca-files/ellipsis.svg").size(12).flex_none(),
        () => openOverlay({ mod: "orca-files", kind: "popup", width: 192, height: this.git ? 140 : 112,
          props: { tab: "more", root: this.root, git: this.git } }), true));
  }

  // FileExplorerToolbar.tsx:170-197 — `align="end" min-w-[12rem]`: two checkbox items, a
  // separator, then WorktreeOpenInMenuItems.
  moreView(t) {
    const { root, git } = props() ?? {}, f = filters(root);
    const close = () => closeOverlay(props().overlay);
    const check = (i, label, on, action) => h_flex().id(`fx-${i}`).h(28).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
      .hover(s => s.bg(t.hover)).on_click(action)
      .child(div().w(14).flex_none().text_size(12).child(on ? "✓" : ""))
      .child(div().child(label));
    const item = (i, label, icon, action) => h_flex().id(`fx-${i}`).h(30).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
      .hover(s => s.bg(t.hover)).on_click(action)
      .child(svg(`mods/orca-files/${icon}.svg`).size(14).flex_none().text_color(t.muted))
      .child(div().child(label));
    const fm = byPlatform({ windows: "File Explorer", macos: "Finder" }, "File Manager");
    return v_flex().id("orca-files-more").w_full().min_h(0).p(5).bg(t.popover).text_size(12.8).text_color(t.foreground)
      // The plain tree reads `filters()` every render, but the name projection caches its
      // rows, so a toggle also asks the main copy to rebuild it (FileExplorer.tsx:134-148
      // recomputes it from the new state).
      .child(check(0, "Show Dotfiles", f.dotfiles, () => { setFilter(root, "dotfiles", !f.dotfiles); run("orca-files.filters"); }))
      // Orca renders this item while the repo supports Git (FileExplorerToolbar.tsx:177-187).
      .when(git, el => el.child(check(1, "Show Git Ignored Files", f.ignored, () => { setFilter(root, "ignored", !f.ignored); run("orca-files.filters"); })))
      .child(div().h(1).mt(4).mb(4).bg(t.border))
      // WorktreeOpenInMenuItems (:189-196): Orca lists its `openInApplications` editors then
      // the file manager. Herdr has no editor setting or editor command, so only the rows it
      // can drive are ported.
      .child(item(2, "Open in Terminal", "terminal", () => { if (root) run("terminal.open", { folder: root }); close(); }))
      .child(item(3, `Open in ${fm}`, "folder-open", () => { if (root) void reveal(root); close(); }));
  }

  // FileExplorerQueryStrip.tsx:35-52 — `border-b border-border px-2 py-2` around a
  // `flex flex-col gap-2`: the Names/Contents switch sits above the active query input.
  queryStrip(t) {
    const search = this.view === "search";
    // FileExplorerViewSwitch.tsx:44-73 — `rounded-md bg-muted p-0.5`, group `h-6 w-full`,
    // items sized `xs` (h-6, text-xs, flex-1); selected `bg-card text-card-foreground`: the selected segment is the lighter
    // one (hover) on the darker track (raised), as in the Orca screenshot.
    const seg = (id, label, view) => div().id(id).flex_1().h(24).flex().items_center().justify_center().rounded(6).text_size(12)
      .cursor_pointer().role("button").accessibility_label(label).tooltip(label)
      .when(this.view === view, s => s.bg(t.hover).text_color(t.foreground))
      .when(this.view !== view, s => s.text_color(t.muted).hover(x => x.text_color(t.foreground)))
      .on_click((_e, cx) => { this.view = view; cx.notify(); })
      .child(label);
    // FileExplorer.tsx:294-309 — both query rows stay mounted and one is hidden
    // (`<div hidden={explorerView !== 'files'}>`), so switching mode keeps its text.
    // One shared `Input` element kept whichever state it bound first, so keystrokes
    // in one mode landed in the other's state and neither search ever ran.
    return v_flex().id("files-query").flex_none().p(8).gap(8).border_b(1).border_color(t.border)
      .child(h_flex().w_full().h(28).p(2).gap(4).rounded(6).bg(t.raised)
        .child(seg("files-names", "Names", "files"))
        .child(seg("files-contents", "Contents", "search")))
      .child(this.queryRow({ state: this.name, id: "names", active: !search, busy: !search && this.nfLoading }, t))
      .child(this.queryRow({ state: this.q, id: "contents", active: search, busy: search && this.searching, controls: this.searchToggles(t) }, t))
      // SearchFilters.tsx:29-108 nests under the Contents row in FileExplorer.tsx:307-309.
      .child(this.filtersRow(t));
  }

  // FileExplorerNameFilter.tsx:23 / SearchQueryRow.tsx:47 — shared `h-8 rounded-md`
  // chrome; `focus-within:border-ring ring-1` paints the border in ring colour.
  // FileExplorerNameFilter.tsx:47-62 / SearchQueryRow.tsx:50-51 — Loader2 while the
  // listing or the search runs; X clears that input and its projection.
  // `controls` are SearchQueryRow.tsx:75-101's toggles, appended after Clear; the Names
  // row has none because FileExplorerNameFilter.tsx has no equivalent.
  queryRow({ state, id, active, busy, controls }, t) {
    return h_flex().w_full().h(32).min_h(0).px(8).gap(4).items_center().rounded(8).overflow_hidden().border_1().border_color(this.qFocused ? t.ring : t.border).bg(fade(t.input, 0.5))
      .when(!active, el => el.hidden())
      .child(svg("mods/orca-files/list-filter.svg").size(14).flex_none().text_color(t.muted))
      .child(Input.new(state).flex_1().min_w(0).text_size(12).text_color(t.foreground).bg("#00000000"))
      .when(busy, el => el.child(svg("mods/orca-files/loader-circle.svg").size(12).flex_none().text_color(t.muted).spin(SPIN_PERIOD_MS)))
      .when(Boolean(state.value().trim()), el => el.child(div().id(`files-clear-${id}`).p(2).flex_none().rounded(6).cursor_pointer().text_color(t.muted).hover(s => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          state.set_value("");
          if (state === this.q) { this.hits = null; this.searching = false; this.collapsedSearch = new Set(); }
          else { this.nfMap = null; this.nfCollapsed = new Set(); this.nfLoading = false; }
          cx.notify();
        })
        .child(svg("mods/orca-files/x.svg").size(12))))
      .children(controls ?? []);
  }

  // SearchQueryRow.tsx:75-101, styled by ToggleButton (SearchResultItems.tsx:18-57): three
  // icon-only ghost buttons after Clear, `bg-accent text-accent-foreground` when active and
  // muted otherwise. Herdr announces the label but has no aria-pressed on a plain div, so
  // the fill is the pressed state. Each flip reruns via `rerun` (useFileSearchPanel.ts:276-288).
  searchToggles(t) {
    const toggle = (id, active, flip, label, icon) => div().id(id).flex_none().p(2).rounded(4).cursor_pointer()
      .role("button").accessibility_label(label).tooltip(label)
      .when(active, s => s.bg(t.accent).text_color(t.accent_foreground))
      .when(!active, s => s.text_color(t.muted).hover(h => h.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => { flip(); this.rerun(cx); })
      .child(svg(`mods/orca-files/${icon}.svg`).size(14).flex_none());
    return [
      toggle("files-case", this.caseSensitive, () => { this.caseSensitive = !this.caseSensitive; }, "Match Case", "case-sensitive"),
      toggle("files-word", this.wholeWord, () => { this.wholeWord = !this.wholeWord; }, "Match Whole Word", "whole-word"),
      toggle("files-regex", this.useRegex, () => { this.useRegex = !this.useRegex; }, "Use Regular Expression", "regex"),
    ];
  }

  // SearchFilters.tsx:26-108 — the right-aligned ellipsis trigger carries an `N active`
  // badge; opening it unfolds `files to include` and `files to exclude`. `defaultOpen`
  // (:31) is `activeCount > 0`; the worktree reset empties both patterns, so closed is the
  // same initial state. Herdr has no height animation, so the content mounts when open.
  filtersRow(t) {
    const include = this.include.value(), exclude = this.exclude.value();
    const activeCount = Number(Boolean(include.trim())) + Number(Boolean(exclude.trim()));
    const field = (id, label, state) => v_flex().id(id).gap(2)
      .accessibility_label(label).tooltip(label)
      .child(div().text_size(10).text_color(t.muted).child(label))
      .child(Input.new(state).h(26).px(6).rounded(6).border_1().border_color(t.input)
        .bg(t.surface).text_size(12).text_color(t.foreground));
    return v_flex().id("files-filters").w_full().gap(4)
      .when(this.view !== "search", el => el.hidden())
      .child(h_flex().w_full().h(24).items_center().justify_end().gap(6)
        .when(activeCount > 0, el => el.child(div().text_size(10).text_color(t.muted).child(`${activeCount} active`)))
        .child(div().id("files-filters-toggle").p(2).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer()
          .role("button").accessibility_label("Toggle search details").tooltip("Toggle search details")
          .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { this.filtersOpen = !this.filtersOpen; cx.notify(); })
          .child(svg("mods/orca-files/ellipsis.svg").size(14))))
      .when(this.filtersOpen, el => el.child(v_flex().gap(6).pb(2)
        .child(field("files-include", "files to include", this.include))
        .child(field("files-exclude", "files to exclude", this.exclude))));
  }

  // SearchResultsPane.tsx:26-44,88-94 — the summary is a fixed header above the rows:
  // `N results in M files`, plus `(results truncated)` when search() capped the display.
  searchSummary(t) {
    const hits = this.hits;
    const results = `${hits.totalMatches} ${hits.totalMatches === 1 ? "result" : "results"}`;
    const files = `${hits.fileCount} ${hits.fileCount === 1 ? "file" : "files"}`;
    return h_flex().id("files-search-summary").flex_none().px(8).py(4).border_b(1).border_color(t.border)
      .text_size(11).text_color(t.muted) // `text-2xs` = 0.6875rem = 11px (SearchResultsPane.tsx:89)
      .child(`${results} in ${files}${hits.truncated ? " (results truncated)" : ""}`);
  }

  // SearchResultsPane.tsx:57-70 — file rows (28px, 6px inter-group spacing) with their match
  // rows (20px) indented beneath; buildSearchRows (search-rows.ts:20-51) drops a collapsed
  // file's matches from the list entirely.
  searchResults(t) {
    const hits = this.hits;
    if (!hits || !hits.files.length) return [];
    return hits.files.flatMap((file) => this.searchGroup(file, t));
  }

  // SearchResultItems.tsx:59-132 FileResultRow — pt-1.5 above each group, ChevronRight
  // rotated 90deg when open (:87-93), FileTypeIcon (:94-97), truncated name plus an 11px
  // muted parent directory (:98-105), and a 10px count badge (:106-108); the whole row is
  // the collapse toggle (:84-85) and the full path rides its tooltip (:124-127).
  // SearchResultsPane.tsx:60-69 sizes a file row 28px.
  searchGroup(file, t) {
    const collapsed = this.collapsedSearch.has(file.path);
    const slash = file.path.lastIndexOf("/");
    const name = slash === -1 ? file.path : file.path.slice(slash + 1);
    const dir = slash === -1 ? "" : file.path.slice(0, slash);
    const row = h_flex().id(`files-hit-file-${file.path}`).w_full().h(28).flex_none().pt(6).pr(8).pl(8).gap(4)
      .items_center().rounded(2).cursor_pointer().hover(s => s.bg(t.hover)).tooltip(file.path)
      .on_click((_e, cx) => {
        if (collapsed) this.collapsedSearch.delete(file.path);
        else this.collapsedSearch.add(file.path);
        cx.notify();
      })
      .child(svg(`mods/orca-files/chevron-${collapsed ? "right" : "down"}.svg`).size(12).flex_none().text_color(t.muted))
      .child(svg(`mods/orca-files/${fileIcon(name)}.svg`).size(14).flex_none().text_color(t.muted))
      .child(h_flex().flex_1().min_w(0).items_center().gap(6)
        .child(div().min_w(0).truncate().text_size(12).text_color(t.foreground).child(name))
        .when(Boolean(dir), el => el.child(div().min_w(0).truncate().text_size(11).text_color(t.muted).child(dir))))
      .child(div().flex_none().text_size(10).text_color(t.muted).rounded(999).px(6).bg(fade(t.raised, 0.8)).child(String(file.matches.length)));
    return collapsed ? [row] : [row, ...file.matches.map((m, i) => this.searchMatch(file.path, m, i, t))];
  }

  // SearchResultItems.tsx:134-199 MatchResultRow — pl-7 (28px) indent, py-px, a 10px
  // tabular line number (:187-189), then the 12px line; search-rows.ts:40-47 renders one
  // per match under its file and SearchResultsPane.tsx:126-131 opens it via `openMatchResult`
  // (search-match-open.ts:52-82): open the file, then apply `pendingEditorReveal {line,
  // column, matchLength}` so the editor scrolls to the line and selects the match. rg --vimgrep
  // carries `column` but no match length, so the exact submatch span Orca highlights from
  // its --json submatches (:143-170) cannot be split out here.
  // The reveal half has no Herdr primitive: `EditorState` binds only value / set_value / on /
  // release to JS (typings.rs:3144-3147, entity_api.rs:485-502), while base's line and scroll
  // setters — `InputBaseState::set_cursor_position` (state.rs:1392) and `set_scroll_offset`
  // (state.rs:3121) — stop at the Rust API. So the click opens the file at its top, which is
  // the closest the primitives allow; no padding pretends otherwise.
  // SearchResultsPane.tsx:68-69 sizes a match row 20px.
  searchMatch(path, match, i, t) {
    return h_flex().id(`files-hit-${path}-${i}`).w_full().h(20).flex_none().pl(28).pr(8).gap(4).items_center()
      .cursor_pointer().hover(s => s.bg(t.hover))
      .on_click((_e, cx) => this.show(path, cx))
      .child(div().flex_none().text_size(10).text_color(t.muted).child(String(match.line)))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(match.text));
  }

  // Unified layout: a narrowing panel keeps this content at its open width (see panel-motion.js).
  render(cx) { return panelFrame(this.renderBody(cx)); }

  renderBody(cx) {
    // A task's error is reported, not thrown into the paint: a failed refresh
    // must never replace the pane with the shell's "could not be re-rendered" bar.
    //
    // `cx.spawn` runs its body immediately up to the first `await` (scheduler.rs:582 `body.call`),
    // and `refresh()` calls `cx.notify()` before it awaits anything — so spawning it here ran a
    // notify inside the render phase, which the engine refuses. A timer runs after the frame, so
    // the refresh lands in the task phase where notify is allowed.
    if (workspaceKey() !== this.context?.key) cx.timer.after(0, (timerCx) => this.refresh(timerCx));
    const t = theme();
    const popup = this.popupView(t, cx);
    if (popup) return popup;
    return v_flex().id("files").size_full().min_h(0).overflow_hidden().text_color(t.foreground).text_size(13)
      .when(Boolean(this.operationError), el => el.child(div().px(12).py(6).text_size(11).text_color(t.ansi1).child(this.operationError)))
      .when(Boolean(this.file), el => el.child(this.fileHeader(t)))
      // FileExplorerToolbar.tsx:66-198 (the h-8 title/actions band, above) then
      // FileExplorerQueryStrip.tsx:35-52 (switch + active query input) then the tree.
      .when(!this.file, el => el.child(this.toolbar(t)))
      .when(!this.file, el => el.child(this.queryStrip(t)))
      // SearchResultsPane.tsx:88-94 — the summary is a fixed header above the scrolled rows.
      .when(!this.file && this.view === "search" && this.hits && (this.hits.files.length > 0 || this.hits.truncated),
        el => el.child(this.searchSummary(t)))
      .when(!this.file, el => el.child(this.treePane(t)))
      .when(Boolean(this.file), el => el.child(this.fileBody(t)));
  }

  // The popups this mod opens as copies of itself (props.tab), and the New/Rename prompt, replace the pane.
  popupView(t, cx) {
    if (this.prompt) return this.promptView(t);
    const tab = props()?.tab;
    if (tab === "file") return this.menuView(t);
    if (tab === "open-in") return this.openInView(t, cx);
    if (tab === "more") return this.moreView(t);
    return null;
  }

  // The open file's title band: back arrow, path and save status.
  fileHeader(t) {
    return h_flex().h(30).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, clickCx) => { this.show(null, clickCx); clickCx.notify(); }).child("←"))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(this.file ?? ""))
      .when(Boolean(this.code), el => el.child(div().flex_none().text_size(10).text_color(this.doc?.status === "failed" ? t.ansi1 : t.muted)
        .child(this.saveStatusText())));
  }

  saveStatusText() {
    if (!this.doc) return this.fileError || "Read-only";
    if (this.doc.status === "failed") return `Not saved: ${this.doc.error.slice(0, 60)}`;
    return ({ editing: "Editing…", saved: "Saved" })[this.doc.status] ?? "";
  }

  fileBody(t) {
    // The editor is a native element with no scroll API of its own, so it rides the
    // retained scroll container: the same `overflow_y_scrollbar` the tree uses, or a long
    // file cannot be read past the first screen.
    if (this.code) return div().flex_1().min_h(0).overflow_y_scrollbar().mode("always").child(Editor.new(this.code));
    return div().p(12).text_color(t.dim).child(this.fileError || "Loading file…");
  }

  treePane(t) {
    const search = this.view === "search";
    const status = this.treeStatus(t);
    return v_flex().id("files-tree").flex_1().min_h(0).relative().pt(8).pb(4)
      // The virtual list scrolls itself; only the contents hits still ride a scroll container.
      .when(search, pane => pane.overflow_y_scrollbar().mode("always"))
      // SearchResultsPane.tsx:57-70 — its virtualizer mixes 28px file rows with 20px match
      // rows; this Herdr `v_virtual_list` takes one height for the whole list, so the
      // grouped rows are a plain column, cheap because search() keeps at most 200 matches.
      .when(search, pane => pane.children(this.searchResults(t)))
      .when(!search, pane => pane.child(this.treeList(t)))
      .when(!search, pane => pane.child(Scrollbar.vertical("files-rows").viewport_from_layout().absolute().inset_0()))
      .when(Boolean(status), pane => pane.child(status))
      .when(this.limited, pane => pane.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")));
  }

  // The empty or pending state shown in place of rows, or null when there are rows.
  treeStatus(t) {
    if (this.view === "search") return this.searchStatus(t);
    if (this.view !== "files") return null;
    return this.name.value().trim() ? this.filterStatus(t) : this.folderStatus(t);
  }

  // FileExplorerTreeStatus.tsx:38-95, FileExplorerFilesTreePane.tsx:131-135 — every empty
  // state is a centred 11px muted line; loading is a bare 16px Loader2. The contents-search
  // no-results copy is SearchResultsPane.tsx:153-158.
  searchStatus(t) {
    if (this.hits && this.hits.totalMatches === 0 && !this.searching) return statusMessage(t, "No results. Try another search or adjust your filters.");
    return null;
  }

  // FileExplorerFilesTreePane.tsx:116-136 — with a name filter the empty state is a
  // Loader2 while the listing is pending, then "No files match this filter".
  filterStatus(t) {
    if (!this.nfMap && this.nfLoading) return centeredBox().child(spinner(t));
    if (this.nfMap?.size === 0) return statusMessage(t, "No files match this filter");
    return null;
  }

  folderStatus(t) {
    if (!this.error && this.entries.get("")?.length) return null;
    return this.emptyTreeState(t);
  }

  emptyTreeState(t) {
    if (this.error) return statusMessage(t, `Could not load files for this workspace: ${this.error}`);
    if (this.loading) return centeredBox().child(spinner(t));
    return statusMessage(t, this.root ? "No files in this workspace" : "Select a workspace to browse files");
  }
}
