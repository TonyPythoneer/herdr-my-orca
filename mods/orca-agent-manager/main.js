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
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, Link, ScrollHandle, Scrollbar } from "gpui-base";
import { appHome, checking, exec, knownAgents, props, readTextFile, run, setShared, terminals, theme, settings, writeTextFile } from "herdr";
import {
  LIST_ROW_HEIGHT,
  applyFreshInstalled,
  argsEditable,
  argsToText,
  checkArgs,
  checkCommands,
  commandCheckScript,
  commandPathScript,
  defaultRun,
  draftRun,
  formatArgv,
  homepageFor,
  isBuiltinAgent,
  listViewportHeight,
  parseCommandCheck,
  parseCommandPath,
  parseManagerConfig,
  programsTextError,
  programsUpdate,
  readRunOverride,
  serializeManagerConfig,
  splitInventory,
  writeRunOverride,
} from "./state.js";
import {
  activeSessions,
  installMethodFor,
  npmManaged,
  uninstallCommand,
} from "./install.js";
import { errorText, sameRun, tail, timeLabel } from "./util.js";
import { badge, banner, empty, icon, section } from "./parts.js";

const PROGRAMS = `${appHome()}/programs.json`;
const MANAGER = `${appHome()}/agent-manager.json`;
const CACHE_KEY = "agent-manager.inventory.v1";
const TERMINALS_PAGE = "main-terminals";
const POLL_MS = 4000;

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
    this.installedScroll = ScrollHandle.new();
    this.availableScroll = ScrollHandle.new();
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
    this.refreshGen = 0;
    this.action = null; // { key, kind, phase, message }
    this.uninstall = null; // { key, phase, status, message }

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
    // FreeBuff is an unofficial integration, not part of the official Settings catalog. Its
    // configured row, if any, stays in programs.json and is used by the Start menu.
    const seen = new Set();
    const base = (this.agents ?? [])
      .filter((agent) => {
        if (!isBuiltinAgent(agent.key) || seen.has(agent.key)) return false;
        seen.add(agent.key);
        return true;
      })
      .map((agent) => ({ ...agent, ...this.rowInfo(agent) }));
    const split = splitInventory(base, this.disabled);
    return { ...split, all: [...split.installed, ...split.available] };
  }

  refresh(cx) {
    if (this.refreshing) return;
    this.refreshing = true;
    this.detectionError = null;
    this.freshWarning = null;
    this.writeError = null;
    const gen = ++this.refreshGen;
    cx.spawn(async (cx) => {
      try {
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
        if (gen !== this.refreshGen) return;

        // A refresh must not replace the snapshot a dirty draft was based on. It becomes a
        // conflict instead; only Reload or the explicit Overwrite action may move the base.
        const update = programsUpdate(this.programsText, programs, this.anyDirty());
        if (update.kind === "apply") {
          this.applyPrograms(update.text);
          this.pendingProgramsText = undefined;
          this.externalConflict = false;
        } else if (update.kind === "conflict") {
          this.pendingProgramsText = update.text;
          this.externalConflict = true;
        }
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
        if (gen !== this.refreshGen) return;
        if (fresh) this.agents = applyFreshInstalled(this.agents, fresh);
        if (this.agents) this.cache();

        try {
          this.syncEditors();
        } catch {}
        if (!this.externalConflict) this.shareInventory();
      } finally {
        // A newer refresh owns the flag; never leave an older one stuck as refreshing.
        if (gen === this.refreshGen) {
          this.loading = false;
          this.refreshing = false;
          this.lastChecked = Date.now();
          cx.notify();
        }
      }
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
    // The effective command is the one the row would launch, not the cached knownAgents() run.
    const rows = this.allRows().all;
    const commands = checkCommands(rows);
    if (!commands.length) return null;
    const shell = await this.shellPath();
    const script = commandCheckScript(shell);
    const attempt = async (interactive) => {
      const result = await exec(shell, checkArgs(shell, script, commands, interactive), { timeout: 30000 });
      if (result.code !== 0) throw new Error(result.stderr.trim() || `${shell} exited ${result.code}`);
      const answers = parseCommandCheck(result.stdout, commands.length);
      return new Map(rows.map((row, index) => [row.key, answers[index]]));
    };
    try {
      return await attempt(true);
    } catch (first) {
      try {
        return await attempt(false);
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
      const update = programsUpdate(this.programsText, programs, this.anyDirty());
      if (update.kind === "apply") {
        this.applyPrograms(update.text);
        this.pendingProgramsText = undefined;
        this.externalConflict = false;
        this.writeError = null;
        this.syncEditors();
        changed = true;
        this.refresh(cx);
      } else if (update.kind === "conflict") {
        this.pendingProgramsText = update.text;
        this.externalConflict = true;
        changed = true;
      }
      if (this.applyManager(manager)) changed = true;
      if (changed) {
        if (!this.externalConflict) this.shareInventory();
        cx.notify();
      } else if (this.externalConflict) cx.notify();
    });
  }

  // The launch menus read this instead of trusting Herdr's minute-long detection cache.
  shareInventory() {
    if (!this.agents) return;
    try {
      setShared("agent-manager.inventory", {
        at: Date.now(),
        agents: this.allRows().all,
        disabled: [...this.disabled],
      });
    } catch {}
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
      editor.originalArgs = row.run.slice(1);
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
    const editor = {
      command,
      args,
      originalArgs: row.run.slice(1),
      dirty: false,
      error: null,
      conflict: false,
      force: false,
    };
    const changed = (_event, cx) => {
      const draft = draftRun(command.value(), args.value(), editor.originalArgs);
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
    editor.originalArgs = row.run.slice(1);
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
    const validated = draftRun(editor.command.value(), editor.args.value(), editor.originalArgs);
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
    editor.originalArgs = nextRun.slice(1);
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

  // ---- official CLI install / uninstall ------------------------------------

  // The executable path is resolved through the user's login shell, and npm is located the same
  // way. Every install/uninstall command is an argv array from install.js, never a shell string.
  async commandPath(command) {
    try {
      const shell = await this.shellPath();
      const result = await exec(shell, checkArgs(shell, commandPathScript(shell), [command], false), { timeout: 10000 });
      return result.code === 0 ? parseCommandPath(result.stdout) : null;
    } catch {
      return null;
    }
  }

  async realPath(path) {
    if (!path?.startsWith("/")) return null;
    const result = await exec("realpath", [path], { timeout: 5000 });
    return result.code === 0 ? parseCommandPath(result.stdout) : null;
  }

  async npmStatusFor(row) {
    const method = installMethodFor(row.key);
    if (!method) return { method: null, managed: false };
    const override = readRunOverride(await readTextFile(PROGRAMS), row.key);
    if (override.error) throw new Error(override.error);
    const executable = (override.run ?? row.defaultCmd ?? row.run)[0];
    const path = await this.commandPath(executable);
    if (!path) return { method, path: null, managed: false };
    const npm = await this.commandPath("npm");
    if (!npm) return { method, path, managed: false };
    const global = await exec(npm, ["root", "-g"], { timeout: 15000 });
    const [real, root] = await Promise.all([
      this.realPath(path),
      this.realPath(global.code === 0 ? global.stdout.trim() : null),
    ]);
    return { method, path, npm, root, real, managed: npmManaged(real, root, method.package) };
  }

  async recheckAgent(key) {
    const fresh = await this.freshInstallCheck();
    if (!fresh) throw new Error("There is no executable to check.");
    this.agents = applyFreshInstalled(this.agents, fresh);
    this.cache();
    this.lastChecked = Date.now();
    try {
      this.syncEditors();
    } catch {}
    this.shareInventory();
    const row = this.agents.find((agent) => agent.key === key);
    return Boolean(row?.installed);
  }

  requestUninstall(row, cx) {
    if (this.action?.phase === "running" || this.uninstall?.phase === "checking") return;
    this.uninstall = { key: row.key, phase: "checking", message: "" };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const running = activeSessions(terminals(), row.key, row.run);
        if (running.length) {
          this.uninstall = {
            key: row.key,
            phase: "error",
            message: `Close ${running.length} active ${row.name} session${running.length === 1 ? "" : "s"} first. Uninstalling while a session runs can break it.`,
          };
          return;
        }
        const status = await this.npmStatusFor(row);
        if (!status.method) {
          this.uninstall = { key: row.key, phase: "error", message: "No verified automatic uninstall is available for this CLI. Use its official install guide." };
          return;
        }
        if (!status.path) {
          this.uninstall = { key: row.key, phase: "error", message: "The executable is not on PATH, so the installation method cannot be verified. Use the official install guide to remove it." };
          return;
        }
        if (!status.managed) {
          this.uninstall = { key: row.key, phase: "error", message: "This executable does not belong to the expected npm package in the global root. Herdr will not guess at another uninstall method; use the official install guide." };
          return;
        }
        this.uninstall = {
          key: row.key,
          phase: "confirm",
          status,
          message: "",
        };
      } catch (error) {
        this.uninstall = { key: row.key, phase: "error", message: errorText(error) };
      } finally {
        cx.notify();
      }
    });
  }

  cancelUninstall(cx) {
    this.uninstall = null;
    cx.notify();
  }

  confirmUninstall(row, cx) {
    const request = this.uninstall;
    if (!request || request.key !== row.key || request.phase !== "confirm") return;
    if (this.action?.phase === "running") return;
    const running = activeSessions(terminals(), row.key, [request.status.path]);
    if (running.length) {
      this.uninstall = { ...request, phase: "error", message: "A session started while you were confirming. Close it before uninstalling." };
      cx.notify();
      return;
    }
    const command = uninstallCommand(request.status.method);
    if (!command) return;
    this.uninstall = { ...request, phase: "running" };
    this.action = { key: row.key, kind: "uninstall", phase: "running", message: `Uninstalling ${request.status.method.package}…` };
    cx.notify();
    cx.spawn(async (cx) => {
      let removed = false;
      try {
        const status = await this.npmStatusFor(row);
        const confirmed = request.status;
        if (!status.managed || status.path !== confirmed.path || status.real !== confirmed.real || status.npm !== confirmed.npm || status.root !== confirmed.root) {
          this.action = null;
          this.uninstall = { ...request, phase: "error", message: "The installation changed. Check it again before uninstalling." };
          return;
        }
        if (activeSessions(terminals(), row.key, [status.path]).length) {
          this.action = null;
          this.uninstall = { ...request, phase: "error", message: "A session started while you were confirming. Close it before uninstalling." };
          return;
        }
        const result = await exec(status.npm, command.args, { timeout: 10 * 60_000 });
        if (result.code !== 0) {
          const detail = tail(result.stderr || result.stdout);
          this.action = { key: row.key, kind: "uninstall", phase: "error", message: `npm exited ${result.code}${detail ? `: ${detail}` : "."}` };
          this.uninstall = { ...request, phase: "error", message: "The CLI was not removed." };
          return;
        }
        removed = true;
        const installed = await this.recheckAgent(row.key);
        if (installed) {
          this.action = { key: row.key, kind: "uninstall", phase: "warning", message: "npm finished, but the executable is still detected. It may have another copy on PATH." };
          this.uninstall = { ...request, phase: "error", message: "The executable is still detected." };
        } else {
          this.action = { key: row.key, kind: "uninstall", phase: "done", message: "Uninstalled. Its command override and settings were left untouched." };
          this.uninstall = null;
        }
      } catch (error) {
        const message = removed ? "npm finished, but the executable could not be rechecked." : "Could not complete the uninstall.";
        this.action = { key: row.key, kind: "uninstall", phase: removed ? "warning" : "error", message: `${message} ${errorText(error)}` };
        this.uninstall = { ...request, phase: "error", message };
      } finally {
        cx.notify();
      }
    });
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
      this.shareInventory();
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
    const split = this.allRows();
    const installedIndex = split.installed.findIndex((row) => row.key === this.focusKey);
    if (installedIndex >= 0) this.installedScroll.scroll_to_item(installedIndex);
    else {
      const availableIndex = split.available.findIndex((row) => row.key === this.focusKey);
      if (availableIndex >= 0) this.availableScroll.scroll_to_item(availableIndex);
    }
    this.handle.focus();
    cx.notify();
    return true;
  }

  // ---- drawing --------------------------------------------------------------

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
      .bg(on ? t.foreground : t.input)
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
          .child(div().size(16).rounded_full().bg(on ? t.background : t.muted)),
      );
  }

  catalog(rows, t, group) {
    const viewport = listViewportHeight(rows.length, rows.some((row) => this.expanded.has(row.key)));
    const id = `am-catalog-${group}`;
    const list = v_flex()
      .id(id)
      .track_scroll(group === "installed" ? this.installedScroll : this.availableScroll)
      .w_full()
      .pl(10)
      .pr(18)
      .when(viewport, (el) => el.absolute().inset_0().overflow_y_scroll())
      .children(rows.map((row, index) => this.row(row, t, index === rows.length - 1)));
    return div()
      .w_full()
      .flex_none()
      .relative()
      .rounded(10)
      .border_1()
      .border_color(t.border)
      .bg(t.surface)
      .overflow_hidden()
      .when(viewport, (el) => el.h(viewport))
      .child(list)
      .when(viewport, (el) => el.child(Scrollbar.vertical(id).absolute().inset_0()));
  }

  commandLine(row, t, quiet) {
    const mono = settings()?.font_family ?? "JetBrains Mono";
    const effective = formatArgv(row.run);
    if (!row.customized || !row.defaultCmd) {
      return div()
        .min_w(0)
        .truncate()
        .font_family(mono)
        .text_size(11)
        .text_color(t.muted)
        .when(quiet, (el) => el.opacity(0.45))
        .child(effective);
    }
    const fallback = div().min_w(0).truncate().font_family(mono).text_size(11).text_color(t.muted).child(effective);
    return h_flex()
      .min_w(0)
      .gap(6)
      .when(quiet, (el) => el.opacity(0.45))
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

  row(row, t, last = false) {
    const open = this.expanded.has(row.key);
    const editor = this.editors.get(row.key);
    const quiet = !row.enabled;
    return v_flex()
      .id(`am-row-${row.key}`)
      .relative()
      .w_full()
      .flex_none()
      .when(!last, (el) => el.border_b(1).border_color(t.border))
      .child(
        h_flex()
          .id(`am-row-highlight-${row.key}`)
          .w_full()
          .rounded(8)
          .hover((s) => s.bg(t.hover))
          .h(LIST_ROW_HEIGHT - 12)
          .my(6)
          .px(8)
          .min_w(0)
          .gap(12)
          .py(0)
          .items_center()
          .overflow_hidden()
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
              .child(icon(row, 18, t)),
          )
          .child(
            v_flex()
              .flex_1()
              .min_w(100)
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
                  .when(row.customized, (el) => el.child(badge("Customized", t, { color: t.accent, border: true })))
                  .when(row.entryError, (el) => el.child(badge("Invalid command", t, { color: t.blocked, border: true }))),
              )
              .child(this.commandLine(row, t, quiet)),
          )
          .child(
            h_flex()
              .ml_auto()
              .flex_none()
              .items_center()
              .gap(10)
              .child(this.toggle(row, t))
              .when(!row.installed && row.homepage, (el) =>
                el.child(
                  Link.new(`am-install-open-${row.key}`)
                    .href(row.homepage)
                    .tooltip(`Open ${row.name} installation guide`)
                    .child(
                      h_flex().h(24).px(8).flex_none().items_center().justify_center().rounded(6)
                        .border_1().border_color(t.border).text_size(12).font_medium()
                        .text_color(t.foreground).cursor_pointer().hover((style) => style.bg(t.hover))
                        .child("Install"),
                    ),
                ),
              )
              .when(!row.installed && !row.homepage, (el) =>
                el.child(div().text_size(11).text_color(t.dim).child("No install guide")),
              )
              .when(row.installed, (el) => el.child(
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
              )),
          ),
      )
      .when(open && editor, (el) => el.child(this.editor(row, editor, t)));
  }

  editor(row, editor, t) {
    const mono = settings()?.font_family ?? "JetBrains Mono";
    const unsafeArgs = !argsEditable(editor.originalArgs);
    const draft = draftRun(editor.command.value(), editor.args.value(), editor.originalArgs);
    const preview = draft.run ? formatArgv(draft.run) : "";
    const saveLabel = editor.conflict ? "Overwrite" : "Save";
    const dirty = draft.run ? !sameRun(draft.run, row.run) : true;
    return v_flex()
      .w_full()
      .pl(52)
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
      .when(!row.installed, (el) =>
        el.child(
          h_flex()
            .gap(6)
            .items_center()
            .flex_wrap()
            .child(div().text_size(11).text_color(t.dim).child("This CLI is not installed."))
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
          .bg(t.background)
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
      .when(unsafeArgs, (el) =>
        el.child(
          v_flex()
            .w_full()
            .gap(6)
            .p(8)
            .rounded(6)
            .border_1()
            .border_color(t.border)
            .bg(t.background)
            .child(
              div()
                .font_family(mono)
                .text_size(11)
                .text_color(t.muted)
                .child(formatArgv(editor.originalArgs) || "No arguments"),
            )
            .child(
              div()
                .text_size(11)
                .text_color(t.dim)
                .child(
                  "These arguments contain an empty or multi-line value, which this line editor cannot change without losing data. Only the executable is editable here; edit programs.json to change the arguments.",
                ),
            ),
        ),
      )
      .when(!unsafeArgs, (el) =>
        el.child(
          v_flex()
            .w_full()
            .h(76)
            .px(8)
            .py(6)
            .rounded(6)
            .border_1()
            .border_color(t.input)
            .bg(t.background)
            .child(
              Textarea.new(editor.args)
                .size_full()
                .font_family(mono)
                .text_size(11)
                .text_color(t.foreground)
                .bg("#00000000"),
            ),
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
      .when(!unsafeArgs, (el) =>
        el.child(div().text_size(11).text_color(t.dim).child("One argument per line; spaces, quotes and backslashes stay literal. Blank lines are ignored.")),
      )
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
      )
      .when(row.installed, (el) => el.child(this.uninstallSection(row, t)));
  }

  uninstallSection(row, t) {
    const request = this.uninstall?.key === row.key ? this.uninstall : null;
    const method = installMethodFor(row.key);
    const action = this.action?.key === row.key && this.action.kind === "uninstall" ? this.action : null;
    return v_flex()
      .w_full()
      .gap(6)
      .pt(12)
      .mt(4)
      .border_t(1)
      .border_color(t.border)
      .child(div().text_size(10).font_semibold().text_color(t.dim).child("UNINSTALL"))
      .when(!method, (el) =>
        el
          .child(div().text_size(11).text_color(t.muted).child("No verified automatic uninstall is defined for this CLI. Use its official install guide to remove it."))
          .when(row.homepage, (inner) =>
            inner.child(
              Link.new(`am-uninstall-guide-${row.key}`)
                .href(row.homepage)
                .text_size(11)
                .text_color(t.accent)
                .underline()
                .tooltip(row.homepage)
                .child("Official guide ↗"),
            ),
          ),
      )
      .when(Boolean(method) && (!request || request.phase === "error"), (el) =>
        el.child(
          h_flex()
            .gap(8)
            .items_center()
            .child(
              this.button(`am-uninstall-${row.key}`, "Uninstall…", t, (_event, cx) => this.requestUninstall(row, cx), {
                height: 26,
                px: 10,
                color: t.blocked,
                disabled: this.action?.phase === "running" || this.uninstall?.phase === "checking",
              }),
            )
            .when(row.homepage, (inner) =>
              inner.child(
                Link.new(`am-uninstall-guide-${row.key}`)
                  .href(row.homepage)
                  .text_size(11)
                  .text_color(t.accent)
                  .underline()
                  .tooltip(row.homepage)
                  .child("Official guide ↗"),
              ),
            ),
        ),
      )
      .when(request?.phase === "confirm", (el) =>
        el.child(
          v_flex()
            .gap(8)
            .p(10)
            .rounded(8)
            .border_1()
            .border_color(t.blocked)
            .bg("#ef444414")
            .child(
              div()
                .text_size(11)
                .text_color(t.blocked)
                .child(`Remove ${row.name}? This runs npm uninstall -g ${request.status.method.package}. It does not delete settings, sessions, or your command override.`),
            )
            .child(
              h_flex()
                .gap(8)
                .child(this.button(`am-uninstall-cancel-${row.key}`, "Cancel", t, (_event, cx) => this.cancelUninstall(cx), { height: 24, px: 8, color: t.muted }))
                .child(this.button(`am-uninstall-confirm-${row.key}`, "Confirm uninstall", t, (_event, cx) => this.confirmUninstall(row, cx), { height: 24, px: 8, color: t.blocked })),
            ),
        ),
      )
      .when(request?.phase === "checking" || request?.phase === "running", (el) =>
        el.child(
          h_flex()
            .gap(6)
            .items_center()
            .child(div().text_size(11).text_color(t.accent).frames(["◐", "◓", "◑", "◒"], 120))
            .child(div().text_size(11).text_color(t.muted).child(request.phase === "checking" ? "Checking the installation method…" : "Uninstalling…")),
        ),
      )
      .when(request?.phase === "error", (el) => el.child(div().text_size(11).text_color(t.blocked).child(request.message)))
      .when(Boolean(action) && action.phase !== "running", (el) =>
        el.child(div().text_size(11).text_color(action.phase === "done" ? t.muted : t.blocked).child(action.message)),
      );
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

    const header = v_flex()
      .w_full()
      .max_w(760)
      .mx_auto()
      .px(contentPad)
      .pt(20)
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
          .child(badge("This computer", t, { border: true }))
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
            "Install status for the Agent CLIs Herdr can start. Uninstalled CLIs keep their switch unavailable; disabled installed agents stay installed but are hidden from the Start an agent menu. Install, uninstall, or edit a command when the CLI is outside PATH.",
          ),
      )
      .when(this.managerError, (el) =>
        el.child(
          banner(`agent-manager.json is invalid: ${this.managerError}`, t, {
            actions: div().text_size(11).text_color(t.blocked).child("Availability toggles are paused until the file is fixed."),
          }),
        ),
      )
      .when(this.programsError, (el) =>
        el.child(
          banner(this.programsError, t, {
            actions: div().text_size(11).text_color(t.blocked).child("Built-in commands are shown; editing is paused so valid JSON is not destroyed."),
          }),
        ),
      )
      .when(this.detectionError, (el) =>
        el.child(
          banner(this.detectionError, t, {
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
          banner(this.freshWarning, t, {
            border: t.blocked,
            bg: "#f59e0b14",
            color: t.blocked,
          }),
        ),
      )
      .when(this.writeError && !rows.some((row) => this.editors.get(row.key)?.conflict), (el) =>
        el.child(banner(this.writeError, t)),
      )
      .when(conflictActions, (el) =>
        el.child(
          banner("programs.json changed on disk while you were editing. Your draft is kept.", t, {
            actions: conflictActions,
          }),
        ),
      );

    const sectionBody = v_flex()
      .w_full()
      .max_w(760)
      .mx_auto()
      .px(contentPad)
      .pb(20)
      .gap(2)
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
            section(
              "Installed",
              `${split.installed.length} detected`,
              t,
              this.fromCache ? "showing last known result" : null,
            ),
          )
          .when(split.installed.length === 0, (inner) =>
            inner.child(empty("No agents detected. If one is installed, the probe may have timed out — try Refresh.", t)),
          )
          .when(split.installed.length > 0, (inner) => inner.child(this.catalog(split.installed, t, "installed")))
          .when(split.available.length > 0, (inner) =>
            inner
              .child(section("Available to install", `${split.available.length} agents`, t, null, true))
              .child(this.catalog(split.available, t, "available")),
          )
          .when(split.available.length === 0 && split.installed.length > 0, (inner) =>
            inner.child(section("Available to install", "0 agents", t, "every supported agent is installed", true)),
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
      );

    return v_flex()
      .id("am-root")
      .track_focus(this.handle)
      .size_full()
      .min_h(0)
      .overflow_hidden()
      .bg(t.background)
      .text_size(12)
      .on_key_down((event, cx) => this.onKey(event, cx))
      .on_size_change((size, cx) => {
        if (this.width !== size.width) {
          this.width = size.width;
          cx.notify();
        }
      })
      .child(header.flex_none())
      .child(
        v_flex()
          .id("am-list")
          .w_full()
          .min_h(0)
          .overflow_y_scrollbar()
          .flex_1()
          .child(sectionBody),
      );
  }
}
