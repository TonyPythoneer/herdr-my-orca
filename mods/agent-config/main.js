// Agent setup flyout, opened by a row's chevron in orca-new-menu: { menu, space, name, key, argv }.
// Model, effort and hidden models are remembered in appHome()/agent-config.json, with the model
// list cached there too: it is read again only when the CLI's --version changes.
// The agent's permission flags stay in programs.json's `run`; this only adds the model and effort.
// It stays open while the pointer is on the chevron or in it (shared "agent-config".hot).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { run, props, closeOverlay, theme, shared, setShared, exec, appHome, readTextFile, writeTextFile, settings } from "herdr";

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
  }
};

const EFFORT_LABEL = { low: "Low", medium: "Med", high: "High", xhigh: "XHigh", max: "Max", ultra: "Ultra" };
const ADVISOR_MODELS = ["opus", "haiku", "fable", "sonnet"];
const DEFAULT_ADVISOR = "opus";

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
  "Skip unnecessary delegation for trivial tasks.",
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
    this.showHidden = false; // the "-- hidden --" section stays collapsed until clicked
    this.snapshot = null; // the settings file as read, for a safe write

    this.advisorOn = true;
    this.advisorModel = DEFAULT_ADVISOR;
    this.advisorOpen = false;
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
        this.advisorOn = preset.advisor !== false;
        this.advisorModel = ADVISOR_MODELS.includes(preset.advisorModel) ? preset.advisorModel : DEFAULT_ADVISOR;
        this.agentsSaved = typeof preset.agents === "string" ? normalizeAgents(preset.agents) : DEFAULT_AGENTS_TEXT;
        this.agentsInput.set_value(this.agentsSaved);
        this.promptSaved = typeof preset.systemPrompt === "string" ? preset.systemPrompt : DEFAULT_PROMPT;
        this.promptInput.set_value(this.promptSaved);
        this.hidden = new Set(saved.hidden ?? []);
        const version = await cliVersion(this.agent.command);
        const cached = all.catalog?.[this.key];
        if (cached?.version === version && cached.models?.length) {
          this.models = cached.models;
        } else {
          this.models = await this.agent.list();
          this.saveCatalog(version, this.models);
        }
        const pick = this.models.find((m) => m.id === saved.model) ?? this.models[0];
        this.choose(pick, saved.effort);
      } catch (e) {
        this.error = `Could not list models: ${e?.message ?? e}`;
      }
      cx.notify();
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

  presetValues() {
    return {
      advisor: this.advisorOn,
      advisorModel: this.advisorModel,
      agents: this.agentsSaved,
      systemPrompt: this.promptSaved,
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

  setAdvisor(on, cx) {
    this.advisorOn = on;
    this.rememberPreset();
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
    this.advisorOn = true;
    this.advisorModel = DEFAULT_ADVISOR;
    this.advisorOpen = false;
    this.agentsInput.set_value(DEFAULT_AGENTS_TEXT);
    this.agentsSaved = DEFAULT_AGENTS_TEXT;
    this.agentsDirty = false;
    this.agentsError = null;
    this.promptInput.set_value(DEFAULT_PROMPT);
    this.promptSaved = DEFAULT_PROMPT;
    this.promptDirty = false;
    this.rememberPreset({
      advisor: true,
      advisorModel: DEFAULT_ADVISOR,
      agents: DEFAULT_AGENTS_TEXT,
      systemPrompt: DEFAULT_PROMPT,
    });
    cx.notify();
  }

  saveCatalog(version, models) {
    const key = this.key;
    this.persist((all) => {
      all.catalog = { ...all.catalog, [key]: { version, models } };
    });
  }

  toggleHidden(id) {
    if (this.hidden.has(id)) this.hidden.delete(id);
    else this.hidden.add(id);
    this.remember();
  }

  // Leaving closes after a short grace, unless the pointer came back to the chevron or into here.
  hover(hovered, cx) {
    const s = shared("agent-config");
    if (s) setShared("agent-config", { ...s, hot: hovered });
    if (hovered) return;
    cx.timer.after(150, () => {
      const now = shared("agent-config");
      if (now?.hot || now?.id !== props().overlay) return;
      setShared("agent-config", null);
      closeOverlay(props().overlay);
    });
  }

  launch(cx) {
    const p = props();
    if (!this.current()) return;

    const extra = [];
    // --advisor, --agents and --append-system-prompt are Claude CLI flags; codex rejects them.
    if (this.key === "claude" && this.advisorOn) {
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
      extra.push("--advisor", this.advisorModel);
      if (agents.trim()) extra.push("--agents", agents);
      if (prompt.trim()) extra.push("--append-system-prompt", prompt);
    }

    this.remember();
    // Launch uses the live editor text and never writes it; both editors stay manual save.

    // argv elements, not shell words: no quotes around the JSON or the prompt.
    run("tab.new", {
      space: p.space,
      argv: [...p.argv, ...this.agent.argsFor(this.model, this.effort), ...extra],
    });
    setShared("agent-config", null);
    closeOverlay(p.overlay);
    closeOverlay(p.menu);
  }

  modelRow(m, t) {
    const on = this.model === m.id;
    const hidden = this.hidden.has(m.id);
    return h_flex()
      .id(`model-${m.id}`)
      .h(30)
      .mx(6)
      .px(10)
      .gap(8)
      .rounded(7)
      .items_center()
      .cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => {
        this.choose(m, this.effort);
        this.modelOpen = false;
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

  // Visible models, then the collapsed "-- hidden --" section: the list as the other agents show it.
  modelList(t) {
    const all = this.models ?? [];
    const visible = all.filter((m) => !this.hidden.has(m.id));
    const hiddenModels = all.filter((m) => this.hidden.has(m.id));
    return v_flex()
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
          .when(this.effort === e, (el) => el.bg(t.selected))
          .when(this.effort !== e, (el) => el.hover((s) => s.bg(t.hover)))
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

  selectBox(id, label, value, open, onToggle, t) {
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
      .border_color(open ? t.ring : t.input)
      .bg(t.raised)
      .cursor_pointer()
      .on_click((_e, cx) => onToggle(cx))
      .child(
        v_flex()
          .min_w(0)
          .child(div().text_size(9).text_color(t.dim).child(label))
          .child(div().text_size(12).text_color(t.foreground).truncate().child(value)),
      )
      .child(div().flex_none().text_size(11).text_color(t.muted).child("▾"));
  }

  // Model and effort side by side as selects; one list open at a time, inline below.
  pickerRow(t) {
    const box = (list) => v_flex().mx(6).py(4).rounded(8).border_1().border_color(t.border).bg(t.popover).child(list);
    return v_flex()
      .gap(4)
      .child(
        h_flex()
          .mx(6)
          .gap(8)
          .child(
            this.selectBox("model-select", "MODEL", this.current()?.label ?? "…", this.modelOpen, (cx) => {
              this.modelOpen = !this.modelOpen;
              this.effortOpen = false;
              this.advisorOpen = false;
              cx.notify();
            }, t),
          )
          .child(
            this.selectBox("effort-select", "EFFORT", EFFORT_LABEL[this.effort] ?? this.effort ?? "…", this.effortOpen, (cx) => {
              this.effortOpen = !this.effortOpen;
              this.modelOpen = false;
              this.advisorOpen = false;
              cx.notify();
            }, t),
          ),
      )
      .when(this.modelOpen, (el) => el.child(box(this.modelList(t))))
      .when(this.effortOpen, (el) => el.child(box(this.effortList(t))));
  }

  header(t) {
    return h_flex()
      .h(26)
      .mx(6)
      .mb(2)
      .gap(8)
      .items_center()
      .child(div().text_size(13).font_medium().text_color(t.foreground).child(this.key === "claude" ? "Claude" : "Codex"))
      .when(this.key === "claude", (el) => el.child(
        h_flex()
          .items_center()
          .justify_center()
          .px(7)
          .h(18)
          .rounded(9)
          .border_1()
          .border_color("#3b82f633")
          .bg("#3b82f612")
          .text_size(9)
          .text_color(t.accent)
          .child("PRESET"),
      ))
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

  switchRow(id, on, onToggle, t) {
    return h_flex()
      .id(id)
      .w(34)
      .h(20)
      .flex_none()
      .rounded(10)
      .px(2)
      .items_center()
      .cursor_pointer()
      .bg(on ? t.accent : t.hover)
      .when(on, (el) => el.justify_end())
      .when(!on, (el) => el.justify_start())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        onToggle(cx);
      })
      .child(div().w(16).h(16).rounded(8).bg(t.accent_foreground));
  }

  presetSection(t) {
    const dim = this.advisorOn ? 1 : 0.45;
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
      // Advisor master row
      .child(
        v_flex()
          .mx(6)
          .p(8)
          .gap(4)
          .rounded(8)
          .border_1()
          .border_color(t.border)
          .child(
            h_flex()
              .gap(10)
              .items_center()
              .child(this.switchRow("advisor-switch", this.advisorOn, (cx) => this.setAdvisor(!this.advisorOn, cx), t))
              .child(
                v_flex()
                  .flex_1()
                  .min_w(0)
                  .child(div().text_size(12).font_medium().text_color(t.foreground).child("Advisor"))
                  .child(div().text_size(10).text_color(t.muted).child("Master switch for --advisor, --agents and --append-system-prompt")),
              )
              .child(
                h_flex()
                  .id("advisor-select")
                  .w(84)
                  .h(32)
                  .px(10)
                  .gap(8)
                  .items_center()
                  .justify_between()
                  .rounded(7)
                  .border_1()
                  .border_color(t.input)
                  .bg(t.raised)
                  .cursor_pointer()
                  .on_click((_e, cx) => {
                    this.advisorOpen = !this.advisorOpen;
                    this.modelOpen = false;
                    this.effortOpen = false;
                    cx.notify();
                  })
                  .child(div().text_size(12).text_color(t.foreground).child(this.advisorModel))
                  .child(div().text_size(11).text_color(t.muted).child("▾")),
              ),
          )
          .when(this.advisorOpen, (el) =>
            el.child(
              v_flex()
                .rounded(6)
                .border_1()
                .border_color(t.border)
                .bg(t.popover)
                .children(
                  ADVISOR_MODELS.map((model) =>
                    h_flex()
                      .id(`advisor-${model}`)
                      .h(26)
                      .px(10)
                      .gap(8)
                      .items_center()
                      .cursor_pointer()
                      .hover((s) => s.bg(t.hover))
                      .on_click((_e, cx) => this.setAdvisorModel(model, cx))
                      .child(div().flex_1().text_size(12).text_color(t.foreground).child(model))
                      .when(model === this.advisorModel, (row) => row.child(div().text_color(t.accent).child("✓"))),
                  ),
                ),
            ),
          ),
      )
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
                  .opacity(dim),
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
          .child(div().text_size(12).font_medium().text_color(t.foreground).child("System prompt"))
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
                  .opacity(dim),
              ),
          ),
      );
  }

  render() {
    const t = theme();
    return v_flex()
      .id("agent-config")
      .on_hover((hovered, cx) => this.hover(hovered, cx))
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
