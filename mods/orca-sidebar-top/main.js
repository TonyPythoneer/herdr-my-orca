// Orca's left sidebar: history arrows, Search, the Tasks / Automations / Orca Mobile rows, then
// the Projects header. The project tree under the header is orca-sidebar-projects; the three rows open
// pages in the middle column (`page-tasks` …), which the `orca` layout puts in the `main`
// stack. Bare rows rather than an omission: each page states its own gap (ADR 0004).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, run, openOverlay, closeOverlay, shared, window, layout, pickFolder, props, spaces, machines } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Orca keeps the Workspace options in PersistedUIState (`persisted-ui-state-types.ts:39-89`):
// groupBy, sortBy, projectOrderBy, filterRepoIds, visibleWorkspaceHostIds, the hide* filters and
// worktreeCardProperties. Herdr mods have no shared store, so the menu writes this versioned
// object and orca-sidebar-projects reads it in its row projection — the same one-way handoff as
// `projects.saved.v1`. Defaults are Orca's NO_WORKSPACE_ROW_FILTERS
// (`workspace-row-filters.ts:45-56`) plus repo grouping and manual sort.
const OPTIONS_KEY = "workspace.options.v1";
const OPTIONS_DEFAULTS = {
  groupBy: "repo",              // none | workspace-status | repo
  sortBy: "manual",             // name | smart | recent | repo | manual
  projectOrderBy: "manual",     // manual | recent
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

function readOptions() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "null"); } catch { saved = null; } // a hand-edited or truncated value falls back to the defaults
  return saved && typeof saved === "object" && !Array.isArray(saved)
    ? { ...OPTIONS_DEFAULTS, ...saved }
    : { ...OPTIONS_DEFAULTS };
}

function writeOptions(patch) {
  const next = { ...readOptions(), ...patch };
  localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
  // orca-sidebar-projects re-reads the key inside ordered(), so nothing has to be sent to it. An
  // invented cross-mod command is not a notification: an unregistered name is a warn and an
  // error (`window.rs:2763`), and `setShared` does not notify (AGENTS.md rule 10). The sidebar
  // repaints when this popup closes, because removing an overlay notifies the window
  // (`window.rs:3642-3664`), and the reopened popup always re-reads the stored options.
  return next;
}

// CountActiveWorkspaceFilters (workspace-row-filters.ts:182-194): each narrowing boolean, plus
// one per selected project and the host scope when narrowed. The default-branch exemption
// counts only while the sleeping sweep is on.
function activeFilterCount(o) {
  let n = 0;
  if (o.hideSleepingWorkspaces) n++;
  if (o.hideSleepingWorkspaces && o.alwaysShowDefaultBranchWorkspace === false) n++;
  if (o.hideDefaultBranchWorkspace) n++;
  if (o.hideAutomationGeneratedWorkspaces) n++;
  if (o.hideCliCreatedWorkspaces) n++;
  if (o.hideWorkspacesFromOtherDevices) n++;
  if (o.hideDetachedHeadWorkspaces) n++;
  if (o.visibleWorkspaceHostIds !== null) n++;
  n += o.filterRepoIds.length;
  return n;
}

// Host sections: every machine a space lives on, plus this computer. Orca's picker hides a host
// with no rows (`host-section-rows.ts:236-246`), so spaces() is the source, not machines().
function hostChoices() {
  const seen = new Map();
  for (const s of spaces()) seen.set(s.machine ?? null, s.machine ?? "This computer");
  for (const m of machines()) if (!seen.has(m.name)) seen.set(m.name, m.name ?? "This computer");
  return [...seen].map(([id, label]) => ({ id, label }));
}

// Projects are repo identities: `git.cache.v2` keys rows by `[machine, common dir]` and its value
// carries the display name (`main.js` hydrateGit). A folder workspace is not a project filter
// target (workspace-row-filters.ts:119-121 exempts folder rows), so only g.repo entries appear.
function projectChoices() {
  try {
    const cache = JSON.parse(localStorage.getItem("git.cache.v2") ?? "{}") ?? {};
    const seen = new Map();
    for (const g of Object.values(cache)) if (g?.repo) seen.set(g.repo, g.name ?? g.repo);
    return [...seen].map(([id, label]) => ({ id, label }));
  } catch {
    return []; // an unreadable cache means no known projects, so the Projects page just hides
  }
}

const SORT_CHOICES = [
  ["name", "Name"],
  ["smart", "Agent Activity"],
  ["recent", "Recent"],
  ["repo", "Project"],
  ["manual", "Manual"],
];
const PROJECT_ORDER_CHOICES = [
  ["manual", "Manual"],
  ["recent", "Recent"],
];
const GROUP_BY_CHOICES = [
  ["none", "None"],
  ["workspace-status", "Status"],
  ["repo", "Project"],
];

function labelOf(choices, value) {
  return choices.find(([id]) => id === value)?.[1] ?? choices[0][1];
}


// While the sidebar is stepped narrower (orca-header `toggleSidebar`) its content
// keeps the open width and only fades and slides, so nothing reflows or truncates on the way.
// Opacity clamp((k-.15)/.85) and a -28px*(1-k) shift are the approved prototype's numbers.
// Untouched (returns `inner`) whenever the sidebar is at its open width or no open width is shared.
function sidebarFrame(inner) {
  const open = shared("left-sidebar.openPx");
  const px = find(layout(), "left-sidebar")?.size?.px;
  if (!(open > 0) || !(px > 0) || px >= open - 0.5) return inner;
  const k = px / open;
  // GPU cost: a group `opacity` makes the GPU draw the whole subtree off-screen every frame. A flat
  // cover in the sidebar's own colour, with the alpha the fade needs, is one blended quad.
  const bg = theme().surface;
  const cover = Math.max(0, Math.min(1, 1 - (k - 0.15) / 0.85));
  const alpha = Math.round(cover * 255).toString(16).padStart(2, "0");
  return div().size_full().overflow_hidden().relative()
    .child(div().w(open).h_full().relative().left(-(1 - k) * 28).child(inner))
    .child(div().absolute().top(0).left(0).right(0).bottom(0).bg(/^#[0-9a-f]{6}$/i.test(bg) ? `${bg}${alpha}` : bg));
}

// SidebarNav.tsx:90-118 — container gap-0.5 px-2; Search is a button, not an input: full width,
// gap 8, rounded 6, bg foreground/5, px 8, py-1.5, text 13 medium foreground/60, icon 16 at /30.
// py-1.5 (6+6) + 13px text at preflight's inherited line-height 1.5 (19.5) = Orca's 31.5px row.
// :92 opens `worktree-palette`; Herdr's counterpart is the picker mod, not the command palette.
function searchButton() {
  return h_flex().id("nav-search").w_full().h(31.5).px(8).gap(8).items_center().rounded(6)
    .bg("#f0f0f00d").text_size(13).font_medium().text_color("#f0f0f099").cursor_pointer()
    .role("button").accessibility_label("Search worktrees")
    .hover(s => s.bg("#f0f0f014"))
    .on_click(() => run("mod.open", { name: "picker" }))
    .child(svg("mods/orca-sidebar-top/search.svg").size(16).flex_none().text_color("#f0f0f04d"))
    .child(div().flex_1().child("Search"));
}

function collapseAllButton(t, allCollapsed) {
  return div().id("proj-collapse-all").size(24).flex_none().flex().items_center().justify_center().rounded(6)
    .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
    .role("button").accessibility_label(allCollapsed ? "Expand all projects" : "Collapse all projects")
    .on_click(() => run(allCollapsed ? "orca-sidebar-projects.expand-all" : "orca-sidebar-projects.collapse-all"))
    // ProjectsCollapseAllButton.tsx:51 renders a bare `<Icon />`, so the icon-xs
    // `[&_svg:not([class*='size-'])]:size-3` rule (button.tsx:59) applies: 12px.
    .child(svg(allCollapsed ? "mods/orca-sidebar-top/chevrons-up-down.svg" : "mods/orca-sidebar-top/chevrons-down-up.svg").size(12));
}

// SidebarWorkspaceOptionsMenu.tsx:43-68 — a ghost icon-xs button (24x24) holding
// SlidersHorizontal `size-3.5` with the explicit `strokeWidth={2.25}` (:66), plus the
// corner filter badge. `sidebar-header-actions.tsx:92` places it before AddProject.
// Herdr has no Radix DropdownMenu, so the menu is this mod's own popup overlay, opened
// with the same openOverlay({kind:"popup"}) call orca-context-menu and new-menu use; the props
// select optionsView in render(). Choices persist in "workspace.options.v1" and
// orca-sidebar-projects reads that key in ordered().
function optionsButton(t) {
  // `OptionsFilterCountBadge` (options-filter-count-badge.tsx): a corner badge on the trigger,
  // 12px tall, 9px text, primary fill; 9+ past nine.
  const filters = activeFilterCount(readOptions());
  return div().id("proj-options").relative().size(24).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted)
    .hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
    .role("button").tooltip(filters ? `Workspace options (${filters} filter${filters === 1 ? "" : "s"})` : "Workspace options")
    .accessibility_label(filters ? `Workspace options (${filters} filter${filters === 1 ? "" : "s"} active)` : "Workspace options")
    .on_click(() => openOverlay({ mod: "orca-sidebar-top", kind: "popup", width: 288, height: 560, props: { navMenu: "workspace-options" } }))
    .child(svg("mods/orca-sidebar-top/sliders-horizontal.svg").size(14).flex_none())
    .when(filters > 0, el => el.child(div().absolute().top(-2).right(-2).h(12).min_w(12).px(2).rounded_full().bg(t.accent).flex().items_center().justify_center()
      .text_size(9).line_height("9px").text_color(t.accent_foreground).child(filters > 9 ? "9+" : String(filters))));
}

// Appends the picked folder to the persisted project list (once) and opens a space on it.
function addProject(folder) {
  if (!folder) return;
  let existing = [];
  try {
    const value = JSON.parse(localStorage.getItem("projects.saved.v1") || "[]");
    if (Array.isArray(value)) existing = value;
  } catch { /* A corrupted project list must not block adding a new folder. */ }
  if (!existing.includes(folder)) {
    existing.push(folder);
    localStorage.setItem("projects.saved.v1", JSON.stringify(existing));
  }
  run("space.new", { folder });
}

// AddProjectButton (:27-31) — FolderPlus `size-3.5` at the explicit `strokeWidth={2.25}`.
function addProjectButton(t) {
  return div().id("proj-add-repo").size(24).flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
    .role("button").accessibility_label("Add project")
    // herdr.d.ts:39 — the folder picker is async: `Promise<string | null>`.
    // Taking the promise as a value stored "[object Promise]" as the folder.
    .on_click(() => { void pickFolder().then(addProject); })
    .child(svg("mods/orca-sidebar-top/folder-plus.svg").size(14));
}

// NewWorkspaceButton (:60-64) — Plus `size-3.5`, same 2.25 stroke. Orca's header
// actions are `size="icon-xs"` buttons, which are 24x24, so this is not wider than
// the options slot.
function newWorkspaceButton(t) {
  return div().id("proj-new").size(24).flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
    .role("button").accessibility_label("New workspace")
    // tab-bar-surface.tsx:232 — the create menu is `w-72` (288).
    .on_click(() => openOverlay({ mod: "orca-new-menu", kind: "popup", width: 288, height: 512 }))
    .child(svg("mods/orca-sidebar-top/plus.svg").size(14));
}

// Activating one of these rows writes one option patch and redraws. A `null` patch is the one
// row that must not write: Orca disables the last checked host so the sidebar cannot show none.
function hostPatch(row, o) {
  const all = hostChoices().map((h) => h.id);
  const current = o.visibleWorkspaceHostIds === null ? all : o.visibleWorkspaceHostIds;
  const next = current.includes(row.host) ? current.filter((id) => id !== row.host) : [...current, row.host];
  if (next.length === 0) return null;
  return { visibleWorkspaceHostIds: next.length === all.length ? null : next };
}

const OPTION_PATCH = {
  __proto__: null,
  toggle: (row, o) => ({ [row.key]: !o[row.key] }),
  radio: (row) => ({ [row.key]: row.value }),
  groupby: (row) => ({ groupBy: row.value }),
  hostAll: () => ({ visibleWorkspaceHostIds: null }),
  host: hostPatch,
  projectClear: () => ({ filterRepoIds: [] }),
  project: (row, o) => ({
    filterRepoIds: o.filterRepoIds.includes(row.project)
      ? o.filterRepoIds.filter((id) => id !== row.project)
      : [...o.filterRepoIds, row.project],
  }),
};

// Rows that need no state: rules and headings, in dropdown-menu.tsx's geometry.
function staticRow(row, t) {
  if (row.kind === "separator") return div().mx(10).my(5).h(1).bg(t.border);
  if (row.kind === "label") return div().px(10).pt(5).text_size(14).text_color(t.foreground).child(row.text);
  if (row.kind === "heading") return div().px(10).pt(5).pb(3).text_size(11).font_semibold().text_color(t.muted).child(row.text);
  return null;
}

const CHECK_KINDS = new Set(["radio", "host", "hostAll", "project", "toggle"]);
function checkMark(row) {
  if (!row.checked) return "";
  return row.kind === "radio" ? "●" : "✓";
}

const VALUE_TEXT = { __proto__: null, page: (row) => `${row.value} ›`, action: (row) => row.value, gap: () => "Unavailable" };
function valueText(row) {
  return row.kind in VALUE_TEXT ? VALUE_TEXT[row.kind](row) : "";
}

export default class Nav extends View {
  // The placed nav is not focusable; the popup copy is. Its keyboard list starts at the first row
  // (dropdown-menu.tsx:115 data-[current=true]), and Esc closes it (SidebarWorkspaceOptionsMenu
  // closes its Radix DropdownMenu).
  init(_props, cx) {
    if (!props()?.navMenu) return;
    this.at = -1;
    this.page = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  // The workspace-options popup is its own overlay, not sidebar content, so it never slides or fades.
  render(cx) { return props()?.navMenu ? this.renderBody(cx) : sidebarFrame(this.renderBody(cx)); }

  renderBody(cx) {
    if (props()?.navMenu === "workspace-options") return this.optionsView(cx);
    const t = theme();
    return v_flex().w_full().flex_none().px(8).pt(8).pb(4).gap(2).bg(t.surface)
      .child(searchButton())
      .child(this.projectsHeader(t));
  }

  // Projects header — SidebarHeader.tsx:60-63: `group/sidebar-header mt-2 flex h-8 min-w-0
  // shrink-0 items-center justify-between gap-1.5 px-2`; title `pl-2 pr-0.5 text-xs
  // font-semibold text-muted-foreground/80`; actions group `flex shrink-0 items-center gap-1`.
  // Icons are plain Lucide at their default stroke-width 2 — there is no global override in
  // Orca's CSS (main.css:3090 is a feature-wall decoration, not icons).
  projectsHeader(t) {
    return h_flex().w_full().h(32).mt(8).gap(6).items_center().justify_between()
      // `SidebarHeader.tsx:61` is `group/sidebar-header`; the collapse-all wrapper is
      // `can-hover:w-0 can-hover:opacity-0`, becoming `w-6 opacity-100` on that hover or on
      // `focus-within` (ProjectsCollapseAllButton.tsx:35-38). Herdr has no descendant selector,
      // so the row's `.on_hover` is the gate and the button mounts only then. Dropped:
      // `focus-within`, since the button is not mounted while hidden.
      .on_hover((on, eventCx) => {
        // Hover is only ever cleared by a pointer transition. A window that goes
        // inactive (pointer on another window, no move events delivered here) keeps
        // the last value, so the button stays mounted after the pointer left.
        // `window().active` reports that state; clearing here is where the stale
        // value originates, not a guard applied downstream.
        const live = on && window().active;
        if (live !== this.headerHover) { this.headerHover = live; eventCx.notify(); }
      })
      .child(this.projectsTitle(t))
      // ORDER, from SidebarHeader.tsx:76-100 — `SidebarHeaderActions` runs
      // options -> AddProject -> NewWorkspace.
      // SidebarHeader.tsx:101 — the bell swaps the sidebar body to agents; orca-right-sidebar-agents is a right-sidebar panel, so there is no second body.
      .child(h_flex().flex_none().items_center().gap(4)
        .child(optionsButton(t))
        .child(addProjectButton(t))
        .child(newWorkspaceButton(t)));
  }

  projectsTitle(t) {
    // `allCollapsed` arrives over `setShared` from orca-sidebar-projects, which owns the fold state.
    const allCollapsed = Boolean(shared("projects.allCollapsed"));
    // `WorktreeList.tsx:290` — the collapse-all button is mounted only when there is at least
    // one collapsible project (`projectCollapseKeys.length > 0`). orca-sidebar-projects publishes that
    // count because the header has no view of the row plan. Zero projects means no button,
    // not a disabled one.
    const projectCount = Number(shared("projects.count") ?? 0);
    return h_flex().min_w(0).items_center()
      // `text-muted-foreground/80`: main.css:365 #acacac at 80% = #8a8a8a.
      .child(div().pl(8).pr(2).text_size(12).font_semibold().text_color("#8a8a8a").child("Projects"))
      .when(projectCount > 0 && this.headerHover, el => el.child(collapseAllButton(t, allCollapsed)));
  }

  // ---- Workspace options overlay (SidebarWorkspaceOptionsMenu.tsx + workspace-options-menu-items.tsx) ----
  // One popup page at a time stands in for Radix's DropdownMenuSub (Herdr has no submenu
  // primitive); a back row returns to the root. Row geometry follows dropdown-menu.tsx:
  // items h-24 px-2.5 rounded-md text-13; separators mx-2.5 my-[5px] h-px; labels 11px semibold.
  optionsView(cx) {
    const t = theme();
    const rows = this.page ? this.pageRows(this.page) : this.rootRows();
    // The group-by row is the segmented control itself, so keyboard activation skips it.
    const nav = rows.filter((r) => r.kind !== "separator" && r.kind !== "label" && r.kind !== "heading" && r.kind !== "gap" && r.kind !== "groupby");
    if (!nav.includes(rows[this.at])) this.at = rows.indexOf(nav[0] ?? rows[0]);
    return v_flex().id("workspace-options").track_focus(this.handle).w_full().min_h(0).p(4).bg(t.popover).text_size(13)
      .on_key_down((e, eventCx) => {
        // Radix menu keyboard: up/down move the current row, Home/End jump, Enter/Space activate
        // (dropdown-menu.tsx:115 data-[current=true]; context-menu.tsx:31-62).
        if (e.key === "down" || e.key === "up") {
          const i = Math.max(0, nav.indexOf(rows[this.at]));
          const next = e.key === "down" ? (i + 1) % nav.length : (i + nav.length - 1) % nav.length;
          this.at = rows.indexOf(nav[next]);
        } else if (e.key === "home") this.at = rows.indexOf(nav[0]);
        else if (e.key === "end") this.at = rows.indexOf(nav[nav.length - 1]);
        else if (e.key === "enter" || e.key === "space") { const row = rows[this.at]; if (row) this.act(row, eventCx); }
        else if (e.key === "escape") closeOverlay(props()?.overlay);
        else return;
        eventCx.notify();
      })
      .children(rows.map((row, i) => this.menuRow(row, i, t)));
  }

  rootRows() {
    const o = readOptions();
    const hosts = hostChoices();
    const projects = projectChoices();
    const rows = [];
    const push = (row) => rows.push(row);
    // WorkspaceOptionsMenuItems (:299-307): the title label, then sections separated by rules.
    push({ kind: "label", text: "Workspace options" });
    // Not an Orca row. Orca's sidebar rescans a repo whenever a dialog asks (the visibility
    // dialog's Refresh scans again), so it needs no manual one; Herdr learns a project's
    // branches from orca-sidebar-projects' own git read, whose fallback is 60 s and which a checkout in
    // another app can outrun. This asks orca-sidebar-projects for the same pass on purpose.
    push({ kind: "action", command: "refresh", label: "Refresh branches", value: "All projects" });
    // Show — getShownWorkspaceViewSections SHOWN (workspace-view-options.ts:120-141):
    // hosts only with another host, projects only with more than one project.
    if (hosts.length > 1 || o.visibleWorkspaceHostIds !== null) {
      if (!rows.some((r) => r.kind === "heading")) push({ kind: "heading", text: "Show" });
      push({ kind: "page", page: "hosts", label: "Hosts", value: o.visibleWorkspaceHostIds === null ? "All hosts" : `${o.visibleWorkspaceHostIds.length} hosts` });
    }
    if (projects.length > 1) {
      if (!rows.some((r) => r.kind === "heading")) push({ kind: "heading", text: "Show" });
      push({ kind: "page", page: "projects", label: "Projects", value: o.filterRepoIds.length ? `${o.filterRepoIds.length} projects` : "All projects" });
    }
    // Group by — SidebarGroupByToggle.tsx is an inline segmented control, not a submenu.
    push({ kind: "separator" });
    push({ kind: "heading", text: "Group by" });
    push({ kind: "groupby" });
    // Arrange — no heading in WORKSPACE_VIEW_SECTION_LABELS (:89-94).
    push({ kind: "separator" });
    push({ kind: "page", page: "sort", label: "Sort by", value: labelOf(SORT_CHOICES, o.sortBy) });
    // projectOrderBy is shown only under repo grouping (workspace-view-options.ts:133).
    if (o.groupBy === "repo") push({ kind: "page", page: "projectOrder", label: "Project order", value: labelOf(PROJECT_ORDER_CHOICES, o.projectOrderBy) });
    // Card layout and Show properties exist in Orca's legacy card surface; Herdr's
    // worktree-card-surface port has one fixed shape, so these keep Orca's disabled-row
    // geometry (`data-[disabled]:opacity-40`, dropdown-menu.tsx:115) and name the gap.
    push({ kind: "gap", label: "Card layout", note: "Herdr draws one card style; worktree-card-surface.tsx has no compact layout." });
    push({ kind: "gap", label: "Show properties", note: "Herdr's card has no per-property model; branch and review badge are fixed." });
    // Filters — workspace-filter-option-row.tsx FILTER_ROWS ordering.
    push({ kind: "separator" });
    push({ kind: "heading", text: "Filters" });
    push({ kind: "gap", label: "Hide sleeping", note: "Herdr has no sleep state; Model::status is working, blocked, done or idle." });
    push({ kind: "toggle", key: "hideDefaultBranchWorkspace", label: "Hide default branch" });
    push({ kind: "gap", label: "Hide automation-created", note: "Herdr records no automation provenance for a space." });
    push({ kind: "gap", label: "Hide CLI-created", note: "Herdr records no CLI provenance for a space." });
    if (machines().length > 1) push({ kind: "gap", label: "Hide other-client workspaces", note: "Herdr records no other-client provenance for a space." });
    push({ kind: "toggle", key: "hideDetachedHeadWorkspaces", label: "Hide detached HEAD" });
    return rows;
  }

  pageRows(page) {
    const o = readOptions();
    const rows = [{ kind: "back", label: "Back" }];
    if (page === "hosts") {
      const all = o.visibleWorkspaceHostIds === null;
      rows.push({ kind: "hostAll", label: "All hosts", checked: all });
      for (const h of hostChoices()) rows.push({ kind: "host", host: h.id, label: h.label, checked: all || o.visibleWorkspaceHostIds.includes(h.id) });
    } else if (page === "projects") {
      rows.push({ kind: "projectClear", label: "Clear", disabled: o.filterRepoIds.length === 0 });
      for (const p of projectChoices()) rows.push({ kind: "project", project: p.id, label: p.label, checked: o.filterRepoIds.includes(p.id) });
    } else {
      const choices = page === "sort" ? SORT_CHOICES : PROJECT_ORDER_CHOICES;
      const key = page === "sort" ? "sortBy" : "projectOrderBy";
      for (const [value, label] of choices) rows.push({ kind: "radio", key, value, label, checked: o[key] === value });
    }
    return rows;
  }

  act(row, cx) {
    if (row.kind === "action") {
      run(`orca-sidebar-projects.${row.command}`);
      closeOverlay(props()?.overlay);
      return;
    }
    if (row.kind === "back" || row.kind === "page") {
      this.page = row.kind === "back" ? null : row.page;
      this.at = -1;
      cx.notify();
      return;
    }
    const patch = OPTION_PATCH[row.kind]?.(row, readOptions());
    if (!patch) return;
    writeOptions(patch);
    cx.notify();
  }

  menuRow(row, i, t) {
    if (row.kind === "groupby") return this.groupToggle(readOptions(), t);
    return staticRow(row, t) ?? this.optionRow(row, i, t);
  }

  optionRow(row, i, t) {
    const current = this.at === i;
    const disabled = row.kind === "gap" || Boolean(row.disabled);
    // Row shape: `rounded-md px-2.5 py-1 text-[13px] leading-4` = 24px; disabled is
    // `pointer-events-none opacity-40` (dropdown-menu.tsx:115).
    return h_flex().id(`opt-${i}`).h(24).px(10).gap(8).items_center().justify_between().rounded(6)
      .text_size(13).line_height("16px").text_color(disabled ? t.muted : t.foreground)
      .when(disabled, (el) => el.opacity(0.4).tooltip(row.note))
      .when(current && !disabled, (el) => el.bg(t.selected))
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
        .on_hover((on, hoverCx) => { if (on && this.at !== i) { this.at = i; hoverCx.notify(); } })
        .on_click((_e, clickCx) => this.act(row, clickCx)))
      .when(CHECK_KINDS.has(row.kind), (el) => el.child(div().w(14).flex_none().text_size(12).child(checkMark(row))))
      .child(div().flex_1().min_w(0).truncate().child(row.label))
      // Right value: `ml-auto text-[11px] font-medium text-muted-foreground` (:93-147).
      .child(div().flex_none().max_w(150).truncate().text_size(11).font_medium().text_color(t.muted).child(valueText(row)));
  }

  // SidebarGroupByToggle.tsx: `h-6 w-full`, each item `h-6 grow basis-0 px-1 text-[10px]`,
  // selected `bg-foreground/10 font-semibold text-foreground`.
  groupToggle(o, t) {
    return h_flex().mx(8).mt(2).mb(4).h(24).rounded(6).border_1().border_color(t.border)
      .children(GROUP_BY_CHOICES.map(([value, label]) => div().id(`opt-group-${value}`)
        .flex_1().h(24).flex().items_center().justify_center().px(4).text_size(10).cursor_pointer()
        .when(o.groupBy === value, (el) => el.bg("#f0f0f01a").font_semibold().text_color(t.foreground))
        .when(o.groupBy !== value, (el) => el.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
        .on_click((_e, clickCx) => { writeOptions({ groupBy: value }); clickCx.notify(); })
        .child(label)));
  }
}