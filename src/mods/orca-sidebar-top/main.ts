import {
  View,
  div,
  svg,
  type Color,
  type Context,
  type FocusHandle,
  type KeyEvent,
  type NativeElement,
} from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  theme,
  run,
  openOverlay,
  closeOverlay,
  shared,
  setShared,
  window as appWindow,
  layout,
  pickFolder,
  props,
  spaces,
  machines,
} from "herdr";
import { IconButton } from "../../shared/icon-button.js";
import { themeColor } from "../../shared/theme-color.js";

type NavTheme = {
  surface: Color;
  background: Color;
  dim: Color;
  border: Color;
  foreground: Color;
  muted: Color;
  popover: Color;
  selected: Color;
  hover: Color;
  accent: Color;
  accent_foreground: Color;
};
type NavNode = { id?: string; children?: NavNode[]; size?: { px?: number } };
type Options = {
  groupBy: string;
  sortBy: string;
  projectOrderBy: string;
  filterRepoIds: string[];
  visibleWorkspaceHostIds: Array<string | null> | null;
  hideSleepingWorkspaces: boolean;
  alwaysShowDefaultBranchWorkspace: boolean;
  hideDefaultBranchWorkspace: boolean;
  hideAutomationGeneratedWorkspaces: boolean;
  hideCliCreatedWorkspaces: boolean;
  hideWorkspacesFromOtherDevices: boolean;
  hideDetachedHeadWorkspaces: boolean;
};
type OptionKey = keyof Options;
const ROW = {
  label: "label",
  heading: "heading",
  separator: "separator",
  gap: "gap",
  groupby: "groupby",
  action: "action",
  page: "page",
  back: "back",
  toggle: "toggle",
  radio: "radio",
  host: "host",
  hostAll: "hostAll",
  project: "project",
  projectClear: "projectClear",
} as const;
type RowKind = (typeof ROW)[keyof typeof ROW];
type Row = {
  kind: RowKind;
  text?: string;
  command?: string;
  label?: string;
  value?: string;
  key?: OptionKey;
  page?: string;
  host?: string | null;
  project?: string;
  checked?: boolean;
  disabled?: boolean;
  note?: string;
};
type Choice = readonly [string, string];
type GitCacheEntry = { repo?: string; name?: string } | null;

const PAGE = {
  hosts: "hosts",
  projects: "projects",
  sort: "sort",
  projectOrder: "projectOrder",
} as const;
const WORKSPACE_OPTIONS_MENU = "workspace-options";
const SELF_MOD = "orca-sidebar-top";
const PICKER_MOD = "picker";
const NEW_MENU_MOD = "orca-new-menu";
const LEFT_SIDEBAR_ID = "left-sidebar";
const LEFT_SIDEBAR_OPEN_PX_KEY = "left-sidebar.openPx";
const PROJECTS_ALL_COLLAPSED_KEY = "projects.allCollapsed";
const PROJECTS_COUNT_KEY = "projects.count";
const PROJECTS_SAVED_KEY = "projects.saved.v1";
const GIT_CACHE_KEY = "git.cache.v2";
const OPTIONS_KEY = "workspace.options.v1";
const OPTIONS_DEFAULT_GROUP = "repo";
const OPTIONS_DEFAULT_SORT = "manual";
const WORKSPACE_OPTIONS_LABEL = "Workspace options";
const ALL_PROJECTS_LABEL = "All projects";
const THIS_COMPUTER_LABEL = "This computer";
const PROJECTS_LABEL = "Projects";
const BACK_LABEL = "Back";
const UNAVAILABLE_LABEL = "Unavailable";
const BADGE_MAX = 9;
const BADGE_OVERFLOW_TEXT = "9+";
const CHECK_MARK = "✓";
const RADIO_MARK = "●";
const HEX6 = /^#[0-9a-f]{6}$/i;

const ICON = {
  search: "mods/orca-assets/search--orca-right-sidebar-agents.svg",
  chevronsUpDown: "mods/orca-assets/chevrons-up-down.svg",
  chevronsDownUp: "mods/orca-assets/chevrons-down-up.svg",
  slidersHorizontal: "mods/orca-assets/sliders-horizontal.svg",
  folderPlus: "mods/orca-assets/folder-plus--orca-sidebar-top.svg",
  plus: "mods/orca-assets/plus--orca-sidebar-top.svg",
} as const;

const COLOR = {
  searchBg: "#f0f0f00d",
  searchHoverBg: "#f0f0f014",
  searchText: "#f0f0f099",
  searchIcon: "#f0f0f04d",
  groupSelectedBg: "#f0f0f01a",
  projectsTitle: "#8a8a8a",
} as const;

const OPTIONS_DEFAULTS: Options = {
  groupBy: OPTIONS_DEFAULT_GROUP,
  sortBy: OPTIONS_DEFAULT_SORT,
  projectOrderBy: OPTIONS_DEFAULT_SORT,
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

const SORT_CHOICES: Choice[] = [
  ["name", "Name"],
  ["smart", "Agent Activity"],
  ["recent", "Recent"],
  ["repo", "Project"],
  ["manual", "Manual"],
];
const PROJECT_ORDER_CHOICES: Choice[] = [
  ["manual", "Manual"],
  ["name", "Name"],
  ["recent", "Recent"],
];
const GROUP_BY_CHOICES: Choice[] = [
  ["none", "None"],
  ["workspace-status", "Status"],
  ["repo", "Project"],
];

const NON_NAV_KINDS: ReadonlySet<RowKind> = new Set<RowKind>([
  ROW.separator,
  ROW.label,
  ROW.heading,
  ROW.gap,
  ROW.groupby,
]);
const CHECK_KINDS: ReadonlySet<RowKind> = new Set<RowKind>([
  ROW.radio,
  ROW.host,
  ROW.hostAll,
  ROW.project,
  ROW.toggle,
]);

function readTheme(): NavTheme {
  const raw = theme();
  return {
    surface: themeColor(raw.surface),
    background: themeColor(raw.background),
    dim: themeColor(raw.dim),
    border: themeColor(raw.border),
    foreground: themeColor(raw.foreground),
    muted: themeColor(raw.muted),
    popover: themeColor(raw.popover),
    selected: themeColor(raw.selected),
    hover: themeColor(raw.hover),
    accent: themeColor(raw.accent),
    accent_foreground: themeColor(raw.accent_foreground),
  };
}

function find(node: NavNode, id: string): NavNode | null {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

function isOptions(value: unknown): value is Partial<Options> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function storedOptions(): unknown {
  try {
    return JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "null");
  } catch {
    return null;
  }
}

function readOptions(): Options {
  let saved: unknown = shared(OPTIONS_KEY);
  if (!isOptions(saved)) saved = storedOptions();
  return isOptions(saved) ? { ...OPTIONS_DEFAULTS, ...saved } : { ...OPTIONS_DEFAULTS };
}

function writeOptions(patch: Partial<Options>): Options {
  const next = { ...readOptions(), ...patch };
  localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
  setShared(OPTIONS_KEY, next);
  return next;
}

function activeFilterCount(o: Options): number {
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

function hostChoices(): Array<{ id: string | null; label: string }> {
  const seen = new Map<string | null, string>();
  for (const s of spaces()) seen.set(s.machine ?? null, s.machine ?? THIS_COMPUTER_LABEL);
  for (const m of machines())
    if (!seen.has(m.name)) seen.set(m.name, m.name ?? THIS_COMPUTER_LABEL);
  return [...seen].map(([id, label]) => ({ id, label }));
}

function projectChoices(): Array<{ id: string; label: string }> {
  try {
    const cache: Record<string, GitCacheEntry> =
      JSON.parse(localStorage.getItem(GIT_CACHE_KEY) ?? "{}") ?? {};
    const seen = new Map<string, string>();
    for (const g of Object.values(cache)) if (g?.repo) seen.set(g.repo, g.name ?? g.repo);
    return [...seen].map(([id, label]) => ({ id, label }));
  } catch {
    return [];
  }
}

function labelOf(choices: Choice[], value: string): string {
  return choices.find(([id]) => id === value)?.[1] ?? choices[0][1];
}

function filterCount(count: number): string {
  return `${count} filter${count === 1 ? "" : "s"}`;
}

function withAlpha(color: Color, alpha: string): Color {
  return `${color}${alpha}`;
}

function sidebarFrame(inner: NativeElement): NativeElement {
  const open = shared(LEFT_SIDEBAR_OPEN_PX_KEY) as number;
  const px = find(layout() as NavNode, LEFT_SIDEBAR_ID)?.size?.px as number;
  if (!(open > 0) || !(px > 0) || px >= open - 0.5) return inner;
  const k = px / open;
  const surface = themeColor(theme().surface);
  const cover = Math.max(0, Math.min(1, 1 - (k - 0.15) / 0.85));
  const alpha = Math.round(cover * 255)
    .toString(16)
    .padStart(2, "0");
  return div()
    .size_full()
    .overflow_hidden()
    .relative()
    .child(
      div()
        .w(open)
        .h_full()
        .relative()
        .left(-(1 - k) * 28)
        .child(inner),
    )
    .child(
      div()
        .absolute()
        .top(0)
        .left(0)
        .right(0)
        .bottom(0)
        .bg(HEX6.test(surface) ? withAlpha(surface, alpha) : surface),
    );
}

function searchButton(): NativeElement {
  return h_flex()
    .id("nav-search")
    .w_full()
    .h(31.5)
    .px(8)
    .gap(8)
    .items_center()
    .rounded(6)
    .bg(COLOR.searchBg)
    .text_size(13)
    .font_medium()
    .text_color(COLOR.searchText)
    .cursor_pointer()
    .role("button")
    .accessibility_label("Search worktrees")
    .hover((s) => s.bg(COLOR.searchHoverBg))
    .on_click(() => run("mod.open", { name: PICKER_MOD }))
    .child(svg(ICON.search).size(16).flex_none().text_color(COLOR.searchIcon))
    .child(div().flex_1().child("Search"));
}

function collapseAllButton(t: NavTheme, allCollapsed: boolean): NativeElement {
  return IconButton(
    "proj-collapse-all",
    allCollapsed ? "Expand all projects" : "Collapse all projects",
    svg(allCollapsed ? ICON.chevronsUpDown : ICON.chevronsDownUp).size(12),
    {
      t,
      onClick: () =>
        run(
          allCollapsed ? "orca-sidebar-projects.expand-all" : "orca-sidebar-projects.collapse-all",
        ),
    },
  );
}

function badge(t: NavTheme, filters: number): NativeElement {
  return div()
    .absolute()
    .top(-2)
    .right(-2)
    .h(12)
    .min_w(12)
    .px(2)
    .rounded_full()
    .bg(t.accent)
    .flex()
    .items_center()
    .justify_center()
    .text_size(9)
    .line_height("9px")
    .text_color(t.accent_foreground)
    .child(filters > BADGE_MAX ? BADGE_OVERFLOW_TEXT : String(filters));
}

function optionsButton(t: NavTheme): NativeElement {
  const filters = activeFilterCount(readOptions());
  const summary = filters
    ? `${WORKSPACE_OPTIONS_LABEL} (${filterCount(filters)})`
    : WORKSPACE_OPTIONS_LABEL;
  return IconButton(
    "proj-options",
    filters
      ? `${WORKSPACE_OPTIONS_LABEL} (${filterCount(filters)} active)`
      : WORKSPACE_OPTIONS_LABEL,
    svg(ICON.slidersHorizontal).size(14).flex_none(),
    {
      t,
      tooltip: summary,
      onClick: () =>
        openOverlay({
          mod: SELF_MOD,
          kind: "popup",
          width: 288,
          height: 560,
          props: { navMenu: WORKSPACE_OPTIONS_MENU },
        }),
    },
  )
    .relative()
    .when(filters > 0, (el) => el.child(badge(t, filters)));
}

function addProject(folder: string | null | undefined): void {
  if (!folder) return;
  let existing: string[] = [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PROJECTS_SAVED_KEY) || "[]");
    if (Array.isArray(value)) existing = value;
  } catch {}
  if (!existing.includes(folder)) {
    existing.push(folder);
    localStorage.setItem(PROJECTS_SAVED_KEY, JSON.stringify(existing));
  }
  run("space.new", { folder });
}

function addProjectButton(t: NavTheme): NativeElement {
  return IconButton("proj-add-repo", "Add project", svg(ICON.folderPlus).size(14), {
    t,
    onClick: () => {
      void pickFolder().then(addProject);
    },
  });
}

function newWorkspaceButton(t: NavTheme): NativeElement {
  return IconButton("proj-new", "New workspace", svg(ICON.plus).size(14), {
    t,
    onClick: () => openOverlay({ mod: NEW_MENU_MOD, kind: "popup", width: 288 }),
  });
}

function hostPatch(row: Row, o: Options): Partial<Options> | null {
  const all = hostChoices().map((h) => h.id);
  const host = row.host as string | null;
  const current = o.visibleWorkspaceHostIds === null ? all : o.visibleWorkspaceHostIds;
  const next = current.includes(host) ? current.filter((id) => id !== host) : [...current, host];
  if (next.length === 0) return null;
  return { visibleWorkspaceHostIds: next.length === all.length ? null : next };
}

const OPTION_PATCH: Partial<Record<RowKind, (row: Row, o: Options) => Partial<Options> | null>> = {
  [ROW.toggle]: (row, o) => {
    const key = row.key as OptionKey;
    return { [key]: !o[key] };
  },
  [ROW.radio]: (row) => {
    const key = row.key as OptionKey;
    return { [key]: row.value };
  },
  [ROW.groupby]: (row) => ({ groupBy: row.value as string }),
  [ROW.hostAll]: () => ({ visibleWorkspaceHostIds: null }),
  [ROW.host]: hostPatch,
  [ROW.projectClear]: () => ({ filterRepoIds: [] }),
  [ROW.project]: (row, o) => {
    const project = row.project as string;
    return {
      filterRepoIds: o.filterRepoIds.includes(project)
        ? o.filterRepoIds.filter((id) => id !== project)
        : [...o.filterRepoIds, project],
    };
  },
};

function staticRow(row: Row, t: NavTheme): NativeElement | null {
  if (row.kind === ROW.separator) return div().mx(10).my(5).h(1).bg(t.border);
  if (row.kind === ROW.label)
    return div()
      .px(10)
      .pt(5)
      .text_size(14)
      .text_color(t.foreground)
      .child(row.text as string);
  if (row.kind === ROW.heading)
    return div()
      .px(10)
      .pt(5)
      .pb(3)
      .text_size(11)
      .font_semibold()
      .text_color(t.muted)
      .child(row.text as string);
  return null;
}

function checkMark(row: Row): string {
  if (!row.checked) return "";
  return row.kind === ROW.radio ? RADIO_MARK : CHECK_MARK;
}

const VALUE_TEXT: Partial<Record<RowKind, (row: Row) => string>> = {
  [ROW.page]: (row) => `${row.value} ›`,
  [ROW.action]: (row) => row.value as string,
  [ROW.gap]: () => UNAVAILABLE_LABEL,
};
function valueText(row: Row): string {
  const format = VALUE_TEXT[row.kind];
  return format ? format(row) : "";
}

function heading(text: string): Row {
  return { kind: ROW.heading, text };
}

function separator(): Row {
  return { kind: ROW.separator };
}

function gap(label: string, note: string): Row {
  return { kind: ROW.gap, label, note };
}

function toggle(key: OptionKey, label: string): Row {
  return { kind: ROW.toggle, key, label };
}

function showRows(o: Options, hostCount: number, projectCount: number): Row[] {
  const showHosts = hostCount > 1 || o.visibleWorkspaceHostIds !== null;
  const showProjects = projectCount > 1;
  const rows: Row[] = [];
  if (showHosts || showProjects) rows.push(heading("Show"));
  if (showHosts)
    rows.push({
      kind: ROW.page,
      page: PAGE.hosts,
      label: "Hosts",
      value:
        o.visibleWorkspaceHostIds === null
          ? "All hosts"
          : `${o.visibleWorkspaceHostIds.length} hosts`,
    });
  if (showProjects)
    rows.push({
      kind: ROW.page,
      page: PAGE.projects,
      label: PROJECTS_LABEL,
      value: o.filterRepoIds.length ? `${o.filterRepoIds.length} projects` : ALL_PROJECTS_LABEL,
    });
  return rows;
}

function groupRows(): Row[] {
  return [separator(), heading("Group by"), { kind: ROW.groupby }, separator()];
}

function sortRows(o: Options): Row[] {
  const rows: Row[] = [
    {
      kind: ROW.page,
      page: PAGE.sort,
      label: "Worktree sort",
      value: labelOf(SORT_CHOICES, o.sortBy),
    },
  ];
  if (o.groupBy === "repo")
    rows.push({
      kind: ROW.page,
      page: PAGE.projectOrder,
      label: "Project sort",
      value: labelOf(PROJECT_ORDER_CHOICES, o.projectOrderBy),
    });
  rows.push(
    gap(
      "Card layout",
      "Herdr draws one card style; worktree-card-surface.tsx has no compact layout.",
    ),
    gap(
      "Show properties",
      "Herdr's card has no per-property model; branch and review badge are fixed.",
    ),
    separator(),
  );
  return rows;
}

function filterRows(): Row[] {
  const rows: Row[] = [
    heading("Filters"),
    gap(
      "Hide sleeping",
      "Herdr has no sleep state; Model::status is working, blocked, done or idle.",
    ),
    toggle("hideDefaultBranchWorkspace", "Hide default branch"),
    gap("Hide automation-created", "Herdr records no automation provenance for a space."),
    gap("Hide CLI-created", "Herdr records no CLI provenance for a space."),
  ];
  if (machines().length > 1)
    rows.push(
      gap("Hide other-client workspaces", "Herdr records no other-client provenance for a space."),
    );
  rows.push(toggle("hideDetachedHeadWorkspaces", "Hide detached HEAD"));
  return rows;
}

function hostsPageRows(o: Options): Row[] {
  const all = o.visibleWorkspaceHostIds === null;
  const rows: Row[] = [{ kind: ROW.hostAll, label: "All hosts", checked: all }];
  for (const h of hostChoices())
    rows.push({
      kind: ROW.host,
      host: h.id,
      label: h.label,
      checked: o.visibleWorkspaceHostIds === null || o.visibleWorkspaceHostIds.includes(h.id),
    });
  return rows;
}

function projectsPageRows(o: Options): Row[] {
  const rows: Row[] = [
    { kind: ROW.projectClear, label: "Clear", disabled: o.filterRepoIds.length === 0 },
  ];
  for (const p of projectChoices())
    rows.push({
      kind: ROW.project,
      project: p.id,
      label: p.label,
      checked: o.filterRepoIds.includes(p.id),
    });
  return rows;
}

function choicePageRows(o: Options, page: string): Row[] {
  const choices = page === PAGE.sort ? SORT_CHOICES : PROJECT_ORDER_CHOICES;
  const key: OptionKey = page === PAGE.sort ? "sortBy" : "projectOrderBy";
  return choices.map(([value, label]) => ({
    kind: ROW.radio,
    key,
    value,
    label,
    checked: o[key] === value,
  }));
}

function groupToggleItem(value: string, label: string, o: Options, t: NavTheme): NativeElement {
  return div()
    .id(`opt-group-${value}`)
    .flex_1()
    .h(24)
    .flex()
    .items_center()
    .justify_center()
    .px(4)
    .text_size(10)
    .cursor_pointer()
    .when(o.groupBy === value, (el) =>
      el.bg(COLOR.groupSelectedBg).font_semibold().text_color(t.foreground),
    )
    .when(o.groupBy !== value, (el) =>
      el.text_color(t.muted).hover((s) => s.text_color(t.foreground)),
    )
    .on_click((_e, clickCx) => {
      writeOptions({ groupBy: value });
      clickCx.notify();
    })
    .child(label);
}

export default class Nav extends View {
  at = -1;
  page: string | null | undefined = null;
  handle!: FocusHandle;
  headerHover: boolean | undefined;

  init(_props: unknown, cx: Context): void {
    if (!props()?.navMenu) return;
    this.at = -1;
    this.page = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  render(cx: Context): NativeElement {
    return props()?.navMenu ? this.renderBody(cx) : sidebarFrame(this.renderBody(cx));
  }

  renderBody(cx: Context): NativeElement {
    if (props()?.navMenu === WORKSPACE_OPTIONS_MENU) return this.optionsView(cx);
    const t = readTheme();
    return v_flex()
      .w_full()
      .flex_none()
      .px(8)
      .pt(8)
      .pb(4)
      .gap(2)
      .bg(t.surface)
      .child(searchButton())
      .child(this.projectsHeader(t));
  }

  projectsHeader(t: NavTheme): NativeElement {
    return h_flex()
      .w_full()
      .h(32)
      .mt(8)
      .gap(6)
      .items_center()
      .justify_between()
      .on_hover((on, eventCx) => {
        const live = on && appWindow()!.active;
        if (live !== this.headerHover) {
          this.headerHover = live;
          eventCx.notify();
        }
      })
      .child(this.projectsTitle(t))
      .child(
        h_flex()
          .flex_none()
          .items_center()
          .gap(4)
          .child(optionsButton(t))
          .child(addProjectButton(t))
          .child(newWorkspaceButton(t)),
      );
  }

  projectsTitle(t: NavTheme): NativeElement {
    const allCollapsed = Boolean(shared(PROJECTS_ALL_COLLAPSED_KEY));
    const projectCount = Number(shared(PROJECTS_COUNT_KEY) ?? 0);
    return h_flex()
      .min_w(0)
      .items_center()
      .child(
        div()
          .pl(8)
          .pr(2)
          .text_size(12)
          .font_semibold()
          .text_color(COLOR.projectsTitle)
          .child(PROJECTS_LABEL),
      )
      .when(projectCount > 0 && this.headerHover, (el) =>
        el.child(collapseAllButton(t, allCollapsed)),
      );
  }

  optionsView(cx: Context): NativeElement {
    const t = readTheme();
    const rows = this.page ? this.pageRows(this.page) : this.rootRows();
    const nav = rows.filter((r) => !NON_NAV_KINDS.has(r.kind));
    if (!nav.includes(rows[this.at])) this.at = rows.indexOf(nav[0] ?? rows[0]);
    return v_flex()
      .id(WORKSPACE_OPTIONS_MENU)
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(4)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e: KeyEvent, eventCx: Context) => {
        if (e.key === "down" || e.key === "up") {
          const i = Math.max(0, nav.indexOf(rows[this.at]));
          const next = e.key === "down" ? (i + 1) % nav.length : (i + nav.length - 1) % nav.length;
          this.at = rows.indexOf(nav[next]);
        } else if (e.key === "home") this.at = rows.indexOf(nav[0]);
        else if (e.key === "end") this.at = rows.indexOf(nav[nav.length - 1]);
        else if (e.key === "enter" || e.key === "space") {
          const row = rows[this.at];
          if (row) this.act(row, eventCx);
        } else if (e.key === "escape") closeOverlay(props()?.overlay);
        else return;
        eventCx.notify();
      })
      .children(rows.map((row, i) => this.menuRow(row, i, t)));
  }

  rootRows(): Row[] {
    const o = readOptions();
    return [
      { kind: ROW.label, text: WORKSPACE_OPTIONS_LABEL },
      {
        kind: ROW.action,
        command: "refresh",
        label: "Refresh branches",
        value: ALL_PROJECTS_LABEL,
      },
      ...showRows(o, hostChoices().length, projectChoices().length),
      ...groupRows(),
      ...sortRows(o),
      ...filterRows(),
    ];
  }

  pageRows(page: string): Row[] {
    const o = readOptions();
    const rows: Row[] = [{ kind: ROW.back, label: BACK_LABEL }];
    if (page === PAGE.hosts) return [...rows, ...hostsPageRows(o)];
    if (page === PAGE.projects) return [...rows, ...projectsPageRows(o)];
    return [...rows, ...choicePageRows(o, page)];
  }

  act(row: Row, cx: Context): void {
    if (row.kind === ROW.action) {
      run(`orca-sidebar-projects.${row.command}`);
      closeOverlay(props()?.overlay);
      return;
    }
    if (row.kind === ROW.back || row.kind === ROW.page) {
      this.page = row.kind === ROW.back ? null : row.page;
      this.at = -1;
      cx.notify();
      return;
    }
    const patch = OPTION_PATCH[row.kind]?.(row, readOptions());
    if (!patch) return;
    writeOptions(patch);
    cx.notify();
  }

  menuRow(row: Row, i: number, t: NavTheme): NativeElement {
    if (row.kind === ROW.groupby) return this.groupToggle(readOptions(), t);
    return staticRow(row, t) ?? this.optionRow(row, i, t);
  }

  optionRow(row: Row, i: number, t: NavTheme): NativeElement {
    const current = this.at === i;
    const disabled = row.kind === ROW.gap || Boolean(row.disabled);
    return h_flex()
      .id(`opt-${i}`)
      .h(24)
      .px(10)
      .gap(8)
      .items_center()
      .justify_between()
      .rounded(6)
      .text_size(13)
      .line_height("16px")
      .text_color(disabled ? t.muted : t.foreground)
      .when(disabled, (el) => el.opacity(0.4).tooltip(row.note as string))
      .when(current && !disabled, (el) => el.bg(t.selected))
      .when(!disabled, (el) =>
        el
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_hover((on, hoverCx) => {
            if (on && this.at !== i) {
              this.at = i;
              hoverCx.notify();
            }
          })
          .on_click((_e, clickCx) => this.act(row, clickCx)),
      )
      .when(CHECK_KINDS.has(row.kind), (el) =>
        el.child(div().w(14).flex_none().text_size(12).child(checkMark(row))),
      )
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .child(row.label as string),
      )
      .child(
        div()
          .flex_none()
          .max_w(150)
          .truncate()
          .text_size(11)
          .font_medium()
          .text_color(t.muted)
          .child(valueText(row)),
      );
  }

  groupToggle(o: Options, t: NavTheme): NativeElement {
    return h_flex()
      .mx(8)
      .mt(2)
      .mb(4)
      .h(24)
      .rounded(6)
      .border_1()
      .border_color(t.border)
      .children(GROUP_BY_CHOICES.map(([value, label]) => groupToggleItem(value, label, o, t)));
  }
}
