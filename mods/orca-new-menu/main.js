// Derived from Herdr App's defaults/mods/new-menu/main.js (Apache-2.0, Copyright Herdr App authors).
// Modified for herdr-orca; see LICENSE and NOTICE.
// Orca's tab-bar `+` menu: a 288px dropdown (tab-bar-surface.tsx:224-240) with an omnibox
// (TabBarCreateEntry.tsx:317-350) and static create rows (tab-bar-static-create-menu.tsx).
// Opened by orca-header, orca-landing and orca-sidebar-top.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, HoverCard } from "gpui-base";
import { checking, theme, spaces, knownAgents, run, props, closeOverlay, openOverlay, keys, window as appWindow, shared, setShared, appHome, readTextFile, exec } from "herdr";
import { MODELS } from "./models.js";
import { agentWindow, currentInventory, emptyAgentState, freebuffRun, freebuffVisible, installedEnabledAgents, mergeInventory } from "./rows.js";
import { detectFreebuff } from "./freebuff.js";

// Keep one inventory per machine for the first paint, then always ask again on open. The Agent
// Manager publishes a recent local inventory (fresh install checks and effective runs) in
// shared(); Herdr's own detection cache can be a minute old, so it is only a fallback.
const agentsByMachine = new Map();
const agentsFailedByMachine = new Map();
const INVENTORY_KEY = "agent-manager.inventory";
// Agents the person turned off in the Agent Settings (`agent-manager.json`). Orca's equivalent is
// `disabledTuiAgents`; `isTuiAgentEnabled` keeps a disabled agent installed but out of pickers
// (`agent-launch/catalog/tui-agent-selection.ts`). A failed read fails open: a broken file never
// hides every agent. The Agent Settings page writes this file.
let disabledAgents = new Set();
const MANAGER_FILE = `${appHome()}/agent-manager.json`;

function parseManager(text) {
  try {
    const saved = JSON.parse(text ?? "{}");
    return {
      disabled: new Set(Array.isArray(saved.disabled) ? saved.disabled.filter((key) => typeof key === "string") : []),
      herdrEnv: saved.herdrEnv !== false,
    };
  } catch {
    return { disabled: new Set(), herdrEnv: true };
  }
}

function recentInventory() {
  return currentInventory(shared(INVENTORY_KEY));
}
// A probed model list survives the app; the picker paints it before asking again. Orca serves a
// saved catalog until it is 10 minutes old (`agent-model-catalog-entry-lifetime.ts:12`).
const MODELS_KEY = "new-menu.models.v1";
const MODELS_FRESH_MS = 10 * 60_000;

function cachedModels(key) {
  try {
    const hit = JSON.parse(localStorage.getItem(MODELS_KEY) ?? "{}")[key];
    return hit && Date.now() - hit.at < MODELS_FRESH_MS ? hit.models : null;
  } catch {
    return null;
  }
}

function rememberModels(key, models) {
  try {
    const all = JSON.parse(localStorage.getItem(MODELS_KEY) ?? "{}");
    all[key] = { at: Date.now(), models };
    localStorage.setItem(MODELS_KEY, JSON.stringify(all));
  } catch { /* storage is unavailable or full: the list is asked for again next time */ }
}

// The model picker keeps 11 rows in view; the palette sizes itself to its content.
// Menu padding (6) plus a small gap, so the flyout clears the menu's outer edge.
const FLYOUT_GAP = 6;
const FIT = { models: 11 };
// orca-agent-flyout's content width (four controls: source, model, effort, fast on one row),
// a guessed height (it sets none) and the window margin the flyout keeps.
const FLYOUT_W = 600;
const FLYOUT_H = 440;
const WINDOW_MARGIN = 8;
// The menu's own padding: the flyout starts this far under the menu's last row.
const MENU_PAD = 6;
// The agent bar shows five full icons and half of the next, with one arrow per side.
const AGENT_FULL = 5;
const AGENT_GAP = 4;
const AGENT_VIEW = AGENT_FULL * 36 + AGENT_FULL * AGENT_GAP + 18;
const AGENT_ARROW = 20;

// The agent to launch, or none when Settings removed it since the menu opened.
function launchTarget(agent, unofficial, state) {
  if (unofficial) return freebuffVisible(state.freebuff) ? agent : null;
  return installedEnabledAgents(state.agents, state.disabled).find((item) => item.key === agent.key);
}

// Centered under the menu, then pushed inside the window at either edge.
function flyoutX(left, right, windowWidth) {
  return Math.max(WINDOW_MARGIN, Math.min((left + right) / 2 - FLYOUT_W / 2, windowWidth - FLYOUT_W - WINDOW_MARGIN));
}

// Herdr keys are dash-joined (herdr's own keys.json ships "ctrl-shift-t"); Orca's menu shows
// the combo in caps (ShortcutKeyCombo.tsx:6-18).
function shortcut(name) {
  const k = keys().find((b) => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  const mac = appWindow()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.keys.trim().split(/\s+/).map((stroke) => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map((m) => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter((m) => held.has(m)).map((m) => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

// The probe's own answer wins; the manager's inventory fills in until it has run. A FreeBuff the
// person turned off in the Agent Settings is not offered.
function resolveFreebuff(detected, inventory, disabled) {
  const found = detected === undefined && typeof inventory?.freebuff === "boolean" ? inventory.freebuff : detected;
  return found === true && disabled.has("freebuff") ? false : found;
}

// The manager file is this computer's. A remote machine must not inherit its disabled list.
function firstPaintDisabled(machine, inventory) {
  if (machine) return new Set();
  return new Set(Array.isArray(inventory?.disabled) ? inventory.disabled : disabledAgents);
}

export default class NewMenu extends View {
  init(_props, cx) {
    this.at = 0;
    this.backAt = 0;
    this.agentAt = 0;
    this.tipHot = null;
    this.picking = null;
    this.models = null;
    this.modelsFailed = false;
    this.filter = "";
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.closeFlyout();
    this.input = InputState.new({ placeholder: "Search models…" });
    this.input.on("change", (_e, eventCx) => { this.filter = this.input.value(); this.at = 0; eventCx.notify(); });
    // The filter owns Enter while it is focused, so a model is chosen through submit.
    this.input.on("submit", (_e, eventCx) => this.choose(this.at, eventCx));

    const machine = spaces().find((s) => s.active)?.machine ?? null;
    this.machine = machine;
    const key = machine ?? "__local__";
    const inventory = machine ? null : recentInventory();
    const cached = agentsByMachine.get(key);
    this.restoreFirstPaint(machine, key, inventory, cached);

    cx.spawn((taskCx) => this.loadManager(taskCx));

    // The one unofficial integration: probe the same login shell its launch command uses.
    if (!checking()) {
      cx.spawn(async (taskCx) => {
        this.freebuff = await detectFreebuff(exec, machine);
        taskCx.notify();
      });
    }

    // Always re-read. A cached inventory paints immediately, but it is never the final answer.
    cx.spawn((taskCx) => this.refreshCatalog(taskCx, { machine, key, inventory, cached }));
  }

  // What the first paint shows: the cached catalog merged with the manager's inventory.
  restoreFirstPaint(machine, key, inventory, cached) {
    this.agents = cached?.length ? mergeInventory(cached, inventory?.agents) : inventory?.agents ?? cached ?? null;
    this.agentsFailed = agentsFailedByMachine.get(key) ?? false;
    this.disabled = firstPaintDisabled(machine, inventory);
    this.disabledReady = Array.isArray(inventory?.disabled) || Boolean(machine);
    this.restoreInventoryOptions(inventory);
  }

  restoreInventoryOptions(inventory) {
    this.herdrEnvReady = typeof inventory?.herdrEnv === "boolean";
    this.herdrEnv = this.herdrEnvReady ? inventory.herdrEnv : true;
    this.freebuff = typeof inventory?.freebuff === "boolean" ? inventory.freebuff : undefined;
  }

  async loadManager(taskCx) {
    const text = await readTextFile(MANAGER_FILE).catch(() => null);
    const manager = parseManager(text);
    this.disabled = this.machine ? new Set() : manager.disabled;
    this.herdrEnv = manager.herdrEnv;
    if (!this.machine) disabledAgents = new Set(this.disabled);
    this.disabledReady = true;
    this.herdrEnvReady = true;
    taskCx.notify();
  }

  async refreshCatalog(taskCx, { machine, key, inventory, cached }) {
    let known;
    try {
      known = await knownAgents({ on: machine });
    } catch {
      agentsFailedByMachine.set(key, true);
      if (this.machine === machine) {
        this.agentsFailed = true;
        if (!this.agents) {
          this.agents = inventory?.agents ?? cached ?? null;
        }
        taskCx.notify();
      }
      return;
    }
    if (!machine) known = await this.withLocalRuns(known);
    // Not merged with the manager inventory here: currentState() does that on every render, so the
    // overrides lapse with the inventory instead of sticking to the stored list.
    agentsByMachine.set(key, known);
    agentsFailedByMachine.set(key, false);
    if (this.machine === machine) {
      this.agents = known;
      this.agentsFailed = false;
      taskCx.notify();
    }
  }

  // Only local programs.json overrides apply. A remote machine's run comes from its own host.
  async withLocalRuns(agents) {
    const text = await readTextFile(`${appHome()}/programs.json`).catch(() => undefined);
    if (text === undefined) return agents;
    let root;
    try { root = JSON.parse(text); } catch { return agents; }
    return (agents ?? []).map((agent) => {
      const override = root?.programs?.[agent.key]?.run;
      if (Array.isArray(override) && override.length && override.every((part) => typeof part === "string")) {
        return { ...agent, run: [...override] };
      }
      return agent;
    });
  }

  machineChanged() {
    return (spaces().find((s) => s.active)?.machine ?? null) !== this.machine;
  }

  // Read the manager's recent inventory on every render so a Settings change made while this
  // menu is open (shared() re-renders) takes effect immediately. The manager file and direct
  // probes are the fallback when the page has not published anything yet.
  currentState() {
    const inventory = this.machine ? null : recentInventory();
    const agents = inventory?.agents
      ? mergeInventory(this.agents ?? [], inventory.agents)
      : this.agents;
    const disabled = new Set(Array.isArray(inventory?.disabled) ? inventory.disabled : this.disabled);
    const herdrEnv = typeof inventory?.herdrEnv === "boolean" ? inventory.herdrEnv : this.herdrEnv;
    return { agents, disabled, herdrEnv, freebuff: resolveFreebuff(this.freebuff, inventory, disabled), ready: this.disabledReady && this.herdrEnvReady && Boolean(agents) };
  }

  createRows() {
    const space = spaces().find((s) => s.active);
    // tab-bar-static-create-menu.tsx:213-225 — New Terminal (TerminalSquare).
    // Pinned to the space's work directory: `tab.new` alone follows the focused shell's cwd.
    // The palette keeps this one operation; worktree and file rows live in their own surfaces.
    return [
      { label: "New Terminal", icon: "square-terminal", hint: shortcut("orca-header.new-tab"), tip: "new-terminal",
        run: () => run("tab.new", space ? { space: space.id, ...(space.folder ? { folder: space.folder } : {}) } : {}) },
    ];
  }

  // Orca lists agent pickers above static rows (`TabBarAgentPickerEntry.tsx:19-25`); Herdr uses
  // knownAgents(). Only officially supported, installed, enabled agents are rows. Uninstalled and
  // disabled entries are absent, not greyed out.
  agentRows() {
    const state = this.currentState();
    if (!state.ready) return [];
    const official = installedEnabledAgents(state.agents, state.disabled);
    const showFreebuff = freebuffVisible(state.freebuff);
    // Wait for the FreeBuff probe before choosing the empty state; otherwise an empty catalog
    // would flash "Open Agent Settings" and then change to FreeBuff.
    if (!official.length && state.freebuff === undefined) return [];
    const rows = official.map((a) => ({
      label: a.name,
      program: a,
      hint: "",
      ...this.agentAction(a),
    }));
    if (showFreebuff) {
      const freebuff = { key: "freebuff", name: "FreeBuff CLI", run: freebuffRun(state.agents) };
      rows.push({
        label: "FreeBuff CLI",
        hint: "",
        image: "freebuff.png",
        section: "Unofficial",
        tip: "freebuff",
        run: () => this.launch(freebuff, null, true),
      });
    }
    // The gear stays at the end of the row, after every agent; it is the only row in the empty state.
    const settings = {
      label: "Agent Settings",
      icon: "sliders-horizontal",
      settings: true,
      run: () => run("layout.select", { stack: "main", child: "main-agents" }),
    };
    if (emptyAgentState(official.length, showFreebuff)) return [settings];
    return [...rows, settings];
  }

  // What a click on an agent's row does: a flyout agent launches with its saved setup, one with a
  // model list opens the picker, and the rest launch as they are.
  agentAction(agent) {
    const seed = MODELS[agent.key];
    if (seed?.flyout) return { run: () => this.launchConfigured(agent), config: agent };
    if (seed) return { stay: (cx) => this.pickModel(agent, cx) };
    return { run: () => this.launch(agent) };
  }

  // Orca only adds `--model` after selection (`AgentLaunchTextModelDefault.tsx:23-33`,
  // `agent-session-option-launch.ts:194-203`). Its default row is drawn whether or not the
  // catalog was discovered (`AgentLaunchTextModelDefault.tsx:26-35`), so a failed probe never
  // blocks the launch.
  modelRows() {
    const agent = this.picking;
    const seed = MODELS[agent.key];
    const all = seed.models ?? this.models;
    const rows = [{ label: "Default", hint: "its own", run: () => this.launch(agent) }];
    if (!all) {
      return [...rows, { label: this.modelsFailed ? "Could not list its models" : "Asking the agent…", disabled: true }];
    }
    const q = this.filter.trim().toLowerCase();
    const matching = q ? all.filter((m) => `${m.label} ${m.id}`.toLowerCase().includes(q)) : all;
    return [
      ...rows,
      ...(all.length
        ? matching.map((m) => ({ label: m.label, hint: m.id, run: () => this.launch(agent, m.id) }))
        : [{ label: "No models listed", disabled: true }]),
      ...(all.length && q && !matching.length ? [{ label: "No models match", disabled: true }] : []),
    ];
  }

  list() {
    return this.picking ? this.modelRows() : [...this.createRows(), ...this.agentRows()];
  }

  // Window the list to keep large model results within the popup; wheel position follows selection.
  wheel(rows) {
    const list = this.list();
    const start = Math.max(0, Math.min(this.at - rows + 1, list.length - rows));
    return { start, rows: list.slice(start, start + rows) };
  }

  move(dir) {
    const list = this.list();
    for (let n = 0, i = this.at; n < list.length; n++) {
      i = (i + dir + list.length) % list.length;
      if (!list[i].disabled) { this.at = i; return; }
    }
  }

  edge(toEnd) {
    const list = this.list();
    const i = toEnd ? list.map((r) => !r.disabled).lastIndexOf(true) : list.findIndex((r) => !r.disabled);
    if (i >= 0) this.at = i;
  }

  pickModel(agent, cx) {
    this.backAt = this.at;
    this.picking = agent;
    this.at = 0;
    this.filter = "";
    this.input.set_value("");
    this.models = cachedModels(agent.key);
    this.modelsFailed = false;
    this.input.focus();
    // The filter mounts next frame, so retry focus after paint (defaults/mods/picker/main.js:44).
    cx.timer.after(0, () => this.input.focus());
    const seed = MODELS[agent.key];
    if (this.models || !seed.probe) return;
    cx.spawn(async (taskCx) => {
      try {
        const models = await seed.probe();
        rememberModels(agent.key, models);
        if (this.picking === agent) this.models = models;
      } catch {
        if (this.picking === agent) this.modelsFailed = true;
      }
      taskCx.notify();
    });
  }

  back() {
    this.picking = null;
    this.at = this.backAt;
    this.handle.focus();
  }

  // A click on the row itself is the flyout's "Launch terminal": the flyout opens with launchNow and
  // launches with its saved model and effort, then closes.
  launchConfigured(agent) {
    const state = this.currentState();
    const current = installedEnabledAgents(state.agents, state.disabled).find((item) => item.key === agent.key);
    if (!state.ready || !current || this.machineChanged()) return;
    this.hoverConfig(current, true, true);
  }

  // Permission flags live in programs.json's `run`; the menu only adds the chosen model.
  launch(agent, model, unofficial = false) {
    // A menu left open while Settings changed availability cannot launch a removed agent.
    const state = this.currentState();
    if (!state.ready || this.machineChanged()) return;
    const target = launchTarget(agent, unofficial, state);
    if (!target) return;
    const space = spaces().find((s) => s.active);
    const seed = MODELS[target.key];
    const argv = seed && model ? [...target.run, seed.flag, model] : target.run;
    run("tab.new", {
      space: space?.id,
      ...(space?.folder ? { folder: space.folder } : {}),
      argv: state.herdrEnv ? ["env", "HERDR_ENV=1", ...argv] : argv,
    });
  }

  choose(i, cx) {
    const row = this.list()[i];
    if (!row || row.disabled) return;
    if (row.stay) {
      row.stay(cx);
      cx.notify();
      return;
    }
    this.closeMenu();
    row.run();
  }

  // Program icons are the program table's `icon` (an appHome path; a tinted one is a one-color
  // glyph); a mod's own rows use `mods/orca-new-menu/<icon>.svg` or a full-colour `image` file
  // (freebuff.png is Orca's own asset).
  icon(row, size, t) {
    const p = row.program;
    if (p?.icon) return p.tint
      ? svg(p.icon).size(size).flex_none().text_color(t.muted)
      : image(p.icon).size(size).flex_none();
    if (row.image) return image(sharedAsset(`mods/orca-new-menu/${row.image}`)).size(size).flex_none().rounded(4);
    if (row.icon) return svg(sharedAsset(`mods/orca-new-menu/${row.icon}.svg`)).size(size).flex_none().text_color(t.muted);
    return div().w(size).flex_none();
  }

  heading(label, t) {
    return div().px(8).pt(8).pb(4).text_size(11).text_color(t.dim).child(label);
  }

  // SearchQueryRow.tsx:47 — `h-8 rounded-md` with the border in the ring color on focus; the
  // model panel carries the same box above its list (`AgentLaunchSetupPanel.tsx:198-208`).
  filterRow(t) {
    return h_flex().w_full().h(32).min_h(0).px(8).gap(6).items_center().rounded(8).mb(4)
      .border_1().border_color(t.ring).bg(t.input)
      .child(svg("mods/orca-assets/search--orca-new-menu.svg").size(14).flex_none().text_color(t.muted))
      .child(Input.new(this.input).flex_1().min_w(0).text_size(12).text_color(t.foreground).bg("#00000000"));
  }

  // Hovering a row's chevron opens that agent's setup flyout beside the pointer (Orca's AgentLaunchSetupSubmenu).
  // The flyout is its own popup: shared "orca-agent-flyout" holds its id. It is sticky, so leaving the
  // chevron does not close it; only another agent's chevron swaps its content.
  hoverConfig(agent, hovered, launchNow) {
    if (!hovered) return;
    const open = shared("orca-agent-flyout");
    if (open?.key === agent.key && !launchNow) return;
    if (open) closeOverlay(open.id);
    const id = openOverlay({
      mod: "orca-agent-flyout",
      kind: "popup",
      // A popup without a width is wider than the flyout; 300 is orca-agent-flyout's content width.
      // Height is left to the content, as the other width-only popups (orca-context-menu, orca-files) do.
      width: FLYOUT_W,
      at: this.flyoutAt(agent),
      props: {
        menu: props()?.overlay,
        space: spaces().find((s) => s.active)?.id,
        name: agent.name,
        key: agent.key,
        argv: agent.run,
        launchNow,
      },
    });
    setShared("orca-agent-flyout", { id, key: agent.key });
  }

  // A popup dismissed by the app (Esc, a click outside) leaves its id in shared state behind, and
  // the flyout can outlive the menu. Close both so the next menu starts clean.
  closeFlyout() {
    const open = shared("orca-agent-flyout");
    if (!open) return;
    if (open.id) closeOverlay(open.id);
    setShared("orca-agent-flyout", null);
  }

  closeMenu() {
    this.closeFlyout();
    closeOverlay(props()?.overlay);
  }

  // The menu's left/right/bottom edges, in window coordinates, let the flyout sit centered under
  // the whole menu. The agent bar's bounds are the last row, so its bottom plus the menu padding is
  // the menu's bottom.
  trackMenu(e) {
    if (!e.local_position || !e.bounds) return;
    const left = e.position.x - e.local_position.x;
    this.menuEdge = { left, right: left + e.bounds.width, bottom: e.position.y - e.local_position.y + e.bounds.height + MENU_PAD };
    this.openHover();
  }

  openHover() {
    if (!this.hoverAgent || !this.menuEdge) return;
    this.rowEdge = {
      key: this.hoverAgent.key,
      left: this.menuEdge.left,
      right: this.menuEdge.right,
      bottom: this.menuEdge.bottom,
    };
    this.hoverConfig(this.hoverAgent, true);
  }

  // Centered below the menu, kept inside the window at the edges.
  // shortcut: 440 is a guessed flyout height (orca-agent-flyout sets none); pass `height` to openOverlay if it is wrong.
  flyoutAt(agent) {
    const r = this.rowEdge;
    if (r?.key !== agent.key) return "pointer";
    const vp = typeof window !== "undefined" ? window.viewport_size() : null;
    const y = r.bottom + FLYOUT_GAP;
    if (!vp) return { x: flyoutX(r.left, r.right, Number.MAX_SAFE_INTEGER), y };
    return { x: flyoutX(r.left, r.right, vp.width), y: Math.max(WINDOW_MARGIN, Math.min(y, vp.height - FLYOUT_H - WINDOW_MARGIN)) };
  }

  // One square action in the palette: the operation row's New Terminal and every agent icon.
  iconButton(row, i, t) {
    return h_flex()
      .id(`new-${i}`)
      .size(36)
      .flex_none()
      .items_center()
      .justify_center()
      .rounded(7)
      .cursor_pointer()
      .when(i === this.at, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .role("button")
      .accessibility_label(row.label)
      // A flyout agent names itself in the flyout; New Terminal draws its own HTML tooltip.
      .when(!row.config && !row.tip, (el) => el.tooltip(row.hint ? `${row.label}  ${row.hint}` : row.label))
      .on_mouse_move((e, cx) => {
        if (!e.local_position || !e.bounds) return;
        this.hoverAgent = row.config ?? null;
        if (this.at !== i) {
          this.at = i;
          cx.notify();
        }
        this.openHover();
      })
      .on_hover((hovered, cx) => {
        if (row.tip) {
          const next = hovered ? row.tip : null;
          if (this.tipHot !== next) { this.tipHot = next; cx.notify(); }
        }
        if (!hovered && this.hoverAgent === (row.config ?? null)) this.hoverAgent = null;
      })
      .on_click((_e, cx) => this.choose(i, cx))
      .child(this.icon(row, 18, t));
  }

  // The operation bar starts with New Terminal; future operations join the same row.
  operationBar(t) {
    const row = this.createRows()[0];
    return h_flex().items_center().child(this.tipButton(row, 0, t));
  }

  // The card is emptied as soon as the icon loses hover, so it is never a hover target of its own.
  tipButton(row, i, t) {
    const button = this.iconButton(row, i, t);
    if (!row.tip) return button;
    return HoverCard.new(`tip-${row.tip}`)
      .flex_none()
      .anchor("top_center")
      .open_delay(150)
      .close_delay(0)
      .trigger(button)
      .content(this.tipHot === row.tip ? this.terminalTip(row) : div());
  }

  // Orca's HTML tooltip: light card with a small pointer and one keycap per shortcut key.
  terminalTip(row) {
    const caps = row.hint ? (row.hint.includes("+") ? row.hint.split("+") : [...row.hint]) : [];
    const card = h_flex()
      .h(34)
      .px(10)
      .gap(10)
      .items_center()
      .rounded(8)
      .border_1()
      .border_color("#e4e4e7")
      .bg("#f4f4f5")
      .shadow_md()
      .child(div().text_size(13).font_medium().text_color("#18181b").child(row.label))
      .when(caps.length > 0, (el) => el.child(h_flex().gap(4).children(caps.map((key) => div()
        .size(20)
        .rounded(4)
        .bg("#a1a1aa")
        .flex()
        .items_center()
        .justify_center()
        .text_size(12)
        .text_color("#18181b")
        .child(key)))));
    return div().relative().mt(4).pt(7)
      .child(card)
      .child(div().absolute().top(0).left(0).right(0).flex().justify_center()
        .child(svg("mods/orca-assets/tip-arrow--orca-new-menu.svg").w(14).h(8).flex_none()));
  }

  agentGroups() {
    const rows = this.agentRows();
    return {
      official: rows.filter((row) => !row.section && !row.settings),
      unofficial: rows.filter((row) => row.section === "Unofficial"),
      settings: rows.find((row) => row.settings),
    };
  }

  // Agent Settings order: official installed-and-enabled first, then the unofficial integration,
  // then the settings gear. The gear counts toward the five-and-a-half window.
  agentBar(t) {
    const groups = this.agentGroups();
    const rows = [...groups.official, ...groups.unofficial, ...(groups.settings ? [groups.settings] : [])];
    const win = agentWindow(rows.length, this.agentAt);
    const visible = rows.slice(win.start, win.start + win.count);
    const icons = h_flex().items_center().gap(AGENT_GAP)
      .when(win.left || win.right, (el) => el.w(AGENT_VIEW).flex_none().overflow_x_hidden())
      .children(visible.map((row, n) => this.tipButton(row, 1 + win.start + n, t)));
    return h_flex().w_full().items_center().justify_center().gap(AGENT_GAP)
      .on_mouse_move((e) => this.trackMenu(e))
      .when(win.left || win.right, (el) => el
        .child(this.agentArrow(-1, win.left, t))
        .child(icons)
        .child(this.agentArrow(1, win.right, t)))
      .when(!(win.left || win.right), (el) => el.child(icons));
  }

  agentArrow(dir, enabled, t) {
    return div()
      .size(AGENT_ARROW)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(5)
      .role("button")
      .accessibility_label(dir < 0 ? "Previous agents" : "More agents")
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.agentAt += dir; cx.notify(); }))
      .opacity(enabled ? 1 : 0.35)
      .child(svg(dir < 0 ? "mods/orca-assets/chevron-left--orca-header.svg" : "mods/orca-assets/chevron-right--orca-header.svg")
        .size(14).flex_none().text_color(t.muted));
  }

  // The model picker row, used only after choosing an agent that has no setup flyout.
  row(row, i, t, onClick) {
    return v_flex()
      .when(row.sep, (el) => el.child(div().mx(6).my(5).h(1).bg(t.border)))
      .child(h_flex()
        .id(`new-${i}`)
        // tab-bar-static-create-menu.tsx:222 — gap-2 rounded-[7px] px-2 py-1.5 text-[12px]
        // leading-5 font-medium; icon size-4 (16).
        .h(32)
        .px(8)
        .gap(8)
        .rounded(7)
        .items_center()
        .whitespace_nowrap()
        .font_medium()
        .text_color(row.disabled ? t.dim : t.foreground)
        .when(i === this.at && !row.disabled, (el) => el.bg(t.selected))
        .when(!row.disabled, (el) => el
          .on_hover((hovered, cx) => {
            if (!hovered || i < 0 || this.at === i) return;
            this.at = i;
            cx.notify();
          })
          .on_click((_e, cx) => (onClick ? onClick(cx) : this.choose(i, cx))))
        .child(this.icon(row, 16, t))
        .child(div().flex_1().min_w(0).truncate().child(row.label))
        // Shortcut: ml-auto pl-4 text-muted-foreground (dropdown-menu.tsx:219). A model id can
        // be longer than the row, so the hint keeps a ceiling instead of crushing the label.
        .child(div().flex_none().pl(16).max_w(110).truncate().text_color(t.muted).child(row.hint ?? "")));
  }

  onKey(e, cx, picking) {
    if (e.key === "down" || e.key === "right") this.move(1);
    else if (e.key === "up" || e.key === "left") this.move(-1);
    else if (e.key === "home") this.edge(false);
    else if (e.key === "end") this.edge(true);
    else if (e.key === "enter" || e.key === "space") this.choose(this.at, cx);
    else if (e.key === "escape") {
      if (!picking) return this.closeMenu();
      this.back();
    } else return;
    cx.notify();
  }

  render() {
    const t = theme();
    return this.picking ? this.renderPicker(t) : this.renderPalette(t);
  }

  renderPalette(t) {
    return v_flex()
      .id("orca-new-menu")
      .track_focus(this.handle)
      .w_full()
      .p(MENU_PAD)
      .gap(6)
      .bg(t.popover)
      .text_size(12)
      .on_key_down((e, cx) => this.onKey(e, cx, false))
      .on_scroll_wheel((e, cx) => {
        if (!e.delta.y) return;
        this.move(e.delta.y > 0 ? 1 : -1);
        cx.notify();
      })
      .child(this.operationBar(t))
      .child(div().w_full().h(1).bg(t.border))
      .child(this.agentBar(t));
  }

  renderPicker(t) {
    const picking = this.picking;
    const page = this.wheel(FIT.models);
    return v_flex()
      .id("orca-new-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(4)
      .bg(t.popover)
      .text_size(12)
      .on_key_down((e, cx) => this.onKey(e, cx, picking))
      .on_scroll_wheel((e, cx) => {
        if (!e.delta.y) return;
        this.move(e.delta.y > 0 ? 1 : -1);
        cx.notify();
      })
      .child(this.heading(picking.name, t))
      .child(this.filterRow(t))
      .children(page.rows.map((row, j) => this.row(row, page.start + j, t)))
      .child(this.row({ label: "Back", icon: "chevron-left", sep: true }, -1, t,
        (clickCx) => { this.back(); clickCx.notify(); }));
  }
}

const SHARED_ASSET_PATHS = Object.freeze({
  "mods/orca-new-menu/chevron-left.svg": "mods/orca-assets/chevron-left--orca-agent-settings.svg",
  "mods/orca-new-menu/chevron-right.svg": "mods/orca-assets/chevron-right--orca-agent-settings.svg",
  "mods/orca-new-menu/freebuff.png": "mods/orca-assets/freebuff--orca-new-menu.png",
  "mods/orca-new-menu/git-branch-plus.svg": "mods/orca-assets/git-branch-plus--orca-context-menu.svg",
  "mods/orca-new-menu/search.svg": "mods/orca-assets/search--orca-new-menu.svg",
  "mods/orca-new-menu/square-terminal.svg": "mods/orca-assets/square-terminal--orca-agent-flyout.svg",
  "mods/orca-new-menu/workflow.svg": "mods/orca-assets/workflow--orca-context-menu.svg"
});
function sharedAsset(path) {
  return SHARED_ASSET_PATHS[path] ?? `mods/orca-assets/${path.slice(path.lastIndexOf("/") + 1)}`;
}
