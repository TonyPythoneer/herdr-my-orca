// Agent setup flyout, opened by a row's chevron in orca-new-menu: { menu, space, name, key, argv }.
// What each agent offers is its spec (agent-flyout.js: options, the CLI argument each becomes, the
// sections); this file draws any spec with one renderer per option type, builds the launch argv from
// it, and remembers the values. Model, effort and hidden models are remembered in
// appHome()/agent-config.json, with the model list cached there too: it is read again only when the
// CLI's --version changes.
// The agent's permission flags stay in programs.json's `run`; this only adds what the spec lists.
// The flyout is sticky: it stays after the pointer leaves and closes on launch.

import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, InputState, Input, Scrollbar } from "gpui-base";
import { checking, run, props, closeOverlay, theme, setShared, exec, appHome, home, readTextFile, writeTextFile, settings, spaces } from "herdr";
import { PROVIDER_FILE, launchArgv, launchClaudeArgv, launchOpenCodeArgv, launchPiArgv, parseProviderFile, piModelLimits, serializeProviderFile, supportsCodingModel, validateHost, writeProviderFile } from "./codex-provider.js";
import { viewportHeight, scrolls, ROW } from "./list-viewport.js";
import { SPECS, buildArgv, defaultValues, parseModels, presetOf, readGroup, readValues, sectionsOf } from "./agent-flyout.js";

// Only servers in config.toml: `-c mcp_servers.<name>.enabled=false` on a plugin-provided server
// (no config.toml entry) leaves an incomplete table and codex refuses to start.
async function codexMcpOff() {
  try {
    const toml = await readTextFile(`${home()}/.codex/config.toml`);
    return [...toml.matchAll(/^\[mcp_servers\.("[^"]+"|[\w-]+)\]\s*$/gm)].flatMap((m) => ["-c", `mcp_servers.${m[1]}.enabled=false`]);
  } catch { return []; } // best effort: no config file, or unreadable, means nothing to disable
}

// Hooks a spec names: the expansion of a checklist item that is not one flag.
const EXPANSIONS = { codexMcp: codexMcpOff };

const EFFORT_LABEL = { "": "Default", off: "Off", minimal: "Min", low: "Low", medium: "Med", high: "High", xhigh: "XHigh", max: "Max", ultra: "Ultra" };
const BUILTIN_STYLES = ["default", "Explanatory", "Learning"];
const NEW_STYLE = "+ New style…";
const styleDir = () => `${home()}/.claude/output-styles`;
const styleTemplate = (name) => `---\nname: ${name}\ndescription: Describe this output style\n---\n\nYou are an interactive CLI tool that helps users with software engineering tasks.\n`;
// Bump when the cached model shape changes (opencode gained providers/groups).
const CATALOG_SCHEMA = 3;
// Reuse a cache for ten minutes; the CLI and the upstream list are checked again after that.
const CATALOG_TTL_MS = 10 * 60_000;
const SETTINGS = `${appHome()}/agent-config.json`;
// A model-list or version probe runs a login shell and may start a slow CLI.
const CLI_TIMEOUT_MS = 60_000;
// The style-name input is mounted by the next frame, so focus waits a moment.
const INPUT_MOUNT_DELAY_MS = 30;
const dangerColor = () => (settings()?.dark ? "#ef4444" : "#dc2626");

const catalogEntry = (all, key) => all.catalog?.[key];
const currentCatalogModels = (cached) => (cached?.schema === CATALOG_SCHEMA ? cached.models : null);
const isFresh = (cached, cachedModels) => Boolean(cachedModels) && typeof cached.checkedAt === "number" && Date.now() - cached.checkedAt < CATALOG_TTL_MS;

// The CLI's version, the last line of `--version` output: the cache is valid while it stays the same.
async function cliVersion(command) {
  const { stdout } = await exec("zsh", ["-lic", `${command} --version`], { timeout: CLI_TIMEOUT_MS });
  return stdout.trim().split("\n").pop().trim();
}

function formatJson(text) {
  return JSON.stringify(JSON.parse(text), null, 2);
}

// JSON.parse messages differ between engines. Try "line N" first, then
// "position N" and count newlines. Fall back to line 1.
function parseManagerSettings(text) {
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

function describeJsonError(error, text) {
  const message = String(error?.message ?? error);
  const line = message.match(/\bline (\d+)\b/i);
  let number = line ? Number(line[1]) : 0;
  if (!number) {
    const position = message.match(/\bposition (\d+)\b/i);
    if (position) number = text.slice(0, Number(position[1])).split("\n").length;
  }
  return { message, line: number || 1 };
}

// A saved JSON editor text, formatted the way the editor shows it; damaged text is the default.
function normalizeJson(text, fallback) {
  try {
    return formatJson(text);
  } catch {
    return fallback;
  }
}

function providerGlyph(record, t) {
  if (!record) return svg("mods/orca-assets/circle.svg").size(13).text_color(t.muted);
  const appDir = `${appHome()}/`;
  const path = String(record.iconPath ?? "");
  if (path.startsWith(appDir)) return image(path.slice(appDir.length)).w(20).h(20).rounded(4);
  return svg("mods/orca-assets/hard-drive.svg").size(14).text_color(t.muted);
}

function providerTooltip(remote, providerCount) {
  if (remote) return "A model provider is set up on this computer only";
  return providerCount > 0 ? "Choose which model source Codex starts with" : "Add a model provider";
}

// The validity badge of a JSON editor: invalid, edited since the last save, or fine.
function jsonBadge(editor, danger, t) {
  if (editor.error) return { text: `Invalid JSON · line ${editor.error.line}`, color: danger, bg: "#ef444414", border: "#ef444440" };
  if (editor.dirty) return { text: "Unsaved changes", color: t.working, bg: "#eab30814", border: "#eab30840" };
  return { text: "Valid JSON", color: t.done, bg: "#10b98114", border: "#10b98138" };
}

// The space the flyout was opened for, else the active one.
const launchSpace = (p) => spaces().find((candidate) => candidate.id === p.space) ?? spaces().find((candidate) => candidate.active);

// Shared methods, without depending on a mounted native View.
class AgentConfigCore {
  context() { return this.settingsContext ?? props() ?? {}; }

  init(_props, cx) {
    this.key = this.context().key ?? "claude";
    this.spec = SPECS[this.key];
    this.values = { ...defaultValues(this.spec), model: null, effort: null }; // what the options hold
    this.models = null; // null while loading
    this.error = "";
    this.hidden = new Set();
    this.modelGroup = this.groupOption()?.group ?? null; // a model list filter, when the spec has groups
    this.groupOpen = false;
    this.showHidden = false; // the "-- hidden --" section stays collapsed until clicked
    this.collapsedAdvanced = true;
    this.snapshot = null; // the settings file as read, for a safe write
    this.open = null; // the option whose select list is open: one at a time, inline below its row

    // Model providers (Agent Settings writes them): the flyout only picks one and reads its models.
    this.providers = {};
    this.providerId = "none"; // none: the agent's own source
    this.cliModel = null; // the model to come back to when the provider goes back to None

    // Fast mode: whether this agent's CLI supports a `--fast` flag. `null` while probing.
    this.fastSupported = null;
    this.fast = false;

    // Output styles (the `claudeOutputStyles` list): the .md files of ~/.claude/output-styles.
    this.styles = BUILTIN_STYLES;
    this.naming = false; // "+ New style…" shows a name input until Enter
    this.nameFocused = false; // blur only cancels once the input really had focus
    this.nameError = false;
    this.setupStyleInput();
    this.setupEditors();

    if (checking()) return;

    cx.spawn((taskCx) => this.loadSaved(taskCx));
  }

  setupStyleInput() {
    this.styleInput = InputState.new({ placeholder: "style name" });
    this.styleInput.on("submit", (_e, eventCx) => this.createStyle(eventCx));
    this.styleInput.on("change", (_e, eventCx) => { this.nameError = false; eventCx.notify(); });
    this.styleInput.on("focus", () => { this.nameFocused = true; });
    // Any click elsewhere blurs the input, which covers other selects, Reset and Launch.
    this.styleInput.on("blur", (_e, eventCx) => { if (this.nameFocused) this.cancelNaming(eventCx); });
  }

  // Editors: the live text is the input's, the saved text is `values[id]`. TextareaState.new needs
  // a live host call, so it belongs here, not in render.
  setupEditors() {
    this.editors = {};
    for (const [id, option] of Object.entries(this.spec.options)) {
      if (option.type !== "editor") continue;
      const editor = { input: TextareaState.new({ value: option.default ?? "", rows: 3 }), dirty: false, error: null };
      if (option.language === "json") editor.input.set_soft_wrap(false); // JSON: scroll sideways, never wrap
      editor.input.on("change", (_e, eventCx) => {
        editor.dirty = editor.input.value() !== this.values[id];
        eventCx.notify();
      });
      this.editors[id] = editor;
    }
  }

  async loadSaved(cx) {
    try {
      this.snapshot = await readTextFile(SETTINGS).catch(() => null);
      const all = JSON.parse(this.snapshot ?? "{}");
      const saved = all[this.key] ?? {};
      await this.applySaved(saved, cx);
      if (this.settingsContext) this.settingsLoaded = true;

      const cached = catalogEntry(all, this.key);
      const cachedModels = currentCatalogModels(cached);
      if (cachedModels?.length) this.paintCached(cachedModels, saved, cx);
      if (isFresh(cached, cachedModels)) return;
      await this.checkCatalog(cx, saved, cached, cachedModels);
      cx.spawn((taskCx) => this.probeFast(taskCx));
    } catch (e) {
      // A failed refresh keeps the cached list; only show the error when there is nothing to show.
      if (!this.models?.length) this.error = `Could not list models: ${e?.message ?? e}`;
      cx.notify();
    }
  }

  // The values, hidden models, providers and group this agent saved last time.
  async applySaved(saved, cx) {
    this.values = { ...this.values, ...readValues(this.spec, saved) };
    this.collapsedAdvanced = saved.advancedArgumentsCollapsed !== false;
    for (const [id, editor] of Object.entries(this.editors)) {
      if (this.spec.options[id].language === "json") this.values[id] = normalizeJson(this.values[id], this.spec.options[id].default);
      editor.input.set_value(this.values[id]);
    }
    if (this.hasSource("claudeOutputStyles")) this.loadStyles(cx);
    this.hidden = new Set(saved.hidden ?? []);
    if (this.spec.options.provider) await this.loadProviders();
    if (this.groupOption()) this.modelGroup = readGroup(this.groupOption(), saved);
  }

  // Paint the cached list before asking the CLI anything; a refresh must not show a spinner.
  paintCached(cachedModels, saved, cx) {
    this.models = cachedModels;
    this.pickSaved(saved);
    cx.notify();
    this.launchIfAsked(cx);
  }

  pickSaved(saved) {
    if (!this.models?.length) return;
    const pick = this.models.find((m) => m.id === saved.model) ?? this.models[0];
    this.choose(pick, saved.effort);
  }

  // The row's own click (launchNow) launches with this flyout's saved config, as its button does.
  launchIfAsked(cx) {
    if (this.context().launchNow && this.current() && !this.launched) {
      this.launched = true;
      this.launch(cx);
    }
  }

  // Check both the CLI version and the upstream list: a model can be added without a version
  // change. Both run in the background, so the cached list stays on screen meanwhile.
  async checkCatalog(cx, saved, cached, cachedModels) {
    const [version, models] = await Promise.all([
      cliVersion(this.spec.command).catch(() => cached?.version ?? null),
      this.listModels(),
    ]);
    if (!models.length) throw new Error("no models available");
    if (JSON.stringify(models) !== JSON.stringify(cachedModels ?? [])) {
      this.models = models;
      const keep = models.find((m) => m.id === this.model);
      if (keep) this.choose(keep, this.effort);
      else this.pickSaved(saved);
      cx.notify();
    }
    this.launchIfAsked(cx);
    this.saveCatalog(version, models);
  }

  get model() { return this.values.model; }
  set model(id) { this.values.model = id; }
  get effort() { return this.values.effort; }
  set effort(level) { this.values.effort = level; }

  // The option of a type the spec has once: its groups option is the model's.
  groupOption() {
    const model = this.spec.options.model;
    return this.providerId === "none" && model?.groups ? model : null;
  }

  hasSource(source) {
    return Object.values(this.spec.options).some((option) => option.source === source);
  }

  // The model list comes from the CLI itself, through the login shell, read by the spec's parser.
  // A spec with a `default` starts the list with an entry that passes no model flag, and keeps it
  // when the CLI cannot list (not logged in, not answering): the agent still launches.
  async listModels() {
    const first = this.spec.models.default ? [{ id: "", label: this.spec.models.default, efforts: [], fallbackEffort: "" }] : [];
    try {
      const { stdout } = await exec("zsh", ["-lic", this.spec.models.shell], { timeout: CLI_TIMEOUT_MS });
      return [...first, ...parseModels(this.spec.models.parser, stdout)];
    } catch (error) {
      if (first.length) return first;
      throw error;
    }
  }

  // Whether this agent's CLI supports a `--fast` flag: probe its help output once, cached on the
  // view for the lifetime of the flyout. The FAST toggle is only enabled when the CLI supports it.
  async probeFast(cx) {
    try {
      const { stdout } = await exec("zsh", ["-lic", `${this.spec.command} --help`], { timeout: CLI_TIMEOUT_MS });
      this.fastSupported = /--fast\b|-f\b|\bfast\b/i.test(stdout);
    } catch { this.fastSupported = false; }
    cx.notify();
  }

  // Picking a model keeps the effort when the model supports it, else the model's own default.
  choose(model, effort) {
    if (!model) {
      this.model = null;
      this.effort = null;
      return;
    }
    this.model = model.id;
    const efforts = model.efforts;
    const fallback = efforts.includes(model.fallbackEffort) ? model.fallbackEffort : efforts[0];
    const kept = [effort, this.effort].find((level) => efforts.includes(level));
    this.effort = kept !== undefined ? kept : fallback;
  }

  current() {
    return this.activeModels()?.find((m) => m.id === this.model);
  }

  // Model providers live in their own file; a launch re-reads it, so a delete lands at once.
  async loadProviders() {
    const text = await readTextFile(`${appHome()}/${PROVIDER_FILE}`).catch(() => null);
    this.providers = parseProviderFile(text).providers ?? {};
    if (this.providerId !== "none" && !this.providers[this.providerId]) this.providerId = "none";
    return this.providers;
  }

  // With a provider chosen the list is its own models, so a GPT name is never sent to oMLX. Those
  // models have no effort variants, which is also what hides the EFFORT row.
  activeModels() {
    if (!this.spec.options.provider || this.providerId === "none") return this.models;
    const record = this.providers[this.providerId];
    return (record?.models ?? [])
      .filter((id) => this.key === "pi" ? supportsCodingModel(record.modelInfo?.[id]) && piModelLimits(record.modelInfo?.[id]) !== null : this.key !== "opencode" || supportsCodingModel(record.modelInfo?.[id]))
      .map((id) => ({ id, label: id, efforts: [] }));
  }

  // None keeps the agent's model; a provider keeps its model in the provider's own record.
  setProvider(id, cx) {
    this.open = null;
    if (id === this.providerId) return cx.notify();
    if (this.providerId === "none") this.cliModel = this.model;
    this.providerId = id;
    const list = this.activeModels() ?? [];
    const wanted = id === "none" ? this.cliModel : this.providers[id]?.selectedModel?.[this.key];
    this.choose(list.find((m) => m.id === wanted) ?? list[0] ?? null);
    this.remember();
    cx.notify();
  }

  // The provider model is remembered per agent inside the provider record.
  rememberProviderModel() {
    const id = this.providerId;
    const key = this.key;
    const model = this.model;
    const file = `${appHome()}/${PROVIDER_FILE}`;
    this.savingProvider = (this.savingProvider ?? Promise.resolve()).then(async () => {
      const text = await readTextFile(file).catch(() => null);
      const parsed = parseProviderFile(text);
      const record = parsed.providers?.[id];
      if (!record) return; // deleted while this flyout was open
      record.selectedModel = { ...(record.selectedModel ?? {}), [key]: model };
      try {
        await writeProviderFile({ appHome, exec, readTextFile, writeTextFile }, serializeProviderFile(parsed.providers), text);
      } catch { /* the provider file could not be saved: the choice is kept in memory only */ }
    });
  }

  // Writes queue up, so each one builds on the last saved snapshot instead of racing it.
  persist(mutate) {
    this.saving = (this.saving ?? Promise.resolve()).then(async () => {
      let all = {};
      let base = this.snapshot;
      // Keep the existing popup's write ordering: no extra await before the mutation.
      if (this.settingsContext) {
        try { ({ all, base } = await this.settingsWriteBase()); }
        catch (e) { this.settingsSaveError = String(e?.message ?? e); return; }
      } else {
        try { all = JSON.parse(base ?? "{}"); } catch {}
      }
      mutate(all);
      const text = `${JSON.stringify(all, null, 2)}\n`;
      try {
        await writeTextFile(SETTINGS, text, base);
        this.snapshot = text;
        this.settingsSaveError = null;
      } catch (e) {
        if (this.settingsContext) this.settingsSaveError = String(e?.message ?? e);
      }
    });
  }

  async settingsWriteBase() {
    const base = await readTextFile(SETTINGS);
    const all = JSON.parse(base ?? "{}");
    if (!all || typeof all !== "object" || Array.isArray(all)) throw new Error("Invalid agent-config.json");
    const before = JSON.parse(this.snapshot ?? "{}");
    if (JSON.stringify(before[this.key]) !== JSON.stringify(all[this.key])) {
      throw new Error("This agent changed on disk. Reopen its settings before saving again.");
    }
    return { all, base };
  }

  remember() {
    const key = this.key;
    const { model, effort } = this;
    const hidden = [...this.hidden];
    // A provider's model never replaces the model remembered for None.
    const viaProvider = Boolean(this.spec.options.provider) && this.providerId !== "none";
    this.persist((all) => {
      all[key] = { ...all[key], hidden, ...(viaProvider ? {} : { model, effort }) };
    });
    if (viaProvider) this.rememberProviderModel();
  }

  toggleAdvanced(cx) {
    this.collapsedAdvanced = !this.collapsedAdvanced;
    const collapsed = this.collapsedAdvanced;
    this.persist((all) => {
      all[this.key] = { ...all[this.key], advancedArgumentsCollapsed: collapsed };
    });
    cx.notify();
  }

  // The model list filter (opencode's group) is a list preference, saved with the model and effort.
  rememberGroup() {
    const key = this.key;
    const group = this.modelGroup;
    this.persist((all) => {
      all[key] = { ...all[key], group };
    });
  }

  // Every option that is not the model or effort is saved under `preset`, by its own id.
  rememberPreset(patch = {}) {
    const preset = { ...presetOf(this.spec, this.values), ...patch };
    this.persist((all) => {
      all[this.key] = { ...all[this.key], preset: this.settingsContext ? { ...all[this.key]?.preset, ...preset } : preset };
    });
  }

  setValue(id, value, cx) {
    this.values[id] = value;
    this.open = null;
    this.rememberPreset();
    cx.notify();
  }

  toggleItem(id, item, cx) {
    const on = new Set(this.values[id]);
    if (on.has(item)) on.delete(item);
    else on.add(item);
    this.values[id] = [...on];
    this.rememberPreset();
    cx.notify();
  }

  setAllItems(id, all, cx) {
    this.values[id] = all ? this.spec.options[id].items.map((item) => item.id) : [];
    this.rememberPreset();
    cx.notify();
  }

  // An editor commits only with its Save button. Launch may use the live, unsaved text.
  saveEditor(id, cx) {
    const option = this.spec.options[id];
    const editor = this.editors[id];
    const raw = editor.input.value();
    try {
      const text = option.language === "json" ? formatJson(raw) : raw;
      if (text !== raw) editor.input.set_value(text);
      this.values[id] = text;
      editor.dirty = false;
      editor.error = null;
      this.rememberPreset();
    } catch (error) {
      editor.error = describeJsonError(error, raw);
    }
    cx.notify();
  }

  // Back to what the spec starts with, for every option the flyout saves.
  resetPreset(cx) {
    const fresh = defaultValues(this.spec);
    this.open = null;
    for (const id of Object.keys(fresh)) {
      this.values[id] = fresh[id];
      const editor = this.editors[id];
      if (editor) {
        editor.input.set_value(fresh[id]);
        editor.dirty = false;
        editor.error = null;
      }
    }
    this.rememberPreset();
    cx.notify();
  }

  // Custom styles are the .md files in ~/.claude/output-styles; a missing folder just means none.
  loadStyles(cx) {
    cx.spawn(async (taskCx) => {
      const { stdout } = await exec("ls", [styleDir()]).catch(() => ({ stdout: "" }));
      const custom = stdout.split("\n").filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
      this.styles = [...BUILTIN_STYLES, ...custom.filter((n) => !BUILTIN_STYLES.includes(n))];
      taskCx.notify();
    });
  }

  openStyleFile(name) {
    run("tab.new", { mod: "orca-files", props: { file: `${styleDir()}/${name}.md` } });
  }

  // Choosing "+ New style…" asks for a name; any other choice is the option's value.
  pickChoice(id, name, cx) {
    if (name !== NEW_STYLE) return this.setValue(id, name, cx);
    this.open = null;
    this.naming = true;
    this.nameFocused = false;
    this.nameError = false;
    cx.timer.after(INPUT_MOUNT_DELAY_MS, () => this.styleInput.focus());
    cx.notify();
  }

  cancelNaming(cx) {
    if (!this.naming) return;
    this.naming = false;
    this.nameFocused = false;
    this.nameError = false;
    this.styleInput.set_value("");
    cx.notify();
  }

  // A named style with no file gets a default one, then opens in an editor tab.
  createStyle(cx) {
    const name = this.styleInput.value().trim();
    if (!name) return this.cancelNaming(cx);
    if (!/^[\w-]+$/.test(name)) { this.nameError = true; cx.notify(); return; } // the name becomes a file name
    this.naming = false;
    this.nameFocused = false;
    this.styleInput.set_value("");
    const id = Object.keys(this.spec.options).find((key) => this.spec.options[key].source === "claudeOutputStyles");
    cx.spawn(async (taskCx) => {
      const file = `${styleDir()}/${name}.md`;
      if ((await readTextFile(file).catch(() => null)) === null) {
        await exec("mkdir", ["-p", styleDir()]);
        await writeTextFile(file, styleTemplate(name), null);
      }
      this.values[id] = name;
      this.rememberPreset();
      this.loadStyles(taskCx);
      this.openStyleFile(name);
    });
    cx.notify();
  }

  saveCatalog(version, models) {
    const key = this.key;
    this.persist((all) => {
      all.catalog = { ...all.catalog, [key]: { schema: CATALOG_SCHEMA, version, checkedAt: Date.now(), models } };
    });
  }

  // Refresh: drop the saved model list and ask the CLI again, so a stale list never has to be
  // cleared by hand. A failure keeps the list on screen and shows the error.
  refresh(cx) {
    if (this.refreshing) return;
    this.refreshing = true;
    this.error = "";
    if (this.settingsContext) this.previewKey = null;
    const key = this.key;
    this.persist((all) => { if (all.catalog) delete all.catalog[key]; });
    cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        const [version, models] = await Promise.all([cliVersion(this.spec.command).catch(() => null), this.listModels()]);
        if (!models.length) throw new Error("no models available");
        this.models = models;
        const pick = models.find((m) => m.id === this.model) ?? models[0];
        this.choose(pick, this.effort);
        this.saveCatalog(version, models);
      } catch (e) {
        this.error = `Could not list models: ${e?.message ?? e}`;
      }
      this.refreshing = false;
      taskCx.notify();
    });
  }

  toggleHidden(id) {
    if (this.hidden.has(id)) this.hidden.delete(id);
    else this.hidden.add(id);
    this.remember();
  }

  // The argv this flyout launches, or `{ error }` when something blocks it. Editors are read live: a
  // launch never saves them, and invalid JSON blocks it even when it was never saved.
  async buildLaunch(p, { preview = false } = {}) {
    const providerId = this.providerId;
    const values = { ...this.values };
    if (this.readEditors(values, preview)) return { blocked: true };
    const expansions = await this.expandItems(values);
    if (this.spec.options.provider && (preview ? providerId : this.providerId) !== "none") return this.buildProviderLaunch(p, values, expansions, { preview, providerId: preview ? providerId : this.providerId });
    return { argv: buildArgv(this.spec, p.argv, values, { expansions }) };
  }

  // Puts the live editor text into `values`; true when a JSON editor holds invalid JSON.
  readEditors(values, preview = false) {
    for (const [id, editor] of Object.entries(this.editors)) {
      values[id] = editor.input.value();
      if (this.spec.options[id].language === "json" && values[id].trim()) {
        try {
          JSON.parse(values[id]);
        } catch (error) {
          if (!preview) {
            editor.error = describeJsonError(error, values[id]);
            editor.dirty = values[id] !== this.values[id];
          }
          return true;
        }
      }
    }
    return false;
  }

  async expandItems(values) {
    const expansions = {};
    for (const [id, option] of Object.entries(this.spec.options)) {
      for (const item of option.items ?? []) {
        if (item.expand && (values[id] ?? []).includes(item.id)) expansions[item.expand] = await EXPANSIONS[item.expand]();
      }
    }
    return expansions;
  }

  // A provider must still be saved: the file can lose it while the flyout is open.
  async buildProviderLaunch(p, values, expansions, { preview = false, providerId = this.providerId } = {}) {
    const file = `${appHome()}/${PROVIDER_FILE}`;
    const record = parseProviderFile(await readTextFile(file).catch(() => null)).providers?.[providerId];
    // The host goes into a config string, so a hand-edited one is checked again here.
    if (!record || validateHost(record.host).error) {
      if (!preview) { this.providerId = "none"; this.open = null; }
      return { error: "Model provider is no longer set up." };
    }
    const provider = { ...record, id: providerId, configPath: file };
    const model = preview ? values.model : this.model;
    const argv = buildArgv(this.spec, p.argv, values, { expansions, skip: ["model", "effort"] });
    return this.providerLaunchArgv(provider, model, argv);
  }

  providerLaunchArgv(provider, model, argv) {
    const info = provider.modelInfo?.[model];
    if (this.key === "pi") {
      if (!supportsCodingModel(info)) return { error: "Pi needs a text model with tool support." };
      if (!piModelLimits(info)) return { error: "Pi needs a known context limit above 16,384 tokens and an output limit that fits it." };
      return { argv: launchPiArgv(argv, provider, model, `${appHome()}/mods/orca-agent-flyout/pi-provider.mjs`) };
    }
    if (this.key === "claude") return { argv: launchClaudeArgv(argv, provider, model) };
    if (this.key === "opencode") {
      if (!supportsCodingModel(info)) return { error: "OpenCode needs a text model with tool support." };
      return { argv: launchOpenCodeArgv(argv, provider, model) };
    }
    return { argv: launchArgv(argv, provider, model) };
  }

  // The flyout is sticky; availability may have changed while it was open. Local settings only.
  async readManagerSettings() {
    const manager = await readTextFile(`${appHome()}/agent-manager.json`).catch(() => null);
    return parseManagerSettings(manager);
  }

  // Stops a launch: shows the reason, if there is one, and lets the next click try again.
  failLaunch(message, cx) {
    if (message) this.error = message;
    this.launching = false;
    cx?.notify();
  }

  async launch(cx) {
    const p = this.context();
    if (!this.current() || this.launching) return;
    this.launching = true; // the mcp listing awaits; a second click must not launch twice
    const space = launchSpace(p);
    if (this.settingsContext && (!space || space.machine)) { this.failLaunch(null, cx); return; }
    const manager = await this.readManagerSettings();
    if (!space?.machine && manager.disabled.has(p.key)) {
      this.failLaunch(`${p.name ?? p.key} is disabled in Agent Settings.`, cx);
      return;
    }

    const built = await this.buildLaunch(p);
    if (!built.argv) {
      this.failLaunch(built.error, cx);
      return;
    }

    const argv = manager.herdrEnv ? ["env", "HERDR_ENV=1", ...built.argv] : built.argv;
    await this.startTerminal(p, space, argv, cx);
  }

  async startTerminal(p, space, argv, cx) {
    this.remember();
    // Launch uses the live editor text and never writes it; editors stay manual save.
    // argv elements, not shell words: no quotes around the JSON or the prompt.
    if (this.spec.wrap?.after === "opencodeVariant") await this.rememberVariant();
    run("tab.new", {
      space: space?.id,
      ...(space?.folder ? { folder: space.folder } : {}),
      argv,
    });
    if (this.settingsContext) {
      this.launching = false;
      run("layout.select", { stack: "main", child: "main-terminals" });
      cx?.notify();
    } else {
      setShared("orca-agent-flyout", null);
      closeOverlay(p.overlay);
      closeOverlay(p.menu);
    }
  }

  // opencode keeps the chosen effort in ~/.local/state/opencode/model.json `variant`; write it
  // before launch. Best effort only: a failure must not block the launch.
  async rememberVariant() {
    if (this.effort == null) return;
    const file = `${home()}/.local/state/opencode/model.json`;
    try {
      const current = await readTextFile(file).catch(() => null);
      const all = current ? JSON.parse(current) : {};
      const variant = all.variant && typeof all.variant === "object" ? all.variant : {};
      if (this.effort) variant[this.model] = this.effort;
      else delete variant[this.model]; // Default: no saved variant
      all.variant = variant;
      await writeTextFile(file, `${JSON.stringify(all, null, 2)}\n`, current);
    } catch { /* best effort, as above: the launch goes on without the saved variant */ }
  }

  modelRow(m, t) {
    const on = this.model === m.id;
    const hidden = this.hidden.has(m.id);
    return this.listRow(`model-${m.id}`, t)
      .flex_none()
      .on_click((_e, cx) => {
        this.choose(m, this.effort);
        this.open = null;
        this.groupOpen = false;
        this.remember();
        cx.notify();
      })
      .child(div().flex_1().min_w(0).truncate().text_color(hidden ? t.muted : t.foreground).child(m.label))
      .when(on, (el) => el.child(div().flex_none().text_color(t.accent).child("✓")))
      .child(
        div()
          .id(`visibility-${m.id}`)
          .flex_none()
          .p(2)
          .rounded(4)
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => {
            // The eye is a control inside the row: toggling it must not also select the model.
            cx.stop_propagation();
            this.toggleHidden(m.id);
            cx.notify();
          })
          .child(svg(hidden ? "mods/orca-assets/eye-off.svg" : "mods/orca-assets/eye--orca-agent-flyout.svg").size(14).text_color(t.muted)),
      );
  }

  // opencode mixes cloud models (free/paid) and local omlx models; the list shows one group.
  groupSelect(t) {
    return h_flex()
      .id("model-group")
      .w(80)
      .h(ROW.height)
      .px(8)
      .gap(6)
      .items_center()
      .justify_between()
      .rounded(ROW.radius)
      .border_1()
      .border_color(this.groupOpen ? t.ring : t.input)
      .bg(t.raised)
      .cursor_pointer()
      .on_click((_e, cx) => {
        this.groupOpen = !this.groupOpen;
        cx.notify();
      })
      .child(div().text_size(11).text_color(t.foreground).child(this.groupOption().groups.find((g) => g.id === this.modelGroup)?.label ?? this.modelGroup))
      .child(div().text_size(10).text_color(t.muted).child("▾"));
  }

  // The models the list shows: the chosen group's (opencode), else the active source's.
  shownModels() {
    if (!this.groupOption()) return this.activeModels() ?? [];
    return (this.models ?? []).filter((m) => this.modelGroup === "all" || (m.group ?? (m.free ? "free" : "paid")) === this.modelGroup);
  }

  // The "-- hidden --" heading and, when expanded, the hidden models under it.
  hiddenRows(hiddenModels, t) {
    if (hiddenModels.length === 0) return [];
    return [
      div()
        .id("hidden-section")
        .px(14)
        .pt(6)
        .text_size(11)
        .text_color(t.dim)
        .cursor_pointer()
        .on_click((_e, cx) => {
          this.showHidden = !this.showHidden;
          cx.notify();
        })
        .child("-- hidden --"),
      ...(this.showHidden ? hiddenModels.map((m) => this.modelRow(m, t)) : []),
    ];
  }

  // The group filter: a "SHOW" row with its select, and the list under it while it is open.
  withGroupFilter(el, t) {
    return el
      .child(
        h_flex()
          .mx(6)
          .mb(2)
          .h(ROW.height)
          .px(4)
          .gap(8)
          .items_center()
          .child(div().flex_1().text_size(11).text_color(t.muted).child("SHOW"))
          .child(this.groupSelect(t)),
      )
      .when(this.groupOpen, (inner) => inner.child(
        v_flex()
          .mx(6)
          .mb(2)
          .py(2)
          .rounded(6)
          .border_1()
          .border_color(t.border)
          .bg(t.popover)
          .child(this.scrollList("group-list", this.groupOption().groups.map((g) =>
            this.listRow(`group-${g.id}`, t, 4)
              .on_click((_e, cx) => {
                this.modelGroup = g.id;
                this.groupOpen = false;
                this.rememberGroup();
                cx.notify();
              })
              .child(div().flex_1().text_size(12).text_color(t.foreground).child(g.label))
              .when(this.modelGroup === g.id, (row) => row.child(div().text_color(t.accent).child("✓"))),
          ))),
      ));
  }

  // Visible models, then the collapsed "-- hidden --" section: the list as the other agents show it.
  modelList(t) {
    const all = this.shownModels();
    const visible = all.filter((m) => !this.hidden.has(m.id));
    const hiddenModels = all.filter((m) => this.hidden.has(m.id));
    // Rows actually rendered: visible plus (if expanded) hidden ones; the hidden heading counts
    // as a row whenever anything is hidden, so a list of only hidden models cannot collapse to
    // zero height and hide the way back. scrollList gives it its height (list-viewport.js).
    const rows = [...visible.map((m) => this.modelRow(m, t)), ...this.hiddenRows(hiddenModels, t)];
    return v_flex()
      .gap(2)
      .when(this.groupOption(), (el) => this.withGroupFilter(el, t))
      .child(this.scrollList("agent-config-models", rows))
      .child(
        div()
          .id("refresh-models")
          .mx(6)
          .px(4)
          .h(ROW.height)
          .flex()
          .items_center()
          .text_size(11)
          .text_color(t.muted)
          .cursor_pointer()
          .on_click((_e, cx) => this.refresh(cx))
          .child(this.refreshing ? "Refreshing…" : "↻ Refresh list"),
      );
  }

  // A provider's icon sits in a small tile: the file saved in this app's folder, else the default
  // drive; None gets a plain circle. Without a record the tile is None's.
  providerIcon(record, t) {
    return div().size(24).flex_none().flex().items_center().justify_center().rounded(6).bg(t.raised).child(providerGlyph(record, t));
  }

  // The agent's own icon, shown for the default origin (no-provider) model source.
  agentIcon(t) {
    const byKey = { claude: "claude.svg", codex: "codex--orca-header.svg", opencode: "opencode.svg" };
    const file = byKey[this.key];
    if (!file) return svg("mods/orca-assets/bot.svg").size(18).text_color(t.muted);
    return svg(`mods/orca-assets/${file}`).size(18);
  }

  // Model source: an expanded list of the default origin source (the agent itself, shown with its
  // icon) plus any saved providers. Replaces the old MODEL SOURCE select: it now sits on the same
  // layer as MODEL and EFFORT.
  providerRow(t) {
    const ids = Object.keys(this.providers ?? {});
    const space = launchSpace(this.context());
    const remote = !this.settingsContext && Boolean(space?.machine);
    const enabled = !remote;
    const label = this.providerId === "none" ? "Origin source" : this.providers[this.providerId]?.name ?? "None";
    return v_flex()
      .gap(4)
      .child(
        h_flex()
          .id("provider-wrap")
          .items_center()
          .gap(6)
          .when(!enabled, (el) => el.opacity(0.5))
          .role("group")
          .accessibility_label(`Model source: ${label}`)
          .tooltip(providerTooltip(remote, ids.length))
          .child(div().text_size(9).text_color(t.dim).child("MODEL SOURCE"))
          .child(div().flex_1())
      )
      .child(this.sourceList(t, enabled));
  }

  // The expanded model source list: the origin source (agent icon) first, then saved providers.
  sourceList(t, enabled) {
    const rows = [
      { id: "none", label: "Origin source", icon: this.agentIcon(t) },
      ...Object.entries(this.providers ?? {}).map(([id, record]) => ({ id, label: record?.name ?? id, icon: this.providerIcon(record, t) })),
    ];
    return v_flex()
      .gap(2)
      .child(this.scrollList("source-list",
        rows.map((option) =>
          this.listRow(`source-${option.id}`, t)
            .when(!enabled, (el) => el.opacity(0.5))
            .when(enabled, (el) => el.on_click((_e, cx) => this.setProvider(option.id, cx)))
            .child(option.icon)
            .child(div().flex_1().min_w(0).truncate().child(option.label))
            .when(this.providerId === option.id, (el) => el.child(div().flex_none().text_color(t.accent).child("✓"))),
        )
      ));
  }

  // The flyout's rhythm: a block is a label, 8px of air, then its controls. Blocks are 14px apart
  // with a hairline between, and the label sits 12px under it (6px under the title for the first).
  sectionHead(title, t, first = false) {
    const advanced = title === "HARNESS CLI ADVANCED ARGUMENTS";
    return h_flex().mx(8).mt(first ? 6 : 12).mb(8).items_center().gap(6).text_size(10).font_medium().text_color(t.dim)
      .when(advanced, el => el.role("button").accessibility_label(`${title}, ${this.collapsedAdvanced ? "collapsed" : "expanded"}`).cursor_pointer()
        .on_click((_e, cx) => this.toggleAdvanced(cx)))
      .child(div().flex_1().child(title))
      .when(advanced, el => el.child(div().flex_none().text_size(12).child(this.collapsedAdvanced ? "›" : "⌄")));
  }

  divider(t) {
    return div().h(1).mx(6).mt(14).bg(t.border);
  }

  providerList(t) {
    const options = [
      { id: "none", label: "None" },
      ...Object.entries(this.providers ?? {}).map(([id, record]) => ({ id, label: record?.name ?? id })),
    ];
    return this.scrollList("provider-list",
      options.map((option) =>
        this.listRow(`provider-${option.id}`, t)
          .on_click((_e, cx) => this.setProvider(option.id, cx))
          .child(this.providerIcon(option.id === "none" ? null : this.providers[option.id], t))
          .child(div().flex_1().min_w(0).truncate().child(option.label))
          .when(this.providerId === option.id, (el) => el.child(div().flex_none().text_color(t.accent).child("✓"))),
      ).concat(
        // The way to a new provider: the Model providers page, with this menu and flyout closed.
        this.listRow("provider-add", t)
          .on_click(() => this.openProviders())
          .child(div().size(24).flex_none().flex().items_center().justify_center().rounded(6).bg(t.raised).child(svg("mods/orca-assets/plus--orca-agent-flyout.svg").size(13).text_color(t.muted)))
          .child(div().flex_1().min_w(0).truncate().child("Add More")),
      ));
  }

  openProviders() {
    const p = this.context();
    run("layout.select", { stack: "main", child: "main-providers" });
    setShared("orca-agent-flyout", null);
    if (!this.settingsContext) { closeOverlay(p.overlay); closeOverlay(p.menu); }
  }

  effortList(t) {
    return this.scrollList("effort-list",
      (this.current()?.efforts ?? []).map((e) =>
        this.listRow(`effort-${e}`, t)
          .on_click((_e, cx) => {
            this.effort = e;
            this.open = null;
            this.remember();
            cx.notify();
          })
          .child(div().flex_1().child(EFFORT_LABEL[e] ?? e))
          .when(this.effort === e, (el) => el.child(div().text_color(t.accent).child("✓"))),
      ));
  }

  // The one look of a list row (ROW in list-viewport.js): the same height, radius, padding, gap,
  // text size and hover in every list. Only what a row holds differs: an icon tile, a label, a
  // check or a checkbox. `inset` is the space to the list's edge.
  listRow(id, t, inset = 6) {
    return h_flex()
      .id(id)
      .h(ROW.height)
      .mx(inset)
      .px(ROW.padX)
      .gap(ROW.innerGap)
      .items_center()
      .rounded(ROW.radius)
      .text_size(ROW.text)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover));
  }

  // A list of rows under the shared rule (list-viewport.js): as tall as its rows up to five, then five
  // and a half rows with a scrollbar, drawn like the Agent Settings lists. A definite height is
  // needed because gpui does not clamp a content-sized flex item to max-height; the rows sit in an
  // absolutely placed scroller inside it. The wheel stops at the list so the popup does not move.
  scrollList(id, rows) {
    const { height, gap } = ROW;
    if (!scrolls(rows.length)) return v_flex().w_full().gap(gap).children(rows);
    return div()
      .w_full()
      .flex_none()
      .relative()
      .overflow_hidden()
      .h(viewportHeight(rows.length, height, gap))
      .on_scroll_wheel((_e, cx) => cx.stop_propagation())
      .child(v_flex().id(id).w_full().absolute().inset_0().overflow_y_scroll().gap(gap).children(rows))
      .child(Scrollbar.vertical(id).absolute().inset_0());
  }

  selectBox({ id, label, value, open, onToggle, t, valueEl = null, borderColor = null, disabled = false }) {
    return h_flex()
      .id(id)
      .flex_1()
      .min_w(0)
      .h(40)
      .px(10)
      .gap(8)
      .items_center()
      .justify_between()
      .rounded(7)
      .border_1()
      .border_color(borderColor ?? (open ? t.ring : t.input))
      .bg(t.raised)
      .when(!disabled, (el) => el.cursor_pointer().on_click((_e, cx) => onToggle(cx)))
      .child(
        v_flex()
          .min_w(0)
          .child(div().text_size(9).text_color(t.dim).child(label))
          .child(valueEl ?? div().text_size(12).text_color(t.foreground).truncate().child(value)),
      )
      .child(div().flex_none().text_size(11).text_color(t.muted).child("▾"));
  }

  optionList(id, options, current, onPick, t) {
    return this.scrollList(`${id}-list`,
      options.map((name) =>
        this.listRow(`${id}-${name}`, t)
          .on_click((_e, cx) => onPick(name, cx))
          .child(div().flex_1().child(name))
          .when(name === current, (el) => el.child(div().text_color(t.accent).child("✓"))),
      ));
  }

  // One select list is open at a time, inline below its row.
  toggle(id, cx) {
    this.open = this.open === id ? null : id;
    this.groupOpen = false;
    cx.notify();
  }

  // The select an option draws, or null when there is nothing to pick (a model without efforts).
  selectControl(id, t) {
    const option = this.spec.options[id];
    if (option.type === "model") {
      return this.selectBox({ id: "model-select", label: option.label, value: this.current()?.label ?? "…", open: this.open === "model", onToggle: (cx) => this.toggle("model", cx), t });
    }
    if (option.type === "effort") {
      if ((this.current()?.efforts ?? []).length === 0) return null; // a model without effort variants has nothing to pick
      return this.selectBox({ id: "effort-select", label: option.label, value: EFFORT_LABEL[this.effort] ?? this.effort ?? "…", open: this.open === "effort", onToggle: (cx) => this.toggle("effort", cx), t });
    }
    if (option.type === "toggle") return this.toggleControl(id, option, t); // inline on/off, never a dropdown
    return this.choiceSelect(id, option, t);
  }

  // A select with a hooked list (output styles) can also ask for a new name in place.
  choiceSelect(id, option, t) {
    const styles = option.source === "claudeOutputStyles";
    return this.selectBox({
      id: `${id}-select`,
      label: this.choiceLabel(option, styles),
      value: this.values[id],
      open: this.open === id || (styles && this.naming),
      onToggle: (cx) => {
        if (styles && this.naming) return;
        this.toggle(id, cx);
      },
      t,
      valueEl: styles && this.naming ? this.nameEntry() : null,
      borderColor: styles && this.nameError ? dangerColor() : null,
    });
  }

  choiceLabel(option, styles) {
    if (styles && this.nameError) return "LETTERS, DIGITS, - _ ONLY";
    return styles && this.naming ? "NEW OUTPUT STYLE" : option.label;
  }

  nameEntry() {
    return div().flex_1().min_w(0).on_key_down((e, cx) => {
      if (e.key === "escape") { this.cancelNaming(cx); cx.stop_propagation(); }
    }).child(Input.new(this.styleInput));
  }

  // The list a select opens: models, efforts, or the option's choices. Toggles are inline and never
  // open a list.
  listFor(id, t) {
    const option = this.spec.options[id];
    if (option.type === "model") return this.modelList(t);
    if (option.type === "effort") return this.effortList(t);
    if (option.type === "toggle") return v_flex();
    const choices = option.source === "claudeOutputStyles" ? [...this.styles, NEW_STYLE] : option.choices;
    return this.optionList(id, choices, this.values[id], (name, cx) => this.pickChoice(id, name, cx), t);
  }

  // Selects side by side as one row; the open list shows inline below it.
  selectRow(ids, t) {
    const box = (list) => v_flex().mx(6).py(4).rounded(8).border_1().border_color(t.border).bg(t.popover).child(list);
    const cells = ids.map((id) => this.selectControl(id, t)).filter(Boolean);
    return [
      h_flex().mx(6).gap(8).children(cells),
      ...ids.filter((id) => this.open === id && this.selectControl(id, t)).map((id) => box(this.listFor(id, t))),
    ];
  }

  // Tick an item to launch with its argument: a bordered box, bulk links, a list that scrolls.
  checklist(id, t) {
    const option = this.spec.options[id];
    const on = new Set(this.values[id]);
    const link = (key, label, all) =>
      div().id(key).cursor_pointer().text_size(10).text_color(t.accent).hover((s) => s.opacity(0.7)).on_click((_e, cx) => this.setAllItems(id, all, cx)).child(label);
    return v_flex()
      .mx(6)
      .py(6)
      .px(10)
      .gap(4)
      .rounded(7)
      .border_1()
      .border_color(t.input)
      .bg(t.raised)
      .child(
        h_flex().gap(8).items_center()
          .child(div().flex_1().text_size(9).text_color(t.dim).child(option.label))
          .when(option.bulk, (el) => el.child(link(`${id}-all`, "all", true)).child(link(`${id}-clear`, "clear", false))),
      )
      .child(
        this.scrollList(`${id}-list`,
          option.items.map((item) => {
            const checked = on.has(item.id);
            return this.listRow(`${id}-${item.id}`, t, 0)
              .flex_shrink(0)
              .on_click((_e, cx) => this.toggleItem(id, item.id, cx))
              .child(
                div().size(14).flex_none().flex().items_center().justify_center().rounded(3).border_1()
                  .border_color(checked ? t.accent : t.muted).text_size(10).text_color(t.accent).child(checked ? "✓" : ""),
              )
              .child(item.label ?? item.id);
          })),
      );
  }

  // A text editor under a title row with its status and Save: JSON in mono with a validity badge,
  // or plain text with its length. Two siblings, so the section lays them out like its other rows.
  editorElements(id, t) {
    const option = this.spec.options[id];
    const editor = this.editors[id];
    const json = option.language === "json";
    const mono = settings()?.font_family ?? "JetBrains Mono";
    const danger = dangerColor();
    const badge = jsonBadge(editor, danger, t);
    const save = h_flex()
      .id(`save-${id}`)
      .items_center()
      .justify_center()
      .size(22)
      .rounded(5)
      .bg(t.accent)
      .text_color(t.accent_foreground)
      .cursor_pointer()
      .tooltip("Save")
      .accessibility_label("Save")
      .on_click((_e, cx) => this.saveEditor(id, cx))
      .child(svg("mods/orca-assets/save.svg").size(14));
    const head = h_flex()
      .mx(6)
      .mt(2)
      .gap(8)
      .items_center()
      .child(div().text_size(12).font_medium().text_color(t.foreground).child(option.label))
      .child(div().flex_1())
      .when(json, (el) =>
        el.child(
          h_flex().items_center().justify_center().px(8).h(22).rounded(6).border_1().border_color(badge.border).bg(badge.bg).text_size(10).text_color(badge.color).child(badge.text),
        ),
      )
      .when(!json, (el) =>
        el
          .child(div().text_size(10).text_color(editor.dirty ? t.working : t.done).child(editor.dirty ? "Unsaved changes" : "Saved"))
          .child(div().text_size(10).text_color(t.muted).child(`${editor.input.value().length} chars`)),
      )
      .child(save);
    const box = v_flex()
      .mx(6)
      .rounded(8)
      .border_1()
      .border_color(editor.error ? danger : t.border)
      .bg(t.raised)
      .child(
        // Mono keeps the two-space JSON indent visible; the padding matches orca-changes' message box.
        (json ? div().px(8).py(6).font_family(mono) : div().px(8).py(6))
          .child(
            (json ? Textarea.new(editor.input).w_full().font_family(mono) : Textarea.new(editor.input).w_full())
              .text_size(json ? 11 : 12)
              .text_color(t.foreground)
              .bg("#00000000"),
          ),
      );
    return [head, box];
  }

  // One section's controls, in its option order; options named in a `ui.rows` row share one line.
  sectionBody(section, t) {
    if (section.title === "HARNESS CLI ARGUMENTS") return this.argumentControls(t);
    const rows = this.spec.ui?.rows ?? [];
    const done = new Set();
    const parts = [];
    for (const id of section.options) {
      if (done.has(id)) continue;
      const option = this.spec.options[id];
      const row = rows.find((ids) => ids.includes(id));
      if (row) {
        const ids = row.filter((rowId) => section.options.includes(rowId));
        ids.forEach((rowId) => done.add(rowId));
        parts.push(...this.selectRow(ids, t));
      } else if (option.type === "provider") parts.push(this.providerRow(t));
      else if (option.type === "checklist") parts.push(this.checklist(id, t));
      else if (option.type === "editor") parts.push(...this.editorElements(id, t));
      else parts.push(...this.selectRow([id], t));
    }
    return v_flex().w_full().gap(section.gap ?? 8).children(parts);
  }

  // HARNESS CLI ARGUMENTS: model source, model and effort are shown as expanded lists side by side
  // on the same row (no separate MODEL SOURCE section), with the FAST toggle on effort's right.
  // effort is drawn narrower than model so the row stays compact.
  argumentControls(t) {
    return h_flex()
      .mx(6)
      .gap(10)
      .items_start()
      .child(this.providerRow(t))   // model source: origin source (agent icon) + providers
      .child(this.modelControl(t))  // model: expanded list, takes remaining width
      .child(this.effortControl(t)) // effort: expanded list, narrower
      .child(this.fastControl(t));  // fast: on/off toggle
  }

  // A bordered box holding a list, matching the look of an opened select.
  listBox(list, t) {
    return v_flex().mx(6).py(4).rounded(8).border_1().border_color(t.border).bg(t.popover).child(list);
  }

  modelControl(t) {
    return v_flex()
      .gap(2)
      .child(div().text_size(9).text_color(t.dim).child("MODEL"))
      .child(this.listBox(this.modelList(t), t))
      .flex_1();
  }

  // Effort control drawn narrower than model.
  effortControl(t) {
    const efforts = (this.current()?.efforts ?? []);
    return v_flex()
      .gap(2)
      .child(div().text_size(9).text_color(t.dim).child("EFFORT"))
      .child(
        efforts.length
          ? this.listBox(this.effortList(t), t)
          : div().px(4).py(2).rounded(4).bg(t.raised).text_size(10).text_color(t.muted).child("—")
      )
      .w(130);
  }

  // FAST on/off toggle on effort's right hand side.
  fastControl(t) {
    return this.toggleControl("fast", this.spec.options.fast, t);
  }

  // An on/off toggle for a boolean option. Only enabled when the CLI supports the flag (fast).
  toggleControl(id, option, t) {
    const on = Boolean(this.values[id]);
    const enabled = id === "fast" ? this.fastSupported === true : true;
    return h_flex().items_center().gap(6)
      .child(div().text_size(9).text_color(t.dim).child(option.label))
      .child(
        h_flex()
          .h(24)
          .px(8)
          .rounded(6)
          .border_1()
          .border_color(enabled ? (on ? t.accent : t.input) : t.border)
          .bg(on && enabled ? t.accent : t.raised)
          .text_size(10)
          .when(enabled, (el) => el.cursor_pointer().on_click((_e, cx) => {
            this.values[id] = !on;
            this.rememberPreset();
            cx.notify();
          }))
          .when(!enabled, (el) => el.opacity(0.5))
          .child(div().flex_none().text_color(on && enabled ? t.accent_foreground : t.foreground).child(on ? "ON" : "OFF"))
      );
  }

  openAgentSettings() {
    const p = this.context();
    setShared("agent-manager.open-agent", { key: this.key });
    run("orca-header.agent-settings");
    setShared("orca-agent-flyout", null);
    closeOverlay(p.overlay);
    closeOverlay(p.menu);
  }

  showSettingsShortcut() { return !this.settingsContext; }

  header(t) {
    return h_flex()
      .h(26)
      .mx(6)
      .mb(2)
      .gap(8)
      .items_center()
      .child(div().text_size(13).font_medium().text_color(t.foreground).child(this.settingsContext ? "Harness CLI arguments" : this.spec.label))
      .child(div().flex_1())
      .when(this.models && this.spec.ui?.reset, (el) => el.child(
        h_flex()
          .id("reset-preset")
          .h(24)
          .px(6)
          .gap(6)
          .items_center()
          .rounded(6)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.resetPreset(cx))
          .child(div().text_size(10).text_color(t.muted).child("Reset defaults"))
          .child(svg("mods/orca-assets/rotate-ccw--orca-agent-flyout.svg").size(14).text_color(t.muted)),
      ))
      .when(this.showSettingsShortcut(), el => el.child(div().id("agent-full-settings").size(26).flex().items_center().justify_center()
        .role("button").accessibility_label("Open " + this.spec.label + " settings")
        .tooltip("Open agent settings on this computer")
        .text_color(t.muted).cursor_pointer().hover(s => s.text_color(t.foreground))
        .on_click((_e,cx) => { cx.stop_propagation(); this.openAgentSettings(); })
        .child(svg("mods/orca-assets/bot.svg").size(19))));
  }

  // Page preview is strictly read-only. Rebuild with the same argv path as launch, including
  // provider wrappers and async expansions. A stale completion must not overwrite a newer draft.
  previewSignature(argv) {
    return JSON.stringify([argv, this.values, this.providerId, Boolean(this.current()),
      this.settingsContext?.herdrEnv !== false,
      Object.entries(this.editors ?? {}).map(([id, editor]) => [id, editor.input.value()])]);
  }

  async buildPreview(argv) {
    if (!this.settingsLoaded || !this.current()) return { error: "Choose an available model before previewing the command." };
    const result = await this.buildLaunch({ argv }, { preview: true });
    if (result.argv && this.settingsContext?.herdrEnv !== false) result.argv = ["env", "HERDR_ENV=1", ...result.argv];
    return result.argv ? result : { error: result.error ?? "Fix invalid JSON to preview the command." };
  }

  syncPreview(argv, cx) {
    const signature = this.previewSignature(argv);
    if (signature === this.previewKey) return;
    this.previewKey = signature;
    const generation = this.previewGeneration = (this.previewGeneration ?? 0) + 1;
    this.previewResult = null;
    cx.spawn(async taskCx => {
      let result;
      try { result = await this.buildPreview(argv); }
      catch (e) { result = { error: String(e?.message ?? e) }; }
      if (this.previewKey !== signature || this.previewGeneration !== generation) return;
      this.previewResult = result;
      taskCx.notify();
    });
  }

  renderSettings(t, cx, { argv, format, copy, enabled = false }) {
    if (this.settingsLoaded && this.models) this.syncPreview(argv, cx);
    const preview = this.previewResult;
    const command = preview?.argv ? format(preview.argv) : null;
    return v_flex().id("am-harness-form").w_full().min_w(0).gap(6)
      .child(this.header(t))
      .when(!this.models && !this.error, el => el.child(div().px(8).py(6).text_color(t.muted).child("Loading models…")))
      .when(Boolean(this.error), el => el.child(div().px(8).py(6).text_color(t.blocked).child(this.error)))
      .when(Boolean(this.settingsSaveError), el => el.child(div().px(8).text_color(t.blocked).child("Could not save: " + this.settingsSaveError)))
      .when(this.settingsLoaded, el => el.children(sectionsOf(this.spec).flatMap((section, at) => [
        ...(at ? [this.divider(t)] : []), this.sectionHead(section.title,t,at===0),
        ...(section.title === "HARNESS CLI ADVANCED ARGUMENTS" && this.collapsedAdvanced ? [] : [this.sectionBody(section,t)]),
      ])))
      .child(this.divider(t))
      .child(this.settingsPreview(t, { command, argv, copy }))
      .child(this.settingsLaunch(t, { command, argv, enabled }));
  }

  settingsPreview(t, { command, argv, copy }) {
    const unavailable = this.error ? "Command preview unavailable." : "Building command…";
    return v_flex().w_full().gap(6)
      .child(h_flex().items_center().gap(8)
        .child(div().flex_1().font_semibold().text_color(t.foreground).child("Preview command"))
        .when(Boolean(command), el => el.child(div().id("am-copy-command").px(8).h(24).rounded(6).flex().items_center()
          .role("button").accessibility_label("Copy command").cursor_pointer().hover(s => s.bg(t.hover))
          .on_click((_e,eventCx) => { if (this.previewKey === this.previewSignature(argv)) copy(command,eventCx); })
          .child("Copy"))))
      .child(div().w_full().p(10).rounded(8).bg(t.surface).border_1().border_color(t.border)
        .font_family(settings()?.font_family ?? "JetBrains Mono").text_size(11).text_color(command ? t.foreground : t.muted)
        .child(command ?? this.previewResult?.error ?? unavailable))
      .when(Boolean(command), el => el.child(div().text_size(10).text_color(this.settingsContext?.herdrEnv === false ? t.dim : t.done)
        .child(this.settingsContext?.herdrEnv === false ? "HERDR_ENV: not set" : "HERDR_ENV=1")))
      .when(this.spec.wrap?.after === "opencodeVariant" && Boolean(command), el => el.child(div().text_size(11).text_color(t.muted)
        .child("OpenCode effort is stored separately as its model variant; it is not an argv flag.")));
  }

  settingsLaunch(t, { command, argv, enabled }) {
    const active = (spaces() ?? []).find(space => space.active);
    const canLaunch = Boolean(command && enabled && active && !active.machine && !this.launching);
    return h_flex().items_center().gap(8)
      .child(div().flex_1().text_size(11).text_color(t.muted)
        .child("Selections save automatically. Text editors have their own Save control."))
      .child(div().id("am-launch-from-settings").h(30).px(12).rounded(7).flex().items_center().justify_center()
        .role("button").accessibility_label("Launch terminal")
        .bg(canLaunch ? t.accent : t.raised).text_color(canLaunch ? t.accent_foreground : t.muted)
        .tooltip(active?.machine ? "Choose a local workspace to launch this agent" : "Launch with the current configuration")
        .when(canLaunch, el => el.cursor_pointer().on_click((_e,eventCx) => {
          if (this.previewKey !== this.previewSignature(argv)) return;
          this.settingsContext = { ...this.settingsContext, argv, space: active.id };
          this.launch(eventCx);
        }))
        .child("Launch terminal"));
  }

  render() {
    const t = theme();
    const sections = sectionsOf(this.spec);
    return v_flex()
      .id("orca-agent-flyout")
      // Fills the popup; its width is set where orca-new-menu opens it.
      .w_full()
      .p(6)
      .gap(2)
      .bg(t.popover)
      .text_size(12)
      .when(this.models || this.showSettingsShortcut(), (el) => el.child(this.header(t)))
      .when(!this.models && !this.error, (el) => el.child(div().px(14).py(6).text_color(t.muted).child("Loading models…")))
      .when(Boolean(this.error), (el) => el.child(div().px(14).py(6).text_color(t.blocked).child(this.error)))
      .when(this.models, (el) =>
        el.children(sections.flatMap((section, at) => [
          ...(at > 0 ? [this.divider(t)] : []),
          this.sectionHead(section.title, t, at === 0),
          ...(section.title === "HARNESS CLI ADVANCED ARGUMENTS" && this.collapsedAdvanced ? [] : [this.sectionBody(section, t)]),
        ])),
      )
      .child(
        h_flex()
          .id("launch")
          .h(34)
          .mx(6)
          .mt(14)
          .px(12)
          .gap(8)
          .items_center()
          .rounded(7)
          .cursor_pointer()
          .bg(t.accent)
          .text_color(t.background)
          .on_click((_e, cx) => this.launch(cx))
          .child(svg("mods/orca-assets/square-terminal--orca-agent-flyout.svg").size(16).flex_none())
          .child(div().flex_1().child("Launch terminal"))
          .child(div().flex_none().text_size(13).child("↵")),
      );
  }
}

// The native popup must extend View; the settings page uses an ordinary controller.
// Preserve method/getter descriptors without wrapping calls or changing their timing.
export function createAgentConfigClass(Base = class {}) {
  class AgentConfig extends Base {}
  const methods = Object.getOwnPropertyDescriptors(AgentConfigCore.prototype);
  delete methods.constructor;
  Object.defineProperties(AgentConfig.prototype, methods);
  return AgentConfig;
}
// Generated from orca-ui/shared/agent-config-view.js by scripts/build-orca-ui.mjs. Edit that file, not this copy.
