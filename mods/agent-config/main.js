// Agent setup flyout, opened by a row's chevron in orca-new-menu: { menu, space, name, key, argv }.
// Model, effort and hidden models are remembered in appHome()/agent-config.json, with the model
// list cached there too: it is read again only when the CLI's --version changes.
// The agent's permission flags stay in programs.json's `run`; this only adds the model and effort.
// It stays open while the pointer is on the chevron or in it (shared "agent-config".hot).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme, shared, setShared, exec, appHome, readTextFile, writeTextFile } from "herdr";

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
const SETTINGS = `${appHome()}/agent-config.json`;

// The CLI's version, the last line of `--version` output: the cache is valid while it stays the same.
async function cliVersion(command) {
  const { stdout } = await exec("zsh", ["-lic", `${command} --version`], { timeout: 60000 });
  return stdout.trim().split("\n").pop().trim();
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
    cx.spawn(async (cx) => {
      try {
        this.snapshot = await readTextFile(SETTINGS).catch(() => null);
        const all = JSON.parse(this.snapshot ?? "{}");
        const saved = all[this.key] ?? {};
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

  launch() {
    const p = props();
    if (!this.current()) return;
    this.remember();
    run("tab.new", { name: p.name, space: p.space, argv: [...p.argv, ...this.agent.argsFor(this.model, this.effort)] });
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

  effortRow(t) {
    const efforts = this.current()?.efforts ?? [];
    // Same inset as the model rows (mx 6 + px 10), so the labels line up with the list above.
    return h_flex()
      .mx(6)
      .px(10)
      .gap(4)
      .children(efforts.map((e) => {
        const on = this.effort === e;
        return h_flex()
          .id(`effort-${e}`)
          .flex_1()
          .min_w(0)
          .h(28)
          .items_center()
          .justify_center()
          .rounded(6)
          .text_size(12)
          .cursor_pointer()
          .text_color(on ? t.foreground : t.muted)
          .when(on, (el) => el.bg(t.selected))
          .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
          .on_click((_e, cx) => {
            this.effort = e;
            this.remember();
            cx.notify();
          })
          .child(EFFORT_LABEL[e] ?? e);
      }));
  }

  render() {
    const t = theme();
    const ready = Boolean(this.current());
    const all = this.models ?? [];
    const visible = all.filter((m) => !this.hidden.has(m.id));
    const hiddenModels = all.filter((m) => this.hidden.has(m.id));
    return v_flex()
      .id("agent-config")
      .on_hover((hovered, cx) => this.hover(hovered, cx))
      // Fills the popup; its width is set where orca-new-menu opens it.
      .w_full()
      .p(6)
      .gap(2)
      .bg(t.popover)
      .text_size(12)
      .when(!this.models && !this.error, (el) => el.child(div().px(14).py(6).text_color(t.muted).child("Loading models…")))
      .when(Boolean(this.error), (el) => el.child(div().px(14).py(6).text_color(t.blocked).child(this.error)))
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
      )
      .child(div().h(1).mx(6).my(4).bg(t.border))
      .when(ready, (el) => el.child(this.effortRow(t)))
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
          .on_click(() => this.launch())
          .child(svg("mods/agent-config/square-terminal.svg").size(16).flex_none())
          .child(div().flex_1().child("Launch terminal"))
          .child(div().flex_none().text_size(13).child("↵")),
      );
  }
}
