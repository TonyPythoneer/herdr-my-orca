// Agent Manager: Herdr's agent catalog as a Settings-style page.
//
// Installation is Herdr's own: `knownAgents()` lists every entry with a `run` in
// programs.json and whether the shell agents start in finds it. Commands are edited in that same
// programs.json `run` array (executable and arguments kept apart). Herdr has no native
// enabled/disabled flag, so the one piece this mod adds is `agent-manager.json`; the Orca
// "Start an agent" menu reads it before offering a row.
//
// Refresh asks `knownAgents()` again, but Herdr caches installation checks for up to a minute,
// and the API has no force option (verified: `{force:true}` and `{refresh:true}` are ignored;
// editing an unrelated programs entry does not clear it). The smallest fresh check is the
// `command -v` probe in state.js, run in the same login shell Herdr uses. If it fails, the
// cached Herdr answer stays and the page says so instead of marking every agent missing.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, Link } from "gpui-base";
import { appHome, checking, exec, knownAgents, props, readTextFile, run, theme, settings, writeTextFile } from "herdr";
import {
  applyFreshInstalled,
  argsToText,
  checkCommands,
  commandCheckScript,
  defaultRun,
  formatArgv,
  homepageFor,
  isBuiltinAgent,
  parseCommandCheck,
  parseManagerConfig,
  programsTextError,
  readRunOverride,
  serializeManagerConfig,
  splitInventory,
  validateDraft,
  writeRunOverride,
} from "./state.js";

const PROGRAMS = `${appHome()}/programs.json`;
const MANAGER = `${appHome()}/agent-manager.json`;
const CACHE_KEY = "agent-manager.inventory.v1";
const TERMINALS_PAGE = "main-terminals";
const POLL_MS = 4000;

function errorText(error) {
  return String(error?.message ?? error ?? "unknown error");
}

function timeLabel(at) {
  if (!at) return "Not checked yet";
  return `Checked ${new Date(at).toTimeString().slice(0, 8)}`;
}

function sameRun(a, b) {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

export default class AgentManager extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.width = 0;
    this.agents = null;
    this.programsText = undefined; // undefined: not read yet; null: no file
    this.managerText = undefined;
    this.programsError = null;
    this.managerError = null;
    this.writeError = null;
    this.disabled = new Set();
    this.expanded = new Set();
    this.editors = new Map();
    this.focusKey = null;
    this.typing = false;
    this.loading = true;
    this.refreshing = false;
    this.detectionError = null;
    this.freshWarning = null;
    this.lastChecked = null;
    this.pendingProgramsText = undefined;
    this.externalConflict = false;
    this.savedKey = null;
    this.shell = null;
    this.gen = 0;

    // Deep link: a tab or overlay can open the page with one agent's editor showing
    // (`tab.new {mod: "orca-agent-manager", props: {expand: "claude"}}`).
    const expand = props()?.expand;
    if (typeof expand === "string") this.expanded.add(expand);

    this.restoreCache();
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(POLL_MS, (cx) => this.poll(cx));
  }

  // ---- data -----------------------------------------------------------------

  restoreCache() {
    try {
      const rows = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
      if (!Array.isArray(rows)) return;
      const usable = rows.filter((row) => row && typeof row.key === "string" && Array.isArray(row.run));
      if (usable.length) {
        this.agents = usable;
        this.loading = false;
        this.fromCache = true;
      }
    } catch {}
  }

  cache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(this.agents ?? []));
    } catch {}
  }

  applyPrograms(text) {
    if (text === undefined || text === this.programsText) return false;
    this.programsText = text;
    this.programsError = programsTextError(text);
    return true;
  }

  applyManager(text) {
    if (text === undefined || text === this.managerText) return false;
    this.managerText = text;
    const parsed = parseManagerConfig(text);
    this.managerError = parsed.error ?? null;
    if (!parsed.error) this.disabled = parsed.disabled;
    this.writeError = null;
    return true;
  }

  rowInfo(agent) {
    // knownAgents()' run is already effective. The file is read again so an external edit shows
    // without waiting for Herdr's install-check cache, and so the override is distinguishable
    // from the built-in command.
    const loaded = this.programsText !== undefined;
    const parsed = loaded ? readRunOverride(this.programsText, agent.key) : { run: null };
    const override = parsed.error ? null : parsed.run;
    const builtin = defaultRun(agent.key);
    return {
      override,
      customized: override !== null,
      // KnownAgents' `run` is the effective command, but it is cached for up to a minute, so after
      // programs.json drops an override it can still carry the old one. The built-in default is
      // the canonical fallback once the file has been read; before that, Herdr's answer is all
      // there is (and it avoids showing the default for a user override on the first paint).
      run: override ?? (loaded ? builtin ?? agent.run : agent.run),
      defaultCmd: builtin,
      builtin: isBuiltinAgent(agent.key),
      homepage: homepageFor(agent.key),
      entryError: this.programsError || !loaded ? null : parsed.error ?? null,
    };
  }

  allRows() {
    const base = (this.agents ?? []).map((agent) => ({ ...agent, ...this.rowInfo(agent) }));
    const split = splitInventory(base, this.disabled);
    return { ...split, all: [...split.installed, ...split.available] };
  }

  refresh(cx) {
    if (this.refreshing) return;
    this.refreshing = true;
    this.detectionError = null;
    this.freshWarning = null;
    this.writeError = null;
    const gen = ++this.gen;
    cx.spawn(async (cx) => {
      let known = null;
      let failure = null;
      let programs;
      let manager;
      try {
        [known, programs, manager] = await Promise.all([
          knownAgents().catch((error) => {
            failure = error;
            return null;
          }),
          readTextFile(PROGRAMS).catch(() => undefined),
          readTextFile(MANAGER).catch(() => undefined),
        ]);
      } catch (error) {
        failure = error;
      }
      if (gen !== this.gen) return;

      this.applyPrograms(programs);
      this.applyManager(manager);
      if (known) {
        this.agents = known;
        this.fromCache = false;
        this.cache();
      }
      if (failure) this.detectionError = `Could not detect installed agents: ${errorText(failure)}`;
      if (failure && !this.agents) this.loading = false;

      let fresh = null;
      if (this.agents?.length) {
        try {
          fresh = await this.freshInstallCheck();
          this.freshWarning = null;
        } catch (error) {
          this.freshWarning = `Fresh install check failed (${errorText(error)}); showing Herdr's cached answer.`;
        }
      }
      if (gen !== this.gen) return;
      if (fresh) this.agents = applyFreshInstalled(this.agents, fresh);
      if (this.agents) this.cache();

      try {
        this.syncEditors();
      } catch {}
      this.loading = false;
      this.refreshing = false;
      this.lastChecked = Date.now();
      cx.notify();
    });
  }

  async shellPath() {
    if (this.shell) return this.shell;
    try {
      const result = await exec("/bin/sh", ["-c", 'printf %s "${SHELL:-/bin/sh}"'], { timeout: 5000 });
      const path = result.code === 0 ? result.stdout.trim() : "";
      this.shell = path.startsWith("/") ? path : "/bin/sh";
    } catch {
      this.shell = "/bin/sh";
    }
    return this.shell;
  }

  // One shell call for every agent. Commands travel as positional arguments, never as script
  // text, and the answers are marked so login profiles that print a banner cannot shift them.
  async freshInstallCheck() {
    const agents = this.agents ?? [];
    const commands = checkCommands(agents);
    if (!commands.length) return null;
    const shell = await this.shellPath();
    const script = commandCheckScript(shell);
    const attempt = async (args) => {
      const result = await exec(shell, args, { timeout: 30000 });
      if (result.code !== 0) throw new Error(result.stderr.trim() || `${shell} exited ${result.code}`);
      const answers = parseCommandCheck(result.stdout, commands.length);
      return new Map(agents.map((agent, index) => [agent.key, answers[index]]));
    };
    try {
      return await attempt(["-lic", script, "herdr-agent-manager", ...commands]);
    } catch (first) {
      try {
        return await attempt(["-lc", script, "herdr-agent-manager", ...commands]);
      } catch {
        throw first;
      }
    }
  }

  // programs.json or agent-manager.json changed outside this page. Dirty drafts are never
  // replaced; they get a conflict banner and an explicit overwrite action instead.
  poll(cx) {
    if (this.refreshing) return;
    cx.spawn(async (cx) => {
      const programs = await readTextFile(PROGRAMS).catch(() => undefined);
      const manager = await readTextFile(MANAGER).catch(() => undefined);
      let changed = false;
      if (programs !== undefined && programs !== this.programsText) {
        if (this.anyDirty()) {
          this.pendingProgramsText = programs;
          this.externalConflict = true;
        } else {
          this.applyPrograms(programs);
          this.pendingProgramsText = undefined;
          this.externalConflict = false;
          this.writeError = null;
          this.syncEditors();
          changed = true;
          this.reloadInventory(cx);
        }
      }
      if (this.applyManager(manager)) changed = true;
      if (changed) cx.notify();
      else if (this.externalConflict) cx.notify();
    });
  }

  // Adding/removing a programs.json entry changes the agent list, which only knownAgents knows.
  reloadInventory(cx) {
    const gen = ++this.gen;
    cx.spawn(async (cx) => {
      try {
        const known = await knownAgents();
        if (gen !== this.gen) return;
        this.agents = known;
        this.cache();
      } catch {}
      cx.notify();
    });
  }

  syncEditors() {
    const rows = this.allRows().all;
    for (const key of this.expanded) {
      const row = rows.find((candidate) => candidate.key === key);
      if (row && !this.editors.has(key)) this.ensureEditor(row);
    }
    for (const row of rows) {
      const editor = this.editors.get(row.key);
      if (!editor || editor.dirty) continue;
      editor.command.set_value(row.run[0] ?? "");
      editor.args.set_value(argsToText(row.run.slice(1)));
      editor.error = null;
      editor.conflict = false;
    }
  }

  anyDirty() {
    for (const editor of this.editors.values()) if (editor.dirty) return true;
    return false;
  }

  // ---- edits ----------------------------------------------------------------

  ensureEditor(row) {
    const found = this.editors.get(row.key);
    if (found) return found;
    const command = InputState.new({
      value: row.run[0] ?? "",
      placeholder: "claude, or /full/path/to/claude",
    });
    const args = TextareaState.new({ value: argsToText(row.run.slice(1)), rows: 3 });
    args.set_soft_wrap(false);
    const editor = { command, args, dirty: false, error: null, conflict: false, force: false };
    const changed = (_event, cx) => {
      const draft = validateDraft(command.value(), args.value());
      const current = this.agents?.find((candidate) => candidate.key === row.key);
      const effective = current ? this.rowInfo(current).run : row.run;
      editor.dirty = Boolean(draft.error) || !sameRun(draft.run ?? [], effective);
      editor.error = null;
      cx.notify();
    };
    command.on("change", changed);
    args.on("change", changed);
    command.on("submit", (_event, cx) => this.save(row, cx));
    const typing = (_event, cx) => {
      this.typing = true;
      cx.notify();
    };
    const stopped = (_event, cx) => {
      this.typing = false;
      cx.notify();
    };
    command.on("focus", typing);
    command.on("blur", stopped);
    args.on("focus", typing);
    args.on("blur", stopped);
    this.editors.set(row.key, editor);
    return editor;
  }

  toggleExpand(row, cx) {
    if (this.expanded.has(row.key)) {
      this.expanded.delete(row.key);
    } else {
      this.expanded.add(row.key);
      this.ensureEditor(row);
    }
    this.focusKey = row.key;
    this.handle.focus();
    cx.notify();
  }

  cancelEdit(row, cx) {
    const editor = this.editors.get(row.key);
    if (!editor) return;
    editor.command.set_value(row.run[0] ?? "");
    editor.args.set_value(argsToText(row.run.slice(1)));
    editor.dirty = false;
    editor.error = null;
    editor.conflict = false;
    editor.force = false;
    this.writeError = null;
    if (!this.anyDirty()) {
      this.externalConflict = false;
      this.pendingProgramsText = undefined;
    }
    cx.notify();
  }

  reloadRow(row, cx) {
    const editor = this.editors.get(row.key);
    if (!editor) return;
    if (this.pendingProgramsText !== undefined && !this.anyOtherDirty(row.key)) {
      this.applyPrograms(this.pendingProgramsText);
      this.pendingProgramsText = undefined;
      this.externalConflict = false;
    }
    this.cancelEdit(row, cx);
    this.syncEditors();
    cx.notify();
  }

  anyOtherDirty(exceptKey) {
    for (const [key, editor] of this.editors) if (key !== exceptKey && editor.dirty) return true;
    return false;
  }

  async save(row, cx) {
    const editor = this.editors.get(row.key);
    if (!editor) return;
    const validated = validateDraft(editor.command.value(), editor.args.value());
    if (validated.error) {
      editor.error = validated.error;
      cx.notify();
      return;
    }
    if (!editor.dirty) return;
    await this.writeRun(row, validated.run, cx);
  }

  async reset(row, cx) {
    if (!row.builtin || !row.defaultCmd) return;
    await this.writeRun(row, null, cx);
  }

  async writeRun(row, run, cx) {
    const editor = this.editors.get(row.key);
    if (!editor) return;
    this.writeError = null;
    const latest = await readTextFile(PROGRAMS).catch(() => this.programsText);
    if (latest !== this.programsText && !editor.force) {
      // Someone else wrote the file after this draft began. Keep the draft.
      editor.conflict = true;
      this.pendingProgramsText = latest;
      this.externalConflict = true;
      this.writeError = "programs.json changed on disk. Review the file, then reload or overwrite.";
      cx.notify();
      return;
    }
    const base = latest === undefined ? this.programsText : latest;
    const written = writeRunOverride(base, row.key, run);
    if (written.error) {
      editor.error = written.error;
      cx.notify();
      return;
    }
    try {
      await writeTextFile(PROGRAMS, written.text, base === undefined ? null : base);
    } catch (error) {
      editor.conflict = true;
      this.pendingProgramsText = base;
      this.externalConflict = true;
      this.writeError = `Could not save programs.json: ${errorText(error)}. Your edit is kept.`;
      cx.notify();
      return;
    }

    this.programsText = written.text;
    this.programsError = null;
    this.pendingProgramsText = undefined;
    this.externalConflict = false;
    editor.dirty = false;
    editor.error = null;
    editor.conflict = false;
    editor.force = false;

    const nextRun = run ?? defaultRun(row.key) ?? row.run;
    editor.command.set_value(nextRun[0] ?? "");
    editor.args.set_value(argsToText(nextRun.slice(1)));
    this.savedKey = row.key;
    cx.timer.after(2200, () => {
      if (this.savedKey === row.key) {
        this.savedKey = null;
        cx.notify();
      }
    });
    // The command changed, which makes Herdr check installation again.
    this.refreshing = false;
    this.refresh(cx);
  }

  toggleEnabled(row, cx) {
    // An uninstalled CLI has no availability to change; its switch is locked until it is installed.
    if (!row.installed) return;
    if (this.managerError) return;
    cx.spawn(async (cx) => {
      const latest = await readTextFile(MANAGER).catch(() => this.managerText);
      const base = latest === undefined ? this.managerText : latest;
      const parsed = parseManagerConfig(base);
      if (parsed.error) {
        this.managerError = parsed.error;
        cx.notify();
        return;
      }
      const next = new Set(parsed.disabled);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      const text = serializeManagerConfig(next);
      try {
        await writeTextFile(MANAGER, text, base === undefined ? null : base);
      } catch (error) {
        this.writeError = `Could not save agent-manager.json: ${errorText(error)}`;
        cx.notify();
        return;
      }
      this.managerText = text;
      this.managerError = null;
      this.disabled = next;
      this.writeError = null;
      cx.notify();
    });
  }

  // ---- keyboard -------------------------------------------------------------

  onKey(event, cx) {
    if (this.typing) return false;
    const key = String(event.key ?? "");
    const rows = this.allRows().all;
    if (!rows.length) return false;
    let at = rows.findIndex((row) => row.key === this.focusKey);
    if (key === "down" || key === "up") {
      at = key === "down" ? (at + 1) % rows.length : (at <= 0 ? rows.length - 1 : at - 1);
      this.focusKey = rows[at].key;
    } else if (key === "home") {
      this.focusKey = rows[0].key;
    } else if (key === "end") {
      this.focusKey = rows[rows.length - 1].key;
    } else if (key === "enter") {
      const row = rows[Math.max(0, at)];
      if (row) this.toggleExpand(row, cx);
      return true;
    } else if (key === "space" || key === " ") {
      const row = rows[Math.max(0, at)];
      if (row) this.toggleEnabled(row, cx);
    } else if (key.toLowerCase() === "r") {
      this.refresh(cx);
    } else if (key === "escape") {
      const row = rows[Math.max(0, at)];
      if (row && this.expanded.has(row.key)) this.expanded.delete(row.key);
      else return false;
    } else {
      return false;
    }
    this.handle.focus();
    cx.notify();
    return true;
  }

  // ---- drawing --------------------------------------------------------------

  badge(text, t, options = {}) {
    const color = options.color ?? t.muted;
    return div()
      .h(18)
      .px(6)
      .flex_none()
      .flex()
      .items_center()
      .rounded(4)
      .bg(options.bg ?? "#00000000")
      .when(options.border, (el) => el.border_1().border_color(t.border))
      .text_size(10)
      .font_medium()
      .text_color(color)
      .child(text);
  }

  icon(row, size, t) {
    if (row.icon) {
      return row.tint
        ? svg(row.icon).size(size).flex_none().text_color(t.muted)
        : image(row.icon).w(size).h(size).flex_none().rounded(3);
    }
    return div()
      .size(size)
      .flex_none()
      .rounded(3)
      .bg(t.raised)
      .flex()
      .items_center()
      .justify_center()
      .text_size(Math.round(size * 0.55))
      .text_color(t.muted)
      .child((row.name ?? "?").slice(0, 1).toUpperCase());
  }

  button(id, label, t, onClick, options = {}) {
    return h_flex()
      .id(id)
      .h(options.height ?? 28)
      .px(options.px ?? 10)
      .gap(6)
      .flex_none()
      .items_center()
      .justify_center()
      .rounded(6)
      .border_1()
      .border_color(options.primary ? t.accent : t.border)
      .bg(options.primary ? t.solid : "#00000000")
      .text_size(options.size ?? 12)
      .font_medium()
      .text_color(options.primary ? t.solid_foreground : options.color ?? t.foreground)
      .when(!options.disabled, (el) => el.cursor_pointer().hover((s) => s.bg(options.primary ? t.solid : t.hover)))
      .when(options.disabled, (el) => el.opacity(0.45))
      .role("button")
      .accessibility_label(label)
      .tooltip(label)
      .when(!options.disabled, (el) => el.on_click((event, cx) => onClick(event, cx)))
      .child(label);
  }

  toggle(row, t) {
    const installed = Boolean(row.installed);
    const on = installed && row.enabled;
    return div()
      .id(`am-toggle-${row.key}`)
      .w(36)
      .h(20)
      .flex_none()
      .flex()
      .items_center()
      .p(2)
      .rounded_full()
      .bg(on ? t.accent : t.input)
      .when(installed, (el) => el.cursor_pointer())
      .when(!installed, (el) => el.opacity(0.45))
      .role("switch")
      .checked(on)
      .accessibility_label(installed ? `${row.name} availability` : `${row.name} is unavailable; not installed`)
      .tooltip(installed ? (on ? `Disable ${row.name}` : `Enable ${row.name}`) : `Install ${row.name} first; this switch is unavailable until its CLI is installed`)
      .when(installed, (el) =>
        el.on_click((_event, cx) => {
          cx.stop_propagation();
          this.toggleEnabled(row, cx);
        }),
      )
      .child(
        h_flex()
          .w_full()
          .items_center()
          .when(on, (el) => el.justify_end())
          .when(!on, (el) => el.justify_start())
          .child(div().size(16).rounded_full().bg(on ? t.accent_foreground : t.muted)),
      );
  }

  section(title, count, t, note) {
    return h_flex()
      .w_full()
      .items_center()
      .gap(8)
      .pt(18)
      .pb(6)
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child(title))
      .child(this.badge(count, t, { border: true }))
      .when(note, (el) => el.child(div().text_size(11).text_color(t.dim).child(note)))
      .child(div().flex_1());
  }

  commandLine(row, t) {
    const mono = settings()?.font_family ?? "JetBrains Mono";
    const effective = formatArgv(row.run);
    if (!row.customized || !row.defaultCmd) {
      return div().min_w(0).truncate().font_family(mono).text_size(11).text_color(t.muted).child(effective);
    }
    const fallback = div().min_w(0).truncate().font_family(mono).text_size(11).text_color(t.muted).child(effective);
    return h_flex()
      .min_w(0)
      .gap(6)
      .child(
        div()
          .flex_none()
          .font_family(mono)
          .text_size(11)
          .text_color(t.dim)
          .line_through()
          .child(formatArgv(row.defaultCmd)),
      )
      .when(row.override, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("→")).child(fallback));
  }

  row(row, t) {
    const open = this.expanded.has(row.key);
    const focused = this.focusKey === row.key && this.handle.is_focused();
    const editor = this.editors.get(row.key);
    const quiet = !row.enabled && row.installed;
    return v_flex()
      .id(`am-row-${row.key}`)
      .relative()
      .w_full()
      .border_b(1)
      .border_color(t.border)
      .when(focused, (el) => el.bg(t.hover))
      .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(focused ? t.accent : "#00000000"))
      .child(
        h_flex()
          .w_full()
          .min_w(0)
          .flex_wrap()
          .gap(12)
          .py(10)
          .items_center()
          .child(
            h_flex()
              .w(32)
              .h(32)
              .flex_none()
              .items_center()
              .justify_center()
              .rounded(8)
              .border_1()
              .border_color(t.border)
              .bg(t.surface)
              .when(quiet, (el) => el.opacity(0.5))
              .child(this.icon(row, 18, t)),
          )
          .child(
            v_flex()
              .flex_1()
              .min_w(180)
              .gap(3)
              .child(
                h_flex()
                  .gap(6)
                  .items_center()
                  .flex_wrap()
                  .child(
                    div()
                      .id(`am-name-${row.key}`)
                      .rounded(3)
                      .cursor_pointer()
                      .text_size(13)
                      .font_medium()
                      .text_color(t.foreground)
                      .when(quiet, (el) => el.opacity(0.45))
                      .role("button")
                      .accessibility_label(`${row.name}: edit command`)
                      .tooltip(open ? "Hide command editor" : "Edit command and arguments")
                      .on_click((_event, cx) => this.toggleExpand(row, cx))
                      .child(row.name),
                  )
                  .when(!row.enabled && row.installed, (el) => el.child(this.badge("Disabled", t, { color: t.blocked, border: true })))
                  .when(row.customized, (el) => el.child(this.badge("Customized", t, { color: t.accent, border: true })))
                  .when(row.entryError, (el) => el.child(this.badge("Invalid command", t, { color: t.blocked, border: true }))),
              )
              .child(this.commandLine(row, t))
              .when(!row.installed, (el) =>
                el.child(
                  h_flex()
                    .gap(6)
                    .items_center()
                    .child(div().text_size(11).text_color(t.dim).child("Not installed"))
                    .when(row.homepage, (inner) =>
                      inner.child(
                        Link.new(`am-guide-${row.key}`)
                          .href(row.homepage)
                          .text_size(11)
                          .text_color(t.accent)
                          .underline()
                          .tooltip(row.homepage)
                          .child("Install guide ↗"),
                      ),
                    )
                    .when(!row.homepage, (inner) => inner.child(div().text_size(11).text_color(t.dim).child("· no install guide known"))),
                ),
              ),
          )
          .child(
            h_flex()
              .ml_auto()
              .flex_none()
              .items_center()
              .gap(10)
              .child(this.toggle(row, t))
              .child(
                div()
                  .id(`am-more-${row.key}`)
                  .size(26)
                  .flex_none()
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(6)
                  .text_color(t.muted)
                  .cursor_pointer()
                  .hover((s) => s.bg(t.hover).text_color(t.foreground))
                  .role("button")
                  .accessibility_label(open ? `Hide ${row.name} command` : `Edit ${row.name} command`)
                  .tooltip(open ? "Hide command editor" : "Edit command and arguments")
                  .on_click((_event, cx) => {
                    cx.stop_propagation();
                    this.toggleExpand(row, cx);
                  })
                  .child(svg(`mods/orca-agent-manager/${open ? "chevron-down" : "chevron-right"}.svg`).size(14)),
              ),
          ),
      )
      .when(open && editor, (el) => el.child(this.editor(row, editor, t)));
  }

  editor(row, editor, t) {
    const mono = settings()?.font_family ?? "JetBrains Mono";
    const draft = validateDraft(editor.command.value(), editor.args.value());
    const preview = draft.run ? formatArgv(draft.run) : "";
    const saveLabel = editor.conflict ? "Overwrite" : "Save";
    const dirty = draft.run ? !sameRun(draft.run, row.run) : true;
    return v_flex()
      .w_full()
      .pl(this.width && this.width < 520 ? 0 : 44)
      .pr(2)
      .pb(14)
      .gap(8)
      .when(editor.conflict, (el) =>
        el.child(
          v_flex()
            .gap(6)
            .p(10)
            .rounded(8)
            .border_1()
            .border_color(t.blocked)
            .bg("#ef444414")
            .child(
              div()
                .text_size(11)
                .text_color(t.blocked)
                .child("programs.json changed on disk. Your draft is kept; reload or overwrite this agent's command."),
            )
            .child(
              h_flex()
                .gap(8)
                .child(this.button(`am-reload-${row.key}`, "Reload", t, (_event, cx) => this.reloadRow(row, cx), { height: 24, px: 8 }))
                .child(this.button(`am-force-${row.key}`, "Overwrite", t, (_event, cx) => {
                  editor.force = true;
                  this.save(row, cx);
                }, { height: 24, px: 8, color: t.blocked })),
            ),
        ),
      )
      .child(div().text_size(10).font_semibold().text_color(t.dim).child("EXECUTABLE"))
      .child(
        h_flex()
          .w_full()
          .h(30)
          .px(8)
          .rounded(6)
          .border_1()
          .border_color(t.input)
          .bg(t.surface)
          .child(
            Input.new(editor.command)
              .w_full()
              .font_family(mono)
              .text_size(12)
              .text_color(t.foreground)
              .bg("#00000000"),
          ),
      )
      .on_key_down((event, cx) => {
        if (event.key !== "escape") return;
        cx.stop_propagation();
        this.typing = false;
        this.cancelEdit(row, cx);
        this.handle.focus();
      })
      .child(
        div()
          .text_size(11)
          .text_color(t.dim)
          .child("A name from PATH or an absolute path. Spaces are allowed; quotes are literal."),
      )
      .child(div().text_size(10).font_semibold().text_color(t.dim).child("LAUNCH ARGUMENTS"))
      .child(
        v_flex()
          .w_full()
          .h(76)
          .px(8)
          .py(6)
          .rounded(6)
          .border_1()
          .border_color(t.input)
          .bg(t.surface)
          .child(
            Textarea.new(editor.args)
              .size_full()
              .font_family(mono)
              .text_size(11)
              .text_color(t.foreground)
              .bg("#00000000"),
          ),
      )
      .on_key_down((event, cx) => {
        if (event.keystroke === "cmd-enter" || event.keystroke === "ctrl-enter") {
          cx.stop_propagation();
          this.typing = false;
          this.save(row, cx);
        } else if (event.key === "escape") {
          cx.stop_propagation();
          this.typing = false;
          this.cancelEdit(row, cx);
          this.handle.focus();
        }
      })
      .child(div().text_size(11).text_color(t.dim).child("One argument per line; spaces, quotes and backslashes stay literal. Blank lines are ignored."))
      .child(
        div()
          .min_w(0)
          .truncate()
          .font_family(mono)
          .text_size(11)
          .text_color(preview ? t.muted : draft.error ? t.blocked : t.dim)
          .child(preview ? `Runs: ${preview}` : draft.error ?? "Runs: (nothing yet)"),
      )
      .when(row.customized && row.builtin, (el) =>
        el.child(
          h_flex()
            .gap(6)
            .items_center()
            .child(div().font_family(mono).text_size(11).text_color(t.dim).child(`Default: ${formatArgv(row.defaultCmd)}`))
            .child(
              this.button(`am-reset-${row.key}`, "Reset to default", t, (_event, cx) => this.reset(row, cx), {
                height: 24,
                px: 8,
                color: t.muted,
              }),
            ),
        ),
      )
      .when(row.customized && !row.builtin, (el) =>
        el.child(div().text_size(11).text_color(t.dim).child("This agent was added in programs.json; there is no built-in command to reset to.")),
      )
      .when(row.entryError, (el) => el.child(div().text_size(11).text_color(t.blocked).child(row.entryError)))
      .when(editor.error, (el) => el.child(div().text_size(11).text_color(t.blocked).child(editor.error)))
      .when(this.writeError && editor.conflict, (el) => el.child(div().text_size(11).text_color(t.blocked).child(this.writeError)))
      .child(
        h_flex()
          .w_full()
          .flex_wrap()
          .gap(8)
          .items_center()
          .justify_end()
          .when(this.savedKey === row.key, (el) =>
            el.child(div().text_size(11).text_color(t.done).child("Saved · commands re-checked")),
          )
          .child(
            this.button(`am-cancel-${row.key}`, "Cancel", t, (_event, cx) => this.cancelEdit(row, cx), {
              height: 26,
              px: 10,
              color: t.muted,
            }),
          )
          .child(
            this.button(`am-save-${row.key}`, saveLabel, t, (_event, cx) => this.save(row, cx), {
              height: 26,
              px: 12,
              primary: true,
              disabled: !dirty && !editor.conflict,
            }),
          ),
      );
  }

  banner(text, t, options = {}) {
    return h_flex()
      .w_full()
      .gap(8)
      .p(10)
      .rounded(8)
      .border_1()
      .border_color(options.border ?? t.blocked)
      .bg(options.bg ?? "#ef444414")
      .items_start()
      .child(div().flex_none().text_size(12).text_color(options.color ?? t.blocked).child("!"))
      .child(v_flex().flex_1().min_w(0).gap(4).child(div().text_size(12).text_color(options.color ?? t.blocked).child(text)).when(options.actions, (el) => el.child(options.actions)));
  }

  empty(text, t) {
    return div()
      .w_full()
      .p(16)
      .rounded(8)
      .border_1()
      .border_color(t.border)
      .border_dashed()
      .text_size(12)
      .text_color(t.muted)
      .child(text);
  }

  render(cx) {
    const t = theme();
    const split = this.allRows();
    const rows = split.all;
    const loading = this.loading && !this.agents;
    const width = this.width || 800;
    const contentPad = width < 520 ? 12 : 24;

    const refreshButton = h_flex()
      .id("am-refresh")
      .h(30)
      .px(10)
      .gap(6)
      .flex_none()
      .items_center()
      .rounded(6)
      .border_1()
      .border_color(t.border)
      .bg("#00000000")
      .text_size(12)
      .font_medium()
      .text_color(this.refreshing ? t.dim : t.foreground)
      .when(!this.refreshing, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_event, cx) => this.refresh(cx)))
      .role("button")
      .accessibility_label(this.refreshing ? "Refreshing agents" : "Refresh installed agents")
      .tooltip("Re-check every agent on this computer")
      .child(
        this.refreshing
          ? div().flex_none().text_size(12).text_color(t.muted).frames(["◐", "◓", "◑", "◒"], 120)
          : svg("mods/orca-agent-manager/refresh-cw.svg").size(13).flex_none().text_color(t.muted),
      )
      .child(this.refreshing ? "Refreshing…" : "Refresh");

    const conflictActions =
      this.externalConflict && this.anyDirty()
        ? h_flex()
            .gap(8)
            .child(
              this.button("am-reload-all", "Reload from disk", t, (_event, cx) => {
                if (this.pendingProgramsText !== undefined) this.applyPrograms(this.pendingProgramsText);
                this.pendingProgramsText = undefined;
                this.externalConflict = false;
                for (const [key, editor] of this.editors) {
                  editor.dirty = false;
                  editor.conflict = false;
                  editor.force = false;
                  editor.error = null;
                  const row = rows.find((candidate) => candidate.key === key);
                  if (row) {
                    editor.command.set_value(row.run[0] ?? "");
                    editor.args.set_value(argsToText(row.run.slice(1)));
                  }
                }
                this.writeError = null;
                this.syncEditors();
                cx.notify();
              }, { height: 24, px: 8 }),
            )
            .child(
              this.button("am-conflict-dismiss", "Dismiss", t, (_event, cx) => {
                this.externalConflict = false;
                cx.notify();
              }, { height: 24, px: 8, color: t.muted }),
            )
        : null;

    return v_flex()
      .id("am-root")
      .track_focus(this.handle)
      .size_full()
      .min_h(0)
      .bg(t.background)
      .text_size(12)
      .on_key_down((event, cx) => this.onKey(event, cx))
      .on_size_change((size, cx) => {
        if (this.width !== size.width) {
          this.width = size.width;
          cx.notify();
        }
      })
      .child(
        div()
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .child(
            v_flex()
              .w_full()
              .max_w(760)
              .mx_auto()
              .px(contentPad)
              .py(20)
              .gap(2)
              .child(
                h_flex()
                  .w_full()
                  .items_center()
                  .gap(8)
                  .child(
                    div()
                      .id("am-back")
                      .size(28)
                      .flex_none()
                      .flex()
                      .items_center()
                      .justify_center()
                      .rounded(6)
                      .text_color(t.muted)
                      .cursor_pointer()
                      .hover((s) => s.bg(t.hover).text_color(t.foreground))
                      .role("button")
                      .accessibility_label("Back to terminals")
                      .tooltip("Back to terminals")
                      .on_click(() => {
                        this.typing = false;
                        // The main stack's terminals page is the way back to the work.
                        run("layout.select", { stack: "main", child: TERMINALS_PAGE });
                      })
                      .child(svg("mods/orca-agent-manager/chevron-left.svg").size(16)),
                  )
                  .child(div().text_size(20).font_semibold().text_color(t.foreground).child("Agents"))
                  .child(this.badge("This computer", t, { border: true }))
                  .child(div().flex_1())
                  .child(refreshButton),
              )
              .child(
                div()
                  .mt(4)
                  .text_size(12)
                  .line_height("18px")
                  .text_color(t.muted)
                  .child(
                    "Install status for the Agent CLIs Herdr can start. Uninstalled CLIs keep their switch unavailable; disabled installed agents stay installed but are hidden from the Start an agent menu. Edit a command when the CLI is outside PATH.",
                  ),
              )
              .when(this.managerError, (el) =>
                el.child(
                  this.banner(`agent-manager.json is invalid: ${this.managerError}`, t, {
                    actions: div().text_size(11).text_color(t.blocked).child("Availability toggles are paused until the file is fixed."),
                  }),
                ),
              )
              .when(this.programsError, (el) =>
                el.child(
                  this.banner(this.programsError, t, {
                    actions: div().text_size(11).text_color(t.blocked).child("Built-in commands are shown; editing is paused so valid JSON is not destroyed."),
                  }),
                ),
              )
              .when(this.detectionError, (el) =>
                el.child(
                  this.banner(this.detectionError, t, {
                    actions: h_flex()
                      .gap(8)
                      .child(
                        this.button("am-retry-detection", "Retry", t, (_event, cx) => this.refresh(cx), { height: 24, px: 8, color: t.blocked }),
                      ),
                  }),
                ),
              )
              .when(this.freshWarning, (el) =>
                el.child(
                  this.banner(this.freshWarning, t, {
                    border: t.blocked,
                    bg: "#f59e0b14",
                    color: t.blocked,
                  }),
                ),
              )
              .when(this.writeError && !rows.some((row) => this.editors.get(row.key)?.conflict), (el) =>
                el.child(this.banner(this.writeError, t)),
              )
              .when(conflictActions, (el) =>
                el.child(
                  this.banner("programs.json changed on disk while you were editing. Your draft is kept.", t, {
                    actions: conflictActions,
                  }),
                ),
              )
              .when(loading, (el) =>
                el.child(
                  h_flex()
                    .w_full()
                    .gap(8)
                    .p(16)
                    .rounded(8)
                    .border_1()
                    .border_color(t.border)
                    .border_dashed()
                    .items_center()
                    .child(div().flex_none().text_size(12).text_color(t.muted).frames(["◐", "◓", "◑", "◒"], 120))
                    .child(div().text_size(12).text_color(t.muted).child("Detecting installed agents…")),
                ),
              )
              .when(!loading, (el) =>
                el
                  .child(
                    this.section(
                      "Installed",
                      `${split.installed.length} detected`,
                      t,
                      this.fromCache ? "showing last known result" : null,
                    ),
                  )
                  .when(split.installed.length === 0, (inner) =>
                    inner.child(this.empty("No agents detected. If one is installed, the probe may have timed out — try Refresh.", t)),
                  )
                  .children(split.installed.map((row) => this.row(row, t)))
                  .when(split.available.length > 0, (inner) =>
                    inner
                      .child(this.section("Available to install", `${split.available.length} agents`, t))
                      .children(split.available.map((row) => this.row(row, t))),
                  )
                  .when(split.available.length === 0 && split.installed.length > 0, (inner) =>
                    inner.child(this.section("Available to install", "0 agents", t, "every supported agent is installed")),
                  )
                  .child(
                    h_flex()
                      .w_full()
                      .pt(16)
                      .pb(4)
                      .gap(12)
                      .flex_wrap()
                      .items_center()
                      .child(div().text_size(11).text_color(t.dim).child(timeLabel(this.lastChecked)))
                      .child(div().flex_1())
                      .child(div().text_size(11).text_color(t.dim).child("↑↓ select · Enter edit · Space toggle installed · R refresh")),
                  ),
              ),
          ),
      );
  }
}
