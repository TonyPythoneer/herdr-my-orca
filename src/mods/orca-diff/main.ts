import {
  View,
  div,
  type AsyncContext,
  type Color,
  type Context,
  type NativeElement,
} from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, focused, panes, nextCommand, props, run, settings, shared, theme } from "herdr";
import { diffRows, diffWidth, MIN_WIDTH, ROW, type DiffRow } from "./diff-rows.js";
import { diffBody, type DiffBodyTheme } from "./diff.js";
import { themeColor } from "../../shared/theme-color.js";
import { loadDiff, SECTION, UNTRACKED_STATUS, type DiffTarget } from "./diff-data.js";

const MOD = "orca-diff";
const TARGET_SHARED_KEY = `${MOD}.target`;
const RELOAD_INTERVAL_MS = 10000;
const DEFAULT_FONT = "JetBrains Mono";
const CLOSE_LABEL = "Close diff";
const STAGED_LABEL = "Staged";

export type DiffTheme = DiffBodyTheme & {
  background: Color;
  foreground: Color;
  border: Color;
  muted: Color;
  hover: Color;
};

const isPresent = (value: unknown): value is DiffTarget => value !== undefined && value !== null;

function diffTheme(source: Record<string, string>): DiffTheme {
  return {
    background: themeColor(source.background),
    foreground: themeColor(source.foreground),
    raised: themeColor(source.raised),
    selected: themeColor(source.selected),
    border: themeColor(source.border),
    muted: themeColor(source.muted),
    dim: themeColor(source.dim),
    hover: themeColor(source.hover),
    ansi1: themeColor(source.ansi1),
    ansi2: themeColor(source.ansi2),
  };
}

function monoFont(): string {
  const configured: { font_family?: string } | undefined = settings();
  return configured?.font_family ?? DEFAULT_FONT;
}

function label(t: DiffTarget): string {
  if (t.all) return "uncommitted";
  if (t.sectionAll) return t.section === SECTION.staged ? STAGED_LABEL : "Unstaged + untracked";
  if (t.section === SECTION.staged) return STAGED_LABEL;
  return t.status === UNTRACKED_STATUS ? "Untracked" : "Unstaged";
}

function title(target: DiffTarget): string {
  if (target.all) return "All changes";
  if (!target.sectionAll) return target.path!;
  return target.section === SECTION.staged ? "Staged Changes" : "Changes";
}

export default class Diff extends View {
  target: DiffTarget | null = null;
  rows: DiffRow[] = [];
  width = MIN_WIDTH;
  loadGeneration = 0;

  init(_props: unknown, cx: AsyncContext): void {
    const value: DiffTarget | undefined = props();
    this.target = value?.root ? props() : null;
    this.rows = [];
    this.width = MIN_WIDTH;
    this.loadGeneration = 0;
    this.load(cx);
    cx.timer.every(RELOAD_INTERVAL_MS, (timerCx) => this.load(timerCx));
    cx.spawn(async (taskCx) => {
      for (;;) {
        if ((await nextCommand()) === "show") {
          const sharedTarget: unknown = shared(TARGET_SHARED_KEY);
          this.target = isPresent(sharedTarget) ? sharedTarget : this.target;
          this.load(taskCx);
        }
        taskCx.notify();
      }
    });
  }

  load(cx: AsyncContext): void {
    const t = this.target;
    if (!t) return;
    const generation = ++this.loadGeneration;
    cx.spawn(async (taskCx) => {
      try {
        const lines = await loadDiff(t, exec);
        if (this.target !== t || this.loadGeneration !== generation) return;
        this.rows = diffRows(lines);
      } catch (e) {
        if (this.target !== t || this.loadGeneration !== generation) return;
        this.rows = diffRows([`Cannot preview this diff: ${String(e)}`]);
      }
      this.width = diffWidth(this.rows);
      taskCx.notify();
    });
  }

  dismiss(): void {
    const mine = panes().filter((p) => p.mod === MOD && p.tab === focused()?.tab);
    if (mine.length === 1) run("pane.close", { pane: mine[0].pane });
  }

  empty(t: DiffTheme): NativeElement {
    return div()
      .size_full()
      .p(16)
      .text_size(12)
      .text_color(t.muted)
      .child("Pick a file in Changes");
  }

  closeButton(t: DiffTheme): NativeElement {
    return div()
      .id(`${MOD}-close`)
      .w(22)
      .h(22)
      .flex()
      .items_center()
      .justify_center()
      .rounded(6)
      .cursor_pointer()
      .role("button")
      .accessibility_label(CLOSE_LABEL)
      .tooltip(CLOSE_LABEL)
      .text_color(t.muted)
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.dismiss())
      .child("×");
  }

  header(t: DiffTheme, target: DiffTarget): NativeElement {
    const parts = title(target).split("/"),
      name = parts.pop()!;
    const add = this.rows.filter((r) => r.kind === ROW.added).length,
      del = this.rows.filter((r) => r.kind === ROW.removed).length;
    return h_flex()
      .h(36)
      .flex_none()
      .px(12)
      .gap(8)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .items_center()
          .child(div().flex_none().max_w(320).truncate().font_semibold().child(name))
          .child(
            div()
              .ml(6)
              .flex_1()
              .min_w(0)
              .truncate()
              .text_size(11)
              .text_color(t.muted)
              .child(parts.join("/")),
          ),
      )
      .when(add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)))
      .when(del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
      .child(
        div()
          .px(6)
          .py(1)
          .rounded(4)
          .border_1()
          .border_color(t.border)
          .text_size(10)
          .text_color(t.muted)
          .child(label(target)),
      )
      .child(this.closeButton(t));
  }

  render(_cx: Context): NativeElement {
    const t = diffTheme(theme()),
      target = this.target;
    if (!target) return this.empty(t);
    return v_flex()
      .id(MOD)
      .size_full()
      .min_h(0)
      .overflow_hidden()
      .bg(t.background)
      .text_color(t.foreground)
      .text_size(13)
      .child(this.header(t, target))
      .child(diffBody(t, monoFont(), this.rows, this.width));
  }
}
