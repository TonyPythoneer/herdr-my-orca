import {
  View,
  div,
  svg,
  type ClickEvent,
  type Color,
  type Context,
  type NativeElement,
} from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import {
  appHome,
  layout,
  run,
  setShared,
  shared,
  theme,
  readTextFile,
  writeTextFile,
  settings,
} from "herdr";
import { AGENT } from "../../shared/agent-catalog.js";
import { DialogButton } from "../../shared/dialog-button.js";
import {
  PING_PROMPT,
  TASKS_FILE,
  TASKS_VERSION,
  describeTrigger,
  formatClock,
  formatCountdown,
  parseTasks,
  providerLabel,
  serializeTasks,
  windowLabel,
  type Task,
  type TaskConfig,
  type TaskProvider,
  type TaskWindow,
} from "../../shared/tasks.js";
import { themeColor } from "../../shared/theme-color.js";

type TasksTheme = {
  background: Color;
  surface: Color;
  border: Color;
  dim: Color;
  muted: Color;
  foreground: Color;
  hover: Color;
  accent: Color;
  input: Color;
  done: Color;
  blocked: Color;
  raised: Color;
  accent_foreground: Color;
};
type JsonObject = Record<string, unknown>;
type LastRun = { at: number; code: number; note?: string; fails?: number };
type LiveState = { running?: boolean; nextAt?: number; last?: LastRun | null };
type ResetState = { metered5h?: boolean; h5?: number };
type LayoutNode = JsonObject;
type ButtonOptions = {
  label?: string;
  height?: number;
  px?: number;
  size?: number;
  color?: Color;
  border?: Color | null;
  disabled?: boolean;
};
type Action = (event: ClickEvent, cx: Context) => void;

const TERMINALS_PAGE = "main-terminals";
const TASKS_PAGE = "main-tasks";
const MAIN_STACK = "main";
const FILE = `${appHome()}/${TASKS_FILE}`;
const SCAN_COMMAND = "orca-status-footer.tasks-scan";
const SHARED = {
  text: "tasks.text",
  config: "tasks.config",
  error: "tasks.error",
  resets: "tasks.resets",
  state: "tasks.state",
  request: "tasks.request",
} as const;
const PROVIDERS: readonly TaskProvider[] = [AGENT.claude, AGENT.codex];
const FIVE_HOUR: TaskWindow = "h5";

const WRITE_ATTEMPTS = 2;
const REFRESH_MS = 30_000;
const MARKS = {
  [AGENT.claude]: "mods/orca-assets/claude.svg",
  [AGENT.codex]: "mods/orca-assets/codex--orca-status-bar.svg",
} as const;
const CLOCK_MARK = "mods/orca-assets/clock.svg";

const DEFAULT_MONO_FONT = "JetBrains Mono";
const TRANSPARENT = "#00000000";
const NO_5H_LIMIT = "no 5h limit on this plan";
const NO_WINDOW = "no window reported";
const NO_NEXT_RUN = "no next run";
const NEVER_RAN = "Never ran.";
const PAUSED = "paused";
const DISABLED_PILL = "Disabled";
const DISABLED_RUN = `Disabled: ${NO_5H_LIMIT}`;
const TURN_ON = "Turn on";
const TURN_OFF = "Turn off";
const EDIT_JSON = "Edit JSON";
const CLOSE_JSON = "Close JSON";
const NEW_TASK_NAME = "New task";
const NEW_TASK_ID_PREFIX = "task-";
const NEW_TASK_TIME = "09:00";
const NEW_TASK_ARGV = [AGENT.claude, "-p", PING_PROMPT, "--model", "haiku", "--effort", "low"];
const CHANGED_WHILE_SAVING = "tasks.json changed while saving; try again.";
const CHANGED_WHILE_EDITING = "tasks.json changed while saving; cancel and reopen the editor.";
const WAITING = "Waiting for the task runner…";
const NO_TASKS = "No tasks. New task adds a disabled template; Edit JSON writes the file directly.";

function find(node: LayoutNode | null, id: string): LayoutNode | null {
  if (node?.id === id) return node;
  for (const child of (node?.children ?? []) as LayoutNode[]) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

function sharedText(): string {
  return (shared(SHARED.text) ?? "") as string;
}

function messageOf(error: unknown): unknown {
  return (error as { message?: unknown } | null | undefined)?.message ?? error;
}

async function adoptFreshText(expected: string): Promise<void> {
  const fresh = await readTextFile(FILE).catch(() => null);
  if (fresh === null || fresh === expected) return;
  const parsedFresh = parseTasks(fresh);
  setShared(SHARED.text, fresh);
  setShared(SHARED.config, parsedFresh.config);
  setShared(SHARED.error, parsedFresh.error ?? "");
}

async function commitTasks(text: string, expected: string, config: TaskConfig): Promise<void> {
  await writeTextFile(FILE, text, expected === "" ? null : expected);
  setShared(SHARED.text, text);
  setShared(SHARED.config, config);
  setShared(SHARED.error, "");
}

function resetText(exempt: boolean, at: number | null, now: number): string {
  if (exempt) return NO_5H_LIMIT;
  if (at) return `${formatClock(at)} · ${formatCountdown(at - now)}`;
  return NO_WINDOW;
}

function lastRunText(last: LastRun | null): string {
  if (!last) return NEVER_RAN;
  const outcome = last.code === 0 ? "ok" : `exit ${last.code}`;
  const note = last.note ? ` · ${last.note}` : "";
  const fails = last.code !== 0 && (last.fails ?? 0) >= 1 ? ` · ${last.fails}×` : "";
  return `Last ${formatClock(last.at)} · ${outcome}${note}${fails}`;
}

function lastRunTone(last: LastRun | null, t: TasksTheme): Color {
  if (!last) return t.dim;
  return last.code === 0 ? t.done : t.blocked;
}

function scheduleText(task: Task, disabled: boolean, next: number | null): string {
  if (disabled) return `${describeTrigger(task)} · ${NO_5H_LIMIT}`;
  if (!task.enabled) return `${describeTrigger(task)} · ${PAUSED}`;
  return `${describeTrigger(task)} · ${next ? formatCountdown(next - Date.now()) : NO_NEXT_RUN}`;
}

const taskText = (task: Task): string => (Array.isArray(task.argv) ? task.argv.join(" ") : "");

function isMarkedAgent(agent: string): agent is keyof typeof MARKS {
  return Object.hasOwn(MARKS, agent);
}

function tasksTheme(): TasksTheme {
  const palette = theme();
  return {
    background: themeColor(palette.background),
    surface: themeColor(palette.surface),
    border: themeColor(palette.border),
    dim: themeColor(palette.dim),
    muted: themeColor(palette.muted),
    foreground: themeColor(palette.foreground),
    hover: themeColor(palette.hover),
    accent: themeColor(palette.accent),
    input: themeColor(palette.input),
    done: themeColor(palette.done),
    blocked: themeColor(palette.blocked),
    raised: themeColor(palette.raised),
    accent_foreground: themeColor(palette.accent_foreground),
  };
}

function monoFamily(): string {
  return (settings()?.font_family ?? DEFAULT_MONO_FONT) as string;
}

export default class Tasks extends View {
  editing = false;
  editor: TextareaState | null = null;
  error = "";
  saved = false;

  init(_props: unknown, cx: Context): void {
    cx.timer.every(REFRESH_MS, (tickCx: Context) => {
      if (find(layout() as LayoutNode | null, MAIN_STACK)?.active === TASKS_PAGE) tickCx.notify();
    });
  }

  get config(): TaskConfig | null {
    return (shared(SHARED.config) ?? null) as TaskConfig | null;
  }

  get resets(): Record<string, ResetState> {
    return (shared(SHARED.resets) ?? {}) as Record<string, ResetState>;
  }

  get state(): Record<string, LiveState> {
    return (shared(SHARED.state) ?? {}) as Record<string, LiveState>;
  }

  exempt(task: Task): boolean {
    const trigger: JsonObject = task?.trigger ?? {};
    return (
      trigger.type === "reset" &&
      trigger.window === FIVE_HOUR &&
      this.resets[String(trigger.provider)]?.metered5h === false
    );
  }

  async apply(
    cx: Context,
    mutate: (config: TaskConfig) => TaskConfig,
    options: { saved?: boolean } = {},
  ): Promise<void> {
    this.error = "";
    this.saved = false;
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const expected = sharedText();
      const parsed = parseTasks(expected);
      if (!parsed.config) return this.fail(cx, parsed.error);
      let next: TaskConfig;
      try {
        next = mutate(parsed.config);
      } catch (error) {
        return this.fail(cx, String(messageOf(error)));
      }
      if (await this.tryWrite(next, expected, options)) {
        cx.notify();
        return;
      }
      await adoptFreshText(expected);
    }
    this.fail(cx, CHANGED_WHILE_SAVING);
  }

  fail(cx: Context, message: string): void {
    this.error = message;
    cx.notify();
  }

  async tryWrite(
    next: TaskConfig,
    expected: string,
    options: { saved?: boolean },
  ): Promise<boolean> {
    const text = serializeTasks(next);
    try {
      await commitTasks(text, expected, next);
      this.saved = Boolean(options.saved);
      run(SCAN_COMMAND);
      return true;
    } catch {
      return false;
    }
  }

  rewrite(id: string, change: (task: Task) => Task): (config: TaskConfig) => TaskConfig {
    return (config) => ({
      ...config,
      tasks: config.tasks.map((task) => (task.id === id ? change(task) : task)),
    });
  }

  toggle(cx: Context, task: Task): Promise<void> {
    return this.apply(
      cx,
      this.rewrite(task.id, (t) => ({ ...t, enabled: !t.enabled })),
    );
  }

  remove(cx: Context, task: Task): Promise<void> {
    return this.apply(cx, (config) => ({
      ...config,
      tasks: config.tasks.filter((t) => t.id !== task.id),
    }));
  }

  add(cx: Context): Promise<void> {
    const id = `${NEW_TASK_ID_PREFIX}${Date.now().toString(36)}`;
    return this.apply(
      cx,
      (config) => ({
        ...config,
        tasks: [
          ...config.tasks,
          {
            id,
            name: NEW_TASK_NAME,
            enabled: false,
            agent: AGENT.claude,
            trigger: { type: "daily", time: NEW_TASK_TIME },
            argv: [...NEW_TASK_ARGV],
            cwd: null,
          },
        ],
      }),
      { saved: true },
    );
  }

  runNow(cx: Context, task: Task): void {
    setShared(SHARED.request, { id: task.id, at: Date.now() });
    run(SCAN_COMMAND);
    cx.notify();
  }

  openEditor(cx: Context): void {
    this.error = "";
    this.editor = TextareaState.new({
      value: sharedText(),
      rows: 8,
    });
    this.editor.set_soft_wrap(false);
    this.editor.on("change", (_event, changeCx) => {
      this.saved = false;
      changeCx.notify();
    });
    this.editing = true;
    cx.notify();
  }

  closeEditor(cx: Context): void {
    this.editing = false;
    this.editor = null;
    this.error = "";
    cx.notify();
  }

  async saveEditor(cx: Context): Promise<void> {
    const value = this.editor?.value() ?? "";
    const parsed = parseTasks(value);
    if (!parsed.config) {
      this.error = parsed.error;
      cx.notify();
      return;
    }
    const text = value.endsWith("\n") ? value : `${value}\n`;
    const expected = sharedText();
    try {
      await commitTasks(text, expected, parsed.config);
      this.error = "";
      this.saved = true;
      run(SCAN_COMMAND);
    } catch {
      this.error = CHANGED_WHILE_EDITING;
    }
    cx.notify();
  }

  button(
    id: string,
    label: string,
    t: TasksTheme,
    action: Action,
    options: ButtonOptions = {},
  ): NativeElement {
    return DialogButton(id, label, {
      t,
      name: options.label ?? label,
      tooltip: options.label ?? label,
      h: options.height ?? 26,
      px: options.px ?? 9,
      size: options.size ?? 11,
      color: options.color ?? t.muted,
      border: options.border ?? t.border,
      hoverBg: t.hover,
      hoverFg: t.foreground,
      disabled: Boolean(options.disabled),
      onClick: action,
    });
  }

  togglePill(id: string, enabled: boolean, t: TasksTheme, action: Action): NativeElement {
    const label = enabled ? TURN_OFF : TURN_ON;
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
      .accessibility_label(label)
      .tooltip(label)
      .on_click(action)
      .child(enabled ? "On" : "Off");
  }

  disabledPill(t: TasksTheme): NativeElement {
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
      .child(DISABLED_PILL);
  }

  mark(agent: string, t: TasksTheme): NativeElement {
    const icon = isMarkedAgent(agent) ? MARKS[agent] : CLOCK_MARK;
    return svg(icon).size(14).flex_none().text_color(t.muted);
  }

  sectionHead(
    title: string,
    t: TasksTheme,
    note: string | null,
    extra: NativeElement | null,
  ): NativeElement {
    return h_flex()
      .w_full()
      .items_center()
      .gap(8)
      .child(div().text_size(11).font_semibold().text_color(t.dim).child(title))
      .children(note ? [div().text_size(11).text_color(t.dim).child(note)] : [])
      .child(div().flex_1())
      .children(extra ? [extra] : []);
  }

  render() {
    const t = tasksTheme();
    return v_flex()
      .id("tm-root")
      .size_full()
      .min_h(0)
      .overflow_hidden()
      .bg(t.background)
      .text_size(12)
      .child(this.pageHeader(t))
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
                  .child(
                    "Schedules run while Herdr is open. Times are local; the last run of each task is kept by Herdr.",
                  ),
              )
              .when(!this.editing, (el) => el.child(this.resetCard(t)))
              .child(this.taskSection(t)),
          ),
      );
  }

  pageHeader(t: TasksTheme): NativeElement {
    return h_flex()
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
          .on_click(() => run("layout.select", { stack: MAIN_STACK, child: TERMINALS_PAGE }))
          .child(svg("mods/orca-assets/chevron-left--orca-agent-settings.svg").size(16)),
      )
      .child(div().text_size(20).font_semibold().text_color(t.foreground).child("Task management"))
      .child(div().flex_1())
      .child(
        this.button("tm-add", NEW_TASK_NAME, t, (_event, eventCx) =>
          eventCx.spawn((taskCx) => this.add(taskCx)),
        ),
      );
  }

  tasksHead(t: TasksTheme, count: string): NativeElement {
    return this.sectionHead(
      "TASKS",
      t,
      count,
      h_flex()
        .items_center()
        .gap(8)
        .when(this.saved, (el) => el.child(div().text_size(11).text_color(t.done).child("Saved.")))
        .child(
          this.button("tm-json", this.editing ? CLOSE_JSON : EDIT_JSON, t, (_event, eventCx) =>
            this.editing ? this.closeEditor(eventCx) : this.openEditor(eventCx),
          ),
        ),
    );
  }

  errorBanner(t: TasksTheme, error: string): NativeElement {
    return div()
      .w_full()
      .p(10)
      .rounded(8)
      .border_1()
      .border_color(t.blocked)
      .text_size(11)
      .text_color(t.blocked)
      .child(error);
  }

  taskRows(t: TasksTheme, tasks: Task[]): NativeElement[] {
    return tasks.length
      ? tasks.map((task) => this.taskCard(task, t))
      : [
          div()
            .p(16)
            .rounded(8)
            .border_1()
            .border_color(t.border)
            .border_dashed()
            .text_size(12)
            .text_color(t.muted)
            .child(NO_TASKS),
        ];
  }

  taskSection(t: TasksTheme): NativeElement {
    const config = this.config;
    const error = this.error || ((shared(SHARED.error) || "") as string);
    const tasks = config?.tasks ?? [];
    return v_flex()
      .w_full()
      .gap(8)
      .child(this.tasksHead(t, `${tasks.length}`))
      .when(error, (el) => el.child(this.errorBanner(t, error)))
      .when(!config && !error, (el) =>
        el.child(div().p(16).text_size(12).text_color(t.muted).child(WAITING)),
      )
      .children(this.editing ? [this.editorCard(t)] : this.taskRows(t, tasks));
  }

  resetCard(t: TasksTheme): NativeElement {
    const now = Date.now();
    const row = (provider: TaskProvider): NativeElement => {
      const entry = this.resets[provider] ?? {};
      const exempt = entry.metered5h === false;
      const at = typeof entry.h5 === "number" && entry.h5 > now ? entry.h5 : null;
      return h_flex()
        .id(`tm-reset-${provider}-h5`)
        .w_full()
        .items_center()
        .gap(8)
        .child(
          div().w(64).flex_none().text_size(11).text_color(t.muted).child(providerLabel(provider)),
        )
        .child(
          div().w(52).flex_none().text_size(11).text_color(t.dim).child(windowLabel(FIVE_HOUR)),
        )
        .child(
          div()
            .flex_1()
            .min_w(0)
            .text_size(11)
            .text_color(at ? t.foreground : t.dim)
            .child(resetText(exempt, at, now)),
        );
    };
    return v_flex()
      .w_full()
      .gap(8)
      .child(this.sectionHead("RESET WINDOWS", t, windowLabel(FIVE_HOUR), null))
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

  taskCard(task: Task, t: TasksTheme): NativeElement {
    const live = this.state[task.id] ?? {};
    const disabled = this.exempt(task);
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
          .child(this.mark(String(task.agent), t))
          .child(this.taskSummary(task, t, live, disabled))
          .child(
            this.button(
              `tm-run-${task.id}`,
              live.running ? "…" : "Run",
              t,
              (_event, eventCx) => this.runNow(eventCx, task),
              {
                label: disabled ? DISABLED_RUN : "Run now",
                disabled: disabled || live.running,
              },
            ),
          )
          .child(
            this.button(
              `tm-del-${task.id}`,
              "Delete",
              t,
              (_event, eventCx) => eventCx.spawn((taskCx) => this.remove(taskCx, task)),
              { label: `Delete ${task.name}`, color: t.dim },
            ),
          ),
      )
      .child(
        div()
          .text_size(11)
          .text_color(lastRunTone(live.last ?? null, t))
          .truncate()
          .child(lastRunText(live.last ?? null)),
      );
  }

  taskSummary(task: Task, t: TasksTheme, live: LiveState, disabled: boolean): NativeElement {
    return v_flex()
      .flex_1()
      .min_w(0)
      .gap(3)
      .child(
        h_flex()
          .items_center()
          .gap(6)
          .child(
            div()
              .text_size(13)
              .font_semibold()
              .text_color(t.foreground)
              .truncate()
              .child(task.name),
          )
          .when(disabled, (el) => el.child(this.disabledPill(t)))
          .when(!disabled, (el) =>
            el.child(
              this.togglePill(`tm-on-${task.id}`, task.enabled, t, (_event, eventCx) =>
                eventCx.spawn((taskCx) => this.toggle(taskCx, task)),
              ),
            ),
          )
          .when(live.running, (el) =>
            el.child(div().text_size(10).text_color(t.accent).child("running…")),
          ),
      )
      .child(
        div()
          .text_size(11)
          .text_color(t.muted)
          .child(scheduleText(task, disabled, live.nextAt ?? null)),
      )
      .child(
        div()
          .text_size(11)
          .text_color(t.dim)
          .font_family(monoFamily())
          .truncate()
          .child(taskText(task)),
      );
  }

  editorCard(t: TasksTheme): NativeElement {
    return v_flex()
      .id("tm-editor")
      .w_full()
      .gap(8)
      .p(12)
      .rounded(8)
      .border_1()
      .border_color(t.input)
      .bg(t.background)
      .child(
        div()
          .text_size(11)
          .text_color(t.dim)
          .child(
            `tasks.json · a task needs id, name, argv and trigger (reset or daily). version ${TASKS_VERSION}.`,
          ),
      )
      .child(
        div()
          .w_full()
          .rounded(6)
          .border_1()
          .border_color(t.input)
          .bg(t.background)
          .px(8)
          .py(6)
          .child(
            Textarea.new(this.editor as TextareaState)
              .w_full()
              .font_family(monoFamily())
              .text_size(11)
              .text_color(t.foreground)
              .bg(TRANSPARENT),
          ),
      )
      .child(
        h_flex()
          .w_full()
          .gap(8)
          .items_center()
          .child(
            this.button(
              "tm-save",
              "Save",
              t,
              (_event, eventCx) => eventCx.spawn((taskCx) => this.saveEditor(taskCx)),
              { border: t.accent, color: t.foreground },
            ),
          )
          .child(
            this.button("tm-cancel", "Cancel", t, (_event, eventCx) => this.closeEditor(eventCx)),
          )
          .child(div().flex_1()),
      );
  }
}
