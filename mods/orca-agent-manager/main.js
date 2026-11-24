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
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, TextareaState, ScrollHandle, Scrollbar } from "gpui-base";
import { appHome, checking, exec, knownAgents, props, readTextFile, run, setShared, terminals, theme, writeTextFile } from "herdr";
import {
  LIST_ROW_HEIGHT,
  applyFreshInstalled,
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
  writeRunOverrides,
} from "./state.js";
import {
  PERMISSION_LABELS,
  permissionChoices,
  readPermission,
  reconcilePermissions,
  supportsPermissions,
  withPermission,
} from "./permissions.js";
import { defaultPermissionNotice, planDefaultPermission } from "./permission-plan.js";
import {
  activeSessions,
  installMethodFor,
  npmManaged,
  uninstallCommand,
} from "./install.js";
import { errorText, sameRun, tail } from "./util.js";
import { icon, monoFont } from "./parts.js";
import { agentsPageView, permissionsCardView } from "./page-view.js";
import { modelProvidersView, providerCardView, providersPageView } from "./provider-view.js";
import { rowView, editorView, uninstallSectionView } from "./views.js";
import { agentPermissionItems, defaultPermissionItems } from "./permission-menu.js";
import { PROVIDER_FILE, judgeModels, linkInfo, parseProviderFile, recordLink, serializeProviderFile, slugId, validateHost } from "./codex-provider.js";

const PROGRAMS = `${appHome()}/programs.json`;
const MANAGER = `${appHome()}/agent-manager.json`;
// The provider record holds the API key, so the file is 0600 and the icon lives beside it.
const PROVIDERS = `${appHome()}/${PROVIDER_FILE}`;
const ICON_DIR = "provider-icons";
// Only a file this page wrote inside its own icon folder may be kept in a record and deleted.
// Directly inside the icon folder: a `..` or a deeper path is not ours.
const ownedIcon = (path) => {
  const prefix = `${appHome()}/${ICON_DIR}/`;
  const rest = String(path ?? "").slice(prefix.length);
  return String(path ?? "").startsWith(prefix) && rest !== "" && !rest.includes("/") && rest !== ".." ? path : null;
};
// A missing or unreadable file reads as `undefined`, which the page treats as "not read yet".
const readFile = (path) => readTextFile(path).catch(() => undefined);
// How many leading bytes of a download are compared with the image signatures below.
const MAGIC_PROBE_BYTES = 8;
// A leftover icon file is harmless, so a failed `rm` must never fail the save, delete or cancel around it.
const removeFile = (path) => exec("rm", ["-f", path]).catch(() => {});
// GitHub avatars are a few KB; anything past this is not one.
const ICON_MAX_BYTES = 256 * 1024;
// A site serves whatever it likes at its icon URL, so the magic bytes are checked for a real image
// (PNG, JPEG or .ico) instead of trusting the URL or the status.
const ICO_MAGIC = "00000100";
const IMAGE_MAGIC = ["89504e47", "ffd8ff", ICO_MAGIC];
const CACHE_KEY = "agent-manager.inventory.v1";
const TERMINALS_PAGE = "main-terminals";
const POLL_MS = 4000;
// How long each outside program may run before the page gives up on it.
const SHELL_PROBE_MS = 5000;
const INSTALL_CHECK_MS = 30000;
const COMMAND_PATH_MS = 10000;
const REAL_PATH_MS = 5000;
const NPM_ROOT_MS = 15000;
const UNINSTALL_MS = 10 * 60_000;
// curl asks for five seconds; the exec timeout is the same five seconds in milliseconds.
const CURL_MAX_SECONDS = 5;
const CURL_TIMEOUT_MS = CURL_MAX_SECONDS * 1000;
const SAVED_NOTICE_MS = 2200;
const PERMISSION_NOTICE_MS = 6000;
// What must match between the confirmed install and the one found again before npm runs.
const INSTALL_IDENTITY = ["path", "real", "npm", "root"];
const SESSION_STARTED_MESSAGE = "A session started while you were confirming. Close it before uninstalling.";

// Where each moving key puts the focus, from the focused index `at` (-1: none) in a list of `count`.
const ROW_MOVES = {
  down: (at, count) => (at + 1) % count,
  up: (at, count) => (at <= 0 ? count - 1 : at - 1),
  home: () => 0,
  end: (_at, count) => count - 1,
};

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
    // Permission intent lives here; programs.json's `run` is what launchers read, so every change
    // is written into it. `overrides` is re-derived from the commands on every read (run wins).
    this.permissions = { default: "own", overrides: {} };
    this.permissionOpen = null;
    this.permissionNotice = null;
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
    // Model providers (their own page): the saved records and one card for each, see makeCard.
    this.providers = {};
    this.providersError = null;
    this.cards = new Map();
    this.adding = null; // the card for a provider being added
    this.providerText = undefined; // model-providers.json as read, so a write can replace it safely
    this.providerWrittenAt = 0; // when this page last wrote it, so a slower refresh cannot roll it back

    // Deep link: a tab or overlay can open the page with one agent's editor showing
    // (`tab.new {mod: "orca-agent-manager", props: {expand: "claude"}}`).
    const expand = props()?.expand;
    if (typeof expand === "string") this.expanded.add(expand);

    // The Model providers page is the same mod with `props.page`: only the provider card, no detection.
    this.providersPage = props()?.page === "providers";
    if (this.providersPage) {
      if (!checking()) {
        cx.spawn(async (taskCx) => {
          this.applyProviders(await readFile(PROVIDERS));
          taskCx.notify();
        });
      }
      return;
    }
    this.restoreCache();
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(POLL_MS, (tickCx) => this.poll(tickCx));
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
    } catch {
      // An unreadable or missing cache only means the first paint waits for the real probe.
    }
  }

  cache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(this.agents ?? []));
    } catch {
      // Storage can be blocked or full; the cache is an optimisation, never needed for correctness.
    }
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
    if (!parsed.error) {
      this.disabled = parsed.disabled;
      this.permissions = parsed.permissions;
    }
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
    // KnownAgents' `run` is the effective command, but it is cached for up to a minute, so after
    // programs.json drops an override it can still carry the old one. The built-in default is
    // the canonical fallback once the file has been read; before that, Herdr's answer is all
    // there is (and it avoids showing the default for a user override on the first paint).
    const effectiveRun = override ?? (loaded ? builtin ?? agent.run : agent.run);
    const supports = supportsPermissions(agent.key);
    return {
      override,
      customized: override !== null,
      run: effectiveRun,
      defaultCmd: builtin,
      builtin: isBuiltinAgent(agent.key),
      homepage: homepageFor(agent.key),
      entryError: this.programsError || !loaded ? null : parsed.error ?? null,
      supports,
      permission: supports ? readPermission(agent.key, effectiveRun) : "own",
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
    const all = [...split.installed, ...split.available];
    // A command that disagrees with the stored default is that agent's own permission. A broken
    // programs.json cannot be trusted for this, so it keeps the stored state instead.
    const overrides = this.programsError ? this.permissions.overrides : reconcilePermissions(all, this.permissions);
    const annotate = (row) => ({
      ...row,
      permissionOverride: Object.prototype.hasOwnProperty.call(overrides, row.key),
    });
    return {
      installed: split.installed.map(annotate),
      available: split.available.map(annotate),
      all: all.map(annotate),
    };
  }

  /** The stored default plus the overrides the commands actually show. */
  currentPermissions() {
    if (this.programsError) return { default: this.permissions.default, overrides: this.permissions.overrides };
    return { default: this.permissions.default, overrides: reconcilePermissions(this.allRows().all, this.permissions) };
  }

  refresh(cx) {
    if (this.refreshing) return;
    this.refreshing = true;
    this.detectionError = null;
    this.freshWarning = null;
    this.writeError = null;
    const gen = ++this.refreshGen;
    cx.spawn((taskCx) => this.runRefresh(taskCx, gen));
  }

  async runRefresh(cx, gen) {
    try {
      const disk = await this.readDisk();
      if (gen !== this.refreshGen) return;
      this.applyDiskRead(disk);
      const fresh = await this.probeFresh();
      if (gen !== this.refreshGen) return;
      if (fresh) {
        this.agents = applyFreshInstalled(this.agents, fresh);
        this.freebuffInstalled = fresh.get("freebuff");
      }
      if (this.agents) this.cache();
      this.syncEditorsSafely();
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
  }

  // Herdr's agent list and both files, read together; `failure` is why the list is missing.
  async readDisk() {
    const disk = { known: null, failure: null, programs: undefined, manager: undefined };
    try {
      [disk.known, disk.programs, disk.manager] = await Promise.all([
        knownAgents().catch((error) => {
          disk.failure = error;
          return null;
        }),
        readFile(PROGRAMS),
        readFile(MANAGER),
      ]);
    } catch (error) {
      disk.failure = error;
    }
    return disk;
  }

  applyDiskRead({ known, failure, programs, manager }) {
    // A refresh must not replace the snapshot a dirty draft was based on. It becomes a
    // conflict instead; only Reload or the explicit Overwrite action may move the base.
    // Files read while a permission pick is still being written are older than that pick.
    if (!this.persisting) {
      this.adoptProgramsUpdate(programsUpdate(this.programsText, programs, this.anyDirty()));
      this.applyManager(manager);
    }
    if (known) {
      this.agents = known;
      this.fromCache = false;
      this.cache();
    }
    if (failure) this.detectionError = `Could not detect installed agents: ${errorText(failure)}`;
    if (failure && !this.agents) this.loading = false;
  }

  // The fresh `command -v` answers, or null (with a warning) when the probe fails.
  async probeFresh() {
    if (!this.agents?.length) return null;
    try {
      const fresh = await this.freshInstallCheck();
      this.freshWarning = null;
      return fresh;
    } catch (error) {
      this.freshWarning = `Fresh install check failed (${errorText(error)}); showing Herdr's cached answer.`;
      return null;
    }
  }

  // An outside programs.json change either replaces the page's text or, under a dirty draft, waits.
  adoptProgramsUpdate(update) {
    if (update.kind === "apply") {
      this.applyPrograms(update.text);
      this.pendingProgramsText = undefined;
      this.externalConflict = false;
    } else if (update.kind === "conflict") {
      this.pendingProgramsText = update.text;
      this.externalConflict = true;
    }
  }

  async shellPath() {
    if (this.shell) return this.shell;
    try {
      const result = await exec("/bin/sh", ["-c", 'printf %s "${SHELL:-/bin/sh}"'], { timeout: SHELL_PROBE_MS });
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
    const commands = [...checkCommands(rows), "freebuff"]; // freebuff: unofficial, probed with the rest
    if (rows.length === 0) return null;
    const shell = await this.shellPath();
    const script = commandCheckScript(shell);
    const attempt = async (interactive) => {
      const result = await exec(shell, checkArgs(shell, script, commands, interactive), { timeout: INSTALL_CHECK_MS });
      if (result.code !== 0) throw new Error(result.stderr.trim() || `${shell} exited ${result.code}`);
      const answers = parseCommandCheck(result.stdout, commands.length);
      return new Map([...rows.map((row, index) => [row.key, answers[index]]), ["freebuff", answers[rows.length]]]);
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
    if (this.refreshing || this.persisting) return;
    cx.spawn((taskCx) => this.readOutsideChanges(taskCx));
  }

  async readOutsideChanges(cx) {
    const programs = await readFile(PROGRAMS);
    const manager = await readFile(MANAGER);
    // A pick made while the files were being read is newer than what was read.
    if (this.persisting) return;
    const update = programsUpdate(this.programsText, programs, this.anyDirty());
    this.adoptProgramsUpdate(update);
    if (update.kind === "apply") {
      this.writeError = null;
      this.syncEditors();
      this.refresh(cx);
    }
    const managerChanged = this.applyManager(manager);
    const changed = update.kind !== "none" || managerChanged;
    if (changed && !this.externalConflict) this.shareInventory();
    if (changed || this.externalConflict) cx.notify();
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
    } catch {
      // The launch menus fall back to Herdr's own detection when the shared value cannot be set.
    }
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
      this.loadEditorRun(editor, row.run);
      editor.error = null;
      editor.conflict = false;
    }
  }

  // Puts a command into an editor's inputs, and its arguments become what the draft is compared with.
  loadEditorRun(editor, command) {
    editor.originalArgs = command.slice(1);
    editor.command.set_value(command[0] ?? "");
    editor.args.set_value(argsToText(command.slice(1)));
  }

  // An editor input that fails to update must not break the refresh or the install check around it.
  syncEditorsSafely() {
    try {
      this.syncEditors();
    } catch {
      // The next sync retries it.
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
    const changed = (_event, eventCx) => {
      const draft = draftRun(command.value(), args.value(), editor.originalArgs);
      const current = this.agents?.find((candidate) => candidate.key === row.key);
      const effective = current ? this.rowInfo(current).run : row.run;
      editor.dirty = Boolean(draft.error) || !sameRun(draft.run ?? [], effective);
      editor.error = null;
      eventCx.notify();
    };
    command.on("change", changed);
    args.on("change", changed);
    command.on("submit", (_event, eventCx) => this.save(row, eventCx));
    const typing = (_event, eventCx) => {
      this.typing = true;
      eventCx.notify();
    };
    const stopped = (_event, eventCx) => {
      this.typing = false;
      eventCx.notify();
    };
    command.on("focus", typing);
    command.on("blur", stopped);
    args.on("focus", typing);
    args.on("blur", stopped);
    this.editors.set(row.key, editor);
    return editor;
  }

  toggleExpand(row, cx) {
    this.permissionOpen = null;
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
    this.loadEditorRun(editor, row.run);
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

  // Reload from disk with every draft dropped. `rows` is what the page showed when the button was drawn.
  reloadAllFromDisk(rows, cx) {
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

  async writeRun(row, newRun, cx) {
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
    const written = writeRunOverride(base, row.key, newRun);
    if (written.error) {
      editor.error = written.error;
      cx.notify();
      return;
    }
    try {
      await writeTextFile(PROGRAMS, written.text, base ?? null);
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

    this.loadEditorRun(editor, newRun ?? defaultRun(row.key) ?? row.run);
    this.savedKey = row.key;
    cx.timer.after(SAVED_NOTICE_MS, () => {
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
      const result = await exec(shell, checkArgs(shell, commandPathScript(shell), [command], false), { timeout: COMMAND_PATH_MS });
      return result.code === 0 ? parseCommandPath(result.stdout) : null;
    } catch {
      return null;
    }
  }

  async realPath(path) {
    if (!path?.startsWith("/")) return null;
    const result = await exec("realpath", [path], { timeout: REAL_PATH_MS });
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
    const global = await exec(npm, ["root", "-g"], { timeout: NPM_ROOT_MS });
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
    this.syncEditorsSafely();
    this.shareInventory();
    const row = this.agents.find((agent) => agent.key === key);
    return Boolean(row?.installed);
  }

  requestUninstall(row, cx) {
    if (this.action?.phase === "running" || this.uninstall?.phase === "checking") return;
    this.uninstall = { key: row.key, phase: "checking", message: "" };
    cx.notify();
    cx.spawn(async (taskCx) => {
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
        taskCx.notify();
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
    if (activeSessions(terminals(), row.key, [request.status.path]).length) {
      this.uninstall = { ...request, phase: "error", message: SESSION_STARTED_MESSAGE };
      cx.notify();
      return;
    }
    const command = uninstallCommand(request.status.method);
    if (!command) return;
    this.uninstall = { ...request, phase: "running" };
    this.setUninstallAction(row, "running", `Uninstalling ${request.status.method.package}…`);
    cx.notify();
    cx.spawn((taskCx) => this.runUninstall(row, request, command, taskCx));
  }

  setUninstallAction(row, phase, message) {
    this.action = { key: row.key, kind: "uninstall", phase, message };
  }

  // The npm run itself: the install is looked at again right before it, and again after it.
  async runUninstall(row, request, command, cx) {
    let removed = false;
    try {
      const status = await this.npmStatusFor(row);
      const stale = this.staleUninstallMessage(row, request, status);
      if (stale) {
        this.action = null;
        this.uninstall = { ...request, phase: "error", message: stale };
        return;
      }
      const result = await exec(status.npm, command.args, { timeout: UNINSTALL_MS });
      if (result.code !== 0) {
        const detail = tail(result.stderr || result.stdout);
        this.setUninstallAction(row, "error", `npm exited ${result.code}${detail ? `: ${detail}` : "."}`);
        this.uninstall = { ...request, phase: "error", message: "The CLI was not removed." };
        return;
      }
      removed = true;
      this.finishUninstall(row, request, await this.recheckAgent(row.key));
    } catch (error) {
      const message = removed ? "npm finished, but the executable could not be rechecked." : "Could not complete the uninstall.";
      this.setUninstallAction(row, removed ? "warning" : "error", `${message} ${errorText(error)}`);
      this.uninstall = { ...request, phase: "error", message };
    } finally {
      cx.notify();
    }
  }

  // Why the confirmed install can no longer be removed, or null when it is still the one confirmed.
  staleUninstallMessage(row, request, status) {
    const confirmed = request.status;
    if (!status.managed || INSTALL_IDENTITY.some((field) => status[field] !== confirmed[field])) {
      return "The installation changed. Check it again before uninstalling.";
    }
    if (activeSessions(terminals(), row.key, [status.path]).length) return SESSION_STARTED_MESSAGE;
    return null;
  }

  finishUninstall(row, request, stillInstalled) {
    if (stillInstalled) {
      this.setUninstallAction(row, "warning", "npm finished, but the executable is still detected. It may have another copy on PATH.");
      this.uninstall = { ...request, phase: "error", message: "The executable is still detected." };
    } else {
      this.setUninstallAction(row, "done", "Uninstalled. Its command override and settings were left untouched.");
      this.uninstall = null;
    }
  }

  toggleEnabled(row, cx) {
    // An uninstalled CLI has no availability to change; its switch is locked until it is installed.
    if (!row.installed) return;
    if (this.managerError) return;
    cx.spawn(async (taskCx) => {
      const latest = await readTextFile(MANAGER).catch(() => this.managerText);
      const base = latest === undefined ? this.managerText : latest;
      const parsed = parseManagerConfig(base);
      if (parsed.error) {
        this.managerError = parsed.error;
        taskCx.notify();
        return;
      }
      const next = new Set(parsed.disabled);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      const text = serializeManagerConfig(next, this.permissions);
      try {
        await writeTextFile(MANAGER, text, base ?? null);
      } catch (error) {
        this.writeError = `Could not save agent-manager.json: ${errorText(error)}`;
        taskCx.notify();
        return;
      }
      this.managerText = text;
      this.managerError = null;
      this.disabled = next;
      this.writeError = null;
      this.shareInventory();
      taskCx.notify();
    });
  }

  // ---- permissions ----------------------------------------------------------

  // A permission change rewrites the same `run` a dirty draft is editing, so it waits for the
  // draft to be saved or cancelled instead of writing underneath it.
  permissionBlocked(cx) {
    if (!this.anyDirty()) return false;
    this.flashPermission("Save or cancel your command edits first: a permission change rewrites the same command.", "blocked", cx);
    return true;
  }

  flashPermission(text, tone, cx, retry = null) {
    this.permissionNotice = { text, tone, retry };
    cx.notify();
    cx.timer.after(PERMISSION_NOTICE_MS, () => {
      // A notice with a retry stays until it is used or replaced.
      if (this.permissionNotice?.text === text && !this.permissionNotice.retry) {
        this.permissionNotice = null;
        cx.notify();
      }
    });
  }

  /** A permission change writes both files, so neither may be damaged when it starts. */
  permissionReady(cx) {
    if (this.programsError) {
      this.flashPermission("programs.json is invalid; fix it before changing permissions.", "blocked", cx);
      return false;
    }
    if (this.managerError) {
      this.flashPermission("agent-manager.json is invalid; fix it before changing permissions.", "blocked", cx);
      return false;
    }
    return true;
  }

  /** The Popover reports every open and close (press, outside press, Escape) through here. */
  setPermissionMenu(id, open, cx) {
    if (open) this.permissionOpen = id;
    else if (this.permissionOpen === id) this.permissionOpen = null;
    this.permissionActive = -1;
    cx.notify();
  }

  /** The items of the open menu, for the keyboard. */
  permissionMenuItems() {
    const rows = this.allRows().all;
    if (this.permissionOpen === "default") return defaultPermissionItems(this, rows.filter((row) => row.supports));
    const row = rows.find((candidate) => candidate.key === this.permissionOpen);
    return row ? agentPermissionItems(this, row) : [];
  }

  /** Up/Down move the highlight, Enter picks it. Escape and outside presses belong to the Popover. */
  onPermissionKey(key, cx) {
    const items = this.permissionMenuItems();
    if (!items.length) return false;
    const at = this.permissionActive ?? -1;
    if (key === "down") this.permissionActive = (at + 1) % items.length;
    else if (key === "up") this.permissionActive = at <= 0 ? items.length - 1 : at - 1;
    else if (key === "enter" && at >= 0) {
      this.permissionOpen = null;
      items[at].onPick(cx);
    } else if (key === "escape") this.permissionOpen = null;
    else return false;
    cx.notify();
    return true;
  }

  /** Writes runs[agent] = run in one programs.json write; nothing is written on failure. */
  async writePrograms(runs, cx) {
    if (!runs || runs.size === 0) return true;
    const latest = await readTextFile(PROGRAMS).catch(() => this.programsText);
    const base = latest === undefined ? this.programsText : latest;
    const written = writeRunOverrides(base, [...runs]);
    if (written.error) {
      this.flashPermission(written.error, "blocked", cx);
      return false;
    }
    try {
      await writeTextFile(PROGRAMS, written.text, base ?? null);
    } catch (error) {
      this.flashPermission(`Could not save programs.json: ${errorText(error)}. Nothing was changed.`, "blocked", cx);
      return false;
    }
    // A newer pick is already in memory; this write must not roll the page back to its text.
    if (!this.pendingPermissions) this.programsText = written.text;
    this.programsError = null;
    this.pendingProgramsText = undefined;
    this.externalConflict = false;
    this.writeError = null;
    return true;
  }

  async writePermissions(next, cx) {
    const latest = await readTextFile(MANAGER).catch(() => this.managerText);
    const base = latest === undefined ? this.managerText : latest;
    const text = serializeManagerConfig(this.disabled, next);
    try {
      await writeTextFile(MANAGER, text, base ?? null);
    } catch (error) {
      this.flashPermission(`Could not save agent-manager.json: ${errorText(error)}. The command change is kept.`, "blocked", cx);
      return false;
    }
    this.managerText = text;
    this.managerError = null;
    if (!this.pendingPermissions) this.permissions = next;
    this.writeError = null;
    return true;
  }

  /**
   * Apply a pick to the page's memory now (the commands in programs.json's text, the stored
   * choice), so the UI never waits for the disk. `persistPermissions` writes it afterwards.
   */
  applyPermissionChange(runs, permissions, cx) {
    if (runs.size > 0) {
      const written = writeRunOverrides(this.programsText, [...runs]);
      if (written.error) {
        this.flashPermission(written.error, "blocked", cx);
        return false;
      }
      this.applyPrograms(written.text);
    }
    this.permissions = permissions;
    this.pendingRuns ??= new Map();
    for (const [key, command] of runs) this.pendingRuns.set(key, command); // latest pick per agent wins
    this.pendingPermissions = permissions;
    this.persisting = (this.persisting ?? 0) + 1;
    return true;
  }

  /**
   * Writes run on one chain, one flush at a time. A flush takes everything picked so far, so a
   * pick that lands while an older write is in flight is written after it and the last pick is
   * what stays on disk. A failed write reloads both files and offers a retry.
   */
  persistPermissions(cx, retry) {
    const flush = async () => {
      const runs = this.pendingRuns ?? new Map();
      const permissions = this.pendingPermissions;
      if (!permissions) return true; // an earlier flush already wrote this pick
      this.pendingRuns = new Map();
      this.pendingPermissions = null;
      return (await this.writePrograms(runs, cx)) && (await this.writePermissions(permissions, cx));
    };
    const done = (this.writeChain ?? Promise.resolve()).then(flush);
    this.writeChain = done.then(() => {}, () => {});
    return done.then(async (ok) => {
      this.persisting -= 1;
      if (!ok) this.persistFailed = true;
      if (this.persisting > 0) return ok;
      if (this.persistFailed) {
        this.persistFailed = false;
        await this.reloadFromDisk(cx);
        if (this.permissionNotice) this.permissionNotice.retry = retry;
      }
      try {
        this.syncEditors();
        this.shareInventory();
      } catch {
        // The write is done; a draft input or the shared value failing to update must not fail it.
      }
      cx.notify();
      return ok;
    });
  }

  /** The disk wins after a failed write: drop the optimistic state and show what is stored. */
  async reloadFromDisk(cx) {
    const [programs, manager] = await Promise.all([
      readFile(PROGRAMS),
      readFile(MANAGER),
    ]);
    if (programs !== undefined) {
      this.programsText = undefined;
      this.applyPrograms(programs);
    }
    if (manager !== undefined) {
      this.managerText = undefined;
      this.applyManager(manager);
    }
    cx.notify();
  }

  /**
   * The top-level choice. Every managed agent that can express it gets the recipe and loses its
   * exception; agents that cannot express it, and commands that set their own flags, are left
   * alone and counted in the notice.
   */
  async setDefaultPermission(choice, cx) {
    this.permissionOpen = null;
    if (!this.permissionReady(cx) || this.permissionBlocked(cx)) return false;
    const plan = planDefaultPermission(this.allRows().all.filter((row) => row.supports), choice);
    // Every agent that could take the choice now has it, so no per-agent exception is left.
    if (!this.applyPermissionChange(plan.runs, { default: choice, overrides: {} }, cx)) return false;
    this.flashPermission(defaultPermissionNotice(plan), "muted", cx);
    return this.persistPermissions(cx, (retryCx) => this.setDefaultPermission(choice, retryCx));
  }

  /** One agent's permission; `\"default\"` clears its exception and follows the all-agents choice. */
  async setAgentPermission(row, choice, cx) {
    this.permissionOpen = null;
    if (!this.permissionReady(cx) || this.permissionBlocked(cx)) return false;
    const permissions = this.currentPermissions();
    const target = choice === "default" ? permissions.default : choice;
    if (!(permissionChoices(row.key) ?? []).includes(target)) return false;
    const next = withPermission(row.key, row.run, target);
    const runs = next && !sameRun(next, row.run) ? new Map([[row.key, next]]) : new Map();
    const overrides = { ...permissions.overrides };
    if (choice === "default") delete overrides[row.key];
    else overrides[row.key] = choice;
    if (!this.applyPermissionChange(runs, { default: permissions.default, overrides }, cx)) return false;
    this.flashPermission(`${row.name} now uses ${PERMISSION_LABELS[target].toLowerCase()}.`, "muted", cx);
    return this.persistPermissions(cx, (retryCx) => {
      const fresh = this.allRows().all.find((candidate) => candidate.key === row.key) ?? row;
      return this.setAgentPermission(fresh, choice, retryCx);
    });
  }

  // ---- keyboard -------------------------------------------------------------

  // ---- model providers ------------------------------------------------------
  // The page keeps one card per saved provider (`this.cards`, by id) and one for the provider being
  // added (`this.adding`). A card holds its inputs and what the user is doing; the record lives in
  // model-providers.json and is written only after a passing test.

  makeCard(id, record) {
    const card = {
      id,
      open: false,
      touched: false, // the user typed here, so a file change must not overwrite the inputs
      testing: false,
      status: null, // { tone: "blocked" | "done" | "muted", text }
      replacing: false, // a saved key is shown as a hint until Replace is pressed
      reveal: false,
      autoName: "", // the name the link suggested last, so a later link may replace it but a typed one stays
      iconWork: Promise.resolve(),
      name: InputState.new({ placeholder: "Name" }),
      host: InputState.new({ placeholder: "http://127.0.0.1:8000/v1" }),
      key: InputState.new({ placeholder: "API key" }),
      link: InputState.new({ placeholder: "https://github.com/owner/repo" }),
    };
    card.key.set_masked(true);
    this.fillCard(card, record);
    for (const input of [card.name, card.host, card.key, card.link]) {
      input.on("change", (_event, cx) => {
        card.touched = true;
        card.status = null;
        cx.notify();
      });
      input.on("focus", (_event, cx) => {
        this.typing = true;
        cx.notify();
      });
      input.on("blur", (_event, cx) => {
        this.typing = false;
        cx.notify();
      });
      input.on("submit", (_event, cx) => this.saveCard(card, cx));
    }
    // Leaving the link field looks for the icon now, so it shows before anything is saved.
    card.link.on("blur", (_event, cx) => this.linkChanged(card, cx));
    return card;
  }

  fillCard(card, record) {
    card.name.set_value(record?.name ?? "");
    card.host.set_value(record?.host ?? "");
    card.key.set_value("");
    const link = recordLink(record);
    card.link.set_value(link);
    const info = linkInfo(link);
    // The icon on screen is the one the link stands for: its link and the local file it was saved to.
    card.fetched = { link: info.error ? "" : info.link, path: record?.iconPath ?? "" };
  }

  // A provider is shown from the file, so a delete or a change made elsewhere lands on the next read.
  // `readAt` is when the caller read the file: a read older than this page's own write is stale and
  // must not bring back what was just saved or deleted.
  applyProviders(text, readAt = Date.now()) {
    if (text === undefined || text === this.providerText || readAt <= this.providerWrittenAt) return false;
    this.providerText = text;
    const parsed = parseProviderFile(text);
    this.providers = parsed.providers ?? {};
    this.providersError = parsed.error ?? null;
    for (const id of [...this.cards.keys()]) if (!Object.hasOwn(this.providers, id)) this.cards.delete(id);
    for (const [id, record] of Object.entries(this.providers)) {
      const card = this.cards.get(id);
      if (!card) this.cards.set(id, this.makeCard(id, record));
      else if (!card.touched) this.fillCard(card, record);
    }
    return true;
  }

  showCardStatus(card, cx, tone, text) {
    card.status = { tone, text };
    card.testing = false;
    cx?.notify();
  }

  // The link field was left: suggest a name, then look for the icon.
  async linkChanged(card, cx) {
    const info = linkInfo(card.link.value());
    if (info.error) return this.showCardStatus(card, cx, "blocked", info.error);
    const name = card.name.value().trim();
    if (info.name && (name === "" || name === card.autoName)) {
      card.name.set_value(info.name);
      card.autoName = info.name;
    }
    card.status = info.iconUrl ? { tone: "muted", text: "Finding the icon…" } : null;
    cx?.notify();
    await this.refreshIcon(card, info);
    if (card.status?.text === "Finding the icon…") card.status = null;
    cx?.notify();
  }

  // What the card says it should save, or the first reason it cannot be saved yet.
  readCardInput(card) {
    const host = validateHost(card.host.value());
    if (host.error) return { error: host.error };
    const previous = card.id ? this.providers[card.id] : null;
    // Nothing typed in the key box means "keep the saved key".
    const key = card.key.value().trim() || previous?.apiKey || "";
    if (!key) return { error: "Enter the API key." };
    const info = linkInfo(card.link.value());
    if (info.error) return { error: info.error };
    const name = card.name.value().trim() || info.name || new URL(host.host).hostname;
    return { host: host.host, key, info, name };
  }

  // Saves only after a passing test: validate the card, test the server, then write the record, fix
  // its mode and save the icon. A failed test writes nothing.
  async saveCard(card, cx) {
    if (card.testing) return;
    const input = this.readCardInput(card);
    if (input.error) return this.showCardStatus(card, cx, "blocked", input.error);
    card.testing = true;
    card.status = null;
    cx?.notify();
    const verdict = await this.testProvider(input.host, input.key);
    if (!verdict.ok) return this.showCardStatus(card, cx, "blocked", verdict.error);
    await this.refreshIcon(card, input.info);
    const saved = await this.saveProvider(card, { name: input.name, host: input.host, key: input.key, link: input.info.link, models: verdict.models });
    card.testing = false;
    if (saved) this.adoptSavedCard(card, saved);
    cx?.notify();
  }

  adoptSavedCard(card, saved) {
    if (!card.id) {
      // The new card becomes the saved provider's own card.
      this.adding = null;
      this.cards.set(saved.id, card);
      card.id = saved.id;
    }
    card.touched = false;
    card.replacing = false;
    card.reveal = false;
    card.key.set_masked(true);
    card.key.set_value("");
    card.status = saved.error ? { tone: "blocked", text: saved.error } : { tone: "done", text: `Saved · ${saved.record.models.length} models` };
  }

  // `GET <host>/models` with the key in the header; the answer is judged into a fixed message.
  // The key is an argument of this one call, for five seconds (see the design's risks).
  async testProvider(host, key) {
    try {
      const result = await exec(
        "curl",
        ["-sS", "--max-time", String(CURL_MAX_SECONDS), "-w", "\n%{http_code}", "-H", `Authorization: Bearer ${key}`, `${host}/models`],
        { timeout: CURL_TIMEOUT_MS },
      );
      const text = result.stdout ?? "";
      const cut = text.lastIndexOf("\n");
      const status = Number(text.slice(cut + 1).trim());
      return judgeModels(Number.isFinite(status) ? status : 0, text.slice(0, cut));
    } catch {
      return judgeModels(0, "");
    }
  }

  async saveProvider(card, { name, host, key, link, models }) {
    const text = await readTextFile(PROVIDERS).catch(() => null);
    const parsed = parseProviderFile(text);
    if (parsed.error) return this.showCardStatus(card, null, "blocked", parsed.error);
    const id = card.id ?? slugId(name, Object.keys(parsed.providers));
    const previous = Object.hasOwn(parsed.providers, id) ? parsed.providers[id] : null;
    // The icon is the one fetched for this very link; a link with no icon (or none) has none.
    const iconPath = card.fetched.link === link ? card.fetched.path : "";
    const record = {
      name,
      host,
      apiKey: key,
      link,
      iconPath,
      verifiedAt: new Date().toISOString(),
      models,
      // The model Codex had chosen for this provider survives a re-test.
      selectedModel: previous?.selectedModel ?? {},
    };
    parsed.providers[id] = record;
    const next = serializeProviderFile(parsed.providers);
    try {
      await writeTextFile(PROVIDERS, next, text);
    } catch {
      return this.showCardStatus(card, null, "blocked", "Could not write model-providers.json.");
    }
    this.providerText = next;
    this.providerWrittenAt = Date.now();
    this.providers = parsed.providers;
    // The record is written by now, so a mode that did not take is reported but the card still owns it.
    const error = (await this.secureProviderFile()) ? null : "model-providers.json is not private to your user.";
    // The replaced icon is deleted too, but only when it is one of ours.
    const stale = ownedIcon(previous?.iconPath);
    if (stale && stale !== iconPath) await removeFile(stale);
    return { id, record, error };
  }

  async deleteProvider(card, cx) {
    if (card.testing) return; // a save in flight would write the record back
    const text = await readTextFile(PROVIDERS).catch(() => null);
    const parsed = parseProviderFile(text);
    if (parsed.error) return this.showCardStatus(card, cx, "blocked", parsed.error);
    const record = Object.hasOwn(parsed.providers, card.id) ? parsed.providers[card.id] : null;
    if (!record) return this.showCardStatus(card, cx, "blocked", "No provider is saved.");
    delete parsed.providers[card.id];
    const next = serializeProviderFile(parsed.providers);
    try {
      await writeTextFile(PROVIDERS, next, text);
    } catch {
      return this.showCardStatus(card, cx, "blocked", "Could not write model-providers.json.");
    }
    this.providerText = next;
    this.providerWrittenAt = Date.now();
    this.providers = parsed.providers;
    await this.secureProviderFile();
    // Only a file this page could have written is removed, and an unsaved preview goes with it.
    for (const path of new Set([record.iconPath, card.fetched.path])) {
      const stale = ownedIcon(path);
      if (stale) await removeFile(stale);
    }
    this.cards.delete(card.id);
    cx?.notify();
  }

  // writeTextFile replaces the file, which can reset the mode, and the key is in it.
  async secureProviderFile() {
    try {
      await exec("chmod", ["600", PROVIDERS]);
      const mode = await exec("stat", ["-f", "%Lp", PROVIDERS]);
      return mode.stdout.trim() === "600";
    } catch {
      return false;
    }
  }

  // Looks for the icon of `info.link` unless that is the one already on the card. Work on one card
  // runs one at a time, so a quick second blur cannot race the first.
  refreshIcon(card, info) {
    card.iconWork = card.iconWork.then(async () => {
      if (card.fetched.link === info.link) return;
      const path = info.iconUrl ? await this.fetchProviderIcon(info.iconUrl) : null;
      // An unsaved preview goes when it is replaced; the saved icon goes when the save lands.
      const old = ownedIcon(card.fetched.path);
      if (old && old !== ownedIcon(this.providers[card.id]?.iconPath)) await removeFile(old);
      card.fetched = { link: info.link, path: path ?? "" };
    });
    return card.iconWork;
  }

  // Downloads the icon once into this app's folder, under a name no earlier icon had, so nothing
  // keeps showing a cached older picture. Saved only when the answer really is a small image.
  async fetchProviderIcon(url) {
    const dir = `${appHome()}/${ICON_DIR}`;
    const path = `${dir}/icon-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.png`;
    const partial = `${path}.download`;
    const drop = () => removeFile(partial);
    try {
      await exec("mkdir", ["-p", dir]);
      const result = await exec(
        "curl",
        ["-sL", "--max-time", String(CURL_MAX_SECONDS), "--max-filesize", String(ICON_MAX_BYTES), "-o", partial, "-w", "\n%{http_code}", url],
        { timeout: CURL_TIMEOUT_MS },
      );
      const text = result.stdout ?? "";
      const status = Number(text.slice(text.lastIndexOf("\n") + 1).trim());
      const head = (await exec("xxd", ["-p", "-l", String(MAGIC_PROBE_BYTES), partial]).catch(() => ({ stdout: "" }))).stdout.trim();
      if (status !== 200 || !IMAGE_MAGIC.some((magic) => head.startsWith(magic))) {
        await drop();
        return null;
      }
      if (head.startsWith(ICO_MAGIC)) {
        // The app draws PNG and JPEG, not .ico: macOS converts it.
        const converted = await exec("sips", ["-s", "format", "png", partial, "--out", path]);
        await drop();
        return converted.code ? null : path;
      }
      await exec("mv", ["-f", partial, path]);
      return path;
    } catch {
      await drop();
      return null;
    }
  }

  onKey(event, cx) {
    if (this.typing) return false;
    const key = String(event.key ?? "");
    if (this.permissionOpen && this.onPermissionKey(key, cx)) return true;
    const rows = this.allRows().all;
    if (!rows.length) return false;
    const at = rows.findIndex((row) => row.key === this.focusKey);
    const current = rows[Math.max(0, at)];
    if (key === "enter") {
      this.toggleExpand(current, cx);
      return true;
    }
    if (!this.applyRowKey(key, { rows, at, current }, cx)) return false;
    this.scrollToFocus();
    this.handle.focus();
    cx.notify();
    return true;
  }

  // One key on the list: false when it means nothing here. `at` is the focused row, -1 for none.
  applyRowKey(key, { rows, at, current }, cx) {
    const move = Object.hasOwn(ROW_MOVES, key) ? ROW_MOVES[key] : null;
    if (move) this.focusKey = rows[move(at, rows.length)].key;
    else if (key === "space" || key === " ") this.toggleEnabled(current, cx);
    else if (key.toLowerCase() === "r") this.refresh(cx);
    else if (key === "escape") return this.expanded.delete(current.key);
    else return false;
    return true;
  }

  scrollToFocus() {
    const split = this.allRows();
    const installedIndex = split.installed.findIndex((row) => row.key === this.focusKey);
    if (installedIndex >= 0) {
      this.installedScroll.scroll_to_item(installedIndex);
      return;
    }
    const availableIndex = split.available.findIndex((row) => row.key === this.focusKey);
    if (availableIndex >= 0) this.availableScroll.scroll_to_item(availableIndex);
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
    const verb = on ? "Disable" : "Enable";
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
      .tooltip(installed ? `${verb} ${row.name}` : `Install ${row.name} first; this switch is unavailable until its CLI is installed`)
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

  catalog(rows, t, listName) {
    const viewport = listViewportHeight(rows.length, rows.some((row) => this.expanded.has(row.key)));
    const id = `am-catalog-${listName}`;
    const list = v_flex()
      .id(id)
      .track_scroll(listName === "installed" ? this.installedScroll : this.availableScroll)
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
      // The inner list stops the wheel only while it moves; at its edge the event would scroll the page behind it.
      .when(viewport, (el) => el.h(viewport).on_scroll_wheel((_e, cx) => cx.stop_propagation()))
      .child(list)
      .when(viewport, (el) => el.child(Scrollbar.vertical(id).absolute().inset_0()));
  }

  unofficialRow(t, installed) {
    const row = { key: "freebuff", installed, enabled: installed && !this.disabled.has("freebuff") };
    const mono = monoFont();
    return div().w_full().flex_none().rounded(10).border_1().border_color(t.border).bg(t.surface).child(
      h_flex().w_full().h(LIST_ROW_HEIGHT - 12).my(6).px(18).gap(12).items_center()
        .child(h_flex().w(32).h(32).flex_none().items_center().justify_center().rounded(8).border_1().border_color(t.border)
          .child(icon({ name: "freebuff", icon: "mods/orca-new-menu/freebuff.png" }, 18, t)))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(div().text_size(13).font_medium().text_color(t.foreground).child("freebuff"))
          .child(div().min_w(0).truncate().font_family(mono).text_size(11).text_color(t.muted).child("freebuff")))
        .child(this.toggle(row, t)),
    );
  }

  commandLine(row, t, quiet) {
    const mono = monoFont();
    const effective = formatArgv(row.run);
    const commandText = () => div().min_w(0).truncate().font_family(mono).text_size(11).text_color(t.muted);
    if (!row.customized || !row.defaultCmd) return commandText().when(quiet, (el) => el.opacity(0.45)).child(effective);
    const fallback = commandText().child(effective);
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
    return rowView(this, row, t, last);
  }

  // The Model providers page: a back arrow, a title and the card, nothing else.
  providersView() {
    return providersPageView(this);
  }

  // One saved provider, or the one being added (`card.id` is null): a header that opens an editor.
  providerCard(card, t) {
    return providerCardView(this, card, t);
  }

  modelProvidersCard(t) {
    return modelProvidersView(this, t);
  }

  // Cancel on the card being added: an icon it already fetched goes with it.
  cancelNewCard(card, cx) {
    if (card.testing) return;
    const path = ownedIcon(card.fetched.path);
    if (path) removeFile(path);
    this.adding = null;
    cx.notify();
  }

  // The main stack's terminals page is the way back to the work.
  showTerminals() {
    run("layout.select", { stack: "main", child: TERMINALS_PAGE });
  }

  /** The all-agents permission: one choice, plus the agents that keep their own. */
  permissionsCard(rows, t) {
    return permissionsCardView(this, rows, t);
  }

  editor(row, editor, t) {
    return editorView(this, row, editor, t);
  }

  uninstallSection(row, t) {
    return uninstallSectionView(this, row, t);
  }

  render() {
    if (this.providersPage) return this.providersView();
    return agentsPageView(this, theme());
  }
}
