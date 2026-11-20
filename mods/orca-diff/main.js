// The diff pane `orca-changes` opens beside the terminals (`pane.split { mod: "orca-diff" }`): one file's
// diff, or every change with `all`. The pane owns its data and reloads on a timer; `orca-diff.show` points
// it at the target in shared state, so a second click in Changes switches file instead of splitting again.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, focused, panes, nextCommand, props, run, settings, shared, theme } from "herdr";
import { diffRows, diffWidth } from "./diff-rows.js";
import { diffBody } from "./diff.js";
import { loadDiff } from "./diff-data.js";

function label(t) {
  if (t.all) return "uncommitted";
  if (t.sectionAll) return t.section === "staged" ? "Staged" : "Unstaged + untracked";
  return t.section === "staged" ? "Staged" : t.status === "U" ? "Untracked" : "Unstaged";
}

export default class Diff extends View {
  init(_props, cx) {
    // The pane's props are the target: { root, on, path, section, status } or { root, on, all: true }.
    this.target = props()?.root ? props() : null;
    this.rows = []; this.width = 300; this.loadGeneration = 0;
    this.load(cx);
    cx.timer.every(10000, (cx) => this.load(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "show") { this.target = shared("orca-diff.target") ?? this.target; this.load(cx); }
        cx.notify();
      }
    });
  }

  load(cx) {
    const t = this.target;
    if (!t) return;
    const generation = ++this.loadGeneration;
    cx.spawn(async (cx) => {
      try {
        const lines = await loadDiff(t, exec);
        if (this.target !== t || this.loadGeneration !== generation) return;
        this.rows = diffRows(lines);
      } catch (e) {
        if (this.target !== t || this.loadGeneration !== generation) return;
        this.rows = diffRows([`Cannot preview this diff: ${e}`]);
      }
      this.width = diffWidth(this.rows);
      cx.notify();
    });
  }

  // `pane.close` with no id closes the focused pane, which may be a terminal: only ever close this tab's one diff pane.
  dismiss() {
    const mine = panes().filter((p) => p.mod === "orca-diff" && p.tab === focused()?.tab);
    if (mine.length === 1) run("pane.close", { pane: mine[0].pane });
  }

  render(_cx) {
    const t = theme(), target = this.target;
    if (!target) return div().size_full().p(16).text_size(12).text_color(t.muted).child("Pick a file in Changes");
    const parts = (target.all ? "All changes" : target.sectionAll ? (target.section === "staged" ? "Staged Changes" : "Changes") : target.path).split("/"), name = parts.pop();
    const add = this.rows.filter((r) => r.kind === "+").length, del = this.rows.filter((r) => r.kind === "-").length;
    return v_flex().id("orca-diff").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(h_flex().flex_1().min_w(0).items_center()
          .child(div().flex_none().max_w(320).truncate().font_semibold().child(name))
          .child(div().ml(6).flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(parts.join("/"))))
        .when(add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)))
        .when(del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
        .child(div().px(6).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(label(target)))
        .child(div().id("orca-diff-close").w(22).h(22).flex().items_center().justify_center().rounded(6).cursor_pointer()
          .role("button").accessibility_label("Close diff").tooltip("Close diff").text_color(t.muted)
          .hover((s) => s.bg(t.hover)).on_click(() => this.dismiss()).child("×")))
      .child(diffBody(t, settings()?.font_family ?? "JetBrains Mono", this.rows, this.width));
  }
}
