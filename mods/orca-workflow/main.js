// Workflow UI: the four-light strip in the sidebar (`props().strip`) and the inspector
// dialog opened from it (or from the sidebar footer's workflow button).
// Data: ~/.config/herdr-app/my-orca/{index,state,config}.json, written by my-orca.
// The mod never writes state.json; it may write config.json with an expected-text check.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import {
  theme, terminals, props, run, openOverlay, readTextFile, writeTextFile,
  appHome, exec, notify, watchFolder, spaces, focused, closeOverlay,
} from "herdr";
import { lights, inspectorRows, parseJson, statusLine, planningNote } from "./model.js";

const ROOT = () => `${appHome()}/my-orca`;
const ICON = (name) => `mods/orca-status/${name}.svg`;

export default class Workflow extends View {
  init(_props, cx) {
    this.state = null;
    this.stateText = null;
    this.wtId = null;
    this.folder = null;
    this.config = null;
    this.configText = null;
    this.termList = [];
    this.loadError = null;
    this.narrow = false;
    this.notified = null;
    this.editingRework = false;
    this.loadToken = 0;
    this.rework = InputState.new({ placeholder: "3" });
    this.rework.on("focus", () => { this.editingRework = true; });
    this.rework.on("blur", () => { this.editingRework = false; });
    this.load(cx);
    cx.timer.every(5000, (cx) => this.load(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        try { await watchFolder(ROOT()); } catch { await cx.sleep(5000); }
        this.load(cx);
      }
    });
  }

  folderNow() {
    const agent = focused();
    if (agent?.cwd) return agent.cwd;
    const active = spaces().find((s) => s.active);
    return active?.folder ?? null;
  }

  async gitDir(folder) {
    if (!folder) return null;
    try {
      const r = await exec("sh", ["-c", 'cd "$1" && d=$(git rev-parse --path-format=absolute --git-dir) && cd "$d" && pwd -P', "sh", folder], { cwd: folder });
      return r.code === 0 ? r.stdout.trim() : null;
    } catch { return null; }
  }

  load(cx) {
    const token = ++this.loadToken;
    const folder = this.folderNow();
    cx.spawn(async (cx) => {
      try {
        const gitDir = await this.gitDir(folder);
        const indexText = await readTextFile(`${ROOT()}/index.json`);
        const index = parseJson(indexText) ?? {};
        const wtId = gitDir ? index[gitDir] ?? null : null;
        let stateText = null;
        if (wtId) stateText = await readTextFile(`${ROOT()}/${wtId}/state.json`);
        let state = null;
        let stateError = null;
        if (stateText !== null) {
          try { state = parseJson(stateText); } catch { stateError = "state.json is not valid JSON"; }
        }
        const configText = await readTextFile(`${ROOT()}/config.json`);
        let config = null;
        try { config = parseJson(configText); } catch { config = null; }
        if (token !== this.loadToken) return;
        this.folder = folder;
        this.wtId = wtId;
        this.state = state ?? (stateError ? this.state : null);
        this.stateText = stateText;
        this.stateError = stateError;
        this.config = config;
        this.configText = configText;
        this.loadError = null;
        this.notifyTransition(state);
        if (!this.editingRework && config && this.rework.value() !== String(config.max_rework_cycles)) {
          this.rework.set_value(String(config.max_rework_cycles));
        }
        this.loadTerminals();
        cx.notify();
      } catch (e) {
        if (token !== this.loadToken) return;
        this.loadError = String(e?.message ?? e);
        cx.notify();
      }
    });
  }

  loadTerminals() {
    const runId = this.state?.run_id;
    this.termList = runId ? terminals().filter((t) => t?.labels?.["orca.run"] === runId) : [];
  }

  // D9: one notification per transition, deduped by state.updated.
  notifyTransition(state) {
    if (!state) return;
    const prev = this.lastStatus;
    this.lastStatus = state.status;
    if (!prev || prev === state.status) return;
    if (this.notified === state.updated) return;
    if (state.status === "needs_user") {
      notify({ title: "Workflow needs you", body: state.needs_user?.code ?? "open the workflow inspector", level: "warning" });
      this.notified = state.updated;
    } else if (state.status === "completed") {
      notify({ title: "Ready for review", body: state.run_id ?? "workflow finished", level: "success" });
      this.notified = state.updated;
    }
  }

  openInspector() {
    if (props()?.overlay) return;
    openOverlay({ mod: "orca-workflow", kind: "dialog", width: 0.92, height: 620 });
  }

  lamp(l) {
    const t = theme();
    const size = 9;
    if (l.state === "complete") return svg(ICON("circle-check")).size(size).text_color(l.color);
    if (l.state === "needs_user") return svg(ICON("triangle-alert")).size(size).text_color(t.blocked);
    if (l.state === "failed") return svg(ICON("alert-circle")).size(size).text_color(t.blocked);
    if (l.state === "working") return div().size(size).rounded_full().flex_none().bg(l.color).loop("opacity", { from: 0.45, to: 1, period: 1200 });
    return div().size(size).rounded_full().flex_none().border_1().border_color(l.color);
  }

  renderStrip(cx) {
    const t = theme();
    if (!this.state) {
      return h_flex().size_full().items_center().px(10).bg(t.chrome).border_b(1).border_color(t.border)
        .child(div().text_size(11).text_color(t.dim).child("No workflow · /herdr-planning"));
    }
    const rows = lights(this.state);
    return h_flex().size_full().items_center().px(8).gap(10).bg(t.chrome).border_b(1).border_color(t.border)
      .id("workflow-strip").on_size_change((s, cx) => { const n = s.width < 260; if (n !== this.narrow) { this.narrow = n; cx.notify(); } })
      .children(rows.map((l) => h_flex().id(`light-${l.id}`).gap(5).items_center().cursor_pointer()
        .tooltip(`${l.long}: ${l.accepted}/${l.total} (${l.state})`)
        .on_click(() => this.openInspector())
        .child(this.lamp(l))
        .when(!this.narrow, (el) => el.child(div().text_size(10.5).text_color(t.muted).child(l.label)))
        .child(div().text_size(10.5).text_color(t.foreground).child(`${l.accepted}/${l.total}`))));
  }

  button(id, label, action, disabled = false) {
    const t = theme();
    return div().id(id).px(10).py(5).rounded(7).border_1().border_color(t.border).bg(t.raised)
      .text_size(12).text_color(disabled ? t.dim : t.foreground)
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(action))
      .child(label);
  }

  taskRow(row) {
    const t = theme();
    const tone = { accepted: t.done, pending: t.muted, dispatched: t.working, rejected: t.blocked }[row.state] ?? t.muted;
    return h_flex().id(`task-${row.id}`).gap(8).px(10).py(6).rounded(8).bg(t.raised).items_center()
      .child(div().size(7).rounded_full().flex_none().bg(tone))
      .child(div().text_size(12).font_semibold().text_color(t.foreground).child(row.id))
      .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).child(row.title))
      .child(div().text_size(11).text_color(tone).child(row.state))
      .when(row.attempts > 0, (el) => el.child(div().text_size(11).text_color(t.dim).child(`${row.attempts} try`)))
      .when(Boolean(row.terminal), (el) => el.child(this.button(`peek-${row.id}`, "Peek", () => run("terminal.peek", { terminal: row.terminal.address }))));
  }

  acceptanceRow(row) {
    const t = theme();
    const color = row.pass === true ? t.done : row.pass === false ? t.blocked : t.dim;
    const icon = row.pass === true ? "circle-check" : row.pass === false ? "alert-circle" : "circle-help";
    return h_flex().gap(8).px(10).py(5).items_center()
      .child(svg(ICON(icon)).size(11).text_color(color))
      .child(div().text_size(12).font_semibold().text_color(t.foreground).child(row.id))
      .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).child(row.text))
      .child(div().text_size(11).text_color(t.dim).child(row.manual ? "manual" : "verify"));
  }

  saveRework(cx) {
    const n = Number(String(this.rework.value()).trim());
    if (!Number.isInteger(n) || n < 1 || n > 9) {
      notify({ title: "Rework limit not saved", body: "Use an integer from 1 to 9", level: "warning" });
      return;
    }
    const next = { ...(this.config ?? {}), max_rework_cycles: n };
    const expected = this.configText;
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(`${ROOT()}/config.json`, JSON.stringify(next, null, 2) + "\n", expected);
        notify({ title: "Rework limit saved", body: `max_rework_cycles = ${n}`, level: "success" });
        this.load(cx);
      } catch {
        notify({ title: "Config changed on disk", body: "Reloaded the latest value; try again", level: "warning" });
        this.load(cx);
      }
    });
  }

  cli(action, cx) {
    if (!this.wtId) return;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("my-orca", [action, this.wtId]);
        if (r.code !== 0) notify({ title: `my-orca ${action} failed`, body: (r.stderr || r.stdout || "").slice(0, 300), level: "error" });
        this.load(cx);
      } catch (e) {
        notify({ title: `my-orca ${action} unavailable`, body: String(e?.message ?? e), level: "error" });
      }
    });
  }

  renderInspector(cx) {
    const t = theme();
    const overlay = props()?.overlay;
    if (!this.state) {
      return v_flex().size_full().items_center().justify_center().gap(8).p(24).bg(t.surface)
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("No workflow in this worktree"))
        .child(div().text_size(12).text_color(t.muted).child("Run /herdr-planning in the Planning tab to start one."))
        .when(Boolean(this.loadError || this.stateError), (el) => el.child(div().text_size(11).text_color(t.blocked).child(this.loadError ?? this.stateError)))
        .when(Boolean(overlay), (el) => el.child(this.button("close", "Close", () => closeOverlay(overlay))));
    }
    const rows = inspectorRows(this.state, this.termList);
    const l = lights(this.state);
    const note = planningNote(this.state);
    const stop = rows.status === "needs_user" || rows.status === "working";

    return v_flex().size_full().gap(10).p(16).bg(t.surface).text_color(t.foreground)
      .child(h_flex().gap(12).items_center()
        .child(div().text_size(15).font_semibold().child("Workflow"))
        .child(div().text_size(11).text_color(t.muted).child(rows.run_id ?? ""))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(rows.status === "needs_user" ? t.blocked : t.muted).child(statusLine(this.state)))
        .when(Boolean(overlay), (el) => el.child(this.button("close", "Close", () => closeOverlay(overlay)))))
      .child(h_flex().gap(14).items_center()
        .children(l.map((x) => h_flex().gap(5).items_center().child(this.lamp(x))
          .child(div().text_size(11).text_color(t.muted).child(x.long))
          .child(div().text_size(11).text_color(t.foreground).child(`${x.accepted}/${x.total}`)))))
      .when(Boolean(rows.needs_user), (el) => el.child(div().px(10).py(6).rounded(7).bg(t.blocked + "22")
        .text_size(12).text_color(t.blocked).child(`${rows.needs_user.code}: ${rows.needs_user.detail ?? ""}`)))
      .when(Boolean(note), (el) => el.child(div().text_size(11).text_color(t.dim).child(note)))
      .child(v_flex().flex_1().min_h(0).gap(5).overflow_y_scroll()
        .child(div().text_size(10.5).font_semibold().text_color(t.muted).child("TASKS"))
        .children(rows.tasks.map((r) => this.taskRow(r)))
        .child(div().text_size(10.5).font_semibold().text_color(t.muted).mt(8).child("ACCEPTANCE"))
        .children(rows.acceptance.map((r) => this.acceptanceRow(r))))
      .child(h_flex().gap(8).items_center().border_t(1).border_color(t.border).pt(8)
        .child(div().text_size(11).text_color(t.muted).child("Rework limit"))
        .child(Input.new(this.rework).w(48).h(26).px(6).rounded(6).border_1().border_color(t.input).bg(t.raised).text_size(12).text_color(t.foreground))
        .child(this.button("save-rework", "Save", () => this.saveRework(cx)))
        .child(div().flex_1())
        .child(this.button("resume", rows.status === "needs_user" ? "Resume" : "Refresh", () => this.cli("start", cx), rows.status === "completed"))
        .child(this.button("stop", "Stop", () => this.cli("stop", cx), !stop)));
  }

  render(cx) {
    return props()?.strip ? this.renderStrip(cx) : this.renderInspector(cx);
  }
}
