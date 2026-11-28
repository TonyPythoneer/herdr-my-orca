import { MODELS } from "./models.js";
import { currentInventory, emptyAgentState, freebuffRun, freebuffVisible, installedEnabledAgents, mergeInventory } from "./rows.js";
import { detectFreebuff } from "./freebuff.js";
import { View, div, image, svg } from "gpui-kit";
import { HoverCard, Input, InputState, h_flex, v_flex } from "gpui-base";
import { appHome, checking, closeOverlay, exec, keys, knownAgents, openOverlay, props, readTextFile, run, setShared, shared, spaces, theme, window } from "herdr";

                                 
const agentsByMachine =                 new Map();
const agentsFailedByMachine =                 new Map();
const INVENTORY_KEY = "agent-manager.inventory";
let disabledAgents =                 new Set();
const MANAGER_FILE = `${appHome()}/agent-manager.json`;
function parseManager(text) {
	try {
		const saved = JSON.parse(text ?? "{}");
		return {
			disabled: new Set(Array.isArray(saved.disabled) ? saved.disabled.filter((key) => typeof key === "string") : []),
			herdrEnv: saved.herdrEnv !== false
		};
	} catch {
		return {
			disabled:                 new Set(),
			herdrEnv: true
		};
	}
}
function recentInventory() {
	return currentInventory(shared(INVENTORY_KEY));
}
const MODELS_KEY = "new-menu.models.v1";
const MODELS_FRESH_MS = 6e5;
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
		all[key] = {
			at: Date.now(),
			models
		};
		localStorage.setItem(MODELS_KEY, JSON.stringify(all));
	} catch {}
}
const FLYOUT_GAP = 6;
const FIT = { models: 11 };
const FLYOUT_W = 480;
const FLYOUT_H = 440;
const WINDOW_MARGIN = 8;
const MENU_PAD = 6;
const AGENT_FULL = 5;
const AGENT_GAP = 4;
const AGENT_VIEW = 218;
const AGENT_ARROW = 20;
function launchTarget(agent, unofficial, state) {
	if (unofficial) return freebuffVisible(state.freebuff) ? agent : null;
	return installedEnabledAgents(state.agents, state.disabled).find((item) => item.key === agent.key) ?? null;
}
function launchArgv(target, model, herdrEnv) {
	const seed = MODELS[target.key ?? ""];
	const argv = seed && model && seed.flag ? [
		...target.run ?? [],
		seed.flag,
		model
	] : target.run;
	return herdrEnv ? [
		"env",
		"HERDR_ENV=1",
		...argv ?? []
	] : argv;
}
function flyoutX(left, right, windowWidth) {
	return Math.max(WINDOW_MARGIN, Math.min((left + right) / 2 - FLYOUT_W / 2, windowWidth - FLYOUT_W - WINDOW_MARGIN));
}
function shortcut(name) {
	const k = keys().find((b) => b.section === "global" && b.action === name);
	if (!k?.keys.trim()) return "";
	const mac = window()?.platform === "macos";
	const names = mac ? {
		ctrl: "⌃",
		alt: "⌥",
		shift: "⇧",
		cmd: "⌘",
		fn: "fn"
	} : {
		ctrl: "Ctrl",
		alt: "Alt",
		shift: "Shift",
		cmd: "Super",
		fn: "Fn"
	};
	const alias = {
		secondary: mac ? "cmd" : "ctrl",
		super: "cmd",
		win: "cmd"
	};
	return k.keys.trim().split(/\s+/).map((stroke) => {
		const parts = stroke.split("-");
		let key = parts.pop() ?? "";
		if (key === "") {
			key = "-";
			parts.pop();
		}
		const held = new Set(parts.map((m) => alias[m.toLowerCase()] ?? m.toLowerCase()));
		if (/^[A-Z]$/.test(key)) held.add("shift");
		const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
		return [...Object.keys(names).filter((m) => held.has(m)).map((m) => names[m]), label].join(mac ? "" : "+");
	}).join(" ");
}
function resolveFreebuff(detected, inventory, disabled) {
	const found = detected === void 0 && typeof inventory?.freebuff === "boolean" ? inventory.freebuff : detected;
	return found === true && disabled.has("freebuff") ? false : found;
}
function firstPaintDisabled(machine, inventory) {
	if (machine) return                 new Set();
	return new Set(Array.isArray(inventory?.disabled) ? inventory.disabled : disabledAgents);
}
var NewMenu = class extends View {
	at = 0;
	backAt = 0;
	agentAt = 0;
	tipHot = null;
	picking = null;
	models = null;
	modelsFailed = false;
	filter = "";
	handle;
	input;
	machine = null;
	agents = null;
	agentsFailed = false;
	disabled =                 new Set();
	disabledReady = false;
	herdrEnv = true;
	herdrEnvReady = false;
	freebuff;
	hoverAgent = null;
	menuEdge = null;
	rowEdge = null;
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
		this.input.on("change", (_e, eventCx) => {
			this.filter = this.input.value();
			this.at = 0;
			eventCx.notify();
		});
		this.input.on("submit", (_e, eventCx) => this.choose(this.at, eventCx));
		const machine = spaces().find((s) => s.active)?.machine ?? null;
		this.machine = machine;
		const key = machine ?? "__local__";
		const inventory = machine ? null : recentInventory();
		const cached = agentsByMachine.get(key);
		this.restoreFirstPaint(machine, key, inventory, cached);
		cx.spawn((taskCx) => this.loadManager(taskCx));
		if (!checking()) cx.spawn(async (taskCx) => {
			this.freebuff = await detectFreebuff(exec, machine);
			taskCx.notify();
		});
		cx.spawn((taskCx) => this.refreshCatalog(taskCx, {
			machine,
			key,
			inventory,
			cached
		}));
	}
	restoreFirstPaint(machine, key, inventory, cached) {
		this.agents = cached?.length ? mergeInventory(cached, inventory?.agents) : inventory?.agents ?? cached ?? null;
		this.agentsFailed = agentsFailedByMachine.get(key) ?? false;
		this.disabled = firstPaintDisabled(machine, inventory);
		this.disabledReady = Array.isArray(inventory?.disabled) || Boolean(machine);
		this.restoreInventoryOptions(inventory);
	}
	restoreInventoryOptions(inventory) {
		this.herdrEnvReady = typeof inventory?.herdrEnv === "boolean";
		this.herdrEnv = this.herdrEnvReady ? Boolean(inventory?.herdrEnv) : true;
		this.freebuff = typeof inventory?.freebuff === "boolean" ? inventory.freebuff : void 0;
	}
	async loadManager(taskCx) {
		const manager = parseManager(await readTextFile(MANAGER_FILE).catch(() => null));
		this.disabled = this.machine ?                 new Set() : manager.disabled;
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
				if (!this.agents) this.agents = inventory?.agents ?? cached ?? null;
				taskCx.notify();
			}
			return;
		}
		if (!machine) known = await this.withLocalRuns(known);
		agentsByMachine.set(key, known);
		agentsFailedByMachine.set(key, false);
		if (this.machine === machine) {
			this.agents = known;
			this.agentsFailed = false;
			taskCx.notify();
		}
	}
	async withLocalRuns(agents) {
		const text = await readTextFile(`${appHome()}/programs.json`).catch(() => void 0);
		if (text === void 0 || text === null) return agents ?? [];
		let root;
		try {
			root = JSON.parse(text);
		} catch {
			return agents ?? [];
		}
		return (agents ?? []).map((agent) => {
			const override = root?.programs?.[agent.key ?? ""]?.run;
			if (Array.isArray(override) && override.length && override.every((part) => typeof part === "string")) return {
				...agent,
				run: [...override]
			};
			return agent;
		});
	}
	machineChanged() {
		return (spaces().find((s) => s.active)?.machine ?? null) !== this.machine;
	}
	currentState() {
		const inventory = this.machine ? null : recentInventory();
		const agents = inventory?.agents ? mergeInventory(this.agents ?? [], inventory.agents) : this.agents;
		const disabled = new Set(Array.isArray(inventory?.disabled) ? inventory.disabled : this.disabled);
		return {
			agents,
			disabled,
			herdrEnv: typeof inventory?.herdrEnv === "boolean" ? inventory.herdrEnv : this.herdrEnv,
			freebuff: resolveFreebuff(this.freebuff, inventory, disabled),
			ready: this.disabledReady && this.herdrEnvReady && Boolean(agents)
		};
	}
	createRows() {
		const space = spaces().find((s) => s.active);
		return [{
			label: "New Terminal",
			icon: "square-terminal",
			hint: shortcut("orca-header.new-tab"),
			tip: "new-terminal",
			run: () => run("tab.new", space ? {
				space: space.id,
				...space.folder ? { folder: space.folder } : {}
			} : {})
		}];
	}
	agentRows() {
		const state = this.currentState();
		if (!state.ready) return [];
		const official = installedEnabledAgents(state.agents, state.disabled);
		const showFreebuff = freebuffVisible(state.freebuff);
		if (!official.length && state.freebuff === void 0) return [];
		const rows = official.map((a) => ({
			label: a.name ?? a.key ?? "",
			program: a,
			hint: "",
			...this.agentAction(a)
		}));
		if (showFreebuff) {
			const freebuff = {
				key: "freebuff",
				name: "FreeBuff CLI",
				run: freebuffRun(state.agents)
			};
			rows.push({
				label: "FreeBuff CLI",
				hint: "",
				image: "freebuff.png",
				section: "Unofficial",
				tip: "freebuff",
				run: () => this.launch(freebuff, void 0, true)
			});
		}
		const settings = {
			label: "Agent Settings",
			icon: "bot",
			settings: true,
			run: () => run("layout.select", {
				stack: "main",
				child: "main-agents"
			})
		};
		if (emptyAgentState(official.length, showFreebuff)) return [settings];
		return [...rows, settings];
	}
	agentAction(agent) {
		const seed = MODELS[agent.key ?? ""];
		if (seed?.flyout) return {
			run: () => this.launchConfigured(agent),
			config: agent
		};
		if (seed) return { stay: (cx) => this.pickModel(agent, cx) };
		return { run: () => this.launch(agent) };
	}
	modelRows() {
		const agent = this.picking;
		if (!agent) return [];
		const all = MODELS[agent.key ?? ""]?.models ?? this.models;
		const rows = [{
			label: "Default",
			hint: "its own",
			run: () => this.launch(agent)
		}];
		if (!all) return [...rows, {
			label: this.modelsFailed ? "Could not list its models" : "Asking the agent…",
			disabled: true
		}];
		const q = this.filter.trim().toLowerCase();
		const matching = q ? all.filter((m) => `${m.label} ${m.id}`.toLowerCase().includes(q)) : all;
		return [
			...rows,
			...all.length ? matching.map((m) => ({
				label: m.label,
				hint: m.id,
				run: () => this.launch(agent, m.id)
			})) : [{
				label: "No models listed",
				disabled: true
			}],
			...all.length && q && !matching.length ? [{
				label: "No models match",
				disabled: true
			}] : []
		];
	}
	list() {
		return this.picking ? this.modelRows() : [...this.createRows(), ...this.agentRows()];
	}
	wheel(rows) {
		const list = this.list();
		const start = Math.max(0, Math.min(this.at - rows + 1, list.length - rows));
		return {
			start,
			rows: list.slice(start, start + rows)
		};
	}
	move(dir) {
		const list = this.list();
		for (let n = 0, i = this.at; n < list.length; n++) {
			i = (i + dir + list.length) % list.length;
			if (!list[i].disabled) {
				this.at = i;
				return;
			}
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
		this.models = cachedModels(agent.key ?? "");
		this.modelsFailed = false;
		this.input.focus();
		cx.timer.after(0, () => this.input.focus());
		const seed = MODELS[agent.key ?? ""];
		if (this.models || !seed.probe) return;
		cx.spawn(async (taskCx) => {
			try {
				const models = await seed.probe?.();
				if (!models) return;
				rememberModels(agent.key ?? "", models);
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
	launchConfigured(agent) {
		const state = this.currentState();
		const current = installedEnabledAgents(state.agents, state.disabled).find((item) => item.key === agent.key);
		if (!state.ready || !current || this.machineChanged()) return;
		this.hoverConfig(current, true, true);
	}
	launch(agent, model, unofficial = false) {
		const state = this.currentState();
		if (!state.ready || this.machineChanged()) return;
		const target = launchTarget(agent, unofficial, state);
		if (!target) return;
		const space = spaces().find((s) => s.active);
		run("tab.new", {
			space: space?.id,
			...space?.folder ? { folder: space.folder } : {},
			argv: launchArgv(target, model, state.herdrEnv)
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
		row.run?.();
	}
	icon(row, size, t) {
		const p = row.program;
		if (p?.icon) return p.tint ? svg(String(p.icon)).size(size).flex_none().text_color(t.muted) : image(String(p.icon)).size(size).flex_none();
		if (row.image) return image(sharedAsset(`mods/orca-new-menu/${row.image}`)).size(size).flex_none().rounded(4);
		if (row.icon) return svg(sharedAsset(`mods/orca-new-menu/${row.icon}.svg`)).size(size).flex_none().text_color(t.muted);
		return div().w(size).flex_none();
	}
	heading(label, t) {
		return div().px(8).pt(8).pb(4).text_size(11).text_color(t.dim).child(label);
	}
	filterRow(t) {
		return h_flex().w_full().h(32).min_h(0).px(8).gap(6).items_center().rounded(8).mb(4).border_1().border_color(t.ring).bg(t.input).child(svg("mods/orca-assets/search--orca-new-menu.svg").size(14).flex_none().text_color(t.muted)).child(Input.new(this.input).flex_1().min_w(0).text_size(12).text_color(t.foreground).bg("#00000000"));
	}
	hoverConfig(agent, hovered, launchNow = false) {
		if (!hovered) return;
		const open = shared("orca-agent-flyout");
		if (open?.key === agent.key && !launchNow) return;
		if (open?.id) closeOverlay(open.id);
		const id = openOverlay({
			mod: "orca-agent-flyout",
			kind: "popup",
			width: FLYOUT_W,
			at: this.flyoutAt(agent),
			props: {
				menu: props()?.overlay,
				space: spaces().find((s) => s.active)?.id,
				name: agent.name,
				key: agent.key,
				argv: agent.run,
				icon: agent.icon,
				tint: agent.tint,
				launchNow
			}
		});
		setShared("orca-agent-flyout", {
			id,
			key: agent.key
		});
	}
	closeFlyout() {
		const open = shared("orca-agent-flyout");
		if (!open) return;
		if (open.id) closeOverlay(open.id);
		setShared("orca-agent-flyout", null);
	}
	closeMenu() {
		this.closeFlyout();
		const overlay = props()?.overlay;
		if (overlay) closeOverlay(overlay);
	}
	trackMenu(e) {
		if (!e.local_position || !e.bounds) return;
		const left = e.position.x - e.local_position.x;
		this.menuEdge = {
			left,
			right: left + e.bounds.width,
			bottom: e.position.y - e.local_position.y + e.bounds.height + MENU_PAD
		};
		this.openHover();
	}
	openHover() {
		if (!this.hoverAgent || !this.menuEdge) return;
		this.rowEdge = {
			key: String(this.hoverAgent.key),
			left: this.menuEdge.left,
			right: this.menuEdge.right,
			bottom: this.menuEdge.bottom
		};
		this.hoverConfig(this.hoverAgent, true);
	}
	flyoutAt(agent) {
		const r = this.rowEdge;
		if (!r || r.key !== agent.key) return "pointer";
		const vp = globalThis.window?.viewport_size?.() ?? null;
		const y = r.bottom + FLYOUT_GAP;
		if (!vp) return {
			x: flyoutX(r.left, r.right, Number.MAX_SAFE_INTEGER),
			y
		};
		return {
			x: flyoutX(r.left, r.right, vp.width),
			y: Math.max(WINDOW_MARGIN, Math.min(y, vp.height - FLYOUT_H - WINDOW_MARGIN))
		};
	}
	iconButton(row, i, t) {
		return h_flex().id(`new-${i}`).size(36).flex_none().items_center().justify_center().rounded(7).cursor_pointer().when(i === this.at, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover)).role("button").accessibility_label(row.label).when(!row.config && !row.tip, (el) => el.tooltip(row.hint ? `${row.label}  ${row.hint}` : row.label)).on_mouse_move((e, cx) => {
			if (!e.local_position || !e.bounds) return;
			if (!row.config) {
				this.hoverAgent = null;
				this.closeFlyout();
			} else {
				this.hoverAgent = row.config;
				this.openHover();
			}
			if (this.at !== i) {
				this.at = i;
				cx.notify();
			}
		}).on_hover((hovered, cx) => {
			if (row.tip) {
				const next = hovered ? row.tip : null;
				if (this.tipHot !== next) {
					this.tipHot = next;
					cx.notify();
				}
			}
			if (!hovered && this.hoverAgent === (row.config ?? null)) this.hoverAgent = null;
		}).on_click((_e, cx) => this.choose(i, cx)).child(this.icon(row, 18, t));
	}
	operationBar(t) {
		const row = this.createRows()[0];
		return h_flex().items_center().child(this.tipButton(row, 0, t));
	}
	tipButton(row, i, t) {
		const button = this.iconButton(row, i, t);
		if (!row.tip) return button;
		return HoverCard.new(`tip-${row.tip}`).flex_none().anchor("top_center").open_delay(150).close_delay(0).trigger(button).content(this.tipHot === row.tip ? this.terminalTip(row) : div());
	}
	terminalTip(row) {
		let caps = [];
		if (row.hint) caps = row.hint.includes("+") ? row.hint.split("+") : [...row.hint];
		const card = h_flex().h(34).px(10).gap(10).items_center().rounded(8).border_1().border_color("#e4e4e7").bg("#f4f4f5").shadow_md().child(div().text_size(13).font_medium().text_color("#18181b").child(row.label)).when(caps.length > 0, (el) => el.child(h_flex().gap(4).children(caps.map((key) => div().size(20).rounded(4).bg("#a1a1aa").flex().items_center().justify_center().text_size(12).text_color("#18181b").child(key)))));
		return div().relative().mt(4).pt(7).child(card).child(div().absolute().top(0).left(0).right(0).flex().justify_center().child(svg("mods/orca-assets/tip-arrow--orca-new-menu.svg").w(14).h(8).flex_none()));
	}
	agentGroups() {
		const rows = this.agentRows();
		return {
			official: rows.filter((row) => !row.section && !row.settings),
			unofficial: rows.filter((row) => row.section === "Unofficial"),
			settings: rows.find((row) => row.settings)
		};
	}
	agentBar(t) {
		const groups = this.agentGroups();
		const rows = [
			...groups.official,
			...groups.unofficial,
			...groups.settings ? [groups.settings] : []
		];
		const last = Math.max(0, rows.length - AGENT_FULL);
		const at = Math.max(0, Math.min(this.agentAt, last));
		const overflow = rows.length > AGENT_FULL;
		const icons = h_flex().relative().flex_none().items_center().gap(AGENT_GAP).left(-at * 40).transition("left", {
			duration: 150,
			easing: "ease-out"
		}).children(rows.map((row, n) => this.tipButton(row, 1 + n, t)));
		const viewport = div().w(AGENT_VIEW).flex_none().overflow_x_hidden().child(icons);
		return h_flex().w_full().items_center().justify_center().gap(AGENT_GAP).on_mouse_move((e) => this.trackMenu(e)).on_scroll_wheel((e, cx) => {
			if (!e.delta.y || !overflow) return;
			this.agentAt = Math.max(0, Math.min(this.agentAt + (e.delta.y > 0 ? 1 : -1), last));
			cx.stop_propagation();
			cx.notify();
		}).when(overflow, (el) => el.child(this.agentArrow(-1, at > 0, t)).child(viewport).child(this.agentArrow(1, at < last, t))).when(!overflow, (el) => el.child(h_flex().items_center().gap(AGENT_GAP).children(rows.map((row, n) => this.tipButton(row, 1 + n, t)))));
	}
	agentArrow(dir, enabled, t) {
		return div().size(AGENT_ARROW).flex_none().flex().items_center().justify_center().rounded(5).role("button").accessibility_label(dir < 0 ? "Previous agents" : "More agents").on_hover((hovered) => {
			if (!hovered) return;
			this.hoverAgent = null;
			this.closeFlyout();
		}).when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => {
			this.agentAt += dir;
			this.agentAt = Math.max(0, Math.min(this.agentAt, Math.max(0, this.agentRows().length - AGENT_FULL)));
			cx.notify();
		})).opacity(enabled ? 1 : .35).child(svg(dir < 0 ? "mods/orca-assets/chevron-left--orca-header.svg" : "mods/orca-assets/chevron-right--orca-header.svg").size(14).flex_none().text_color(t.muted));
	}
	row(row, i, t, onClick) {
		return v_flex().when(row.sep, (el) => el.child(div().mx(6).my(5).h(1).bg(t.border))).child(h_flex().id(`new-${i}`).h(32).px(8).gap(8).rounded(7).items_center().whitespace_nowrap().font_medium().text_color(row.disabled ? t.dim : t.foreground).when(i === this.at && !row.disabled, (el) => el.bg(t.selected)).when(!row.disabled, (el) => el.on_hover((hovered, cx) => {
			if (!hovered || i < 0 || this.at === i) return;
			this.at = i;
			cx.notify();
		}).on_click((_e, cx) => onClick ? onClick(cx) : this.choose(i, cx))).child(this.icon(row, 16, t)).child(div().flex_1().min_w(0).truncate().child(row.label)).child(div().flex_none().pl(16).max_w(110).truncate().text_color(t.muted).child(row.hint ?? "")));
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
		return v_flex().id("orca-new-menu").track_focus(this.handle).w_full().p(MENU_PAD).gap(6).bg(t.popover).text_size(12).on_key_down((e, cx) => this.onKey(e, cx, null)).on_scroll_wheel((e, cx) => {
			if (!e.delta.y) return;
			this.move(e.delta.y > 0 ? 1 : -1);
			cx.notify();
		}).child(this.operationBar(t)).child(div().w_full().h(1).bg(t.border)).child(this.agentBar(t));
	}
	renderPicker(t) {
		const picking = this.picking;
		const page = this.wheel(FIT.models);
		return v_flex().id("orca-new-menu").track_focus(this.handle).w_full().min_h(0).p(4).bg(t.popover).text_size(12).on_key_down((e, cx) => this.onKey(e, cx, picking)).on_scroll_wheel((e, cx) => {
			if (!e.delta.y) return;
			this.move(e.delta.y > 0 ? 1 : -1);
			cx.notify();
		}).child(this.heading(picking?.name ?? "", t)).child(this.filterRow(t)).children(page.rows.map((row, j) => this.row(row, page.start + j, t))).child(this.row({
			label: "Back",
			icon: "chevron-left",
			sep: true
		}, -1, t, (clickCx) => {
			this.back();
			clickCx.notify();
		}));
	}
};
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

export { NewMenu as default };
