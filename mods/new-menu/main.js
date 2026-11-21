import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, theme, spaces, panes, knownAgents, readTextFile, run, openOverlay, closeOverlay, props, window, keys, shared, setShared } from "herdr";

// The last agents each machine reported, shown at once while knownAgents() checks again.
const KNOWN = "new-menu.agents";

// The Agent Manager's on/off list. A disabled agent is still installed, it is just not offered.
function disabledAgents(text) {
  try {
    const root = JSON.parse(String(text ?? ""));
    return new Set(Array.isArray(root?.disabled) ? root.disabled.filter((key) => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

function shortcut(name) {
  const k = keys().find(b => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.keys.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map(m => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter(m => held.has(m)).map(m => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

export default class NewMenu extends View {
  init(_props, cx) {
    const machine = spaces().find(s => s.active)?.machine;
    this.machine = machine ?? null;
    const where = machine ?? "";
    this.agents = shared(KNOWN)?.[where] ?? [];
    this.disabled = new Set();
    this.disabledReady = Boolean(machine);
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (!machine) {
      cx.spawn(async cx => {
        const text = await readTextFile(`${appHome()}/agent-manager.json`).catch(() => null);
        this.disabled = disabledAgents(text);
        this.disabledReady = true;
        cx.notify();
      });
    }
    cx.spawn(async cx => {
      try {
        let known = await knownAgents({ on: machine });
        known = await this.withLocalRuns(known);
        const inventory = this.recentInventory();
        if (inventory) known = mergeInventory(known, inventory);
        this.agents = known;
        setShared(KNOWN, { ...shared(KNOWN), [where]: known });
      }
      catch { this.failed = true; }
      cx.notify();
    });
  }
  row(id, icon, name, action, hint = "", enabled = true) {
    const t = theme();
    return h_flex().id(id).h(31).px(9).gap(10).rounded(7).items_center().flex_none()
      .text_color(enabled ? t.foreground : t.dim).when(enabled, el => el.hover(s => s.bg(t.selected)))
      .on_click(() => { if (enabled) { closeOverlay(props().overlay); action(); } })
      .child(icon).child(div().flex_1().child(name)).child(div().text_size(11).text_color(t.dim).child(hint));
  }
  // The Agent Manager's recent local inventory is fresher than Herdr's install cache and carries
  // the effective command after a programs.json edit. Remote machines never inherit it.
  recentInventory() {
    if (this.machine) return null;
    const inventory = shared("agent-manager.inventory");
    if (!inventory || !Array.isArray(inventory.agents) || Date.now() - Number(inventory.at) > 30000) return null;
    return inventory.agents;
  }

  mergeInventory(known, inventory) {
    const fresh = new Map(inventory.filter(a => a?.key).map(a => [a.key, a]));
    return known.map(a => {
      const current = fresh.get(a.key);
      if (!current) return a;
      return {
        ...a,
        installed: Boolean(current.installed),
        run: Array.isArray(current.run) && current.run.length ? [...current.run] : a.run,
      };
    });
  }

  // programs.json is this computer's; a remote machine must launch its own executable.
  async withLocalRuns(agents) {
    if (this.machine) return agents;
    const text = await readTextFile(`${appHome()}/programs.json`).catch(() => undefined);
    if (text === undefined) return agents;
    let root;
    try { root = JSON.parse(text); } catch { return agents; }
    return (agents ?? []).map(a => {
      const run = root?.programs?.[a.key]?.run;
      if (Array.isArray(run) && run.length && run.every(part => typeof part === "string")) {
        return { ...a, run: [...run] };
      }
      return a;
    });
  }

  machineChanged() {
    return (spaces().find(s => s.active)?.machine ?? null) !== this.machine;
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const offered = this.disabledReady ? this.agents.filter(a => !this.disabled.has(a.key)) : [];
    const installed = offered.filter(a => a.installed);
    const choices = this.failed ? installed : [...installed, ...offered.filter(a => !a.installed).slice(0, 2)];
    return v_flex().min_h(0).w_full().h(Math.min(491, 167 + Math.max(1, choices.length + (this.failed ? 1 : 0)) * 31)).bg(t.popover).p(5).text_size(12.8)
      .id("new-menu").track_focus(this.handle)
      .on_key_down((e) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const agent = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (!agent || !this.disabledReady || this.disabled.has(agent.key) || this.machineChanged()) return;
        closeOverlay(props().overlay);
        run("tab.new", { name: agent.name, space: space?.id, argv: agent.run });
      })
      .child(this.row("terminal", svg("icons/shell.svg").size(14), "Terminal", () => run("tab.new", { space: space?.id }), shortcut("tab.new")))
      .child(div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child("Start an agent"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(choices.map((a, i) => this.row(a.key, a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14), a.name,
          () => {
            if (this.disabledReady && !this.disabled.has(a.key) && !this.machineChanged()) {
              run("tab.new", { name: a.name, space: space?.id, argv: a.run });
            }
          }, a.installed ? (i < 9 ? String(i + 1) : "") : "not installed", a.installed)))
        .when(this.failed || offered.length === 0, el => el.child(div().px(9).py(6).text_color(t.dim).child(
          !this.disabledReady ? "Checking agent availability…" : this.failed ? "Could not check installed agents" : this.agents.length ? "All agents are disabled in Agent Manager" : "Checking installed agents…"))))
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(this.row("space", div().w(14).child("+"), "New space", () => run("space.new"), shortcut("space.new")))
      .child(this.row("worktree", svg("mods/workspace-chrome/branch.svg").size(14), "New worktree…", () => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "new" } }), "", Boolean(space)))
      .child(this.row("worktree-open", svg("mods/workspace-chrome/branch.svg").size(14), "Open worktree\u2026", () => openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "open" } }), "", Boolean(space)));
  }
}
