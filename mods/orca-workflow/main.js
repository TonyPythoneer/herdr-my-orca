// The three-stage workflow board (Planning / Implementation & Testing / Validation & Final
// Tuning), opened from the sidebar footer's workflow button as a dialog overlay.
// Data: `herdr-orca-workflow.md` in the app folder (model.js has the shape); without
// one the board shows SAMPLE and says so. Agent rows resolve live through agents() by address.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, agents, readTextFile, appHome } from "herdr";
import { SAMPLE, STATUS_LABEL, parseDoc, stageCards } from "./model.js";

export default class Workflow extends View {
  init(_props, cx) {
    this.doc = null;
    this.open = null;
    this.load(cx);
    cx.timer.every(5000, (cx) => this.load(cx));
  }

  load(cx) {
    const path = `${appHome()}/herdr-orca-workflow.md`;
    cx.spawn(async (cx) => {
      let doc = null;
      try { doc = parseDoc(await readTextFile(path)); } catch { /* none or unreadable: sample */ }
      if (JSON.stringify(doc) !== JSON.stringify(this.doc)) { this.doc = doc; cx.notify(); }
    });
  }

  render(cx) {
    const t = theme();
    const doc = this.doc ?? SAMPLE;
    const live = agents();
    const cards = stageCards(doc, live);
    const tone = { complete: t.done, active: t.working, queued: t.muted };
    const stateTone = { working: t.working, blocked: t.blocked, done: t.done, idle: t.idle };

    const pill = (text, color) => h_flex().gap(6).px(10).py(4).rounded_full().items_center().flex_none()
      .bg(color + "22").text_size(12).font_semibold().text_color(color)
      .child(div().size(6).rounded_full().bg(color)).child(text);

    const card = (c) => {
      const color = tone[c.status];
      const expanded = this.open === c.id;
      return v_flex().id(`wf-${c.id}`).flex_1().min_w(0).gap(10).p(16).rounded(14).bg(t.raised)
        .border_1().border_color(c.status === "active" || expanded ? color : t.border)
        .cursor_pointer().hover(s => s.bg(t.hover)).role("button")
        .accessibility_label(`${c.title}, ${STATUS_LABEL[c.status]}, ${c.completed} of ${c.total} tasks`)
        .on_click((_e, cx) => { this.open = expanded ? null : c.id; cx.notify(); })
        .child(h_flex().items_center().justify_between()
          .child(div().px(10).py(6).rounded(8).bg(color + "22").text_size(14).font_semibold().text_color(color).child(c.number))
          .child(pill(STATUS_LABEL[c.status], color)))
        .child(div().text_size(18).font_semibold().text_color(t.foreground).child(c.title))
        .child(div().text_size(12).text_color(t.muted).child(c.subtitle))
        .child(h_flex().items_center().justify_between().mt(6)
          .child(div().text_size(12).text_color(t.muted).child("Tasks completed"))
          .child(div().text_size(20).font_semibold().text_color(t.foreground).child(`${c.completed} / ${c.total}`)))
        .child(div().w_full().h(8).rounded_full().bg(t.border)
          .child(div().h(8).rounded_full().bg(color).w(`${Math.round(c.fraction * 100)}%`)))
        .child(div().text_size(12).text_color(t.muted).child(expanded ? "Hide agents" : "View agents"));
    };

    const agentRow = (a) => h_flex().gap(10).px(12).py(8).rounded(8).bg(t.raised).items_center()
      .child(div().size(8).rounded_full().flex_none().bg(stateTone[a.state] ?? t.idle))
      .child(v_flex().flex_1().min_w(0)
        .child(div().text_size(13).font_semibold().text_color(t.foreground).child(`${a.name} · ${a.address}`))
        .child(div().text_size(12).text_color(t.muted).child(a.task)))
      .child(div().text_size(12).text_color(stateTone[a.state] ?? t.muted).child(a.state));

    const opened = cards.find(c => c.id === this.open);
    return v_flex().size_full().gap(12).p(16).bg(t.surface).text_color(t.foreground)
      .child(h_flex().gap(12).items_stretch().children(cards.map(card)))
      .when(Boolean(doc.review_return_to_implementation), el => el.child(div().self_start().px(12).py(6).rounded_full()
        .bg("#f59e0b22").text_size(12).font_semibold().text_color("#f59e0b").child("Review failed · Return for fixes")))
      .when(Boolean(opened), el => el.child(v_flex().gap(6)
        .child(div().text_size(12).font_semibold().text_color(t.muted).child(`${opened.title.toUpperCase()} · AGENTS`))
        .children(opened.agents.map(agentRow))))
      .when(!this.doc, el => el.child(div().text_size(11).text_color(t.dim)
        .child("Sample data · write herdr-orca-workflow.md in the Herdr config folder for live status")));
  }
}
