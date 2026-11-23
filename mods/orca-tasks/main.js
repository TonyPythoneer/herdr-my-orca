// Task management: the page behind the footer's clock icon. Schedules live in
// `~/.config/herdr-app/tasks.json`; the runner that fires them is in orca-chrome (its footer
// copy is always in the layout, this page's copy is not), and it publishes the reset times,
// the last run of each task and the next due time through `shared`.
//
// This page owns the file: toggles, delete and "New task" rewrite `tasks.json` with an
// expected-text write, and the JSON view writes it whole. The runner only seeds a missing file.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { appHome, layout, run, setShared, shared, theme, readTextFile, writeTextFile, settings } from "herdr";
import {
  TASKS_FILE,
  TASKS_VERSION,
  describeTrigger,
  formatClock,
  formatCountdown,
  parseTasks,
  providerLabel,
  serializeTasks,
  windowLabel,
} from "./tasks.js";

const TERMINALS_PAGE = "main-terminals";
const FILE = `${appHome()}/${TASKS_FILE}`;
const PROVIDERS = ["claude", "codex"];
const MARKS = { claude: "mods/orca-status/claude.svg", codex: "mods/orca-status/codex.svg" };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const taskText = (task) => (Array.isArray(task.argv) ? task.argv.join(" ") : "");

export default class Tasks extends View {
  init(_props, cx) {
    this.editing = false;
    this.editor = null;
    this.error = ""; // this page's write error
    this.saved = false;
    // The countdowns are computed at render time; only the shown page needs the clock to move.
    cx.timer.every(30_000, (cx) => {
      if (find(layout(), "main")?.active === "main-tasks") cx.notify();
    });
  }

  get config() {
    return shared("tasks.config") ?? null;
  }

  get resets() {
    return shared("tasks.resets") ?? {};
  }

  get state() {
    return shared("tasks.state") ?? {};
  }

  // A reset task whose plan does not meter the 5h window: greyed out, never run.
  exempt(task) {
    const trigger = task?.trigger ?? {};
    return trigger.type === "reset" && trigger.window === "h5" && this.resets[trigger.provider]?.metered5h === false;
  }

  // ---- writing -------------------------------------------------------------

  // Rewrites the file from a mutation, reading it again once when the snapshot is stale (the
  // runner seeds, another click lands first). After the seed this page is the only writer.
  async apply(cx, mutate, options = {}) {
    this.error = "";
    this.saved = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const expected = shared("tasks.text") ?? "";
      const parsed = parseTasks(expected);
      if (!parsed.config) {
        this.error = parsed.error;
        cx.notify();
        return;
      }
      let next;
      try {
        next = mutate(parsed.config);
      } catch (error) {
        this.error = String(error?.message ?? error);
        cx.notify();
        return;
      }
      const text = serializeTasks(next);
      try {
        await writeTextFile(FILE, text, expected === "" ? null : expected);
        setShared("tasks.text", text);
        setShared("tasks.config", next);
        setShared("tasks.error", "");
        this.saved = Boolean(options.saved);
        run("orca-chrome.tasks-scan");
        cx.notify();
        return;
      } catch {
        const fresh = await readTextFile(FILE).catch(() => null);
        if (fresh !== null && fresh !== expected) {
          const parsedFresh = parseTasks(fresh);
          setShared("tasks.text", fresh);
          setShared("tasks.config", parsedFresh.config);
          setShared("tasks.error", parsedFresh.error ?? "");
        }
      }
    }
    this.error = "tasks.json changed while saving; try again.";
    cx.notify();
  }

  update(id, change) {
    return (config) => ({
      ...config,
      tasks: config.tasks.map((task) => (task.id === id ? change(task) : task)),
    });
  }

  toggle(cx, task) {
    this.apply(cx, this.update(task.id, (t) => ({ ...t, enabled: !t.enabled })));
  }

  remove(cx, task) {
    this.apply(cx, (config) => ({ ...config, tasks: config.tasks.filter((t) => t.id !== task.id) }));
  }

  add(cx) {
    const id = `task-${Date.now().toString(36)}`;
    this.apply(
      cx,
      (config) => ({
        ...config,
        tasks: [
          ...config.tasks,
          {
            id,
            name: "New task",
            enabled: false,
            agent: "claude",
            trigger: { type: "daily", time: "09:00" },
            argv: ["claude", "-p", "ping", "--model", "haiku", "--effort", "low"],
            cwd: null,
          },
        ],
      }),
      { saved: true },
    );
  }

  runNow(cx, task) {
    setShared("tasks.request", { id: task.id, at: Date.now() });
    run("orca-chrome.tasks-scan");
    cx.notify();
  }

  openEditor(cx) {
    this.error = "";
    this.editor = TextareaState.new({ value: shared("tasks.text") ?? "", rows: 16 });
    this.editor.set_soft_wrap(false);
    this.editor.on("change", (event, cx) => {
      void event;
      this.saved = false;
      cx.notify();
    });
    this.editing = true;
    cx.notify();
  }

  closeEditor(cx) {
    this.editing = false;
    this.editor = null;
    this.error = "";
    cx.notify();
  }

  async saveEditor(cx) {
    const value = this.editor?.value() ?? "";
    const parsed = parseTasks(value);
    if (!parsed.config) {
      this.error = parsed.error;
      cx.notify();
      return;
    }
    const text = value.endsWith("\n") ? value : `${value}\n`;
    const expected = shared("tasks.text") ?? "";
    try {
      await writeTextFile(FILE, text, expected === "" ? null : expected);
      setShared("tasks.text", text);
      setShared("tasks.config", parsed.config);
      setShared("tasks.error", "");
      this.error = "";
      this.saved = true;
      run("orca-chrome.tasks-scan");
    } catch {
      this.error = "tasks.json changed while saving; cancel and reopen the editor.";
    }
    cx.notify();
  }

  // ---- parts ---------------------------------------------------------------

  // `disabled`: greyed and inert (no hover, no click) — the plan dropped the window this task
  // waits for, so running it would do nothing.
  button(id, label, t, action, options = {}) {
    const disabled = Boolean(options.disabled);
    return div()
      .id(id)
      .h(options.height ?? 26)
      .px(options.px ?? 9)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(6)
      .border_1()
      .border_color(options.border ?? t.border)
      .text_size(options.size ?? 11)
      .text_color(options.color ?? t.muted)
      .when(disabled, (el) => el.opacity(0.4))
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(action))
      .role("button")
      .accessibility_label(options.label ?? label)
      .tooltip(options.label ?? label)
      .child(label);
  }

  togglePill(id, enabled, t, action) {
    return div()
      .id(id)
      .h(20)
      .px(7)
      .flex_none()
      .flex()
      .items_center()
      .rounded(10)
      .cursor_pointer()
      .bg(enabled ? t.accent : t.raised)
      .text_color(enabled ? t.accent_foreground : t.muted)
      .text_size(10)
      .font_medium()
      .role("button")
      .accessibility_label(enabled ? "Turn off" : "Turn on")
      .tooltip(enabled ? "Turn off" : "Turn on")
      .on_click(action)
      .child(enabled ? "On" : "Off");
  }

  // The "form" a suspended task wears: a grey pill, no switch to press.
  disabledPill(t) {
    return div()
      .h(20)
      .px(7)
      .flex_none()
      .flex()
      .items_center()
      .rounded(10)
      .border_1()
      .border_color(t.border)
      .text_size(10)
      .text_color(t.dim)
      .child("Disabled");
  }

  mark(agent, t) {
    const icon = MARKS[agent];
    return icon
      ? svg(icon).size(14).flex_none().text_color(t.muted)
      : svg("mods/orca-chrome/clock.svg").size(14).flex_none().text_color(t.muted);
  }

  sectionHead(title, t, note, extra) {
    return h_flex()
      .w_full()
      .items_center()
      .gap(8)
      .child(div().text_size(11).font_semibold().text_color(t.dim).child(title))
      .when(note, (el) => el.child(div().text_size(11).text_color(t.dim).child(note)))
      .child(div().flex_1())
      .when(extra, (el) => el.child(extra));
  }

  // ---- render --------------------------------------------------------------

  render(cx) {
    const t = theme();
    const config = this.config;
    const error = this.error || shared("tasks.error") || "";
    const tasks = config?.tasks ?? [];
    return v_flex()
      .id("tm-root")
      .size_full()
      .min_h(0)
      .overflow_hidden()
      .bg(t.background)
      .text_size(12)
      .child(
        h_flex()
          .w_full()
          .max_w(760)
          .mx_auto()
          .px(24)
          .pt(20)
          .pb(12)
          .items_center()
          .gap(8)
          .child(
            div()
              .id("tm-back")
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
              .on_click(() => run("layout.select", { stack: "main", child: TERMINALS_PAGE }))
              .child(svg("mods/orca-agent-manager/chevron-left.svg").size(16)),
          )
          .child(div().text_size(20).font_semibold().text_color(t.foreground).child("Task management"))
          .child(div().flex_1())
          .child(this.button("tm-add", "New task", t, () => this.add(cx))),
      )
      .child(
        v_flex()
          .id("tm-body")
          .w_full()
          .min_h(0)
          .flex_1()
          .overflow_y_scrollbar()
          .child(
            v_flex()
              .w_full()
              .max_w(760)
              .mx_auto()
              .px(24)
              .pb(24)
              .gap(16)
              .child(
                div()
                  .text_size(11)
                  .text_color(t.dim)
                  .child("Schedules run while Herdr is open. Times are local; the last run of each task is kept by Herdr."),
              )
              .child(this.resetCard(t))
              .child(
                v_flex()
                  .w_full()
                  .gap(8)
                  .child(
                    this.sectionHead(
                      "TASKS",
                      t,
                      `${tasks.length}`,
                      h_flex()
                        .items_center()
                        .gap(8)
                        .when(this.saved, (el) => el.child(div().text_size(11).text_color(t.done).child("Saved.")))
                        .child(this.button("tm-json", this.editing ? "Close JSON" : "Edit JSON", t, () => (this.editing ? this.closeEditor(cx) : this.openEditor(cx)))),
                    ),
                  )
                  .when(error, (el) => el.child(div().w_full().p(10).rounded(8).border_1().border_color(t.blocked).text_size(11).text_color(t.blocked).child(error)))
                  .when(!config && !error, (el) => el.child(div().p(16).text_size(12).text_color(t.muted).child("Waiting for the task runner…")))
                  .children(
                    tasks.length
                      ? tasks.map((task) => this.taskCard(task, t, cx))
                      : [div().p(16).rounded(8).border_1().border_color(t.border).border_dashed().text_size(12).text_color(t.muted).child("No tasks. New task adds a disabled template; Edit JSON writes the file directly.")],
                  )
                  .when(this.editing, (el) => el.child(this.editorCard(t, cx))),
              ),
          ),
      );
  }

  // The reset instants the reset-ping schedules fire on.
  resetCard(t) {
    const now = Date.now();
    const row = (provider) => {
      const entry = this.resets[provider] ?? {};
      const exempt = entry.metered5h === false;
      const at = typeof entry.h5 === "number" && entry.h5 > now ? entry.h5 : null;
      return h_flex()
        .id(`tm-reset-${provider}-h5`)
        .w_full()
        .items_center()
        .gap(8)
        .child(div().w(64).flex_none().text_size(11).text_color(t.muted).child(providerLabel(provider)))
        .child(div().w(52).flex_none().text_size(11).text_color(t.dim).child(windowLabel("h5")))
        .child(
          div()
            .flex_1()
            .min_w(0)
            .text_size(11)
            .text_color(at ? t.foreground : t.dim)
            .child(exempt ? "no 5h limit on this plan" : at ? `${formatClock(at)} · ${formatCountdown(at - now)}` : "no window reported"),
        );
    };
    return v_flex()
      .w_full()
      .gap(8)
      .child(this.sectionHead("RESET WINDOWS", t, "5h", null))
      .child(
        v_flex()
          .w_full()
          .p(12)
          .gap(6)
          .rounded(8)
          .border_1()
          .border_color(t.border)
          .bg(t.surface)
          .children(PROVIDERS.map((provider) => row(provider))),
      );
  }

  taskCard(task, t, cx) {
    const live = this.state[task.id] ?? {};
    const disabled = this.exempt(task);
    const last = live.last ?? null;
    const mono = settings()?.font_family ?? "JetBrains Mono";
    const next = live.nextAt ?? null;
    const tone = !last ? t.dim : last.code === 0 ? t.done : t.blocked;
    const lastText = !last
      ? "Never ran."
      : `Last ${formatClock(last.at)} · ${last.code === 0 ? "ok" : `exit ${last.code}`}${last.note ? ` · ${last.note}` : ""}${last.code !== 0 && (last.fails ?? 0) >= 1 ? ` · ${last.fails}×` : ""}`;
    return v_flex()
      .id(`tm-task-${task.id}`)
      .w_full()
      .p(12)
      .gap(6)
      .rounded(8)
      .border_1()
      .border_color(live.running ? t.accent : t.border)
      .bg(t.surface)
      .opacity(disabled ? 0.55 : 1)
      .child(
        h_flex()
          .w_full()
          .items_center()
          .gap(8)
          .child(this.mark(task.agent, t))
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .gap(3)
              .child(
                h_flex()
                  .items_center()
                  .gap(6)
                  .child(div().text_size(13).font_semibold().text_color(t.foreground).truncate().child(task.name))
                  .when(disabled, (el) => el.child(this.disabledPill(t)))
                  .when(!disabled, (el) => el.child(this.togglePill(`tm-on-${task.id}`, task.enabled, t, () => this.toggle(cx, task))))
                  .when(live.running, (el) => el.child(div().text_size(10).text_color(t.accent).child("running…"))),
              )
              .child(
                div()
                  .text_size(11)
                  .text_color(t.muted)
                  .child(
                    disabled
                      ? `${describeTrigger(task)} · no 5h limit on this plan`
                      : task.enabled
                        ? `${describeTrigger(task)} · ${next ? formatCountdown(next - Date.now()) : "no next run"}`
                        : `${describeTrigger(task)} · paused`,
                  ),
              )
              .child(div().text_size(11).text_color(t.dim).font_family(mono).truncate().child(taskText(task))),
          )
          .child(
            this.button(`tm-run-${task.id}`, live.running ? "…" : "Run", t, () => this.runNow(cx, task), {
              label: disabled ? "Disabled: no 5h limit on this plan" : "Run now",
              disabled: disabled || live.running,
            }),
          )
          .child(this.button(`tm-del-${task.id}`, "Delete", t, () => this.remove(cx, task), { label: `Delete ${task.name}`, color: t.dim })),
      )
      .child(div().text_size(11).text_color(tone).truncate().child(lastText));
  }

  editorCard(t, cx) {
    const mono = settings()?.font_family ?? "JetBrains Mono";
    return v_flex()
      .id("tm-editor")
      .w_full()
      .gap(8)
      .p(12)
      .rounded(8)
      .border_1()
      .border_color(t.input)
      .bg(t.background)
      .child(div().text_size(11).text_color(t.dim).child(`tasks.json · a task needs id, name, argv and trigger (reset or daily). version ${TASKS_VERSION}.`))
      .child(div().w_full().rounded(6).border_1().border_color(t.input).bg(t.background).px(8).py(6).child(Textarea.new(this.editor).w_full().font_family(mono).text_size(11).text_color(t.foreground).bg("#00000000")))
      .child(
        h_flex()
          .w_full()
          .gap(8)
          .items_center()
          .child(this.button("tm-save", "Save", t, () => this.saveEditor(cx), { border: t.accent, color: t.foreground }))
          .child(this.button("tm-cancel", "Cancel", t, () => this.closeEditor(cx)))
          .child(div().flex_1()),
      );
  }
}
