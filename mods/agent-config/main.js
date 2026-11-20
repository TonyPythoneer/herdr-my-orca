// Agent setup flyout, opened by a row's chevron in orca-new-menu: { menu, space, name, key, argv }.
// Model, effort and hidden models are remembered in appHome()/agent-config.json, with the model
// list cached there too: it is read again only when the CLI's --version changes.
// The agent's permission flags stay in programs.json's `run`; this only adds the model and effort.
// The flyout is sticky: it stays after the pointer leaves and closes on launch.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme, setShared, exec, appHome, home, readTextFile, writeTextFile, settings } from "herdr";

const AGENTS = {
  claude: {
    command: "claude",
    // Claude has no model list command. Its stream-json `initialize` control request answers with
    // the live models (`value` is what --model takes, `supportedEffortLevels` what --effort takes).
    list: async () => {
      const request = '{"type":"control_request","request_id":"agent-config","request":{"subtype":"initialize"}}';
      const { stdout } = await exec("zsh", ["-lic", `printf '%s\\n' '${request}' | claude -p --input-format stream-json --output-format stream-json --verbose`], { timeout: 60000 });
      for (const line of stdout.split("\n")) {
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.type !== "control_response") continue;
        return (message.response?.response?.models ?? []).map((m) => ({
          id: m.value,
          label: m.displayName,
          efforts: m.supportedEffortLevels ?? [],
          fallbackEffort: "high",
        }));
      }
      throw new Error("claude did not list its models");
    },
    argsFor: (model, effort) => ["--model", model, ...(effort ? ["--effort", effort] : [])]
  },
  codex: {
    command: "codex",
    // `codex debug models` prints the catalog as JSON: its visible models and each one's efforts.
    list: async () => {
      const { stdout } = await exec("zsh", ["-lic", "codex debug models"], { timeout: 60000 });
      const rows = JSON.parse(stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1)).models ?? [];
      return rows
        .filter((m) => m.visibility === "list")
        .map((m) => ({
          id: m.slug,
          label: m.display_name,
          efforts: m.supported_reasoning_levels.map((r) => r.effort),
          fallbackEffort: m.default_reasoning_level,
        }));
    },
    argsFor: (model, effort) => ["-m", model, "-c", `model_reasoning_effort=${effort}`]
  },
  opencode: {
    command: "opencode",
    // `opencode api GET /api/model` returns the live catalog. Keep the opencode provider and
    // omlx (local MLX models); ollama is left out. Remember which opencode models are free:
    // the catalog does not reflect payment, so an unpaid account still sees paid models.
    list: async () => {
      const { stdout } = await exec("zsh", ["-lic", "opencode api GET /api/model"], { timeout: 60000 });
      const rows = JSON.parse(stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1)).data ?? [];
      return rows
        .filter((m) => m.providerID === "opencode" || m.providerID === "omlx")
        .map((m) => {
          const cost = m.cost ?? [];
          // A free model has no input or output cost on any tier (`big-pickle` is free without a
          // `-free` suffix, so the name is not used).
          const free = cost.length > 0 && cost.every((c) => (c.input ?? 0) === 0 && (c.output ?? 0) === 0);
          return {
            id: `${m.providerID}/${m.modelID ?? m.id}`,
            label: m.name ?? m.modelID ?? m.id,
            group: m.providerID === "omlx" ? "omlx" : free ? "free" : "paid",
            efforts: (m.variants ?? []).map((v) => v.id),
            fallbackEffort: "high",
            free,
          };
        });
    },
    // The TUI takes no --model flag; launch() passes the model through the environment.
    argsFor: () => []
  }
};

const AGENT_LABEL = { claude: "Claude", codex: "Codex", opencode: "OpenCode" };
const EFFORT_LABEL = { low: "Low", medium: "Med", high: "High", xhigh: "XHigh", max: "Max", ultra: "Ultra" };
const ADVISOR_MODELS = ["opus", "haiku", "fable", "sonnet"];
const ADVISOR_OPTIONS = ["none", ...ADVISOR_MODELS]; // none: no --advisor argument
const DEFAULT_ADVISOR = "opus";
const BUILTIN_STYLES = ["default", "Explanatory", "Learning"];
const NEW_STYLE = "+ New style…";
const styleDir = () => `${home()}/.claude/output-styles`;
const styleTemplate = (name) => `---\nname: ${name}\ndescription: Describe this output style\n---\n\nYou are an interactive CLI tool that helps users with software engineering tasks.\n`;
// modelRow is 30px high and the list gap is 2px, so N rows take N * 30 + (N - 1) * 2 px. The
// list is capped at MODEL_ROWS rows worth of height (MODEL_LIST_H below): beyond that the rest scroll.
const MODEL_ROWS = 10;
const rowsH = (n) => n * 30 + (n - 1) * 2;
const MODEL_LIST_H = rowsH(MODEL_ROWS);
// Bump when the cached model shape changes (opencode gained providers/groups).
const CATALOG_SCHEMA = 2;
// Reuse a cache for ten minutes; the CLI and the upstream list are checked again after that.
const CATALOG_TTL_MS = 10 * 60_000;
const OPENCODE_GROUPS = [
  { id: "all", label: "All" },
  { id: "free", label: "Free" },
  { id: "paid", label: "Paid" },
  { id: "omlx", label: "OMLX" },
];

const DEFAULT_AGENTS = {
  scout: {
    description: "Research repository and documentation",
    model: "haiku",
    tools: ["Read", "Grep", "Glob"],
    prompt: "Investigate the codebase. Return concise findings. Do not modify files.",
  },
  checker: {
    description: "Review significant code changes",
    model: "opus",
    tools: ["Read", "Grep", "Glob"],
    prompt: "Review changes for correctness, bugs, and risks. Do not modify files.",
  },
};

// Stored exactly as the editor shows it: two spaces, no trailing spaces.
const DEFAULT_AGENTS_TEXT = JSON.stringify(DEFAULT_AGENTS, null, 2);

// The supplied prompt with the shell example's leading indentation removed.
const DEFAULT_PROMPT = [
  "You are the primary implementation agent.",
  "",
  "Delegate research to scout.",
  "Write and test code yourself.",
  "Ask checker to review significant changes.",
  "",
  "Consult the advisor:",
  "1. Before finalizing complex plans.",
  "2. When the same error occurs twice.",
  "3. Before declaring complex work complete.",
  "",
  "Before finishing, verify the change by running checks on the edge cases that matter for it. Then reply with only: your answer, the one or two checks that best prove it, anything that failed or remains risky, and decisions only a human can make. Leave out the rest of your process.",
].join("\n");
const SETTINGS = `${appHome()}/agent-config.json`;

// The CLI's version, the last line of `--version` output: the cache is valid while it stays the same.
async function cliVersion(command) {
  const { stdout } = await exec("zsh", ["-lic", `${command} --version`], { timeout: 60000 });
  return stdout.trim().split("\n").pop().trim();
}

function formatAgents(text) {
  return JSON.stringify(JSON.parse(text), null, 2);
}

// JSON.parse messages differ between engines. Try "line N" first, then
// "position N" and count newlines. Fall back to line 1.
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

function normalizeAgents(text) {
  try {
    return formatAgents(text);
  } catch {
    return DEFAULT_AGENTS_TEXT;
  }
}

export default class AgentConfig extends View {
  init(_props, cx) {
    this.key = props().key;
    this.agent = AGENTS[this.key];
    this.models = null; // null while loading
    this.error = "";
    this.model = null;
    this.effort = null;
    this.hidden = new Set();
    // opencode's model list starts on free, since a paid model just answers 402.
    this.modelGroup = "free";
    this.groupOpen = false;
    this.showHidden = false; // the "-- hidden --" section stays collapsed until clicked
    this.snapshot = null; // the settings file as read, for a safe write

    this.advisorModel = DEFAULT_ADVISOR;
    this.advisorOpen = false;
    this.outputStyle = "default";
    this.styles = BUILTIN_STYLES;
    this.styleOpen = false;
    this.naming = false; // "+ New style…" shows a name input until Enter
    this.styleInput = InputState.new({ placeholder: "style name" });
    this.nameFocused = false; // blur only cancels once the input really had focus
    this.nameError = false;
    this.styleInput.on("submit", (_e, cx) => this.createStyle(cx));
    this.styleInput.on("change", (_e, cx) => { this.nameError = false; cx.notify(); });
    this.styleInput.on("focus", () => { this.nameFocused = true; });
    // Any click elsewhere blurs the input, which covers other selects, Reset and Launch.
    this.styleInput.on("blur", (_e, cx) => { if (this.nameFocused) this.cancelNaming(cx); });
    this.modelOpen = false; // model/effort are selects whose lists open inline
    this.effortOpen = false;
    this.agentsSaved = DEFAULT_AGENTS_TEXT;
    this.agentsDirty = false;
    this.agentsError = null;
    this.promptSaved = DEFAULT_PROMPT;
    this.promptDirty = false;

    // TextareaState.new needs a live host call, so it belongs here, not in render.
    this.agentsInput = TextareaState.new({ value: DEFAULT_AGENTS_TEXT, rows: 3 });
    this.agentsInput.set_soft_wrap(false); // JSON: scroll sideways, never wrap
    this.agentsInput.on("change", (_e, cx) => {
      this.agentsDirty = this.agentsInput.value() !== this.agentsSaved;
      cx.notify();
    });

    this.promptInput = TextareaState.new({ value: DEFAULT_PROMPT, rows: 3 });
    this.promptInput.on("change", (_e, cx) => {
      this.promptDirty = this.promptInput.value() !== this.promptSaved;
      cx.notify();
    });

    cx.spawn(async (cx) => {
      try {
        this.snapshot = await readTextFile(SETTINGS).catch(() => null);
        const all = JSON.parse(this.snapshot ?? "{}");
        const saved = all[this.key] ?? {};
        const preset = saved.preset ?? {};
        // The old on/off switch saved advisor: false; that is now "none".
        this.advisorModel = preset.advisor === false ? "none" : ADVISOR_OPTIONS.includes(preset.advisorModel) ? preset.advisorModel : DEFAULT_ADVISOR;
        if (typeof preset.outputStyle === "string") this.outputStyle = preset.outputStyle;
        this.loadStyles(cx);
        this.agentsSaved = typeof preset.agents === "string" ? normalizeAgents(preset.agents) : DEFAULT_AGENTS_TEXT;
        this.agentsInput.set_value(this.agentsSaved);
        this.promptSaved = typeof preset.systemPrompt === "string" ? preset.systemPrompt : DEFAULT_PROMPT;
        this.promptInput.set_value(this.promptSaved);
        this.hidden = new Set(saved.hidden ?? []);
        this.modelGroup = OPENCODE_GROUPS.some((g) => g.id === saved.group)
          ? saved.group
          : saved.onlyFree === false ? "all" : "free";
        const pickSaved = () => {
          if (!this.models?.length) return;
          const pick = this.models.find((m) => m.id === saved.model) ?? this.models[0];
          this.choose(pick, saved.effort);
        };
        // The row's own click (launchNow) launches with this flyout's saved config, as its button does.
        const go = () => {
          if (props().launchNow && this.current() && !this.launched) {
            this.launched = true;
            this.launch(cx);
          }
        };

        const cached = all.catalog?.[this.key];
        const cachedModels = cached?.schema === CATALOG_SCHEMA ? cached.models : null;
        if (cachedModels?.length) {
          // Paint the cached list before asking the CLI anything; a refresh must not show a spinner.
          this.models = cachedModels;
          pickSaved();
          cx.notify();
          go();
        }

        const fresh = cachedModels && typeof cached.checkedAt === "number" && Date.now() - cached.checkedAt < CATALOG_TTL_MS;
        if (fresh) return;

        // Check both the CLI version and the upstream list: a model can be added without a version
        // change. Both run in the background, so the cached list stays on screen meanwhile.
        const [version, models] = await Promise.all([
          cliVersion(this.agent.command).catch(() => cached?.version ?? null),
          this.agent.list(),
        ]);
        if (!models.length) throw new Error("no models available");
        if (JSON.stringify(models) !== JSON.stringify(cachedModels ?? [])) {
          this.models = models;
          const keep = models.find((m) => m.id === this.model);
          if (keep) this.choose(keep, this.effort);
          else pickSaved();
          cx.notify();
        }
        go();
        this.saveCatalog(version, models);
      } catch (e) {
        // A failed refresh keeps the cached list; only show the error when there is nothing to show.
        if (!this.models?.length) this.error = `Could not list models: ${e?.message ?? e}`;
        cx.notify();
      }
    });
  }

  // Picking a model keeps the effort when the model supports it, else the model's own default.
  choose(model, effort) {
    this.model = model.id;
    const efforts = model.efforts;
    const fallback = efforts.includes(model.fallbackEffort) ? model.fallbackEffort : efforts[0];
    this.effort = efforts.includes(effort) ? effort : efforts.includes(this.effort) ? this.effort : fallback;
  }

  current() {
    return this.models?.find((m) => m.id === this.model);
  }

  // Writes queue up, so each one builds on the last saved snapshot instead of racing it.
  persist(mutate) {
    this.saving = (this.saving ?? Promise.resolve()).then(async () => {
      let all = {};
      try { all = JSON.parse(this.snapshot ?? "{}"); } catch {}
      mutate(all);
      const text = `${JSON.stringify(all, null, 2)}\n`;
      try {
        await writeTextFile(SETTINGS, text, this.snapshot);
        this.snapshot = text;
      } catch {}
    });
  }

  remember() {
    const key = this.key;
    const { model, effort } = this;
    const hidden = [...this.hidden];
    this.persist((all) => {
      all[key] = { ...all[key], model, effort, hidden };
    });
  }

  // The opencode model group is a list preference, saved with the model and effort.
  rememberGroup() {
    const key = this.key;
    const group = this.modelGroup;
    this.persist((all) => {
      all[key] = { ...all[key], group };
    });
  }

  presetValues() {
    return {
      advisorModel: this.advisorModel,
      agents: this.agentsSaved,
      systemPrompt: this.promptSaved,
      outputStyle: this.outputStyle,
    };
  }

  rememberPreset(patch = {}) {
    const preset = { ...this.presetValues(), ...patch };
    this.persist((all) => {
      all[this.key] = { ...all[this.key], preset };
    });
  }

  // System prompt: manual save, like Agents. Closing without Save discards the edit.
  savePrompt(cx) {
    this.promptSaved = this.promptInput.value();
    this.promptDirty = false;
    this.rememberPreset({ systemPrompt: this.promptSaved });
    cx.notify();
  }

  // Custom styles are the .md files in ~/.claude/output-styles; a missing folder just means none.
  loadStyles(cx) {
    cx.spawn(async (cx) => {
      const { stdout } = await exec("ls", [styleDir()]).catch(() => ({ stdout: "" }));
      const custom = stdout.split("\n").filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
      this.styles = [...BUILTIN_STYLES, ...custom.filter((n) => !BUILTIN_STYLES.includes(n))];
      cx.notify();
    });
  }

  openStyleFile(name) {
    run("tab.new", { mod: "orca-files", props: { file: `${styleDir()}/${name}.md` } });
  }

  setStyle(name, cx) {
    this.styleOpen = false;
    if (name === NEW_STYLE) {
      this.naming = true;
      this.nameFocused = false;
      this.nameError = false;
      cx.timer.after(30, () => this.styleInput.focus()); // the input is mounted by the next frame
    } else {
      this.outputStyle = name;
      this.rememberPreset();
    }
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
    cx.spawn(async (cx) => {
      const file = `${styleDir()}/${name}.md`;
      if ((await readTextFile(file).catch(() => null)) === null) {
        await exec("mkdir", ["-p", styleDir()]);
        await writeTextFile(file, styleTemplate(name), null);
      }
      this.outputStyle = name;
      this.rememberPreset();
      this.loadStyles(cx);
      this.openStyleFile(name);
    });
    cx.notify();
  }

  setAdvisorModel(model, cx) {
    this.advisorModel = model;
    this.advisorOpen = false;
    this.rememberPreset();
    cx.notify();
  }

  // Agents: only this button commits. Launch may use uncommitted text.
  saveAgents(cx) {
    const raw = this.agentsInput.value();
    try {
      const formatted = formatAgents(raw);
      this.agentsInput.set_value(formatted);
      this.agentsSaved = formatted;
      this.agentsDirty = false;
      this.agentsError = null;
      this.rememberPreset({ agents: formatted });
    } catch (error) {
      this.agentsError = describeJsonError(error, raw);
    }
    cx.notify();
  }

  resetPreset(cx) {
    this.advisorModel = DEFAULT_ADVISOR;
    this.advisorOpen = false;
    this.outputStyle = "default";
    this.agentsInput.set_value(DEFAULT_AGENTS_TEXT);
    this.agentsSaved = DEFAULT_AGENTS_TEXT;
    this.agentsDirty = false;
    this.agentsError = null;
    this.promptInput.set_value(DEFAULT_PROMPT);
    this.promptSaved = DEFAULT_PROMPT;
    this.promptDirty = false;
    this.rememberPreset({
      advisorModel: DEFAULT_ADVISOR,
      agents: DEFAULT_AGENTS_TEXT,
      systemPrompt: DEFAULT_PROMPT,
      outputStyle: "default",
    });
    cx.notify();
  }

  saveCatalog(version, models) {
    const key = this.key;
    this.persist((all) => {
      all.catalog = { ...all.catalog, [key]: { schema: CATALOG_SCHEMA, version, checkedAt: Date.now(), models } };
    });
  }

  toggleHidden(id) {
    if (this.hidden.has(id)) this.hidden.delete(id);
    else this.hidden.add(id);
    this.remember();
  }

  launch(cx) {
    const p = props();
    if (!this.current()) return;

    const extra = [];
    // --advisor, --agents and --append-system-prompt are Claude CLI flags; codex rejects them.
    if (this.key === "claude") {
      const agents = this.agentsInput.value();
      if (agents.trim()) {
        try {
          JSON.parse(agents);
        } catch (error) {
          // Invalid live text blocks the launch, even when it was never saved.
          this.agentsError = describeJsonError(error, agents);
          this.agentsDirty = agents !== this.agentsSaved;
          cx?.notify();
          return;
        }
      }

      const prompt = this.promptInput.value();
      if (this.advisorModel !== "none") extra.push("--advisor", this.advisorModel);
      if (this.outputStyle !== "default") extra.push("--settings", JSON.stringify({ outputStyle: this.outputStyle }));
      if (agents.trim()) extra.push("--agents", agents);
      if (prompt.trim()) extra.push("--append-system-prompt", prompt);
    }

    this.remember();
    // Launch uses the live editor text and never writes it; both editors stay manual save.

    // argv elements, not shell words: no quotes around the JSON or the prompt.
    let argv = [...p.argv, ...this.agent.argsFor(this.model, this.effort), ...extra];
    if (this.key === "opencode") {
      // The TUI has no --model flag; the model goes in through its config env var. It must run its
      // own server (--standalone): the background service keeps its own config, so a TUI that
      // connects to it ignores OPENCODE_CONFIG_CONTENT and starts on the service's default model.
      argv = ["env", `OPENCODE_CONFIG_CONTENT=${JSON.stringify({ model: this.model })}`, ...p.argv, "--standalone"];
      // Best effort: the TUI keeps its effort in its own state file, not in the config.
      this.rememberVariant();
    }
    run("tab.new", { space: p.space, argv });
    setShared("agent-config", null);
    closeOverlay(p.overlay);
    closeOverlay(p.menu);
  }

  // opencode keeps the chosen effort in ~/.local/state/opencode/model.json `variant`; write it
  // before launch. Best effort only: a failure must not block the launch.
  async rememberVariant() {
    if (!this.effort) return;
    const file = `${home()}/.local/state/opencode/model.json`;
    try {
      const current = await readTextFile(file).catch(() => null);
      const all = current ? JSON.parse(current) : {};
      const variant = all.variant && typeof all.variant === "object" ? all.variant : {};
      variant[this.model] = this.effort;
      all.variant = variant;
      await writeTextFile(file, `${JSON.stringify(all, null, 2)}\n`, current);
    } catch {}
  }

  modelRow(m, t) {
    const on = this.model === m.id;
    const hidden = this.hidden.has(m.id);
    return h_flex()
      .id(`model-${m.id}`)
      .h(30)
      .flex_none()
      .mx(6)
      .px(10)
      .gap(8)
      .rounded(7)
      .items_center()
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        this.choose(m, this.effort);
        this.modelOpen = false;
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
          .child(svg(hidden ? "mods/agent-config/eye-off.svg" : "mods/agent-config/eye.svg").size(14).text_color(t.muted)),
      );
  }

  // opencode mixes cloud models (free/paid) and local omlx models; the list shows one group.
  groupSelect(t) {
    return h_flex()
      .id("model-group")
      .w(80)
      .h(26)
      .px(8)
      .gap(6)
      .items_center()
      .justify_between()
      .rounded(6)
      .border_1()
      .border_color(this.groupOpen ? t.ring : t.input)
      .bg(t.raised)
      .cursor_pointer()
      .on_click((_e, cx) => {
        this.groupOpen = !this.groupOpen;
        cx.notify();
      })
      .child(div().text_size(11).text_color(t.foreground).child(OPENCODE_GROUPS.find((g) => g.id === this.modelGroup)?.label ?? this.modelGroup))
      .child(div().text_size(10).text_color(t.muted).child("▾"));
  }

  // Visible models, then the collapsed "-- hidden --" section: the list as the other agents show it.
  modelList(t) {
    const all = this.key === "opencode"
      ? (this.models ?? []).filter((m) => this.modelGroup === "all" || (m.group ?? (m.free ? "free" : "paid")) === this.modelGroup)
      : this.models ?? [];
    const visible = all.filter((m) => !this.hidden.has(m.id));
    const hiddenModels = all.filter((m) => this.hidden.has(m.id));
    // Rows actually rendered: visible plus (if expanded) hidden ones; the hidden heading counts
    // as a row whenever anything is hidden, so a list of only hidden models cannot collapse to
    // zero height and hide the way back. The box gets a definite height — gpui sizes a
    // content-based flex item to its content and does not clamp it to max-height, so max_h(..)
    // alone lets every model render with no scrollbar. Fewer than MODEL_ROWS rows set the box
    // to their exact height (nothing blank below them); more cap and the rest scroll.
    const shownRows = visible.length
      + (hiddenModels.length > 0 ? 1 : 0)
      + (this.showHidden ? hiddenModels.length : 0);
    const listH = shownRows === 0 ? 0 : Math.min(rowsH(shownRows), MODEL_LIST_H);
    return v_flex()
      .gap(2)
      .when(this.key === "opencode", (el) => el
        .child(
          h_flex()
            .mx(6)
            .mb(2)
            .h(28)
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
            .children(OPENCODE_GROUPS.map((g) =>
              h_flex()
                .id(`group-${g.id}`)
                .h(26)
                .px(10)
                .gap(8)
                .items_center()
                .cursor_pointer()
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => {
                  this.modelGroup = g.id;
                  this.groupOpen = false;
                  this.rememberGroup();
                  cx.notify();
                })
                .child(div().flex_1().text_size(12).text_color(t.foreground).child(g.label))
                .when(this.modelGroup === g.id, (row) => row.child(div().text_color(t.accent).child("✓"))),
            )),
        )),
      )
      .child(
        v_flex()
          .id("agent-config-models")
          .h(listH)
          .min_h(0)
          .flex_shrink(1)
          .overflow_y_scroll()
          .gap(2)
          .children(visible.map((m) => this.modelRow(m, t)))
          .when(hiddenModels.length > 0, (el) =>
            el
              .child(
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
              )
              .when(this.showHidden, (inner) => inner.children(hiddenModels.map((m) => this.modelRow(m, t)))),
          ),
      );
  }

  effortList(t) {
    return v_flex().children(
      (this.current()?.efforts ?? []).map((e) =>
        h_flex()
          .id(`effort-${e}`)
          .h(28)
          .mx(6)
          .px(10)
          .gap(8)
          .items_center()
          .rounded(6)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => {
            this.effort = e;
            this.effortOpen = false;
            this.remember();
            cx.notify();
          })
          .child(div().flex_1().child(EFFORT_LABEL[e] ?? e))
          .when(this.effort === e, (el) => el.child(div().text_color(t.accent).child("✓"))),
      ),
    );
  }

  selectBox(id, label, value, open, onToggle, t, valueEl = null, borderColor = null) {
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
      .cursor_pointer()
      .on_click((_e, cx) => onToggle(cx))
      .child(
        v_flex()
          .min_w(0)
          .child(div().text_size(9).text_color(t.dim).child(label))
          .child(valueEl ?? div().text_size(12).text_color(t.foreground).truncate().child(value)),
      )
      .child(div().flex_none().text_size(11).text_color(t.muted).child("▾"));
  }

  // Model and effort side by side as selects; one list open at a time, inline below.
  pickerRow(t) {
    const box = (list) => v_flex().mx(6).py(4).rounded(8).border_1().border_color(t.border).bg(t.popover).child(list);
    const hasEfforts = (this.current()?.efforts ?? []).length > 0;
    return v_flex()
      .gap(4)
      .child(
        h_flex()
          .mx(6)
          .gap(8)
          .child(
            this.selectBox("model-select", "MODEL", this.current()?.label ?? "…", this.modelOpen, (cx) => {
              this.modelOpen = !this.modelOpen;
              this.groupOpen = false;
              this.effortOpen = false;
              this.advisorOpen = false;
              cx.notify();
            }, t),
          )
          // A model without effort variants has nothing to pick: no effort select.
          .when(hasEfforts, (el) => el.child(
            this.selectBox("effort-select", "EFFORT", EFFORT_LABEL[this.effort] ?? this.effort ?? "…", this.effortOpen, (cx) => {
              this.effortOpen = !this.effortOpen;
              this.modelOpen = false;
              this.groupOpen = false;
              this.advisorOpen = false;
              cx.notify();
            }, t),
          )),
      )
      .when(this.modelOpen, (el) => el.child(box(this.modelList(t))))
      .when(hasEfforts && this.effortOpen, (el) => el.child(box(this.effortList(t))));
  }

  header(t) {
    return h_flex()
      .h(26)
      .mx(6)
      .mb(2)
      .gap(8)
      .items_center()
      .child(div().text_size(13).font_medium().text_color(t.foreground).child(AGENT_LABEL[this.key] ?? this.key))
      .child(div().flex_1())
      .when(this.key === "claude", (el) => el.child(
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
          .child(svg("mods/agent-config/rotate-ccw.svg").size(14).text_color(t.muted)),
      ));
  }

  optionList(id, options, current, onPick, t) {
    return v_flex().children(
      options.map((name) =>
        h_flex()
          .id(`${id}-${name}`)
          .h(28)
          .mx(6)
          .px(10)
          .gap(8)
          .items_center()
          .rounded(6)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => onPick(name, cx))
          .child(div().flex_1().child(name))
          .when(name === current, (el) => el.child(div().text_color(t.accent).child("✓"))),
      ),
    );
  }

  presetSection(t) {
    const box = (list) => v_flex().mx(6).py(4).rounded(8).border_1().border_color(t.border).bg(t.popover).child(list);
    const mono = settings()?.font_family ?? "JetBrains Mono";
    const danger = settings()?.dark ? "#ef4444" : "#dc2626";
    const badge = this.agentsError
      ? { text: `Invalid JSON · line ${this.agentsError.line}`, color: danger, bg: "#ef444414", border: "#ef444440" }
      : this.agentsDirty
        ? { text: "Unsaved changes", color: t.working, bg: "#eab30814", border: "#eab30840" }
        : { text: "Valid JSON", color: t.done, bg: "#10b98114", border: "#10b98138" };

    return v_flex()
      .w_full()
      .gap(4)
      .child(div().mx(6).pt(2).text_size(10).font_medium().text_color(t.dim).child("ADVANCED ARGUMENTS"))
      // Advisor and output style: selects like model and effort, lists open inline below
      .child(
        h_flex()
          .mx(6)
          .gap(8)
          .child(
            this.selectBox("advisor-select", "ADVISOR", this.advisorModel, this.advisorOpen, (cx) => {
              this.advisorOpen = !this.advisorOpen;
              this.styleOpen = false;
              this.modelOpen = false;
              this.effortOpen = false;
              this.groupOpen = false;
              cx.notify();
            }, t),
          )
          .child(
            this.selectBox("style-select", this.nameError ? "LETTERS, DIGITS, - _ ONLY" : this.naming ? "NEW OUTPUT STYLE" : "OUTPUT STYLE", this.outputStyle, this.styleOpen || this.naming, (cx) => {
              if (this.naming) return;
              this.styleOpen = !this.styleOpen;
              this.advisorOpen = false;
              this.modelOpen = false;
              this.effortOpen = false;
              this.groupOpen = false;
              cx.notify();
            }, t, this.naming ? div().flex_1().min_w(0).on_key_down((e, cx) => {
              if (e.key === "escape") { this.cancelNaming(cx); cx.stop_propagation(); }
            }).child(Input.new(this.styleInput)) : null,
            this.nameError ? (settings()?.dark ? "#ef4444" : "#dc2626") : null),
          ),
      )
      .when(this.advisorOpen, (el) => el.child(box(this.optionList("advisor", ADVISOR_OPTIONS, this.advisorModel, (name, cx) => this.setAdvisorModel(name, cx), t))))
      .when(this.styleOpen, (el) => el.child(box(this.optionList("style", [...this.styles, NEW_STYLE], this.outputStyle, (name, cx) => this.setStyle(name, cx), t))))
      // Agents
      .child(
        h_flex()
          .mx(6)
          .mt(2)
          .gap(8)
          .items_center()
          .child(div().text_size(12).font_medium().text_color(t.foreground).child("Agents"))
          .child(div().flex_1())
          .child(
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
          )
          .child(
            h_flex()
              .id("save-agents")
              .items_center()
              .justify_center()
              .h(21)
              .px(12)
              .rounded(5)
              .bg(t.accent)
              .text_size(10)
              .font_medium()
              .text_color(t.accent_foreground)
              .cursor_pointer()
              .on_click((_e, cx) => this.saveAgents(cx))
              .child("Save"),
          ),
      )
      .child(
        v_flex()
          .mx(6)
          .rounded(8)
          .border_1()
          .border_color(this.agentsError ? danger : t.border)
          .bg(t.raised)
          .child(
            // Mono keeps the two-space JSON indent visible; the padding matches orca-changes' message box.
            div()
              .px(8)
              .py(6)
              .font_family(mono)
              .child(
                Textarea.new(this.agentsInput)
                  .w_full()
                  .font_family(mono)
                  .text_size(11)
                  .text_color(t.foreground)
                  .bg("#00000000")
              ),
          )
      )
      // System prompt
      .child(
        h_flex()
          .mx(6)
          .mt(2)
          .gap(8)
          .items_center()
          .child(div().text_size(12).font_medium().text_color(t.foreground).child("Append system prompt"))
          .child(div().flex_1())
          .child(
            div()
              .text_size(10)
              .text_color(this.promptDirty ? t.working : t.done)
              .child(this.promptDirty ? "Unsaved changes" : "Saved"),
          )
          .child(
            div()
              .text_size(10)
              .text_color(t.muted)
              .child(`${this.promptInput.value().length} chars`),
          )
          .child(
            h_flex()
              .id("save-prompt")
              .items_center()
              .justify_center()
              .h(21)
              .px(12)
              .rounded(5)
              .bg(t.accent)
              .text_size(10)
              .font_medium()
              .text_color(t.accent_foreground)
              .cursor_pointer()
              .on_click((_e, cx) => this.savePrompt(cx))
              .child("Save"),
          ),
      )
      .child(
        v_flex()
          .mx(6)
          .rounded(8)
          .border_1()
          .border_color(t.border)
          .bg(t.raised)
          .child(
            div()
              .px(8)
              .py(6)
              .child(
                Textarea.new(this.promptInput)
                  .w_full()
                  .text_size(12)
                  .text_color(t.foreground)
                  .bg("#00000000")
              ),
          ),
      );
  }

  render() {
    const t = theme();
    return v_flex()
      .id("agent-config")
      // Fills the popup; its width is set where orca-new-menu opens it.
      .w_full()
      .p(6)
      .gap(2)
      .bg(t.popover)
      .text_size(12)
      .when(this.models, (el) => el.child(this.header(t)))
      .when(!this.models && !this.error, (el) => el.child(div().px(14).py(6).text_color(t.muted).child("Loading models…")))
      .when(Boolean(this.error), (el) => el.child(div().px(14).py(6).text_color(t.blocked).child(this.error)))
      .when(this.models, (el) => el.child(this.pickerRow(t)))
      .child(div().h(1).mx(6).my(4).bg(t.border))
      .when(this.key === "claude" && this.models, (el) => el.child(this.presetSection(t)))
      .child(
        h_flex()
          .id("launch")
          .h(34)
          .mx(6)
          .mt(6)
          .px(12)
          .gap(8)
          .items_center()
          .rounded(7)
          .cursor_pointer()
          .bg(t.accent)
          .text_color(t.background)
          .on_click((_e, cx) => this.launch(cx))
          .child(svg("mods/agent-config/square-terminal.svg").size(16).flex_none())
          .child(div().flex_1().child("Launch terminal"))
          .child(div().flex_none().text_size(13).child("↵")),
      );
  }
}
