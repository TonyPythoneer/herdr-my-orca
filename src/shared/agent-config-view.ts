import {
  div,
  image,
  svg,
  type Color,
  type Context,
  type Element,
  type NativeElement,
  type ViewClass,
} from "gpui-kit";
import {
  v_flex,
  h_flex,
  TextareaState,
  Textarea,
  InputState,
  Input,
  Scrollbar,
  HoverCard,
} from "gpui-base";
import {
  checking,
  run,
  props,
  closeOverlay,
  theme,
  setShared,
  exec,
  appHome,
  home,
  readTextFile,
  writeTextFile,
  settings,
  spaces,
} from "herdr";
import {
  PROVIDER_FILE,
  launchArgv,
  launchClaudeArgv,
  launchOpenCodeArgv,
  launchPiArgv,
  parseProviderFile,
  piModelLimits,
  serializeProviderFile,
  supportsCodingModel,
  validateHost,
  writeProviderFile,
  type ModelInfo,
  type Provider,
} from "./codex-provider.js";
import { viewportHeight, scrolls, ROW, VISIBLE_ROWS } from "./list-viewport.js";
import { selectionMark } from "./selection-ui.js";
import { themeColor } from "./theme-color.js";
import {
  SPECS,
  buildArgv,
  defaultValues,
  parseModels,
  presetOf,
  readGroup,
  readValues,
  sectionsOf,
  type AgentSpec,
  type ModelEntry,
  type OptionSpec,
} from "./agent-flyout.js";

type AgentKey = keyof typeof SPECS;
type CatalogModel = ModelEntry;
type CatalogEntry = {
  schema?: number;
  version?: string | null;
  checkedAt?: number;
  models?: CatalogModel[];
};
type SettingsFile = { catalog?: Record<string, CatalogEntry> } & Record<string, unknown>;
type ThemeTokens = Record<string, Color> & { accent: Color; surface: Color; hover: Color };
type GroupOption = OptionSpec & { groups: Array<{ id: string; label: string }> };
type SelectBoxOptions = {
  id: string;
  label: string;
  value: string;
  open: boolean;
  onToggle: (cx: Context) => void;
  t: ThemeTokens;
  valueEl?: Element | null;
  borderColor?: Color | null;
  disabled?: boolean;
};
type PreviewCommand = {
  argv: string[];
  format: (argv: string[]) => string;
  copy: (command: string, cx: Context) => void;
  enabled?: boolean;
};
type JsonRecord = Record<string, unknown>;
type JsonEditor = { error: { line: number } | null; dirty: boolean };
type AgentSettingsContext = {
  key?: string;
  name?: string;
  argv?: string[];
  space?: string;
  machine?: string | null;
  folder?: string;
  overlay?: string;
  menu?: string;
  icon?: string;
  launchNow?: boolean;
  herdrEnv?: boolean;
};
type ProviderRecord = JsonRecord & {
  name?: string;
  host: string;
  apiKey?: string;
  iconPath?: string;
  models?: string[];
  modelInfo?: Record<string, ModelInfo>;
  selectedModel?: Partial<Record<AgentKey, string>>;
};
type EditorState = {
  input: TextareaState;
  dirty: boolean;
  error: { message: string; line: number } | null;
};
type ValueState = Record<string, unknown> & { model: string | null; effort?: string | null };
type SavedState = JsonRecord & {
  model?: string | null;
  effort?: string | null;
  hidden?: string[];
  advancedArgumentsCollapsed?: boolean;
  preset?: Record<string, unknown>;
};
type PreviewResult = { argv?: string[]; error?: string };
type GatewayRoute = {
  direct?: boolean;
  model?: string;
  host?: string;
  aliases?: Record<string, string>;
  configPath?: string;
  id?: string;
  error?: string;
};
type GatewayRouteResult = { error?: string; route?: GatewayRoute };
type LaunchResult = { blocked?: true; argv?: string[]; error?: string };

const errorMessage = (error: unknown): string =>
  String((error as { message?: unknown } | null)?.message ?? error);

async function codexMcpOff(): Promise<string[]> {
  try {
    const toml = await readTextFile(`${home()}/.codex/config.toml`);
    return [...(toml as string).matchAll(/^\[mcp_servers\.("[^"]+"|[\w-]+)\]\s*$/gm)].flatMap(
      (m) => ["-c", `mcp_servers.${m[1]}.enabled=false`],
    );
  } catch {
    return [];
  }
}

const EXPANSIONS: Record<string, () => Promise<string[]>> = { codexMcp: codexMcpOff };

const EFFORT_LABEL: Record<string, string> = {
  "": "Default",
  off: "Off",
  minimal: "Min",
  low: "Low",
  medium: "Med",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
  ultra: "Ultra",
};
const BUILTIN_STYLES = ["default", "Explanatory", "Learning"];
const NEW_STYLE = "+ New style…";
const styleDir = () => `${home()}/.claude/output-styles`;
const styleTemplate = (name: string): string =>
  `---\nname: ${name}\ndescription: Describe this output style\n---\n\nYou are an interactive CLI tool that helps users with software engineering tasks.\n`;

const CATALOG_SCHEMA = 4;

const CATALOG_TTL_MS = 10 * 60_000;
const SETTINGS = `${appHome()}/agent-config.json`;

const GATEWAY = `${appHome()}/model-gateway.json`;
const gatewayEnabled = (text: string | null): boolean => {
  try {
    return (JSON.parse(text as string) as { enabled?: unknown }).enabled === true;
  } catch {
    return false;
  }
};

const CLI_TIMEOUT_MS = 60_000;

const INPUT_MOUNT_DELAY_MS = 30;
const dangerColor = (): Color => (settings()?.dark ? "#ef4444" : "#dc2626");
const themeTokens = (): ThemeTokens =>
  new Proxy(theme(), { get: (tokens, key: string) => themeColor(tokens[key]) }) as ThemeTokens;

const catalogEntry = (all: SettingsFile, key: string): CatalogEntry | undefined =>
  all.catalog?.[key];
const currentCatalogModels = (
  cached: CatalogEntry | undefined,
): CatalogModel[] | null | undefined => (cached?.schema === CATALOG_SCHEMA ? cached.models : null);
const isFresh = (
  cached: CatalogEntry | undefined,
  cachedModels: CatalogModel[] | null | undefined,
): boolean =>
  Boolean(cachedModels) &&
  typeof cached?.checkedAt === "number" &&
  Date.now() - cached.checkedAt < CATALOG_TTL_MS;

function gridColumn(element: NativeElement, span: number, minWidth = 0): NativeElement {
  return element.flex_basis(0).flex_grow(span).flex_shrink(1).min_w(minWidth);
}

async function cliVersion(command: string): Promise<string> {
  const { stdout } = await exec("zsh", ["-lic", `${command} --version`], {
    timeout: CLI_TIMEOUT_MS,
  });
  return (stdout.trim().split("\n").pop() as string).trim();
}

function formatJson(text: string): string {
  return JSON.stringify(JSON.parse(text), null, 2);
}

function parseManagerSettings(text: string | null): { disabled: Set<string>; herdrEnv: boolean } {
  try {
    const saved = JSON.parse(text ?? "{}") as { disabled?: string[]; herdrEnv?: boolean };
    return {
      disabled: new Set(
        Array.isArray(saved.disabled)
          ? saved.disabled.filter((key) => typeof key === "string")
          : [],
      ),
      herdrEnv: saved.herdrEnv !== false,
    };
  } catch {
    return { disabled: new Set(), herdrEnv: true };
  }
}

function describeJsonError(error: unknown, text: string): { message: string; line: number } {
  const message = errorMessage(error);
  const line = message.match(/\bline (\d+)\b/i);
  let number = line ? Number(line[1]) : 0;
  if (!number) {
    const position = message.match(/\bposition (\d+)\b/i);
    if (position) number = text.slice(0, Number(position[1])).split("\n").length;
  }
  return { message, line: number || 1 };
}

function normalizeJson(text: string, fallback: string): string {
  try {
    return formatJson(text);
  } catch {
    return fallback;
  }
}

function providerGlyph(record: ProviderRecord | null | undefined, t: ThemeTokens): NativeElement {
  if (!record) return svg("mods/orca-assets/circle.svg").size(13).text_color(t.muted);
  const appDir = `${appHome()}/`;
  const path = String(record.iconPath ?? "");
  if (path.startsWith(appDir)) return image(path.slice(appDir.length)).w(20).h(20).rounded(4);
  return svg("mods/orca-assets/hard-drive.svg").size(14).text_color(t.muted);
}

function jsonBadge(
  editor: JsonEditor,
  danger: Color,
  t: ThemeTokens,
): { text: string; color: Color; bg: Color; border: Color } {
  if (editor.error)
    return {
      text: `Invalid JSON · line ${editor.error.line}`,
      color: danger,
      bg: "#ef444414",
      border: "#ef444440",
    };
  if (editor.dirty)
    return { text: "Unsaved changes", color: t.working, bg: "#eab30814", border: "#eab30840" };
  return { text: "Valid JSON", color: t.done, bg: "#10b98114", border: "#10b98138" };
}

const launchSpace = (p: { space?: string }): ReturnType<typeof spaces>[number] | undefined =>
  spaces().find((candidate) => candidate.id === p.space) ??
  spaces().find((candidate) => candidate.active);

function editorSave(menu: AgentConfigCore, id: string, t: ThemeTokens): Element {
  return h_flex()
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
    .on_click((_e, cx) => menu.saveEditor(id, cx))
    .child(svg("mods/orca-assets/save.svg").size(14));
}

function previewCopyButton(
  menu: AgentConfigCore,
  command: string | null,
  argv: string[],
  t: ThemeTokens,
  copy: PreviewCommand["copy"],
): Element {
  return div()
    .id("am-copy-command")
    .px(8)
    .h(24)
    .rounded(6)
    .flex()
    .items_center()
    .role("button")
    .accessibility_label("Copy command")
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click((_e, eventCx) => {
      if (menu.previewKey === menu.previewSignature(argv)) copy(command as string, eventCx);
    })
    .child("Copy");
}

function editorBox(
  editor: EditorState,
  t: ThemeTokens,
  json: boolean,
  mono: string,
  danger: Color,
): Element {
  return v_flex()
    .mx(6)
    .rounded(8)
    .border_1()
    .border_color(editor.error ? danger : t.border)
    .bg(t.raised)
    .child(
      (json ? div().px(8).py(6).font_family(mono) : div().px(8).py(6)).child(
        (json
          ? Textarea.new(editor.input).w_full().font_family(mono)
          : Textarea.new(editor.input).w_full()
        )
          .text_size(json ? 11 : 12)
          .text_color(t.foreground)
          .bg("#00000000"),
      ),
    );
}

class AgentConfigCore {
  declare settingsContext: AgentSettingsContext | undefined;
  declare key: AgentKey;
  declare spec: AgentSpec;
  declare values: ValueState;
  declare models: CatalogModel[] | null;
  declare error: string;
  declare hidden: Set<string>;
  declare modelGroup: string | null | undefined;
  declare groupOpen: boolean;
  declare showHidden: boolean;
  declare collapsedAdvanced: boolean;
  declare snapshot: string | null;
  declare open: string | null;
  declare providers: Record<string, ProviderRecord>;
  declare providerId: string;
  declare cliModel: string | null;
  declare fast: boolean;
  declare hotTip: string | null;
  declare styles: string[];
  declare naming: boolean;
  declare nameFocused: boolean;
  declare nameError: boolean;
  declare styleInput: InputState;
  declare editors: Record<string, EditorState>;
  declare launched: boolean;
  declare launching: boolean;
  declare litellmEnabled: boolean;
  declare refreshing: boolean;
  declare saving: Promise<void> | null;
  declare savingProvider: Promise<void> | null;
  declare settingsLoaded: boolean;
  declare settingsSaveError: string | null;
  declare previewKey: string | null;
  declare previewGeneration: number;
  declare previewResult: PreviewResult | null;

  context(): AgentSettingsContext {
    return this.settingsContext ?? props() ?? {};
  }

  init(_props: unknown, cx: Context): void {
    this.key = (this.context().key ?? "claude") as AgentKey;
    this.spec = SPECS[this.key];
    this.values = { ...defaultValues(this.spec), model: null, effort: null };
    this.models = null;
    this.error = "";
    this.hidden = new Set();
    this.modelGroup = this.groupOption()?.group ?? null;
    this.groupOpen = false;
    this.showHidden = false;
    this.collapsedAdvanced = true;
    this.snapshot = null;
    this.open = null;

    this.providers = {};
    this.providerId = "none";
    this.cliModel = null;

    this.fast = false;
    this.hotTip = null;

    this.styles = BUILTIN_STYLES;
    this.naming = false;
    this.nameFocused = false;
    this.nameError = false;
    this.setupStyleInput();
    this.setupEditors();

    if (checking()) return;

    cx.spawn((taskCx) => this.loadSaved(taskCx));
  }

  setupStyleInput(): void {
    this.styleInput = InputState.new({ placeholder: "style name" });
    this.styleInput.on("submit", (_e, eventCx) => this.createStyle(eventCx));
    this.styleInput.on("change", (_e, eventCx) => {
      this.nameError = false;
      eventCx.notify();
    });
    this.styleInput.on("focus", () => {
      this.nameFocused = true;
    });

    this.styleInput.on("blur", (_e, eventCx) => {
      if (this.nameFocused) this.cancelNaming(eventCx);
    });
  }

  setupEditors(): void {
    this.editors = {};
    for (const [id, option] of Object.entries(this.spec.options)) {
      if (option.type !== "editor") continue;
      const editor = {
        input: TextareaState.new({ value: (option.default ?? "") as string, rows: 3 }),
        dirty: false,
        error: null,
      };
      if (option.language === "json") editor.input.set_soft_wrap(false);
      editor.input.on("change", (_e, eventCx) => {
        editor.dirty = editor.input.value() !== this.values[id];
        eventCx.notify();
      });
      this.editors[id] = editor;
    }
  }

  async loadSaved(cx: Context): Promise<void> {
    try {
      this.snapshot = await readTextFile(SETTINGS).catch(() => null);
      this.litellmEnabled = gatewayEnabled(await readTextFile(GATEWAY).catch(() => null));
      cx.notify();
      const all = JSON.parse(this.snapshot ?? "{}") as SettingsFile;
      const saved = (all[this.key] ?? {}) as SavedState;
      await this.applySaved(saved, cx);
      if (this.settingsContext) this.settingsLoaded = true;

      const cached = catalogEntry(all, this.key);
      const cachedModels = currentCatalogModels(cached);
      if (cachedModels?.length) this.paintCached(cachedModels, saved, cx);
      if (isFresh(cached, cachedModels)) return;
      await this.checkCatalog(cx, saved, cached, cachedModels);
    } catch (error) {
      if (!this.models?.length) this.error = `Could not list models: ${errorMessage(error)}`;
      cx.notify();
    }
  }

  async applySaved(saved: SavedState, cx: Context): Promise<void> {
    this.values = { ...this.values, ...readValues(this.spec, saved) };
    this.collapsedAdvanced = saved.advancedArgumentsCollapsed !== false;
    for (const [id, editor] of Object.entries(this.editors)) {
      if (this.spec.options[id].language === "json")
        this.values[id] = normalizeJson(
          this.values[id] as string,
          this.spec.options[id].default as string,
        );
      editor.input.set_value(this.values[id] as string);
    }
    if (this.hasSource("claudeOutputStyles")) this.loadStyles(cx);
    this.hidden = new Set(saved.hidden ?? []);
    if (this.spec.options.provider) await this.loadProviders();
    if (this.groupOption()) this.modelGroup = readGroup(this.groupOption() as GroupOption, saved);
  }

  paintCached(cachedModels: CatalogModel[], saved: SavedState, cx: Context): void {
    this.models = cachedModels;
    this.pickSaved(saved);
    cx.notify();
    this.launchIfAsked(cx);
  }

  pickSaved(saved: SavedState): void {
    if (!this.models?.length) return;
    const pick = this.models.find((m) => m.id === saved.model) ?? this.models[0];
    this.choose(pick, saved.effort);
  }

  launchIfAsked(cx: Context): void {
    if (this.context().launchNow && this.current() && !this.launched) {
      this.launched = true;
      this.launch(cx);
    }
  }

  async checkCatalog(
    cx: Context,
    saved: SavedState,
    cached: CatalogEntry | undefined,
    cachedModels: CatalogModel[] | null | undefined,
  ): Promise<void> {
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

  get model(): string | null {
    return this.values.model;
  }
  set model(id: string | null) {
    this.values.model = id;
  }
  get effort(): string | null | undefined {
    return this.values.effort;
  }
  set effort(level: string | null | undefined) {
    this.values.effort = level;
  }

  groupOption(): GroupOption | null {
    const model = this.spec.options.model;
    return this.providerId === "none" && model?.groups ? (model as GroupOption) : null;
  }

  hasSource(source: string): boolean {
    return Object.values(this.spec.options).some((option) => option.source === source);
  }

  async listModels(): Promise<CatalogModel[]> {
    const first: CatalogModel[] = this.spec.models.default
      ? [{ id: "", label: this.spec.models.default, efforts: [], fallbackEffort: "" }]
      : [];
    try {
      const { stdout } = await exec("zsh", ["-lic", this.spec.models.shell], {
        timeout: CLI_TIMEOUT_MS,
      });
      return [...first, ...parseModels(this.spec.models.parser, stdout)];
    } catch (error) {
      if (first.length) return first;
      throw error;
    }
  }

  fastAvailable(model: CatalogModel | undefined = this.current()): boolean {
    return Boolean(this.spec.options.fast) && this.providerId === "none" && Boolean(model?.fast);
  }

  choose(model: CatalogModel | null | undefined, effort?: unknown): void {
    if (!model) {
      this.model = null;
      this.effort = null;
      return;
    }
    this.model = model.id;
    const efforts = model.efforts;
    const fallback = efforts.includes(model.fallbackEffort as string)
      ? model.fallbackEffort
      : efforts[0];
    const kept = [effort, this.effort].find((level) => efforts.includes(level as string)) as
      | string
      | null
      | undefined;
    this.effort = kept !== undefined ? kept : fallback;
    if (this.values.fast && !this.fastAvailable(model)) this.values.fast = false;
  }

  current(): CatalogModel | undefined {
    return this.activeModels()?.find((m) => m.id === this.model);
  }

  async loadProviders(): Promise<Record<string, ProviderRecord>> {
    const text = await readTextFile(`${appHome()}/${PROVIDER_FILE}`).catch(() => null);
    this.providers =
      (parseProviderFile(text) as { providers?: Record<string, ProviderRecord> }).providers ?? {};
    if (this.providerId !== "none" && !this.providers[this.providerId]) this.providerId = "none";
    return this.providers;
  }

  activeModels(): CatalogModel[] | null {
    if (!this.spec.options.provider || this.providerId === "none") return this.models;
    const record = this.providers[this.providerId];
    return (record?.models ?? [])
      .filter((id) =>
        this.key === "pi"
          ? supportsCodingModel(record.modelInfo?.[id]) &&
            piModelLimits(record.modelInfo?.[id]) !== null
          : this.key !== "opencode" || supportsCodingModel(record.modelInfo?.[id]),
      )
      .map((id) => ({ id, label: id, efforts: [] }));
  }

  setProvider(id: string, cx: Context): void {
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

  rememberProviderModel(): void {
    const id = this.providerId;
    const key = this.key;
    const model = this.model;
    const file = `${appHome()}/${PROVIDER_FILE}`;
    this.savingProvider = (this.savingProvider ?? Promise.resolve()).then(async () => {
      const text = await readTextFile(file).catch(() => null);
      const parsed = parseProviderFile(text) as { providers?: Record<string, ProviderRecord> };
      const record = parsed.providers?.[id];
      if (!record) return;
      record.selectedModel = { ...(record.selectedModel ?? {}), [key]: model };
      try {
        await writeProviderFile(
          { appHome, exec, writeTextFile },
          serializeProviderFile(parsed.providers),
          text,
        );
      } catch {}
    });
  }

  persist(mutate: (all: SettingsFile) => void): void {
    this.saving = (this.saving ?? Promise.resolve()).then(async () => {
      let all: SettingsFile = {};
      let base = this.snapshot;

      if (this.settingsContext) {
        try {
          ({ all, base } = await this.settingsWriteBase());
        } catch (e) {
          this.settingsSaveError = errorMessage(e);
          return;
        }
      } else {
        try {
          all = JSON.parse(base ?? "{}") as SettingsFile;
        } catch {}
      }
      mutate(all);
      const text = `${JSON.stringify(all, null, 2)}\n`;
      try {
        await writeTextFile(SETTINGS, text, base);
        this.snapshot = text;
        this.settingsSaveError = null;
      } catch (e) {
        if (this.settingsContext) this.settingsSaveError = errorMessage(e);
      }
    });
  }

  async settingsWriteBase(): Promise<{ all: SettingsFile; base: string | null }> {
    const base = await readTextFile(SETTINGS);
    const all = JSON.parse(base ?? "{}") as SettingsFile;
    if (!all || typeof all !== "object" || Array.isArray(all))
      throw new Error("Invalid agent-config.json");
    const before = JSON.parse(this.snapshot ?? "{}") as SettingsFile;
    if (JSON.stringify(before[this.key]) !== JSON.stringify(all[this.key])) {
      throw new Error("This agent changed on disk. Reopen its settings before saving again.");
    }
    return { all, base };
  }

  remember(): void {
    const key = this.key;
    const { model, effort } = this;
    const hidden = [...this.hidden];

    const viaProvider = Boolean(this.spec.options.provider) && this.providerId !== "none";
    this.persist((all) => {
      all[key] = { ...(all[key] as SavedState), hidden, ...(viaProvider ? {} : { model, effort }) };
    });
    if (viaProvider) this.rememberProviderModel();
  }

  toggleAdvanced(cx: Context): void {
    this.collapsedAdvanced = !this.collapsedAdvanced;
    const collapsed = this.collapsedAdvanced;
    this.persist((all) => {
      all[this.key] = {
        ...(all[this.key] as SavedState),
        advancedArgumentsCollapsed: collapsed,
      };
    });
    cx.notify();
  }

  rememberGroup(): void {
    const key = this.key;
    const group = this.modelGroup;
    this.persist((all) => {
      all[key] = { ...(all[key] as SavedState), group };
    });
  }

  rememberPreset(patch: Record<string, unknown> = {}): void {
    const preset = { ...presetOf(this.spec, this.values), ...patch };
    this.persist((all) => {
      const current = all[this.key] as SavedState;
      all[this.key] = {
        ...current,
        preset: this.settingsContext ? { ...current?.preset, ...preset } : preset,
      };
    });
  }

  setValue(id: string, value: unknown, cx: Context): void {
    this.values[id] = value;
    this.open = null;
    this.rememberPreset();
    cx.notify();
  }

  toggleItem(id: string, item: string, cx: Context): void {
    const on = new Set(this.values[id] as string[]);
    if (on.has(item)) on.delete(item);
    else on.add(item);
    this.values[id] = [...on];
    this.rememberPreset();
    cx.notify();
  }

  setAllItems(id: string, all: boolean, cx: Context): void {
    this.values[id] = all ? this.spec.options[id].items!.map((item) => item.id) : [];
    this.rememberPreset();
    cx.notify();
  }

  saveEditor(id: string, cx: Context): void {
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

  resetPreset(cx: Context): void {
    const fresh = defaultValues(this.spec);
    this.open = null;
    for (const id of Object.keys(fresh)) {
      this.values[id] = fresh[id];
      const editor = this.editors[id];
      if (editor) {
        editor.input.set_value(fresh[id] as string);
        editor.dirty = false;
        editor.error = null;
      }
    }
    this.rememberPreset();
    cx.notify();
  }

  loadStyles(cx: Context): void {
    cx.spawn(async (taskCx) => {
      const { stdout } = await exec("ls", [styleDir()]).catch(() => ({ stdout: "" }));
      const custom = stdout
        .split("\n")
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.slice(0, -3));
      this.styles = [...BUILTIN_STYLES, ...custom.filter((n) => !BUILTIN_STYLES.includes(n))];
      taskCx.notify();
    });
  }

  openStyleFile(name: string): void {
    run("tab.new", { mod: "orca-files", props: { file: `${styleDir()}/${name}.md` } });
  }

  pickChoice(id: string, name: string, cx: Context): void {
    if (name !== NEW_STYLE) return this.setValue(id, name, cx);
    this.open = null;
    this.naming = true;
    this.nameFocused = false;
    this.nameError = false;
    cx.timer.after(INPUT_MOUNT_DELAY_MS, () => this.styleInput.focus());
    cx.notify();
  }

  cancelNaming(cx: Context): void {
    if (!this.naming) return;
    this.naming = false;
    this.nameFocused = false;
    this.nameError = false;
    this.styleInput.set_value("");
    cx.notify();
  }

  createStyle(cx: Context): void {
    const name = this.styleInput.value().trim();
    if (!name) return this.cancelNaming(cx);
    if (!/^[\w-]+$/.test(name)) {
      this.nameError = true;
      cx.notify();
      return;
    }
    this.naming = false;
    this.nameFocused = false;
    this.styleInput.set_value("");
    const id = Object.keys(this.spec.options).find(
      (key) => this.spec.options[key].source === "claudeOutputStyles",
    );
    cx.spawn(async (taskCx) => {
      const file = `${styleDir()}/${name}.md`;
      if ((await readTextFile(file).catch(() => null)) === null) {
        await exec("mkdir", ["-p", styleDir()]);
        await writeTextFile(file, styleTemplate(name), null);
      }
      this.values[String(id)] = name;
      this.rememberPreset();
      this.loadStyles(taskCx);
      this.openStyleFile(name);
    });
    cx.notify();
  }

  saveCatalog(version: string | null | undefined, models: CatalogModel[]): void {
    const key = this.key;
    this.persist((all) => {
      all.catalog = {
        ...all.catalog,
        [key]: { schema: CATALOG_SCHEMA, version, checkedAt: Date.now(), models },
      };
    });
  }

  refresh(cx: Context): void {
    if (this.refreshing) return;
    this.refreshing = true;
    this.error = "";
    if (this.settingsContext) this.previewKey = null;
    const key = this.key;
    this.persist((all) => {
      if (all.catalog) delete all.catalog[key];
    });
    cx.notify();
    cx.spawn(async (taskCx) => {
      try {
        const [version, models] = await Promise.all([
          cliVersion(this.spec.command).catch(() => null),
          this.listModels(),
        ]);
        if (!models.length) throw new Error("no models available");
        this.models = models;
        const pick = models.find((m) => m.id === this.model) ?? models[0];
        this.choose(pick, this.effort);
        this.saveCatalog(version, models);
      } catch (e) {
        this.error = `Could not list models: ${errorMessage(e)}`;
      }
      this.refreshing = false;
      taskCx.notify();
    });
  }

  toggleHidden(id: string): void {
    if (this.hidden.has(id)) this.hidden.delete(id);
    else this.hidden.add(id);
    this.remember();
  }

  async buildLaunch(
    p: AgentSettingsContext,
    { preview = false }: { preview?: boolean } = {},
  ): Promise<LaunchResult> {
    const providerId = this.providerId;
    const values = { ...this.values };
    if (this.readEditors(values, preview)) return { blocked: true };
    const expansions = await this.expandItems(values);
    if (this.spec.options.provider && (preview ? providerId : this.providerId) !== "none")
      return this.buildProviderLaunch(p, values, expansions, {
        preview,
        providerId: preview ? providerId : this.providerId,
      });
    return { argv: buildArgv(this.spec, p.argv as string[], values, { expansions }) };
  }

  readEditors(values: ValueState, preview = false): boolean {
    for (const [id, editor] of Object.entries(this.editors)) {
      values[id] = editor.input.value();
      if (this.spec.options[id].language === "json" && (values[id] as string).trim()) {
        try {
          JSON.parse(values[id] as string);
        } catch (error) {
          if (!preview) {
            editor.error = describeJsonError(error, values[id] as string);
            editor.dirty = values[id] !== this.values[id];
          }
          return true;
        }
      }
    }
    return false;
  }

  async expandItems(values: ValueState): Promise<Record<string, string[]>> {
    const expansions: Record<string, string[]> = {};
    for (const [id, option] of Object.entries(this.spec.options)) {
      for (const item of option.items ?? []) {
        if (item.expand && ((values[id] as string[] | undefined) ?? []).includes(item.id))
          expansions[item.expand] = await EXPANSIONS[item.expand]();
      }
    }
    return expansions;
  }

  async buildProviderLaunch(
    p: AgentSettingsContext,
    values: ValueState,
    expansions: Record<string, string[]>,
    {
      preview = false,
      providerId = this.providerId,
    }: { preview?: boolean; providerId?: string } = {},
  ): Promise<LaunchResult> {
    const file = `${appHome()}/${PROVIDER_FILE}`;
    const parsed = parseProviderFile(await readTextFile(file).catch(() => null)) as {
      providers?: Record<string, ProviderRecord>;
    };
    const record = parsed.providers?.[providerId];
    if (!record || "error" in validateHost(record.host)) {
      if (!preview) {
        this.providerId = "none";
        this.open = null;
      }
      return { error: "Model provider is no longer set up." };
    }
    let provider: Provider = { ...record, id: providerId, configPath: file };
    let model = preview ? values.model : this.model;
    if (!preview) {
      const prepared = await this.prepareGatewayRoute(providerId, model as string, record);
      if (prepared.error) return prepared;
      const route = prepared.route as GatewayRoute;
      if (!route.direct) {
        provider = {
          ...provider,
          host: route.host as string,
          configPath: route.configPath as string,
          id: route.id,
          models: Object.values(route.aliases as Record<string, string>),
          modelInfo: Object.fromEntries(
            Object.entries(route.aliases as Record<string, string>).map(([id, alias]) => [
              alias,
              record.modelInfo?.[id] ?? {},
            ]),
          ),
        };
        model = route.model as string;
      }
    }
    const argv = buildArgv(this.spec, p.argv as string[], values, {
      expansions,
      skip: ["model", "effort"],
    });
    return this.providerLaunchArgv(provider, model as string, argv);
  }

  async prepareGatewayRoute(
    providerId: string,
    model: string,
    record: ProviderRecord,
  ): Promise<GatewayRouteResult> {
    const result = await exec(
      "python3",
      [
        `${appHome()}/mods/orca-agent-flyout/litellm_gateway.py`,
        appHome(),
        "prepare",
        providerId,
        model,
        record.host,
        this.key,
      ],
      { timeout: 180000 },
    ).catch(() => null);
    const route = this.parseGatewayRoute(result?.stdout);
    if (result?.code !== 0 || !this.validGatewayRoute(route)) {
      return {
        error: route?.error ?? "LiteLLM is unavailable or the selected model is not configured.",
      };
    }
    return { route: route as GatewayRoute };
  }

  parseGatewayRoute(stdout: string | null | undefined): GatewayRoute | null {
    try {
      return JSON.parse(stdout ?? "") as GatewayRoute;
    } catch {
      return null;
    }
  }

  validGatewayRoute(route: GatewayRoute | null): boolean {
    return Boolean(route && (route.direct || Boolean(route.host && route.model && route.aliases)));
  }

  providerLaunchArgv(provider: Provider, model: string, argv: string[]): LaunchResult {
    const info = provider.modelInfo?.[model];
    if (this.key === "pi") {
      if (!supportsCodingModel(info)) return { error: "Pi needs a text model with tool support." };
      if (!piModelLimits(info))
        return {
          error:
            "Pi needs a known context limit above 16,384 tokens and an output limit that fits it.",
        };
      return {
        argv: launchPiArgv(
          argv,
          provider,
          model,
          `${appHome()}/mods/orca-agent-flyout/pi-provider.js`,
        ),
      };
    }
    if (this.key === "claude") return { argv: launchClaudeArgv(argv, provider, model) };
    if (this.key === "opencode") {
      if (!supportsCodingModel(info))
        return { error: "OpenCode needs a text model with tool support." };
      return { argv: launchOpenCodeArgv(argv, provider, model) };
    }
    return { argv: launchArgv(argv, provider, model) };
  }

  async readManagerSettings(): Promise<{ disabled: Set<string>; herdrEnv: boolean }> {
    const manager = await readTextFile(`${appHome()}/agent-manager.json`).catch(() => null);
    return parseManagerSettings(manager);
  }

  failLaunch(message: string | null | undefined, cx?: Context): void {
    if (message) this.error = message;
    this.launching = false;
    cx?.notify();
  }

  async launch(cx: Context): Promise<void> {
    const p = this.context();
    if (!this.current() || this.launching) return;
    this.launching = true;
    const space = launchSpace(p);
    if (this.settingsContext && (!space || space.machine)) {
      this.failLaunch(null, cx);
      return;
    }
    const manager = await this.readManagerSettings();
    if (!space?.machine && manager.disabled.has(p.key as string)) {
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

  async startTerminal(
    p: AgentSettingsContext,
    space: ReturnType<typeof spaces>[number] | undefined,
    argv: string[],
    cx: Context,
  ): Promise<void> {
    this.remember();
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
      closeOverlay(p.overlay as string);
      closeOverlay(p.menu as string);
    }
  }

  async rememberVariant() {
    if (this.effort == null) return;
    const file = `${home()}/.local/state/opencode/model.json`;
    try {
      const current = await readTextFile(file).catch(() => null);
      const all = (current ? JSON.parse(current) : {}) as { variant?: Record<string, string> };
      const variant = all.variant && typeof all.variant === "object" ? all.variant : {};
      if (this.effort) variant[this.model as string] = this.effort;
      else delete variant[this.model as string];
      all.variant = variant;
      await writeTextFile(file, `${JSON.stringify(all, null, 2)}\n`, current);
    } catch {}
  }

  modelRow(m: CatalogModel, t: ThemeTokens): Element {
    const on = this.model === m.id;
    const hidden = this.hidden.has(m.id);
    return this.tip(
      `model-${m.id}`,
      m.label,
      this.listRow(`model-${m.id}`, t, 2)
        .px(6)
        .flex_none()
        .on_click((_e, cx) => {
          this.choose(m, this.effort);
          this.open = null;
          this.groupOpen = false;
          this.remember();
          cx.notify();
        })
        .child(
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .text_color(hidden ? t.muted : t.foreground)
            .child(m.label),
        )
        .child(selectionMark(on, t))
        .child(
          div()
            .id(`visibility-${m.id}`)
            .flex_none()
            .p(2)
            .rounded(4)
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.toggleHidden(m.id);
              cx.notify();
            })
            .child(
              svg(
                hidden
                  ? "mods/orca-assets/eye-off.svg"
                  : "mods/orca-assets/eye--orca-agent-flyout.svg",
              )
                .size(14)
                .text_color(t.muted),
            ),
        ),
      true,
    );
  }

  groupSelect(t: ThemeTokens): Element {
    const option = this.groupOption() as GroupOption;
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
      .child(
        div()
          .text_size(11)
          .text_color(t.foreground)
          .child(
            option.groups.find((g) => g.id === this.modelGroup)?.label ??
              (this.modelGroup as string),
          ),
      )
      .child(div().text_size(10).text_color(t.muted).child("▾"));
  }

  shownModels(): CatalogModel[] {
    if (!this.groupOption()) return this.activeModels() ?? [];
    return (this.models ?? []).filter(
      (m) =>
        this.modelGroup === "all" || (m.group ?? (m.free ? "free" : "paid")) === this.modelGroup,
    );
  }

  hiddenRows(hiddenModels: CatalogModel[], t: ThemeTokens): Element[] {
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

  withGroupFilter(el: Element, t: ThemeTokens): Element {
    const option = this.groupOption() as GroupOption;
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
      .when(this.groupOpen, (inner) =>
        inner.child(
          v_flex()
            .mx(6)
            .mb(2)
            .py(2)
            .rounded(6)
            .border_1()
            .border_color(t.border)
            .bg(t.popover)
            .child(
              this.scrollList(
                "group-list",
                option.groups.map((g) =>
                  this.listRow(`group-${g.id}`, t, 4)
                    .on_click((_e, cx) => {
                      this.modelGroup = g.id;
                      this.groupOpen = false;
                      this.rememberGroup();
                      cx.notify();
                    })
                    .child(div().flex_1().text_size(12).text_color(t.foreground).child(g.label))
                    .when(this.modelGroup === g.id, (row) =>
                      row.child(div().text_color(t.accent).child("✓")),
                    ),
                ),
              ),
            ),
        ),
      );
  }

  modelList(t: ThemeTokens): Element {
    const all = this.shownModels();
    const visible = all.filter((m) => !this.hidden.has(m.id));
    const hiddenModels = all.filter((m) => this.hidden.has(m.id));

    const rows = [...visible.map((m) => this.modelRow(m, t)), ...this.hiddenRows(hiddenModels, t)];
    return v_flex()
      .gap(2)
      .when(this.groupOption(), (el) => this.withGroupFilter(el, t))
      .child(this.scrollList("agent-config-models", rows, true))
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

  tipCard(label: string): Element {
    return div()
      .relative()
      .mt(4)
      .pt(7)
      .child(
        h_flex()
          .min_h(30)
          .px(10)
          .py(4)
          .items_center()
          .rounded(8)
          .border_1()
          .border_color("#e4e4e7")
          .bg("#f4f4f5")
          .shadow_md()
          .child(div().max_w(260).text_size(12).font_medium().text_color("#18181b").child(label)),
      )
      .child(
        div()
          .absolute()
          .top(0)
          .left(0)
          .right(0)
          .flex()
          .justify_center()
          .child(svg("mods/orca-assets/tip-arrow--orca-tab-dropdown.svg").w(14).h(8).flex_none()),
      );
  }

  tip(id: string, label: string, trigger: Element, full = false): Element {
    const lit = div()
      .id(`cfg-hot-${id}`)
      .when(full, (el) => el.w_full().flex_none())
      .on_hover((hovered, cx) => {
        if (hovered) this.hotTip = id;
        else if (this.hotTip === id) this.hotTip = null;
        cx.notify();
      })
      .child(trigger);
    return HoverCard.new(`cfg-tip-${id}`)
      .anchor("top_center")
      .open_delay(150)
      .close_delay(0)
      .trigger(lit)
      .content(this.hotTip === id ? this.tipCard(label) : div());
  }

  controlHead(id: string, icon: string, label: string, t: ThemeTokens): Element {
    return this.tip(
      id,
      label,
      div()
        .size(18)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .accessibility_label(label)
        .child(svg(`mods/orca-assets/${icon}`).size(12).flex_none().text_color(t.foreground)),
    );
  }

  providerIcon(record: ProviderRecord | null, t: ThemeTokens): Element {
    return div()
      .relative()
      .size(24)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(6)
      .bg(t.raised)
      .child(providerGlyph(record, t))
      .when(Boolean(record) && this.litellmEnabled === true, (el) =>
        el.child(
          div()
            .absolute()
            .right(-3)
            .bottom(-3)
            .size(13)
            .rounded_full()
            .bg(t.surface)
            .border_2()
            .border_color(t.surface)
            .flex()
            .items_center()
            .justify_center()
            .tooltip("LiteLLM enabled")
            .child(image("mods/orca-assets/litellm_favicon_light_32.png").w(9).h(9).rounded_full()),
        ),
      );
  }

  agentIcon(t: ThemeTokens): Element {
    const p = this.context();

    const byKey: Partial<Record<AgentKey, string>> = {
      claude: "claude.svg",
      codex: "codex--orca-header.svg",
      opencode: "opencode.svg",
    };
    const file = byKey[this.key];
    if (file) return svg(`mods/orca-assets/${file}`).size(18).text_color(t.foreground);
    const path = String(p.icon ?? "");
    if (path) return svg(path).size(18).text_color(t.foreground);
    return svg("mods/orca-assets/bot.svg").size(18).text_color(t.muted);
  }

  providerRow(t: ThemeTokens, responsive = false): Element {
    const space = launchSpace(this.context());
    const remote = !this.settingsContext && Boolean(space?.machine);
    const enabled = !remote;
    const label =
      this.providerId === "none"
        ? this.spec.label
        : (this.providers[this.providerId]?.name ?? "None");
    return v_flex()
      .gap(2)
      .when(!responsive, (el) => el.w(48))
      .when(responsive, (el) => el.w_full().min_w(0))
      .when(!enabled, (el) => el.opacity(0.5))
      .role("group")
      .accessibility_label(`Model source: ${label}`)
      .child(this.controlHead("source-head", "hard-drive.svg", `Model source: ${label}`, t))
      .child(this.listBox(this.sourceList(t, enabled), t));
  }

  sourceList(t: ThemeTokens, enabled: boolean): Element {
    const rows = [
      {
        id: "none",
        label: this.spec.label,
        icon: div()
          .size(24)
          .flex_none()
          .flex()
          .items_center()
          .justify_center()
          .rounded(6)
          .bg(t.raised)
          .child(this.agentIcon(t)),
      },
      ...Object.entries(this.providers ?? {}).map(([id, record]) => ({
        id,
        label: record?.name ?? id,
        icon: this.providerIcon(record, t),
      })),
    ];
    return v_flex()
      .gap(2)
      .child(
        this.scrollList(
          "source-list",
          rows.map((option) =>
            this.tip(
              `source-${option.id}`,
              option.label,
              this.listRow(`source-${option.id}`, t, 0)
                .w_full()
                .pl(8)
                .pr(2)
                .gap(4)
                .justify_start()
                .accessibility_label(option.label)
                .when(!enabled, (el) => el.opacity(0.5))
                .when(enabled, (el) => el.on_click((_e, cx) => this.setProvider(option.id, cx)))
                .child(option.icon)
                .child(div().flex_1())
                .child(selectionMark(this.providerId === option.id, t)),
              true,
            ),
          ),
          true,
        ),
      );
  }

  sectionHead(title: string, t: ThemeTokens, first = false): Element {
    const advanced = title === "HARNESS CLI ADVANCED ARGUMENTS";
    return h_flex()
      .mx(8)
      .mt(first ? 6 : 12)
      .mb(8)
      .items_center()
      .gap(6)
      .text_size(10)
      .font_medium()
      .text_color(t.dim)
      .when(advanced, (el) =>
        el
          .role("button")
          .accessibility_label(`${title}, ${this.collapsedAdvanced ? "collapsed" : "expanded"}`)
          .cursor_pointer()
          .on_click((_e, cx) => this.toggleAdvanced(cx)),
      )
      .child(div().flex_1().child(title))
      .when(advanced, (el) =>
        el.child(
          div()
            .flex_none()
            .text_size(12)
            .child(this.collapsedAdvanced ? "›" : "⌄"),
        ),
      );
  }

  divider(t: ThemeTokens): Element {
    return div().h(1).mx(6).mt(14).bg(t.border);
  }

  providerList(t: ThemeTokens): Element {
    const options = [
      { id: "none", label: "None" },
      ...Object.entries(this.providers ?? {}).map(([id, record]) => ({
        id,
        label: record?.name ?? id,
      })),
    ];
    return this.scrollList(
      "provider-list",
      options
        .map((option) =>
          this.listRow(`provider-${option.id}`, t)
            .on_click((_e, cx) => this.setProvider(option.id, cx))
            .child(this.providerIcon(option.id === "none" ? null : this.providers[option.id], t))
            .child(div().flex_1().min_w(0).truncate().child(option.label))
            .child(selectionMark(this.providerId === option.id, t)),
        )
        .concat(
          this.listRow("provider-add", t)
            .on_click(() => this.openProviders())
            .child(
              div()
                .size(24)
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .rounded(6)
                .bg(t.raised)
                .child(
                  svg("mods/orca-assets/plus--orca-agent-flyout.svg").size(13).text_color(t.muted),
                ),
            )
            .child(div().flex_1().min_w(0).truncate().child("Add More")),
        ),
      true,
    );
  }

  openProviders(): void {
    const p = this.context();
    run("layout.select", { stack: "main", child: "main-providers" });
    setShared("orca-agent-flyout", null);
    if (!this.settingsContext) {
      closeOverlay(p.overlay as string);
      closeOverlay(p.menu as string);
    }
  }

  effortList(t: ThemeTokens): Element {
    return this.scrollList(
      "effort-list",
      (this.current()?.efforts ?? []).map((e) =>
        this.listRow(`effort-${e}`, t)
          .on_click((_e, cx) => {
            this.effort = e;
            this.open = null;
            this.remember();
            cx.notify();
          })
          .child(
            div()
              .flex_1()
              .child(EFFORT_LABEL[e] ?? e),
          )
          .child(selectionMark(this.effort === e, t)),
      ),
      true,
    );
  }

  listRow(id: string, t: ThemeTokens, inset = 6): Element {
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

  scrollList(id: string, rows: Element[], fixedHeight = false): Element {
    const { height, gap } = ROW;
    const overflow = scrolls(rows.length);
    if (!overflow && !fixedHeight) return v_flex().w_full().gap(gap).children(rows);
    const viewport = div()
      .w_full()
      .flex_none()
      .relative()
      .overflow_hidden()
      .h(viewportHeight(fixedHeight ? VISIBLE_ROWS : rows.length, height, gap));
    if (!overflow) return viewport.child(v_flex().w_full().gap(gap).children(rows));
    return viewport
      .on_scroll_wheel((_e, cx) => cx.stop_propagation())
      .child(
        v_flex().id(id).w_full().absolute().inset_0().overflow_y_scroll().gap(gap).children(rows),
      )
      .child(Scrollbar.vertical(id).absolute().inset_0());
  }

  selectBox({
    id,
    label,
    value,
    open,
    onToggle,
    t,
    valueEl = null,
    borderColor = null,
    disabled = false,
  }: SelectBoxOptions): Element {
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

  optionList(
    id: string,
    options: string[],
    current: unknown,
    onPick: (name: string, cx: Context) => void,
    t: ThemeTokens,
  ): Element {
    return this.scrollList(
      `${id}-list`,
      options.map((name) =>
        this.listRow(`${id}-${name}`, t)
          .on_click((_e, cx) => onPick(name, cx))
          .child(div().flex_1().child(name))
          .when(name === current, (el) => el.child(div().text_color(t.accent).child("✓"))),
      ),
    );
  }

  toggle(id: string, cx: Context): void {
    this.open = this.open === id ? null : id;
    this.groupOpen = false;
    cx.notify();
  }

  selectControl(id: string, t: ThemeTokens): Element | null {
    const option = this.spec.options[id];
    if (option.type === "model") {
      return this.selectBox({
        id: "model-select",
        label: option.label,
        value: this.current()?.label ?? "…",
        open: this.open === "model",
        onToggle: (cx) => this.toggle("model", cx),
        t,
      });
    }
    if (option.type === "effort") {
      if ((this.current()?.efforts ?? []).length === 0) return null;
      return this.selectBox({
        id: "effort-select",
        label: option.label,
        value: EFFORT_LABEL[this.effort as string] ?? this.effort ?? "…",
        open: this.open === "effort",
        onToggle: (cx) => this.toggle("effort", cx),
        t,
      });
    }
    if (option.type === "toggle") return this.toggleControl(id, option, t);
    return this.choiceSelect(id, option, t);
  }

  choiceSelect(id: string, option: OptionSpec, t: ThemeTokens): Element {
    const styles = option.source === "claudeOutputStyles";
    return this.selectBox({
      id: `${id}-select`,
      label: this.choiceLabel(option, styles),
      value: this.values[id] as string,
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

  choiceLabel(option: OptionSpec, styles: boolean): string {
    if (styles && this.nameError) return "LETTERS, DIGITS, - _ ONLY";
    return styles && this.naming ? "NEW OUTPUT STYLE" : option.label;
  }

  nameEntry(): Element {
    return div()
      .flex_1()
      .min_w(0)
      .on_key_down((e, cx) => {
        if (e.key === "escape") {
          this.cancelNaming(cx);
          cx.stop_propagation();
        }
      })
      .child(Input.new(this.styleInput));
  }

  listFor(id: string, t: ThemeTokens): Element | null {
    const option = this.spec.options[id];
    if (option.type === "model") return this.modelList(t);
    if (option.type === "effort") return this.effortList(t);
    if (option.type === "toggle") return v_flex();
    const choices =
      option.source === "claudeOutputStyles"
        ? [...this.styles, NEW_STYLE]
        : (option.choices as string[]);
    return this.optionList(
      id,
      choices,
      this.values[id],
      (name, cx) => this.pickChoice(id, name, cx),
      t,
    );
  }

  selectRow(ids: string[], t: ThemeTokens): Element[] {
    const box = (list: Element | null) =>
      v_flex()
        .mx(6)
        .py(4)
        .rounded(8)
        .border_1()
        .border_color(t.border)
        .bg(t.popover)
        .child(list as Element);
    const cells = ids.map((id) => this.selectControl(id, t)).filter(Boolean) as Element[];
    return [
      h_flex().mx(6).gap(8).children(cells),
      ...ids
        .filter((id) => this.open === id && this.selectControl(id, t))
        .map((id) => box(this.listFor(id, t))),
    ];
  }

  checklist(id: string, t: ThemeTokens): Element {
    const option = this.spec.options[id];
    const on = new Set(this.values[id] as string[]);
    const link = (key: string, label: string, all: boolean) =>
      div()
        .id(key)
        .cursor_pointer()
        .text_size(10)
        .text_color(t.accent)
        .hover((s) => s.opacity(0.7))
        .on_click((_e, cx) => this.setAllItems(id, all, cx))
        .child(label);
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
        h_flex()
          .gap(8)
          .items_center()
          .child(div().flex_1().text_size(9).text_color(t.dim).child(option.label))
          .when(option.bulk, (el) =>
            el.child(link(`${id}-all`, "all", true)).child(link(`${id}-clear`, "clear", false)),
          ),
      )
      .child(
        this.scrollList(
          `${id}-list`,
          option.items!.map((item) => {
            const checked = on.has(item.id);
            return this.listRow(`${id}-${item.id}`, t, 0)
              .flex_shrink(0)
              .on_click((_e, cx) => this.toggleItem(id, item.id, cx))
              .child(
                div()
                  .size(14)
                  .flex_none()
                  .flex()
                  .items_center()
                  .justify_center()
                  .rounded(3)
                  .border_1()
                  .border_color(checked ? t.accent : t.muted)
                  .text_size(10)
                  .text_color(t.accent)
                  .child(checked ? "✓" : ""),
              )
              .child(item.label ?? item.id);
          }),
        ),
      );
  }

  editorElements(id: string, t: ThemeTokens): Element[] {
    const option = this.spec.options[id];
    const editor = this.editors[id];
    const json = option.language === "json";
    const mono = (settings()?.font_family ?? "JetBrains Mono") as string;
    const danger = dangerColor();
    const badge = jsonBadge(editor, danger, t);
    const head = h_flex()
      .mx(6)
      .mt(2)
      .gap(8)
      .items_center()
      .child(div().text_size(12).font_medium().text_color(t.foreground).child(option.label))
      .child(div().flex_1())
      .when(json, (el) =>
        el.child(
          h_flex()
            .items_center()
            .justify_center()
            .px(8)
            .h(22)
            .rounded(6)
            .border_1()
            .border_color(badge.border)
            .bg(badge.bg)
            .text_size(10)
            .text_color(badge.color)
            .child(badge.text),
        ),
      )
      .when(!json, (el) =>
        el
          .child(
            div()
              .text_size(10)
              .text_color(editor.dirty ? t.working : t.done)
              .child(editor.dirty ? "Unsaved changes" : "Saved"),
          )
          .child(
            div().text_size(10).text_color(t.muted).child(`${editor.input.value().length} chars`),
          ),
      )
      .child(editorSave(this, id, t));
    return [head, editorBox(editor, t, json, mono, danger)];
  }

  sectionBody(
    section: { title: string; options: string[]; gap?: number },
    t: ThemeTokens,
  ): Element {
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
    return v_flex()
      .w_full()
      .gap(section.gap ?? 8)
      .children(parts);
  }

  argumentControls(t: ThemeTokens): Element {
    return h_flex()
      .w_full()
      .min_w(0)
      .mx(6)
      .gap(10)
      .items_start()
      .child(gridColumn(this.providerRow(t, true), 2, 48))
      .child(gridColumn(this.modelControl(t), 6))
      .child(gridColumn(this.effortControl(t), 3, 78))
      .when(this.spec.options.fast, (el) => el.child(gridColumn(this.fastControl(t), 1, 30)));
  }

  listBox(list: Element | null, t: ThemeTokens): Element {
    const box = v_flex().mx(6).py(4).rounded(8).border_1().border_color(t.border).bg(t.popover);
    return box.child(list as Element);
  }

  modelControl(t: ThemeTokens): Element {
    return v_flex()
      .gap(2)
      .child(this.controlHead("model-head", "bot.svg", "Model", t))
      .child(this.listBox(this.modelList(t), t))
      .min_w(0);
  }

  effortControl(t: ThemeTokens): Element {
    const efforts = this.current()?.efforts ?? [];
    return v_flex()
      .gap(2)
      .child(this.controlHead("effort-head", "sliders-horizontal.svg", "Effort", t))
      .child(
        efforts.length
          ? this.listBox(this.effortList(t), t)
          : div().px(4).py(2).rounded(4).bg(t.raised).text_size(10).text_color(t.muted).child("—"),
      );
  }

  fastControl(t: ThemeTokens): Element {
    const on = Boolean(this.values.fast);
    const enabled = this.fastAvailable();
    const fg = on && enabled ? t.accent_foreground : t.foreground;
    let border = t.border;
    if (enabled) border = on ? t.accent : t.input;
    const button = h_flex()
      .w(30)
      .h(24)
      .justify_center()
      .rounded(6)
      .border_1()
      .border_color(border)
      .bg(on && enabled ? t.accent : t.raised)
      .role("button")
      .accessibility_label(`Fast: ${on ? "on" : "off"}`)
      .when(enabled, (el) =>
        el.cursor_pointer().on_click((_e, cx) => {
          this.values.fast = !on;
          this.rememberPreset();
          cx.notify();
        }),
      )
      .when(!enabled, (el) => el.opacity(0.5))
      .child(svg("mods/orca-assets/zap--orca-agent-flyout.svg").size(13).text_color(fg));
    return v_flex()
      .gap(2)
      .flex_none()
      .child(div().h(18))
      .child(
        this.tip("fast", enabled ? "Fast mode" : "Fast mode is unavailable for this model", button),
      );
  }

  toggleControl(id: string, option: OptionSpec, t: ThemeTokens): Element {
    const on = Boolean(this.values[id]);
    const enabled = id === "fast" ? this.fastAvailable() : true;
    let border = t.border;
    if (enabled) border = on ? t.accent : t.input;
    return h_flex()
      .items_center()
      .gap(6)
      .child(div().text_size(9).text_color(t.dim).child(option.label))
      .child(
        h_flex()
          .h(24)
          .px(8)
          .rounded(6)
          .border_1()
          .border_color(border)
          .bg(on && enabled ? t.accent : t.raised)
          .text_size(10)
          .when(enabled, (el) =>
            el.cursor_pointer().on_click((_e, cx) => {
              this.values[id] = !on;
              this.rememberPreset();
              cx.notify();
            }),
          )
          .when(!enabled, (el) => el.opacity(0.5))
          .child(
            div()
              .flex_none()
              .text_color(on && enabled ? t.accent_foreground : t.foreground)
              .child(on ? "ON" : "OFF"),
          ),
      );
  }

  openAgentSettings(): void {
    const p = this.context();
    setShared("agent-manager.open-agent", { key: this.key });
    run("orca-header.agent-settings");
    setShared("orca-agent-flyout", null);
    closeOverlay(p.overlay as string);
    closeOverlay(p.menu as string);
  }

  showSettingsShortcut(): boolean {
    return !this.settingsContext;
  }

  header(t: ThemeTokens): Element {
    return h_flex()
      .h(26)
      .mx(6)
      .mb(2)
      .gap(8)
      .items_center()
      .child(
        div()
          .text_size(13)
          .font_medium()
          .text_color(t.foreground)
          .child(this.settingsContext ? "Harness CLI arguments" : this.spec.label),
      )
      .child(div().flex_1())
      .when(this.models && this.spec.ui?.reset, (el) =>
        el.child(
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
            .child(
              svg("mods/orca-assets/rotate-ccw--orca-agent-flyout.svg")
                .size(14)
                .text_color(t.muted),
            ),
        ),
      )
      .when(this.showSettingsShortcut(), (el) =>
        el.child(
          div()
            .id("agent-full-settings")
            .size(26)
            .flex()
            .items_center()
            .justify_center()
            .role("button")
            .accessibility_label("Open " + this.spec.label + " settings")
            .tooltip("Open agent settings on this computer")
            .text_color(t.muted)
            .cursor_pointer()
            .hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.openAgentSettings();
            })
            .child(svg("mods/orca-assets/bot.svg").size(19)),
        ),
      );
  }

  previewSignature(argv: string[]): string {
    return JSON.stringify([
      argv,
      this.values,
      this.providerId,
      Boolean(this.current()),
      this.settingsContext?.herdrEnv !== false,
      Object.entries(this.editors ?? {}).map(([id, editor]) => [id, editor.input.value()]),
    ]);
  }

  async buildPreview(argv: string[]): Promise<PreviewResult> {
    if (!this.settingsLoaded || !this.current())
      return { error: "Choose an available model before previewing the command." };
    const result = await this.buildLaunch({ argv }, { preview: true });
    if (result.argv && this.settingsContext?.herdrEnv !== false)
      result.argv = ["env", "HERDR_ENV=1", ...result.argv];
    return result.argv
      ? result
      : { error: result.error ?? "Fix invalid JSON to preview the command." };
  }

  syncPreview(argv: string[], cx: Context): void {
    const signature = this.previewSignature(argv);
    if (signature === this.previewKey) return;
    this.previewKey = signature;
    const generation = (this.previewGeneration = (this.previewGeneration ?? 0) + 1);
    this.previewResult = null;
    cx.spawn(async (taskCx) => {
      let result: PreviewResult;
      try {
        result = await this.buildPreview(argv);
      } catch (e) {
        result = { error: errorMessage(e) };
      }
      if (this.previewKey !== signature || this.previewGeneration !== generation) return;
      this.previewResult = result;
      taskCx.notify();
    });
  }

  renderSettings(
    t: ThemeTokens,
    cx: Context,
    { argv, format, copy, enabled = false }: PreviewCommand,
  ): Element {
    if (this.settingsLoaded && this.models) this.syncPreview(argv, cx);
    const preview = this.previewResult;
    const command = preview?.argv ? format(preview.argv as string[]) : null;
    return v_flex()
      .id("am-harness-form")
      .w_full()
      .min_w(0)
      .gap(6)
      .child(this.header(t))
      .when(!this.models && !this.error, (el) =>
        el.child(div().px(8).py(6).text_color(t.muted).child("Loading models…")),
      )
      .when(Boolean(this.error), (el) =>
        el.child(div().px(8).py(6).text_color(t.blocked).child(this.error)),
      )
      .when(Boolean(this.settingsSaveError), (el) =>
        el.child(
          div()
            .px(8)
            .text_color(t.blocked)
            .child("Could not save: " + this.settingsSaveError),
        ),
      )
      .when(this.settingsLoaded, (el) =>
        el.children(
          sectionsOf(this.spec).flatMap((section, at) => [
            ...(at ? [this.divider(t)] : []),
            this.sectionHead(section.title, t, at === 0),
            ...(section.title === "HARNESS CLI ADVANCED ARGUMENTS" && this.collapsedAdvanced
              ? []
              : [this.sectionBody(section, t)]),
          ]),
        ),
      )
      .child(this.divider(t))
      .child(this.settingsPreview(t, { command, argv, copy }))
      .child(this.settingsLaunch(t, { command, argv, enabled }));
  }

  settingsPreview(
    t: ThemeTokens,
    {
      command,
      argv,
      copy,
    }: { command: string | null; argv: string[]; copy: PreviewCommand["copy"] },
  ): Element {
    const unavailable = this.error ? "Command preview unavailable." : "Building command…";
    return v_flex()
      .w_full()
      .gap(6)
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .child(div().flex_1().font_semibold().text_color(t.foreground).child("Preview command"))
          .when(Boolean(command), (el) =>
            el.child(previewCopyButton(this, command, argv, t, copy)),
          ),
      )
      .child(
        div()
          .w_full()
          .p(10)
          .rounded(8)
          .bg(t.surface)
          .border_1()
          .border_color(t.border)
          .font_family((settings()?.font_family ?? "JetBrains Mono") as string)
          .text_size(11)
          .text_color(command ? t.foreground : t.muted)
          .child(command ?? this.previewResult?.error ?? unavailable),
      )
      .when(Boolean(command), (el) =>
        el.child(
          div()
            .text_size(10)
            .text_color(this.settingsContext?.herdrEnv === false ? t.dim : t.done)
            .child(this.settingsContext?.herdrEnv === false ? "HERDR_ENV: not set" : "HERDR_ENV=1"),
        ),
      )
      .when(this.spec.wrap?.after === "opencodeVariant" && Boolean(command), (el) =>
        el.child(
          div()
            .text_size(11)
            .text_color(t.muted)
            .child(
              "OpenCode effort is stored separately as its model variant; it is not an argv flag.",
            ),
        ),
      );
  }

  settingsLaunch(
    t: ThemeTokens,
    { command, argv, enabled }: { command: string | null; argv: string[]; enabled: boolean },
  ): Element {
    const active = (spaces() ?? []).find((space) => space.active);
    const canLaunch = Boolean(command && enabled && active && !active.machine && !this.launching);
    return h_flex()
      .items_center()
      .gap(8)
      .child(
        div()
          .flex_1()
          .text_size(11)
          .text_color(t.muted)
          .child("Selections save automatically. Text editors have their own Save control."),
      )
      .child(
        div()
          .id("am-launch-from-settings")
          .h(30)
          .px(12)
          .rounded(7)
          .flex()
          .items_center()
          .justify_center()
          .role("button")
          .accessibility_label("Launch terminal")
          .bg(canLaunch ? t.accent : t.raised)
          .text_color(canLaunch ? t.accent_foreground : t.muted)
          .tooltip(
            active?.machine
              ? "Choose a local workspace to launch this agent"
              : "Launch with the current configuration",
          )
          .when(canLaunch, (el) =>
            el.cursor_pointer().on_click((_e, eventCx) => {
              if (this.previewKey !== this.previewSignature(argv)) return;
              this.settingsContext = { ...this.settingsContext, argv, space: active!.id };
              this.launch(eventCx);
            }),
          )
          .child("Launch terminal"),
      );
  }

  render() {
    const t = themeTokens();
    const sections = sectionsOf(this.spec);
    return v_flex()
      .id("orca-agent-flyout")

      .w_full()
      .p(6)
      .gap(2)
      .bg(t.popover)
      .text_size(12)
      .when(this.models || this.showSettingsShortcut(), (el) => el.child(this.header(t)))
      .when(!this.models && !this.error, (el) =>
        el.child(div().px(14).py(6).text_color(t.muted).child("Loading models…")),
      )
      .when(Boolean(this.error), (el) =>
        el.child(div().px(14).py(6).text_color(t.blocked).child(this.error)),
      )
      .when(this.models, (el) =>
        el.children(
          sections.flatMap((section, at) => [
            ...(at > 0 ? [this.divider(t)] : []),
            this.sectionHead(section.title, t, at === 0),
            ...(section.title === "HARNESS CLI ADVANCED ARGUMENTS" && this.collapsedAdvanced
              ? []
              : [this.sectionBody(section, t)]),
          ]),
        ),
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
          .child(
            svg("mods/orca-assets/square-terminal--orca-agent-flyout.svg").size(16).flex_none(),
          )
          .child(div().flex_1().child("Launch terminal"))
          .child(div().flex_none().text_size(13).child("↵")),
      );
  }
}

class EmptyBase {}
type AgentViewConstructor = new (
  ...args: ConstructorParameters<ViewClass>
) => InstanceType<ViewClass> & AgentConfigCore;
type StandaloneAgentConstructor = new () => EmptyBase & AgentConfigCore;

function installCoreDescriptors(prototype: object): void {
  const descriptors = Object.getOwnPropertyDescriptors(AgentConfigCore.prototype);
  Reflect.deleteProperty(descriptors, "constructor");
  Object.defineProperties(prototype, descriptors);
}

export function createAgentConfigClass(Base: ViewClass): AgentViewConstructor;
export function createAgentConfigClass(): StandaloneAgentConstructor;
export function createAgentConfigClass(
  Base?: ViewClass,
): AgentViewConstructor | StandaloneAgentConstructor {
  if (Base) {
    class AgentConfig extends (Base as new () => object) {}
    installCoreDescriptors(AgentConfig.prototype);
    return AgentConfig as AgentViewConstructor;
  }
  class AgentConfig extends EmptyBase {}
  interface AgentConfig extends AgentConfigCore {}
  installCoreDescriptors(AgentConfig.prototype);
  return AgentConfig;
}
